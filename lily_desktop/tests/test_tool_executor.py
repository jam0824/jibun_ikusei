from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest

import ai.tool_executor as tool_executor_module
from ai.tool_definitions import CHAT_TOOLS
from ai.tool_executor import ToolExecutor


def _make_api():
    api = AsyncMock()
    api.get_browsing_times = AsyncMock(return_value=[])
    api.get_user = AsyncMock(return_value={})
    api.get_settings = AsyncMock(return_value={})
    api.get_meta = AsyncMock(return_value={})
    api.get_quests = AsyncMock(return_value=[])
    api.get_completions = AsyncMock(return_value=[])
    api.get_skills = AsyncMock(return_value=[])
    api.get_dictionary = AsyncMock(return_value=[])
    api.get_messages = AsyncMock(return_value=[])
    api.get_ai_config = AsyncMock(return_value={})
    api.get_activity_logs = AsyncMock(return_value=[])
    api.get_situation_logs = AsyncMock(return_value=[])
    api.get_chat_sessions = AsyncMock(return_value=[])
    api.get_chat_messages = AsyncMock(return_value=[])
    api.get_chat_messages_range = AsyncMock(return_value=[])
    api.post_completion = AsyncMock()
    api.put_completion = AsyncMock()
    api.post_skill = AsyncMock()
    api.put_quest = AsyncMock()
    api.post_quest = AsyncMock()
    api.delete_quest = AsyncMock()
    return api


def _make_config(api_key: str = ""):
    return SimpleNamespace(
        openai=SimpleNamespace(
            api_key=api_key,
            chat_model="gpt-5.4",
        )
    )


def _make_session(session_id: str, created_at: str, updated_at: str, title: str) -> dict:
    return {
        "id": session_id,
        "title": title,
        "createdAt": created_at,
        "updatedAt": updated_at,
    }


def _make_chat_message(session_id: str, role: str, content: str, created_at: str) -> dict:
    return {
        "sessionId": session_id,
        "role": role,
        "content": content,
        "createdAt": created_at,
    }


def test_create_quest_tool_definition_exposes_is_daily():
    tool = next(entry for entry in CHAT_TOOLS if entry["function"]["name"] == "create_quest")

    assert "isDaily" in tool["function"]["parameters"]["properties"]


def test_complete_quest_tool_definition_mentions_notation_and_nuance_tolerance():
    tool = next(entry for entry in CHAT_TOOLS if entry["function"]["name"] == "complete_quest")

    assert "表記ゆれ" in tool["function"]["description"]
    assert "ニュアンス" in tool["function"]["description"]
    assert "短い言い換えでもよい" in tool["function"]["parameters"]["properties"]["query"]["description"]


@pytest.mark.asyncio
async def test_browsing_times_uses_explicit_date_range():
    api = _make_api()
    api.get_browsing_times.return_value = [{
        "totalSeconds": 120,
        "domains": {
            "example.com": {"totalSeconds": 120, "category": "Study"},
        },
    }]
    executor = ToolExecutor(api)

    result = await executor.execute("get_browsing_times", {"date": "2026-03-29"})

    api.get_browsing_times.assert_awaited_once_with("2026-03-29", "2026-03-29")
    assert "example.com" in result


@pytest.mark.asyncio
async def test_completions_respect_inclusive_jst_range():
    api = _make_api()
    api.get_quests.return_value = [{"id": "q1", "title": "Reading"}]
    api.get_completions.return_value = [
        {"questId": "q1", "completedAt": "2026-03-28T15:00:00Z", "userXpAwarded": 10},
        {"questId": "q1", "completedAt": "2026-03-30T14:59:59Z", "userXpAwarded": 10},
        {"questId": "q1", "completedAt": "2026-03-30T15:00:00Z", "userXpAwarded": 10},
    ]
    executor = ToolExecutor(api)

    result = await executor.execute(
        "get_quest_data",
        {"type": "completions", "fromDate": "2026-03-29", "toDate": "2026-03-30"},
    )

    assert result.count("Reading") == 2
    assert "2" in result


