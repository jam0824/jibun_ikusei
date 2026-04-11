from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import main as main_mod
from core.domain_events import (
    AppStarted,
    CaptureSnapshotRequested,
    CaptureSummaryDue,
    ChatAutoTalkDue,
    HealthPlanetSyncRequested,
)
from core.job_manager import JobManager


JST = timezone(timedelta(hours=9))


class _CaptureHub:
    def __init__(self) -> None:
        self.events: list[object] = []

    def publish(self, event):
        self.events.append(event)
        return ()


def test_start_healthplanet_sync_publishes_event_when_event_hub_exists():
    hub = _CaptureHub()
    app = SimpleNamespace(event_hub=hub)

    main_mod.App.start_healthplanet_sync(app, interactive_auth=False)

    assert len(hub.events) == 1
    event = hub.events[0]
    assert isinstance(event, HealthPlanetSyncRequested)
    assert event.interactive_auth is False


def test_camera_and_summary_timers_publish_events_when_event_hub_exists():
    hub = _CaptureHub()
    app = SimpleNamespace(event_hub=hub)

    main_mod.App._on_camera_timer(app)
    main_mod.App._on_summary_timer(app)

    assert len(hub.events) == 2
    assert isinstance(hub.events[0], CaptureSnapshotRequested)
    assert isinstance(hub.events[1], CaptureSummaryDue)


def test_books_talk_request_publishes_forced_books_event():
    hub = _CaptureHub()
    app = SimpleNamespace(event_hub=hub, auto_conversation=SimpleNamespace(trigger_books_now=Mock()))

    main_mod.App._on_books_talk_requested(app)

    assert len(hub.events) == 1
    event = hub.events[0]
    assert isinstance(event, ChatAutoTalkDue)
    assert event.forced_source == "books"


def test_quest_weekly_talk_request_publishes_forced_quest_weekly_event():
    hub = _CaptureHub()
    app = SimpleNamespace(
        event_hub=hub,
        auto_conversation=SimpleNamespace(trigger_quest_weekly_now=Mock()),
    )

    main_mod.App._on_quest_weekly_talk_requested(app)

    assert len(hub.events) == 1
    event = hub.events[0]
    assert isinstance(event, ChatAutoTalkDue)
    assert event.forced_source == "quest_weekly"


def test_quest_today_talk_request_publishes_forced_quest_today_event():
    hub = _CaptureHub()
    app = SimpleNamespace(
        event_hub=hub,
        auto_conversation=SimpleNamespace(trigger_quest_today_now=Mock()),
    )

    main_mod.App._on_quest_today_talk_requested(app)

    assert len(hub.events) == 1
    event = hub.events[0]
    assert isinstance(event, ChatAutoTalkDue)
    assert event.forced_source == "quest_today"


@pytest.mark.asyncio
async def test_async_init_publishes_app_started_without_direct_startup_sync():
    hub = _CaptureHub()
    fitbit_sync = SimpleNamespace(run=AsyncMock())
    app = SimpleNamespace(
        auth=SimpleNamespace(is_configured=False),
        auto_conversation=SimpleNamespace(start=Mock(), set_tts=Mock()),
        config=SimpleNamespace(
            voice=SimpleNamespace(enabled=False, google_api_key=""),
            tts=SimpleNamespace(enabled=False),
            camera=SimpleNamespace(enabled=False),
            healthplanet=SimpleNamespace(client_id="hp-client"),
        ),
        event_hub=hub,
        fitbit_sync=fitbit_sync,
        session_mgr=SimpleNamespace(create_new_session=AsyncMock()),
        start_camera_system=Mock(),
        start_healthplanet_timer=Mock(),
        start_healthplanet_sync=Mock(),
        voice_pipeline=None,
        tts_engine=None,
    )

    await main_mod.async_init(app)

    app.auto_conversation.start.assert_called_once()
    app.start_healthplanet_timer.assert_called_once()
    app.start_healthplanet_sync.assert_not_called()
    fitbit_sync.run.assert_not_awaited()
    assert len(hub.events) == 1
    assert isinstance(hub.events[0], AppStarted)


class _FakeChatEngine:
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self.calls: list[str] = []

    async def handle_user_message(self, text: str) -> str | None:
        self.calls.append(text)
        self.started.set()
        await self.release.wait()
        return "lily-response"


