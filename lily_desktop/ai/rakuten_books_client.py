"""Rakuten Books API client for talk-seed book candidates."""

from __future__ import annotations

import html
import logging
import random
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
_CACHE_TTL = timedelta(hours=6)
_MIN_DESCRIPTION_LENGTH = 12
_BOOKS_SEARCH_URL = "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404"
_BR_TAG_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class BookTalkCandidate:
    title: str
    author: str
    isbn: str
    description: str
    item_url: str
    genre_name: str
    rank: int


@dataclass(frozen=True)
class BookProfile:
    genre_name: str
    books_genre_id: str
    title_filter: str = ""


DEFAULT_BOOK_PROFILES: tuple[BookProfile, ...] = (
    BookProfile("自己啓発", "001006009"),
    BookProfile("習慣", "001006009", "習慣"),
    BookProfile("心理学", "001008003"),
    BookProfile("仕事術", "001006", "仕事術"),
    BookProfile("健康", "001010010"),
    BookProfile("小説", "001004"),
)


class RakutenBooksClient:
    """Fetches and caches book candidates from Rakuten Books."""

    def __init__(
        self,
        *,
        application_id: str,
        access_key: str,
        origin: str = "",
    ):
        self._application_id = application_id
        self._access_key = access_key
        self._origin = origin
        self._cache: dict[str, tuple[datetime, list[BookTalkCandidate]]] = {}

    async def fetch_all_profile_candidates(self) -> dict[str, list[BookTalkCandidate]]:
        results: dict[str, list[BookTalkCandidate]] = {}
        for profile in DEFAULT_BOOK_PROFILES:
            results[profile.genre_name] = await self.fetch_profile_candidates(
                genre_name=profile.genre_name,
                books_genre_id=profile.books_genre_id,
                title_filter=profile.title_filter,
            )
        return results

    async def fetch_random_profile_candidates(self) -> tuple[str, list[BookTalkCandidate]]:
        profile = random.choice(DEFAULT_BOOK_PROFILES)
        candidates = await self.fetch_profile_candidates(
            genre_name=profile.genre_name,
            books_genre_id=profile.books_genre_id,
            title_filter=profile.title_filter,
        )
        return profile.genre_name, candidates

    async def fetch_profile_candidates(
        self,
        *,
        genre_name: str,
        books_genre_id: str,
        title_filter: str = "",
    ) -> list[BookTalkCandidate]:
        if not self._application_id or not self._access_key:
            logger.info("楽天Books の認証情報が未設定のため、本カテゴリは無効化します")
            return []

        cache_key = f"{genre_name}:{books_genre_id}:{title_filter}"
        cached = self._cache.get(cache_key)
        now = datetime.now(JST)
        if cached and now - cached[0] < _CACHE_TTL:
            return list(cached[1])

        params: dict[str, Any] = {
            "applicationId": self._application_id,
            "accessKey": self._access_key,
            "format": "json",
            "formatVersion": 2,
            "booksGenreId": books_genre_id,
            "hits": 20,
            "page": 1,
            "availability": 1,
            "sort": "sales",
        }
        if title_filter:
            params["title"] = title_filter

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                headers = {"Origin": self._origin} if self._origin else None
                response = await client.get(
                    _BOOKS_SEARCH_URL,
                    params=params,
                    headers=headers,
                )
        except Exception:
            logger.warning("楽天Books API への接続に失敗しました: genre=%s", genre_name, exc_info=True)
            return []

        if not response.is_success:
            logger.warning(
                "楽天Books API エラー: status=%s genre=%s body=%s",
                response.status_code,
                genre_name,
                (response.text or "")[:200],
            )
            return []

        payload = response.json()
        items = payload.get("items") or payload.get("Items") or []
        seen_isbns: set[str] = set()
        candidates: list[BookTalkCandidate] = []

        for rank, raw_item in enumerate(items, start=1):
            item = raw_item.get("Item", raw_item) if isinstance(raw_item, dict) else {}
            if not isinstance(item, dict):
                continue

            isbn = str(item.get("isbn") or "").strip()
            title = str(item.get("title") or "").strip()
            description = self._normalize_description(item.get("itemCaption"))
            if not isbn or not title or not description:
                continue
            if isbn in seen_isbns:
                continue

            seen_isbns.add(isbn)
            candidates.append(
                BookTalkCandidate(
                    title=title,
                    author=str(item.get("author") or "").strip(),
                    isbn=isbn,
                    description=description,
                    item_url=str(item.get("itemUrl") or "").strip(),
                    genre_name=genre_name,
                    rank=rank,
                )
            )

        self._cache[cache_key] = (now, candidates)
        return list(candidates)

    @staticmethod
    def _normalize_description(raw: Any) -> str:
        if not isinstance(raw, str):
            return ""

        text = _BR_TAG_RE.sub(" ", raw)
        text = _HTML_TAG_RE.sub(" ", text)
        text = html.unescape(text)
        text = _WHITESPACE_RE.sub(" ", text).strip()
        if len(text) < _MIN_DESCRIPTION_LENGTH:
            return ""
        return text
