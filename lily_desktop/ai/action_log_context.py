from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

JST = timezone(timedelta(hours=9))


def _parse_iso_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def to_jst(iso_value: str) -> str:
    parsed = _parse_iso_datetime(iso_value)
    if parsed is None:
        return iso_value[:16]
    return parsed.astimezone(JST).strftime("%Y-%m-%d %H:%M")


def build_activity_log_entries(
    sessions: list[dict[str, Any]],
    daily_logs: list[dict[str, Any]],
    open_loops: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []

    for session in sessions:
        if session.get("hidden") is True:
            continue
        entries.append(
            {
                "kind": "session",
                "category": session.get("primaryCategory", "other"),
                "title": session.get("title", ""),
                "summary": session.get("summary", ""),
                "timestamp": session.get("startedAt", ""),
                "activityKinds": session.get("activityKinds", []),
                "searchKeywords": session.get("searchKeywords", []),
                "appNames": session.get("appNames", []),
                "domains": session.get("domains", []),
                "projectNames": session.get("projectNames", []),
            }
        )

    for daily_log in daily_logs:
        entries.append(
            {
                "kind": "daily",
                "category": "daily_summary",
                "title": "その日のまとめ",
                "summary": daily_log.get("summary", ""),
                "timestamp": daily_log.get("generatedAt") or daily_log.get("dateKey", ""),
                "dateKey": daily_log.get("dateKey", ""),
            }
        )

    for open_loop in open_loops:
        entries.append(
            {
                "kind": "open_loop",
                "category": "open_loop",
                "title": open_loop.get("title", ""),
                "summary": open_loop.get("description", ""),
                "timestamp": open_loop.get("updatedAt") or open_loop.get("createdAt", ""),
                "status": open_loop.get("status", "open"),
            }
        )

    entries.sort(key=lambda entry: str(entry.get("timestamp", "")), reverse=True)
    return entries


async def fetch_activity_log_entries(
    api: Any,
    from_date: str,
    to_date: str,
) -> list[dict[str, Any]]:
    sessions, daily_logs, open_loops = await asyncio.gather(
        api.get_action_log_sessions(from_date, to_date),
        api.get_action_log_daily_logs(from_date, to_date),
        api.get_action_log_open_loops(from_date, to_date),
    )
    return build_activity_log_entries(sessions, daily_logs, open_loops)


def format_activity_log_lines(entries: list[dict[str, Any]], label: str) -> str:
    if not entries:
        return f"{label} のアクティビティログがありません。"

    lines = [f"【アクティビティログ】{label}", f"合計: {len(entries)}件", ""]
    for entry in entries[:20]:
        kind = entry.get("kind")
        if kind == "session":
            activity_kinds = " / ".join(
                item for item in entry.get("activityKinds", []) if isinstance(item, str)
            )
            category_label = str(entry.get("category", "other"))
            if activity_kinds:
                category_label = f"{category_label} / {activity_kinds}"
            summary = str(entry.get("summary", ""))
            summary_suffix = f" / {summary}" if summary else ""
            lines.append(
                f"- [{category_label}] {entry.get('title', '')} ({to_jst(str(entry.get('timestamp', '')))}){summary_suffix}"
            )
            continue

        if kind == "daily":
            lines.append(
                f"- [その日のまとめ] {entry.get('summary', '')} ({entry.get('dateKey', '')})"
            )
            continue

        if kind == "open_loop":
            summary = str(entry.get("summary", ""))
            summary_suffix = f" / {summary}" if summary else ""
            lines.append(
                f"- [OpenLoop / {entry.get('status', 'open')}] {entry.get('title', '')}{summary_suffix}"
            )
            continue

    if len(entries) > 20:
        lines.append(f"  ...{len(entries) - 20}件")
    return "\n".join(lines)
