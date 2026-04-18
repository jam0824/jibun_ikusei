from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from ai.openai_client import StructuredJsonResult
from core.action_log_organizer import ActionLogOrganizer


JST = timezone(timedelta(hours=9))


def _processing_ollama():
    return SimpleNamespace(
        enabled=True,
        provider="ollama",
        base_url="http://127.0.0.1:11434",
        model="gemma4:e4b",
        max_completion_tokens=400,
    )


def _processing_openai():
    return SimpleNamespace(
        enabled=True,
        provider="openai",
        base_url="http://127.0.0.1:11434",
        model="gpt-5-nano",
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
    domain: str | None = None,
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
    return payload


def _write_spool(log_dir: Path, date_key: str, events: list[dict]) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{date_key}.jsonl"
    with open(log_path, "w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")


@dataclass
class _FakeApiClient:
    put_sessions_calls: list[dict] | None = None

    def __post_init__(self) -> None:
        self.put_sessions_calls = []

    async def get_action_log_sessions(self, from_date: str, to_date: str) -> list[dict]:
        del from_date, to_date
        return []

    async def put_action_log_sessions(self, payload: dict) -> dict:
        self.put_sessions_calls.append(payload)
        return {"updated": len(payload.get("sessions", []))}


@pytest.mark.asyncio
async def test_organizer_logs_raw_response_when_json_parse_fails(tmp_path, monkeypatch, caplog):
    log_dir = tmp_path / "raw_events"
    _write_spool(
        log_dir,
        "2026-04-17",
        [
            _event(
                "raw_1",
                datetime(2026, 4, 17, 9, 0, tzinfo=JST),
                app_name="Chrome.exe",
                window_title="Broken JSON response check",
                domain="example.com",
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

    class _MalformedResponse:
        is_success = True
        status_code = 200

        def json(self):
            return {
                "done": True,
                "message": {
                    "content": '{"sessions":[{"sessionId":"broken","title":"unterminated"}'
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
            return _MalformedResponse()

    monkeypatch.setattr("core.action_log_organizer.httpx.AsyncClient", _FakeAsyncClient)

    with caplog.at_level("ERROR"):
        await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert "Action-log organizer LLM enrichment failed" in caplog.text
    assert '{"sessions":[{"sessionId":"broken","title":"unterminated"}' in caplog.text
    assert api_client.put_sessions_calls[0]["sessions"][0]["title"]


@pytest.mark.asyncio
async def test_organizer_logs_budget_exhaustion_and_fallback_count(
    tmp_path, monkeypatch, caplog
):
    log_dir = tmp_path / "raw_events"
    base_time = datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    events = [
        _event(
            f"raw_{index}",
            base_time + timedelta(minutes=index * 10),
            app_name=f"App{index}.exe",
            window_title=f"Window {index}",
            domain=f"example{index}.com",
        )
        for index in range(9)
    ]
    _write_spool(log_dir, "2026-04-17", events)
    api_client = _FakeApiClient()
    organizer = ActionLogOrganizer(
        device_id="device_1",
        api_client=api_client,
        raw_event_log_dir=log_dir,
        processing_config=_processing_openai(),
        openai_api_key="test-key",
    )
    monotonic_values = [0.0, 0.0, 61.0]

    def _fake_monotonic():
        if monotonic_values:
            return monotonic_values.pop(0)
        return 61.0

    async def _fake_request_openai_json_with_usage(**kwargs):
        session_ids = []
        for date_entry in kwargs["input_payload"].get("dateSessions", []):
            for session in date_entry.get("sessions", []):
                session_id = str(session.get("sessionId") or "").strip()
                if session_id:
                    session_ids.append(session_id)
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

    monkeypatch.setattr(
        "core.action_log_organizer.request_openai_json_with_usage",
        _fake_request_openai_json_with_usage,
    )
    monkeypatch.setattr("core.action_log_organizer.time.monotonic", _fake_monotonic)

    with caplog.at_level("INFO"):
        await organizer.organize_and_sync(now=datetime(2026, 4, 17, 12, 0, tzinfo=JST))

    assert "Action-log organizer OpenAI budget exhausted" in caplog.text
    assert "fallback_count=1" in caplog.text
    assert "budget_exhausted=True" in caplog.text
