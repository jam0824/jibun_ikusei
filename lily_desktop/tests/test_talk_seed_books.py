from __future__ import annotations

from dataclasses import replace
from unittest.mock import AsyncMock

import pytest

from ai.rakuten_books_client import BookTalkCandidate
from ai.talk_seed import TalkSeedManager


def _make_candidate(**overrides) -> BookTalkCandidate:
    base = BookTalkCandidate(
        title="習慣の本",
        author="著者A",
        isbn="111",
        description="毎日を整える小さな習慣の本です。",
        item_url="https://example.com/book",
        genre_name="習慣",
        rank=1,
    )
    return replace(base, **overrides)


@pytest.mark.asyncio
async def test_collect_books_returns_empty_without_credentials():
    seed_manager = TalkSeedManager(
        openai_api_key="test-key",
        screen_analysis_model="screen-model",
    )

    seeds = await seed_manager._collect_books()

    assert seeds == []


@pytest.mark.asyncio
async def test_collect_books_builds_one_seed_from_random_profile(monkeypatch):
    seed_manager = TalkSeedManager(
        openai_api_key="test-key",
        screen_analysis_model="screen-model",
        rakuten_application_id="app",
        rakuten_access_key="key",
    )
    monkeypatch.setattr(
        seed_manager._rakuten_client,
        "fetch_random_profile_candidates",
        AsyncMock(
            return_value=(
                "習慣",
                [
                    _make_candidate(),
                    _make_candidate(title="習慣の本2", isbn="222", rank=5),
                ],
            )
        ),
    )

    seeds = await seed_manager._collect_books()

    assert len(seeds) == 1
    assert seeds[0].source == "books"
    assert seeds[0].tags[:3] == ["本", "習慣", "売れ筋"]
    assert seeds[0]._source_key in {"books:111", "books:222"}
    assert "楽天Books売れ筋の本" in seeds[0].summary


@pytest.mark.asyncio
async def test_collect_books_returns_empty_when_random_profile_has_no_candidate(monkeypatch):
    seed_manager = TalkSeedManager(
        openai_api_key="test-key",
        screen_analysis_model="screen-model",
        rakuten_application_id="app",
        rakuten_access_key="key",
    )
    monkeypatch.setattr(
        seed_manager._rakuten_client,
        "fetch_random_profile_candidates",
        AsyncMock(return_value=("自己啓発", [])),
    )

    seeds = await seed_manager._collect_books()

    assert seeds == []
