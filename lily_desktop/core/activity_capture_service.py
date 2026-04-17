from __future__ import annotations

import ctypes
import ctypes.wintypes
import json
import logging
import socket
import threading
import uuid
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from core import active_window as active_window_mod
from core.active_window import ActiveWindowInfo, get_active_window_info


JST = timezone(timedelta(hours=9))
RAW_EVENT_TTL_DAYS = 30
DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30
DEFAULT_IDLE_THRESHOLD_SECONDS = 300
MAX_RECENT_EVENTS = 200
_BASE_DIR = Path(__file__).resolve().parent.parent
_RAW_EVENT_LOG_DIR = _BASE_DIR / "logs" / "action_logs" / "raw_events"
_SYNC_STATE_PATH = _BASE_DIR / "logs" / "action_logs" / "sync_state.json"
_PRIVACY_PRIORITY = {
    "window_title": 0,
    "domain": 1,
    "app": 2,
    "storage_mode": 3,
}
logger = logging.getLogger(__name__)


class _LASTINPUTINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", ctypes.wintypes.UINT),
        ("dwTime", ctypes.wintypes.DWORD),
    ]


def _now_jst() -> datetime:
    return datetime.now(JST)


def _normalize_jst(value: datetime | None) -> datetime:
    current = value or _now_jst()
    if current.tzinfo is None:
        return current.replace(tzinfo=JST)
    return current.astimezone(JST)


def _format_jst_iso(value: datetime) -> str:
    return _normalize_jst(value).isoformat(timespec="seconds")


def _build_expires_at(value: datetime) -> str:
    return _format_jst_iso(_normalize_jst(value) + timedelta(days=RAW_EVENT_TTL_DAYS))


def default_device_id() -> str:
    hostname = socket.gethostname().strip().lower() or "unknown-host"
    safe_hostname = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in hostname)
    return f"desktop-{safe_hostname}"


def get_idle_seconds() -> float:
    try:
        last_input = _LASTINPUTINFO()
        last_input.cbSize = ctypes.sizeof(_LASTINPUTINFO)
        if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(last_input)):
            return 0.0
        tick_count = ctypes.windll.kernel32.GetTickCount()
        elapsed_ms = max(0, int(tick_count) - int(last_input.dwTime))
        return elapsed_ms / 1000.0
    except Exception:
        logger.exception("Failed to read idle time")
        return 0.0


def _is_context_empty(info: ActiveWindowInfo) -> bool:
    return not any([info.app_name, info.window_title, info.domain])


def _parse_updated_at(value: object) -> float:
    if not isinstance(value, str) or not value:
        return float("-inf")
    try:
        return _normalize_jst(datetime.fromisoformat(value)).timestamp()
    except ValueError:
        return float("-inf")


def _match_privacy_rule(
    rule: dict[str, Any],
    *,
    app_name: str,
    window_title: str,
    domain: str,
) -> bool:
    if not rule.get("enabled", True):
        return False

    rule_type = str(rule.get("type", "")).strip().lower()
    value = str(rule.get("value", "")).strip().lower()
    if not value:
        return False

    if rule_type == "window_title":
        return value in window_title.lower()
    if rule_type == "domain":
        normalized_domain = domain.lower()
        return normalized_domain == value or normalized_domain.endswith(f".{value}")
    if rule_type == "app":
        return app_name.lower() == value
    if rule_type == "storage_mode":
        return value in {"*", "default"}
    return False


def _resolve_privacy_rule_outcome(
    rules: list[dict[str, Any]],
    *,
    app_name: str,
    window_title: str,
    domain: str,
) -> dict[str, Any] | None:
    matched_rules = [
        rule
        for rule in rules
        if _match_privacy_rule(
            rule,
            app_name=app_name,
            window_title=window_title,
            domain=domain,
        )
    ]
    if not matched_rules:
        return None

    return sorted(
        matched_rules,
        key=lambda rule: (
            _PRIVACY_PRIORITY.get(str(rule.get("type", "")).strip().lower(), 99),
            -_parse_updated_at(rule.get("updatedAt")),
        ),
    )[0]


def _is_builtin_excluded_for_browser_event(domain: str, window_title: str) -> bool:
    lowered_domain = domain.lower()
    for pattern in getattr(active_window_mod, "_EXCLUDED_TITLE_PATTERNS", []):
        if pattern.search(window_title):
            return True
    for exact_domain in getattr(active_window_mod, "_EXCLUDED_DOMAIN_EXACT", set()):
        if lowered_domain == exact_domain:
            return True
    for excluded in getattr(active_window_mod, "_EXCLUDED_DOMAINS", []):
        if excluded in lowered_domain or lowered_domain in excluded:
            return True
    return False