@pytest.mark.asyncio
async def test_get_quest_data_labels_daily_repeatable_quests():
    api = _make_api()
    api.get_quests.return_value = [{
        "id": "q1",
        "title": "Morning Review",
        "questType": "repeatable",
        "isDaily": True,
        "xpReward": 10,
        "status": "active",
        "createdAt": "2026-04-05T09:00:00+09:00",
        "updatedAt": "2026-04-05T09:00:00+09:00",
    }]
    executor = ToolExecutor(api)

    result = await executor.execute("get_quest_data", {"type": "quests"})

    assert "Morning Review" in result
    assert "デイリー" in result


@pytest.mark.asyncio
async def test_create_quest_posts_daily_flag_for_repeatable_quest():
    api = _make_api()
    executor = ToolExecutor(api)

    result = await executor.execute(
        "create_quest",
        {"title": "Morning Review", "questType": "repeatable", "isDaily": True},
    )

    assert "Morning Review" in result
    assert "デイリー" in result
    api.post_quest.assert_awaited_once()
    assert api.post_quest.await_args.args[0]["isDaily"] is True


@pytest.mark.asyncio
async def test_create_quest_does_not_keep_daily_flag_for_one_time_quest():
    api = _make_api()
    executor = ToolExecutor(api)

    await executor.execute(
        "create_quest",
        {"title": "Submit expense report", "questType": "one_time", "isDaily": True},
    )

    api.post_quest.assert_awaited_once()
    assert "isDaily" not in api.post_quest.await_args.args[0]


@pytest.mark.asyncio
async def test_assistant_messages_use_jst_day_boundary():
    api = _make_api()
    api.get_messages.return_value = [
        {"triggerType": "nudge", "text": "included", "createdAt": "2026-03-28T15:00:00Z"},
        {"triggerType": "nudge", "text": "excluded", "createdAt": "2026-03-29T15:00:00Z"},
    ]
    executor = ToolExecutor(api)

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "assistant_messages", "date": "2026-03-29"},
    )

    assert "included" in result
    assert "excluded" not in result


@pytest.mark.asyncio
async def test_activity_logs_pass_explicit_range_to_api():
    api = _make_api()
    api.get_activity_logs.return_value = [
        {"category": "work", "action": "coding", "timestamp": "2026-03-29T03:00:00Z"},
    ]
    executor = ToolExecutor(api)

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "activity_logs", "fromDate": "2026-03-29", "toDate": "2026-03-30"},
    )

    api.get_activity_logs.assert_awaited_once_with("2026-03-29", "2026-03-30")
    assert "coding" in result


@pytest.mark.asyncio
async def test_situation_logs_use_exact_date_range():
    api = _make_api()
    api.get_situation_logs.return_value = [
        {
            "summary": "working",
            "timestamp": "2026-03-28T15:30:00Z",
            "details": {"active_apps": ["VS Code"]},
        },
    ]
    executor = ToolExecutor(api)

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "situation_logs", "date": "2026-03-29"},
    )

    api.get_situation_logs.assert_awaited_once_with("2026-03-29", "2026-03-29")
    assert "VS Code" in result


@pytest.mark.asyncio
async def test_chat_messages_search_across_sessions_by_date_uses_range_api():
    api = _make_api()
    api.get_chat_sessions.return_value = [
        _make_session("s1", "2026-03-28T00:00:00Z", "2026-03-29T01:00:00Z", "session one"),
        _make_session("s2", "2026-03-29T00:00:00Z", "2026-03-30T01:00:00Z", "session two"),
    ]
    api.get_chat_messages_range.return_value = [
        _make_chat_message("s1", "user", "inside range", "2026-03-28T15:00:00Z"),
        _make_chat_message("s2", "assistant", "outside range", "2026-03-29T15:00:00Z"),
    ]
    executor = ToolExecutor(api)

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "chat_messages", "date": "2026-03-29"},
    )

    assert "session one" in result
    assert "inside range" in result
    assert "outside range" not in result
    api.get_chat_messages_range.assert_awaited_once_with("2026-03-29", "2026-03-29")
    api.get_chat_messages.assert_not_awaited()


