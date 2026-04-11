from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from ai.auto_conversation import AutoConversation
from core.domain_events import ChatAutoTalkDue, ChatFollowUpRequested


class _FakeQTimer:
    def __init__(self):
        self.connected = None
        self.started_interval = None
        self.stopped = False
        self.single_shot = None
        self.timeout = self

    def setSingleShot(self, value: bool) -> None:
        self.single_shot = value

    def connect(self, callback) -> None:
        self.connected = callback

    def start(self, interval_ms: int) -> None:
        self.started_interval = interval_ms

    def stop(self) -> None:
        self.stopped = True


class _FakeSeedManager:
    def __init__(self, *args, **kwargs):
        self._camera_device_index = None


class _CaptureHub:
    def __init__(self, return_value=()):
        self.events: list[object] = []
        self.return_value = return_value

    def publish(self, event):
        self.events.append(event)
        return self.return_value


def _make_config():
    return SimpleNamespace(
        openai=SimpleNamespace(
            api_key="test-key",
            screen_analysis_model="test-screen",
            chat_model="test-chat",
        ),
        annict=SimpleNamespace(access_token=""),
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


@pytest.fixture
def patched_auto_conversation(monkeypatch):
    import ai.auto_conversation as mod

    monkeypatch.setattr(mod, "QTimer", _FakeQTimer)
    monkeypatch.setattr(mod, "TalkSeedManager", _FakeSeedManager)
    return mod


def test_timer_publishes_chat_auto_talk_due_when_event_hub_exists(patched_auto_conversation, monkeypatch):
    hub = _CaptureHub()
    conv = AutoConversation(_make_config(), SimpleNamespace(), event_hub=hub)
    run_mock = AsyncMock()
    monkeypatch.setattr(conv, "_run_conversation", run_mock)

    conv._on_timer()

    assert len(hub.events) == 1
    assert isinstance(hub.events[0], ChatAutoTalkDue)
    run_mock.assert_not_called()


def test_trigger_follow_up_publishes_event_when_event_hub_exists(patched_auto_conversation):
    hub = _CaptureHub()
    conv = AutoConversation(_make_config(), SimpleNamespace(), event_hub=hub)

    conv.trigger_follow_up("user", "lily")

    assert len(hub.events) == 1
    event = hub.events[0]
    assert isinstance(event, ChatFollowUpRequested)
    assert event.user_text == "user"
    assert event.lily_text == "lily"


@pytest.mark.asyncio
async def test_trigger_follow_up_returns_published_tasks_when_event_hub_exists(patched_auto_conversation):
    task = asyncio.create_task(asyncio.sleep(0))
    hub = _CaptureHub(return_value=(task,))
    conv = AutoConversation(_make_config(), SimpleNamespace(), event_hub=hub)

    result = conv.trigger_follow_up("user", "lily")

    assert result == (task,)
    await asyncio.gather(*result)


def test_trigger_books_now_publishes_forced_books_event_when_event_hub_exists(patched_auto_conversation):
    hub = _CaptureHub()
    conv = AutoConversation(_make_config(), SimpleNamespace(), event_hub=hub)

    conv.trigger_books_now()

    assert len(hub.events) == 1
    event = hub.events[0]
    assert isinstance(event, ChatAutoTalkDue)
    assert event.forced_source == "books"


def test_trigger_quest_weekly_now_publishes_forced_quest_weekly_event_when_event_hub_exists(patched_auto_conversation):
    hub = _CaptureHub()
    conv = AutoConversation(_make_config(), SimpleNamespace(), event_hub=hub)

    conv.trigger_quest_weekly_now()

    assert len(hub.events) == 1
    event = hub.events[0]
    assert isinstance(event, ChatAutoTalkDue)
    assert event.forced_source == "quest_weekly"


def test_trigger_quest_today_now_publishes_forced_quest_today_event_when_event_hub_exists(patched_auto_conversation):
    hub = _CaptureHub()
    conv = AutoConversation(_make_config(), SimpleNamespace(), event_hub=hub)

    conv.trigger_quest_today_now()

    assert len(hub.events) == 1
    event = hub.events[0]
    assert isinstance(event, ChatAutoTalkDue)
    assert event.forced_source == "quest_today"


def test_trigger_memory_now_publishes_forced_memory_event_when_event_hub_exists(patched_auto_conversation):
    hub = _CaptureHub()
    conv = AutoConversation(_make_config(), SimpleNamespace(), event_hub=hub)

    conv.trigger_memory_now()

    assert len(hub.events) == 1
    event = hub.events[0]
    assert isinstance(event, ChatAutoTalkDue)
    assert event.forced_source == "memory"


@pytest.mark.asyncio
async def test_interrupt_keeps_existing_behavior_and_cancels_prefetch_task(patched_auto_conversation):
    conv = AutoConversation(_make_config(), SimpleNamespace(), event_hub=_CaptureHub())
    conv._is_talking = True
    conv._prefetch_task = asyncio.create_task(asyncio.sleep(10))

    conv.interrupt()
    await asyncio.sleep(0)

    assert conv._interrupted is True
    assert conv._prefetch_task.cancelled()
