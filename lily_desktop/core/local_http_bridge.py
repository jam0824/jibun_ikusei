from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

from core.config import HttpBridgeConfig


JST = timezone(timedelta(hours=9))
HTTP_BRIDGE_HOST = "127.0.0.1"
HTTP_BRIDGE_ENDPOINT = "/v1/events"
_SUPPORTED_EVENT_TYPES = frozenset(
    {
        "user_message",
        "system_message",
        "quest_completed",
        "chrome_audible_tabs",
        "browser_page_changed",
        "heartbeat",
    }
)
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AcceptedHttpBridgeEvent:
    event_type: str
    message_role: str | None
    source: str
    payload: dict[str, Any]
    event_id: str | None
    occurred_at: datetime
    received_at: datetime
    metadata: dict[str, Any]
    internal_user_message: str = ""


class BridgeValidationError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _format_jst_iso(dt: datetime) -> str:
    return dt.astimezone(JST).isoformat(timespec="seconds")


def _require_non_empty_string(value: object, field_name: str) -> str:
    if not isinstance(value, str):
        raise BridgeValidationError(
            "invalid_payload",
            f"{field_name} must be a non-empty string.",
        )
    normalized = value.strip()
    if not normalized:
        raise BridgeValidationError(
            "invalid_payload",
            f"{field_name} must be a non-empty string.",
        )
    return normalized


def _optional_string(value: object, field_name: str) -> str | None:
    if value is None:
        return None
    return _require_non_empty_string(value, field_name)


def _optional_metadata(value: object) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise BridgeValidationError(
            "invalid_payload",
            "metadata must be an object.",
        )
    return dict(value)


def _optional_xp(value: object) -> int | float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BridgeValidationError(
            "invalid_payload",
            "payload.xp must be a number.",
        )
    return value


