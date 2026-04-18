from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import main as main_mod
from ai.camera_analyzer import CameraAnalysis


def _make_app(*, capture_camera_result, recent_events):
    return SimpleNamespace(
        config=SimpleNamespace(
            openai=SimpleNamespace(api_key="test-key", screen_analysis_model="unused"),
            camera=SimpleNamespace(
                analysis_provider="ollama",
                analysis_base_url="http://127.0.0.1:11434",
                analysis_model="gemma4:e4b",
            ),
            desktop=SimpleNamespace(
                analysis_provider="ollama",
                analysis_base_url="http://127.0.0.1:11434",
                analysis_model="gemma4:e4b",
            ),
        ),
        _camera_device_index=0,
        _last_situation_capture_skip_reason="",
        situation_capture=SimpleNamespace(
            capture_for_record=AsyncMock(
                side_effect=AssertionError("desktop screenshot capture should not be used")
            ),
            capture_camera=AsyncMock(return_value=capture_camera_result),
        ),
        activity_capture_service=SimpleNamespace(
            snapshot_recent_events=Mock(return_value=recent_events)
        ),
        situation_logger=SimpleNamespace(record=Mock()),
    )


@pytest.mark.asyncio
async def test_capture_and_record_uses_action_log_summary_instead_of_desktop_capture(
    monkeypatch,
):
    async def _fake_summary(**kwargs):
        del kwargs
        return SimpleNamespace(
            summary="VS Codeで実装を進めているようです。",
            tags=["Code.exe"],
            activity_type="coding",
            latest_app_name="Code.exe",
            latest_window_title="main.py - VS Code",
        )

    monkeypatch.setattr(main_mod, "summarize_recent_desktop_activity", _fake_summary)
    app = _make_app(
        capture_camera_result=SimpleNamespace(
            skipped=False,
            skip_reason="",
            error="",
            analysis=CameraAnalysis(
                summary="部屋で作業中",
                tags=["indoor"],
                scene_type="indoor",
                detail="デスクに向かっている",
                timestamp="2026-04-18 09:10:00",
            ),
        ),
        recent_events=[
            {
                "occurredAt": "2026-04-18T09:08:30+09:00",
                "eventType": "active_window_changed",
                "appName": "Code.exe",
                "windowTitle": "main.py - VS Code",
            }
        ],
    )

    record = await main_mod.App._capture_and_record_coordinated(app)

    assert record is not None
    assert record.camera_summary == "部屋で作業中"
    assert record.desktop_summary == "VS Codeで実装を進めているようです。"
    assert record.desktop_activity_type == "coding"
    assert record.active_app == "Code.exe"
    assert record.window_title == "main.py - VS Code"
    app.situation_capture.capture_camera.assert_awaited_once()
    app.situation_logger.record.assert_called_once()


@pytest.mark.asyncio
async def test_capture_and_record_keeps_desktop_summary_when_camera_capture_fails(
    monkeypatch,
):
    async def _fake_summary(**kwargs):
        del kwargs
        return SimpleNamespace(
            summary="ブラウザで調べものを進めているようです。",
            tags=["example.com"],
            activity_type="browsing",
            latest_app_name="chrome.exe",
            latest_window_title="Example Docs",
        )

    monkeypatch.setattr(main_mod, "summarize_recent_desktop_activity", _fake_summary)
    app = _make_app(
        capture_camera_result=SimpleNamespace(
            skipped=False,
            skip_reason="",
            error="camera failed",
            analysis=None,
        ),
        recent_events=[
            {
                "occurredAt": "2026-04-18T09:08:30+09:00",
                "eventType": "browser_page_changed",
                "appName": "chrome.exe",
                "windowTitle": "Example Docs",
                "domain": "example.com",
            }
        ],
    )

    record = await main_mod.App._capture_and_record_coordinated(app)

    assert record is not None
    assert record.camera_summary == ""
    assert record.desktop_summary == "ブラウザで調べものを進めているようです。"
    assert record.active_app == "chrome.exe"
    assert record.window_title == "Example Docs"
