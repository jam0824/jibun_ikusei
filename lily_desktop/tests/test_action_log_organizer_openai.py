from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from ai.openai_client import StructuredJsonResult
from core.action_log_organizer import ActionLogOrganizer


JST = timezone(timedelta(hours=9))


def _event(
    event_id: str,
    occurred_at: datetime,
    *,
    device_id: str = "device_1",
    source: str = "desktop_agent",
    event_type: str = "active_window_changed",
    app_name: str | None = None,
    window_title: str | None = None,
    domain: str | None = None,
    project_name: str | None = None,
    file_name: str | None = None,
) -> dict:
    payload = {
        "id": event_id,
        "deviceId": device_id,
        "source": source,
        "eventType": event_type,
        "occurredAt": occurred_at.isoformat(timespec="seconds"),
        "expiresAt": (occurred_at + timedelta(days=30)).isoformat(timespec="seconds"),
    }
    if app_name:
        payload["appName"] = app_name
    if window_title:
        payload["windowTitle"] = window_title
    if domain:
        payload["domain"] = domain
    if project_name:
        payload["projectName"] = project_name
    if file_name:
        payload["fileName"] = file_name
    return payload


def _write_spool(log_dir: Path, date_key: str, events: list[dict]) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{date_key}.jsonl"
    with open(log_path, "w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")


@dataclass
class _FakeApiClient:
    existing_sessions: list[dict] | None = None
    existing_open_loops: list[dict] | None = None
    put_sessions_calls: list[dict] | None = None
    put_open_loops_calls: list[dict] | None = None
    get_session_calls: list[tuple[str, str]] | None = None
    get_open_loop_calls: list[tuple[str, str]] | None = None

    def __post_init__(self) -> None:
        self.existing_sessions = list(self.existing_sessions or [])
        self.existing_open_loops = list(self.existing_open_loops or [])
        self.put_sessions_calls = []
        self.put_open_loops_calls = []
        self.get_session_calls = []
        self.get_open_loop_calls = []

    async def get_action_log_sessions(self, from_date: str, to_date: str) -> list[dict]:
        self.get_session_calls.append((from_date, to_date))
        return list(self.existing_sessions)

    async def get_action_log_open_loops(self, from_date: str, to_date: str) -> list[dict]:
        self.get_open_loop_calls.append((from_date, to_date))
        return list(self.existing_open_loops)

    async def put_action_log_sessions(self, payload: dict) -> dict:
        self.put_sessions_calls.append(payload)
        return {"updated": len(payload["sessions"])}

    async def put_action_log_open_loops(self, payload: dict) -> dict:
        self.put_open_loops_calls.append(payload)
        return {"updated": len(payload["openLoops"])}


def _make_processing_config(**overrides):
    base = {
        "enabled": True,
        "provider": "openai",
        "base_url": "http://127.0.0.1:11434",
        "model": "gpt-5-nano",
        "max_completion_tokens": 222,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _extract_session_ids(input_payload: dict) -> list[str]:
    ids: list[str] = []
    for date_entry in input_payload.get("dateSessions", []):
        for session in date_entry.get("sessions", []):
            session_id = str(session.get("sessionId") or "").strip()
            if session_id:
                ids.append(session_id)
    return ids


def _build_result_for_ids(session_ids: list[str]) -> StructuredJsonResult:
    return StructuredJsonResult(
        output={
            "sessions": [
                {
                    "sessionId": session_id,
                    "title": f"AI title {index + 1}",
                    "primaryCategory": "その他",
                    "activityKinds": ["active_window_changed"],
                    "summary": f"AI summary {index + 1}",
                    "searchKeywords": [f"kw-{index + 1}"],
                    "openLoops": [],
                }
                for index, session_id in enumerate(session_ids)
            ]
        },
        usage=None,
    )


@pytest.mark.asyncio
async def test_organizer_uses_openai_structured_outputs_and_logs_usage(
    tmp_path, monkeypatch, caplog
):
    log_dir = tmp_path / "raw_events"
    _write_spool(
        log_dir,
        "2026-04-17",
        [
            _event(
                "raw_1",
                datetime(2026, 4, 17, 9, 0, tzinfo=JST),
                app_name="Chrome.exe",
                window_title="Structured output check",
                domain="example.com",
            )
        ],
    )
    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_make_processing_config(),
        openai_api_key="test-key",
    )
    request_calls: list[dict] = []

    async def _fake_request_openai_json_with_usage(**kwargs):
        request_calls.append(kwargs)
        return StructuredJsonResult(
            output={
                "sessions": [
                    {
                        "sessionId": _extract_session_ids(kwargs["input_payload"])[0],
                        "title": "OpenAI generated title",
                        "primaryCategory": "その他",
                        "activityKinds": ["active_window_changed"],
                        "summary": "OpenAI generated summary",
                        "searchKeywords": ["example.com"],
                        "openLoops": [],
                    }
                ]
            },
            usage={
                "input_tokens": 120,
                "output_tokens": 45,
                "total_tokens": 165,
            },
        )

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    with caplog.at_level(logging.INFO):
        await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert request_calls[0]["model"] == "gpt-5-nano"
    assert request_calls[0]["max_output_tokens"] == 222
    assert api_client.put_sessions_calls[0]["sessions"][0]["title"] == "OpenAI generated title"
    assert "Action-log organizer OpenAI usage" in caplog.text
    assert "input_tokens=120" in caplog.text
    assert "Action-log organizer stats" in caplog.text
    assert "reused_count=0" in caplog.text
    assert "ai_count=1" in caplog.text


