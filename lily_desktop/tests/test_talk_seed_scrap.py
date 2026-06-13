from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import ai.talk_seed as talk_seed_mod
from ai.article_fetcher import ArticleSummary
from ai.talk_seed import TalkSeedManager


def _make_manager(scraps: list[dict]) -> TalkSeedManager:
    api_client = SimpleNamespace(get_scraps=AsyncMock(return_value=scraps))
    return TalkSeedManager(
        openai_api_key="test",
        screen_analysis_model="dummy",
        desktop_analysis_provider="ollama",
        desktop_analysis_base_url="http://127.0.0.1:11434",
        api_client=api_client,
    )


@pytest.mark.asyncio
async def test_保存記事から本文要約を含む種を生成する(monkeypatch):
    async def _fake_summary(**kwargs):
        assert kwargs["url"] == "https://example.com/a"
        assert kwargs["title"] == "面白い記事"
        return ArticleSummary(summary="この記事はAIの未来について述べている。", ok=True)

    monkeypatch.setattr(talk_seed_mod, "fetch_article_summary", _fake_summary)

    manager = _make_manager([
        {
            "id": "s1",
            "url": "https://example.com/a",
            "title": "面白い記事",
            "domain": "example.com",
            "memo": "あとで読む",
            "status": "unread",
        }
    ])

    seeds = await manager._collect_scrap()

    assert len(seeds) == 1
    seed = seeds[0]
    assert seed.source == "scrap"
    assert "この記事はAIの未来について述べている。" in seed.summary
    assert "面白い記事" in seed.summary
    assert "記事" in seed.tags
    assert seed._source_key == "scrap:s1"


@pytest.mark.asyncio
async def test_読了やアーカイブの記事も対象になる(monkeypatch):
    async def _fake_summary(**kwargs):
        del kwargs
        return ArticleSummary(summary="読了済み記事の要約。", ok=True)

    monkeypatch.setattr(talk_seed_mod, "fetch_article_summary", _fake_summary)

    manager = _make_manager([
        {"id": "s9", "url": "https://example.com/old", "title": "昔の記事", "domain": "example.com", "status": "archived"}
    ])

    seeds = await manager._collect_scrap()

    assert len(seeds) == 1
    assert seeds[0].source == "scrap"


@pytest.mark.asyncio
async def test_本文取得に失敗した記事はスキップして空になる(monkeypatch):
    async def _fail_summary(**kwargs):
        del kwargs
        return ArticleSummary(ok=False)

    monkeypatch.setattr(talk_seed_mod, "fetch_article_summary", _fail_summary)

    manager = _make_manager([
        {"id": "s1", "url": "https://example.com/a", "title": "A", "domain": "example.com"},
        {"id": "s2", "url": "https://example.com/b", "title": "B", "domain": "example.com"},
    ])

    seeds = await manager._collect_scrap()

    assert seeds == []


@pytest.mark.asyncio
async def test_保存記事がゼロ件なら空を返す(monkeypatch):
    monkeypatch.setattr(
        talk_seed_mod, "fetch_article_summary",
        AsyncMock(side_effect=AssertionError("記事がないのに本文取得してはいけない")),
    )
    manager = _make_manager([])

    seeds = await manager._collect_scrap()

    assert seeds == []


@pytest.mark.asyncio
async def test_urlやidが欠けた記事は対象外(monkeypatch):
    monkeypatch.setattr(
        talk_seed_mod, "fetch_article_summary",
        AsyncMock(side_effect=AssertionError("不正な記事で本文取得してはいけない")),
    )
    manager = _make_manager([
        {"id": "", "url": "https://example.com/a"},
        {"id": "s2", "url": ""},
    ])

    seeds = await manager._collect_scrap()

    assert seeds == []


def test_api_clientがあるとscrapコレクターが登録される():
    manager = _make_manager([])
    sources = [source for source, _ in manager._build_source_collectors()]
    assert "scrap" in sources


def test_api_clientがないとscrapコレクターは登録されない():
    manager = TalkSeedManager(openai_api_key="test", screen_analysis_model="dummy")
    sources = [source for source, _ in manager._build_source_collectors()]
    assert "scrap" not in sources
