"""Camera image analysis via OpenAI vision."""

from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import cv2
import httpx
import numpy as np

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
_MAX_IMAGE_LONG_EDGE = 512
_HTTP_TIMEOUT_SECONDS = 45.0
_MAX_COMPLETION_TOKENS = 900

_SYSTEM_PROMPT = """\
あなたはカメラ画像を分析するアシスタントです。
カメラ画像の情報から、人がどこで何をしているか、また周囲の状況を分析してください。

以下の JSON 形式だけで返してください。説明文は不要です。
{
  "summary": "状況の要約。日本語で0〜80文字",
  "tags": ["特徴タグ1", "特徴タグ2"],
  "scene_type": "outdoor | indoor | weather | people | animal | quiet | other",
  "detail": "もう少し詳しい説明。日本語で0〜150文字"
}

分析の方針:
- 嘘や決めつけは避ける
- 曖昧なら曖昧とする
- 見えていない情報は推測しすぎない
- 人物は特定しない
- 健康や感情は断定しない
- 音は聞こえない

要点:
- 状況を簡潔明瞭に分析すること
"""


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
    model: str,
    frame_png: bytes,
) -> CameraAnalysis:
    """Analyze one camera frame and return a structured summary."""

    resized_png = _resize_frame_png(frame_png, max_long_edge=_MAX_IMAGE_LONG_EDGE)
    b64_image = base64.b64encode(resized_png).decode("ascii")

    user_content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": "このカメラ画像から、周囲の状況や人の行動を日本語で分析してください。",
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{b64_image}",
                "detail": "low",
            },
        },
    ]

    # Use a single bounded request to avoid stacking billed retries.
    payload = await _post_camera_analysis(
        api_key=api_key,
        model=model,
        user_content=user_content,
        max_completion_tokens=_MAX_COMPLETION_TOKENS,
    )

    usage = payload.get("usage", {})
    logger.info("カメラ分析API usage: %s", usage)

    choice = payload.get("choices", [{}])[0]
    message = choice.get("message", {})
    content = _normalize_chat_content(message.get("content"))
    finish_reason = choice.get("finish_reason", "unknown")
    reasoning = _normalize_chat_content(message.get("reasoning_content"))
    logger.info(
        "カメラ分析API応答: finish_reason=%s content_length=%d reasoning_length=%d max_completion_tokens=%d content=%s",
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
    model: str,
    user_content: list[dict[str, Any]],
    max_completion_tokens: int,
) -> dict[str, Any]:
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "max_completion_tokens": max_completion_tokens,
    }

    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json=body,
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
        logger.warning("カメラ分析結果のパースに失敗: %s", raw[:200])
        return CameraAnalysis(
            summary=raw[:50] if raw else "分析失敗",
            timestamp=now,
        )
