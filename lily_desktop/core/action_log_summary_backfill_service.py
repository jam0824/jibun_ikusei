from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ai.openai_client import request_openai_json


logger = logging.getLogger(__name__)
JST = timezone(timedelta(hours=9))
OPENAI_MODEL = "gpt-5.4"

_DAILY_ACTIVITY_LOG_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "mainThemes": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 5,
        },
        "reviewQuestions": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 3,
        },
    },
    "required": ["summary", "mainThemes", "reviewQuestions"],
}

_WEEKLY_ACTIVITY_REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "focusThemes": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 5,
        },
    },
    "required": ["summary", "focusThemes"],
}

_DAILY_SYSTEM_PROMPT = (
    "You write a DailyActivityLog for a Japanese self-growth app called Lily. "
    "Return only valid JSON that strictly matches the provided schema. "
    "Write in Japanese. The prose must read like リリィがユーザーをそっと見守って書いた観察日記風の地の文. "
    "直接話しかける口調は禁止. "
    "Generate only summary, mainThemes, and reviewQuestions. "
    "Use only the provided ActivitySession and OpenLoop summaries."
)

_WEEKLY_SYSTEM_PROMPT = (
    "You write a WeeklyActivityReview for a Japanese self-growth app called Lily. "
    "Return only valid JSON that strictly matches the provided schema. "
    "Write in Japanese. The prose must read like リリィがユーザーをそっと見守って書いた観察日記風の地の文. "
    "直接話しかける口調は禁止. "
    "Generate only summary and focusThemes. "
    "Use only the provided ActivitySession and OpenLoop summaries plus category durations."
)


def _now_jst() -> datetime:
    return datetime.now(JST)


def _normalize_jst(value: datetime | None) -> datetime:
    if value is None:
        return _now_jst()
    if value.tzinfo is None:
        return value.replace(tzinfo=JST)
    return value.astimezone(JST)


def _to_jst_iso(value: datetime) -> str:
    return _normalize_jst(value).isoformat(timespec="seconds")


def _date_key(value: datetime | date) -> str:
    if isinstance(value, datetime):
        target = _normalize_jst(value)
    else:
        target = datetime(value.year, value.month, value.day, tzinfo=JST)
    return target.strftime("%Y-%m-%d")


def _previous_week_key(reference: datetime) -> str:
    previous_week = reference - timedelta(days=7)
    iso = previous_week.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _week_range_from_key(week_key: str) -> tuple[str, str]:
    year_text, week_text = week_key.split("-W", maxsplit=1)
    monday = date.fromisocalendar(int(year_text), int(week_text), 1)
    sunday = monday + timedelta(days=6)
    return _date_key(monday), _date_key(sunday)


def _duration_minutes(started_at: str, ended_at: str) -> int:
    started = datetime.fromisoformat(started_at)
    ended = datetime.fromisoformat(ended_at)
    return max(0, round((ended - started).total_seconds() / 60))


def _collect_themes(sessions: list[dict[str, Any]], open_loops: list[dict[str, Any]], limit: int) -> list[str]:
    themes: list[str] = []
    for session in sessions:
        themes.extend(session.get("activityKinds", []))
        themes.extend(session.get("domains", []))
    for open_loop in open_loops:
        title = str(open_loop.get("title") or "").strip()
        if title:
            themes.append(title)

    seen: set[str] = set()
    ordered: list[str] = []
    for theme in themes:
        if not theme or theme in seen:
            continue
        seen.add(theme)
        ordered.append(theme)
        if len(ordered) >= limit:
            break
    return ordered


def _sanitize_sessions(sessions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "startedAt": session.get("startedAt"),
            "endedAt": session.get("endedAt"),
            "dateKey": session.get("dateKey"),
            "title": session.get("title"),
            "primaryCategory": session.get("primaryCategory"),
            "activityKinds": session.get("activityKinds", []),
            "appNames": session.get("appNames", []),
            "domains": session.get("domains", []),
            "projectNames": session.get("projectNames", []),
            "summary": session.get("summary"),
        }
        for session in sessions
    ]


def _sanitize_open_loops(open_loops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "dateKey": open_loop.get("dateKey"),
            "title": open_loop.get("title"),
            "description": open_loop.get("description"),
            "status": open_loop.get("status"),
        }
        for open_loop in open_loops
    ]


def _build_daily_fallback(
    *,
    date_key: str,
    sessions: list[dict[str, Any]],
    open_loops: list[dict[str, Any]],
) -> dict[str, Any]:
    themes = _collect_themes(sessions, open_loops, 3) or ["静かな作業"]
    open_loop = open_loops[0] if open_loops else None
    return {
        "summary": (
            f"リリィは、{date_key} には {themes[0]} を中心に、落ち着いた流れで行動が積み重なっていたと見ている。"
        ),
        "mainThemes": themes[:5],
        "reviewQuestions": [
            "次に確認したいことはどこに残っていたか。",
            (
                f"{open_loop.get('title')} に手を戻すなら、最初の一歩は何だったか。"
                if open_loop
                else "この流れを次に続けるなら、どこから始めたいか。"
            ),
        ],
    }


