from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from api.api_client import ApiClient


@pytest.mark.asyncio
async def test_action_log_methods_use_expected_paths_and_payloads():
    client = object.__new__(ApiClient)
    client._request = AsyncMock(return_value={})

    await client.post_action_log_raw_events(
        {
            "deviceId": "device_1",
            "events": [
                {
                    "id": "raw_1",
                    "deviceId": "device_1",
                    "source": "desktop_agent",
                    "eventType": "active_window_changed",
                    "occurredAt": "2026-04-17T09:00:00+09:00",
                }
            ],
        }
    )
    await client.get_action_log_raw_events("2026-04-01", "2026-04-17")
    await client.get_action_log_sessions("2026-04-01", "2026-04-17")
    await client.get_action_log_daily_logs("2026-04-01", "2026-04-17")
    await client.get_action_log_weekly_reviews(2026)
    await client.get_action_log_devices()
    await client.put_action_log_device("device_1", {"name": "main-pc"})
    await client.get_action_log_privacy_rules()
    await client.put_action_log_privacy_rules(
        [
            {
                "id": "rule_1",
                "type": "domain",
                "value": "example.com",
                "mode": "domain_only",
                "enabled": True,
            }
        ]
    )

    client._request.assert_any_await(
        "POST",
        "/action-log/raw-events",
        json={
            "deviceId": "device_1",
            "events": [
                {
                    "id": "raw_1",
                    "deviceId": "device_1",
                    "source": "desktop_agent",
                    "eventType": "active_window_changed",
                    "occurredAt": "2026-04-17T09:00:00+09:00",
                }
            ],
        },
    )
    client._request.assert_any_await(
        "GET",
        "/action-log/raw-events",
        params={"from": "2026-04-01", "to": "2026-04-17"},
    )
    client._request.assert_any_await(
        "GET",
        "/action-log/sessions",
        params={"from": "2026-04-01", "to": "2026-04-17"},
    )
    client._request.assert_any_await(
        "GET",
        "/action-log/daily",
        params={"from": "2026-04-01", "to": "2026-04-17"},
    )
    client._request.assert_any_await(
        "GET",
        "/action-log/weekly",
        params={"year": "2026"},
    )
    client._request.assert_any_await("GET", "/action-log/devices")
    client._request.assert_any_await(
        "PUT",
        "/action-log/devices/device_1",
        json={"name": "main-pc"},
    )
    client._request.assert_any_await("GET", "/action-log/privacy-rules")
    client._request.assert_any_await(
        "PUT",
        "/action-log/privacy-rules",
        json={
            "rules": [
                {
                    "id": "rule_1",
                    "type": "domain",
                    "value": "example.com",
                    "mode": "domain_only",
                    "enabled": True,
                }
            ]
        },
    )
