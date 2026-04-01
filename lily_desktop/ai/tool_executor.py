"""ツール実行 — API経由でデータ取得 (src/lib/chat-tools.ts executeTool の移植)"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import httpx

from api.api_client import ApiClient
from core.skill_resolution import resolve_skill_for_completion
from health.healthplanet_client import query_health_data

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
CHAT_MESSAGE_FETCH_CONCURRENCY = 4
RETRYABLE_CHAT_MESSAGE_STATUS_CODES = {502, 503, 504}
_PERIOD_LABELS = {"today": "今日", "week": "直近7日", "month": "直近30日"}

RuntimeContextProvider = Callable[[], dict[str, Any] | None]


@dataclass(frozen=True)
class ResolvedDateFilter:
    from_date: str
    to_date: str
    from_index: int
    to_index: int
    label: str
    kind: str


@dataclass(frozen=True)
class LoadedSessionMessages:
    session: dict[str, Any]
    messages: list[dict[str, Any]]


def to_jst(iso_value: str) -> str:
    """ISO文字列を JST の 'YYYY-MM-DD HH:MM' 形式に変換する。"""
    parsed = _parse_iso_datetime(iso_value)
    if parsed is None:
        return iso_value[:16]
    return parsed.astimezone(JST).strftime("%Y-%m-%d %H:%M")


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


def _is_period(value: Any) -> bool:
    return value in {"today", "week", "month"}


def _get_text_arg(args: dict[str, Any], key: str) -> str | None:
    value = args.get(key)
    if not isinstance(value, str):
        return None

    trimmed = value.strip()
    return trimmed or None


def _parse_jst_date(date_key: str) -> date_cls | None:
    try:
        return datetime.strptime(date_key, "%Y-%m-%d").date()
    except ValueError:
        return None


def _get_jst_date_key(value: Any) -> str:
    if isinstance(value, str):
        parsed_date = _parse_jst_date(value)
        if parsed_date is not None:
            return parsed_date.isoformat()

    parsed = _parse_iso_datetime(value)
    if parsed is None:
        return value if isinstance(value, str) else ""
    return parsed.astimezone(JST).date().isoformat()


def _get_jst_day_index(date_key: str) -> int | None:
    parsed = _parse_jst_date(date_key)
    return parsed.toordinal() if parsed is not None else None


def _resolve_period_filter(period: str) -> ResolvedDateFilter:
    now = datetime.now(JST).date()
    from_date = now
    if period == "month":
        from_date = now - timedelta(days=30)
    elif period == "week":
        from_date = now - timedelta(days=6)

    return ResolvedDateFilter(
        from_date=from_date.isoformat(),
        to_date=now.isoformat(),
        from_index=from_date.toordinal(),
        to_index=now.toordinal(),
        label=_PERIOD_LABELS[period],
        kind="period",
    )


def _resolve_optional_jst_date_filter(args: dict[str, Any]) -> ResolvedDateFilter | None:
    date = _get_text_arg(args, "date")
    from_date = _get_text_arg(args, "fromDate")
    to_date = _get_text_arg(args, "toDate")

    if date:
        date_index = _get_jst_day_index(date)
        if date_index is None:
            raise ValueError("date は YYYY-MM-DD 形式の JST 日付で指定してください。")
        return ResolvedDateFilter(
            from_date=date,
            to_date=date,
            from_index=date_index,
            to_index=date_index,
            label=f"{date} (JST)",
            kind="date",
        )

    if from_date or to_date:
        if not from_date or not to_date:
            raise ValueError("fromDate と toDate はセットで指定してください。")

        from_index = _get_jst_day_index(from_date)
        to_index = _get_jst_day_index(to_date)
        if from_index is None or to_index is None:
            raise ValueError("fromDate / toDate は YYYY-MM-DD 形式の JST 日付で指定してください。")
        if from_index > to_index:
            raise ValueError("fromDate は toDate 以下にしてください。")

        return ResolvedDateFilter(
            from_date=from_date,
            to_date=to_date,
            from_index=from_index,
            to_index=to_index,
            label=f"{from_date}〜{to_date} (JST)",
            kind="range",
        )

    period = args.get("period")
    if period in (None, ""):
        return None
    if not _is_period(period):
        raise ValueError("period は today / week / month のいずれかで指定してください。")
    return _resolve_period_filter(period)


def _resolve_jst_date_filter(args: dict[str, Any], default_period: str) -> ResolvedDateFilter:
    explicit = _resolve_optional_jst_date_filter(args)
    if explicit is not None:
        return explicit
    return _resolve_period_filter(default_period)


def _describe_filter(date_filter: ResolvedDateFilter | None, fallback: str = "全件") -> str:
    return date_filter.label if date_filter is not None else fallback


def _is_in_jst_date_range(timestamp: str, date_filter: ResolvedDateFilter) -> bool:
    day_index = _get_jst_day_index(_get_jst_date_key(timestamp))
    return (
        day_index is not None
        and date_filter.from_index <= day_index <= date_filter.to_index
    )


def _session_may_contain_messages_in_range(
    session: dict[str, Any],
    date_filter: ResolvedDateFilter,
) -> bool:
    created_index = _get_jst_day_index(_get_jst_date_key(session.get("createdAt", "")))
    updated_index = _get_jst_day_index(_get_jst_date_key(session.get("updatedAt", "")))
    if created_index is None or updated_index is None:
        return True
    return created_index <= date_filter.to_index and updated_index >= date_filter.from_index


def _build_context_messages_by_session(
    messages: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for message in messages:
        session_id = message.get("sessionId")
        if not isinstance(session_id, str) or not session_id:
            continue
        grouped.setdefault(session_id, []).append(message)
    return grouped


def _is_retryable_message_fetch_error(error: Exception) -> bool:
    if isinstance(error, httpx.HTTPStatusError) and error.response is not None:
        return error.response.status_code in RETRYABLE_CHAT_MESSAGE_STATUS_CODES
    return re.search(r"\b(502|503|504)\b", str(error)) is not None


def _format_seconds(total: int) -> str:
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}時間{m}分"
    if m > 0:
        return f"{m}分{s}秒"
    return f"{s}秒"


def _mask_api_key(key: str) -> str:
    if len(key) <= 8:
        return "***"
    return key[:4] + "..." + key[-4:]


class ToolExecutor:
    """Tool Search のツール実行を担当"""

    def __init__(
        self,
        api: ApiClient,
        context_provider: RuntimeContextProvider | None = None,
    ):
        self._api = api
        self._context_provider = context_provider

    def set_context_provider(self, provider: RuntimeContextProvider | None) -> None:
        self._context_provider = provider

    def _get_runtime_context(self) -> dict[str, Any]:
        if self._context_provider is None:
            return {"current_session_id": None, "chat_messages": []}

        try:
            raw_context = self._context_provider() or {}
        except Exception:
            logger.warning("ツール実行コンテキストの取得に失敗", exc_info=True)
            return {"current_session_id": None, "chat_messages": []}

        current_session_id = raw_context.get("current_session_id")
        if not isinstance(current_session_id, str):
            current_session_id = None

        chat_messages = raw_context.get("chat_messages")
        if not isinstance(chat_messages, list):
            chat_messages = []

        return {
            "current_session_id": current_session_id,
            "chat_messages": [message for message in chat_messages if isinstance(message, dict)],
        }

    async def execute(self, name: str, args: dict[str, Any]) -> str:
        try:
            if name == "get_browsing_times":
                return await self._browsing_times(args)
            if name == "get_user_info":
                return await self._user_info(args)
            if name == "get_quest_data":
                return await self._quest_data(args)
            if name == "get_skill_data":
                return await self._skill_data(args)
            if name == "get_messages_and_logs":
                return await self._messages_and_logs(args)
            if name == "complete_quest":
                return await self._complete_quest(args)
            if name == "create_quest":
                return await self._create_quest(args)
            if name == "delete_quest":
                return await self._delete_quest(args)
            if name == "get_health_data":
                return await self._health_data(args)
            return f"不明なツール: {name}"
        except Exception as exc:
            logger.exception("ツール実行エラー: %s", name)
            return f"ツール実行中にエラーが発生しました: {exc}"

    async def _get_chat_messages_with_retry(self, session_id: str) -> list[dict[str, Any]]:
        last_error: Exception | None = None

        for attempt in range(2):
            try:
                return await self._api.get_chat_messages(session_id)
            except Exception as exc:
                last_error = exc
                if not _is_retryable_message_fetch_error(exc) or attempt == 1:
                    break

        raise last_error or Exception("チャットメッセージの取得に失敗しました。")

    async def _load_messages_for_sessions(
        self,
        sessions: list[dict[str, Any]],
        fallback_messages: list[dict[str, Any]],
    ) -> tuple[list[LoadedSessionMessages], int]:
        if not sessions:
            return [], 0

        loaded: list[LoadedSessionMessages] = []
        failed_count = 0
        fallback_by_session = _build_context_messages_by_session(fallback_messages)

        for index in range(0, len(sessions), CHAT_MESSAGE_FETCH_CONCURRENCY):
            chunk = sessions[index:index + CHAT_MESSAGE_FETCH_CONCURRENCY]
            results = await asyncio.gather(
                *[self._get_chat_messages_with_retry(session["id"]) for session in chunk],
                return_exceptions=True,
            )

            for chunk_index, result in enumerate(results):
                session = chunk[chunk_index]
                if isinstance(result, Exception):
                    fallback = fallback_by_session.get(session["id"], [])
                    if fallback:
                        loaded.append(LoadedSessionMessages(session=session, messages=fallback))
                    else:
                        failed_count += 1
                    continue

                loaded.append(LoadedSessionMessages(session=session, messages=result))

        return loaded, failed_count

    async def _load_messages_for_candidate_sessions(
        self,
        sessions: list[dict[str, Any]],
        date_filter: ResolvedDateFilter,
        fallback_messages: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], list[LoadedSessionMessages], int]:
        candidates = [
            session
            for session in sessions
            if _session_may_contain_messages_in_range(session, date_filter)
        ]
        loaded, failed_count = await self._load_messages_for_sessions(candidates, fallback_messages)
        return candidates, loaded, failed_count

    async def _browsing_times(self, args: dict[str, Any]) -> str:
        try:
            date_filter = _resolve_jst_date_filter(args, "today")
        except ValueError as exc:
            return str(exc)

        entries = await self._api.get_browsing_times(date_filter.from_date, date_filter.to_date)
        if not entries:
            return f"{date_filter.label} の閲覧時間データがありません。"

        total_seconds = sum(entry.get("totalSeconds", 0) for entry in entries)
        category_totals: dict[str, int] = {}
        domain_totals: dict[str, tuple[int, str]] = {}
        for entry in entries:
            for domain, info in entry.get("domains", {}).items():
                seconds = info.get("totalSeconds", 0)
                category = info.get("category", "その他")
                category_totals[category] = category_totals.get(category, 0) + seconds
                previous_seconds, _ = domain_totals.get(domain, (0, category))
                domain_totals[domain] = (previous_seconds + seconds, category)

        lines = [
            f"【{date_filter.label} のブラウジング時間】",
            f"合計: {_format_seconds(total_seconds)}",
            "",
            "■ カテゴリ別",
        ]
        for category, seconds in sorted(category_totals.items(), key=lambda item: -item[1]):
            lines.append(f"- {category}: {_format_seconds(seconds)}")
        lines.append("")
        lines.append("■ サイト別")
        for domain, (seconds, category) in sorted(
            domain_totals.items(),
            key=lambda item: -item[1][0],
        )[:10]:
            lines.append(f"- {domain}: {_format_seconds(seconds)}（{category}）")
        return "\n".join(lines)

    async def _user_info(self, args: dict[str, Any]) -> str:
        info_type = args.get("type", "profile")
        if info_type == "profile":
            user = await self._api.get_user()
            if not user:
                return "ユーザー情報を取得できませんでした。"
            return "\n".join([
                "【ユーザープロフィール】",
                f"- レベル: {user.get('level', 1)}",
                f"- 総XP: {user.get('totalXp', 0)}",
                f"- 作成日: {str(user.get('createdAt', ''))[:10]}",
                f"- 最終更新: {str(user.get('updatedAt', ''))[:10]}",
            ])
        if info_type == "settings":
            settings = await self._api.get_settings()
            if not settings:
                return "設定情報を取得できませんでした。"
            return "\n".join([
                "【ユーザー設定】",
                f"- リリィ音声: {'ON' if settings.get('lilyVoiceEnabled') else 'OFF'}",
                f"- 自動再生: {settings.get('lilyAutoPlay', '不明')}",
                f"- デフォルトプライバシー: {settings.get('defaultPrivacyMode', '不明')}",
                f"- リマインダー: {settings.get('reminderTime', '未設定')}",
                f"- AI: {'ON' if settings.get('aiEnabled') else 'OFF'}",
            ])
        if info_type == "meta":
            meta = await self._api.get_meta()
            if not meta:
                return "メタ情報を取得できませんでした。"
            return "\n".join([
                "【メタ情報】",
                f"- スキーマバージョン: {meta.get('schemaVersion', '不明')}",
                f"- 最終日次サマリー: {meta.get('lastDailySummaryDate', '未実行')}",
                f"- 最終週次振り返り: {meta.get('lastWeeklyReflectionWeek', '未実行')}",
            ])
        return f"不明なtype: {info_type}"

    async def _quest_data(self, args: dict[str, Any]) -> str:
        data_type = args.get("type", "quests")
        if data_type == "quests":
            quests = await self._api.get_quests()
            if args.get("status"):
                quests = [quest for quest in quests if quest.get("status") == args["status"]]
            if args.get("questType"):
                quests = [quest for quest in quests if quest.get("questType") == args["questType"]]
            if args.get("category"):
                quests = [quest for quest in quests if quest.get("category") == args["category"]]
            if not quests:
                return "該当するクエストがありません。"

            lines = ["【クエスト一覧】", f"合計: {len(quests)}件", ""]
            for quest in quests[:20]:
                tags = ", ".join(filter(None, [
                    "繰り返し" if quest.get("questType") == "repeatable" else "一回限り",
                    quest.get("status", ""),
                    quest.get("category", ""),
                ]))
                lines.append(
                    f"- [{quest.get('id', '')}] {quest.get('title', '')}（{tags}）XP: {quest.get('xpReward', 10)}"
                )
            if len(quests) > 20:
                lines.append(f"  ...他{len(quests) - 20}件")
            return "\n".join(lines)

        if data_type == "completions":
            try:
                date_filter = _resolve_optional_jst_date_filter(args)
            except ValueError as exc:
                return str(exc)

            completions = await self._api.get_completions()
            quests = await self._api.get_quests()
            quest_map = {quest["id"]: quest.get("title", "不明") for quest in quests}
            filtered = [completion for completion in completions if not completion.get("undoneAt")]
            if args.get("questId"):
                filtered = [completion for completion in filtered if completion.get("questId") == args["questId"]]
            if date_filter is not None:
                filtered = [
                    completion
                    for completion in filtered
                    if _is_in_jst_date_range(completion.get("completedAt", ""), date_filter)
                ]

            filtered.sort(key=lambda completion: completion.get("completedAt", ""), reverse=True)
            if not filtered:
                return "該当する完了記録がありません。"

            lines = [
                f"【クエスト完了記録（{_describe_filter(date_filter)}）】",
                f"合計: {len(filtered)}件",
                "",
            ]
            for completion in filtered[:20]:
                title = quest_map.get(completion.get("questId", ""), "不明なクエスト")
                lines.append(
                    f"- {title} +{completion.get('userXpAwarded', 0)} XP（{_get_jst_date_key(completion.get('completedAt', ''))}）"
                )
            if len(filtered) > 20:
                lines.append(f"  ...他{len(filtered) - 20}件")
            return "\n".join(lines)

        return f"不明なtype: {data_type}"

    async def _skill_data(self, args: dict[str, Any]) -> str:
        data_type = args.get("type", "skills")
        if data_type == "skills":
            skills = await self._api.get_skills()
            if args.get("status"):
                skills = [skill for skill in skills if skill.get("status") == args["status"]]
            if args.get("category"):
                skills = [skill for skill in skills if skill.get("category") == args["category"]]
            if not skills:
                return "該当するスキルがありません。"
            skills.sort(key=lambda skill: skill.get("totalXp", 0), reverse=True)
            lines = ["【スキル一覧】", f"合計: {len(skills)}件", ""]
            for skill in skills[:20]:
                lines.append(
                    f"- {skill.get('name', '')} Lv.{skill.get('level', 1)}（{skill.get('totalXp', 0)} XP, {skill.get('category', '')}）"
                )
            if len(skills) > 20:
                lines.append(f"  ...他{len(skills) - 20}件")
            return "\n".join(lines)

        if data_type == "dictionary":
            dictionary = await self._api.get_dictionary()
            skills = await self._api.get_skills()
            skill_map = {skill["id"]: skill.get("name", "不明") for skill in skills}
            if not dictionary:
                return "個人スキル辞書にエントリがありません。"
            lines = ["【個人スキル辞書】", f"合計: {len(dictionary)}件", ""]
            for entry in dictionary[:20]:
                skill_name = skill_map.get(entry.get("mappedSkillId", ""), "不明")
                lines.append(f"- 「{entry.get('phrase', '')}」→ {skill_name}（{entry.get('createdBy', '')}）")
            if len(dictionary) > 20:
                lines.append(f"  ...他{len(dictionary) - 20}件")
            return "\n".join(lines)

        return f"不明なtype: {data_type}"

    async def _messages_and_logs(self, args: dict[str, Any]) -> str:
        data_type = args.get("type", "assistant_messages")
        runtime_context = self._get_runtime_context()
        fallback_messages = runtime_context["chat_messages"]

        if data_type == "assistant_messages":
            try:
                date_filter = _resolve_optional_jst_date_filter(args)
            except ValueError as exc:
                return str(exc)

            messages = await self._api.get_messages()
            trigger_type = _get_text_arg(args, "triggerType")
            if trigger_type:
                messages = [message for message in messages if message.get("triggerType") == trigger_type]
            if date_filter is not None:
                messages = [
                    message
                    for message in messages
                    if _is_in_jst_date_range(message.get("createdAt", ""), date_filter)
                ]
            messages.sort(key=lambda message: message.get("createdAt", ""), reverse=True)
            if not messages:
                return "該当するメッセージがありません。"

            lines = [
                f"【アシスタントメッセージ（{_describe_filter(date_filter)}）】",
                f"合計: {len(messages)}件",
                "",
            ]
            for message in messages[:20]:
                lines.append(
                    f"- [{message.get('triggerType', '')}] {message.get('text', '')}（{_get_jst_date_key(message.get('createdAt', ''))}）"
                )
            if len(messages) > 20:
                lines.append(f"  ...他{len(messages) - 20}件")
            return "\n".join(lines)

        if data_type == "ai_config":
            config = await self._api.get_ai_config()
            if not config:
                return "AI設定を取得できませんでした。"
            lines = ["【AI設定】", f"- アクティブプロバイダー: {config.get('activeProvider', '不明')}"]
            for name, provider in config.get("providers", {}).items():
                lines.append(f"■ {name}")
                lines.append(f"  - APIキー: {_mask_api_key(provider.get('apiKey', ''))}")
                lines.append(f"  - モデル: {provider.get('model', '不明')}")
            return "\n".join(lines)

        if data_type == "activity_logs":
            try:
                date_filter = _resolve_jst_date_filter(args, "week")
            except ValueError as exc:
                return str(exc)

            logs = await self._api.get_activity_logs(date_filter.from_date, date_filter.to_date)
            if not logs:
                return f"{date_filter.label} のアクティビティログがありません。"
            lines = [f"【アクティビティログ（{date_filter.label}）】", f"合計: {len(logs)}件", ""]
            for log in logs[:20]:
                lines.append(f"- [{log.get('category', '')}] {log.get('action', '')}（{to_jst(str(log.get('timestamp', '')))}）")
            if len(logs) > 20:
                lines.append(f"  ...他{len(logs) - 20}件")
            return "\n".join(lines)

        if data_type == "situation_logs":
            try:
                date_filter = _resolve_jst_date_filter(args, "week")
            except ValueError as exc:
                return str(exc)

            logs = await self._api.get_situation_logs(date_filter.from_date, date_filter.to_date)
            if not logs:
                return f"{date_filter.label} の状況ログがありません。"
            lines = [f"【状況ログ（{date_filter.label}）】", f"合計: {len(logs)}件", ""]
            for log in logs[:20]:
                apps = ", ".join(log.get("details", {}).get("active_apps", []))
                suffix = f"（アプリ: {apps}）" if apps else ""
                lines.append(f"- [{to_jst(str(log.get('timestamp', '')))}] {log.get('summary', '')}{suffix}")
            if len(logs) > 20:
                lines.append(f"  ...他{len(logs) - 20}件")
            return "\n".join(lines)

        if data_type == "chat_sessions":
            try:
                date_filter = _resolve_optional_jst_date_filter(args)
            except ValueError as exc:
                return str(exc)

            try:
                sessions = await self._api.get_chat_sessions()
            except Exception:
                return "チャットセッションの取得に失敗しました。"

            if not sessions:
                return "チャットセッションがありません。"

            sessions.sort(key=lambda session: session.get("updatedAt", ""), reverse=True)
            if date_filter is None:
                lines = ["【チャットセッション一覧】", f"合計: {len(sessions)}件", ""]
                for session in sessions[:20]:
                    lines.append(
                        f"- {session.get('title', '')}（{to_jst(str(session.get('createdAt', '')))}）ID: {session.get('id', '')}"
                    )
                if len(sessions) > 20:
                    lines.append(f"  ...他{len(sessions) - 20}件")
                return "\n".join(lines)

            candidates, loaded, failed_count = await self._load_messages_for_candidate_sessions(
                sessions,
                date_filter,
                fallback_messages,
            )
            if not loaded and failed_count > 0:
                return "チャットセッションの取得に失敗しました。"
            if not candidates:
                return f"{date_filter.label} に該当するチャットセッションがありません。"

            matched: list[tuple[dict[str, Any], int, str]] = []
            for entry in loaded:
                filtered_messages = [
                    message
                    for message in entry.messages
                    if _is_in_jst_date_range(message.get("createdAt", ""), date_filter)
                ]
                if not filtered_messages:
                    continue
                latest_at = max(message.get("createdAt", "") for message in filtered_messages)
                matched.append((entry.session, len(filtered_messages), latest_at))

            if not matched:
                return f"{date_filter.label} に該当するチャットセッションがありません。"

            matched.sort(key=lambda item: item[2], reverse=True)
            lines = [f"【チャットセッション一覧（{date_filter.label}）】", f"合計: {len(matched)}件", ""]
            for session, count, _ in matched[:20]:
                lines.append(
                    f"- {session.get('title', '')}（{to_jst(str(session.get('createdAt', '')))}）ID: {session.get('id', '')} / 該当: {count}件"
                )
            if len(matched) > 20:
                lines.append(f"  ...他{len(matched) - 20}件")
            return "\n".join(lines)

        if data_type == "chat_messages":
            try:
                date_filter = _resolve_optional_jst_date_filter(args)
            except ValueError as exc:
                return str(exc)

            session_id = _get_text_arg(args, "sessionId")
            if session_id:
                session_fallback = [
                    message
                    for message in fallback_messages
                    if message.get("sessionId") == session_id
                ]
                try:
                    messages = await self._get_chat_messages_with_retry(session_id)
                except Exception:
                    if session_fallback:
                        messages = session_fallback
                    else:
                        return "チャットメッセージの取得に失敗しました。"

                if date_filter is not None:
                    messages = [
                        message
                        for message in messages
                        if _is_in_jst_date_range(message.get("createdAt", ""), date_filter)
                    ]
                messages.sort(key=lambda message: message.get("createdAt", ""), reverse=True)
                if not messages:
                    return "該当するメッセージがありません。"

                session_title = session_id
                try:
                    sessions = await self._api.get_chat_sessions()
                except Exception:
                    sessions = []
                for session in sessions:
                    if session.get("id") == session_id:
                        session_title = session.get("title") or session_id
                        break

                lines = [
                    f"【チャットメッセージ（セッション: {session_title} / {_describe_filter(date_filter)}）】",
                    f"合計: {len(messages)}件",
                    "",
                ]
                for message in messages[:30]:
                    label = "ユーザー" if message.get("role") == "user" else "リリィ"
                    content = str(message.get("content", ""))[:100]
                    lines.append(f"- [{label}] {content}（{to_jst(str(message.get('createdAt', '')))}）")
                if len(messages) > 30:
                    lines.append(f"  ...他{len(messages) - 30}件")
                return "\n".join(lines)

            if date_filter is None:
                return "sessionId を指定するか、date / fromDate / toDate を指定してください。"

            try:
                sessions = await self._api.get_chat_sessions()
            except Exception:
                return "チャットセッションの取得に失敗しました。"

            if not sessions:
                return f"{date_filter.label} に該当するチャットメッセージがありません。"

            candidates, loaded, failed_count = await self._load_messages_for_candidate_sessions(
                sessions,
                date_filter,
                fallback_messages,
            )
            if not loaded and failed_count > 0:
                return "チャットメッセージの取得に失敗しました。"
            if not candidates:
                return f"{date_filter.label} に該当するチャットメッセージがありません。"

            matched_messages: list[tuple[dict[str, Any], dict[str, Any]]] = []
            for entry in loaded:
                for message in entry.messages:
                    if _is_in_jst_date_range(message.get("createdAt", ""), date_filter):
                        matched_messages.append((message, entry.session))

            matched_messages.sort(key=lambda item: item[0].get("createdAt", ""), reverse=True)
            if not matched_messages:
                return f"{date_filter.label} に該当するチャットメッセージがありません。"

            lines = [f"【チャットメッセージ（{date_filter.label}）】", f"合計: {len(matched_messages)}件", ""]
            for message, session in matched_messages[:30]:
                label = "ユーザー" if message.get("role") == "user" else "リリィ"
                content = str(message.get("content", ""))[:100]
                session_title = session.get("title") or session.get("id", "")
                lines.append(f"- [{session_title} / {label}] {content}（{to_jst(str(message.get('createdAt', '')))}）")
            if len(matched_messages) > 30:
                lines.append(f"  ...他{len(matched_messages) - 30}件")
            return "\n".join(lines)

        return f"不明なtype: {data_type}"

    @staticmethod
    def _fuzzy_match_score(query: str, title: str) -> float:
        """クエリとタイトルのあいまいスコア (0〜1)"""
        q = query.lower().strip()
        t = title.lower().strip()

        if q == t:
            return 1.0
        if q in t or t in q:
            return 0.8

        tokens = [token for token in re.split(r"[\s　、,・]+", q) if token]
        if not tokens:
            return 0.0

        match_count = sum(1 for token in tokens if token in t)
        if match_count == len(tokens):
            return 0.6
        return (match_count / len(tokens)) * 0.5

    async def _complete_quest(self, args: dict[str, Any]) -> str:
        query = args.get("query")
        if not query:
            return "クエストを特定するための検索クエリを指定してください。"

        quests = await self._api.get_quests()
        active_quests = [quest for quest in quests if quest.get("status") == "active"]
        if not active_quests:
            return "アクティブなクエストがありません。"

        best = None
        best_score = 0.0
        for quest in active_quests:
            score = self._fuzzy_match_score(query, quest.get("title", ""))
            if score > best_score:
                best = quest
                best_score = score

        if not best or best_score < 0.2:
            names = "、".join(f"「{quest.get('title', '')}」" for quest in active_quests[:10])
            return f"「{query}」に該当するアクティブなクエストが見つかりません。\n現在のアクティブクエスト: {names or 'なし'}"

        quest_id = best["id"]
        quest_title = best.get("title", "")
        xp_reward = best.get("xpReward", 10)
        quest_type = best.get("questType", "repeatable")
        now = datetime.now(JST).isoformat()

        resolution = None
        try:
            skills, dictionary = await asyncio.gather(
                self._api.get_skills(),
                self._api.get_dictionary(),
            )
            resolution = await resolve_skill_for_completion(
                best,
                args.get("note"),
                skills,
                dictionary,
                self._api,
            )
        except Exception:
            logger.warning("スキル解決に失敗、pendingで続行", exc_info=True)

        completion: dict[str, Any] = {
            "id": f"completion_{uuid.uuid4().hex[:12]}",
            "questId": quest_id,
            "clientRequestId": f"req_{uuid.uuid4().hex[:12]}",
            "completedAt": now,
            "note": args.get("note"),
            "userXpAwarded": xp_reward,
            "createdAt": now,
        }

        skill_msg = ""
        if resolution and resolution.get("resolved_skill_id"):
            completion["resolvedSkillId"] = resolution["resolved_skill_id"]
            completion["skillXpAwarded"] = resolution["skill_xp_awarded"]
            completion["skillResolutionStatus"] = "resolved"
            completion["resolutionReason"] = resolution.get("reason", "")
            skill_msg = f" [スキル: {resolution.get('skill_name', '')}]"
        else:
            completion["skillResolutionStatus"] = (
                resolution.get("status", "pending") if resolution else "pending"
            )

        await self._api.post_completion(completion)

        if quest_type == "one_time":
            await self._api.put_quest(quest_id, {**best, "status": "completed", "updatedAt": now})

        if resolution and resolution.get("resolved_skill_id"):
            if best.get("skillMappingMode") != "ask_each_time":
                try:
                    await self._api.put_quest(
                        quest_id,
                        {
                            **best,
                            "defaultSkillId": resolution["resolved_skill_id"],
                            "updatedAt": now,
                        },
                    )
                except Exception:
                    logger.warning("defaultSkillId の保存に失敗", exc_info=True)

        return f"クエスト「{quest_title}」をクリアしました！ +{xp_reward} XP{skill_msg}"

    async def _create_quest(self, args: dict[str, Any]) -> str:
        title = args.get("title")
        if not title:
            return "クエストのタイトルを指定してください。"

        now = datetime.now(JST).isoformat()
        quest = {
            "id": f"quest_{uuid.uuid4().hex[:12]}",
            "title": title,
            "description": args.get("description"),
            "questType": args.get("questType", "repeatable"),
            "xpReward": args.get("xpReward", 10),
            "category": args.get("category"),
            "skillMappingMode": "ai_auto",
            "privacyMode": "normal",
            "pinned": False,
            "source": "manual",
            "status": "active",
            "createdAt": now,
            "updatedAt": now,
        }
        await self._api.post_quest(quest)

        tags = ", ".join(filter(None, [
            "繰り返し" if quest["questType"] == "repeatable" else "一回限り",
            quest.get("category", ""),
            f"XP: {quest['xpReward']}",
        ]))
        return f"クエスト「{title}」を作成しました。（{tags}）"

    async def _delete_quest(self, args: dict[str, Any]) -> str:
        quest_id = args.get("questId")
        title = args.get("title")
        mode = args.get("mode", "delete")

        if not quest_id and not title:
            return "questIdまたはtitleを指定してください。"

        quests = await self._api.get_quests()
        if quest_id:
            target = next((quest for quest in quests if quest.get("id") == quest_id), None)
            if not target:
                return f"ID「{quest_id}」のクエストが見つかりません。"
        else:
            matches = [quest for quest in quests if title in quest.get("title", "")]
            if not matches:
                return f"「{title}」に該当するクエストが見つかりません。"
            if len(matches) > 1:
                names = "、".join(f"「{quest['title']}」" for quest in matches)
                return f"「{title}」に複数のクエストが該当します: {names}。questIdで指定してください。"
            target = matches[0]

        target_id = target["id"]
        target_title = target.get("title", "")

        if mode == "archive":
            await self._api.put_quest(target_id, {"status": "archived"})
            return f"クエスト「{target_title}」をアーカイブしました。"

        completions = await self._api.get_completions()
        has_completions = any(
            completion.get("questId") == target_id and not completion.get("undoneAt")
            for completion in completions
        )
        if has_completions:
            return f"クエスト「{target_title}」には完了履歴があるため削除できません。mode='archive'でアーカイブしてください。"

        await self._api.delete_quest(target_id)
        return f"クエスト「{target_title}」を削除しました。"

    async def _health_data(self, args: dict[str, Any]) -> str:
        try:
            date_filter = _resolve_jst_date_filter(args, "month")
        except ValueError as exc:
            return str(exc)

        records = await asyncio.to_thread(
            query_health_data, date_filter.from_date, date_filter.to_date
        )
        if not records:
            return f"{date_filter.label} の体重・体脂肪率データがありません。"

        lines = [f"【{date_filter.label} の体重・体脂肪率】", f"取得件数: {len(records)}件", ""]
        for r in records:
            weight = f"{r['weight_kg']}kg" if r.get("weight_kg") is not None else "－"
            fat = f"{r['body_fat_pct']}%" if r.get("body_fat_pct") is not None else "－"
            lines.append(f"- {r['date']} {r['time']}  体重: {weight}  体脂肪率: {fat}")
        return "\n".join(lines)
