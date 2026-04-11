"""雑談の種選択ロジックのテスト — 9系統均等配分の検証"""

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

    def test_quest_weeklyのみの場合はquest_weeklyを返す(self, seed_mgr):
        seeds = [_make_seed("quest_weekly")]
        result = seed_mgr.select_best_seed(seeds)
        assert result is not None
        assert result.source == "quest_weekly"

    def test_quest_todayのみの場合はquest_todayを返す(self, seed_mgr):
        seeds = [_make_seed("quest_today")]
        result = seed_mgr.select_best_seed(seeds)
        assert result is not None
        assert result.source == "quest_today"

    def test_memoryのみの場合はmemoryを返す(self, seed_mgr):
        seeds = [_make_seed("memory")]
        result = seed_mgr.select_best_seed(seeds)
        assert result is not None
        assert result.source == "memory"

    def test_全カテゴリある場合に10種から選ばれる(self, seed_mgr):
        seeds = [
            _make_seed("desktop"),
            _make_seed("camera"),
            _make_seed("wikimedia"),
            _make_seed("wikimedia_interest"),
            _make_seed("annict"),
            _make_seed("health"),
            _make_seed("books"),
            _make_seed("quest_weekly"),
            _make_seed("quest_today"),
            _make_seed("memory"),
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
        assert "quest_weekly" in sources_selected
        assert "quest_today" in sources_selected
        assert "memory" in sources_selected

    def test_配分がおおよそ正しい(self, seed_mgr):
        """10系統均等配分（各約10%）を統計的に検証"""
        seeds = [
            _make_seed("desktop"),
            _make_seed("camera"),
            _make_seed("wikimedia"),
            _make_seed("wikimedia_interest"),
            _make_seed("annict"),
            _make_seed("health"),
            _make_seed("books"),
            _make_seed("quest_weekly"),
            _make_seed("quest_today"),
            _make_seed("memory"),
        ]
        counts = {
            "desktop": 0,
            "camera": 0,
            "wikimedia": 0,
            "wikimedia_interest": 0,
            "annict": 0,
            "health": 0,
            "books": 0,
            "quest_weekly": 0,
            "quest_today": 0,
            "memory": 0,
        }
        n = 2000
        for _ in range(n):
            result = seed_mgr.select_best_seed(seeds)
            counts[result.source] += 1

        # 各カテゴリの割合が許容範囲内か（期待値10%に対して広めの許容幅）
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


class TestBuildSourceCollectors:
    def test_api_clientがない場合はquest系カテゴリを追加しない(self):
        seed_mgr = TalkSeedManager(
            openai_api_key="test",
            screen_analysis_model="test",
        )

        collectors = seed_mgr._build_source_collectors()

        assert "quest_weekly" not in [source for source, _ in collectors]
        assert "quest_today" not in [source for source, _ in collectors]
        assert "memory" not in [source for source, _ in collectors]

    def test_api_clientとmemory_directoryがある場合はquest系とmemoryカテゴリを追加する(self):
        seed_mgr = TalkSeedManager(
            openai_api_key="test",
            screen_analysis_model="test",
            api_client=AsyncMock(),
            memory_directory="D:\\codes\\mixi2-api\\generated_text",
        )

        collectors = seed_mgr._build_source_collectors()

        assert "quest_weekly" in [source for source, _ in collectors]
        assert "quest_today" in [source for source, _ in collectors]
        assert "memory" in [source for source, _ in collectors]

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
    async def test_memory強制カテゴリではmemoryだけ収集する(self, monkeypatch, tmp_path):
        memory_dir = tmp_path / "generated_text"
        memory_dir.mkdir()
        seed_mgr = TalkSeedManager(
            openai_api_key="test",
            screen_analysis_model="test",
            memory_directory=str(memory_dir),
        )
        memory_seed = _make_seed("memory", "思い出の話")
        desktop = AsyncMock(return_value=[_make_seed("desktop", "作業中")])
        memory = AsyncMock(return_value=[memory_seed])

        monkeypatch.setattr(seed_mgr, "_collect_desktop", desktop)
        monkeypatch.setattr(seed_mgr, "_collect_memory", memory)

        result = await seed_mgr.collect_seed(forced_source="memory")

        assert result == memory_seed
        memory.assert_awaited_once()
        desktop.assert_not_awaited()

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


class TestCollectMemory:
    @pytest.mark.asyncio
    async def test_memoryファイルからseedを生成する(self, tmp_path):
        memory_dir = tmp_path / "generated_text"
        memory_dir.mkdir()
        memory_file = memory_dir / "memory_20260306_203218.txt"
        memory_file.write_text("懐かしい思い出の本文", encoding="utf-8")

        seed_mgr = TalkSeedManager(
            openai_api_key="test",
            screen_analysis_model="test",
            memory_directory=str(memory_dir),
        )

        seeds = await seed_mgr._collect_memory()

        assert len(seeds) == 1
        assert seeds[0].source == "memory"
        assert seeds[0].summary == "懐かしい思い出の本文"
        assert seeds[0]._source_key == "memory:memory_20260306_203218.txt"

    @pytest.mark.asyncio
    async def test_memoryディレクトリがない場合は空配列(self, tmp_path):
        seed_mgr = TalkSeedManager(
            openai_api_key="test",
            screen_analysis_model="test",
            memory_directory=str(tmp_path / "missing"),
        )

        seeds = await seed_mgr._collect_memory()

        assert seeds == []

    @pytest.mark.asyncio
    async def test_memoryディレクトリが空の場合は空配列(self, tmp_path):
        memory_dir = tmp_path / "generated_text"
        memory_dir.mkdir()
        seed_mgr = TalkSeedManager(
            openai_api_key="test",
            screen_analysis_model="test",
            memory_directory=str(memory_dir),
        )

        seeds = await seed_mgr._collect_memory()

        assert seeds == []

    @pytest.mark.asyncio
    async def test_memoryファイルが空または不正UTF8のみなら空配列(self, tmp_path):
        memory_dir = tmp_path / "generated_text"
        memory_dir.mkdir()
        (memory_dir / "memory_empty.txt").write_text("   \n", encoding="utf-8")
        (memory_dir / "memory_invalid.txt").write_bytes(b"\xff\xfe\xfd")

        seed_mgr = TalkSeedManager(
            openai_api_key="test",
            screen_analysis_model="test",
            memory_directory=str(memory_dir),
        )

        seeds = await seed_mgr._collect_memory()

        assert seeds == []
