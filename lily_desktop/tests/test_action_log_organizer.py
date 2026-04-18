from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from ai.provider_chat import ChatRequest
from core.action_log_organizer import ActionLogOrganizer


JST = timezone(timedelta(hours=9))


def _processing_disabled():
    return SimpleNamespace(
        enabled=False,
        provider="ollama",
        base_url="http://127.0.0.1:11434",
        model="gemma4:e4b",
        max_completion_tokens=400,
    )


def _processing_ollama():
    return SimpleNamespace(
        enabled=True,
        provider="ollama",
        base_url="http://127.0.0.1:11434",
        model="gemma4:e4b",
        max_completion_tokens=400,
    )


def _event(
    event_id: str,
    occurred_at: datetime,
    *,
    device_id: str = "device_1",
    source: str = "desktop_agent",
    event_type: str = "active_window_changed",
    app_name: str | None = None,
    window_title: str | None = None,
    url: str | None = None,
    domain: str | None = None,
    project_name: str | None = None,
    file_name: str | None = None,
    metadata: dict | None = None,
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
    if url:
        payload["url"] = url
    if domain:
        payload["domain"] = domain
    if project_name:
        payload["projectName"] = project_name
    if file_name:
        payload["fileName"] = file_name
    if metadata:
        payload["metadata"] = metadata
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


def _make_organizer(
    tmp_path: Path,
    api_client: _FakeApiClient | None = None,
):
    return ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client or _FakeApiClient(),
        raw_event_log_dir=tmp_path / "raw_events",
    )


def test_candidate_sessions_group_nearby_events_into_one_session(tmp_path):
    organizer = _make_organizer(tmp_path)
    events = [
        _event(
            "raw_1",
            datetime(2026, 4, 17, 9, 0, tzinfo=JST),
            app_name="Code.exe",
            window_title="main.py - VS Code",
            project_name="self-growth-app",
            file_name="main.py",
        ),
        _event(
            "raw_2",
            datetime(2026, 4, 17, 9, 3, tzinfo=JST),
            event_type="heartbeat",
            app_name="Code.exe",
            window_title="main.py - VS Code",
            project_name="self-growth-app",
            file_name="main.py",
        ),
    ]

    sessions = organizer.build_candidate_sessions(events)

    assert len(sessions) == 1
    assert sessions[0]["rawEventIds"] == ["raw_1", "raw_2"]
    assert sessions[0]["dateKey"] == "2026-04-17"


def test_candidate_sessions_group_browser_processes_and_extension_by_domain(tmp_path):
    organizer = _make_organizer(tmp_path)
    events = [
        _event(
            "raw_1",
            datetime(2026, 4, 17, 9, 0, tzinfo=JST),
            app_name="chrome.exe",
            window_title="Ancient Egypt - YouTube",
        ),
        _event(
            "raw_2",
            datetime(2026, 4, 17, 9, 0, 20, tzinfo=JST),
            source="chrome_extension",
            event_type="browser_page_changed",
            url="https://www.youtube.com/watch?v=aircAruvnKk",
            domain="www.youtube.com",
            window_title="Ancient Egypt - YouTube",
        ),
        _event(
            "raw_3",
            datetime(2026, 4, 17, 9, 0, 40, tzinfo=JST),
            event_type="heartbeat",
            app_name="msedge.exe",
            window_title="Ancient Egypt - YouTube",
        ),
        _event(
            "raw_4",
            datetime(2026, 4, 17, 9, 1, tzinfo=JST),
            source="chrome_extension",
            event_type="browser_page_changed",
            url="https://docs.python.org/3/",
            domain="docs.python.org",
            window_title="Python Docs",
        ),
        _event(
            "raw_5",
            datetime(2026, 4, 17, 9, 1, 20, tzinfo=JST),
            event_type="heartbeat",
            app_name="firefox.exe",
            window_title="Python Docs",
        ),
    ]

    sessions = organizer.build_candidate_sessions(events)

    assert [session["rawEventIds"] for session in sessions] == [
        ["raw_1", "raw_2", "raw_3"],
        ["raw_4", "raw_5"],
    ]


