from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from ai.camera_analyzer import CameraAnalysis
from ai.screen_analyzer import ScreenAnalysis
from core.active_window import ActiveWindowInfo
from core.desktop_context import DesktopContext
from core.situation_capture import SituationCaptureCoordinator


def _make_camera_analysis() -> CameraAnalysis:
    return CameraAnalysis(
        summary="Desk scene",
        tags=["desk"],
        scene_type="indoor",
        detail="A desk and monitor are visible",
        timestamp="2026-04-04 21:30:00",
    )


def _make_desktop_context() -> DesktopContext:
    return DesktopContext(
        window_info=ActiveWindowInfo(
            app_name="chrome.exe",
            window_title="GitHub Pull Request",
        ),
        analysis=ScreenAnalysis(
            summary="Reviewing a pull request",
            tags=["GitHub", "PR"],
            activity_type="reading",
            detail="The browser shows a merged pull request",
            timestamp="2026-04-04 21:30:00",
        ),
    )


@pytest.mark.asyncio
async def test_record_capture_passes_camera_provider_settings(monkeypatch):
    import core.situation_capture as mod

    coordinator = SituationCaptureCoordinator()

    def fake_capture_camera_frame(device_index: int) -> bytes:
        return b"frame"

    analyze_camera_frame = AsyncMock(return_value=_make_camera_analysis())
    fetch_desktop_context = AsyncMock(return_value=_make_desktop_context())

    monkeypatch.setattr(mod, "capture_camera_frame", fake_capture_camera_frame)
    monkeypatch.setattr(mod, "analyze_camera_frame", analyze_camera_frame)
    monkeypatch.setattr(mod, "fetch_desktop_context", fetch_desktop_context)

    result = await coordinator.capture_for_record(
        api_key="",
        camera_provider="ollama",
        camera_base_url="http://127.0.0.1:11434",
        camera_model="gemma4:e4b",
        screen_model="screen-model",
        camera_device_index=0,
    )

    assert result.camera.analysis is not None
    analyze_camera_frame.assert_awaited_once()
    kwargs = analyze_camera_frame.await_args.kwargs
    assert kwargs["provider"] == "ollama"
    assert kwargs["base_url"] == "http://127.0.0.1:11434"
    assert kwargs["model"] == "gemma4:e4b"
