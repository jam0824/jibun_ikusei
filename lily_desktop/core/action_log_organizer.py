from __future__ import annotations

import json
import logging
import re
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from hashlib import sha1
from pathlib import Path
from typing import Any

import httpx

from ai.openai_client import request_openai_json_with_usage
from ai.provider_chat import (
    build_text_chat_request,
    extract_chat_response_text,
    normalize_provider,
)
from core.activity_capture_service import _RAW_EVENT_LOG_DIR
from core.browser_processes import is_browser_process


JST = timezone(timedelta(hours=9))
SESSION_GAP_SECONDS = 5 * 60
HTTP_TIMEOUT_SECONDS = 30.0
OPENAI_BATCH_SIZE = 8
OPENAI_ENRICHMENT_BUDGET_SECONDS = 60.0
DEFAULT_ACTIVITY_PROCESSING_CONFIG = {
    "enabled": True,
    "provider": "openai",
    "base_url": "http://127.0.0.1:11434",
    "model": "gpt-5-nano",
    "max_completion_tokens": 1200,
}
_CODE_APPS = ("code.exe", "cursor.exe", "wezterm", "powershell", "windows terminal", "git")
_LEARNING_HINTS = ("docs", "developer", "tutorial", "article", "reference", "guide", "manual")
_OPEN_LOOP_HINTS = ("todo", "wip", "fixme", "unfinished", "残", "未完")
_HANGUL_RE = re.compile(r"[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]")
_FORBIDDEN_TELEMETRY_TERMS = (
    "heartbeat",
    "heart beat",
    "heartbeat event",
    "browser_page_changed",
    "active_window_changed",
    "raw event",
    "raw-event",
    "心拍イベント",
    "ハートビート",
    "ハートイベント",
)
_JAPANESE_OUTPUT_REQUIREMENT = (
    "Write every natural-language field in concise natural Japanese. "
    "Never use Korean or Hangul in titles, primary categories, activity kinds, summaries, search keywords, or open loop text. "
    "English proper nouns such as app names, domains, GitHub, and YouTube may appear only as names."
)
_TELEMETRY_OUTPUT_REQUIREMENT = (
    "Never mention internal telemetry or raw event names such as heartbeat, browser_page_changed, active_window_changed, or raw event. "
    "Describe the user's activity in natural language instead."
)

logger = logging.getLogger(__name__)

_ORGANIZER_OPENAI_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "sessions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "sessionId": {"type": "string"},
                    "title": {"type": "string"},
                    "primaryCategory": {"type": "string"},
                    "activityKinds": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "summary": {"type": "string"},
                    "searchKeywords": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "openLoops": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "title": {"type": "string"},
                                "description": {"type": ["string", "null"]},
                            },
                            "required": ["title", "description"],
                        },
                    },
                },
                "required": [
                    "sessionId",
                    "title",
                    "primaryCategory",
                    "activityKinds",
                    "summary",
                    "searchKeywords",
                    "openLoops",
                ],
            },
        }
    },
    "required": ["sessions"],
}


def _now_jst() -> datetime:
    return datetime.now(JST)


def _normalize_jst(value: datetime | str | None) -> datetime:
    if value is None:
        return _now_jst()
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value)
    else:
        parsed = value
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=JST)
    return parsed.astimezone(JST)


def _date_key(value: datetime | str) -> str:
    return _normalize_jst(value).strftime("%Y-%m-%d")


def _managed_date_keys(reference: datetime) -> list[str]:
    return sorted(
        {
            reference.strftime("%Y-%m-%d"),
            (reference - timedelta(days=1)).strftime("%Y-%m-%d"),
        }
    )