@pytest.mark.asyncio
async def test_chat_sessions_filter_by_messages_in_range_uses_range_api():
    api = _make_api()
    api.get_chat_sessions.return_value = [
        _make_session("s1", "2026-03-28T00:00:00Z", "2026-03-29T01:00:00Z", "session one"),
        _make_session("s2", "2026-03-29T00:00:00Z", "2026-03-30T01:00:00Z", "session two"),
    ]
    api.get_chat_messages_range.return_value = [
        _make_chat_message("s1", "user", "hit", "2026-03-28T15:00:00Z"),
        _make_chat_message("s2", "assistant", "miss", "2026-03-29T15:00:00Z"),
    ]
    executor = ToolExecutor(api)

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "chat_sessions", "date": "2026-03-29"},
    )

    assert "session one" in result
    assert "session two" not in result
    api.get_chat_messages_range.assert_awaited_once_with("2026-03-29", "2026-03-29")
    api.get_chat_messages.assert_not_awaited()


@pytest.mark.asyncio
async def test_chat_messages_require_session_or_date():
    api = _make_api()
    executor = ToolExecutor(api)

    result = await executor.execute("get_messages_and_logs", {"type": "chat_messages"})

    assert "sessionId" in result


@pytest.mark.asyncio
async def test_chat_messages_retry_503_then_use_current_session_fallback():
    api = _make_api()
    api.get_chat_sessions.return_value = [
        _make_session("s1", "2026-03-29T00:00:00Z", "2026-03-29T10:00:00Z", "current session"),
    ]
    request = httpx.Request("GET", "https://example.com/chat-sessions/s1/messages")
    response = httpx.Response(503, request=request)
    error = httpx.HTTPStatusError("service unavailable", request=request, response=response)
    api.get_chat_messages = AsyncMock(side_effect=[error, error])

    executor = ToolExecutor(api)
    executor.set_context_provider(lambda: {
        "current_session_id": "s1",
        "chat_messages": [
            _make_chat_message("s1", "user", "fallback message", "2026-03-28T15:00:00Z"),
        ],
    })

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "chat_messages", "sessionId": "s1", "date": "2026-03-29"},
    )

    assert api.get_chat_messages.await_count == 2
    assert "fallback message" in result


@pytest.mark.asyncio
async def test_chat_messages_label_system_messages_distinctly():
    api = _make_api()
    api.get_chat_sessions.return_value = [
        _make_session("s1", "2026-03-29T00:00:00Z", "2026-03-29T10:00:00Z", "current session"),
    ]
    api.get_chat_messages.return_value = [
        _make_chat_message("s1", "system", "bridge notice", "2026-03-28T15:00:00Z"),
    ]
    executor = ToolExecutor(api)

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "chat_messages", "sessionId": "s1", "date": "2026-03-29"},
    )

    assert "[system] bridge notice" in result


@pytest.mark.asyncio
async def test_complete_quest_keeps_one_time_status_completed_when_saving_default_skill(monkeypatch):
    api = _make_api()
    api.get_quests.return_value = [{
        "id": "q_member_hr",
        "title": "Team meeting",
        "status": "active",
        "questType": "one_time",
        "xpReward": 15,
        "category": "social",
        "skillMappingMode": "ai_auto",
        "privacyMode": "normal",
        "createdAt": "2026-04-05T09:00:00+09:00",
        "updatedAt": "2026-04-05T09:00:00+09:00",
    }]
    monkeypatch.setattr(
        tool_executor_module,
        "resolve_skill_for_completion",
        AsyncMock(return_value={
            "resolved_skill_id": "skill_communication",
            "skill_xp_awarded": 15,
            "skill_name": "Communication",
            "status": "resolved",
            "reason": "keyword matched",
        }),
    )
    executor = ToolExecutor(api)

    result = await executor.execute("complete_quest", {"query": "Team meeting"})

    assert "Team meeting" in result
    assert api.put_quest.await_count >= 1
    for call in api.put_quest.await_args_list:
        assert call.args[0] == "q_member_hr"
        assert call.args[1]["status"] == "completed"
    assert api.put_quest.await_args_list[-1].args[1]["defaultSkillId"] == "skill_communication"


