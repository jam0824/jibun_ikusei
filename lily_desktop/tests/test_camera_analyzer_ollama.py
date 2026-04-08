from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from ai.camera_analyzer import analyze_camera_frame


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


def _make_test_png(width: int = 320, height: int = 240) -> bytes:
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    success, encoded = cv2.imencode(".png", image)
    assert success is True
    return encoded.tobytes()


@pytest.mark.asyncio
async def test_camera_analysis_uses_ollama_chat_api_with_images():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "summary": "Desk scene",
                                "tags": ["desk"],
                                "scene_type": "indoor",
                                "detail": "A monitor and keyboard are visible",
                            }
                        )
                    },
                    "done_reason": "stop",
                    "prompt_eval_count": 12,
                    "eval_count": 34,
                }
            )
        ]
    )

    with patch("ai.camera_analyzer.httpx.AsyncClient", return_value=fake_client):
        result = await analyze_camera_frame(
            api_key="",
            provider="ollama",
            base_url="http://127.0.0.1:11434",
            model="gemma4:e4b",
            frame_png=_make_test_png(),
        )

    assert result.summary == "Desk scene"
    assert len(fake_client.calls) == 1
    request = fake_client.calls[0]
    assert request["url"] == "http://127.0.0.1:11434/api/chat"
    assert request["json"]["stream"] is False
    assert request["json"]["options"]["num_predict"] == 900
    assert request["json"]["messages"][1]["images"]


@pytest.mark.asyncio
async def test_camera_analysis_raises_for_ollama_http_errors():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {"error": "model not found"},
                status_code=404,
                text="model not found",
            )
        ]
    )

    with patch("ai.camera_analyzer.httpx.AsyncClient", return_value=fake_client):
        with pytest.raises(Exception, match="Camera analysis failed"):
            await analyze_camera_frame(
                api_key="",
                provider="ollama",
                base_url="http://127.0.0.1:11434",
                model="gemma4:e4b",
                frame_png=_make_test_png(),
            )
