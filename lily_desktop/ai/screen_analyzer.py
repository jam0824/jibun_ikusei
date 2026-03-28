"""スクリーンショット解析 — GPT Vision で状況要約と話題タグを生成する"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass, field
from datetime import datetime

import httpx

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
あなたはデスクトップの状況を分析するアシスタントです。
スクリーンショットを見て、ユーザーが今何をしているかを要約してください。

以下のJSON形式で回答してください。他の文章は不要です。
{
  "summary": "状況の要約（1〜2文、30文字以内）",
  "tags": ["話題タグ1", "話題タグ2"],
  "activity_type": "coding | reading | browsing | watching | gaming | chatting | idle | other",
  "detail": "もう少し詳しい状況説明（50文字以内）"
}

要約の例:
- 「コーディングしている」
- 「ドキュメントを読んでいる」
- 「調べものをしている」
- 「動画で休憩している」
- 「ゲームをプレイしている」
- 「しばらく操作が止まっている」

注意:
- 画面上の個人情報、パスワード、メッセージ内容は要約に含めないこと
- コードの具体的な内容は含めず、何の作業をしているかだけを要約すること
- ブラウザのURLやタブの中身をそのまま引用しないこと
"""


@dataclass
class ScreenAnalysis:
    """スクリーンショット解析結果"""
    summary: str = ""
    tags: list[str] = field(default_factory=list)
    activity_type: str = "other"
    detail: str = ""
    timestamp: str = ""
    source: str = "screenshot"


async def analyze_screenshot(
    *,
    api_key: str,
    model: str,
    screenshot_png: bytes,
    window_context: str = "",
) -> ScreenAnalysis:
    """スクリーンショットをGPT Visionで解析して状況要約を返す。

    Args:
        api_key: OpenAI APIキー
        model: 使用するモデル名 (例: "gpt-5.4")
        screenshot_png: PNG画像のバイト列
        window_context: アクティブウィンドウの補足情報（アプリ名等）

    Returns:
        ScreenAnalysis: 解析結果
    """
    b64_image = base64.b64encode(screenshot_png).decode("ascii")

    user_content: list[dict] = []
    if window_context:
        user_content.append({
            "type": "text",
            "text": f"アクティブウィンドウ情報: {window_context}",
        })
    user_content.append({
        "type": "text",
        "text": "このスクリーンショットからユーザーの現在の状況を要約してください。",
    })
    user_content.append({
        "type": "image_url",
        "image_url": {
            "url": f"data:image/png;base64,{b64_image}",
            "detail": "low",
        },
    })

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "max_completion_tokens": 300,
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
        raise Exception(f"Screen analysis failed: {resp.status_code} - {detail}")

    payload = resp.json()
    content = payload["choices"][0]["message"]["content"]

    return _parse_analysis(content)


def _parse_analysis(raw: str) -> ScreenAnalysis:
    """AIレスポンスをパースしてScreenAnalysisに変換する"""
    import json

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # JSON部分を抽出（```json ... ``` でラップされている場合にも対応）
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        # コードブロックを除去
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
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
        logger.warning("解析結果のパースに失敗: %s", raw[:200])
        return ScreenAnalysis(
            summary=raw[:50] if raw else "解析失敗",
            timestamp=now,
        )
