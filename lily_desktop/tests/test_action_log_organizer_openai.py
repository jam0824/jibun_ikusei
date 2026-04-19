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
    put_sessions_calls: list[dict] | None = None
    get_session_calls: list[tuple[str, str]] | None = None

    def __post_init__(self) -> None:
        self.existing_sessions = list(self.existing_sessions or [])
        self.put_sessions_calls = []
        self.get_session_calls = []

    async def get_action_log_sessions(self, from_date: str, to_date: str) -> list[dict]:
        self.get_session_calls.append((from_date, to_date))
        return list(self.existing_sessions)

    async def put_action_log_sessions(self, payload: dict) -> dict:
        self.put_sessions_calls.append(payload)
        return {"updated": len(payload["sessions"])}


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
                    "activityKinds": ["作業"],
                    "summary": f"AI summary {index + 1}",
                    "searchKeywords": [f"kw-{index + 1}"],
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
                        "activityKinds": ["調査"],
                        "summary": "OpenAI generated summary",
                        "searchKeywords": ["example.com"],
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
    assert request_calls[0]["reasoning_effort"] == "minimal"
    assert "natural Japanese" in request_calls[0]["system_prompt"]
    assert "Never use Korean or Hangul" in request_calls[0]["system_prompt"]
    assert "Never mention internal telemetry" in request_calls[0]["system_prompt"]
    assert api_client.put_sessions_calls[0]["sessions"][0]["title"] == "OpenAI generated title"
    assert "Action-log organizer OpenAI usage" in caplog.text
    assert "input_tokens=120" in caplog.text
    assert "Action-log organizer stats" in caplog.text
    assert "reused_count=0" in caplog.text
    assert "ai_count=1" in caplog.text


