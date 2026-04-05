from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from core.background_event_runtime import register_background_event_handlers
from core.domain_events import (
    AppStarted,
    CaptureSnapshotRequested,
    CaptureSummaryDue,
    ChatAutoTalkDue,
    ChatFollowUpRequested,
    DomainEventHub,
    FitbitSyncRequested,
    HealthPlanetSyncRequested,
)
from core.job_manager import JobManager


class _FakeAutoConversation:
    def __init__(self):
        self.auto_talk_calls = 0
        self.auto_talk_sources: list[str | None] = []
        self.follow_up_calls: list[tuple[str, str]] = []
        self.auto_talk_started = asyncio.Event()
        self.follow_up_started = asyncio.Event()
        self.release_auto_talk = asyncio.Event()
        self.release_follow_up = asyncio.Event()

    async def run_auto_talk_job(self, forced_source: str | None = None) -> None:
        self.auto_talk_calls += 1
        self.auto_talk_sources.append(forced_source)
        self.auto_talk_started.set()
        await self.release_auto_talk.wait()

    async def run_follow_up_job(self, user_text: str, lily_text: str) -> None:
        self.follow_up_calls.append((user_text, lily_text))
        self.follow_up_started.set()
        await self.release_follow_up.wait()


class _FakeApp:
    def __init__(self):
        self.config = SimpleNamespace(
            healthplanet=SimpleNamespace(client_id="hp-client"),
        )
        self.fitbit_sync = object()
        self.auto_conversation = _FakeAutoConversation()
        self.healthplanet_calls: list[bool] = []
        self.fitbit_calls = 0
        self.capture_calls: list[str] = []
        self.summary_calls = 0
        self.healthplanet_started = asyncio.Event()
        self.fitbit_started = asyncio.Event()
        self.capture_started = asyncio.Event()
        self.capture_cancelled = asyncio.Event()
        self.capture_release = asyncio.Event()
        self.summary_started = asyncio.Event()
        self.summary_release = asyncio.Event()
        self.summary_second_finished = asyncio.Event()
        self.chat_auto_talk_events: list[ChatAutoTalkDue] = []
        self.chat_auto_talk_started = asyncio.Event()

    async def handle_healthplanet_sync_request(self, *, interactive_auth: bool) -> None:
        self.healthplanet_calls.append(interactive_auth)
        self.healthplanet_started.set()
        if len(self.healthplanet_calls) == 1:
            await self.capture_release.wait()

    async def handle_fitbit_sync_request(self) -> None:
        self.fitbit_calls += 1
        self.fitbit_started.set()
        if self.fitbit_calls == 1:
            await self.capture_release.wait()

    async def handle_chat_auto_talk_due(self, event: ChatAutoTalkDue) -> None:
        self.chat_auto_talk_events.append(event)
        self.chat_auto_talk_started.set()

    async def run_capture_snapshot_job(self) -> None:
        call_label = f"capture:{len(self.capture_calls) + 1}"
        self.capture_calls.append(call_label)
        self.capture_started.set()
        if len(self.capture_calls) == 1:
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.capture_cancelled.set()
                raise

    async def run_capture_summary_job(self) -> None:
        self.summary_calls += 1
        if self.summary_calls == 1:
            self.summary_started.set()
            await self.summary_release.wait()
        else:
            self.summary_second_finished.set()


@pytest.mark.asyncio
async def test_app_started_publishes_startup_sync_requests():
    app = _FakeApp()
    hub = DomainEventHub()
    manager = JobManager()
    register_background_event_handlers(app, hub, manager)

    seen: list[str] = []
    health_event = asyncio.Event()
    fitbit_event = asyncio.Event()

    async def on_health(_event: HealthPlanetSyncRequested) -> None:
        seen.append("health")
        health_event.set()

    async def on_fitbit(_event: FitbitSyncRequested) -> None:
        seen.append("fitbit")
        fitbit_event.set()

    hub.subscribe(HealthPlanetSyncRequested, on_health)
    hub.subscribe(FitbitSyncRequested, on_fitbit)

    hub.publish(AppStarted(source="startup"))

    await asyncio.wait_for(health_event.wait(), timeout=1)
    await asyncio.wait_for(fitbit_event.wait(), timeout=1)

    app.capture_release.set()
    await asyncio.wait_for(app.healthplanet_started.wait(), timeout=1)
    await asyncio.wait_for(app.fitbit_started.wait(), timeout=1)

    assert seen == ["health", "fitbit"]
    assert app.healthplanet_calls == [True]
    assert app.fitbit_calls == 1


