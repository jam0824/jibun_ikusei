from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import pytest

from core.situation_logger import SituationLogger, SituationRecord


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
async def test_generate_summary_uses_ollama_chat_api(tmp_path, monkeypatch):
    import core.situation_logger as mod

    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "message": {"content": "30分の要約です"},
                    "done_reason": "stop",
                }
            )
        ]
    )
    monkeypatch.setattr(mod, "_LOG_DIR", tmp_path)
    monkeypatch.setattr(mod.httpx, "AsyncClient", lambda timeout=30.0: fake_client)

    logger_instance = SituationLogger(
        openai_api_key="",
        summary_provider="ollama",
        summary_base_url="http://127.0.0.1:11434",
        summary_model="gemma4:e4b",
    )
    logger_instance.record(
        SituationRecord(
            timestamp="2026-03-29 12:00:00",
            camera_summary="外は晴れ",
            desktop_summary="コーディング中",
            active_app="VSCode",
        )
    )

    result = await logger_instance.generate_summary()

    assert result is not None
    assert result["summary"] == "30分の要約です"
    assert result["details"]["camera_summaries"] == ["外は晴れ"]
    assert result["details"]["desktop_summaries"] == ["コーディング中"]
    assert result["details"]["active_apps"] == ["VSCode"]
    assert len(fake_client.calls) == 1
    request = fake_client.calls[0]
    assert request["url"] == "http://127.0.0.1:11434/api/chat"
    assert request["json"]["stream"] is False
    assert request["json"]["options"]["num_predict"] == 500