def _build_weekly_fallback(
    *,
    week_key: str,
    sessions: list[dict[str, Any]],
    open_loops: list[dict[str, Any]],
    category_durations: dict[str, int],
) -> dict[str, Any]:
    themes = _collect_themes(sessions, open_loops, 3) or ["静かな作業"]
    dominant_category = (
        sorted(category_durations.items(), key=lambda item: item[1], reverse=True)[0][0]
        if category_durations
        else None
    )
    category_text = f"{dominant_category} を軸に" if dominant_category else "いくつかの文脈を行き来しながら"
    return {
        "summary": (
            f"リリィは、{week_key} には {category_text} {themes[0]} が少しずつ深まっていたと見ている。"
        ),
        "focusThemes": themes[:5],
    }


class ActionLogSummaryBackfillService:
    def __init__(
        self,
        *,
        api_client,
        openai_api_key: str,
        logger_instance: logging.Logger | None = None,
    ) -> None:
        self.api_client = api_client
        self.openai_api_key = openai_api_key
        self._logger = logger_instance or logger

    async def backfill_missing_summaries(self, *, now: datetime | None = None) -> None:
        reference = _normalize_jst(now)
        yesterday_key = _date_key(reference - timedelta(days=1))
        previous_week_key = _previous_week_key(reference)

        await self._ensure_daily_log(yesterday_key=yesterday_key, generated_at=reference)
        await self._ensure_weekly_review(
            week_key=previous_week_key,
            generated_at=reference,
        )

    async def _ensure_daily_log(self, *, yesterday_key: str, generated_at: datetime) -> None:
        existing = await self.api_client.get_action_log_daily_log(yesterday_key)
        if existing:
            return

        sessions = await self.api_client.get_action_log_sessions(yesterday_key, yesterday_key)
        open_loops = await self.api_client.get_action_log_open_loops(yesterday_key, yesterday_key)
        daily_input = {
            "task": "daily_activity_log",
            "dateKey": yesterday_key,
            "sessions": _sanitize_sessions(sessions),
            "openLoops": _sanitize_open_loops(open_loops),
        }

        try:
            if not self.openai_api_key:
                raise RuntimeError("OpenAI API key is unavailable")
            generated = await request_openai_json(
                api_key=self.openai_api_key,
                model=OPENAI_MODEL,
                schema_name="daily_activity_log",
                schema=_DAILY_ACTIVITY_LOG_SCHEMA,
                input_payload=daily_input,
                system_prompt=_DAILY_SYSTEM_PROMPT,
            )
        except Exception:
            self._logger.exception("DailyActivityLog backfill fell back to template")
            generated = _build_daily_fallback(
                date_key=yesterday_key,
                sessions=sessions,
                open_loops=open_loops,
            )

        await self.api_client.put_action_log_daily_log(
            {
                "id": f"daily_{yesterday_key}",
                "dateKey": yesterday_key,
                "summary": generated["summary"],
                "mainThemes": list(generated["mainThemes"]),
                "noteIds": [],
                "openLoopIds": [str(open_loop["id"]) for open_loop in open_loops],
                "reviewQuestions": list(generated["reviewQuestions"]),
                "generatedAt": _to_jst_iso(generated_at),
            }
        )

    async def _ensure_weekly_review(self, *, week_key: str, generated_at: datetime) -> None:
        existing = await self.api_client.get_action_log_weekly_review(week_key)
        if existing:
            return

        from_date, to_date = _week_range_from_key(week_key)
        sessions = await self.api_client.get_action_log_sessions(from_date, to_date)
        open_loops = await self.api_client.get_action_log_open_loops(from_date, to_date)
        category_durations: dict[str, int] = {}
        for session in sessions:
            category = str(session.get("primaryCategory") or "").strip()
            if not category:
                continue
            category_durations[category] = category_durations.get(category, 0) + _duration_minutes(
                str(session["startedAt"]),
                str(session["endedAt"]),
            )

        weekly_input = {
            "task": "weekly_activity_review",
            "weekKey": week_key,
            "categoryDurations": category_durations,
            "sessions": _sanitize_sessions(sessions),
            "openLoops": _sanitize_open_loops(open_loops),
        }

        try:
            if not self.openai_api_key:
                raise RuntimeError("OpenAI API key is unavailable")
            generated = await request_openai_json(
                api_key=self.openai_api_key,
                model=OPENAI_MODEL,
                schema_name="weekly_activity_review",
                schema=_WEEKLY_ACTIVITY_REVIEW_SCHEMA,
                input_payload=weekly_input,
                system_prompt=_WEEKLY_SYSTEM_PROMPT,
            )
        except Exception:
            self._logger.exception("WeeklyActivityReview backfill fell back to template")
            generated = _build_weekly_fallback(
                week_key=week_key,
                sessions=sessions,
                open_loops=open_loops,
                category_durations=category_durations,
            )

        await self.api_client.put_action_log_weekly_review(
            {
                "id": f"weekly_{week_key}",
                "weekKey": week_key,
                "summary": generated["summary"],
                "categoryDurations": category_durations,
                "focusThemes": list(generated["focusThemes"]),
                "openLoopIds": [str(open_loop["id"]) for open_loop in open_loops],
                "generatedAt": _to_jst_iso(generated_at),
            }
        )