def test_candidate_sessions_split_on_gap_idle_app_domain_and_file_context(tmp_path):
    organizer = _make_organizer(tmp_path)
    events = [
        _event(
            "raw_1",
            datetime(2026, 4, 17, 9, 0, tzinfo=JST),
            app_name="Code.exe",
            window_title="main.py - VS Code",
            project_name="self-growth-app",
            file_name="main.py",
        ),
        _event(
            "raw_2",
            datetime(2026, 4, 17, 9, 2, tzinfo=JST),
            event_type="heartbeat",
            app_name="Code.exe",
            window_title="main.py - VS Code",
            project_name="self-growth-app",
            file_name="main.py",
        ),
        _event(
            "raw_3",
            datetime(2026, 4, 17, 9, 10, tzinfo=JST),
            app_name="Code.exe",
            window_title="main.py - VS Code",
            project_name="self-growth-app",
            file_name="main.py",
        ),
        _event("raw_4", datetime(2026, 4, 17, 9, 11, tzinfo=JST), event_type="idle_started"),
        _event("raw_5", datetime(2026, 4, 17, 9, 12, tzinfo=JST), event_type="idle_ended"),
        _event(
            "raw_6",
            datetime(2026, 4, 17, 9, 13, tzinfo=JST),
            app_name="Code.exe",
            window_title="main.py - VS Code",
            project_name="self-growth-app",
            file_name="main.py",
        ),
        _event(
            "raw_7",
            datetime(2026, 4, 17, 9, 14, tzinfo=JST),
            source="chrome_extension",
            event_type="browser_page_changed",
            url="https://developer.chrome.com/docs/extensions/",
            domain="developer.chrome.com",
            window_title="Chrome Extensions",
        ),
        _event(
            "raw_8",
            datetime(2026, 4, 17, 9, 15, tzinfo=JST),
            source="chrome_extension",
            event_type="browser_page_changed",
            url="https://docs.python.org/3/",
            domain="docs.python.org",
            window_title="Python Docs",
        ),
        _event(
            "raw_9",
            datetime(2026, 4, 17, 9, 16, tzinfo=JST),
            app_name="Code.exe",
            window_title="main.py - VS Code",
            project_name="self-growth-app",
            file_name="main.py",
        ),
        _event(
            "raw_10",
            datetime(2026, 4, 17, 9, 16, 30, tzinfo=JST),
            event_type="heartbeat",
            app_name="Code.exe",
            window_title="workspace - VS Code",
            project_name="self-growth-app",
        ),
        _event(
            "raw_11",
            datetime(2026, 4, 17, 9, 17, tzinfo=JST),
            app_name="Code.exe",
            window_title="notes.py - VS Code",
            project_name="self-growth-app",
            file_name="notes.py",
        ),
    ]

    sessions = organizer.build_candidate_sessions(events)

    assert [session["rawEventIds"] for session in sessions] == [
        ["raw_1", "raw_2"],
        ["raw_3"],
        ["raw_6"],
        ["raw_7"],
        ["raw_8"],
        ["raw_9", "raw_10"],
        ["raw_11"],
    ]


@pytest.mark.asyncio
async def test_organize_and_sync_reads_only_today_and_yesterday_and_preserves_hidden(tmp_path):
    log_dir = tmp_path / "raw_events"
    _write_spool(
        log_dir,
        "2026-04-15",
        [
            _event(
                "old_raw",
                datetime(2026, 4, 15, 9, 0, tzinfo=JST),
                app_name="Code.exe",
                window_title="old.py - VS Code",
            )
        ],
    )
    _write_spool(
        log_dir,
        "2026-04-16",
        [
            _event(
                "yesterday_raw",
                datetime(2026, 4, 16, 20, 0, tzinfo=JST),
                app_name="Code.exe",
                window_title="todo.py - VS Code",
                metadata={"openLoopHint": True},
            )
        ],
    )
    _write_spool(
        log_dir,
        "2026-04-17",
        [
            _event(
                "today_raw",
                datetime(2026, 4, 17, 9, 0, tzinfo=JST),
                app_name="Code.exe",
                window_title="main.py - VS Code",
            )
        ],
    )
    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_processing_disabled(),
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert api_client.get_session_calls == [("2026-04-16", "2026-04-17")]
    first_payload = api_client.put_sessions_calls[0]
    first_session_ids = [session["id"] for session in first_payload["sessions"]]
    assert {session["dateKey"] for session in first_payload["sessions"]} == {
        "2026-04-16",
        "2026-04-17",
    }
    assert all("old_raw" not in session["id"] for session in first_payload["sessions"])

    api_client.existing_sessions = [
        {
            **first_payload["sessions"][0],
            "hidden": True,
        }
    ]
    api_client.put_sessions_calls.clear()
    api_client.put_open_loops_calls.clear()

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    second_payload = api_client.put_sessions_calls[0]
    assert [session["id"] for session in second_payload["sessions"]] == first_session_ids
    assert second_payload["sessions"][0]["hidden"] is True


