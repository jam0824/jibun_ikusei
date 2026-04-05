"""雑談の種選択ロジックのテスト — 7系統均等配分の検証"""

from unittest.mock import AsyncMock

import pytest

from ai.talk_seed import TalkSeed, TalkSeedManager


def _make_seed(source: str, summary: str = "テスト") -> TalkSeed:
    return TalkSeed(
        summary=summary,
        tags=["test"],
        source=source,
        lily_perspective="テスト",
        haruka_perspective="テスト",
        freshness="fresh",
        created_at="2026-03-29 12:00:00",
        _source_key=f"{source}:{summary}",
    )


@pytest.fixture
def seed_mgr():
    return TalkSeedManager(
        openai_api_key="test",
        screen_analysis_model="test",
    )


class TestSelectBestSeed:
    def test_空リストではNoneを返す(self, seed_mgr):
        assert seed_mgr.select_best_seed([]) is None

    def test_デスクトップのみの場合はデスクトップを返す(self, seed_mgr):
        seeds = [_make_seed("desktop")]
        result = seed_mgr.select_best_seed(seeds)
        assert result is not None
        assert result.source == "desktop"

    def test_カメラのみの場合はカメラを返す(self, seed_mgr):
        seeds = [_make_seed("camera")]
        result = seed_mgr.select_best_seed(seeds)
        assert result is not None
        assert result.source == "camera"

    def test_wikiのみの場合はwikiを返す(self, seed_mgr):
        seeds = [_make_seed("wikimedia")]
        result = seed_mgr.select_best_seed(seeds)
        assert result is not None
        assert result.source == "wikimedia"

    def test_wiki_interestのみの場合はwiki_interestを返す(self, seed_mgr):
        seeds = [_make_seed("wikimedia_interest")]
        result = seed_mgr.select_best_seed(seeds)
        assert result is not None
        assert result.source == "wikimedia_interest"

    def test_annictのみの場合はannictを返す(self, seed_mgr):
        seeds = [_make_seed("annict")]
        result = seed_mgr.select_best_seed(seeds)
        assert result is not None
        assert result.source == "annict"

    def test_healthのみの場合はhealthを返す(self, seed_mgr):
        seeds = [_make_seed("health")]
        result = seed_mgr.select_best_seed(seeds)
        assert result is not None
        assert result.source == "health"

    def test_booksのみの場合はbooksを返す(self, seed_mgr):
        seeds = [_make_seed("books")]
        result = seed_mgr.select_best_seed(seeds)
        assert result is not None
        assert result.source == "books"

    def test_全カテゴリある場合に7種から選ばれる(self, seed_mgr):
        seeds = [
            _make_seed("desktop"),
            _make_seed("camera"),
            _make_seed("wikimedia"),
            _make_seed("wikimedia_interest"),
            _make_seed("annict"),
            _make_seed("health"),
            _make_seed("books"),
        ]
        # 200回試行して各sourceが少なくとも1回は選ばれることを確認
        sources_selected = set()
        for _ in range(200):
            result = seed_mgr.select_best_seed(seeds)
            sources_selected.add(result.source)

        assert "desktop" in sources_selected
        assert "camera" in sources_selected
        assert "wikimedia" in sources_selected
        assert "wikimedia_interest" in sources_selected
        assert "annict" in sources_selected
        assert "health" in sources_selected
        assert "books" in sources_selected

    def test_配分がおおよそ正しい(self, seed_mgr):
        """7系統均等配分（各約14.3%）を統計的に検証"""
        seeds = [
            _make_seed("desktop"),
            _make_seed("camera"),
            _make_seed("wikimedia"),
            _make_seed("wikimedia_interest"),
            _make_seed("annict"),
            _make_seed("health"),
            _make_seed("books"),
        ]
        counts = {"desktop": 0, "camera": 0, "wikimedia": 0, "wikimedia_interest": 0, "annict": 0, "health": 0, "books": 0}
        n = 2000
        for _ in range(n):
            result = seed_mgr.select_best_seed(seeds)
            counts[result.source] += 1

        # 各カテゴリの割合が許容範囲内か（期待値14.3%に対して広めの許容幅）
        for source, count in counts.items():
            assert 0.05 < count / n < 0.24, f"{source}: {count/n:.2f}"

    def test_クールダウン中の種は除外される(self, seed_mgr):
        seeds = [
            _make_seed("desktop", "作業中"),
            _make_seed("wikimedia", "豆知識"),
        ]
        # desktop を使用済みにする
        seed_mgr.mark_used(seeds[0])

        # 100回試行してdesktopが選ばれないことを確認
        for _ in range(100):
            result = seed_mgr.select_best_seed(seeds)
            assert result.source == "wikimedia"

    def test_カメラとannictのみの場合も正しく選択される(self, seed_mgr):
        seeds = [
            _make_seed("camera"),
            _make_seed("annict"),
        ]
        sources_selected = set()
        for _ in range(50):
            result = seed_mgr.select_best_seed(seeds)
            sources_selected.add(result.source)

        assert "camera" in sources_selected
        assert "annict" in sources_selected

    def test_wikiとwiki_interestのみの場合も両方選ばれる(self, seed_mgr):
        seeds = [
            _make_seed("wikimedia"),
            _make_seed("wikimedia_interest"),
        ]
        sources_selected = set()
        for _ in range(100):
            result = seed_mgr.select_best_seed(seeds)
            sources_selected.add(result.source)

        assert "wikimedia" in sources_selected
        assert "wikimedia_interest" in sources_selected


