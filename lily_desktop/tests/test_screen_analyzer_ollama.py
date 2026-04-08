from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any
from unittest.mock import patch

import pytest

from ai.screen_analyzer import analyze_screenshot


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


@pytest.mark.asyncio
async def test_screen_analysis_uses_ollama_chat_api_with_images_and_window_context():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "summary": "Working in a code editor",
                                "tags": ["coding", "editor"],
                                "activity_type": "coding",
                                "detail": "The screenshot shows a code editor and terminal",
                            }
                        )
                    },
                    "done_reason": "stop",
                }
            )
        ]
    )

    with patch("ai.screen_analyzer.httpx.AsyncClient", return_value=fake_client):
        result = await analyze_screenshot(
            api_key="",
            provider="ollama",
            base_url="http://127.0.0.1:11434",
            model="gemma4:e4b",
            screenshot_png=b"desktop-png",
            window_context="アプリ: Cursor, タイトル: main.py",
        )

    assert result.summary == "Working in a code editor"
    assert len(fake_client.calls) == 1
    request = fake_client.calls[0]
    assert request["url"] == "http://127.0.0.1:11434/api/chat"
    assert request["json"]["stream"] is False
    assert request["json"]["think"] is False
    assert request["json"]["options"]["num_predict"] == 500
    assert request["json"]["messages"][1]["images"] == ["ZGVza3RvcC1wbmc="]
    assert "アプリ: Cursor" in request["json"]["messages"][1]["content"]


@pytest.mark.asyncio
async def test_screen_analysis_accepts_code_fence_json_from_ollama():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "message": {
                        "content": """```json
{"summary":"Docs page","tags":["docs"],"activity_type":"reading","detail":"A documentation page is open"}
```"""
                    },
                    "done_reason": "stop",
                }
            )
        ]
    )

    with patch("ai.screen_analyzer.httpx.AsyncClient", return_value=fake_client):
        result = await analyze_screenshot(
            api_key="",
            provider="ollama",
            base_url="http://127.0.0.1:11434",
            model="gemma4:e4b",
            screenshot_png=b"desktop-png",
        )

    assert result.summary == "Docs page"
    assert result.activity_type == "reading"


@pytest.mark.asyncio
async def test_screen_analysis_raises_for_truncated_ollama_responses():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "message": {"content": '{"summary":"Working in a'},
                    "done_reason": "length",
                }
            )
        ]
    )

    with patch("ai.screen_analyzer.httpx.AsyncClient", return_value=fake_client):
        with pytest.raises(Exception, match="truncated"):
            await analyze_screenshot(
                api_key="",
                provider="ollama",
                base_url="http://127.0.0.1:11434",
                model="gemma4:e4b",
                screenshot_png=b"desktop-png",
            )


@pytest.mark.asyncio
async def test_screen_analysis_raises_for_empty_ollama_responses():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "message": {"content": ""},
                    "done_reason": "stop",
                }
            )
        ]
    )

    with patch("ai.screen_analyzer.httpx.AsyncClient", return_value=fake_client):
        with pytest.raises(Exception, match="empty"):
            await analyze_screenshot(
                api_key="",
                provider="ollama",
                base_url="http://127.0.0.1:11434",
                model="gemma4:e4b",
                screenshot_png=b"desktop-png",
            )


@pytest.mark.asyncio
async def test_screen_analysis_raises_for_ollama_http_errors():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {"error": "model not found"},
                status_code=404,
                text="model not found",
            )
        ]
    )

    with patch("ai.screen_analyzer.httpx.AsyncClient", return_value=fake_client):
        with pytest.raises(Exception, match="Screen analysis failed"):
            await analyze_screenshot(
                api_key="",
                provider="ollama",
                base_url="http://127.0.0.1:11434",
                model="gemma4:e4b",
                screenshot_png=b"desktop-png",
            )
