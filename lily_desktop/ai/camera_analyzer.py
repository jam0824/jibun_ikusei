"""Camera image analysis via OpenAI or Ollama vision."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import cv2
import httpx
import numpy as np

from ai.provider_chat import (
    build_vision_chat_request,
    extract_chat_finish_reason,
    extract_chat_response_text,
    normalize_provider,
)

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
_MAX_IMAGE_LONG_EDGE = 512
_HTTP_TIMEOUT_SECONDS = 45.0
_MAX_COMPLETION_TOKENS = 900

_SYSTEM_PROMPT = """\
あなたはカメラ画像を観察して状況を要約するアシスタントです。
画像に写っている内容から、現在の状況や雰囲気を日本語で簡潔に説明してください。

必ず次の JSON 形式だけで返してください。
{
  "summary": "50文字以内の短い要約",
  "tags": ["特徴タグ1", "特徴タグ2"],
  "scene_type": "outdoor | indoor | weather | people | animal | quiet | other",
  "detail": "150文字以内の補足"
}

ルール:
- 推測しすぎず、画像から分かることを優先する
- 露骨な年齢・属性推定は避ける
- 人物は必要なときだけ触れる
- 音は写っていないので推測しない
- 最後まで JSON だけを返す
"""

_USER_PROMPT = "このカメラ画像を見て、現在の状況を日本語で簡潔に分析してください。"


@dataclass
class CameraAnalysis:
    """Parsed camera analysis result."""

    summary: str = ""
    tags: list[str] = field(default_factory=list)
    scene_type: str = "other"
    detail: str = ""
    timestamp: str = ""


async def analyze_camera_frame(
    *,
    api_key: str,
    provider: str = "openai",
    base_url: str = "",
    model: str,
    frame_png: bytes,
) -> CameraAnalysis:
    """Analyze one camera frame and return a structured summary."""

    normalized_provider = normalize_provider(provider)
    resized_png = _resize_frame_png(frame_png, max_long_edge=_MAX_IMAGE_LONG_EDGE)

    payload = await _post_camera_analysis(
        api_key=api_key,
        provider=normalized_provider,
        base_url=base_url,
        model=model,
        image_pngs=[resized_png],
        max_completion_tokens=_MAX_COMPLETION_TOKENS,
    )

    usage = payload.get("usage", {})
    if normalized_provider == "ollama":
        usage = {
            "prompt_eval_count": payload.get("prompt_eval_count"),
            "eval_count": payload.get("eval_count"),
        }
    logger.info("Camera analysis API usage: %s", usage)

    content = extract_chat_response_text(normalized_provider, payload)
    finish_reason = extract_chat_finish_reason(normalized_provider, payload)
    reasoning = ""
    if normalized_provider == "openai":
        choice = payload.get("choices", [{}])[0]
        message = choice.get("message", {})
        reasoning = _normalize_chat_content(message.get("reasoning_content"))

    logger.info(
        "Camera analysis finished: provider=%s finish_reason=%s content_length=%d reasoning_length=%d max_completion_tokens=%d content=%s",
        normalized_provider,
        finish_reason,
        len(content),
        len(reasoning),
        _MAX_COMPLETION_TOKENS,
        content[:200],
    )

    if content:
        return _parse_analysis(content)

    if finish_reason == "length":
        raise Exception("Camera analysis response was truncated before text was returned.")

    raise Exception("Camera analysis response was empty.")


async def _post_camera_analysis(
    *,
    api_key: str,
    provider: str,
    base_url: str,
    model: str,
    image_pngs: list[bytes],
    max_completion_tokens: int,
) -> dict[str, Any]:
    request = build_vision_chat_request(
        provider=provider,
        api_key=api_key,
        model=model,
        base_url=base_url,
        system_prompt=_SYSTEM_PROMPT,
        user_text=_USER_PROMPT,
        image_pngs=image_pngs,
        max_completion_tokens=max_completion_tokens,
    )

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            request.url,
            headers=request.headers,
            json=request.body,
        )

    if not resp.is_success:
        detail = resp.text[:200]
        raise Exception(f"Camera analysis failed: {resp.status_code} - {detail}")

    return resp.json()


def _normalize_chat_content(content: Any) -> str:
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return ""

    parts: list[str] = []
    for part in content:
        if isinstance(part, str):
            parts.append(part)
            continue
        if isinstance(part, dict):
            text = part.get("text")
            if isinstance(text, str):
                parts.append(text)

    return "\n".join(parts)


def _resize_frame_png(frame_png: bytes, *, max_long_edge: int) -> bytes:
    """Shrink large camera frames before upload to keep vision requests responsive."""

    frame_array = np.frombuffer(frame_png, dtype=np.uint8)
    frame = cv2.imdecode(frame_array, cv2.IMREAD_COLOR)
    if frame is None:
        logger.warning("Failed to decode camera frame; sending original image")
        return frame_png

    height, width = frame.shape[:2]
    long_edge = max(height, width)
    if long_edge <= max_long_edge:
        return frame_png

    scale = max_long_edge / long_edge
    resized = cv2.resize(
        frame,
        (max(1, int(round(width * scale))), max(1, int(round(height * scale)))),
        interpolation=cv2.INTER_AREA,
    )
    success, encoded = cv2.imencode(".png", resized)
    if not success:
        logger.warning("Failed to encode resized camera frame; sending original image")
        return frame_png

    return encoded.tobytes()


def _parse_analysis(raw: str) -> CameraAnalysis:
    """Parse the AI JSON payload into CameraAnalysis."""

    now = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [line for line in lines if not line.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        data = json.loads(cleaned)
        return CameraAnalysis(
            summary=data.get("summary", ""),
            tags=data.get("tags", []),
            scene_type=data.get("scene_type", "other"),
            detail=data.get("detail", ""),
            timestamp=now,
        )
    except json.JSONDecodeError:
        logger.warning("Camera analysis JSON parse failed: %s", raw[:200])
        return CameraAnalysis(
            summary=raw[:50] if raw else "分析失敗",
            timestamp=now,
        )
