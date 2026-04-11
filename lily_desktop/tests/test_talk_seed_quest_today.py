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
async def test_collect_quest_today_builds_seed_from_today_completions():
    manager, api = _make_manager()
    api.get_quests.return_value = [
        {"id": "q1", "title": "朝のストレッチ", "status": "active"},
        {"id": "q2", "title": "読書", "status": "active"},
    ]
    api.get_completions.return_value = [
        {"questId": "q1", "completedAt": "2026-04-11T08:10:00+09:00", "userXpAwarded": 10},
        {"questId": "q1", "completedAt": "2026-04-11T07:00:00+09:00", "userXpAwarded": 10},
        {"questId": "q2", "completedAt": "2026-04-11T06:30:00+09:00", "userXpAwarded": 5},
        {"questId": "q2", "completedAt": "2026-04-10T23:59:59+09:00", "userXpAwarded": 5},
    ]

    seeds = await manager._collect_quest_today()

    assert len(seeds) == 1
    seed = seeds[0]
    assert seed.source == "quest_today"
    assert "今日は3件クリア" in seed.summary
    assert "合計25XP" in seed.summary
    assert "2種類のクエスト" in seed.summary
    assert "よく進めたのは「朝のストレッチ」2回" in seed.summary
    assert "現在アクティブなクエストは2件" in seed.summary
    assert seed.tags[:3] == ["クエスト", "今日", "進捗"]
    assert "朝のストレッチ" in seed.tags
    assert seed._source_key == "quest_today:2026-04-11:3:朝のストレッチ"


@pytest.mark.asyncio
async def test_collect_quest_today_uses_jst_today_boundary():
    manager, api = _make_manager()
    api.get_quests.return_value = [
        {"id": "q1", "title": "深夜ラン", "status": "active"},
    ]
    api.get_completions.return_value = [
        {"questId": "q1", "completedAt": "2026-04-10T14:59:59Z", "userXpAwarded": 7},
        {"questId": "q1", "completedAt": "2026-04-10T15:00:00Z", "userXpAwarded": 8},
    ]

    seeds = await manager._collect_quest_today()

    assert len(seeds) == 1
    assert "今日は1件クリア" in seeds[0].summary
    assert "合計8XP" in seeds[0].summary


@pytest.mark.asyncio
async def test_collect_quest_today_returns_active_only_seed_when_today_has_no_completions():
    manager, api = _make_manager()
    api.get_quests.return_value = [
        {"id": "q1", "title": "朝のストレッチ", "status": "active"},
        {"id": "q2", "title": "読書", "status": "active"},
    ]
    api.get_completions.return_value = [
        {
            "questId": "q1",
            "completedAt": (_FixedDateTime.now(JST) - timedelta(days=1)).isoformat(),
            "userXpAwarded": 10,
        },
    ]

    seeds = await manager._collect_quest_today()

    assert len(seeds) == 1
    assert seeds[0].summary == "今日はクリア記録なし。いま進行中のクエストは2件。"
    assert seeds[0]._source_key == "quest_today:2026-04-11:0:active_only"


@pytest.mark.asyncio
async def test_collect_quest_today_returns_empty_when_no_today_completions_and_no_active_quests():
    manager, api = _make_manager()
    api.get_quests.return_value = [
        {"id": "q1", "title": "朝のストレッチ", "status": "completed"},
    ]
    api.get_completions.return_value = []

    seeds = await manager._collect_quest_today()

    assert seeds == []
