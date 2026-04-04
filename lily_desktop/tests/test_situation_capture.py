"""Tests for shared situation capture coordination."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from ai.camera_analyzer import CameraAnalysis
from ai.screen_analyzer import ScreenAnalysis
from ai.talk_seed import TalkSeedManager
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
async def test_record_capture_skips_when_another_record_capture_is_running(monkeypatch):
    import core.situation_capture as mod

    coordinator = SituationCaptureCoordinator()
    camera_entered = asyncio.Event()
    release_camera = asyncio.Event()
    calls = {"frame": 0, "camera": 0, "desktop": 0}

    def fake_capture_camera_frame(device_index: int) -> bytes:
        calls["frame"] += 1
        return b"frame"

    async def fake_analyze_camera_frame(**kwargs) -> CameraAnalysis:
        calls["camera"] += 1
        camera_entered.set()
        await release_camera.wait()
        return _make_camera_analysis()

    async def fake_fetch_desktop_context(**kwargs) -> DesktopContext:
        calls["desktop"] += 1
        return _make_desktop_context()

    monkeypatch.setattr(mod, "capture_camera_frame", fake_capture_camera_frame)
    monkeypatch.setattr(mod, "analyze_camera_frame", fake_analyze_camera_frame)
    monkeypatch.setattr(mod, "fetch_desktop_context", fake_fetch_desktop_context)

    first_task = asyncio.create_task(
        coordinator.capture_for_record(
            api_key="test-key",
            camera_model="camera-model",
            screen_model="screen-model",
            camera_device_index=0,
        )
    )
    await camera_entered.wait()

    second_result = await coordinator.capture_for_record(
        api_key="test-key",
        camera_model="camera-model",
        screen_model="screen-model",
        camera_device_index=0,
    )

    release_camera.set()
    first_result = await first_task

    assert first_result.skipped is False
    assert first_result.camera.analysis is not None
    assert first_result.desktop.context is not None
    assert second_result.skipped is True
    assert second_result.skip_reason != ""
    assert calls == {"frame": 1, "camera": 1, "desktop": 1}


@pytest.mark.asyncio
async def test_desktop_capture_returns_skip_result_when_busy(monkeypatch):
    import core.situation_capture as mod

    coordinator = SituationCaptureCoordinator()
    desktop_entered = asyncio.Event()
    release_desktop = asyncio.Event()
    calls = {"desktop": 0}

    async def fake_fetch_desktop_context(**kwargs) -> DesktopContext:
        calls["desktop"] += 1
        desktop_entered.set()
        await release_desktop.wait()
        return _make_desktop_context()

    monkeypatch.setattr(mod, "fetch_desktop_context", fake_fetch_desktop_context)

    first_task = asyncio.create_task(
        coordinator.capture_desktop(
            api_key="test-key",
            model="screen-model",
        )
    )
    await desktop_entered.wait()

    second_result = await coordinator.capture_desktop(
        api_key="test-key",
        model="screen-model",
    )

    release_desktop.set()
    first_result = await first_task

    assert first_result.skipped is False
    assert first_result.context is not None
    assert second_result.skipped is True
    assert second_result.context is None
    assert second_result.skip_reason != ""
    assert calls == {"desktop": 1}


@pytest.mark.asyncio
async def test_talk_seed_collection_skips_camera_and_desktop_while_record_capture_runs(monkeypatch):
    import core.situation_capture as mod

    coordinator = SituationCaptureCoordinator()
    camera_entered = asyncio.Event()
    release_camera = asyncio.Event()
    calls = {"frame": 0, "camera": 0, "desktop": 0}

    def fake_capture_camera_frame(device_index: int) -> bytes:
        calls["frame"] += 1
        return b"frame"

    async def fake_analyze_camera_frame(**kwargs) -> CameraAnalysis:
        calls["camera"] += 1
        camera_entered.set()
        await release_camera.wait()
        return _make_camera_analysis()

    async def fake_fetch_desktop_context(**kwargs) -> DesktopContext:
        calls["desktop"] += 1
        return _make_desktop_context()

    monkeypatch.setattr(mod, "capture_camera_frame", fake_capture_camera_frame)
    monkeypatch.setattr(mod, "analyze_camera_frame", fake_analyze_camera_frame)
    monkeypatch.setattr(mod, "fetch_desktop_context", fake_fetch_desktop_context)

    seed_manager = TalkSeedManager(
        openai_api_key="test-key",
        screen_analysis_model="screen-model",
        camera_enabled=True,
        camera_analysis_model="camera-model",
        situation_capture_coordinator=coordinator,
    )
    monkeypatch.setattr(seed_manager, "_collect_wikimedia", AsyncMock(return_value=[]))
    monkeypatch.setattr(seed_manager, "_collect_wikimedia_interest", AsyncMock(return_value=[]))
    monkeypatch.setattr(seed_manager, "_collect_annict", AsyncMock(return_value=[]))
    monkeypatch.setattr(seed_manager, "_collect_health", AsyncMock(return_value=[]))

    first_task = asyncio.create_task(
        coordinator.capture_for_record(
            api_key="test-key",
            camera_model="camera-model",
            screen_model="screen-model",
            camera_device_index=0,
        )
    )
    await camera_entered.wait()

    seeds = await seed_manager.collect_seeds()

    release_camera.set()
    await first_task

    assert seeds == []
    assert calls == {"frame": 1, "camera": 1, "desktop": 1}
