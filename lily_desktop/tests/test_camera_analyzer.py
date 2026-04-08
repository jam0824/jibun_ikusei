"""Unit tests for camera analysis helpers."""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any
from unittest.mock import patch

import cv2
import numpy as np
import pytest

from ai.camera_analyzer import analyze_camera_frame, _parse_analysis, _resize_frame_png


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


def _make_test_png(width: int = 320, height: int = 240) -> bytes:
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    success, encoded = cv2.imencode(".png", image)
    assert success is True
    return encoded.tobytes()


class TestParseAnalysis:
    def test_parses_valid_json(self):
        raw = json.dumps(
            {
                "summary": "It is raining outside",
                "tags": ["weather", "rain"],
                "scene_type": "weather",
                "detail": "Dark clouds are visible in the frame",
            }
        )

        result = _parse_analysis(raw)

        assert result.summary == "It is raining outside"
        assert result.tags == ["weather", "rain"]
        assert result.scene_type == "weather"
        assert result.detail == "Dark clouds are visible in the frame"
        assert result.timestamp != ""

    def test_parses_json_wrapped_in_code_fence(self):
        raw = (
            "```json\n"
            '{"summary": "Desk scene", "tags": ["desk"], "scene_type": "indoor", '
            '"detail": "A monitor and keyboard are visible"}\n'
            "```"
        )

        result = _parse_analysis(raw)

        assert result.summary == "Desk scene"
        assert result.scene_type == "indoor"

    def test_falls_back_for_non_json_text(self):
        result = _parse_analysis("this is not json")

        assert result.summary != ""
        assert result.timestamp != ""

    def test_empty_text_uses_default_summary(self):
        result = _parse_analysis("")

        assert result.summary == "分析失敗"
        assert result.timestamp != ""

    def test_missing_fields_use_defaults(self):
        result = _parse_analysis(json.dumps({"summary": "Only summary"}))

        assert result.summary == "Only summary"
        assert result.tags == []
        assert result.scene_type == "other"
        assert result.detail == ""


class TestResizeFramePng:
    def test_large_images_are_resized_to_max_long_edge(self):
        image = np.full((600, 1000, 3), 255, dtype=np.uint8)
        success, encoded = cv2.imencode(".png", image)

        assert success is True

        resized_png = _resize_frame_png(encoded.tobytes(), max_long_edge=512)
        resized = cv2.imdecode(np.frombuffer(resized_png, dtype=np.uint8), cv2.IMREAD_COLOR)

        assert resized is not None
        assert max(resized.shape[:2]) == 512

    def test_small_images_are_left_unchanged(self):
        original_png = _make_test_png(width=400, height=300)

        resized_png = _resize_frame_png(original_png, max_long_edge=512)

        assert resized_png == original_png


@pytest.mark.asyncio
async def test_camera_analysis_uses_single_fixed_token_budget():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "choices": [
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
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {},
                }
            )
        ]
    )

    with patch("ai.camera_analyzer.httpx.AsyncClient", return_value=fake_client):
        result = await analyze_camera_frame(
            api_key="test",
            model="test-model",
            frame_png=_make_test_png(),
        )

    assert result.summary == "Desk scene"
    assert len(fake_client.calls) == 1
    assert fake_client.calls[0]["max_completion_tokens"] == 900


@pytest.mark.asyncio
async def test_camera_analysis_prompt_prioritizes_people_activity_before_room_context():
    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "summary": "人物が机に向かって作業している",
                                        "tags": ["人物", "作業"],
                                        "scene_type": "people",
                                        "detail": "人物が机に向かい、部屋の中は整っている",
                                    }
                                )
                            },
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {},
                }
            )
        ]
    )

    with patch("ai.camera_analyzer.httpx.AsyncClient", return_value=fake_client):
        await analyze_camera_frame(
            api_key="test",
            model="test-model",
            frame_png=_make_test_png(),
        )

    request = fake_client.calls[0]
    system_prompt = request["messages"][0]["content"]
    user_prompt = request["messages"][1]["content"][0]["text"]

    assert "まず人が何をしているかを把握し" in system_prompt
    assert "部屋や周囲の様子を補足する" in system_prompt
    assert "人物が写っている場合は、行動・姿勢・向き・手元の作業" in system_prompt
    assert "人物がいない場合は、そのことを明示" in system_prompt
    assert "人物は必要なときだけ触れる" not in system_prompt
    assert "まず人が何をしているか、次に部屋や周囲の様子" in user_prompt


@pytest.mark.asyncio
async def test_truncated_response_raises_without_retry():
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
                    "usage": {},
                }
            )
        ]
    )

    with patch("ai.camera_analyzer.httpx.AsyncClient", return_value=fake_client):
        with pytest.raises(Exception, match="Camera analysis response was truncated"):
            await analyze_camera_frame(
                api_key="test",
                model="test-model",
                frame_png=_make_test_png(),
            )

    assert len(fake_client.calls) == 1
