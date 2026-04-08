"""Unit tests for the shared OpenAI chat client."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from unittest.mock import patch

import pytest

from ai.openai_client import (
    TextResult,
    ToolCallsResult,
    request_openai_json,
    send_chat_message,
)


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
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "choices": [
                        {
                            "message": {
                                "tool_calls": [
                                    {
                                        "id": "tool_1",
                                        "function": {
                                            "name": "get_messages_and_logs",
                                            "arguments": '{"type":"chat_messages","date":"2026-03-29"}',
                                        },
                                    }
                                ],
                            },
                            "finish_reason": "stop",
                        }
                    ],
                }
            )
        ]
    )

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        result = await send_chat_message(
            api_key="test",
            model="test-model",
            messages=[{"role": "user", "content": "show the messages for 2026-03-29"}],
        )

    assert isinstance(result, ToolCallsResult)
    assert result.tool_calls is not None
    assert result.tool_calls[0].function_name == "get_messages_and_logs"


@pytest.mark.asyncio
async def test_array_content_is_normalized_to_text():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "choices": [
                        {
                            "message": {
                                "content": [
                                    {"text": "line 1"},
                                    {"text": "line 2"},
                                ],
                            },
                            "finish_reason": "stop",
                        }
                    ],
                }
            )
        ]
    )

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        result = await send_chat_message(
            api_key="test",
            model="test-model",
            messages=[{"role": "user", "content": "summarize it"}],
        )

    assert isinstance(result, TextResult)
    assert result.content == "line 1\nline 2"


@pytest.mark.asyncio
async def test_uses_single_fixed_token_budget_by_default():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "choices": [
                        {
                            "message": {"content": "response text"},
                            "finish_reason": "stop",
                        }
                    ],
                }
            )
        ]
    )

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        result = await send_chat_message(
            api_key="test",
            model="test-model",
            messages=[{"role": "user", "content": "please respond"}],
        )

    assert isinstance(result, TextResult)
    assert result.content == "response text"
    assert len(fake_client.calls) == 1
    assert fake_client.calls[0]["max_completion_tokens"] == 900


@pytest.mark.asyncio
async def test_truncated_empty_response_raises_without_token_budget_retry():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "choices": [
                        {
                            "message": {"content": None},
                            "finish_reason": "length",
                        }
                    ],
                }
            )
        ]
    )

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        with pytest.raises(Exception, match="truncated before text was returned"):
            await send_chat_message(
                api_key="test",
                model="test-model",
                messages=[{"role": "user", "content": "please respond"}],
            )

    assert len(fake_client.calls) == 1


@pytest.mark.asyncio
async def test_custom_token_budget_is_forwarded():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "choices": [
                        {
                            "message": {"content": "custom budget reply"},
                            "finish_reason": "stop",
                        }
                    ],
                }
            )
        ]
    )

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        result = await send_chat_message(
            api_key="test",
            model="test-model",
            messages=[{"role": "user", "content": "please respond"}],
            max_completion_tokens=1200,
        )

    assert isinstance(result, TextResult)
    assert result.content == "custom budget reply"
    assert fake_client.calls[0]["max_completion_tokens"] == 1200


@pytest.mark.asyncio
async def test_empty_response_raises_when_text_and_tool_calls_are_missing():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "choices": [
                        {
                            "message": {"content": None},
                            "finish_reason": "stop",
                        }
                    ],
                }
            )
        ]
    )

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        with pytest.raises(Exception, match="OpenAI Chat response was empty"):
            await send_chat_message(
                api_key="test",
                model="test-model",
                messages=[{"role": "user", "content": "hello"}],
            )


@pytest.mark.asyncio
async def test_request_openai_json_serializes_input_payload():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "status": "completed",
                    "output_text": '{"action":"unclassified","skillName":"未分類","category":"健康","confidence":0.4,"reason":"fallback","candidateSkills":["食事管理"]}',
                }
            )
        ]
    )

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        result = await request_openai_json(
            api_key="test",
            model="test-model",
            schema_name="skill_resolution",
            schema={"type": "object"},
            input_payload={"quest": {"title": "食後のかかと上げ"}},
        )

    assert result["action"] == "unclassified"
    assert fake_client.calls[0]["input"][1]["content"][0]["text"] == '{"quest": {"title": "食後のかかと上げ"}}'
