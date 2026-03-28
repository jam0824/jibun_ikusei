"""Annict API クライアント — 季節アニメ・人気作品を取得"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

_BASE_URL = "https://api.annict.com"

# 月→シーズン対応
_SEASON_MAP = {
    1: "winter", 2: "winter", 3: "winter",
    4: "spring", 5: "spring", 6: "spring",
    7: "summer", 8: "summer", 9: "summer",
    10: "autumn", 11: "autumn", 12: "autumn",
}


@dataclass
class AnnictWork:
    """Annict から取得したアニメ作品情報"""
    title: str = ""
    media_type: str = ""       # tv, ova, movie, web, other
    watchers_count: int = 0
    season_name: str = ""      # "2026-spring" etc
    official_site_url: str = ""
    source: str = "annict"


async def fetch_seasonal_works(
    *,
    access_token: str,
    season: str | None = None,
    per_page: int = 10,
) -> list[AnnictWork]:
    """今期の人気アニメ作品を取得する。

    Args:
        access_token: Annict のパーソナルアクセストークン
        season: シーズン文字列 (例: "2026-spring")。None なら現在のシーズン。
        per_page: 取得件数（最大50）

    Returns:
        AnnictWork のリスト。取得失敗時は空リスト。
    """
    if not access_token:
        logger.warning("Annict アクセストークンが未設定です")
        return []

    if season is None:
        season = _current_season()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{_BASE_URL}/v1/works",
                headers={"Authorization": f"Bearer {access_token}"},
                params={
                    "filter_season": season,
                    "sort_watchers_count": "desc",
                    "per_page": per_page,
                },
            )

        if not resp.is_success:
            logger.warning("Annict API エラー: %d %s", resp.status_code, resp.text[:200])
            return []

        data = resp.json()
        works: list[AnnictWork] = []

        for w in data.get("works", []):
            works.append(AnnictWork(
                title=w.get("title", ""),
                media_type=w.get("media_type", ""),
                watchers_count=w.get("watchers_count", 0),
                season_name=w.get("season_name_text", season),
                official_site_url=w.get("official_site_url", ""),
            ))

        logger.info("Annict: %d 件の作品を取得 (season=%s)", len(works), season)
        return works

    except Exception:
        logger.exception("Annict API の取得に失敗")
        return []


def _current_season() -> str:
    """現在のシーズン文字列を返す (例: "2026-spring")"""
    now = datetime.now(JST)
    season = _SEASON_MAP[now.month]
    return f"{now.year}-{season}"