@pytest.mark.asyncio
async def test_healthplanet_sync_requests_are_coalesced():
    app = _FakeApp()
    hub = DomainEventHub()
    manager = JobManager()
    register_background_event_handlers(app, hub, manager)

    hub.publish(HealthPlanetSyncRequested(source="timer", interactive_auth=False))
    await asyncio.wait_for(app.healthplanet_started.wait(), timeout=1)
    hub.publish(HealthPlanetSyncRequested(source="startup", interactive_auth=True))

    app.capture_release.set()
    for _ in range(50):
        if app.healthplanet_calls == [False, True]:
            break
        await asyncio.sleep(0.01)

    assert app.healthplanet_calls == [False, True]


@pytest.mark.asyncio
async def test_fitbit_sync_requests_are_coalesced():
    app = _FakeApp()
    hub = DomainEventHub()
    manager = JobManager()
    register_background_event_handlers(app, hub, manager)

    hub.publish(FitbitSyncRequested(source="startup"))
    await asyncio.wait_for(app.fitbit_started.wait(), timeout=1)
    hub.publish(FitbitSyncRequested(source="manual"))

    app.capture_release.set()
    for _ in range(50):
        if app.fitbit_calls == 2:
            break
        await asyncio.sleep(0.01)

    assert app.fitbit_calls == 2


@pytest.mark.asyncio
async def test_chat_auto_talk_delegates_to_app_handler():
    app = _FakeApp()
    hub = DomainEventHub()
    manager = JobManager()
    register_background_event_handlers(app, hub, manager)

    hub.publish(ChatAutoTalkDue(source="timer"))
    await asyncio.wait_for(app.chat_auto_talk_started.wait(), timeout=1)

    assert len(app.chat_auto_talk_events) == 1
    assert app.chat_auto_talk_events[0].source == "timer"


@pytest.mark.asyncio
async def test_chat_auto_talk_passes_forced_books_source_to_app_handler():
    app = _FakeApp()
    hub = DomainEventHub()
    manager = JobManager()
    register_background_event_handlers(app, hub, manager)

    hub.publish(ChatAutoTalkDue(source="debug", forced_source="books"))
    await asyncio.wait_for(app.chat_auto_talk_started.wait(), timeout=1)

    assert len(app.chat_auto_talk_events) == 1
    assert app.chat_auto_talk_events[0].forced_source == "books"


@pytest.mark.asyncio
async def test_chat_follow_up_uses_single_flight_drop():
    app = _FakeApp()
    hub = DomainEventHub()
    manager = JobManager()
    register_background_event_handlers(app, hub, manager)

    hub.publish(
        ChatFollowUpRequested(
            source="chat",
            user_text="hello",
            lily_text="hi",
        )
    )
    await asyncio.wait_for(app.auto_conversation.follow_up_started.wait(), timeout=1)
    hub.publish(
        ChatFollowUpRequested(
            source="chat",
            user_text="second",
            lily_text="response",
        )
    )

    app.auto_conversation.release_follow_up.set()
    await asyncio.sleep(0.05)

    assert app.auto_conversation.follow_up_calls == [("hello", "hi")]


@pytest.mark.asyncio
async def test_capture_snapshot_uses_latest_wins():
    app = _FakeApp()
    hub = DomainEventHub()
    manager = JobManager()
    register_background_event_handlers(app, hub, manager)

    hub.publish(CaptureSnapshotRequested(source="timer"))
    await asyncio.wait_for(app.capture_started.wait(), timeout=1)
    hub.publish(CaptureSnapshotRequested(source="timer"))

    await asyncio.wait_for(app.capture_cancelled.wait(), timeout=1)
    for _ in range(50):
        if app.capture_calls == ["capture:1", "capture:2"]:
            break
        await asyncio.sleep(0.01)

    assert app.capture_calls == ["capture:1", "capture:2"]


@pytest.mark.asyncio
async def test_capture_summary_uses_serial_policy():
    app = _FakeApp()
    hub = DomainEventHub()
    manager = JobManager()
    register_background_event_handlers(app, hub, manager)

    hub.publish(CaptureSummaryDue(source="timer"))
    hub.publish(CaptureSummaryDue(source="timer"))
    await asyncio.wait_for(app.summary_started.wait(), timeout=1)
    await asyncio.sleep(0.05)
    assert app.summary_calls == 1

    app.summary_release.set()
    await asyncio.wait_for(app.summary_second_finished.wait(), timeout=1)
    assert app.summary_calls == 2