def _load_sync_state() -> dict[str, set[int]]:
    if not _SYNC_STATE_PATH.exists():
        return {}
    try:
        raw = json.loads(_SYNC_STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.exception("Failed to load action-log sync state")
        return {}

    files = raw.get("files", {}) if isinstance(raw, dict) else {}
    if not isinstance(files, dict):
        return {}

    normalized: dict[str, set[int]] = {}
    for file_name, entry in files.items():
        if not isinstance(file_name, str) or not isinstance(entry, dict):
            continue
        acked_lines = entry.get("ackedLines", [])
        if not isinstance(acked_lines, list):
            continue
        normalized[file_name] = {
            int(line)
            for line in acked_lines
            if isinstance(line, int) and line > 0
        }
    return normalized


def _save_sync_state(state: dict[str, set[int]]) -> None:
    _SYNC_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "files": {
            file_name: {"ackedLines": sorted(lines)}
            for file_name, lines in sorted(state.items())
            if lines
        }
    }
    _SYNC_STATE_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


class ActivityCaptureService:
    def __init__(
        self,
        *,
        device_id: str | None = None,
        initial_state: str = "active",
        poll_interval_seconds: int = 2,
        privacy_rules: list[dict[str, Any]] | None = None,
        get_active_window_info: Callable[[], ActiveWindowInfo] = get_active_window_info,
        get_idle_seconds: Callable[[], float] = get_idle_seconds,
        logger_instance: logging.Logger | None = None,
    ) -> None:
        self.device_id = device_id or default_device_id()
        self.capture_state = (
            initial_state if initial_state in {"active", "paused", "disabled"} else "active"
        )
        self.poll_interval_seconds = max(1, int(poll_interval_seconds))
        self.privacy_rules = list(privacy_rules or [])
        self._get_active_window_info = get_active_window_info
        self._get_idle_seconds = get_idle_seconds
        self._logger = logger_instance or logger
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._recent_events: deque[dict[str, Any]] = deque(maxlen=MAX_RECENT_EVENTS)
        self._last_context_signature: tuple[str, str, str] | None = None
        self._last_context_event_at: datetime | None = None
        self._idle_active = False
        self.is_running = False
        self._sync_state = _load_sync_state()

    def start(self) -> bool:
        if self.capture_state == "disabled":
            self._logger.info("Activity capture is disabled at startup")
            self.is_running = False
            return False
        if self._thread is not None and self._thread.is_alive():
            self.is_running = True
            return True

        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop,
            name="ActivityCaptureService",
            daemon=True,
        )
        self._thread.start()
        self.is_running = True
        return True

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._thread = None
        self.is_running = False

    def set_capture_state(self, state: str) -> None:
        if state not in {"active", "paused", "disabled"}:
            raise ValueError(f"Unsupported capture state: {state}")
        previous_state = self.capture_state
        self.capture_state = state
        if state == "disabled":
            self.stop()
            return
        if previous_state == "disabled":
            self.start()

    def snapshot_recent_events(self) -> list[dict[str, Any]]:
        return [dict(event) for event in self._recent_events]

    def snapshot_pending_raw_events(
        self,
        *,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        if self.capture_state != "active":
            return []
        if not _RAW_EVENT_LOG_DIR.exists():
            return []

        pending: list[dict[str, Any]] = []
        max_items = limit if limit is not None and limit > 0 else None

        for log_path in sorted(_RAW_EVENT_LOG_DIR.glob("*.jsonl")):
            acked_lines = self._sync_state.get(log_path.name, set())
            with open(log_path, encoding="utf-8") as handle:
                for line_number, line in enumerate(handle, start=1):
                    if line_number in acked_lines:
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        self._logger.exception(
                            "Failed to decode action-log spool line: %s:%s",
                            log_path,
                            line_number,
                        )
                        continue
                    pending.append(
                        {
                            "event": event,
                            "fileName": log_path.name,
                            "lineNumber": line_number,
                        }
                    )
                    if max_items is not None and len(pending) >= max_items:
                        return pending
        return pending

    def ack_pending_raw_events(self, entries: list[dict[str, Any]]) -> None:
        if not entries:
            return

        updated = {key: set(value) for key, value in self._sync_state.items()}
        for entry in entries:
            file_name = entry.get("fileName")
            line_number = entry.get("lineNumber")
            if not isinstance(file_name, str):
                continue
            if not isinstance(line_number, int) or line_number <= 0:
                continue
            updated.setdefault(file_name, set()).add(line_number)

        self._sync_state = updated
        _save_sync_state(self._sync_state)

    def poll_once(self, *, now: datetime | None = None) -> list[dict[str, Any]]:
        current_time = _normalize_jst(now)
        if self.capture_state != "active":
            return []

        events: list[dict[str, Any]] = []
        idle_seconds = float(self._get_idle_seconds())
        if idle_seconds >= DEFAULT_IDLE_THRESHOLD_SECONDS:
            if not self._idle_active:
                idle_started = self._store_event(
                    self._build_base_event(
                        event_type="idle_started",
                        source="desktop_agent",
                        occurred_at=current_time,
                    )
                )
                if idle_started is not None:
                    events.append(idle_started)
                self._idle_active = True
                self._last_context_signature = None
                self._last_context_event_at = None
            return events

        if self._idle_active:
            idle_ended = self._store_event(
                self._build_base_event(
                    event_type="idle_ended",
                    source="desktop_agent",
                    occurred_at=current_time,
                )
            )
            if idle_ended is not None:
                events.append(idle_ended)
            self._idle_active = False

        info = self._get_active_window_info()
        if _is_context_empty(info):
            return events
        if info.is_excluded:
            self._last_context_signature = None
            self._last_context_event_at = None
            return events

        signature = (info.app_name, info.window_title, info.domain)
        event_type: str | None = None
        if signature != self._last_context_signature:
            event_type = "active_window_changed"
        elif self._last_context_event_at is not None and (
            current_time - self._last_context_event_at
        ).total_seconds() >= DEFAULT_HEARTBEAT_INTERVAL_SECONDS:
            event_type = "heartbeat"

        if event_type is None:
            return events

        candidate = self._build_base_event(
            event_type=event_type,
            source="desktop_agent",
            occurred_at=current_time,
            app_name=info.app_name or None,
            window_title=info.window_title or None,
            domain=info.domain or None,
        )
        stored = self._store_event(candidate)
        if stored is None:
            self._last_context_signature = None
            self._last_context_event_at = None
            return events

        self._last_context_signature = signature
        self._last_context_event_at = current_time
        events.append(stored)
        return events

    def ingest_browser_event(
        self,
        *,
        event_type: str,
        source: str,
        occurred_at: datetime,
        payload: dict[str, Any],
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        if self.capture_state != "active":
            return None

        title = payload.get("title")
        domain = str(payload.get("domain", "")).strip()
        if _is_builtin_excluded_for_browser_event(domain, str(title or "")):
            return None

        event_metadata = dict(metadata or {})
        tab_id = payload.get("tabId")
        if tab_id is not None:
            event_metadata["tabId"] = tab_id

        candidate = self._build_base_event(
            event_type=event_type,
            source=source,
            occurred_at=_normalize_jst(occurred_at),
            window_title=(str(title).strip() or None) if title is not None else None,
            url=str(payload.get("url", "")).strip() or None,
            domain=domain or None,
            metadata=event_metadata or None,
        )
        return self._store_event(candidate)

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.poll_once()
            except Exception:
                self._logger.exception("Activity capture poll failed")
            self._stop_event.wait(self.poll_interval_seconds)

    def _build_base_event(
        self,
        *,
        event_type: str,
        source: str,
        occurred_at: datetime,
        app_name: str | None = None,
        window_title: str | None = None,
        url: str | None = None,
        domain: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        normalized_occurred_at = _normalize_jst(occurred_at)
        event: dict[str, Any] = {
            "id": uuid.uuid4().hex,
            "deviceId": self.device_id,
            "source": source,
            "eventType": event_type,
            "occurredAt": _format_jst_iso(normalized_occurred_at),
            "expiresAt": _build_expires_at(normalized_occurred_at),
        }
        if app_name:
            event["appName"] = app_name
        if window_title:
            event["windowTitle"] = window_title
        if url:
            event["url"] = url
        if domain:
            event["domain"] = domain
        if metadata:
            event["metadata"] = metadata
        return event

    def _store_event(self, candidate: dict[str, Any]) -> dict[str, Any] | None:
        sanitized = self._apply_privacy_rules(candidate)
        if sanitized is None:
            return None
        self._append_to_spool(sanitized)
        self._recent_events.append(dict(sanitized))
        return sanitized

    def _apply_privacy_rules(self, candidate: dict[str, Any]) -> dict[str, Any] | None:
        if candidate["eventType"] in {"idle_started", "idle_ended"}:
            return dict(candidate)

        resolved_rule = _resolve_privacy_rule_outcome(
            self.privacy_rules,
            app_name=str(candidate.get("appName", "")),
            window_title=str(candidate.get("windowTitle", "")),
            domain=str(candidate.get("domain", "")),
        )
        if resolved_rule is None:
            return dict(candidate)

        mode = str(resolved_rule.get("mode", "")).strip()
        if mode == "exclude":
            return None

        sanitized = dict(candidate)
        metadata = dict(sanitized.get("metadata", {}))
        if mode == "domain_only":
            sanitized.pop("url", None)
        if mode in {"domain_only", "full_url", "ai_summary_only", "ai_disabled"}:
            metadata["storageMode"] = mode
        if metadata:
            sanitized["metadata"] = metadata
        return sanitized

    def _append_to_spool(self, event: dict[str, Any]) -> None:
        _RAW_EVENT_LOG_DIR.mkdir(parents=True, exist_ok=True)
        occurred_at = _normalize_jst(datetime.fromisoformat(event["occurredAt"]))
        log_path = _RAW_EVENT_LOG_DIR / f"{occurred_at.strftime('%Y-%m-%d')}.jsonl"
        with open(log_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")