@pytest.mark.asyncio
async def test_organizer_rejects_hangul_openai_output_and_falls_back(tmp_path, monkeypatch, caplog):
    log_dir = tmp_path / "raw_events"
    _write_spool(
        log_dir,
        "2026-04-17",
        [
            _event(
                "raw_1",
                datetime(2026, 4, 17, 9, 0, tzinfo=JST),
                app_name="chrome.exe",
                window_title="GitHub PR を確認",
                domain="github.com",
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

    async def _fake_request_openai_json_with_usage(**kwargs):
        return StructuredJsonResult(
            output={
                "sessions": [
                    {
                        "sessionId": _extract_session_ids(kwargs["input_payload"])[0],
                        "title": "Chrome에서 GitHub PR 페이지를 확인했습니다.",
                        "primaryCategory": "기타",
                        "activityKinds": ["활동 로그"],
                        "summary": "GitHub PR 페이지를 확인한 활동입니다.",
                        "searchKeywords": ["github.com"],
                    }
                ]
            },
            usage=None,
        )

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    with caplog.at_level(logging.INFO):
        await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    saved_session = api_client.put_sessions_calls[0]["sessions"][0]
    assert saved_session["title"] == "chrome.exe / GitHub PR を確認"
    assert saved_session["summary"] == "chrome.exe を中心に作業していた。"
    assert "rejected non-Japanese enrichment with Hangul" in caplog.text
    assert "language_rejected_count=1" in caplog.text


@pytest.mark.asyncio
async def test_organizer_rejects_internal_telemetry_terms_and_falls_back(
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
                app_name="Codex.exe",
                window_title="Codex",
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

    async def _fake_request_openai_json_with_usage(**kwargs):
        return StructuredJsonResult(
            output={
                "sessions": [
                    {
                        "sessionId": _extract_session_ids(kwargs["input_payload"])[0],
                        "title": "Codexのハートビートを検出",
                        "primaryCategory": "その他",
                        "activityKinds": ["heartbeat"],
                        "summary": "Codexによる作業の心拍イベントを記録した。",
                        "searchKeywords": ["Codex", "heartbeat"],
                    }
                ]
            },
            usage=None,
        )

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    with caplog.at_level(logging.INFO):
        await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    saved_session = api_client.put_sessions_calls[0]["sessions"][0]
    assert saved_session["title"] == "Codex.exe / Codex"
    assert saved_session["summary"] == "Codex.exe を中心に作業していた。"
    assert "rejected enrichment mentioning internal telemetry terms" in caplog.text
    assert "telemetry_term_rejected_count=1" in caplog.text


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


@pytest.mark.asyncio
async def test_organizer_does_not_reuse_existing_hangul_enrichment(tmp_path, monkeypatch, caplog):
    log_dir = tmp_path / "raw_events"
    _write_spool(
        log_dir,
        "2026-04-17",
        [
            _event(
                "raw_1",
                datetime(2026, 4, 17, 9, 0, tzinfo=JST),
                app_name="chrome.exe",
                window_title="GitHub PR を確認",
                domain="github.com",
            )
        ],
    )
    probe_organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=_FakeApiClient(),
        raw_event_log_dir=log_dir,
        processing_config=_make_processing_config(),
        openai_api_key="test-key",
    )
    candidate = probe_organizer.build_candidate_sessions(
        probe_organizer.load_recent_raw_events(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))
    )[0]
    existing_session = {
        "id": candidate["id"],
        "deviceId": "device_1",
        "startedAt": candidate["startedAt"],
        "endedAt": candidate["endedAt"],
        "dateKey": candidate["dateKey"],
        "title": "Chrome에서 GitHub PR 페이지를 확인했습니다.",
        "primaryCategory": "기타",
        "activityKinds": ["활동 로그"],
        "appNames": list(candidate["appNames"]),
        "domains": list(candidate["domains"]),
        "projectNames": list(candidate["projectNames"]),
        "summary": "GitHub PR 페이지를 확인한 활동입니다.",
        "searchKeywords": ["github.com"],
        "noteIds": [],
        "hidden": False,
    }
    api_client = _FakeApiClient(existing_sessions=[existing_session])
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
                        "sessionId": _extract_session_ids(kwargs["input_payload"])[0],
                        "title": "GitHub PR の確認",
                        "primaryCategory": "その他",
                        "activityKinds": ["調査"],
                        "summary": "GitHub PR の内容を確認していた。",
                        "searchKeywords": ["GitHub PR", "github.com"],
                    }
                ]
            },
            usage=None,
        )

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    with caplog.at_level(logging.INFO):
        await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert _extract_session_ids(request_payloads[0]) == [candidate["id"]]
    assert api_client.put_sessions_calls[0]["sessions"][0]["title"] == "GitHub PR の確認"
    assert "discarded reused enrichment with Hangul" in caplog.text


@pytest.mark.asyncio
async def test_organizer_does_not_reuse_existing_internal_telemetry_terms(
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
                app_name="chrome.exe",
                window_title="YouTube",
                domain="www.youtube.com",
            )
        ],
    )
    probe_organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=_FakeApiClient(),
        raw_event_log_dir=log_dir,
        processing_config=_make_processing_config(),
        openai_api_key="test-key",
    )
    candidate = probe_organizer.build_candidate_sessions(
        probe_organizer.load_recent_raw_events(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))
    )[0]
    existing_session = {
        "id": candidate["id"],
        "deviceId": "device_1",
        "startedAt": candidate["startedAt"],
        "endedAt": candidate["endedAt"],
        "dateKey": candidate["dateKey"],
        "title": "YouTubeのheartbeatイベント発生",
        "primaryCategory": "その他",
        "activityKinds": ["heartbeat"],
        "appNames": list(candidate["appNames"]),
        "domains": list(candidate["domains"]),
        "projectNames": list(candidate["projectNames"]),
        "summary": "YouTubeの心拍イベントを記録した。",
        "searchKeywords": ["YouTube", "heartbeat"],
        "noteIds": [],
        "hidden": False,
    }
    api_client = _FakeApiClient(existing_sessions=[existing_session])
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
                        "sessionId": _extract_session_ids(kwargs["input_payload"])[0],
                        "title": "YouTubeページの閲覧",
                        "primaryCategory": "その他",
                        "activityKinds": ["動画視聴"],
                        "summary": "YouTubeページを続けて閲覧していた。",
                        "searchKeywords": ["YouTube", "www.youtube.com"],
                    }
                ]
            },
            usage=None,
        )

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    with caplog.at_level(logging.INFO):
        await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert _extract_session_ids(request_payloads[0]) == [candidate["id"]]
    assert api_client.put_sessions_calls[0]["sessions"][0]["title"] == "YouTubeページの閲覧"
    assert "discarded reused enrichment with internal telemetry terms" in caplog.text


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
        "activityKinds": ["調査"],
        "appNames": list(reused_candidate["appNames"]),
        "domains": list(reused_candidate["domains"]),
        "projectNames": list(reused_candidate["projectNames"]),
        "summary": "Existing summary",
        "searchKeywords": ["existing-keyword"],
        "noteIds": [],
        "hidden": False,
    }
    api_client = _FakeApiClient(existing_sessions=[existing_session])
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
                        "activityKinds": ["調査"],
                        "summary": "New AI summary",
                        "searchKeywords": ["new-keyword"],
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


