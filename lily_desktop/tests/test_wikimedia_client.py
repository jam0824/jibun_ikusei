from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from ai.wikimedia_client import (
    WikimediaArticle,
    _expand_interest_search_terms,
    fetch_interest_articles,
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
    def __init__(self, payloads_by_term: dict[str, dict[str, Any]]):
        self._payloads_by_term = payloads_by_term
        self.calls: list[str] = []

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def get(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> _FakeResponse:
        assert params is not None
        term = str(params["gsrsearch"])
        self.calls.append(term)
        payload = self._payloads_by_term.get(term, {"query": {"pages": {}}})
        return _FakeResponse(payload)


def _page(title: str, extract: str) -> dict[str, str]:
    return {
        "title": title,
        "extract": extract,
    }


def test_expand_interest_search_terms_広いテーマは多様なサブトピックへ展開される():
    terms = _expand_interest_search_terms("科学")

    assert "物理学" in terms
    assert "化学" in terms
    assert "生物学" in terms
    assert "天文学" in terms
    assert "科学" not in terms


def test_expand_interest_search_terms_未知のテーマはそのまま使う():
    assert _expand_interest_search_terms("鉱物") == ["鉱物"]


@pytest.mark.asyncio
async def test_fetch_interest_articles_展開した複数サブトピックから候補を集める():
    fake_client = _FakeAsyncClient(
        {
            "物理学": {"query": {"pages": {"1": _page("量子力学", "量子力学はミクロの世界を扱う。")}}},
            "化学": {"query": {"pages": {"2": _page("触媒", "触媒は化学反応を助ける。")}}},
            "生物学": {"query": {"pages": {"3": _page("細胞", "細胞は生命の基本単位。")}}},
        }
    )

    with (
        patch("ai.wikimedia_client.httpx.AsyncClient", return_value=fake_client),
        patch("ai.wikimedia_client.random.choice", side_effect=lambda items: items[-1]),
    ):
        articles = await fetch_interest_articles(["科学"])

    assert fake_client.calls[:3] == ["物理学", "化学", "生物学"]
    assert len(articles) == 1
    assert articles[0] == WikimediaArticle(
        title="細胞",
        extract="細胞は生命の基本単位。",
        article_type="interest",
        topic="科学",
        search_term="生物学",
    )
