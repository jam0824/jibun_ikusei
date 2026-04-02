from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from health import healthplanet_client

JST = timezone(timedelta(hours=9))


def test_save_records_returns_only_new_records_in_jst_order(tmp_path, monkeypatch):
    monkeypatch.setattr(healthplanet_client, "_HEALTH_LOG_DIR", tmp_path)

    existing = {
        "date": "2026-04-02",
        "time": "07:00",
        "weight_kg": 60.1,
        "body_fat_pct": 20.0,
    }
    healthplanet_client.save_records([existing])

    records = [
        existing,
        {
            "date": "2026-04-02",
            "time": "08:30",
            "weight_kg": 60.0,
            "body_fat_pct": 19.8,
        },
        {
            "date": "2026-04-03",
            "time": "06:45",
            "weight_kg": 59.8,
            "body_fat_pct": 19.5,
        },
    ]

    new_records = healthplanet_client.save_records(records)

    assert [f"{record['date']} {record['time']}" for record in new_records] == [
        "2026-04-02 08:30",
        "2026-04-03 06:45",
    ]


@pytest.mark.asyncio
async def test_sync_health_data_returns_new_records(monkeypatch):
    expected_records = [
        {
            "date": "2026-04-03",
            "time": "07:15",
            "weight_kg": 59.7,
            "body_fat_pct": 19.4,
        }
    ]

    def fake_fetch(access_token: str, from_dt: datetime, to_dt: datetime) -> list[dict]:
        assert access_token == "token"
        assert from_dt.tzinfo == JST
        assert to_dt.tzinfo == JST
        return expected_records

    monkeypatch.setattr(healthplanet_client, "fetch_innerscan_sync", fake_fetch)
    monkeypatch.setattr(
        healthplanet_client,
        "save_records",
        lambda records: expected_records,
    )

    new_records, error = await healthplanet_client.sync_health_data(
        "client-id",
        "client-secret",
        "token",
    )

    assert error is None
    assert new_records == expected_records
