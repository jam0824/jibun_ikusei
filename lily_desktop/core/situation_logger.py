"""Situation logging and periodic summary generation."""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from ai.provider_chat import (
    DEFAULT_OLLAMA_BASE_URL,
    build_text_chat_request,
    extract_chat_finish_reason,
    extract_chat_response_text,
    normalize_provider,
)

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

_BASE_DIR = Path(__file__).resolve().parent.parent
_LOG_DIR = _BASE_DIR / "logs" / "situations"
_SUMMARY_MAX_COMPLETION_TOKENS = 500
_SUMMARY_SYSTEM_PROMPT = (
    "あなたは状況ログを要約するアシスタントです。"
    "渡された30分ぶんの記録から、ユーザーの行動や状況を日本語で3文以内に簡潔に要約してください。"
    "書かれていない推測は避け、短い自然文だけを返してください。"
)


@dataclass
class SituationRecord:
    """One point-in-time situation record."""

    timestamp: str = ""
    camera_summary: str = ""
    camera_tags: list[str] = field(default_factory=list)
    camera_scene_type: str = ""
    desktop_summary: str = ""
    desktop_tags: list[str] = field(default_factory=list)
    desktop_activity_type: str = ""
    active_app: str = ""
    window_title: str = ""


class SituationLogger:
    """Append situation records to JSONL and create periodic summaries."""

    def __init__(
        self,
        *,
        openai_api_key: str,
        summary_model: str,
        summary_provider: str = "openai",
        summary_base_url: str = DEFAULT_OLLAMA_BASE_URL,
    ):
        self._openai_api_key = openai_api_key
        self._summary_model = summary_model
        self._summary_provider = normalize_provider(summary_provider)
        self._summary_base_url = summary_base_url
        self._pending_records: list[SituationRecord] = []
        _LOG_DIR.mkdir(parents=True, exist_ok=True)

    def _log_file_path(self) -> Path:
        today = datetime.now(JST).strftime("%Y-%m-%d")
        return _LOG_DIR / f"{today}.jsonl"

    def record(self, record: SituationRecord) -> None:
        log_path = self._log_file_path()
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")

        self._pending_records.append(record)
        logger.info(
            "Situation recorded: camera=%s desktop=%s app=%s",
            record.camera_summary,
            record.desktop_summary,
            record.active_app,
        )

    async def generate_summary(self) -> dict | None:
        if not self._pending_records:
            logger.info("No pending situation records for summary")
            return None

        records_text = self._format_records_for_summary()
        details = self._extract_details()
        self._pending_records.clear()

        try:
            summary_text = await self._call_summary_ai(records_text)
            logger.info("Generated 30-minute summary: %s", summary_text[:100])
            now = datetime.now(JST).strftime("%Y-%m-%dT%H:%M:%S+09:00")
            return {
                "summary": summary_text,
                "timestamp": now,
                "details": details,
            }
        except Exception:
            logger.exception("Failed to generate 30-minute summary")
            return None

    def _extract_details(self) -> dict:
        camera_summaries: list[str] = []
        desktop_summaries: list[str] = []
        active_apps: list[str] = []

        for record in self._pending_records:
            if record.camera_summary:
                camera_summaries.append(record.camera_summary)
            if record.desktop_summary:
                desktop_summaries.append(record.desktop_summary)
            if record.active_app and record.active_app not in active_apps:
                active_apps.append(record.active_app)

        return {
            "camera_summaries": camera_summaries,
            "desktop_summaries": desktop_summaries,
            "active_apps": active_apps,
        }

    def _format_records_for_summary(self) -> str:
        lines: list[str] = []
        for record in self._pending_records:
            parts = [f"[{record.timestamp}]"]
            if record.camera_summary:
                parts.append(f"カメラ: {record.camera_summary}")
            if record.desktop_summary:
                parts.append(f"デスクトップ: {record.desktop_summary}")
            if record.active_app:
                parts.append(f"アプリ: {record.active_app}")
            lines.append(" / ".join(parts))
        return "\n".join(lines)

    async def _call_summary_ai(self, records_text: str) -> str:
        request = build_text_chat_request(
            provider=self._summary_provider,
            api_key=self._openai_api_key,
            model=self._summary_model,
            base_url=self._summary_base_url,
            system_prompt=_SUMMARY_SYSTEM_PROMPT,
            user_text=records_text,
            max_completion_tokens=_SUMMARY_MAX_COMPLETION_TOKENS,
        )

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                request.url,
                headers=request.headers,
                json=request.body,
            )

        if not resp.is_success:
            raise Exception(f"Summary API failed: {resp.status_code} - {resp.text[:200]}")

        payload = resp.json()
        content = extract_chat_response_text(self._summary_provider, payload)
        if content:
            return content

        finish_reason = extract_chat_finish_reason(self._summary_provider, payload)
        if finish_reason == "length":
            raise Exception("Summary response was truncated before text was returned.")
        raise Exception("Summary response was empty.")