@pytest.mark.asyncio
async def test_complete_quest_keeps_repeatable_status_active_when_saving_default_skill(monkeypatch):
    api = _make_api()
    api.get_quests.return_value = [{
        "id": "q_daily_report",
        "title": "Write daily report",
        "status": "active",
        "questType": "repeatable",
        "xpReward": 10,
        "category": "work",
        "skillMappingMode": "ai_auto",
        "privacyMode": "normal",
        "createdAt": "2026-04-05T09:00:00+09:00",
        "updatedAt": "2026-04-05T09:00:00+09:00",
    }]
    monkeypatch.setattr(
        tool_executor_module,
        "resolve_skill_for_completion",
        AsyncMock(return_value={
            "resolved_skill_id": "skill_writing",
            "skill_xp_awarded": 10,
            "skill_name": "Writing",
            "status": "resolved",
            "reason": "keyword matched",
        }),
    )
    executor = ToolExecutor(api)

    result = await executor.execute("complete_quest", {"query": "Write daily report"})

    assert "Write daily report" in result
    api.put_quest.assert_awaited_once()
    assert api.put_quest.await_args.args[0] == "q_daily_report"
    assert api.put_quest.await_args.args[1]["status"] == "active"
    assert api.put_quest.await_args.args[1]["defaultSkillId"] == "skill_writing"


@pytest.mark.asyncio
async def test_complete_quest_saves_pending_then_updates_to_resolved_in_background(monkeypatch):
    api = _make_api()
    quest = {
        "id": "q_heel_raise",
        "title": "Heel raise after meals",
        "status": "active",
        "questType": "repeatable",
        "xpReward": 3,
        "category": "health",
        "skillMappingMode": "ai_auto",
        "privacyMode": "normal",
        "createdAt": "2026-04-05T09:00:00+09:00",
        "updatedAt": "2026-04-05T09:00:00+09:00",
    }
    stored_completion: dict[str, str] = {}

    async def post_completion(completion: dict):
        stored_completion.clear()
        stored_completion.update(completion)
        return {}

    async def get_completions():
        return [dict(stored_completion)] if stored_completion else []

    api.get_quests.return_value = [quest]
    api.get_completions.side_effect = get_completions
    api.get_skills.return_value = [{"id": "skill_exercise", "name": "Exercise", "category": "health", "status": "active"}]
    api.get_dictionary.return_value = []
    api.post_completion.side_effect = post_completion
    monkeypatch.setattr(
        tool_executor_module,
        "resolve_skill_for_completion_with_ai",
        AsyncMock(return_value={
            "resolved_skill_id": "skill_exercise",
            "skill_xp_awarded": 3,
            "skill_name": "Exercise",
            "status": "resolved",
            "reason": "ai matched",
            "candidate_skill_ids": [],
        }),
    )
    executor = ToolExecutor(api, config=_make_config(api_key="sk-test"))

    result = await executor.execute("complete_quest", {"query": "Heel raise after meals"})

    assert "Heel raise after meals" in result
    assert stored_completion["skillResolutionStatus"] == "pending"
    assert "resolvedSkillId" not in stored_completion

    await executor.wait_for_background_tasks()

    api.put_completion.assert_awaited_once()
    assert api.put_completion.await_args.args[0] == stored_completion["id"]
    assert api.put_completion.await_args.args[1]["skillResolutionStatus"] == "resolved"
    assert api.put_completion.await_args.args[1]["resolvedSkillId"] == "skill_exercise"
    api.put_quest.assert_awaited_once()
    assert api.put_quest.await_args.args[0] == "q_heel_raise"
    assert api.put_quest.await_args.args[1]["defaultSkillId"] == "skill_exercise"


@pytest.mark.asyncio
async def test_complete_quest_saves_pending_then_updates_to_needs_confirmation_in_background(monkeypatch):
    api = _make_api()
    quest = {
        "id": "q_heel_raise",
        "title": "Heel raise after meals",
        "status": "active",
        "questType": "repeatable",
        "xpReward": 3,
        "category": "health",
        "skillMappingMode": "ai_auto",
        "privacyMode": "normal",
        "createdAt": "2026-04-05T09:00:00+09:00",
        "updatedAt": "2026-04-05T09:00:00+09:00",
    }
    stored_completion: dict[str, str] = {}

    async def post_completion(completion: dict):
        stored_completion.clear()
        stored_completion.update(completion)
        return {}

    async def get_completions():
        return [dict(stored_completion)] if stored_completion else []

    api.get_quests.return_value = [quest]
    api.get_completions.side_effect = get_completions
    api.get_skills.return_value = []
    api.get_dictionary.return_value = []
    api.post_completion.side_effect = post_completion
    monkeypatch.setattr(
        tool_executor_module,
        "resolve_skill_for_completion_with_ai",
        AsyncMock(return_value={
            "resolved_skill_id": None,
            "skill_xp_awarded": 0,
            "skill_name": "",
            "status": "needs_confirmation",
            "reason": "ai needs confirmation",
            "candidate_skill_ids": ["skill_stretching", "skill_balance"],
        }),
    )
    executor = ToolExecutor(api, config=_make_config(api_key="sk-test"))

    await executor.execute("complete_quest", {"query": "Heel raise after meals"})
    await executor.wait_for_background_tasks()

    api.put_completion.assert_awaited_once()
    assert api.put_completion.await_args.args[1]["skillResolutionStatus"] == "needs_confirmation"
    assert api.put_completion.await_args.args[1]["candidateSkillIds"] == [
        "skill_stretching",
        "skill_balance",
    ]
    api.put_quest.assert_not_awaited()