class _FakeAutoConversation:
    def __init__(self) -> None:
        self.follow_up_calls: list[tuple[str, str]] = []
        self.follow_up_started = asyncio.Event()
        self.follow_up_release = asyncio.Event()
        self.auto_talk_calls: list[str | None] = []
        self.auto_talk_started = asyncio.Event()
        self.auto_talk_release = asyncio.Event()

    def trigger_follow_up(self, user_text: str, lily_text: str):
        self.follow_up_calls.append((user_text, lily_text))

        async def wait_follow_up() -> None:
            self.follow_up_started.set()
            await self.follow_up_release.wait()

        return (asyncio.create_task(wait_follow_up()),)

    async def run_auto_talk_job(self, forced_source: str | None = None) -> None:
        self.auto_talk_calls.append(forced_source)
        self.auto_talk_started.set()
        await self.auto_talk_release.wait()


class _FakeChromeAudibleTabsTracker:
    def __init__(self, matching_domain: str | None = None) -> None:
        self.matching_domain = matching_domain

    def find_fresh_matching_domain(
        self,
        domains: list[str],
        *,
        now: datetime | None = None,
    ) -> str | None:
        del domains, now
        return self.matching_domain


def _make_conversation_app():
    app = object.__new__(main_mod.App)
    app.chat_engine = _FakeChatEngine()
    app.auto_conversation = _FakeAutoConversation()
    app.job_manager = JobManager()
    app.active_user_conversation = False
    app.pending_periodic_auto_talk = None
    app.pending_periodic_expires_at = None
    app.config = SimpleNamespace(
        chat=SimpleNamespace(
            auto_talk_skip_audible_domains=[
                "youtube.com",
                "netflix.com",
                "primevideo.com",
            ]
        )
    )
    app.chrome_audible_tabs_tracker = _FakeChromeAudibleTabsTracker()
    return app


class _FakeVoicePipeline:
    def __init__(self, *, is_running: bool = True) -> None:
        self.is_running = is_running
        self.pause_calls = 0
        self.resume_calls = 0

    def pause(self) -> None:
        self.pause_calls += 1

    def resume(self) -> None:
        self.resume_calls += 1


def test_tts_started_pauses_voice_pipeline_when_enabled():
    voice_pipeline = _FakeVoicePipeline()
    app = SimpleNamespace(
        config=SimpleNamespace(voice=SimpleNamespace(pause_during_tts=True)),
        voice_pipeline=voice_pipeline,
    )

    main_mod.App._on_tts_started(app)

    assert voice_pipeline.pause_calls == 1


def test_tts_finished_resumes_voice_pipeline_when_enabled():
    voice_pipeline = _FakeVoicePipeline()
    app = SimpleNamespace(
        config=SimpleNamespace(voice=SimpleNamespace(pause_during_tts=True)),
        voice_pipeline=voice_pipeline,
    )

    main_mod.App._on_tts_finished(app)

    assert voice_pipeline.resume_calls == 1


def test_tts_handlers_leave_voice_pipeline_running_when_pause_disabled():
    voice_pipeline = _FakeVoicePipeline()
    app = SimpleNamespace(
        config=SimpleNamespace(voice=SimpleNamespace(pause_during_tts=False)),
        voice_pipeline=voice_pipeline,
    )

    main_mod.App._on_tts_started(app)
    main_mod.App._on_tts_finished(app)

    assert voice_pipeline.pause_calls == 0
    assert voice_pipeline.resume_calls == 0


@pytest.mark.asyncio
async def test_periodic_auto_talk_waits_until_follow_up_finishes():
    app = _make_conversation_app()
    user_task = asyncio.create_task(app._handle_user_message_with_follow_up("hello"))

    await asyncio.wait_for(app.chat_engine.started.wait(), timeout=1)
    app.chat_engine.release.set()
    await asyncio.wait_for(app.auto_conversation.follow_up_started.wait(), timeout=1)

    await app.handle_chat_auto_talk_due(
        ChatAutoTalkDue(
            source="auto_conversation.timer",
            occurred_at=datetime.now(JST),
        )
    )

    assert app.active_user_conversation is True
    assert app.pending_periodic_auto_talk is not None
    assert app.auto_conversation.auto_talk_started.is_set() is False

    app.auto_conversation.follow_up_release.set()
    await asyncio.wait_for(app.auto_conversation.auto_talk_started.wait(), timeout=1)
    app.auto_conversation.auto_talk_release.set()
    await user_task

    assert app.auto_conversation.follow_up_calls == [("hello", "lily-response")]
    assert app.auto_conversation.auto_talk_calls == [None]
    assert app.pending_periodic_auto_talk is None


@pytest.mark.asyncio
async def test_periodic_auto_talk_skips_when_matching_audible_tab_exists():
    app = _make_conversation_app()
    app.chrome_audible_tabs_tracker = _FakeChromeAudibleTabsTracker("youtube.com")

    await app.handle_chat_auto_talk_due(
        ChatAutoTalkDue(
            source="auto_conversation.timer",
            occurred_at=datetime.now(JST),
        )
    )

    await asyncio.sleep(0.05)

    assert app.auto_conversation.auto_talk_started.is_set() is False
    assert app.auto_conversation.auto_talk_calls == []


