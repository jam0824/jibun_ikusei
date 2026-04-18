from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from ai.openai_client import request_openai_json


logger = logging.getLogger(__name__)
JST = timezone(timedelta(hours=9))
OPENAI_MODEL = "gpt-5.4"
DAILY_ACTIVITY_LOG_MAX_OUTPUT_TOKENS = 1600
WEEKLY_ACTIVITY_REVIEW_MAX_OUTPUT_TOKENS = 1600

_DAILY_ACTIVITY_LOG_SUMMARY_SCHEMA = {
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

_DAILY_ACTIVITY_LOG_QUEST_SUMMARY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "questSummary": {"type": "string"},
    },
    "required": ["questSummary"],
}

_DAILY_ACTIVITY_LOG_HEALTH_SUMMARY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "healthSummary": {"type": "string"},
    },
    "required": ["healthSummary"],
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

_DAILY_SUMMARY_SYSTEM_PROMPT = (
    "You write the summary section of a DailyActivityLog for a Japanese self-growth app called Lily. "
    "Return only valid JSON that strictly matches the provided schema. "
    "Write in Japanese. The prose must read like リリィがユーザーをそっと見守って書いた観察日記風の地の文. "
    "直接話しかける口調は禁止. "
    "Generate only summary, mainThemes, and reviewQuestions. "
    "Use only the provided ActivitySession records."
)

_DAILY_QUEST_SUMMARY_SYSTEM_PROMPT = (
    "You write the quest summary section of a DailyActivityLog for a Japanese self-growth app called Lily. "
    "Return only valid JSON that strictly matches the provided schema. "
    "Write in Japanese. The prose must read like リリィがユーザーをそっと見守って書いた観察日記風の地の文. "
    "直接話しかける口調は禁止. "
    "Generate only questSummary. "
    "Use only the provided QuestCompletion and Quest records."
)

_DAILY_HEALTH_SUMMARY_SYSTEM_PROMPT = (
    "You write the health summary section of a DailyActivityLog for a Japanese self-growth app called Lily. "
    "Return only valid JSON that strictly matches the provided schema. "
    "Write in Japanese. The prose must read like リリィがユーザーをそっと見守って書いた観察日記風の地の文. "
    "直接話しかける口調は禁止. "
    "Generate only healthSummary. "
    "Use only the provided health-data records."
)

_WEEKLY_SYSTEM_PROMPT = (
    "You write a WeeklyActivityReview for a Japanese self-growth app called Lily. "
    "Return only valid JSON that strictly matches the provided schema. "
    "Write in Japanese. The prose must read like リリィがユーザーをそっと見守って書いた観察日記風の地の文. "
    "直接話しかける口調は禁止. "
    "Generate only summary and focusThemes. "
    "Use only the provided ActivitySession summaries plus category durations."
)

_DAILY_SECTION_ORDER = ("summary", "questSummary", "healthSummary")


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


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


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
    started = _parse_datetime(started_at)
    ended = _parse_datetime(ended_at)
    return max(0, round((ended - started).total_seconds() / 60))


def _collect_themes(sessions: list[dict[str, Any]], limit: int) -> list[str]:
    themes: list[str] = []
    for session in sessions:
        themes.extend(session.get("activityKinds", []))
        themes.extend(session.get("domains", []))

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


def _has_text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


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


def _sanitize_quests(quests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": quest.get("id"),
            "title": quest.get("title"),
            "category": quest.get("category"),
            "questType": quest.get("questType"),
            "status": quest.get("status"),
        }
        for quest in quests
    ]