@pytest.mark.asyncio
async def test_complete_quest_background_resolution_falls_back_to_local_result(monkeypatch):
    api = _make_api()
    quest = {
        "id": "q_heel_raise",
        "title": "Heel raise after meals",
        "status": "active",
        "questType": "repeatable",
        "xpReward": 3,
        "category": "health",
        "skillMappingMode": "ai_auto",
        "privacyMode": "normal",
        "createdAt": "2026-04-05T09:00:00+09:00",
        "updatedAt": "2026-04-05T09:00:00+09:00",
    }
    stored_completion: dict[str, str] = {}

    async def post_completion(completion: dict):
        stored_completion.clear()
        stored_completion.update(completion)
        return {}

    async def get_completions():
        return [dict(stored_completion)] if stored_completion else []

    api.get_quests.return_value = [quest]
    api.get_completions.side_effect = get_completions
    api.get_skills.return_value = []
    api.get_dictionary.return_value = []
    api.post_completion.side_effect = post_completion
    monkeypatch.setattr(
        tool_executor_module,
        "resolve_skill_for_completion_with_ai",
        AsyncMock(side_effect=RuntimeError("openai down")),
    )
    monkeypatch.setattr(
        tool_executor_module,
        "resolve_skill_for_completion",
        AsyncMock(return_value={
            "resolved_skill_id": None,
            "skill_xp_awarded": 0,
            "skill_name": "",
            "status": "unclassified",
            "reason": "fallback result",
            "candidate_skill_ids": [],
        }),
    )
    executor = ToolExecutor(api, config=_make_config(api_key="sk-test"))

    await executor.execute("complete_quest", {"query": "Heel raise after meals"})
    await executor.wait_for_background_tasks()

    api.put_completion.assert_awaited_once()
    assert api.put_completion.await_args.args[1]["skillResolutionStatus"] == "unclassified"
    assert api.put_completion.await_args.args[1]["resolutionReason"] == "fallback result"
    api.put_quest.assert_not_awaited()


@pytest.mark.asyncio
async def test_complete_quest_background_resolution_skips_undone_completion(monkeypatch):
    api = _make_api()
    quest = {
        "id": "q_heel_raise",
        "title": "Heel raise after meals",
        "status": "active",
        "questType": "repeatable",
        "xpReward": 3,
        "category": "health",
        "skillMappingMode": "ai_auto",
        "privacyMode": "normal",
        "createdAt": "2026-04-05T09:00:00+09:00",
        "updatedAt": "2026-04-05T09:00:00+09:00",
    }
    api.get_quests.return_value = [quest]
    api.get_completions.return_value = [{
        "id": "completion_1",
        "questId": "q_heel_raise",
        "completedAt": "2026-04-08T19:04:00+09:00",
        "undoneAt": "2026-04-08T19:05:00+09:00",
        "skillResolutionStatus": "pending",
    }]
    monkeypatch.setattr(
        tool_executor_module,
        "resolve_skill_for_completion_with_ai",
        AsyncMock(return_value={
            "resolved_skill_id": "skill_exercise",
            "skill_xp_awarded": 3,
            "skill_name": "Exercise",
            "status": "resolved",
            "reason": "ai matched",
            "candidate_skill_ids": [],
        }),
    )
    executor = ToolExecutor(api, config=_make_config(api_key="sk-test"))

    await executor._resolve_completion_skill_in_background("completion_1", "q_heel_raise", None)

    api.put_completion.assert_not_awaited()
    api.put_quest.assert_not_awaited()