@pytest.mark.asyncio
async def test_organizer_prioritizes_newest_uncached_candidates_for_openai_requests(
    tmp_path, monkeypatch
):
    log_dir = tmp_path / "raw_events"
    events = []
    base_time = datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    for index in range(3):
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
    newest_first_ids = [candidate["id"] for candidate in reversed(candidates)]

    api_client = _FakeApiClient()
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
        session_ids = _extract_session_ids(kwargs["input_payload"])
        return _build_result_for_ids(session_ids)

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert _extract_session_ids(request_payloads[0]) == newest_first_ids


@pytest.mark.asyncio
async def test_organizer_limits_openai_to_one_batch_and_falls_back_remaining_candidates(
    tmp_path, monkeypatch
):
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
    newest_first_ids = [candidate["id"] for candidate in reversed(candidates)]

    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_make_processing_config(),
        openai_api_key="test-key",
    )
    batch_sizes: list[int] = []
    requested_batches: list[list[str]] = []

    async def _fake_request_openai_json_with_usage(**kwargs):
        session_ids = _extract_session_ids(kwargs["input_payload"])
        batch_sizes.append(len(session_ids))
        requested_batches.append(session_ids)
        return _build_result_for_ids(session_ids)

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert batch_sizes == [8]
    assert requested_batches == [newest_first_ids[:8]]
    saved_sessions = {
        session["id"]: session for session in api_client.put_sessions_calls[0]["sessions"]
    }
    assert len(saved_sessions) == 9
    assert saved_sessions[newest_first_ids[-1]]["title"] == "App0.exe / Window 0"


@pytest.mark.asyncio
async def test_organizer_does_not_retry_fallback_sessions_on_next_run(
    tmp_path, monkeypatch
):
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
    newest_first_ids = [candidate["id"] for candidate in reversed(candidates)]

    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_make_processing_config(),
        openai_api_key="test-key",
    )
    requested_batches: list[list[str]] = []

    async def _fake_request_openai_json_with_usage(**kwargs):
        session_ids = _extract_session_ids(kwargs["input_payload"])
        requested_batches.append(session_ids)
        return _build_result_for_ids(session_ids)

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert requested_batches == [newest_first_ids[:8]]
    first_run_sessions = api_client.put_sessions_calls[0]["sessions"]
    api_client.existing_sessions = list(first_run_sessions)
    api_client.put_sessions_calls.clear()
    requested_batches.clear()

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert requested_batches == []
    saved_sessions = {
        session["id"]: session for session in api_client.put_sessions_calls[0]["sessions"]
    }
    assert len(saved_sessions) == 9
    assert saved_sessions[newest_first_ids[-1]]["title"] == "App0.exe / Window 0"
    assert saved_sessions[newest_first_ids[0]]["title"] == "AI title 1"
