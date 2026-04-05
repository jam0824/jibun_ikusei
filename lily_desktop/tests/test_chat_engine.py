from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from ai.chat_engine import ChatEngine, JST
from ai.tool_executor import ToolExecutor


def _make_api() -> AsyncMock:
    api = AsyncMock()
    api.get_user = AsyncMock(return_value={"id": "user_1"})
    api.get_skills = AsyncMock(return_value=[{"id": "skill_1"}])
    api.get_quests = AsyncMock(return_value=[{"id": "quest_1"}])
    api.get_completions = AsyncMock(return_value=[{"id": "completion_1"}])
    api.get_activity_logs = AsyncMock(return_value=[{"id": "log_1"}])
    api.post_quest = AsyncMock()
    api.put_quest = AsyncMock()
    api.delete_quest = AsyncMock()
    api.get_dictionary = AsyncMock(return_value=[])
    return api


def _make_engine(api: AsyncMock) -> ChatEngine:
    return ChatEngine(
        config=SimpleNamespace(openai=SimpleNamespace(api_key="", chat_model="")),
        api_client=api,
        session_mgr=SimpleNamespace(current_session_id=None),
    )


@pytest.mark.asyncio
async def test_fetch_context_uses_ttl_cache():
    api = _make_api()
    engine = _make_engine(api)

    first = await engine._fetch_context()
    second = await engine._fetch_context()

    assert first == second
    api.get_user.assert_awaited_once()
    api.get_skills.assert_awaited_once()
    api.get_quests.assert_awaited_once()
    api.get_completions.assert_awaited_once()
    api.get_activity_logs.assert_awaited_once()


@pytest.mark.asyncio
async def test_tool_mutation_invalidates_context_cache():
    api = _make_api()
    engine = _make_engine(api)
    executor = ToolExecutor(api)
    engine.set_tools([], executor.execute)

    await engine._fetch_context()
    await engine._fetch_context()

    await executor.execute("create_quest", {"title": "新しいクエスト"})
    await engine._fetch_context()

    assert api.get_user.await_count == 2
    assert api.get_skills.await_count == 2
    api.post_quest.assert_awaited_once()


@pytest.mark.asyncio
async def test_fetch_context_reuses_last_successful_values_on_partial_failure():
    api = _make_api()
    engine = _make_engine(api)

    first = await engine._fetch_context()
    engine._context_cache_expires_at = datetime.now(JST) - timedelta(seconds=1)

    api.get_user.return_value = {"id": "user_2"}
    api.get_skills.side_effect = RuntimeError("boom")
    api.get_quests.return_value = [{"id": "quest_2"}]
    api.get_completions.return_value = [{"id": "completion_2"}]
    api.get_activity_logs.return_value = [{"id": "log_2"}]

    second = await engine._fetch_context()

    assert second[0] == {"id": "user_2"}
    assert second[1] == first[1]
    assert second[2] == [{"id": "quest_2"}]
    assert second[3] == [{"id": "completion_2"}]
    assert second[4] == [{"id": "log_2"}]
