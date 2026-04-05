"""Wikimedia Feed API クライアント — 今日の注目記事・今日は何の日・興味ある分野を取得"""

from __future__ import annotations

import logging
import random
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

_BASE_URL = "https://api.wikimedia.org/feed/v1/wikipedia"

# 重い話題を除外するためのキーワード
_EXCLUDE_KEYWORDS = re.compile(
    r"事件|事故|戦争|虐殺|テロ|殺人|死刑|処刑|侵攻|紛争|暗殺|災害|飢饉",
    re.IGNORECASE,
)

_INTEREST_TOPIC_EXPANSIONS: dict[str, list[str]] = {
    "科学": [
        "物理学",
        "化学",
        "生物学",
        "天文学",
        "科学史",
        "発明",
        "科学者",
    ],
    "オカルト": [
        "超常現象",
        "未確認生物",
        "UFO",
        "都市伝説",
        "心霊現象",
        "民間伝承",
        "神秘主義",
    ],
    "宇宙": [
        "惑星",
        "恒星",
        "銀河",
        "ブラックホール",
        "宇宙飛行士",
        "宇宙探査",
        "ロケット",
    ],
}


@dataclass
class WikimediaArticle:
    """Wikimedia から取得した記事情報"""
    title: str = ""
    extract: str = ""       # 記事の抜粋
    source: str = "wikimedia"
    article_type: str = ""  # "featured" | "onthisday" | "mostread"
    topic: str = ""         # 興味ある分野の元トピック
    search_term: str = ""   # 実際に検索した語


async def fetch_featured_content(language: str = "ja") -> list[WikimediaArticle]:
    """今日の注目記事・今日は何の日を取得する。

    Args:
        language: Wikipedia の言語コード (デフォルト: "ja")

    Returns:
        WikimediaArticle のリスト。取得失敗時は空リスト。
    """
    now = datetime.now(JST)
    url = f"{_BASE_URL}/{language}/featured/{now.year}/{now.month:02d}/{now.day:02d}"

    articles: list[WikimediaArticle] = []

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                url,
                headers={"User-Agent": "LilyDesktop/1.0 (contact: lily-desktop@example.com)"},
            )

        if not resp.is_success:
            logger.warning("Wikimedia API エラー: %d %s", resp.status_code, resp.text[:200])
            return []

        data = resp.json()

        # 今日の注目記事 (Today's Featured Article)
        tfa = data.get("tfa")
        if tfa:
            title = tfa.get("titles", {}).get("normalized", tfa.get("title", ""))
            extract = tfa.get("extract", "")
            if not _is_excluded(title, extract):
                articles.append(WikimediaArticle(
                    title=title,
                    extract=extract[:200],
                    article_type="featured",
                ))

        # 今日は何の日 (On This Day)
        onthisday = data.get("onthisday", [])
        for event in onthisday[:8]:  # 最大8件
            text = event.get("text", "")
            if _is_excluded(text, ""):
                continue
            # 関連記事のタイトルを取得
            pages = event.get("pages", [])
            title = pages[0].get("titles", {}).get("normalized", "") if pages else ""
            articles.append(WikimediaArticle(
                title=title or text[:30],
                extract=text[:200],
                article_type="onthisday",
            ))

        # 最も読まれた記事 (Most Read)
        mostread = data.get("mostread", {}).get("articles", [])
        for article in mostread[:3]:  # 最大3件
            title = article.get("titles", {}).get("normalized", article.get("title", ""))
            extract = article.get("extract", "")
            if _is_excluded(title, extract):
                continue
            articles.append(WikimediaArticle(
                title=title,
                extract=extract[:200],
                article_type="mostread",
            ))

    except Exception:
        logger.exception("Wikimedia Feed API の取得に失敗")

    logger.info("Wikimedia: %d 件の記事を取得", len(articles))
    return articles


async def fetch_interest_articles(
    topics: list[str],
    language: str = "ja",
) -> list[WikimediaArticle]:
    """興味ある分野のトピックごとにWikipedia記事をランダム取得する。

    広いトピックは関連するサブトピックへ展開し、集めた候補から1件選ぶ。

    Args:
        topics: 興味ある分野のキーワードリスト（例: ["科学", "オカルト", "宇宙"]）
        language: Wikipedia の言語コード (デフォルト: "ja")

    Returns:
        WikimediaArticle のリスト（トピックごとに最大1件）。
    """
    if not topics:
        return []

    articles: list[WikimediaArticle] = []

    async with httpx.AsyncClient(timeout=15.0) as client:
        for topic in topics:
            try:
                search_terms = _expand_interest_search_terms(topic)
                candidates: list[WikimediaArticle] = []
                seen_titles: set[str] = set()

                for search_term in search_terms:
                    valid = await _search_interest_pages(
                        client=client,
                        search_term=search_term,
                        language=language,
                    )
                    for page in valid:
                        title = page.get("title", "")
                        normalized = _normalize_article_title(title)
                        if not normalized or normalized in seen_titles:
                            continue
                        seen_titles.add(normalized)
                        candidates.append(
                            WikimediaArticle(
                                title=title,
                                extract=page.get("extract", "")[:200],
                                article_type="interest",
                                topic=topic,
                                search_term=search_term,
                            )
                        )

                if not candidates and topic not in search_terms:
                    fallback_pages = await _search_interest_pages(
                        client=client,
                        search_term=topic,
                        language=language,
                    )
                    for page in fallback_pages:
                        title = page.get("title", "")
                        normalized = _normalize_article_title(title)
                        if not normalized or normalized in seen_titles:
                            continue
                        seen_titles.add(normalized)
                        candidates.append(
                            WikimediaArticle(
                                title=title,
                                extract=page.get("extract", "")[:200],
                                article_type="interest",
                                topic=topic,
                                search_term=topic,
                            )
                        )

                if not candidates:
                    continue

                articles.append(random.choice(candidates))
            except Exception:
                logger.exception("興味ある分野の取得に失敗: %s", topic)

    logger.info("Wikimedia interest: %d 件の記事を取得 (topics=%s)", len(articles), topics)
    return articles


def _is_excluded(title: str, extract: str) -> bool:
    """重い話題かどうかを判定する"""
    combined = f"{title} {extract}"
    return bool(_EXCLUDE_KEYWORDS.search(combined))


def _expand_interest_search_terms(topic: str) -> list[str]:
    """広い興味トピックを、より多様な関連サブトピックへ展開する。"""
    expanded = _INTEREST_TOPIC_EXPANSIONS.get(topic.strip())
    if not expanded:
        return [topic]
    return list(dict.fromkeys(expanded))


def _normalize_article_title(title: str) -> str:
    return re.sub(r"\s+", " ", title).strip().casefold()


async def _search_interest_pages(
    *,
    client: httpx.AsyncClient,
    search_term: str,
    language: str,
) -> list[dict]:
    resp = await client.get(
        f"https://{language}.wikipedia.org/w/api.php",
        params={
            "action": "query",
            "generator": "search",
            "gsrsearch": search_term,
            "gsrlimit": 5,
            "prop": "extracts",
            "exintro": 1,
            "explaintext": 1,
            "exlimit": 5,
            "format": "json",
            "utf8": 1,
        },
        headers={"User-Agent": "LilyDesktop/1.0 (contact: lily-desktop@example.com)"},
    )
    if not resp.is_success:
        logger.warning("Wikipedia Search API エラー (%s): %d", search_term, resp.status_code)
        return []

    data = resp.json()
    pages = list(data.get("query", {}).get("pages", {}).values())
    return [
        page for page in pages
        if not _is_excluded(page.get("title", ""), page.get("extract", ""))
    ]