def _require_tab_id(value: object, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise BridgeValidationError(
            "invalid_payload",
            f"{field_name} must be an integer.",
        )
    return value


def _parse_audible_tabs_payload(payload_raw: dict[str, Any]) -> dict[str, Any]:
    audible_tabs = payload_raw.get("audibleTabs")
    if not isinstance(audible_tabs, list):
        raise BridgeValidationError(
            "invalid_payload",
            "payload.audibleTabs must be an array.",
        )

    normalized_tabs: list[dict[str, Any]] = []
    for index, item in enumerate(audible_tabs):
        if not isinstance(item, dict):
            raise BridgeValidationError(
                "invalid_payload",
                f"payload.audibleTabs[{index}] must be an object.",
            )
        normalized_tabs.append(
            {
                "tabId": _require_tab_id(item.get("tabId"), f"payload.audibleTabs[{index}].tabId"),
                "domain": _require_non_empty_string(
                    item.get("domain"),
                    f"payload.audibleTabs[{index}].domain",
                ),
            }
        )
    return {"audibleTabs": normalized_tabs}


def _optional_number(value: object, field_name: str) -> int | float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BridgeValidationError(
            "invalid_payload",
            f"{field_name} must be a number.",
        )
    return value


def _parse_browser_action_payload(payload_raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "tabId": _require_tab_id(payload_raw.get("tabId"), "payload.tabId"),
        "url": _require_non_empty_string(payload_raw.get("url"), "payload.url"),
        "domain": _require_non_empty_string(payload_raw.get("domain"), "payload.domain"),
        "title": _optional_string(payload_raw.get("title"), "payload.title"),
    }


def _parse_browser_action_metadata(value: object) -> dict[str, Any]:
    metadata = _optional_metadata(value)
    trigger = metadata.get("trigger")
    if trigger not in {"tab_activated", "url_changed", "window_focus", "flush"}:
        raise BridgeValidationError(
            "invalid_payload",
            "metadata.trigger must be one of tab_activated, url_changed, window_focus, flush.",
        )

    normalized: dict[str, Any] = {"trigger": trigger}
    elapsed_seconds = _optional_number(metadata.get("elapsedSeconds"), "metadata.elapsedSeconds")
    if elapsed_seconds is not None:
        normalized["elapsedSeconds"] = elapsed_seconds

    for field_name in ("category", "cacheKey"):
        normalized_value = _optional_string(metadata.get(field_name), f"metadata.{field_name}")
        if normalized_value is not None:
            normalized[field_name] = normalized_value

    is_growth = metadata.get("isGrowth")
    if is_growth is not None:
        if not isinstance(is_growth, bool):
            raise BridgeValidationError(
                "invalid_payload",
                "metadata.isGrowth must be a boolean.",
            )
        normalized["isGrowth"] = is_growth

    return normalized


def _parse_occurred_at(value: object, *, received_at: datetime) -> datetime:
    if value is None:
        return received_at
    if not isinstance(value, str):
        raise BridgeValidationError(
            "invalid_occurred_at",
            "occurredAt must be a JST RFC3339 string.",
        )
    if value.endswith("Z"):
        raise BridgeValidationError(
            "invalid_occurred_at",
            "occurredAt must use a JST (+09:00) offset.",
        )
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise BridgeValidationError(
            "invalid_occurred_at",
            "occurredAt must be a JST RFC3339 string.",
        ) from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(hours=9):
        raise BridgeValidationError(
            "invalid_occurred_at",
            "occurredAt must use a JST (+09:00) offset.",
        )
    return parsed.astimezone(JST)


def _format_signed_number(value: int | float) -> str:
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return f"+{value}" if value > 0 else str(value)


def _build_quest_completed_message(payload: dict[str, Any]) -> str:
    title = payload["title"]
    parts = [f"クエスト「{title}」をクリアしたよ。"]

    xp = payload.get("xp")
    if xp is not None:
        parts.append(f"XPは{_format_signed_number(xp)}だよ。")

    category = payload.get("category")
    if category:
        parts.append(f"カテゴリは「{category}」だよ。")

    note = payload.get("note")
    if note:
        parts.append(f"メモは「{note}」だよ。")

    return "".join(parts)


def validate_http_bridge_event(
    data: object,
    *,
    received_at: datetime | None = None,
) -> AcceptedHttpBridgeEvent:
    if not isinstance(data, dict):
        raise BridgeValidationError(
            "invalid_payload",
            "Request body must be a JSON object.",
        )

    current_received_at = received_at.astimezone(JST) if received_at is not None else datetime.now(JST)
    event_type = _require_non_empty_string(data.get("eventType"), "eventType")
    if event_type not in _SUPPORTED_EVENT_TYPES:
        raise BridgeValidationError(
            "unsupported_event_type",
            f"Unsupported eventType: {event_type}",
        )

    source = _require_non_empty_string(data.get("source"), "source")
    event_id = _optional_string(data.get("eventId"), "eventId")
    occurred_at = _parse_occurred_at(data.get("occurredAt"), received_at=current_received_at)
    metadata = _optional_metadata(data.get("metadata"))

    payload_raw = data.get("payload")
    if not isinstance(payload_raw, dict):
        raise BridgeValidationError(
            "invalid_payload",
            "payload must be an object.",
        )

    if event_type == "user_message":
        payload = {
            "text": _require_non_empty_string(payload_raw.get("text"), "payload.text"),
        }
        message_role = "user"
        internal_user_message = payload["text"]
    elif event_type == "system_message":
        payload = {
            "text": _require_non_empty_string(payload_raw.get("text"), "payload.text"),
        }
        message_role = "system"
        internal_user_message = payload["text"]
    elif event_type == "quest_completed":
        payload = {
            "title": _require_non_empty_string(payload_raw.get("title"), "payload.title"),
            "xp": _optional_xp(payload_raw.get("xp")),
            "category": _optional_string(payload_raw.get("category"), "payload.category"),
            "note": _optional_string(payload_raw.get("note"), "payload.note"),
        }
        message_role = "user"
        internal_user_message = _build_quest_completed_message(payload)
    elif event_type == "chrome_audible_tabs":
        payload = _parse_audible_tabs_payload(payload_raw)
        message_role = None
        internal_user_message = ""
    else:
        payload = _parse_browser_action_payload(payload_raw)
        metadata = _parse_browser_action_metadata(data.get("metadata"))
        message_role = None
        internal_user_message = ""

    return AcceptedHttpBridgeEvent(
        event_type=event_type,
        message_role=message_role,
        source=source,
        payload=payload,
        event_id=event_id,
        occurred_at=occurred_at,
        received_at=current_received_at,
        metadata=metadata,
        internal_user_message=internal_user_message,
    )


class _LocalHttpBridgeServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address: tuple[str, int], bridge: "LocalHttpBridge"):
        super().__init__(server_address, _LocalHttpBridgeRequestHandler)
        self.bridge = bridge


