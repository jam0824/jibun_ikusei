"""保存記事の本文を取得して雑談向けに要約するモジュール。

スクラップ記事には本文が保存されていないため、おしゃべり時に記事 URL へ
アクセスして本文を取得し、LLM で短く要約する。取得・要約に失敗した場合は
ok=False を返し、呼び出し側で別のネタへフォールバックする。
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import httpx

from ai.provider_chat import (
    build_text_chat_request,
    extract_chat_finish_reason,
    extract_chat_response_text,
    normalize_provider,
)

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT_SECONDS = 15.0
_MAX_BODY_CHARS = 4000          # LLM へ渡す本文の最大文字数
_MIN_BODY_CHARS = 80           # これ未満は本文として薄すぎると判断
_MAX_COMPLETION_TOKENS = 220
_USER_AGENT = "LilyDesktop/1.0 (contact: lily-desktop@example.com)"

_SYSTEM_PROMPT = (
    "あなたはWeb記事を短く要約するアシスタントです。"
    "渡された記事本文だけを見て、日本語の自然文1〜2文で内容を要約してください。"
    "出力は要約テキストのみとし、前置きや箇条書きや見出しは不要です。"
    "本文に書かれていない情報の推測は避けてください。"
)

# <script> / <style> ブロックごと除去するための正規表現
_SCRIPT_STYLE_RE = re.compile(
    r"<(script|style)[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")


@dataclass
class ArticleSummary:
    """記事本文の要約結果。"""

    summary: str = ""
    ok: bool = False


def _extract_text_from_html(html: str, *, max_chars: int = _MAX_BODY_CHARS) -> str:
    """HTML から雑談向けの粗いプレーンテキストを抽出する。

    重い依存（BeautifulSoup 等）は使わず、<script>/<style> を除去し、
    残りのタグをストリップして連続空白を畳み、先頭 max_chars 文字に切り詰める。
    """
    if not html:
        return ""

    without_blocks = _SCRIPT_STYLE_RE.sub(" ", html)
    without_tags = _TAG_RE.sub(" ", without_blocks)
    collapsed = _WHITESPACE_RE.sub(" ", without_tags).strip()
    return collapsed[:max_chars]


async def _fetch_html(url: str) -> str:
    """記事 URL の HTML を取得する。失敗時は空文字を返す。"""
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": _USER_AGENT})
    if not resp.is_success:
        logger.info("記事本文の取得に失敗: %d %s", resp.status_code, url)
        return ""
    return resp.text


async def _summarize_text(
    *,
    text: str,
    title: str,
    openai_api_key: str,
    provider: str,
    base_url: str,
    model: str,
) -> str:
    """記事本文を LLM で短く要約する。"""
    user_text = (
        (f"記事タイトル: {title}\n\n" if title else "")
        + f"記事本文:\n{text}"
    )
    request = build_text_chat_request(
        provider=normalize_provider(provider, default="ollama"),
        api_key=openai_api_key,
        model=model,
        base_url=base_url,
        system_prompt=_SYSTEM_PROMPT,
        user_text=user_text,
        max_completion_tokens=_MAX_COMPLETION_TOKENS,
    )
    if request.body.get("stream") is False:
        request.body["think"] = False
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_SECONDS * 2) as client:
        resp = await client.post(
            request.url,
            headers=request.headers,
            json=request.body,
        )
    if not resp.is_success:
        raise RuntimeError(f"article summary failed: {resp.status_code}")
    payload = resp.json()
    if extract_chat_finish_reason(provider, payload) == "length":
        raise RuntimeError("article summary response was truncated")
    return extract_chat_response_text(provider, payload).strip()


async def fetch_article_summary(
    *,
    url: str,
    openai_api_key: str,
    provider: str,
    base_url: str,
    model: str,
    title: str = "",
) -> ArticleSummary:
    """記事 URL の本文を取得して要約する。失敗時は ok=False を返す。"""
    try:
        html = await _fetch_html(url)
        body = _extract_text_from_html(html)
        if len(body) < _MIN_BODY_CHARS:
            logger.info("記事本文が薄いためスキップ: chars=%d url=%s", len(body), url)
            return ArticleSummary(ok=False)

        summary = await _summarize_text(
            text=body,
            title=title,
            openai_api_key=openai_api_key,
            provider=provider,
            base_url=base_url,
            model=model,
        )
        if not summary:
            return ArticleSummary(ok=False)
        return ArticleSummary(summary=summary, ok=True)
    except Exception:
        logger.exception("記事本文の取得・要約に失敗: %s", url)
        return ArticleSummary(ok=False)
