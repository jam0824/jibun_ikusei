from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest

import ai.talk_seed as talk_seed_module
from ai.talk_seed import JST, TalkSeedManager


class _FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        fixed = datetime(2026, 4, 11, 9, 0, tzinfo=JST)
        if tz is None:
            return fixed.replace(tzinfo=None)
        return fixed.astimezone(tz)


def _make_manager():
    api = AsyncMock()
    manager = TalkSeedManager(
        openai_api_key="test-key",
        screen_analysis_model="screen-model",
        api_client=api,
    )
    return manager, api


@pytest.fixture(autouse=True)
def _fixed_datetime(monkeypatch):
    monkeypatch.setattr(talk_seed_module, "datetime", _FixedDateTime)


@pytest.mark.asyncio
async def test_collect_quest_weekly_builds_seed_from_recent_completions():
    manager, api = _make_manager()
    api.get_quests.return_value = [
        {"id": "q1", "title": "朝のストレッチ", "status": "active"},
        {"id": "q2", "title": "読書", "status": "active"},
        {"id": "q3", "title": "片付け", "status": "completed"},
    ]
    api.get_completions.return_value = [
        {"questId": "q1", "completedAt": "2026-04-10T22:00:00+09:00", "userXpAwarded": 10},
        {"questId": "q1", "completedAt": "2026-04-09T07:00:00+09:00", "userXpAwarded": 10},
        {"questId": "q2", "completedAt": "2026-04-08T21:30:00+09:00", "userXpAwarded": 5},
    ]

    seeds = await manager._collect_quest_weekly()

    assert len(seeds) == 1
    seed = seeds[0]
    assert seed.source == "quest_weekly"
    assert "直近7日で3件クリア" in seed.summary
    assert "合計25XP" in seed.summary
    assert "2種類のクエスト" in seed.summary
    assert "よく進めたのは「朝のストレッチ」2回" in seed.summary
    assert "現在アクティブなクエストは2件" in seed.summary
    assert seed.tags[:3] == ["クエスト", "直近7日", "進捗"]
    assert "朝のストレッチ" in seed.tags
    assert seed._source_key == "quest_weekly:2026-04-11:3:朝のストレッチ"


@pytest.mark.asyncio
async def test_collect_quest_weekly_ignores_undone_completions():
    manager, api = _make_manager()
    api.get_quests.return_value = [
        {"id": "q1", "title": "朝のストレッチ", "status": "active"},
    ]
    api.get_completions.return_value = [
        {
            "questId": "q1",
            "completedAt": "2026-04-10T22:00:00+09:00",
            "userXpAwarded": 10,
            "undoneAt": "2026-04-10T22:05:00+09:00",
        },
    ]

    seeds = await manager._collect_quest_weekly()

    assert len(seeds) == 1
    assert seeds[0].summary == "直近7日はクリア記録なし。いま進行中のクエストは1件。"


@pytest.mark.asyncio
async def test_collect_quest_weekly_uses_jst_boundary_for_rolling_seven_days():
    manager, api = _make_manager()
    api.get_quests.return_value = [
        {"id": "q1", "title": "深夜ラン", "status": "active"},
    ]
    api.get_completions.return_value = [
        {"questId": "q1", "completedAt": "2026-04-04T14:59:59Z", "userXpAwarded": 7},
        {"questId": "q1", "completedAt": "2026-04-04T15:00:00Z", "userXpAwarded": 8},
    ]

    seeds = await manager._collect_quest_weekly()

    assert len(seeds) == 1
    assert "直近7日で1件クリア" in seeds[0].summary
    assert "合計8XP" in seeds[0].summary


@pytest.mark.asyncio
async def test_collect_quest_weekly_uses_latest_completion_title_when_top_count_is_one():
    manager, api = _make_manager()
    api.get_quests.return_value = [
        {"id": "q1", "title": "朝のストレッチ", "status": "active"},
        {"id": "q2", "title": "読書", "status": "active"},
    ]
    api.get_completions.return_value = [
        {"questId": "q1", "completedAt": "2026-04-08T07:00:00+09:00", "userXpAwarded": 10},
        {"questId": "q2", "completedAt": "2026-04-10T07:00:00+09:00", "userXpAwarded": 5},
    ]

    seeds = await manager._collect_quest_weekly()

    assert len(seeds) == 1
    assert "よく進めたのは" not in seeds[0].summary
    assert "最新の達成は「読書」" in seeds[0].summary
    assert seeds[0]._source_key == "quest_weekly:2026-04-11:2:読書"


@pytest.mark.asyncio
async def test_collect_quest_weekly_returns_active_only_seed_when_no_recent_completions():
    manager, api = _make_manager()
    api.get_quests.return_value = [
        {"id": "q1", "title": "朝のストレッチ", "status": "active"},
        {"id": "q2", "title": "読書", "status": "active"},
    ]
    api.get_completions.return_value = [
        {
            "questId": "q1",
            "completedAt": (_FixedDateTime.now(JST) - timedelta(days=8)).isoformat(),
            "userXpAwarded": 10,
        },
    ]

    seeds = await manager._collect_quest_weekly()

    assert len(seeds) == 1
    assert seeds[0].summary == "直近7日はクリア記録なし。いま進行中のクエストは2件。"
    assert seeds[0]._source_key == "quest_weekly:2026-04-11:0:active_only"


@pytest.mark.asyncio
async def test_collect_quest_weekly_returns_empty_when_no_recent_completions_and_no_active_quests():
    manager, api = _make_manager()
    api.get_quests.return_value = [
        {"id": "q1", "title": "朝のストレッチ", "status": "completed"},
    ]
    api.get_completions.return_value = []

    seeds = await manager._collect_quest_weekly()

    assert seeds == []
