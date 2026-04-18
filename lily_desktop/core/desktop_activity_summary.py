from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import logging
from typing import Any

import httpx

from ai.provider_chat import (
    build_text_chat_request,
    extract_chat_finish_reason,
    extract_chat_response_text,
    normalize_provider,
)


logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
_HTTP_TIMEOUT_SECONDS = 30.0
_MAX_COMPLETION_TOKENS = 220
_RECENT_WINDOW_MINUTES = 5
_SYSTEM_PROMPT = (
    "あなたはPC上の行動ログを短く要約するアシスタントです。"
    "渡された最近5分の行動ログだけを見て、日本語の自然文1〜2文で短く要約してください。"
    "出力は要約テキストのみとし、構造化形式や箇条書きや前置きは不要です。"
    "書かれていない推測は避け、privacy適用済みの情報だけを根拠にしてください。"
)


@dataclass
class DesktopActivitySummary:
    summary: str = ""
    tags: list[str] = field(default_factory=list)
    activity_type: str = "other"
    latest_app_name: str = ""
    latest_window_title: str = ""


def _normalize_jst(value: datetime | None) -> datetime:
    current = value or datetime.now(JST)
    if current.tzinfo is None:
        return current.replace(tzinfo=JST)
    return current.astimezone(JST)


def _parse_occurred_at(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return _normalize_jst(parsed)


def _recent_events(
    recent_events: list[dict[str, Any]],
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    current = _normalize_jst(now)
    cutoff = current - timedelta(minutes=_RECENT_WINDOW_MINUTES)
    filtered: list[tuple[datetime, dict[str, Any]]] = []
    for event in recent_events:
        occurred_at = _parse_occurred_at(event.get("occurredAt"))
        if occurred_at is None or occurred_at < cutoff:
            continue
        filtered.append((occurred_at, event))
    filtered.sort(key=lambda item: item[0])
    return [dict(event) for _, event in filtered]


def _latest_app_name(events: list[dict[str, Any]]) -> str:
    for event in reversed(events):
        app_name = str(event.get("appName", "")).strip()
        if app_name:
            return app_name
    return ""


def _latest_window_title(events: list[dict[str, Any]]) -> str:
    for event in reversed(events):
        title = str(event.get("windowTitle", "")).strip()
        if title:
            return title[:80]
    return ""


def _collect_tags(events: list[dict[str, Any]]) -> list[str]:
    tags: list[str] = []
    for event in reversed(events):
        for value in (event.get("appName"), event.get("domain")):
            label = str(value or "").strip()
            if not label or label in tags:
                continue
            tags.append(label)
            if len(tags) >= 3:
                return tags
    return tags


def _classify_activity_type(events: list[dict[str, Any]]) -> str:
    if not events:
        return "other"

    event_types = {str(event.get("eventType", "")).strip().lower() for event in events}
    if event_types and event_types <= {"idle_started", "idle_ended"}:
        return "idle"

    latest = events[-1]
    app_name = str(latest.get("appName", "")).lower()
    title = str(latest.get("windowTitle", "")).lower()
    domain = str(latest.get("domain", "")).lower()
    combined = " ".join(part for part in (app_name, title, domain) if part)

    if any(keyword in combined for keyword in ("discord", "slack", "teams", "line", "chat")):
        return "chatting"
    if any(keyword in combined for keyword in ("youtube", "netflix", "primevideo", "twitch")):
        return "watching"
    if any(keyword in combined for keyword in ("steam", "game", "minecraft", "valorant")):
        return "gaming"
    if any(keyword in combined for keyword in ("code.exe", "cursor", "pycharm", ".py", ".ts", ".tsx", ".js")):
        return "coding"
    if any(keyword in combined for keyword in ("readme", "docs", "document", "notion", "scrapbox", "qiita")):
        return "reading"
    if domain or "chrome" in app_name or "edge" in app_name or "firefox" in app_name:
        return "browsing"
    return "other"


def _build_prompt_text(events: list[dict[str, Any]]) -> str:
    lines = ["直近5分の行動ログ:"]
    for event in events:
        parts = [
            f"[{event.get('occurredAt', '')}]",
            str(event.get("eventType", "")).strip(),
        ]
        app_name = str(event.get("appName", "")).strip()
        domain = str(event.get("domain", "")).strip()
        title = str(event.get("windowTitle", "")).strip()
        metadata = event.get("metadata", {})
        if app_name:
            parts.append(f"app={app_name}")
        if domain:
            parts.append(f"domain={domain}")
        if title:
            parts.append(f"title={title[:80]}")
        if isinstance(metadata, dict):
            trigger = str(metadata.get("trigger", "")).strip()
            storage_mode = str(metadata.get("storageMode", "")).strip()
            elapsed_seconds = metadata.get("elapsedSeconds")
            if trigger:
                parts.append(f"trigger={trigger}")
            if storage_mode:
                parts.append(f"storage={storage_mode}")
            if isinstance(elapsed_seconds, (int, float)):
                parts.append(f"elapsed={int(elapsed_seconds)}s")
        lines.append(" / ".join(parts))
    return "\n".join(lines)


def _fallback_summary(events: list[dict[str, Any]]) -> str:
    if not events:
        return ""

    activity_type = _classify_activity_type(events)
    app_counter = Counter(
        str(event.get("appName", "")).strip()
        for event in events
        if str(event.get("appName", "")).strip()
    )
    domain_counter = Counter(
        str(event.get("domain", "")).strip()
        for event in events
        if str(event.get("domain", "")).strip()
    )
    app_name = app_counter.most_common(1)[0][0] if app_counter else ""
    domain = domain_counter.most_common(1)[0][0] if domain_counter else ""

    if activity_type == "coding":
        subject = app_name or "エディタ"
        return f"{subject}で実装やコード確認を進めているようです。"
    if activity_type == "reading":
        subject = domain or app_name or "資料"
        return f"{subject}を読みながら内容を確認しているようです。"
    if activity_type == "browsing":
        subject = domain or app_name or "ブラウザ"
        return f"{subject}を見ながら調べものを進めているようです。"
    if activity_type == "watching":
        subject = domain or app_name or "動画サイト"
        return f"{subject}で動画や配信を見ているようです。"
    if activity_type == "gaming":
        subject = app_name or "ゲーム"
        return f"{subject}で遊んでいるようです。"
    if activity_type == "chatting":
        subject = app_name or domain or "チャット"
        return f"{subject}でやり取りをしているようです。"
    if activity_type == "idle":
        return ""
    subject = app_name or domain or "PC"
    return f"{subject}で作業を進めているようです。"


async def summarize_recent_desktop_activity(
    *,
    openai_api_key: str,
    provider: str,
    base_url: str,
    model: str,
    recent_events: list[dict[str, Any]],
    now: datetime | None = None,
) -> DesktopActivitySummary:
    events = _recent_events(recent_events, now=now)
    if not events:
        return DesktopActivitySummary()

    activity_type = _classify_activity_type(events)
    latest_app_name = _latest_app_name(events)
    latest_window_title = _latest_window_title(events)
    tags = _collect_tags(events)

    if activity_type == "idle":
        return DesktopActivitySummary(
            tags=tags,
            activity_type="idle",
            latest_app_name=latest_app_name,
            latest_window_title=latest_window_title,
        )

    summary_text = ""
    try:
        request = build_text_chat_request(
            provider=normalize_provider(provider, default="ollama"),
            api_key=openai_api_key,
            model=model,
            base_url=base_url,
            system_prompt=_SYSTEM_PROMPT,
            user_text=_build_prompt_text(events),
            max_completion_tokens=_MAX_COMPLETION_TOKENS,
        )
        if request.body.get("stream") is False:
            request.body["think"] = False
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                request.url,
                headers=request.headers,
                json=request.body,
            )
        if not resp.is_success:
            raise RuntimeError(f"desktop activity summary failed: {resp.status_code}")
        payload = resp.json()
        finish_reason = extract_chat_finish_reason(provider, payload)
        if finish_reason == "length":
            raise RuntimeError("desktop activity summary response was truncated")
        summary_text = extract_chat_response_text(provider, payload).strip()
    except Exception:
        logger.exception("Failed to summarize desktop activity with LLM")
        summary_text = _fallback_summary(events)

    return DesktopActivitySummary(
        summary=summary_text,
        tags=tags,
        activity_type=activity_type,
        latest_app_name=latest_app_name,
        latest_window_title=latest_window_title,
    )
