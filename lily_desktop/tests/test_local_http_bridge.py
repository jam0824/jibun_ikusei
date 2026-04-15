from __future__ import annotations

import http.client
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest

from core.config import HttpBridgeConfig
from core.local_http_bridge import (
    BridgeValidationError,
    LocalHttpBridge,
    start_local_http_bridge,
    validate_http_bridge_event,
)


JST = timezone(timedelta(hours=9))


class _ImmediateLoop:
    def call_soon_threadsafe(self, callback, *args):
        callback(*args)


def test_validate_user_message_event_uses_received_at_when_occurred_at_missing():
    received_at = datetime(2026, 4, 4, 21, 15, tzinfo=JST)

    accepted = validate_http_bridge_event(
        {
            "eventType": "user_message",
            "source": "chrome_extension",
            "payload": {"text": "こんにちは"},
        },
        received_at=received_at,
    )

    assert accepted.event_type == "user_message"
    assert accepted.source == "chrome_extension"
    assert accepted.occurred_at == received_at
    assert accepted.message_role == "user"
    assert accepted.internal_user_message == "こんにちは"


def test_validate_system_message_event_marks_system_role():
    received_at = datetime(2026, 4, 4, 21, 15, tzinfo=JST)

    accepted = validate_http_bridge_event(
        {
            "eventType": "system_message",
            "source": "chrome_extension",
            "payload": {"text": "学習クエスト達成です。+2 XP 獲得しました。"},
        },
        received_at=received_at,
    )

    assert accepted.event_type == "system_message"
    assert accepted.message_role == "system"
    assert accepted.occurred_at == received_at
    assert accepted.internal_user_message == "学習クエスト達成です。+2 XP 獲得しました。"


def test_validate_quest_completed_event_builds_internal_user_message():
    accepted = validate_http_bridge_event(
        {
            "eventType": "quest_completed",
            "source": "chrome_extension",
            "payload": {
                "title": "Reactチュートリアルを見る",
                "xp": 2,
                "category": "学習",
                "note": "初回30分到達",
            },
        },
        received_at=datetime(2026, 4, 4, 21, 15, tzinfo=JST),
    )

    assert accepted.internal_user_message == (
        "クエスト「Reactチュートリアルを見る」をクリアしたよ。"
        "XPは+2だよ。"
        "カテゴリは「学習」だよ。"
        "メモは「初回30分到達」だよ。"
    )
    assert accepted.message_role == "user"


def test_validate_chrome_audible_tabs_event_accepts_full_snapshot():
    accepted = validate_http_bridge_event(
        {
            "eventType": "chrome_audible_tabs",
            "source": "chrome_extension",
            "payload": {
                "audibleTabs": [
                    {"tabId": 1, "domain": "youtube.com"},
                    {"tabId": 2, "domain": "netflix.com"},
                ]
            },
        },
        received_at=datetime(2026, 4, 4, 21, 15, tzinfo=JST),
    )

    assert accepted.event_type == "chrome_audible_tabs"
    assert accepted.payload == {
        "audibleTabs": [
            {"tabId": 1, "domain": "youtube.com"},
            {"tabId": 2, "domain": "netflix.com"},
        ]
    }
    assert accepted.message_role is None
    assert accepted.internal_user_message == ""


@pytest.mark.parametrize(
    "payload",
    [
        {"audibleTabs": "invalid"},
        {"audibleTabs": [{"tabId": "1", "domain": "youtube.com"}]},
        {"audibleTabs": [{"tabId": 1, "domain": ""}]},
    ],
)
def test_validate_chrome_audible_tabs_event_rejects_invalid_payload(payload):
    with pytest.raises(BridgeValidationError) as exc_info:
        validate_http_bridge_event(
            {
                "eventType": "chrome_audible_tabs",
                "source": "chrome_extension",
                "payload": payload,
            },
            received_at=datetime(2026, 4, 4, 21, 15, tzinfo=JST),
        )

    assert exc_info.value.code == "invalid_payload"


@pytest.mark.parametrize(
    ("occurred_at", "expected_code"),
    [
        ("2026-04-04T12:15:00Z", "invalid_occurred_at"),
        ("2026-04-04T12:15:00+00:00", "invalid_occurred_at"),
    ],
)
def test_validate_http_bridge_event_rejects_non_jst_occurred_at(occurred_at, expected_code):
    with pytest.raises(BridgeValidationError) as exc_info:
        validate_http_bridge_event(
            {
                "eventType": "user_message",
                "source": "chrome_extension",
                "occurredAt": occurred_at,
                "payload": {"text": "こんにちは"},
            },
            received_at=datetime(2026, 4, 4, 21, 15, tzinfo=JST),
        )

    assert exc_info.value.code == expected_code


