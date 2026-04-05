from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import main as main_mod
from core.domain_events import (
    AppStarted,
    CaptureSnapshotRequested,
    CaptureSummaryDue,
    HealthPlanetSyncRequested,
)


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
