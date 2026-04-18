from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core.activity_capture_service import ActivityCaptureService, purge_raw_event_range
from core.active_window import ActiveWindowInfo


JST = timezone(timedelta(hours=9))


def _make_window(
    *,
    app_name: str = "Code.exe",
    window_title: str = "main.py - VS Code",
    domain: str = "",
    is_browser: bool = False,
    is_excluded: bool = False,
    exclude_reason: str = "",
) -> ActiveWindowInfo:
    return ActiveWindowInfo(
        app_name=app_name,
        window_title=window_title,
        domain=domain,
        is_browser=is_browser,
        is_excluded=is_excluded,
        exclude_reason=exclude_reason,
    )


def test_active_window_change_spools_raw_event(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path)
    service = ActivityCaptureService(
        device_id="device_1",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    created = service.poll_once(now=datetime(2026, 4, 17, 9, 0, tzinfo=JST))

    assert len(created) == 1
    assert created[0]["eventType"] == "active_window_changed"
    assert created[0]["deviceId"] == "device_1"
    assert created[0]["appName"] == "Code.exe"
    assert len(service.snapshot_recent_events()) == 1
    log_files = list(tmp_path.glob("*.jsonl"))
    assert len(log_files) == 1
    assert json.loads(log_files[0].read_text(encoding="utf-8").strip())["eventType"] == "active_window_changed"


def test_same_window_only_emits_heartbeat_after_30_seconds(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path)
    service = ActivityCaptureService(
        device_id="device_1",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    first = datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    second = first + timedelta(seconds=10)
    third = first + timedelta(seconds=31)

    assert [event["eventType"] for event in service.poll_once(now=first)] == ["active_window_changed"]
    assert service.poll_once(now=second) == []
    assert [event["eventType"] for event in service.poll_once(now=third)] == ["heartbeat"]


def test_idle_start_and_end_are_recorded(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path)
    idle_seconds = {"value": 0}
    service = ActivityCaptureService(
        device_id="device_1",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: idle_seconds["value"],
    )

    service.poll_once(now=datetime(2026, 4, 17, 9, 0, tzinfo=JST))
    idle_seconds["value"] = 301
    service.poll_once(now=datetime(2026, 4, 17, 9, 6, tzinfo=JST))
    idle_seconds["value"] = 0
    service.poll_once(now=datetime(2026, 4, 17, 9, 7, tzinfo=JST))

    event_types = [event["eventType"] for event in service.snapshot_recent_events()]
    assert "idle_started" in event_types
    assert "idle_ended" in event_types


def test_ingest_browser_event_normalizes_extension_event_and_keeps_elapsed_seconds(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path)
    service = ActivityCaptureService(
        device_id="device_1",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    created = service.ingest_browser_event(
        event_type="heartbeat",
        source="chrome_extension",
        occurred_at=datetime(2026, 4, 17, 9, 5, tzinfo=JST),
        payload={
            "tabId": 12,
            "url": "https://developer.chrome.com/docs/extensions/",
            "domain": "developer.chrome.com",
            "title": "Chrome Extensions",
        },
        metadata={
            "trigger": "flush",
            "elapsedSeconds": 42,
        },
    )

    assert created is not None
    assert created["source"] == "chrome_extension"
    assert created["eventType"] == "heartbeat"
    assert created["url"] == "https://developer.chrome.com/docs/extensions/"
    assert created["metadata"]["elapsedSeconds"] == 42


def test_paused_state_blocks_new_events(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path)
    service = ActivityCaptureService(
        device_id="device_1",
        initial_state="paused",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    assert service.poll_once(now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)) == []
    assert (
        service.ingest_browser_event(
            event_type="browser_page_changed",
            source="chrome_extension",
            occurred_at=datetime(2026, 4, 17, 9, 0, tzinfo=JST),
            payload={
                "tabId": 1,
                "url": "https://example.com",
                "domain": "example.com",
                "title": "Example",
            },
            metadata={"trigger": "tab_activated"},
        )
        is None
    )


def test_disabled_state_does_not_start(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path)
    service = ActivityCaptureService(
        device_id="device_1",
        initial_state="disabled",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    assert service.start() is False
    assert service.is_running is False
    assert service.snapshot_recent_events() == []


def test_excluded_and_domain_only_privacy_rules_are_applied(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path)
    service = ActivityCaptureService(
        device_id="device_1",
        privacy_rules=[
            {
                "id": "rule_domain_only",
                "type": "domain",
                "value": "developer.chrome.com",
                "mode": "domain_only",
                "enabled": True,
                "updatedAt": "2026-04-17T08:00:00+09:00",
            }
        ],
        get_active_window_info=lambda: _make_window(is_excluded=True, exclude_reason="secret"),
        get_idle_seconds=lambda: 0,
    )

    assert service.poll_once(now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)) == []
    created = service.ingest_browser_event(
        event_type="browser_page_changed",
        source="chrome_extension",
        occurred_at=datetime(2026, 4, 17, 9, 10, tzinfo=JST),
        payload={
            "tabId": 1,
            "url": "https://developer.chrome.com/docs/extensions/",
            "domain": "developer.chrome.com",
            "title": "Chrome Extensions",
        },
        metadata={"trigger": "tab_activated"},
    )

    assert created is not None
    assert "url" not in created
    assert created["domain"] == "developer.chrome.com"


def test_desktop_events_allow_empty_file_context_fields(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path)
    service = ActivityCaptureService(
        device_id="device_1",
        get_active_window_info=lambda: _make_window(app_name="Code.exe", window_title="README.md - VS Code"),
        get_idle_seconds=lambda: 0,
    )

    created = service.poll_once(now=datetime(2026, 4, 17, 9, 0, tzinfo=JST))

    assert len(created) == 1
    assert "projectName" not in created[0]
    assert "fileName" not in created[0]


def test_pending_snapshot_returns_oldest_unsent_events_first(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path / "raw")
    monkeypatch.setattr(
        "core.activity_capture_service._SYNC_STATE_PATH",
        tmp_path / "sync_state.json",
    )
    service = ActivityCaptureService(
        device_id="device_1",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    for minute in (0, 5, 10):
        service.ingest_browser_event(
            event_type="browser_page_changed",
            source="chrome_extension",
            occurred_at=datetime(2026, 4, 17, 9, minute, tzinfo=JST),
            payload={
                "tabId": minute + 1,
                "url": f"https://example.com/{minute}",
                "domain": "example.com",
                "title": f"Page {minute}",
            },
            metadata={"trigger": "tab_activated"},
        )

    pending = service.snapshot_pending_raw_events(limit=2)

    assert [entry["event"]["occurredAt"] for entry in pending] == [
        "2026-04-17T09:00:00+09:00",
        "2026-04-17T09:05:00+09:00",
    ]
    assert [entry["lineNumber"] for entry in pending] == [1, 2]


def test_acknowledged_events_do_not_reappear_in_pending_snapshot(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path / "raw")
    monkeypatch.setattr(
        "core.activity_capture_service._SYNC_STATE_PATH",
        tmp_path / "sync_state.json",
    )
    service = ActivityCaptureService(
        device_id="device_1",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    for minute in (0, 5):
        service.ingest_browser_event(
            event_type="browser_page_changed",
            source="chrome_extension",
            occurred_at=datetime(2026, 4, 17, 9, minute, tzinfo=JST),
            payload={
                "tabId": minute + 1,
                "url": f"https://example.com/{minute}",
                "domain": "example.com",
                "title": f"Page {minute}",
            },
            metadata={"trigger": "tab_activated"},
        )

    pending = service.snapshot_pending_raw_events()
    service.ack_pending_raw_events([pending[0]])

    remaining = service.snapshot_pending_raw_events()

    assert [entry["event"]["occurredAt"] for entry in remaining] == [
        "2026-04-17T09:05:00+09:00"
    ]


def test_partial_ack_leaves_only_unacked_lines_pending(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path / "raw")
    monkeypatch.setattr(
        "core.activity_capture_service._SYNC_STATE_PATH",
        tmp_path / "sync_state.json",
    )
    service = ActivityCaptureService(
        device_id="device_1",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    for minute in (0, 5, 10):
        service.ingest_browser_event(
            event_type="heartbeat",
            source="chrome_extension",
            occurred_at=datetime(2026, 4, 17, 9, minute, tzinfo=JST),
            payload={
                "tabId": minute + 1,
                "url": f"https://example.com/{minute}",
                "domain": "example.com",
                "title": f"Page {minute}",
            },
            metadata={"trigger": "flush", "elapsedSeconds": 30},
        )

    pending = service.snapshot_pending_raw_events()
    service.ack_pending_raw_events(pending[:2])

    remaining = service.snapshot_pending_raw_events()

    assert [entry["event"]["occurredAt"] for entry in remaining] == [
        "2026-04-17T09:10:00+09:00"
    ]
    assert remaining[0]["lineNumber"] == 3


def test_paused_and_disabled_states_do_not_expose_pending_sync_snapshot(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path / "raw")
    monkeypatch.setattr(
        "core.activity_capture_service._SYNC_STATE_PATH",
        tmp_path / "sync_state.json",
    )

    paused_service = ActivityCaptureService(
        device_id="device_1",
        initial_state="paused",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )
    disabled_service = ActivityCaptureService(
        device_id="device_2",
        initial_state="disabled",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    assert paused_service.snapshot_pending_raw_events() == []
    assert disabled_service.snapshot_pending_raw_events() == []


def test_set_privacy_rules_replaces_runtime_rules(tmp_path, monkeypatch):
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", tmp_path)
    service = ActivityCaptureService(
        device_id="device_1",
        privacy_rules=[],
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    service.set_privacy_rules(
        [
            {
                "id": "rule_domain_only",
                "type": "domain",
                "value": "developer.chrome.com",
                "mode": "domain_only",
                "enabled": True,
                "updatedAt": "2026-04-17T08:00:00+09:00",
            }
        ]
    )
    created = service.ingest_browser_event(
        event_type="browser_page_changed",
        source="chrome_extension",
        occurred_at=datetime(2026, 4, 17, 9, 0, tzinfo=JST),
        payload={
            "tabId": 1,
            "url": "https://developer.chrome.com/docs/extensions/",
            "domain": "developer.chrome.com",
            "title": "Chrome Extensions",
        },
        metadata={"trigger": "tab_activated"},
    )

    assert created is not None
    assert created["domain"] == "developer.chrome.com"
    assert "url" not in created


def test_purge_raw_event_range_removes_matching_files_and_sync_state(tmp_path, monkeypatch):
    raw_dir = tmp_path / "raw"
    sync_state_path = tmp_path / "sync_state.json"
    monkeypatch.setattr("core.activity_capture_service._RAW_EVENT_LOG_DIR", raw_dir)
    monkeypatch.setattr("core.activity_capture_service._SYNC_STATE_PATH", sync_state_path)

    service = ActivityCaptureService(
        device_id="device_1",
        get_active_window_info=lambda: _make_window(),
        get_idle_seconds=lambda: 0,
    )

    for date_value in (
        datetime(2026, 4, 16, 9, 0, tzinfo=JST),
        datetime(2026, 4, 17, 9, 0, tzinfo=JST),
    ):
        service.ingest_browser_event(
            event_type="browser_page_changed",
            source="chrome_extension",
            occurred_at=date_value,
            payload={
                "tabId": date_value.day,
                "url": f"https://example.com/{date_value.day}",
                "domain": "example.com",
                "title": f"Page {date_value.day}",
            },
            metadata={"trigger": "tab_activated"},
        )

    pending = service.snapshot_pending_raw_events()
    service.ack_pending_raw_events([pending[0]])

    purge_raw_event_range(
        from_date="2026-04-16",
        to_date="2026-04-16",
        raw_event_log_dir=raw_dir,
        sync_state_path=sync_state_path,
    )

    assert not (raw_dir / "2026-04-16.jsonl").exists()
    assert (raw_dir / "2026-04-17.jsonl").exists()
    remaining = json.loads(sync_state_path.read_text(encoding="utf-8"))
    assert "2026-04-16.jsonl" not in remaining["files"]
    assert service.snapshot_pending_raw_events() == [
        {
            "event": {
                "id": service.snapshot_pending_raw_events()[0]["event"]["id"],
                "deviceId": "device_1",
                "source": "chrome_extension",
                "eventType": "browser_page_changed",
                "occurredAt": "2026-04-17T09:00:00+09:00",
                "expiresAt": "2026-05-17T09:00:00+09:00",
                "windowTitle": "Page 17",
                "url": "https://example.com/17",
                "domain": "example.com",
                "metadata": {"trigger": "tab_activated", "tabId": 17},
            },
            "fileName": "2026-04-17.jsonl",
            "lineNumber": 1,
        }
    ]
