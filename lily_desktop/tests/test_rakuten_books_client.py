from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from unittest.mock import patch

import pytest

from ai.rakuten_books_client import (
    DEFAULT_BOOK_PROFILES,
    BookTalkCandidate,
    RakutenBooksClient,
)


class _FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = ""

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeAsyncClient:
    def __init__(self, responses: Sequence[_FakeResponse]):
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def get(
        self,
        url: str,
        params: dict[str, Any],
        headers: dict[str, Any] | None = None,
    ):
        self.calls.append({"url": url, "params": params, "headers": headers or {}})
        return self._responses.pop(0)


def _candidate_payload(items: list[dict[str, Any]]) -> dict[str, Any]:
    return {"Items": items, "count": len(items), "hits": len(items), "page": 1}


@pytest.mark.asyncio
async def test_fetch_profile_filters_and_normalizes_candidates():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                _candidate_payload(
                    [
                        {
                            "title": "習慣の本",
                            "author": "著者A",
                            "isbn": "111",
                            "itemCaption": "<b>毎日を整える</b><br/>小さな習慣の本です。",
                            "itemUrl": "https://example.com/1",
                        },
                        {
                            "title": "説明なし",
                            "author": "著者B",
                            "isbn": "222",
                            "itemCaption": "",
                            "itemUrl": "https://example.com/2",
                        },
                        {
                            "title": "短すぎる説明",
                            "author": "著者C",
                            "isbn": "333",
                            "itemCaption": "短い",
                            "itemUrl": "https://example.com/3",
                        },
                        {
                            "title": "重複ISBN",
                            "author": "著者D",
                            "isbn": "111",
                            "itemCaption": "同じISBNの別候補だけど落としたい説明文です。",
                            "itemUrl": "https://example.com/4",
                        },
                    ]
                )
            )
        ]
    )

    client = RakutenBooksClient(application_id="app", access_key="key")

    with patch("ai.rakuten_books_client.httpx.AsyncClient", return_value=fake_client):
        result = await client.fetch_profile_candidates(
            genre_name="習慣",
            books_genre_id="001006009",
            title_filter="習慣",
        )

    assert result == [
        BookTalkCandidate(
            title="習慣の本",
            author="著者A",
            isbn="111",
            description="毎日を整える 小さな習慣の本です。",
            item_url="https://example.com/1",
            genre_name="習慣",
            rank=1,
        )
    ]
    assert fake_client.calls[0]["params"]["hits"] == 20
    assert fake_client.calls[0]["params"]["sort"] == "sales"
    assert fake_client.calls[0]["params"]["formatVersion"] == 2


@pytest.mark.asyncio
async def test_fetch_profile_candidates_returns_empty_on_429():
    fake_client = _FakeAsyncClient([_FakeResponse({"error": "too_many_requests"}, status_code=429)])
    client = RakutenBooksClient(application_id="app", access_key="key")

    with patch("ai.rakuten_books_client.httpx.AsyncClient", return_value=fake_client):
        result = await client.fetch_profile_candidates(
            genre_name="健康",
            books_genre_id="001010010",
        )

    assert result == []


@pytest.mark.asyncio
async def test_fetch_profile_candidates_uses_ttl_cache():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                _candidate_payload(
                    [
                        {
                            "title": "キャッシュ対象",
                            "author": "著者A",
                            "isbn": "999",
                            "itemCaption": "十分に長い説明文でキャッシュ確認に使います。",
                            "itemUrl": "https://example.com/cache",
                        }
                    ]
                )
            )
        ]
    )
    client = RakutenBooksClient(application_id="app", access_key="key")

    with patch("ai.rakuten_books_client.httpx.AsyncClient", return_value=fake_client):
        first = await client.fetch_profile_candidates(
            genre_name="自己啓発",
            books_genre_id="001006009",
        )
        second = await client.fetch_profile_candidates(
            genre_name="自己啓発",
            books_genre_id="001006009",
        )

    assert len(fake_client.calls) == 1
    assert first == second


@pytest.mark.asyncio
async def test_fetch_random_profile_candidates_requests_only_one_profile():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                _candidate_payload(
                    [
                        {
                            "title": "習慣の本",
                            "author": "著者A",
                            "isbn": "111",
                            "itemCaption": "十分に長い説明文でランダムジャンル取得の確認に使います。",
                            "itemUrl": "https://example.com/1",
                        }
                    ]
                )
            )
        ]
    )
    client = RakutenBooksClient(application_id="app", access_key="key")

    with (
        patch("ai.rakuten_books_client.httpx.AsyncClient", return_value=fake_client),
        patch("ai.rakuten_books_client.random.choice", return_value=DEFAULT_BOOK_PROFILES[1]),
    ):
        genre_name, result = await client.fetch_random_profile_candidates()

    assert genre_name == "習慣"
    assert len(result) == 1
    assert len(fake_client.calls) == 1
    assert fake_client.calls[0]["params"]["booksGenreId"] == "001006009"
    assert fake_client.calls[0]["params"]["title"] == "習慣"


@pytest.mark.asyncio
async def test_fetch_profile_candidates_sends_origin_header_when_configured():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                _candidate_payload(
                    [
                        {
                            "title": "小説の本",
                            "author": "著者A",
                            "isbn": "111",
                            "itemCaption": "十分に長い説明文で Origin ヘッダー確認に使います。",
                            "itemUrl": "https://example.com/1",
                        }
                    ]
                )
            )
        ]
    )
    client = RakutenBooksClient(
        application_id="app",
        access_key="key",
        origin="https://jam0824.github.io",
    )

    with patch("ai.rakuten_books_client.httpx.AsyncClient", return_value=fake_client):
        await client.fetch_profile_candidates(
            genre_name="小説",
            books_genre_id="001004",
        )

    assert fake_client.calls[0]["headers"]["Origin"] == "https://jam0824.github.io"
