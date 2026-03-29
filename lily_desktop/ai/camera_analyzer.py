"""カメラ画像分析 — GPT Vision で外の状況を要約する"""

from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

_SYSTEM_PROMPT = """\
あなたはカメラ画像を分析するアシスタントです。
カメラの映像から、外の状況や周囲で何が起きているかを要約してください。

以下のJSON形式で回答してください。他の文章は不要です。
{
  "summary": "状況の要約（1〜2文、40文字以内）",
  "tags": ["話題タグ1", "話題タグ2"],
  "scene_type": "outdoor | indoor | weather | people | animal | quiet | other",
  "detail": "もう少し詳しい状況説明（60文字以内）"
}

要約の例:
- 「外は晴れていて明るい」
- 「雨が降っている」
- 「外が暗くなってきた」
- 「人が通りかかった」
- 「猫がいる」
- 「特に変化なし」

注意:
- 個人を特定できる情報（顔、車のナンバーなど）は含めないこと
- 状況を客観的に要約すること
"""


@dataclass
class CameraAnalysis:
    """カメラ画像分析結果"""
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
    """カメラ画像をGPT Visionで分析して状況要約を返す。

    Args:
        api_key: OpenAI APIキー
        model: 使用するモデル名 (例: "gpt-5")
        frame_png: PNG画像のバイト列

    Returns:
        CameraAnalysis: 分析結果
    """
    b64_image = base64.b64encode(frame_png).decode("ascii")

    user_content: list[dict] = [
        {
            "type": "text",
            "text": "このカメラ画像から、外の状況や周囲で何が起きているかを要約してください。",
        },
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{b64_image}",
                "detail": "low",
            },
        },
    ]

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "max_completion_tokens": 4096,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
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

    payload = resp.json()
    # usage情報をログ出力（推論トークン消費の確認）
    usage = payload.get("usage", {})
    logger.info("カメラ分析API usage: %s", usage)

    choice = payload["choices"][0]
    content = choice["message"]["content"] or ""
    finish_reason = choice.get("finish_reason", "unknown")
    # 推論モデルの場合 reasoning_content がある可能性
    reasoning = choice["message"].get("reasoning_content", "")
    logger.info("カメラ分析API応答: finish_reason=%s content_length=%d reasoning_length=%d content=%s",
                finish_reason, len(content), len(reasoning) if reasoning else 0, content[:200])

    return _parse_analysis(content)


def _parse_analysis(raw: str) -> CameraAnalysis:
    """AIレスポンスをパースしてCameraAnalysisに変換する"""
    now = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
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
