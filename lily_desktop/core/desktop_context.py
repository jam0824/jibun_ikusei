"""デスクトップ状況コンテキスト — アクティブウィンドウ確認→スクリーンショット→解析を統括"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from ai.screen_analyzer import ScreenAnalysis, analyze_screenshot
from core.active_window import ActiveWindowInfo, capture_screenshot, get_active_window_info

logger = logging.getLogger(__name__)


@dataclass
class DesktopContext:
    """デスクトップ状況の取得結果"""
    window_info: ActiveWindowInfo = field(default_factory=ActiveWindowInfo)
    analysis: ScreenAnalysis | None = None
    skipped: bool = False        # 解析対象外でスキップしたか
    error: str = ""


async def fetch_desktop_context(
    *,
    api_key: str,
    provider: str = "openai",
    base_url: str = "",
    model: str,
) -> DesktopContext:
    """デスクトップの現在の状況を取得・解析する。

    1. アクティブウィンドウ情報を取得
    2. 解析対象外ならスキップ
    3. スクリーンショットを取得
    4. GPT Vision で解析
    """
    ctx = DesktopContext()

    # 1. アクティブウィンドウ情報
    ctx.window_info = get_active_window_info()
    logger.info(
        "アクティブウィンドウ: app=%s title=%s domain=%s excluded=%s reason=%s",
        ctx.window_info.app_name,
        ctx.window_info.window_title[:60],
        ctx.window_info.domain,
        ctx.window_info.is_excluded,
        ctx.window_info.exclude_reason,
    )

    # 2. 除外判定
    if ctx.window_info.is_excluded:
        ctx.skipped = True
        logger.info("解析対象外のためスキップ: %s", ctx.window_info.exclude_reason)
        return ctx

    # 3. スクリーンショット
    screenshot = capture_screenshot()
    if screenshot is None:
        ctx.error = "スクリーンショットの取得に失敗"
        logger.warning(ctx.error)
        return ctx

    # 4. GPT Vision で解析
    window_context = _build_window_context(ctx.window_info)
    try:
        ctx.analysis = await analyze_screenshot(
            api_key=api_key,
            provider=provider,
            base_url=base_url,
            model=model,
            screenshot_png=screenshot,
            window_context=window_context,
        )
        logger.info(
            "状況解析完了: summary=%s tags=%s activity=%s detail=%s",
            ctx.analysis.summary,
            ctx.analysis.tags,
            ctx.analysis.activity_type,
            ctx.analysis.detail,
        )
    except Exception as e:
        ctx.error = f"スクリーンショット解析に失敗: {e}"
        logger.exception(ctx.error)

    return ctx


def _build_window_context(info: ActiveWindowInfo) -> str:
    """解析AIに渡すウィンドウ補足情報を構築する"""
    parts = []
    if info.app_name:
        parts.append(f"アプリ: {info.app_name}")
    if info.is_browser and info.domain:
        parts.append(f"ドメイン: {info.domain}")
    elif info.window_title:
        # ブラウザ以外はタイトルも渡す（個人情報が少ないアプリの場合）
        parts.append(f"タイトル: {info.window_title[:80]}")
    return ", ".join(parts)


def format_context_log(ctx: DesktopContext) -> str:
    """デバッグ用にDesktopContextの要約を人間可読な文字列で返す"""
    lines = [
        "=== デスクトップ状況 ===",
        f"アプリ: {ctx.window_info.app_name}",
        f"タイトル: {ctx.window_info.window_title[:80]}",
    ]
    if ctx.window_info.is_browser:
        lines.append(f"ドメイン: {ctx.window_info.domain}")
    if ctx.skipped:
        lines.append(f"スキップ: {ctx.window_info.exclude_reason}")
    elif ctx.error:
        lines.append(f"エラー: {ctx.error}")
    elif ctx.analysis:
        lines.append(f"要約: {ctx.analysis.summary}")
        lines.append(f"タグ: {', '.join(ctx.analysis.tags)}")
        lines.append(f"種別: {ctx.analysis.activity_type}")
        lines.append(f"詳細: {ctx.analysis.detail}")
        lines.append(f"時刻: {ctx.analysis.timestamp}")
    return "\n".join(lines)