@pytest.mark.asyncio
async def test_periodic_auto_talk_keeps_only_latest_pending_request():
    app = _make_conversation_app()
    user_task = asyncio.create_task(app._handle_user_message_with_follow_up("hello"))

    await asyncio.wait_for(app.chat_engine.started.wait(), timeout=1)
    app.chat_engine.release.set()
    await asyncio.wait_for(app.auto_conversation.follow_up_started.wait(), timeout=1)

    first = ChatAutoTalkDue(
        source="auto_conversation.timer",
        occurred_at=datetime.now(JST),
    )
    second = ChatAutoTalkDue(
        source="auto_conversation.timer",
        occurred_at=datetime.now(JST) + timedelta(seconds=10),
    )

    await app.handle_chat_auto_talk_due(first)
    await app.handle_chat_auto_talk_due(second)

    assert app.pending_periodic_auto_talk is second
    assert app.auto_conversation.auto_talk_started.is_set() is False

    app.auto_conversation.follow_up_release.set()
    await asyncio.wait_for(app.auto_conversation.auto_talk_started.wait(), timeout=1)
    app.auto_conversation.auto_talk_release.set()
    await user_task

    assert app.auto_conversation.auto_talk_calls == [None]


@pytest.mark.asyncio
async def test_expired_periodic_auto_talk_is_dropped_after_conversation():
    app = _make_conversation_app()
    user_task = asyncio.create_task(app._handle_user_message_with_follow_up("hello"))

    await asyncio.wait_for(app.chat_engine.started.wait(), timeout=1)
    app.chat_engine.release.set()
    await asyncio.wait_for(app.auto_conversation.follow_up_started.wait(), timeout=1)

    await app.handle_chat_auto_talk_due(
        ChatAutoTalkDue(
            source="auto_conversation.timer",
            occurred_at=datetime.now(JST) - timedelta(minutes=6),
        )
    )

    app.auto_conversation.follow_up_release.set()
    await user_task
    await asyncio.sleep(0.05)

    assert app.auto_conversation.auto_talk_started.is_set() is False
    assert app.auto_conversation.auto_talk_calls == []
    assert app.pending_periodic_auto_talk is None


@pytest.mark.asyncio
async def test_pending_periodic_auto_talk_is_skipped_when_matching_audible_tab_exists_on_drain():
    app = _make_conversation_app()
    user_task = asyncio.create_task(app._handle_user_message_with_follow_up("hello"))

    await asyncio.wait_for(app.chat_engine.started.wait(), timeout=1)
    app.chat_engine.release.set()
    await asyncio.wait_for(app.auto_conversation.follow_up_started.wait(), timeout=1)

    await app.handle_chat_auto_talk_due(
        ChatAutoTalkDue(
            source="auto_conversation.timer",
            occurred_at=datetime.now(JST),
        )
    )
    app.chrome_audible_tabs_tracker = _FakeChromeAudibleTabsTracker("netflix.com")

    app.auto_conversation.follow_up_release.set()
    await user_task
    await asyncio.sleep(0.05)

    assert app.auto_conversation.auto_talk_started.is_set() is False
    assert app.auto_conversation.auto_talk_calls == []
    assert app.pending_periodic_auto_talk is None


@pytest.mark.asyncio
async def test_manual_and_books_auto_talk_run_immediately_while_idle():
    app = _make_conversation_app()
    app.chrome_audible_tabs_tracker = _FakeChromeAudibleTabsTracker("youtube.com")

    manual_task = asyncio.create_task(
        app.handle_chat_auto_talk_due(ChatAutoTalkDue(source="auto_conversation.manual"))
    )
    await asyncio.wait_for(app.auto_conversation.auto_talk_started.wait(), timeout=1)
    app.auto_conversation.auto_talk_release.set()
    await manual_task

    app.auto_conversation.auto_talk_started = asyncio.Event()
    app.auto_conversation.auto_talk_release = asyncio.Event()

    books_task = asyncio.create_task(
        app.handle_chat_auto_talk_due(
            ChatAutoTalkDue(
                source="auto_conversation.manual_books",
                forced_source="books",
            )
        )
    )
    await asyncio.wait_for(app.auto_conversation.auto_talk_started.wait(), timeout=1)
    app.auto_conversation.auto_talk_release.set()
    await books_task

    assert app.auto_conversation.auto_talk_calls == [None, "books"]