class TestCollectSeed:
    @pytest.mark.asyncio
    async def test_カテゴリ先行取得では最初に当たったカテゴリだけ収集する(self, seed_mgr, monkeypatch):
        desktop_seed = _make_seed("desktop", "作業中")
        desktop = AsyncMock(return_value=[desktop_seed])
        wiki = AsyncMock(return_value=[_make_seed("wikimedia", "豆知識")])

        monkeypatch.setattr(seed_mgr, "_collect_desktop", desktop)
        monkeypatch.setattr(seed_mgr, "_collect_wikimedia", wiki)
        monkeypatch.setattr("ai.talk_seed.random.randrange", lambda n: 0)

        result = await seed_mgr.collect_seed()

        assert result == desktop_seed
        desktop.assert_awaited_once()
        wiki.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_カテゴリが空なら次のカテゴリへフォールバックする(self, seed_mgr, monkeypatch):
        wiki_seed = _make_seed("wikimedia", "豆知識")
        desktop = AsyncMock(return_value=[])
        wiki = AsyncMock(return_value=[wiki_seed])

        monkeypatch.setattr(seed_mgr, "_collect_desktop", desktop)
        monkeypatch.setattr(seed_mgr, "_collect_wikimedia", wiki)
        monkeypatch.setattr("ai.talk_seed.random.randrange", lambda n: 0)

        result = await seed_mgr.collect_seed()

        assert result == wiki_seed
        desktop.assert_awaited_once()
        wiki.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_強制カテゴリでは指定したカテゴリだけ収集する(self, monkeypatch):
        seed_mgr = TalkSeedManager(
            openai_api_key="test",
            screen_analysis_model="test",
            rakuten_application_id="app",
            rakuten_access_key="key",
        )
        book_seed = _make_seed("books", "本の話")
        desktop = AsyncMock(return_value=[_make_seed("desktop", "作業中")])
        wiki = AsyncMock(return_value=[_make_seed("wikimedia", "豆知識")])
        books = AsyncMock(return_value=[book_seed])

        monkeypatch.setattr(seed_mgr, "_collect_desktop", desktop)
        monkeypatch.setattr(seed_mgr, "_collect_wikimedia", wiki)
        monkeypatch.setattr(seed_mgr, "_collect_books", books)

        result = await seed_mgr.collect_seed(forced_source="books")

        assert result == book_seed
        books.assert_awaited_once()
        desktop.assert_not_awaited()
        wiki.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_クールダウン中のカテゴリは次のカテゴリへフォールバックする(self, seed_mgr, monkeypatch):
        desktop_seed = _make_seed("desktop", "作業中")
        wiki_seed = _make_seed("wikimedia", "豆知識")
        seed_mgr.mark_used(desktop_seed)

        desktop = AsyncMock(return_value=[desktop_seed])
        wiki = AsyncMock(return_value=[wiki_seed])

        monkeypatch.setattr(seed_mgr, "_collect_desktop", desktop)
        monkeypatch.setattr(seed_mgr, "_collect_wikimedia", wiki)
        monkeypatch.setattr("ai.talk_seed.random.randrange", lambda n: 0)

        result = await seed_mgr.collect_seed()

        assert result == wiki_seed
        desktop.assert_awaited_once()
        wiki.assert_awaited_once()