@pytest.mark.asyncio
async def test_organize_and_sync_preserves_hidden_when_candidate_id_changes(tmp_path):
    log_dir = tmp_path / "raw_events"
    occurred_at = datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    first_event = _event(
        "raw_1",
        occurred_at,
        app_name="Code.exe",
        window_title="main.py - VS Code",
        project_name="self-growth-app",
        file_name="main.py",
    )
    _write_spool(log_dir, "2026-04-17", [first_event])
    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_processing_disabled(),
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    first_payload = api_client.put_sessions_calls[0]
    assert len(first_payload["sessions"]) == 1
    first_session = first_payload["sessions"][0]

    api_client.existing_sessions = [{**first_session, "hidden": True}]
    api_client.put_sessions_calls.clear()
    api_client.put_open_loops_calls.clear()
    _write_spool(
        log_dir,
        "2026-04-17",
        [
            first_event,
            _event(
                "raw_2",
                occurred_at + timedelta(minutes=1),
                event_type="heartbeat",
                app_name="Code.exe",
                window_title="main.py - VS Code",
                project_name="self-growth-app",
                file_name="main.py",
            ),
        ],
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    second_payload = api_client.put_sessions_calls[0]
    assert len(second_payload["sessions"]) == 1
    assert second_payload["sessions"][0]["id"] != first_session["id"]
    assert second_payload["sessions"][0]["hidden"] is True


@pytest.mark.asyncio
async def test_organize_and_sync_full_replaces_today_and_yesterday_even_when_one_day_is_empty(tmp_path):
    log_dir = tmp_path / "raw_events"
    _write_spool(
        log_dir,
        "2026-04-17",
        [
            _event(
                "today_raw",
                datetime(2026, 4, 17, 9, 0, tzinfo=JST),
                app_name="Code.exe",
                window_title="main.py - VS Code",
                project_name="self-growth-app",
                file_name="main.py",
            )
        ],
    )
    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_processing_disabled(),
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert api_client.put_sessions_calls == [
        {
            "deviceId": "device_1",
            "dateKeys": ["2026-04-16", "2026-04-17"],
            "sessions": api_client.put_sessions_calls[0]["sessions"],
        }
    ]
    assert [session["dateKey"] for session in api_client.put_sessions_calls[0]["sessions"]] == [
        "2026-04-17"
    ]
    assert api_client.put_open_loops_calls == [
        {
            "dateKeys": ["2026-04-16", "2026-04-17"],
            "openLoops": [],
        }
    ]


@pytest.mark.asyncio
async def test_organize_and_sync_full_replaces_today_and_yesterday_even_without_candidates(tmp_path):
    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=tmp_path / "raw_events",
        processing_config=_processing_disabled(),
    )

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert api_client.put_sessions_calls == [
        {
            "deviceId": "device_1",
            "dateKeys": ["2026-04-16", "2026-04-17"],
            "sessions": [],
        }
    ]
    assert api_client.put_open_loops_calls == [
        {
            "dateKeys": ["2026-04-16", "2026-04-17"],
            "openLoops": [],
        }
    ]