def _first_seen(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _browser_like(event: dict[str, Any]) -> bool:
    return (
        is_browser_process(event.get("appName"))
        or bool(event.get("domain"))
        or event.get("source") == "chrome_extension"
    )


def _event_app_key(event: dict[str, Any]) -> str:
    app_name = str(event.get("appName") or "").strip()
    if _browser_like(event):
        return "__browser__"
    if app_name:
        return app_name
    return ""


def _event_date_key(event: dict[str, Any]) -> str:
    return str(event.get("dateKey") or str(event.get("occurredAt", ""))[:10])


def _separator_event(event: dict[str, Any]) -> bool:
    return str(event.get("eventType")) in {"idle_started", "idle_ended"}


def _normalize_title(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def _session_id(raw_event_ids: list[str]) -> str:
    digest = sha1("|".join(sorted(raw_event_ids)).encode("utf-8")).hexdigest()
    return f"session_{digest[:16]}"


def _last_non_empty(current_events: list[dict[str, Any]], key: str) -> str:
    for event in reversed(current_events):
        value = str(event.get(key) or "").strip()
        if value:
            return value
    return ""


def _open_loop_id(device_id: str, date_key: str, title: str) -> str:
    digest = sha1(f"{device_id}|{date_key}|{_normalize_title(title)}".encode("utf-8")).hexdigest()
    return f"loop_{digest[:16]}"


def _contains_hangul(value: Any) -> bool:
    return bool(_HANGUL_RE.search(str(value or "")))


def _enrichment_contains_hangul(enrichment: dict[str, Any]) -> bool:
    values: list[str] = [
        str(enrichment.get("title") or ""),
        str(enrichment.get("primaryCategory") or ""),
        str(enrichment.get("summary") or ""),
    ]
    values.extend(str(value or "") for value in enrichment.get("activityKinds", []))
    values.extend(str(value or "") for value in enrichment.get("searchKeywords", []))
    for item in enrichment.get("openLoops", []):
        values.append(str(item.get("title") or ""))
        values.append(str(item.get("description") or ""))
    return any(_contains_hangul(value) for value in values)


def _find_forbidden_telemetry_terms(enrichment: dict[str, Any]) -> list[str]:
    values: list[str] = [
        str(enrichment.get("title") or ""),
        str(enrichment.get("primaryCategory") or ""),
        str(enrichment.get("summary") or ""),
    ]
    values.extend(str(value or "") for value in enrichment.get("activityKinds", []))
    values.extend(str(value or "") for value in enrichment.get("searchKeywords", []))
    for item in enrichment.get("openLoops", []):
        values.append(str(item.get("title") or ""))
        values.append(str(item.get("description") or ""))

    haystack = "\n".join(values).lower()
    found: list[str] = []
    for term in _FORBIDDEN_TELEMETRY_TERMS:
        if term.lower() in haystack and term not in found:
            found.append(term)
    return found


def _normalized_session_context(values: Any) -> tuple[str, ...]:
    if not isinstance(values, list):
        return ()
    normalized = {
        str(value).strip().lower()
        for value in values
        if str(value).strip()
    }
    return tuple(sorted(normalized))


def _session_hidden_match_key(session: dict[str, Any]) -> tuple[Any, ...]:
    return (
        str(session.get("deviceId") or "").strip(),
        str(session.get("dateKey") or "").strip(),
        str(session.get("startedAt") or "").strip(),
        _normalized_session_context(session.get("appNames")),
        _normalized_session_context(session.get("domains")),
        _normalized_session_context(session.get("projectNames")),
    )


class ActionLogOrganizer:
    def __init__(
        self,
        *,
        device_id: str,
        api_client,
        raw_event_log_dir: Path | None = None,
        processing_config: Any | None = None,
        openai_api_key: str = "",
        logger_instance: logging.Logger | None = None,
    ) -> None:
        self.device_id = device_id
        self.api_client = api_client
        self.raw_event_log_dir = raw_event_log_dir or _RAW_EVENT_LOG_DIR
        config = dict(DEFAULT_ACTIVITY_PROCESSING_CONFIG)
        if processing_config is not None:
            config.update(
                {
                    "enabled": getattr(processing_config, "enabled", config["enabled"]),
                    "provider": getattr(processing_config, "provider", config["provider"]),
                    "base_url": getattr(processing_config, "base_url", config["base_url"]),
                    "model": getattr(processing_config, "model", config["model"]),
                    "max_completion_tokens": getattr(
                        processing_config,
                        "max_completion_tokens",
                        config["max_completion_tokens"],
                    ),
                }
            )
        self.processing_config = config
        self.openai_api_key = openai_api_key
        self._logger = logger_instance or logger

    def load_recent_raw_events(self, *, now: datetime | None = None) -> list[dict[str, Any]]:
        reference = _normalize_jst(now)
        target_date_keys = {
            reference.strftime("%Y-%m-%d"),
            (reference - timedelta(days=1)).strftime("%Y-%m-%d"),
        }
        events: list[dict[str, Any]] = []
        for date_key in sorted(target_date_keys):
            log_path = self.raw_event_log_dir / f"{date_key}.jsonl"
            if not log_path.exists():
                continue
            with open(log_path, encoding="utf-8") as handle:
                for line in handle:
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        self._logger.exception("Failed to parse raw-event spool line: %s", log_path)
                        continue
                    if event.get("deviceId") != self.device_id:
                        continue
                    events.append(event)
        return sorted(events, key=lambda event: event.get("occurredAt", ""))

    def build_candidate_sessions(self, raw_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        sessions: list[dict[str, Any]] = []
        by_date: dict[str, list[dict[str, Any]]] = {}
        for event in sorted(raw_events, key=lambda item: item.get("occurredAt", "")):
            by_date.setdefault(_event_date_key(event), []).append(event)

        for date_key in sorted(by_date):
            current: list[dict[str, Any]] = []
            for event in by_date[date_key]:
                if _separator_event(event):
                    if current:
                        sessions.append(self._finalize_candidate(current))
                        current = []
                    continue
                if current and self._should_split(current, event):
                    sessions.append(self._finalize_candidate(current))
                    current = []
                current.append(event)
            if current:
                sessions.append(self._finalize_candidate(current))
        return sessions

    def _should_split(
        self,
        current_events: list[dict[str, Any]],
        next_event: dict[str, Any],
    ) -> bool:
        previous = current_events[-1]
        previous_time = _normalize_jst(previous["occurredAt"])
        next_time = _normalize_jst(next_event["occurredAt"])
        if (next_time - previous_time).total_seconds() >= SESSION_GAP_SECONDS:
            return True

        previous_app_key = _event_app_key(previous)
        next_app_key = _event_app_key(next_event)
        if previous_app_key and next_app_key and previous_app_key != next_app_key:
            return True

        previous_domain = _last_non_empty(current_events, "domain").lower()
        next_domain = str(next_event.get("domain") or "").strip().lower()
        if previous_domain and next_domain and previous_domain != next_domain:
            return True

        previous_project = _last_non_empty(current_events, "projectName")
        next_project = str(next_event.get("projectName") or "").strip()
        if previous_project and next_project and previous_project != next_project:
            return True

        previous_file = _last_non_empty(current_events, "fileName")
        next_file = str(next_event.get("fileName") or "").strip()
        if previous_file and next_file and previous_file != next_file:
            return True

        return False

    def _finalize_candidate(self, events: list[dict[str, Any]]) -> dict[str, Any]:
        app_names = _first_seen(
            [str(event.get("appName") or "").strip() for event in events]
        )
        domains = _first_seen(
            [str(event.get("domain") or "").strip() for event in events]
        )
        project_names = _first_seen(
            [str(event.get("projectName") or "").strip() for event in events]
        )
        representative_title = next(
            (
                str(event.get("windowTitle") or "").strip()
                for event in events
                if str(event.get("windowTitle") or "").strip()
            ),
            "",
        )
        event_type_counts = Counter(str(event.get("eventType") or "") for event in events)
        raw_event_ids = [str(event["id"]) for event in events]
        return {
            "id": _session_id(raw_event_ids),
            "dateKey": _event_date_key(events[0]),
            "startedAt": str(events[0]["occurredAt"]),
            "endedAt": str(events[-1]["occurredAt"]),
            "rawEventIds": raw_event_ids,
            "rawEvents": [dict(event) for event in events],
            "appNames": app_names,
            "domains": domains,
            "projectNames": project_names,
            "representativeTitle": representative_title,
            "eventTypeCounts": dict(event_type_counts),
        }

    def _candidate_match_key(self, candidate: dict[str, Any]) -> tuple[Any, ...]:
        return _session_hidden_match_key(
            {
                "deviceId": self.device_id,
                "dateKey": candidate["dateKey"],
                "startedAt": candidate["startedAt"],
                "appNames": candidate["appNames"],
                "domains": candidate["domains"],
                "projectNames": candidate["projectNames"],
            }
        )

    def _candidate_payload(self, candidate: dict[str, Any]) -> dict[str, Any]:
        return {
            "sessionId": candidate["id"],
            "timeRange": f'{candidate["startedAt"]} - {candidate["endedAt"]}',
            "appNames": candidate["appNames"],
            "domains": candidate["domains"],
            "projectNames": candidate["projectNames"],
            "representativeTitle": candidate["representativeTitle"],
            "eventTypeCounts": candidate["eventTypeCounts"],
        }

    def _build_reused_enrichment(
        self,
        session: dict[str, Any],
        existing_open_loops_by_id: dict[str, dict[str, Any]],
    ) -> dict[str, Any]:
        open_loops: list[dict[str, Any]] = []
        for loop_id in session.get("openLoopIds", []):
            loop = existing_open_loops_by_id.get(str(loop_id))
            if not loop:
                continue
            title = str(loop.get("title") or "").strip()
            if not title:
                continue
            description = str(loop.get("description") or "").strip() or None
            open_loops.append(
                {
                    "title": title,
                    "description": description,
                }
            )

        return {
            "title": str(session.get("title") or "").strip(),
            "primaryCategory": str(session.get("primaryCategory") or "").strip(),
            "activityKinds": [
                str(value).strip()
                for value in session.get("activityKinds", [])
                if str(value).strip()
            ],
            "summary": str(session.get("summary") or "").strip(),
            "searchKeywords": [
                str(value).strip()
                for value in session.get("searchKeywords", [])
                if str(value).strip()
            ],
            "openLoops": open_loops,
        }

    def _build_reused_results(
        self,
        candidates: list[dict[str, Any]],
        existing_sessions: list[dict[str, Any]],
        existing_open_loops_by_id: dict[str, dict[str, Any]],
    ) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
        existing_session_by_match_key: dict[tuple[Any, ...], dict[str, Any]] = {}
        for session in existing_sessions:
            match_key = _session_hidden_match_key(session)
            existing_session_by_match_key.setdefault(match_key, session)

        reused_results: dict[str, dict[str, Any]] = {}
        uncached_candidates: list[dict[str, Any]] = []
        for candidate in candidates:
            existing_session = existing_session_by_match_key.get(
                self._candidate_match_key(candidate)
            )
            if existing_session is None:
                uncached_candidates.append(candidate)
                continue
            reused_enrichment = self._build_reused_enrichment(
                existing_session,
                existing_open_loops_by_id,
            )
            if _enrichment_contains_hangul(reused_enrichment):
                self._logger.warning(
                    "Action-log organizer discarded reused enrichment with Hangul: session_id=%s",
                    existing_session.get("id"),
                )
                uncached_candidates.append(candidate)
                continue
            forbidden_terms = _find_forbidden_telemetry_terms(reused_enrichment)
            if forbidden_terms:
                self._logger.warning(
                    "Action-log organizer discarded reused enrichment with internal telemetry terms: session_id=%s terms=%s",
                    existing_session.get("id"),
                    ",".join(forbidden_terms),
                )
                uncached_candidates.append(candidate)
                continue
            reused_results[candidate["id"]] = reused_enrichment

        return reused_results, uncached_candidates

    async def organize_and_sync(self, *, now: datetime | None = None) -> None:
        reference = _normalize_jst(now)
        managed_date_keys = _managed_date_keys(reference)
        raw_events = self.load_recent_raw_events(now=reference)
        candidates = self.build_candidate_sessions(raw_events)
        from_date = managed_date_keys[0]
        to_date = managed_date_keys[-1]
        existing_sessions = await self.api_client.get_action_log_sessions(from_date, to_date)
        existing_open_loops = await self.api_client.get_action_log_open_loops(from_date, to_date)
        existing_open_loops_by_id = {
            str(open_loop.get("id")): open_loop for open_loop in existing_open_loops
        }
        existing_hidden_by_id = {
            str(session.get("id")): bool(session.get("hidden", False))
            for session in existing_sessions
        }
        existing_hidden_by_match_key: dict[tuple[Any, ...], bool] = {}
        for session in existing_sessions:
            match_key = _session_hidden_match_key(session)
            existing_hidden_by_match_key[match_key] = (
                existing_hidden_by_match_key.get(match_key, False)
                or bool(session.get("hidden", False))
            )

        reused_results, uncached_candidates = self._build_reused_results(
            candidates,
            existing_sessions,
            existing_open_loops_by_id,
        )
        ai_results, batch_count, budget_exhausted = (
            await self._organize_with_llm(uncached_candidates)
            if uncached_candidates
            else ({}, 0, False)
        )
        llm_results = {**reused_results, **ai_results}
        sessions: list[dict[str, Any]] = []
        open_loops: list[dict[str, Any]] = []
        organized_at = reference.isoformat(timespec="seconds")
        language_rejected_count = 0
        telemetry_term_rejected_count = 0
        for candidate in candidates:
            fallback_enrichment = self._fallback_session(candidate)
            enriched = llm_results.get(candidate["id"])
            if enriched is None:
                enriched = fallback_enrichment
            elif _enrichment_contains_hangul(enriched):
                language_rejected_count += 1
                self._logger.warning(
                    "Action-log organizer rejected non-Japanese enrichment with Hangul: session_id=%s",
                    candidate["id"],
                )
                enriched = fallback_enrichment
            else:
                forbidden_terms = _find_forbidden_telemetry_terms(enriched)
                if forbidden_terms:
                    telemetry_term_rejected_count += 1
                    self._logger.warning(
                        "Action-log organizer rejected enrichment mentioning internal telemetry terms: session_id=%s terms=%s",
                        candidate["id"],
                        ",".join(forbidden_terms),
                    )
                    enriched = fallback_enrichment
            session_open_loops = self._build_open_loops(
                candidate=candidate,
                enriched=enriched,
                updated_at=organized_at,
            )
            open_loops.extend(session_open_loops)
            candidate_match_key = self._candidate_match_key(candidate)
            sessions.append(
                {
                    "id": candidate["id"],
                    "deviceId": self.device_id,
                    "startedAt": candidate["startedAt"],
                    "endedAt": candidate["endedAt"],
                    "dateKey": candidate["dateKey"],
                    "title": enriched["title"],
                    "primaryCategory": enriched["primaryCategory"],
                    "activityKinds": list(enriched["activityKinds"]),
                    "appNames": list(candidate["appNames"]),
                    "domains": list(candidate["domains"]),
                    "projectNames": list(candidate["projectNames"]),
                    "summary": enriched["summary"],
                    "searchKeywords": list(enriched["searchKeywords"]),
                    "noteIds": [],
                    "openLoopIds": [loop["id"] for loop in session_open_loops],
                    "hidden": (
                        existing_hidden_by_id[candidate["id"]]
                        if candidate["id"] in existing_hidden_by_id
                        else existing_hidden_by_match_key.get(candidate_match_key, False)
                    ),
                }
            )
        effective_ai_count = max(
            0,
            len(ai_results) - language_rejected_count - telemetry_term_rejected_count,
        )
        fallback_count = len(candidates) - len(reused_results) - effective_ai_count
        self._logger.info(
            "Action-log organizer stats: total_candidates=%d reused_count=%d ai_count=%d fallback_count=%d batch_count=%d budget_exhausted=%s language_rejected_count=%d telemetry_term_rejected_count=%d",
            len(candidates),
            len(reused_results),
            effective_ai_count,
            fallback_count,
            batch_count,
            budget_exhausted,
            language_rejected_count,
            telemetry_term_rejected_count,
        )

        await self.api_client.put_action_log_sessions(
            {
                "deviceId": self.device_id,
                "dateKeys": managed_date_keys,
                "sessions": sessions,
            }
        )
        await self.api_client.put_action_log_open_loops(
            {
                "dateKeys": managed_date_keys,
                "openLoops": open_loops,
            }
        )

    async def _organize_with_llm(
        self,
        candidates: list[dict[str, Any]],
    ) -> tuple[dict[str, dict[str, Any]], int, bool]:
        if not self.processing_config["enabled"]:
            return {}, 0, False

        provider = normalize_provider(self.processing_config["provider"], default="ollama")
        if provider == "openai":
            return await self._organize_with_openai(candidates)
        return await self._organize_with_ollama(candidates)

        sessions_by_date: dict[str, list[dict[str, Any]]] = {}
        for candidate in candidates:
            sessions_by_date.setdefault(candidate["dateKey"], []).append(
                {
                    "sessionId": candidate["id"],
                    "timeRange": f'{candidate["startedAt"]} - {candidate["endedAt"]}',
                    "appNames": candidate["appNames"],
                    "domains": candidate["domains"],
                    "projectNames": candidate["projectNames"],
                    "representativeTitle": candidate["representativeTitle"],
                    "eventTypeCounts": candidate["eventTypeCounts"],
                }
            )

        user_text = json.dumps(
            {
                "dateSessions": [
                    {"dateKey": date_key, "sessions": sessions}
                    for date_key, sessions in sorted(sessions_by_date.items())
                ]
            },
            ensure_ascii=False,
        )
        system_prompt = (
            "You organize desktop activity sessions. Return only JSON with this shape: "
            '{"sessions":[{"sessionId":"...","title":"...","primaryCategory":"学習|仕事|健康|生活|創作|対人|娯楽|その他",'
            '"activityKinds":["..."],"summary":"...","searchKeywords":["..."],'
            '"openLoops":[{"title":"...","description":"..."}]}]}. '
            "Keep titles and summaries concise natural Japanese. Use only the provided metadata."
        )
        text = ""
        try:
            request = build_text_chat_request(
                provider=normalize_provider(self.processing_config["provider"], default="ollama"),
                api_key="",
                model=self.processing_config["model"],
                base_url=self.processing_config["base_url"],
                system_prompt=system_prompt,
                user_text=user_text,
                max_completion_tokens=self.processing_config["max_completion_tokens"],
            )
            request.body["think"] = False
            request.body["format"] = "json"
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    request.url,
                    headers=request.headers,
                    json=request.body,
                )
            if not response.is_success:
                raise RuntimeError(f"Activity organizer failed: {response.status_code}")
            text = extract_chat_response_text(self.processing_config["provider"], response.json())
            payload = self._parse_json(text)
            results: dict[str, dict[str, Any]] = {}
            for session in payload.get("sessions", []):
                session_id = str(session.get("sessionId") or "").strip()
                if not session_id:
                    continue
                results[session_id] = {
                    "title": str(session.get("title") or "").strip(),
                    "primaryCategory": str(session.get("primaryCategory") or "").strip(),
                    "activityKinds": [
                        str(value).strip()
                        for value in session.get("activityKinds", [])
                        if str(value).strip()
                    ],
                    "summary": str(session.get("summary") or "").strip(),
                    "searchKeywords": [
                        str(value).strip()
                        for value in session.get("searchKeywords", [])
                        if str(value).strip()
                    ],
                    "openLoops": [
                        {
                            "title": str(item.get("title") or "").strip(),
                            "description": str(item.get("description") or "").strip() or None,
                        }
                        for item in session.get("openLoops", [])
                        if str(item.get("title") or "").strip()
                    ],
                }
            return results
        except Exception:
            if text:
                self._logger.exception(
                    "Action-log organizer LLM enrichment failed; raw response:\n%s",
                    text,
                )
            else:
                self._logger.exception("Action-log organizer LLM enrichment failed")
            return {}

    def _build_llm_input_payload(self, candidates: list[dict[str, Any]]) -> dict[str, Any]:
        sessions_by_date: dict[str, list[dict[str, Any]]] = {}
        for candidate in candidates:
            sessions_by_date.setdefault(candidate["dateKey"], []).append(
                self._candidate_payload(candidate)
            )
        return {
            "dateSessions": [
                {"dateKey": date_key, "sessions": sessions}
                for date_key, sessions in sorted(sessions_by_date.items())
            ]
        }

    def _parse_enrichment_payload(
        self,
        payload: dict[str, Any],
    ) -> dict[str, dict[str, Any]]:
        results: dict[str, dict[str, Any]] = {}
        for session in payload.get("sessions", []):
            session_id = str(session.get("sessionId") or "").strip()
            if not session_id:
                continue
            results[session_id] = {
                "title": str(session.get("title") or "").strip(),
                "primaryCategory": str(session.get("primaryCategory") or "").strip(),
                "activityKinds": [
                    str(value).strip()
                    for value in session.get("activityKinds", [])
                    if str(value).strip()
                ],
                "summary": str(session.get("summary") or "").strip(),
                "searchKeywords": [
                    str(value).strip()
                    for value in session.get("searchKeywords", [])
                    if str(value).strip()
                ],
                "openLoops": [
                    {
                        "title": str(item.get("title") or "").strip(),
                        "description": str(item.get("description") or "").strip() or None,
                    }
                    for item in session.get("openLoops", [])
                    if str(item.get("title") or "").strip()
                ],
            }
        return results

    async def _organize_with_openai(
        self,
        candidates: list[dict[str, Any]],
    ) -> tuple[dict[str, dict[str, Any]], int, bool]:
        if not self.openai_api_key:
            self._logger.info("Action-log organizer OpenAI skipped: OPENAI_API_KEY unavailable")
            return {}, 0, False

        system_prompt = (
            "You organize desktop activity sessions for a Japanese self-growth app called Lily. "
            "Return only valid JSON that strictly matches the provided schema. "
            f"{_JAPANESE_OUTPUT_REQUIREMENT} "
            f"{_TELEMETRY_OUTPUT_REQUIREMENT} "
            "Use only the provided metadata."
        )
        results: dict[str, dict[str, Any]] = {}
        batch_count = 0
        budget_exhausted = False
        prioritized_candidates = sorted(
            candidates,
            key=lambda candidate: str(candidate.get("startedAt") or ""),
            reverse=True,
        )
        started_at = time.monotonic()

        for start in range(0, len(prioritized_candidates), OPENAI_BATCH_SIZE):
            elapsed_seconds = time.monotonic() - started_at
            if elapsed_seconds >= OPENAI_ENRICHMENT_BUDGET_SECONDS:
                budget_exhausted = True
                remaining_candidates = len(prioritized_candidates) - start
                self._logger.warning(
                    "Action-log organizer OpenAI budget exhausted: processed_batches=%d remaining_candidates=%d elapsed_seconds=%.2f",
                    batch_count,
                    remaining_candidates,
                    elapsed_seconds,
                )
                break
            batch = prioritized_candidates[start : start + OPENAI_BATCH_SIZE]
            batch_count += 1
            try:
                response = await request_openai_json_with_usage(
                    api_key=self.openai_api_key,
                    model=self.processing_config["model"],
                    schema_name="action_log_organizer",
                    schema=_ORGANIZER_OPENAI_SCHEMA,
                    input_payload=self._build_llm_input_payload(batch),
                    system_prompt=system_prompt,
                    max_output_tokens=self.processing_config["max_completion_tokens"],
                    reasoning_effort="minimal",
                )
            except Exception:
                self._logger.exception("Action-log organizer OpenAI enrichment failed")
                continue

            usage = response.usage or {}
            self._logger.info(
                "Action-log organizer OpenAI usage: model=%s batch_size=%d input_tokens=%s output_tokens=%s total_tokens=%s",
                self.processing_config["model"],
                len(batch),
                usage.get("input_tokens", "unknown"),
                usage.get("output_tokens", "unknown"),
                usage.get("total_tokens", "unknown"),
            )
            results.update(self._parse_enrichment_payload(response.output))

        return results, batch_count, budget_exhausted

    async def _organize_with_ollama(
        self,
        candidates: list[dict[str, Any]],
    ) -> tuple[dict[str, dict[str, Any]], int, bool]:
        user_text = json.dumps(self._build_llm_input_payload(candidates), ensure_ascii=False)
        system_prompt = (
            "You organize desktop activity sessions. Return only JSON with this shape: "
            '{"sessions":[{"sessionId":"...","title":"...","primaryCategory":"学習|仕事|健康|生活|創作|対人|娯楽|その他",'
            '"activityKinds":["..."],"summary":"...","searchKeywords":["..."],'
            '"openLoops":[{"title":"...","description":"..."}]}]}. '
            f"{_JAPANESE_OUTPUT_REQUIREMENT} "
            f"{_TELEMETRY_OUTPUT_REQUIREMENT} "
            "Use only the provided metadata."
        )
        text = ""
        try:
            request = build_text_chat_request(
                provider="ollama",
                api_key="",
                model=self.processing_config["model"],
                base_url=self.processing_config["base_url"],
                system_prompt=system_prompt,
                user_text=user_text,
                max_completion_tokens=self.processing_config["max_completion_tokens"],
            )
            request.body["think"] = False
            request.body["format"] = "json"
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    request.url,
                    headers=request.headers,
                    json=request.body,
                )
            if not response.is_success:
                raise RuntimeError(f"Activity organizer failed: {response.status_code}")
            text = extract_chat_response_text("ollama", response.json())
            payload = self._parse_json(text)
            return self._parse_enrichment_payload(payload), 1, False
        except Exception:
            if text:
                self._logger.exception(
                    "Action-log organizer LLM enrichment failed; raw response:\n%s",
                    text,
                )
            else:
                self._logger.exception("Action-log organizer LLM enrichment failed")
            return {}, 1, False

    def _parse_json(self, raw: str) -> dict[str, Any]:
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = [line for line in cleaned.splitlines() if not line.strip().startswith("```")]
            cleaned = "\n".join(lines).strip()
        return json.loads(cleaned)

    def _fallback_session(self, candidate: dict[str, Any]) -> dict[str, Any]:
        representative_title = candidate["representativeTitle"] or ""
        app_names = candidate["appNames"]
        domains = candidate["domains"]
        project_names = candidate["projectNames"]
        label = app_names[0] if app_names else (domains[0] if domains else "作業")
        lower_title = representative_title.lower()
        lower_domain = domains[0].lower() if domains else ""
        lower_apps = " ".join(app_names).lower()

        if any(keyword in lower_apps for keyword in _CODE_APPS):
            primary_category = "仕事"
            activity_kinds = ["開発"]
        elif domains and any(keyword in f"{lower_title} {lower_domain}" for keyword in _LEARNING_HINTS):
            primary_category = "学習"
            activity_kinds = ["調査"]
        else:
            primary_category = "その他"
            activity_kinds = ["雑務"]

        if representative_title and label:
            title = f"{label} / {representative_title}"
        elif representative_title:
            title = representative_title
        elif domains:
            title = f"{domains[0]} の閲覧"
        elif app_names:
            title = f"{app_names[0]} での作業"
        else:
            title = "作業ログ"

        search_keywords = _first_seen(
            [title, primary_category, *activity_kinds, *app_names, *domains, *project_names]
        )[:10]
        summary = f"{label} を中心に作業していた。"

        open_loops: list[dict[str, Any]] = []
        if self._has_open_loop_signal(candidate):
            loop_title = representative_title or title
            open_loops.append(
                {
                    "title": loop_title,
                    "description": None,
                }
            )

        return {
            "title": title,
            "primaryCategory": primary_category,
            "activityKinds": activity_kinds,
            "summary": summary,
            "searchKeywords": search_keywords,
            "openLoops": open_loops,
        }

    def _has_open_loop_signal(self, candidate: dict[str, Any]) -> bool:
        title = candidate["representativeTitle"].lower()
        if any(hint in title for hint in _OPEN_LOOP_HINTS):
            return True
        for event in candidate["rawEvents"]:
            metadata = event.get("metadata", {})
            if isinstance(metadata, dict) and metadata.get("openLoopHint"):
                return True
        return False

    def _build_open_loops(
        self,
        *,
        candidate: dict[str, Any],
        enriched: dict[str, Any],
        updated_at: str,
    ) -> list[dict[str, Any]]:
        open_loops: list[dict[str, Any]] = []
        for item in enriched.get("openLoops", []):
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            open_loops.append(
                {
                    "id": _open_loop_id(self.device_id, candidate["dateKey"], title),
                    "createdAt": candidate["endedAt"],
                    "updatedAt": updated_at,
                    "dateKey": candidate["dateKey"],
                    "title": title,
                    "description": item.get("description") or None,
                    "status": "open",
                    "linkedSessionIds": [candidate["id"]],
                }
            )
        return open_loops