def _filter_same_day_completions(
    date_key: str, completions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    filtered = [
        completion
        for completion in completions
        if _has_text(completion.get("completedAt"))
        and _date_key(_parse_datetime(str(completion["completedAt"]))) == date_key
    ]
    filtered.sort(key=lambda item: str(item.get("completedAt", "")), reverse=True)
    return filtered


def _sanitize_completions(
    completions: list[dict[str, Any]], quest_map: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    return [
        {
            "id": completion.get("id"),
            "completedAt": completion.get("completedAt"),
            "questId": completion.get("questId"),
            "questTitle": quest_map.get(str(completion.get("questId")), {}).get("title"),
            "note": completion.get("note"),
        }
        for completion in completions
    ]


def _filter_same_day_health_data(
    date_key: str, health_data: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    filtered = [
        entry for entry in health_data if str(entry.get("date", "")).strip() == date_key
    ]
    filtered.sort(
        key=lambda item: f"{item.get('date', '')}T{item.get('time', '')}",
        reverse=True,
    )
    return filtered


def _sanitize_health_data(health_data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "date": entry.get("date"),
            "time": entry.get("time"),
            "weight_kg": entry.get("weight_kg"),
            "body_fat_pct": entry.get("body_fat_pct"),
            "source": entry.get("source"),
        }
        for entry in health_data
    ]


def _build_weekly_fallback(
    *,
    week_key: str,
    sessions: list[dict[str, Any]],
    category_durations: dict[str, int],
) -> dict[str, Any]:
    themes = _collect_themes(sessions, 3) or ["静かな作業"]
    dominant_category = (
        sorted(category_durations.items(), key=lambda item: item[1], reverse=True)[0][0]
        if category_durations
        else None
    )
    category_text = (
        f"{dominant_category} を軸に"
        if dominant_category
        else "いくつかの文脈を行き来しながら"
    )
    return {
        "summary": (
            f"リリィは、{week_key} には {category_text} {themes[0]} が少しずつ深まっていたと見ている。"
        ),
        "focusThemes": themes[:5],
    }


def _is_daily_log_complete(existing: dict[str, Any] | None) -> bool:
    if not existing:
        return False
    return all(_has_text(existing.get(section)) for section in _DAILY_SECTION_ORDER)


def _resolve_daily_sections(
    existing: dict[str, Any] | None, *, force: bool
) -> list[str]:
    if force:
        return list(_DAILY_SECTION_ORDER)
    if existing is None:
        return list(_DAILY_SECTION_ORDER)
    return [
        section
        for section in _DAILY_SECTION_ORDER
        if not _has_text(existing.get(section))
    ]


def _build_daily_log_payload(
    *,
    date_key: str,
    existing: dict[str, Any] | None,
    summary_result: dict[str, Any] | None,
    quest_result: dict[str, Any] | None,
    health_result: dict[str, Any] | None,
    generated_at: datetime,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": (existing or {}).get("id", f"daily_{date_key}"),
        "dateKey": date_key,
        "mainThemes": list(
            summary_result.get("mainThemes")
            if summary_result is not None
            else (existing or {}).get("mainThemes", [])
        ),
        "noteIds": list((existing or {}).get("noteIds", [])),
        "reviewQuestions": list(
            summary_result.get("reviewQuestions")
            if summary_result is not None
            else (existing or {}).get("reviewQuestions", [])
        ),
        "generatedAt": _to_jst_iso(generated_at),
    }

    summary_text = (
        summary_result.get("summary")
        if summary_result is not None
        else (existing or {}).get("summary")
    )
    if _has_text(summary_text):
        payload["summary"] = summary_text

    quest_summary_text = (
        quest_result.get("questSummary")
        if quest_result is not None
        else (existing or {}).get("questSummary")
    )
    if _has_text(quest_summary_text):
        payload["questSummary"] = quest_summary_text

    health_summary_text = (
        health_result.get("healthSummary")
        if health_result is not None
        else (existing or {}).get("healthSummary")
    )
    if _has_text(health_summary_text):
        payload["healthSummary"] = health_summary_text

    return payload


def _exc_info(exc: BaseException):
    return (type(exc), exc, exc.__traceback__)


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

        await self._ensure_daily_log(
            yesterday_key=yesterday_key,
            generated_at=reference,
            force=False,
        )
        await self._ensure_weekly_review(
            week_key=previous_week_key,
            generated_at=reference,
        )

    async def regenerate_previous_day_daily_log(
        self, *, now: datetime | None = None
    ) -> dict[str, list[str]]:
        reference = _normalize_jst(now)
        yesterday_key = _date_key(reference - timedelta(days=1))
        return await self._ensure_daily_log(
            yesterday_key=yesterday_key,
            generated_at=reference,
            force=True,
        )

    async def _ensure_daily_log(
        self,
        *,
        yesterday_key: str,
        generated_at: datetime,
        force: bool,
    ) -> dict[str, list[str]]:
        existing = await self.api_client.get_action_log_daily_log(yesterday_key)
        if not force and _is_daily_log_complete(existing):
            return {"completed_sections": [], "failed_sections": []}

        target_sections = _resolve_daily_sections(existing, force=force)
        if not target_sections:
            return {"completed_sections": [], "failed_sections": []}
        if not self.openai_api_key:
            return {
                "completed_sections": [],
                "failed_sections": list(target_sections),
            }

        needs_summary = "summary" in target_sections
        needs_quest_summary = "questSummary" in target_sections
        needs_health_summary = "healthSummary" in target_sections

        sessions, quests, completions, health_data = await asyncio.gather(
            self.api_client.get_action_log_sessions(yesterday_key, yesterday_key)
            if needs_summary
            else asyncio.sleep(0, result=[]),
            self.api_client.get_quests()
            if needs_quest_summary
            else asyncio.sleep(0, result=[]),
            self.api_client.get_completions()
            if needs_quest_summary
            else asyncio.sleep(0, result=[]),
            self.api_client.get_health_data(yesterday_key, yesterday_key)
            if needs_health_summary
            else asyncio.sleep(0, result=[]),
        )

        filtered_sessions = sessions if needs_summary else []
        same_day_completions = (
            _filter_same_day_completions(yesterday_key, completions)
            if needs_quest_summary
            else []
        )
        related_quest_ids = {str(completion.get("questId", "")) for completion in same_day_completions}
        related_quests = (
            [quest for quest in quests if str(quest.get("id", "")) in related_quest_ids]
            if needs_quest_summary
            else []
        )
        quest_map = {
            str(quest.get("id", "")): quest
            for quest in related_quests
            if str(quest.get("id", "")).strip()
        }
        same_day_health_data = (
            _filter_same_day_health_data(yesterday_key, health_data)
            if needs_health_summary
            else []
        )

        async def _generate_summary():
            return await request_openai_json(
                api_key=self.openai_api_key,
                model=OPENAI_MODEL,
                schema_name="daily_activity_log_summary",
                schema=_DAILY_ACTIVITY_LOG_SUMMARY_SCHEMA,
                input_payload={
                    "task": "daily_activity_log_summary",
                    "dateKey": yesterday_key,
                    "ActivitySession": _sanitize_sessions(filtered_sessions),
                },
                system_prompt=_DAILY_SUMMARY_SYSTEM_PROMPT,
                max_output_tokens=DAILY_ACTIVITY_LOG_MAX_OUTPUT_TOKENS,
            )

        async def _generate_quest_summary():
            return await request_openai_json(
                api_key=self.openai_api_key,
                model=OPENAI_MODEL,
                schema_name="daily_activity_log_quest_summary",
                schema=_DAILY_ACTIVITY_LOG_QUEST_SUMMARY_SCHEMA,
                input_payload={
                    "task": "daily_activity_log_quest_summary",
                    "dateKey": yesterday_key,
                    "QuestCompletion": _sanitize_completions(
                        same_day_completions, quest_map
                    ),
                    "Quest": _sanitize_quests(related_quests),
                },
                system_prompt=_DAILY_QUEST_SUMMARY_SYSTEM_PROMPT,
                max_output_tokens=DAILY_ACTIVITY_LOG_MAX_OUTPUT_TOKENS,
            )

        async def _generate_health_summary():
            return await request_openai_json(
                api_key=self.openai_api_key,
                model=OPENAI_MODEL,
                schema_name="daily_activity_log_health_summary",
                schema=_DAILY_ACTIVITY_LOG_HEALTH_SUMMARY_SCHEMA,
                input_payload={
                    "task": "daily_activity_log_health_summary",
                    "dateKey": yesterday_key,
                    "health-data": _sanitize_health_data(same_day_health_data),
                },
                system_prompt=_DAILY_HEALTH_SUMMARY_SYSTEM_PROMPT,
                max_output_tokens=DAILY_ACTIVITY_LOG_MAX_OUTPUT_TOKENS,
            )

        task_factories = {
            "summary": _generate_summary,
            "questSummary": _generate_quest_summary,
            "healthSummary": _generate_health_summary,
        }
        section_results = await asyncio.gather(
            *(task_factories[section]() for section in target_sections),
            return_exceptions=True,
        )

        completed_sections: list[str] = []
        failed_sections: list[str] = []
        summary_result: dict[str, Any] | None = None
        quest_result: dict[str, Any] | None = None
        health_result: dict[str, Any] | None = None

        for section, result in zip(target_sections, section_results, strict=False):
            if isinstance(result, Exception):
                failed_sections.append(section)
                self._logger.warning(
                    "DailyActivityLog %s generation failed",
                    section,
                    exc_info=_exc_info(result),
                )
                continue

            completed_sections.append(section)
            if section == "summary":
                summary_result = result
            elif section == "questSummary":
                quest_result = result
            elif section == "healthSummary":
                health_result = result

        if not completed_sections:
            return {
                "completed_sections": completed_sections,
                "failed_sections": failed_sections,
            }

        await self.api_client.put_action_log_daily_log(
            _build_daily_log_payload(
                date_key=yesterday_key,
                existing=existing,
                summary_result=summary_result,
                quest_result=quest_result,
                health_result=health_result,
                generated_at=generated_at,
            )
        )

        return {
            "completed_sections": completed_sections,
            "failed_sections": failed_sections,
        }

    async def _ensure_weekly_review(self, *, week_key: str, generated_at: datetime) -> None:
        existing = await self.api_client.get_action_log_weekly_review(week_key)
        if existing:
            return

        from_date, to_date = _week_range_from_key(week_key)
        sessions = await self.api_client.get_action_log_sessions(from_date, to_date)
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
                max_output_tokens=WEEKLY_ACTIVITY_REVIEW_MAX_OUTPUT_TOKENS,
            )
        except Exception:
            self._logger.exception("WeeklyActivityReview backfill fell back to template")
            generated = _build_weekly_fallback(
                week_key=week_key,
                sessions=sessions,
                category_durations=category_durations,
            )

        await self.api_client.put_action_log_weekly_review(
            {
                "id": f"weekly_{week_key}",
                "weekKey": week_key,
                "summary": generated["summary"],
                "categoryDurations": category_durations,
                "focusThemes": list(generated["focusThemes"]),
                "generatedAt": _to_jst_iso(generated_at),
            }
        )