@pytest.mark.asyncio
async def test_organizer_openai_without_api_key_falls_back_and_still_syncs(tmp_path, monkeypatch):
    log_dir = tmp_path / "raw_events"
    _write_spool(
        log_dir,
        "2026-04-17",
        [
            _event(
                "raw_1",
                datetime(2026, 4, 17, 9, 0, tzinfo=JST),
                app_name="Code.exe",
                window_title="todo.py - VS Code",
                project_name="self-growth-app",
                file_name="todo.py",
            )
        ],
    )
    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_make_processing_config(),
        openai_api_key="",
    )
    called = False

    async def _fake_request_openai_json_with_usage(**kwargs):
        nonlocal called
        called = True
        del kwargs
        raise AssertionError("should not be called without OPENAI_API_KEY")

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert called is False
    assert api_client.put_sessions_calls[0]["sessions"][0]["title"]
    assert api_client.put_open_loops_calls[0]["openLoops"][0]["title"]


@pytest.mark.asyncio
async def test_organizer_reuses_existing_enrichment_and_excludes_it_from_openai_request(
    tmp_path, monkeypatch
):
    log_dir = tmp_path / "raw_events"
    first_time = datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    second_time = datetime(2026, 4, 17, 9, 10, tzinfo=JST)
    raw_events = [
        _event(
            "raw_1",
            first_time,
            app_name="Code.exe",
            window_title="main.py - VS Code",
            project_name="self-growth-app",
            file_name="main.py",
        ),
        _event(
            "raw_2",
            second_time,
            app_name="Chrome.exe",
            window_title="docs",
            domain="docs.example.com",
        ),
    ]
    _write_spool(log_dir, "2026-04-17", raw_events)
    probe_organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=_FakeApiClient(),
        raw_event_log_dir=log_dir,
        processing_config=_make_processing_config(),
        openai_api_key="test-key",
    )
    candidates = probe_organizer.build_candidate_sessions(
        probe_organizer.load_recent_raw_events(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))
    )
    reused_candidate = candidates[0]
    new_candidate = candidates[1]
    existing_session = {
        "id": reused_candidate["id"],
        "deviceId": "device_1",
        "startedAt": reused_candidate["startedAt"],
        "endedAt": reused_candidate["endedAt"],
        "dateKey": reused_candidate["dateKey"],
        "title": "Existing title",
        "primaryCategory": "その他",
        "activityKinds": ["active_window_changed"],
        "appNames": list(reused_candidate["appNames"]),
        "domains": list(reused_candidate["domains"]),
        "projectNames": list(reused_candidate["projectNames"]),
        "summary": "Existing summary",
        "searchKeywords": ["existing-keyword"],
        "noteIds": [],
        "openLoopIds": ["loop_existing"],
        "hidden": False,
    }
    existing_open_loop = {
        "id": "loop_existing",
        "createdAt": reused_candidate["endedAt"],
        "updatedAt": reused_candidate["endedAt"],
        "dateKey": reused_candidate["dateKey"],
        "title": "Existing loop title",
        "description": "Existing loop description",
        "status": "open",
        "linkedSessionIds": [reused_candidate["id"]],
    }
    api_client = _FakeApiClient(
        existing_sessions=[existing_session],
        existing_open_loops=[existing_open_loop],
    )
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_make_processing_config(),
        openai_api_key="test-key",
    )
    request_payloads: list[dict] = []

    async def _fake_request_openai_json_with_usage(**kwargs):
        request_payloads.append(kwargs["input_payload"])
        return StructuredJsonResult(
            output={
                "sessions": [
                    {
                        "sessionId": new_candidate["id"],
                        "title": "New AI title",
                        "primaryCategory": "その他",
                        "activityKinds": ["active_window_changed"],
                        "summary": "New AI summary",
                        "searchKeywords": ["new-keyword"],
                        "openLoops": [],
                    }
                ]
            },
            usage=None,
        )

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert _extract_session_ids(request_payloads[0]) == [new_candidate["id"]]
    session_titles = [session["title"] for session in api_client.put_sessions_calls[0]["sessions"]]
    assert session_titles == ["Existing title", "New AI title"]
    assert api_client.put_open_loops_calls[0]["openLoops"][0]["title"] == "Existing loop title"


@pytest.mark.asyncio
async def test_organizer_batches_uncached_candidates_in_groups_of_eight(tmp_path, monkeypatch):
    log_dir = tmp_path / "raw_events"
    events = []
    base_time = datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    for index in range(9):
        events.append(
            _event(
                f"raw_{index}",
                base_time + timedelta(minutes=index * 10),
                app_name=f"App{index}.exe",
                window_title=f"Window {index}",
                file_name=f"file_{index}.txt",
            )
        )
    _write_spool(log_dir, "2026-04-17", events)
    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_make_processing_config(),
        openai_api_key="test-key",
    )
    batch_sizes: list[int] = []

    async def _fake_request_openai_json_with_usage(**kwargs):
        session_ids = _extract_session_ids(kwargs["input_payload"])
        batch_sizes.append(len(session_ids))
        return _build_result_for_ids(session_ids)

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert batch_sizes == [8, 1]
    assert len(api_client.put_sessions_calls[0]["sessions"]) == 9