@pytest.mark.parametrize(
    ("body", "expected_status", "expected_code"),
    [
        (
            {
                "eventType": "user_message",
                "source": "chrome_extension",
                "payload": {"text": "HTTPからこんにちは"},
            },
            202,
            None,
        ),
        (
            {
                "eventType": "user_message",
                "source": "chrome_extension",
                "occurredAt": "2026-04-04T12:15:00Z",
                "payload": {"text": "こんにちは"},
            },
            400,
            "invalid_occurred_at",
        ),
        (
            {
                "eventType": "unsupported",
                "source": "chrome_extension",
                "payload": {},
            },
            400,
            "unsupported_event_type",
        ),
    ],
)
def test_local_http_bridge_post_endpoint(body, expected_status, expected_code):
    received_messages: list[str] = []
    received_system_messages: list[str] = []
    audible_snapshots: list[tuple[datetime, list[dict[str, object]]]] = []
    bridge = LocalHttpBridge(
        port=0,
        event_loop=_ImmediateLoop(),
        emit_user_message=received_messages.append,
        emit_system_message=received_system_messages.append,
        update_chrome_audible_tabs=lambda received_at, audible_tabs: audible_snapshots.append(
            (received_at, audible_tabs)
        ),
    )
    bridge.start()

    try:
        conn = http.client.HTTPConnection(bridge.host, bridge.port, timeout=5)
        conn.request(
            "POST",
            "/v1/events",
            body=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        conn.close()
    finally:
        bridge.stop()

    assert response.status == expected_status
    if expected_status == 202:
        assert payload["ok"] is True
        assert payload["status"] == "accepted"
        assert payload["eventType"] == "user_message"
        assert received_messages == ["HTTPからこんにちは"]
        assert received_system_messages == []
        assert audible_snapshots == []
    else:
        assert payload["ok"] is False
        assert payload["error"]["code"] == expected_code


def test_local_http_bridge_dispatches_system_message_without_user_message():
    received_messages: list[str] = []
    received_system_messages: list[str] = []
    bridge = LocalHttpBridge(
        port=0,
        event_loop=_ImmediateLoop(),
        emit_user_message=received_messages.append,
        emit_system_message=received_system_messages.append,
    )
    bridge.start()

    try:
        conn = http.client.HTTPConnection(bridge.host, bridge.port, timeout=5)
        conn.request(
            "POST",
            "/v1/events",
            body=json.dumps(
                {
                    "eventType": "system_message",
                    "source": "chrome_extension",
                    "payload": {
                        "text": "集中が続いていますね。さらに +2 XP です。",
                    },
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        conn.close()
    finally:
        bridge.stop()

    assert response.status == 202
    assert payload["ok"] is True
    assert payload["eventType"] == "system_message"
    assert received_messages == []
    assert received_system_messages == ["集中が続いていますね。さらに +2 XP です。"]


def test_local_http_bridge_dispatches_chrome_audible_tabs_without_user_message():
    received_messages: list[str] = []
    received_system_messages: list[str] = []
    audible_snapshots: list[tuple[datetime, list[dict[str, object]]]] = []
    bridge = LocalHttpBridge(
        port=0,
        event_loop=_ImmediateLoop(),
        emit_user_message=received_messages.append,
        emit_system_message=received_system_messages.append,
        update_chrome_audible_tabs=lambda received_at, audible_tabs: audible_snapshots.append(
            (received_at, audible_tabs)
        ),
    )
    bridge.start()

    try:
        conn = http.client.HTTPConnection(bridge.host, bridge.port, timeout=5)
        conn.request(
            "POST",
            "/v1/events",
            body=json.dumps(
                {
                    "eventType": "chrome_audible_tabs",
                    "source": "chrome_extension",
                    "payload": {
                        "audibleTabs": [
                            {"tabId": 1, "domain": "youtube.com"},
                            {"tabId": 2, "domain": "netflix.com"},
                        ]
                    },
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        conn.close()
    finally:
        bridge.stop()

    assert response.status == 202
    assert payload["ok"] is True
    assert payload["eventType"] == "chrome_audible_tabs"
    assert received_messages == []
    assert received_system_messages == []
    assert len(audible_snapshots) == 1
    received_at, audible_tabs = audible_snapshots[0]
    assert received_at.tzinfo == JST
    assert audible_tabs == [
        {"tabId": 1, "domain": "youtube.com"},
        {"tabId": 2, "domain": "netflix.com"},
    ]


def test_local_http_bridge_returns_not_found_for_unknown_path():
    bridge = LocalHttpBridge(
        port=0,
        event_loop=_ImmediateLoop(),
        emit_user_message=lambda _message: None,
        emit_system_message=lambda _message: None,
    )
    bridge.start()

    try:
        conn = http.client.HTTPConnection(bridge.host, bridge.port, timeout=5)
        conn.request(
            "POST",
            "/v1/unknown",
            body=b"{}",
            headers={"Content-Type": "application/json"},
        )
        response = conn.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        conn.close()
    finally:
        bridge.stop()

    assert response.status == 404
    assert payload["error"]["code"] == "not_found"


def test_local_http_bridge_returns_method_not_allowed_for_get():
    bridge = LocalHttpBridge(
        port=0,
        event_loop=_ImmediateLoop(),
        emit_user_message=lambda _message: None,
        emit_system_message=lambda _message: None,
    )
    bridge.start()

    try:
        conn = http.client.HTTPConnection(bridge.host, bridge.port, timeout=5)
        conn.request("GET", "/v1/events")
        response = conn.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        conn.close()
    finally:
        bridge.stop()

    assert response.status == 405
    assert payload["error"]["code"] == "method_not_allowed"


def test_start_local_http_bridge_returns_none_when_port_is_unavailable(monkeypatch, caplog):
    def _raise_port_in_use(self):
        raise OSError("address already in use")

    monkeypatch.setattr(LocalHttpBridge, "start", _raise_port_in_use)

    with caplog.at_level(logging.WARNING):
        bridge = start_local_http_bridge(
            HttpBridgeConfig(enabled=True, port=18765),
            event_loop=_ImmediateLoop(),
            emit_user_message=lambda _message: None,
            emit_system_message=lambda _message: None,
        )

    assert bridge is None
    assert "Local HTTP bridge の起動に失敗" in caplog.text
