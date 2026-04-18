from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from unittest.mock import patch

import pytest

from ai.openai_client import StructuredJsonResult, request_openai_json_with_usage


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
        del url, headers
        self.calls.append(json)
        return self._responses.pop(0)


@pytest.mark.asyncio
async def test_request_openai_json_with_usage_returns_parsed_output_and_usage():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "status": "completed",
                    "output_text": '{"summary":"ok"}',
                    "usage": {
                        "input_tokens": 12,
                        "output_tokens": 5,
                        "total_tokens": 17,
                    },
                }
            )
        ]
    )

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        result = await request_openai_json_with_usage(
            api_key="test",
            model="gpt-5-nano",
            schema_name="organizer",
            schema={"type": "object"},
            input_payload={"sessions": [{"id": "session_1"}]},
        )

    assert isinstance(result, StructuredJsonResult)
    assert result.output == {"summary": "ok"}
    assert result.usage == {
        "input_tokens": 12,
        "output_tokens": 5,
        "total_tokens": 17,
    }


@pytest.mark.asyncio
async def test_request_openai_json_with_usage_forwards_reasoning_effort():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "status": "completed",
                    "output_text": '{"summary":"ok"}',
                }
            )
        ]
    )

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        await request_openai_json_with_usage(
            api_key="test",
            model="gpt-5-nano",
            schema_name="organizer",
            schema={"type": "object"},
            input_payload={"sessions": [{"id": "session_1"}]},
            reasoning_effort="minimal",
        )

    assert fake_client.calls[0]["reasoning"] == {"effort": "minimal"}


@pytest.mark.asyncio
async def test_request_openai_json_with_usage_includes_incomplete_reason_in_error():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "status": "incomplete",
                    "incomplete_details": {
                        "reason": "max_output_tokens",
                    },
                    "output": [],
                }
            )
        ]
    )

    with patch("ai.openai_client.httpx.AsyncClient", return_value=fake_client):
        with pytest.raises(
            Exception,
            match="incomplete.*max_output_tokens",
        ):
            await request_openai_json_with_usage(
                api_key="test",
                model="gpt-5-nano",
                schema_name="organizer",
                schema={"type": "object"},
                input_payload={"sessions": [{"id": "session_1"}]},
            )
