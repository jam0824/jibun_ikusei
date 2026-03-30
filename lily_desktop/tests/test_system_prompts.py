"""system_prompts のテスト"""

from __future__ import annotations

from ai.system_prompts import build_lily_system_prompt


def test_lily_prompt_mentions_jst_explicit_date_handling():
    prompt = build_lily_system_prompt(
        user={"level": 5, "totalXp": 123},
        skills=[],
        quests=[],
        recent_completions=[],
        activity_logs=[],
    )

    assert "JST 固定" in prompt
    assert "date 引数" in prompt
    assert "fromDate / toDate" in prompt


def test_lily_prompt_prefers_chat_messages_for_specific_day_content_questions():
    prompt = build_lily_system_prompt(
        user={"level": 5, "totalXp": 123},
        skills=[],
        quests=[],
        recent_completions=[],
        activity_logs=[],
    )

    assert "type=chat_messages" in prompt
    assert "chat_sessions はセッション一覧" in prompt
    assert "sessionId なしで全セッション横断検索" in prompt
