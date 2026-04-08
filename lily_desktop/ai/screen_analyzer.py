"""Desktop screenshot analysis via OpenAI or Ollama vision."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from ai.provider_chat import (
    build_vision_chat_request,
    extract_chat_finish_reason,
    extract_chat_response_text,
    normalize_provider,
)

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
_HTTP_TIMEOUT_SECONDS = 30.0
_MAX_COMPLETION_TOKENS = 500

_SYSTEM_PROMPT = """\
You analyze a desktop screenshot and return only JSON.
Return this schema exactly:
{
  "summary": "A short situation summary in natural Japanese within 50 characters",
  "tags": ["tag1", "tag2"],
  "activity_type": "coding | reading | browsing | watching | gaming | chatting | idle | other",
  "detail": "A more detailed explanation in natural Japanese within 150 characters"
}

Rules:
- Infer the user's current activity from the visible content.
- Use the active-window context as a hint, but prioritize what is visible in the screenshot.
- Do not quote page text, source code, personal data, or secrets verbatim.
- If the screen is unclear, use the closest safe category and explain briefly.
- Write summary, detail, and tag values in natural Japanese.
"""

_USER_PROMPT = (
    "Analyze the user's current desktop activity from this screenshot and return only JSON."
)


@dataclass
class ScreenAnalysis:
    """Parsed desktop screenshot analysis."""

    summary: str = ""
    tags: list[str] = field(default_factory=list)
    activity_type: str = "other"
    detail: str = ""
    timestamp: str = ""
    source: str = "screenshot"


async def analyze_screenshot(
    *,
    api_key: str,
    provider: str = "openai",
    base_url: str = "",
    model: str,
    screenshot_png: bytes,
    window_context: str = "",
) -> ScreenAnalysis:
    """Analyze one screenshot and return a structured summary."""

    normalized_provider = normalize_provider(provider)
    prompt_parts: list[str] = []
    if window_context:
        prompt_parts.append(f"Active window context: {window_context}")
    prompt_parts.append(_USER_PROMPT)

    payload = await _post_screen_analysis(
        api_key=api_key,
        provider=normalized_provider,
        base_url=base_url,
        model=model,
        screenshot_png=screenshot_png,
        user_text="\n".join(prompt_parts),
    )

    usage: dict[str, Any] = payload.get("usage", {})
    if normalized_provider == "ollama":
        usage = {
            "prompt_eval_count": payload.get("prompt_eval_count"),
            "eval_count": payload.get("eval_count"),
        }
    logger.info("Screen analysis API usage: %s", usage)

    content = extract_chat_response_text(normalized_provider, payload)
    finish_reason = extract_chat_finish_reason(normalized_provider, payload)
    logger.info(
        "Screen analysis finished: provider=%s finish_reason=%s content_length=%d max_completion_tokens=%d content=%s",
        normalized_provider,
        finish_reason,
        len(content),
        _MAX_COMPLETION_TOKENS,
        content[:200],
    )

    if finish_reason == "length":
        raise Exception("Screen analysis response was truncated.")

    if content:
        return _parse_analysis(content)

    raise Exception("Screen analysis response was empty.")


async def _post_screen_analysis(
    *,
    api_key: str,
    provider: str,
    base_url: str,
    model: str,
    screenshot_png: bytes,
    user_text: str,
) -> dict[str, Any]:
    request = build_vision_chat_request(
        provider=provider,
        api_key=api_key,
        model=model,
        base_url=base_url,
        system_prompt=_SYSTEM_PROMPT,
        user_text=user_text,
        image_pngs=[screenshot_png],
        max_completion_tokens=_MAX_COMPLETION_TOKENS,
    )
    if provider == "ollama":
        request.body["think"] = False

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            request.url,
            headers=request.headers,
            json=request.body,
        )

    if not resp.is_success:
        detail = resp.text[:200]
        raise Exception(f"Screen analysis failed: {resp.status_code} - {detail}")

    return resp.json()


def _parse_analysis(raw: str) -> ScreenAnalysis:
    """Parse the AI JSON payload into ScreenAnalysis."""

    now = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        data = json.loads(cleaned)
        return ScreenAnalysis(
            summary=data.get("summary", ""),
            tags=data.get("tags", []),
            activity_type=data.get("activity_type", "other"),
            detail=data.get("detail", ""),
            timestamp=now,
        )
    except json.JSONDecodeError:
        logger.warning("Screen analysis JSON parse failed: %s", raw[:200])
        return ScreenAnalysis(
            summary=raw[:50] if raw else "解析失敗",
            timestamp=now,
        )