class _LocalHttpBridgeRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args) -> None:
        self.server.bridge.logger.debug("Local HTTP bridge: " + format, *args)

    def do_POST(self) -> None:
        received_at = datetime.now(JST)
        if self.path != HTTP_BRIDGE_ENDPOINT:
            self._write_error(404, "not_found", "Endpoint not found.")
            self.server.bridge.log_result(
                event_type="",
                source="",
                event_id=None,
                received_at=received_at,
                result="rejected",
                code="not_found",
            )
            return

        if self.headers.get_content_type() != "application/json":
            self._write_error(400, "invalid_payload", "Content-Type must be application/json.")
            self.server.bridge.log_result(
                event_type="",
                source="",
                event_id=None,
                received_at=received_at,
                result="rejected",
                code="invalid_payload",
            )
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._write_error(400, "invalid_payload", "Content-Length must be an integer.")
            self.server.bridge.log_result(
                event_type="",
                source="",
                event_id=None,
                received_at=received_at,
                result="rejected",
                code="invalid_payload",
            )
            return

        raw_body = self.rfile.read(content_length)
        try:
            request_data = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._write_error(400, "invalid_json", "Request body must be valid JSON.")
            self.server.bridge.log_result(
                event_type="",
                source="",
                event_id=None,
                received_at=received_at,
                result="rejected",
                code="invalid_json",
            )
            return

        try:
            accepted = validate_http_bridge_event(request_data, received_at=received_at)
        except BridgeValidationError as exc:
            event_type = request_data.get("eventType") if isinstance(request_data, dict) else ""
            source = request_data.get("source") if isinstance(request_data, dict) else ""
            event_id = request_data.get("eventId") if isinstance(request_data, dict) else None
            self._write_error(exc.status, exc.code, exc.message)
            self.server.bridge.log_result(
                event_type=event_type if isinstance(event_type, str) else "",
                source=source if isinstance(source, str) else "",
                event_id=event_id if isinstance(event_id, str) else None,
                received_at=received_at,
                result="rejected",
                code=exc.code,
            )
            return

        if accepted.event_type == "chrome_audible_tabs":
            self.server.bridge.dispatch_chrome_audible_tabs(
                accepted.received_at,
                accepted.payload["audibleTabs"],
            )
        elif accepted.event_type in {"browser_page_changed", "heartbeat"}:
            self.server.bridge.dispatch_browser_event(
                event_type=accepted.event_type,
                source=accepted.source,
                occurred_at=accepted.occurred_at,
                payload=accepted.payload,
                metadata=accepted.metadata,
            )
        elif accepted.message_role == "system":
            self.server.bridge.dispatch_system_message(accepted.internal_user_message)
        else:
            self.server.bridge.dispatch_user_message(accepted.internal_user_message)
        self._write_json(
            202,
            {
                "ok": True,
                "status": "accepted",
                "eventType": accepted.event_type,
                "eventId": accepted.event_id,
                "receivedAt": _format_jst_iso(accepted.received_at),
            },
        )
        self.server.bridge.log_result(
            event_type=accepted.event_type,
            source=accepted.source,
            event_id=accepted.event_id,
            received_at=accepted.received_at,
            result="accepted",
        )

    def do_GET(self) -> None:
        self._write_method_or_not_found()

    def do_PUT(self) -> None:
        self._write_method_or_not_found()

    def do_DELETE(self) -> None:
        self._write_method_or_not_found()

    def do_PATCH(self) -> None:
        self._write_method_or_not_found()

    def _write_method_or_not_found(self) -> None:
        received_at = datetime.now(JST)
        if self.path == HTTP_BRIDGE_ENDPOINT:
            code = "method_not_allowed"
            status = 405
            message = "Method not allowed."
        else:
            code = "not_found"
            status = 404
            message = "Endpoint not found."

        self._write_error(status, code, message)
        self.server.bridge.log_result(
            event_type="",
            source="",
            event_id=None,
            received_at=received_at,
            result="rejected",
            code=code,
        )

    def _write_error(self, status: int, code: str, message: str) -> None:
        self._write_json(
            status,
            {
                "ok": False,
                "error": {
                    "code": code,
                    "message": message,
                },
            },
        )

    def _write_json(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class LocalHttpBridge:
    def __init__(
        self,
        *,
        port: int,
        event_loop,
        emit_user_message: Callable[[str], None],
        emit_system_message: Callable[[str], None],
        update_chrome_audible_tabs: Callable[[datetime, list[dict[str, Any]]], None] | None = None,
        ingest_browser_event: Callable[..., Any] | None = None,
        host: str = HTTP_BRIDGE_HOST,
        logger_instance: logging.Logger | None = None,
    ):
        self.host = host
        self.port = port
        self._event_loop = event_loop
        self._emit_user_message = emit_user_message
        self._emit_system_message = emit_system_message
        self._update_chrome_audible_tabs = update_chrome_audible_tabs
        self._ingest_browser_event = ingest_browser_event
        self._server: _LocalHttpBridgeServer | None = None
        self._thread: threading.Thread | None = None
        self.logger = logger_instance or logger

    def start(self) -> None:
        if self._server is not None:
            return

        server = _LocalHttpBridgeServer((self.host, self.port), self)
        self._server = server
        self.host = str(server.server_address[0])
        self.port = int(server.server_address[1])
        self._thread = threading.Thread(
            target=server.serve_forever,
            name="LocalHttpBridge",
            daemon=True,
        )
        self._thread.start()
        self.logger.info(
            "Local HTTP bridge を開始しました: host=%s port=%s",
            self.host,
            self.port,
        )

    def stop(self) -> None:
        if self._server is None:
            return

        self.logger.info(
            "Local HTTP bridge を停止します: host=%s port=%s",
            self.host,
            self.port,
        )
        self._server.shutdown()
        self._server.server_close()
        if self._thread is not None:
            self._thread.join(timeout=5)

        self._server = None
        self._thread = None

    def dispatch_user_message(self, message: str) -> None:
        self._event_loop.call_soon_threadsafe(self._emit_user_message, message)

    def dispatch_system_message(self, message: str) -> None:
        self._event_loop.call_soon_threadsafe(self._emit_system_message, message)

    def dispatch_chrome_audible_tabs(
        self,
        received_at: datetime,
        audible_tabs: list[dict[str, Any]],
    ) -> None:
        if self._update_chrome_audible_tabs is None:
            return
        self._event_loop.call_soon_threadsafe(
            self._update_chrome_audible_tabs,
            received_at,
            audible_tabs,
        )

    def dispatch_browser_event(
        self,
        *,
        event_type: str,
        source: str,
        occurred_at: datetime,
        payload: dict[str, Any],
        metadata: dict[str, Any],
    ) -> None:
        if self._ingest_browser_event is None:
            return
        self._event_loop.call_soon_threadsafe(
            partial(
                self._ingest_browser_event,
                event_type=event_type,
                source=source,
                occurred_at=occurred_at,
                payload=payload,
                metadata=metadata,
            )
        )

    def log_result(
        self,
        *,
        event_type: str,
        source: str,
        event_id: str | None,
        received_at: datetime,
        result: str,
        code: str | None = None,
    ) -> None:
        extra = f" code={code}" if code else ""
        log_fn = self.logger.info if result == "accepted" else self.logger.warning
        log_fn(
            "Local HTTP bridge event: eventType=%s source=%s eventId=%s receivedAt=%s result=%s%s",
            event_type,
            source,
            event_id,
            _format_jst_iso(received_at),
            result,
            extra,
        )


def start_local_http_bridge(
    config: HttpBridgeConfig,
    *,
    event_loop,
    emit_user_message: Callable[[str], None],
    emit_system_message: Callable[[str], None],
    update_chrome_audible_tabs: Callable[[datetime, list[dict[str, Any]]], None] | None = None,
    ingest_browser_event: Callable[..., Any] | None = None,
    logger_instance: logging.Logger | None = None,
) -> LocalHttpBridge | None:
    active_logger = logger_instance or logger
    if not config.enabled:
        active_logger.info("Local HTTP bridge は無効化されています")
        return None

    bridge = LocalHttpBridge(
        port=config.port,
        event_loop=event_loop,
        emit_user_message=emit_user_message,
        emit_system_message=emit_system_message,
        update_chrome_audible_tabs=update_chrome_audible_tabs,
        ingest_browser_event=ingest_browser_event,
        logger_instance=active_logger,
    )
    try:
        bridge.start()
    except OSError:
        active_logger.warning(
            "Local HTTP bridge の起動に失敗しました: host=%s port=%s",
            HTTP_BRIDGE_HOST,
            config.port,
            exc_info=True,
        )
        return None
    return bridge
