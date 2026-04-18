from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import ai.chat_engine as chat_engine_module
from ai.chat_engine import ChatEngine, JST
from ai.openai_client import TextResult
from ai.tool_executor import ToolExecutor


def _make_api() -> AsyncMock:
    api = AsyncMock()
    api.get_user = AsyncMock(return_value={"id": "user_1"})
    api.get_skills = AsyncMock(return_value=[{"id": "skill_1"}])
    api.get_quests = AsyncMock(return_value=[{"id": "quest_1"}])
    api.get_completions = AsyncMock(return_value=[{"id": "completion_1"}])
    api.get_activity_logs = AsyncMock(return_value=[{"id": "log_1"}])
    api.get_action_log_sessions = AsyncMock(return_value=[])
    api.get_action_log_daily_logs = AsyncMock(return_value=[])
    api.get_action_log_open_loops = AsyncMock(return_value=[])
    api.post_quest = AsyncMock()
    api.put_quest = AsyncMock()
    api.delete_quest = AsyncMock()
    api.get_dictionary = AsyncMock(return_value=[])
    return api


def _make_engine(api: AsyncMock) -> ChatEngine:
    return ChatEngine(
        config=SimpleNamespace(openai=SimpleNamespace(api_key="", chat_model="")),
        api_client=api,
        session_mgr=SimpleNamespace(current_session_id=None, save_message=AsyncMock()),
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
    api.get_action_log_sessions.assert_awaited_once()
    api.get_action_log_daily_logs.assert_awaited_once()
    api.get_action_log_open_loops.assert_awaited_once()
    api.get_activity_logs.assert_not_awaited()


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
    api.get_action_log_sessions.return_value = [{"id": "session_2", "hidden": False}]
    api.get_action_log_daily_logs.return_value = [{"id": "daily_2"}]
    api.get_action_log_open_loops.return_value = [{"id": "loop_2"}]

    second = await engine._fetch_context()

    assert second[0] == {"id": "user_2"}
    assert second[1] == first[1]
    assert second[2] == [{"id": "quest_2"}]
    assert second[3] == [{"id": "completion_2"}]
    assert second[4] == [
        {
            "kind": "session",
            "category": "other",
            "title": "",
            "summary": "",
            "timestamp": "",
            "activityKinds": [],
            "searchKeywords": [],
            "appNames": [],
            "domains": [],
            "projectNames": [],
        },
        {
            "kind": "daily",
            "category": "daily_summary",
            "title": "その日のまとめ",
            "summary": "",
            "timestamp": "",
            "dateKey": "",
        },
        {
            "kind": "open_loop",
            "category": "open_loop",
            "title": "",
            "summary": "",
            "timestamp": "",
            "status": "open",
        },
    ]


@pytest.mark.asyncio
async def test_fetch_context_excludes_hidden_sessions_from_activity_logs():
    api = _make_api()
    api.get_action_log_sessions.return_value = [
        {"id": "session_visible", "hidden": False, "primaryCategory": "学習", "title": "Chrome 拡張の調査"},
        {"id": "session_hidden", "hidden": True, "primaryCategory": "仕事", "title": "隠しセッション"},
    ]
    api.get_action_log_daily_logs.return_value = [{"id": "daily_1", "summary": "summary"}]
    api.get_action_log_open_loops.return_value = [{"id": "loop_1", "title": "権限設定の確認"}]
    engine = _make_engine(api)

    context = await engine._fetch_context()

    assert {
        "kind": "session",
        "category": "学習",
        "title": "Chrome 拡張の調査",
        "summary": "",
        "timestamp": "",
        "activityKinds": [],
        "searchKeywords": [],
        "appNames": [],
        "domains": [],
        "projectNames": [],
    } in context[4]
    assert {
        "kind": "daily",
        "category": "daily_summary",
        "title": "その日のまとめ",
        "summary": "summary",
        "timestamp": "",
        "dateKey": "",
    } in context[4]
    assert {
        "kind": "open_loop",
        "category": "open_loop",
        "title": "権限設定の確認",
        "summary": "",
        "timestamp": "",
        "status": "open",
    } in context[4]
    assert not any(entry.get("title") == "隠しセッション" for entry in context[4])


@pytest.mark.asyncio
async def test_handle_system_message_saves_system_role_and_sends_only_runtime_notice(monkeypatch):
    api = _make_api()
    session_mgr = SimpleNamespace(current_session_id="chat_1", save_message=AsyncMock())
    engine = ChatEngine(
        config=SimpleNamespace(openai=SimpleNamespace(api_key="sk-test", chat_model="gpt-5.4")),
        api_client=api,
        session_mgr=session_mgr,
    )
    engine._history = [
        {"role": "user", "content": "前のユーザー発話"},
        {"role": "assistant", "content": "前のリリィ応答"},
        {"role": "system", "content": "過去のシステム通知"},
    ]

    send_chat_message = AsyncMock(
        return_value=TextResult(content='{"text":"了解したよ","pose_category":"default"}')
    )
    monkeypatch.setattr(chat_engine_module, "send_chat_message", send_chat_message)
    monkeypatch.setattr(
        chat_engine_module,
        "bus",
        SimpleNamespace(
            ai_response_ready=SimpleNamespace(emit=lambda *_args: None),
            balloon_show=SimpleNamespace(emit=lambda *_args: None),
        ),
    )

    lily_text = await engine.handle_system_message("学習クエスト達成です。+2 XP 獲得しました。")

    assert lily_text == "了解したよ"
    session_mgr.save_message.assert_any_await("system", "学習クエスト達成です。+2 XP 獲得しました。")
    session_mgr.save_message.assert_any_await("assistant", "了解したよ")

    messages = send_chat_message.await_args.kwargs["messages"]
    system_messages = [message for message in messages if message["role"] == "system"]
    assert len(system_messages) == 2
    assert system_messages[1]["content"] == "システム通知: 学習クエスト達成です。+2 XP 獲得しました。"
    assert [message for message in messages if message["role"] == "system" and message["content"] == "過去のシステム通知"] == []
    assert engine._history == [
        {"role": "user", "content": "前のユーザー発話"},
        {"role": "assistant", "content": "前のリリィ応答"},
        {"role": "assistant", "content": "了解したよ"},
    ]


@pytest.mark.asyncio
async def test_load_session_history_keeps_system_messages_out_of_prompt_history():
    api = _make_api()
    api.get_chat_messages.return_value = [
        {
            "id": "m1",
            "sessionId": "chat_1",
            "role": "system",
            "content": "橋から来た通知",
            "createdAt": "2026-04-04T21:15:00+09:00",
        },
        {
            "id": "m2",
            "sessionId": "chat_1",
            "role": "user",
            "content": "こんにちは",
            "createdAt": "2026-04-04T21:16:00+09:00",
        },
    ]
    engine = ChatEngine(
        config=SimpleNamespace(openai=SimpleNamespace(api_key="", chat_model="")),
        api_client=api,
        session_mgr=SimpleNamespace(current_session_id="chat_1", save_message=AsyncMock()),
    )

    await engine.load_session_history()

    assert engine._history == [{"role": "user", "content": "こんにちは"}]
    assert engine._current_session_messages[0]["role"] == "system"
