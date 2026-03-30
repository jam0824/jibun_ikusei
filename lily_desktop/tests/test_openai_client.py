"""OpenAI chat client のテスト"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from unittest.mock import patch

import pytest

from ai.openai_client import TextResult, ToolCallsResult, send_chat_message


class _FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = ""

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

    async def post(self, url: str, headers: dict[str, str], json: dict[str, Any]):
        self.calls.append(json)
        return self._responses.pop(0)


@pytest.mark.asyncio
async def test_tool_calls_are_returned_even_when_finish_reason_is_stop():
    fake_client = _FakeAsyncClient([
        _FakeResponse({
            "choices": [{
                "message": {
                    "tool_calls": [{
                        "id": "tool_1",
                        "function": {
                            "name": "get_messages_and_logs",
                            "arguments": '{"type":"chat_messages","date":"2026-03-29"}',
                        },
                    }],
                },
                "finish_reason": "stop",
            }],
        }),
    ])

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        result = await send_chat_message(
            api_key="test",
            model="test-model",
            messages=[{"role": "user", "content": "3/29の会話を見て"}],
        )

    assert isinstance(result, ToolCallsResult)
    assert result.tool_calls is not None
    assert result.tool_calls[0].function_name == "get_messages_and_logs"


@pytest.mark.asyncio
async def test_array_content_is_normalized_to_text():
    fake_client = _FakeAsyncClient([
        _FakeResponse({
            "choices": [{
                "message": {
                    "content": [
                        {"text": "1行目"},
                        {"text": "2行目"},
                    ],
                },
                "finish_reason": "stop",
            }],
        }),
    ])

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        result = await send_chat_message(
            api_key="test",
            model="test-model",
            messages=[{"role": "user", "content": "要約して"}],
        )

    assert isinstance(result, TextResult)
    assert result.content == "1行目\n2行目"


@pytest.mark.asyncio
async def test_truncated_empty_response_retries_with_larger_token_budget():
    fake_client = _FakeAsyncClient([
        _FakeResponse({
            "choices": [{
                "message": {"content": None},
                "finish_reason": "length",
            }],
        }),
        _FakeResponse({
            "choices": [{
                "message": {"content": "再試行で成功"},
                "finish_reason": "stop",
            }],
        }),
    ])

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        result = await send_chat_message(
            api_key="test",
            model="test-model",
            messages=[{"role": "user", "content": "内容を教えて"}],
        )

    assert isinstance(result, TextResult)
    assert result.content == "再試行で成功"
    assert fake_client.calls[0]["max_completion_tokens"] == 900
    assert fake_client.calls[1]["max_completion_tokens"] == 1600


@pytest.mark.asyncio
async def test_empty_response_raises_when_text_and_tool_calls_are_missing():
    fake_client = _FakeAsyncClient([
        _FakeResponse({
            "choices": [{
                "message": {"content": None},
                "finish_reason": "stop",
            }],
        }),
    ])

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        with pytest.raises(Exception, match="OpenAI Chat response was empty"):
            await send_chat_message(
                api_key="test",
                model="test-model",
                messages=[{"role": "user", "content": "こんにちは"}],
            )
