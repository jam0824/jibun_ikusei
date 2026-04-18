from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import ai.talk_seed as talk_seed_mod
from ai.talk_seed import TalkSeedManager


@pytest.mark.asyncio
async def test_collect_desktop_uses_action_log_summary_instead_of_screenshot_capture(
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

    monkeypatch.setattr(talk_seed_mod, "summarize_recent_desktop_activity", _fake_summary)

    seed_mgr = TalkSeedManager(
        openai_api_key="test",
        screen_analysis_model="unused",
        desktop_analysis_provider="ollama",
        desktop_analysis_base_url="http://127.0.0.1:11434",
        activity_capture_service=SimpleNamespace(
            snapshot_recent_events=Mock(
                return_value=[
                    {
                        "occurredAt": "2026-04-18T09:08:30+09:00",
                        "eventType": "active_window_changed",
                        "appName": "Code.exe",
                        "windowTitle": "main.py - VS Code",
                    }
                ]
            )
        ),
        situation_capture_coordinator=SimpleNamespace(
            capture_desktop=AsyncMock(
                side_effect=AssertionError("desktop screenshot capture should not be used")
            )
        ),
    )

    seeds = await seed_mgr._collect_desktop()

    assert len(seeds) == 1
    assert seeds[0].source == "desktop"
    assert seeds[0].summary == "VS Codeで実装を進めているようです。"
    assert seeds[0].tags == ["Code.exe"]


@pytest.mark.asyncio
async def test_collect_desktop_skips_when_activity_summary_is_idle_or_empty(monkeypatch):
    async def _fake_summary(**kwargs):
        del kwargs
        return SimpleNamespace(
            summary="",
            tags=[],
            activity_type="idle",
            latest_app_name="",
            latest_window_title="",
        )

    monkeypatch.setattr(talk_seed_mod, "summarize_recent_desktop_activity", _fake_summary)

    seed_mgr = TalkSeedManager(
        openai_api_key="test",
        screen_analysis_model="unused",
        activity_capture_service=SimpleNamespace(snapshot_recent_events=Mock(return_value=[])),
    )

    seeds = await seed_mgr._collect_desktop()

    assert seeds == []
