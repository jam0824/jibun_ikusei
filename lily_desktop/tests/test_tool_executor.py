"""tool_executor のテスト"""

from __future__ import annotations

from unittest.mock import AsyncMock

import httpx
import pytest

import ai.tool_executor as tool_executor_module
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
    api.post_completion = AsyncMock()
    api.put_quest = AsyncMock()
    api.post_quest = AsyncMock()
    api.delete_quest = AsyncMock()
    return api


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


@pytest.mark.asyncio
async def test_browsing_times_uses_explicit_date_range():
    api = _make_api()
    api.get_browsing_times.return_value = [{
        "totalSeconds": 120,
        "domains": {
            "example.com": {"totalSeconds": 120, "category": "学習"},
        },
    }]
    executor = ToolExecutor(api)

    result = await executor.execute("get_browsing_times", {"date": "2026-03-29"})

    api.get_browsing_times.assert_awaited_once_with("2026-03-29", "2026-03-29")
    assert "example.com" in result


@pytest.mark.asyncio
async def test_completions_respect_inclusive_jst_range():
    api = _make_api()
    api.get_quests.return_value = [{"id": "q1", "title": "読書"}]
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

    assert result.count("読書") == 2
    assert "合計: 2件" in result


@pytest.mark.asyncio
async def test_assistant_messages_use_jst_day_boundary():
    api = _make_api()
    api.get_messages.return_value = [
        {"triggerType": "nudge", "text": "含まれる", "createdAt": "2026-03-28T15:00:00Z"},
        {"triggerType": "nudge", "text": "含まれない", "createdAt": "2026-03-29T15:00:00Z"},
    ]
    executor = ToolExecutor(api)

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "assistant_messages", "date": "2026-03-29"},
    )

    assert "含まれる" in result
    assert "含まれない" not in result


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
            "summary": "作業中",
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
async def test_chat_messages_search_across_sessions_by_date():
    api = _make_api()
    api.get_chat_sessions.return_value = [
        _make_session("s1", "2026-03-28T00:00:00Z", "2026-03-29T01:00:00Z", "1つ目"),
        _make_session("s2", "2026-03-29T00:00:00Z", "2026-03-30T01:00:00Z", "2つ目"),
    ]

    async def _get_chat_messages(session_id: str):
        if session_id == "s1":
            return [_make_chat_message("s1", "user", "アニメの話をした", "2026-03-28T15:00:00Z")]
        if session_id == "s2":
            return [_make_chat_message("s2", "assistant", "別日の会話", "2026-03-29T15:00:00Z")]
        return []

    api.get_chat_messages.side_effect = _get_chat_messages
    executor = ToolExecutor(api)

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "chat_messages", "date": "2026-03-29"},
    )

    assert "1つ目 / ユーザー" in result
    assert "アニメの話をした" in result
    assert "別日の会話" not in result


@pytest.mark.asyncio
async def test_chat_sessions_filter_by_messages_in_range():
    api = _make_api()
    api.get_chat_sessions.return_value = [
        _make_session("s1", "2026-03-28T00:00:00Z", "2026-03-29T01:00:00Z", "1つ目"),
        _make_session("s2", "2026-03-29T00:00:00Z", "2026-03-30T01:00:00Z", "2つ目"),
    ]

    async def _get_chat_messages(session_id: str):
        if session_id == "s1":
            return [_make_chat_message("s1", "user", "対象", "2026-03-28T15:00:00Z")]
        if session_id == "s2":
            return [_make_chat_message("s2", "assistant", "対象外", "2026-03-29T15:00:00Z")]
        return []

    api.get_chat_messages.side_effect = _get_chat_messages
    executor = ToolExecutor(api)

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "chat_sessions", "date": "2026-03-29"},
    )

    assert "1つ目" in result
    assert "2つ目" not in result


@pytest.mark.asyncio
async def test_chat_messages_require_session_or_date():
    api = _make_api()
    executor = ToolExecutor(api)

    result = await executor.execute("get_messages_and_logs", {"type": "chat_messages"})

    assert "sessionId を指定するか" in result


@pytest.mark.asyncio
async def test_chat_messages_retry_503_then_use_current_session_fallback():
    api = _make_api()
    api.get_chat_sessions.return_value = [
        _make_session("s1", "2026-03-29T00:00:00Z", "2026-03-29T10:00:00Z", "現在の会話"),
    ]
    request = httpx.Request("GET", "https://example.com/chat-sessions/s1/messages")
    response = httpx.Response(503, request=request)
    error = httpx.HTTPStatusError("service unavailable", request=request, response=response)
    api.get_chat_messages = AsyncMock(side_effect=[error, error])

    executor = ToolExecutor(api)
    executor.set_context_provider(lambda: {
        "current_session_id": "s1",
        "chat_messages": [
            _make_chat_message("s1", "user", "fallback の本文", "2026-03-28T15:00:00Z"),
        ],
    })

    result = await executor.execute(
        "get_messages_and_logs",
        {"type": "chat_messages", "sessionId": "s1", "date": "2026-03-29"},
    )

    assert api.get_chat_messages.await_count == 2
    assert "fallback の本文" in result


@pytest.mark.asyncio
async def test_complete_quest_keeps_one_time_status_completed_when_saving_default_skill(monkeypatch):
    api = _make_api()
    api.get_quests.return_value = [{
        "id": "q_member_hr",
        "title": "メンバーの人事相談",
        "status": "active",
        "questType": "one_time",
        "xpReward": 15,
        "category": "対人",
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
            "skill_name": "コミュニケーション",
            "status": "resolved",
            "reason": "キーワード一致",
        }),
    )
    executor = ToolExecutor(api)

    result = await executor.execute("complete_quest", {"query": "メンバーの人事相談"})

    assert "メンバーの人事相談" in result
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
        "title": "日報を書く",
        "status": "active",
        "questType": "repeatable",
        "xpReward": 10,
        "category": "仕事",
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
            "skill_name": "文書作成",
            "status": "resolved",
            "reason": "キーワード一致",
        }),
    )
    executor = ToolExecutor(api)

    result = await executor.execute("complete_quest", {"query": "日報を書く"})

    assert "日報を書く" in result
    api.put_quest.assert_awaited_once()
    assert api.put_quest.await_args.args[0] == "q_daily_report"
    assert api.put_quest.await_args.args[1]["status"] == "active"
    assert api.put_quest.await_args.args[1]["defaultSkillId"] == "skill_writing"
