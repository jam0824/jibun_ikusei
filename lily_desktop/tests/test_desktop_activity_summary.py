from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest


JST = timezone(timedelta(hours=9))


class _FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200, text: str = ""):
        self._payload = payload
        self.status_code = status_code
        self.text = text

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeAsyncClient:
    def __init__(self, responses: Sequence[_FakeResponse]):
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self._responses.pop(0)


class _FailingAsyncClient:
    async def __aenter__(self) -> "_FailingAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, **kwargs):
        del url, kwargs
        raise RuntimeError("ollama down")


@pytest.mark.asyncio
async def test_summarize_recent_desktop_activity_filters_last_five_minutes_and_uses_plain_text(
    monkeypatch,
):
    import core.desktop_activity_summary as mod

    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "message": {"content": "VS Codeで実装を進めているようです。"},
                    "done_reason": "stop",
                }
            )
        ]
    )
    monkeypatch.setattr(mod.httpx, "AsyncClient", lambda timeout=30.0: fake_client)
    now = datetime(2026, 4, 18, 9, 10, tzinfo=JST)

    result = await mod.summarize_recent_desktop_activity(
        openai_api_key="",
        provider="ollama",
        base_url="http://127.0.0.1:11434",
        model="gemma4:e4b",
        recent_events=[
            {
                "occurredAt": "2026-04-18T09:02:00+09:00",
                "eventType": "active_window_changed",
                "appName": "Code.exe",
                "windowTitle": "main.py - VS Code",
            },
            {
                "occurredAt": "2026-04-18T09:08:30+09:00",
                "eventType": "active_window_changed",
                "appName": "Code.exe",
                "windowTitle": "feature.py - VS Code",
            },
        ],
        now=now,
    )

    assert result.summary == "VS Codeで実装を進めているようです。"
    assert result.activity_type == "coding"
    assert result.latest_app_name == "Code.exe"
    assert len(fake_client.calls) == 1
    request = fake_client.calls[0]
    assert request["url"] == "http://127.0.0.1:11434/api/chat"
    assert request["json"]["stream"] is False
    assert request["json"]["think"] is False
    user_text = request["json"]["messages"][1]["content"]
    assert "2026-04-18T09:08:30+09:00" in user_text
    assert "feature.py - VS Code" in user_text
    assert "2026-04-18T09:02:00+09:00" not in user_text
    assert "JSON" not in request["json"]["messages"][0]["content"]


@pytest.mark.asyncio
async def test_summarize_recent_desktop_activity_falls_back_to_rule_based_summary_when_llm_fails(
    monkeypatch,
):
    import core.desktop_activity_summary as mod

    monkeypatch.setattr(mod.httpx, "AsyncClient", lambda timeout=30.0: _FailingAsyncClient())

    result = await mod.summarize_recent_desktop_activity(
        openai_api_key="",
        provider="ollama",
        base_url="http://127.0.0.1:11434",
        model="gemma4:e4b",
        recent_events=[
            {
                "occurredAt": "2026-04-18T09:08:30+09:00",
                "eventType": "active_window_changed",
                "appName": "Code.exe",
                "windowTitle": "main.py - VS Code",
            }
        ],
        now=datetime(2026, 4, 18, 9, 10, tzinfo=JST),
    )

    assert result.summary != ""
    assert result.activity_type == "coding"
    assert result.latest_app_name == "Code.exe"


@pytest.mark.asyncio
async def test_summarize_recent_desktop_activity_returns_empty_when_recent_events_are_absent():
    import core.desktop_activity_summary as mod

    result = await mod.summarize_recent_desktop_activity(
        openai_api_key="",
        provider="ollama",
        base_url="http://127.0.0.1:11434",
        model="gemma4:e4b",
        recent_events=[],
        now=datetime(2026, 4, 18, 9, 10, tzinfo=JST),
    )

    assert result.summary == ""
    assert result.tags == []
    assert result.latest_app_name == ""
