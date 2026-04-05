from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

import main as main_mod


@pytest.mark.asyncio
async def test_run_healthplanet_sync_posts_only_new_records(monkeypatch):
    new_records = [
        {
            "date": "2026-04-05",
            "time": "07:00",
            "weight_kg": 65.0,
            "body_fat_pct": 18.0,
        }
    ]
    sync_mock = AsyncMock(return_value=(new_records, None))
    post_health_data = AsyncMock()
    query_mock = Mock(side_effect=AssertionError("query_health_data should not be called"))

    monkeypatch.setattr(main_mod, "sync_health_data", sync_mock)
    monkeypatch.setattr(main_mod, "query_health_data", query_mock)
    monkeypatch.setattr(
        main_mod,
        "emit_weight_quest_clear_for_new_records",
        Mock(return_value=new_records[-1]),
    )

    app = SimpleNamespace(
        _healthplanet_sync_in_progress=False,
        config=SimpleNamespace(
            healthplanet=SimpleNamespace(
                client_id="client",
                client_secret="secret",
                access_token="token",
            )
        ),
        auth=SimpleNamespace(is_configured=True),
        api_client=SimpleNamespace(post_health_data=post_health_data),
    )

    await main_mod.App._run_healthplanet_sync(app)

    sync_mock.assert_awaited_once()
    post_health_data.assert_awaited_once_with(new_records)
    query_mock.assert_not_called()


@pytest.mark.asyncio
async def test_run_healthplanet_sync_skips_cloud_post_when_no_new_records(monkeypatch):
    sync_mock = AsyncMock(return_value=([], None))
    post_health_data = AsyncMock()

    monkeypatch.setattr(main_mod, "sync_health_data", sync_mock)
    monkeypatch.setattr(
        main_mod,
        "emit_weight_quest_clear_for_new_records",
        Mock(return_value=None),
    )

    app = SimpleNamespace(
        _healthplanet_sync_in_progress=False,
        config=SimpleNamespace(
            healthplanet=SimpleNamespace(
                client_id="client",
                client_secret="secret",
                access_token="token",
            )
        ),
        auth=SimpleNamespace(is_configured=True),
        api_client=SimpleNamespace(post_health_data=post_health_data),
    )

    await main_mod.App._run_healthplanet_sync(app)

    sync_mock.assert_awaited_once()
    post_health_data.assert_not_awaited()
