from __future__ import annotations

from types import SimpleNamespace

import pytest

from ai.auto_conversation import AutoConversation
from ai.openai_client import TextResult
from ai.talk_seed import TalkSeed


class _FakeQTimer:
    def __init__(self):
        self.timeout = self

    def setSingleShot(self, value: bool) -> None:
        return None

    def connect(self, callback) -> None:
        return None

    def start(self, interval_ms: int) -> None:
        return None

    def stop(self) -> None:
        return None


def _make_config():
    return SimpleNamespace(
        openai=SimpleNamespace(
            api_key="test-key",
            screen_analysis_model="test-screen",
            chat_model="test-chat",
        ),
        annict=SimpleNamespace(access_token=""),
        rakuten=SimpleNamespace(application_id="", access_key=""),
        camera=SimpleNamespace(enabled=False, analysis_model="test-camera"),
        talk_seeds=SimpleNamespace(interest_topics=[]),
        chat=SimpleNamespace(
            auto_talk_interval_minutes=15,
            auto_talk_min_turns=3,
            auto_talk_max_turns=5,
            follow_up_min_extra=1,
            follow_up_max_extra=3,
        ),
    )


@pytest.mark.asyncio
async def test_generate_lily_adds_first_line_hint_for_books(monkeypatch):
    import ai.auto_conversation as mod

    captured_messages: list[dict[str, str]] = []

    async def fake_send_chat_message(**kwargs):
        captured_messages.extend(kwargs["messages"])
        return TextResult(content='{"text":"本の話しよう","pose_category":"default"}')

    monkeypatch.setattr(mod, "QTimer", _FakeQTimer)
    monkeypatch.setattr(mod, "send_chat_message", fake_send_chat_message)

    conv = AutoConversation(_make_config(), SimpleNamespace())
    seed = TalkSeed(
        summary="楽天Books売れ筋の本『習慣の本』。毎日を整える小さな習慣の本。",
        tags=["本", "習慣", "売れ筋"],
        source="books",
        lily_perspective="本の内容から話題を振る",
        haruka_perspective="本の内容にリアクションする",
    )

    text, pose = await conv._generate_lily(seed, conv_history=[], is_last_turn=False)

    assert text == "本の話しよう"
    assert pose == "default"
    assert "何の話かが伝わるひと言から始めてください。" in captured_messages[0]["content"]