@pytest.mark.asyncio
async def test_organizer_uses_ollama_batch_and_saves_open_loops(tmp_path, monkeypatch):
    log_dir = tmp_path / "raw_events"
    _write_spool(
        log_dir,
        "2026-04-17",
        [
            _event(
                "raw_1",
                datetime(2026, 4, 17, 9, 0, tzinfo=JST),
                source="chrome_extension",
                event_type="browser_page_changed",
                url="https://developer.chrome.com/docs/extensions/",
                domain="developer.chrome.com",
                window_title="Chrome Extensions TODO",
            )
        ],
    )
    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_processing_ollama(),
    )
    expected_session_id = organizer.build_candidate_sessions(
        organizer.load_recent_raw_events(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))
    )[0]["id"]
    build_calls: list[dict] = []

    def _fake_build_text_chat_request(**kwargs):
        build_calls.append(kwargs)
        return ChatRequest(
            url="http://127.0.0.1:11434/api/chat",
            headers={"Content-Type": "application/json"},
            body={"model": "gemma4:e4b", "messages": []},
        )

    class _FakeResponse:
        is_success = True
        status_code = 200
        text = "ok"

        def json(self):
            return {
                "done": True,
                "message": {
                    "content": json.dumps(
                        {
                    "sessions": [
                                {
                                    "sessionId": expected_session_id,
                                    "title": "Chrome拡張の調査",
                                    "primaryCategory": "学習",
                                    "activityKinds": ["調査"],
                                    "summary": "Chrome拡張のドキュメントを読みながら挙動を確認していた。",
                                    "searchKeywords": ["Chrome拡張", "developer.chrome.com"],
                                    "openLoops": [
                                        {
                                            "title": "Chrome拡張の未解決メモ",
                                            "description": "manifestの確認が残っている。",
                                        }
                                    ],
                                }
                            ]
                        },
                        ensure_ascii=False,
                    )
                },
            }

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            del args, kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            del exc_type, exc, tb

        async def post(self, url, *, headers, json):
            del url, headers, json
            return _FakeResponse()

    monkeypatch.setattr("core.action_log_organizer.build_text_chat_request", _fake_build_text_chat_request)
    monkeypatch.setattr("core.action_log_organizer.httpx.AsyncClient", _FakeAsyncClient)

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert build_calls[0]["provider"] == "ollama"
    assert build_calls[0]["model"] == "gemma4:e4b"
    assert api_client.put_sessions_calls[0]["sessions"][0]["title"] == "Chrome拡張の調査"
    assert api_client.put_sessions_calls[0]["sessions"][0]["searchKeywords"] == [
        "Chrome拡張",
        "developer.chrome.com",
    ]
    assert api_client.put_open_loops_calls[0]["dateKeys"] == ["2026-04-16", "2026-04-17"]
    assert api_client.put_open_loops_calls[0]["openLoops"][0]["title"] == "Chrome拡張の未解決メモ"


@pytest.mark.asyncio
async def test_organizer_falls_back_when_ollama_fails_and_still_syncs_sessions(tmp_path, monkeypatch):
    log_dir = tmp_path / "raw_events"
    _write_spool(
        log_dir,
        "2026-04-17",
        [
            _event(
                "raw_1",
                datetime(2026, 4, 17, 9, 0, tzinfo=JST),
                app_name="Code.exe",
                window_title="TODO.md - VS Code",
                project_name="self-growth-app",
                file_name="TODO.md",
                metadata={"openLoopHint": True},
            )
        ],
    )
    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
    )

    class _FailingAsyncClient:
        def __init__(self, *args, **kwargs):
            del args, kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            del exc_type, exc, tb

        async def post(self, url, *, headers, json):
            del url, headers, json
            raise RuntimeError("ollama down")

    monkeypatch.setattr("core.action_log_organizer.httpx.AsyncClient", _FailingAsyncClient)

    await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    session = api_client.put_sessions_calls[0]["sessions"][0]
    assert session["title"]
    assert session["primaryCategory"] == "仕事"
    assert session["searchKeywords"]
    assert api_client.put_open_loops_calls[0]["openLoops"][0]["title"]
