"""ツール実行 — API経由でデータ取得 (src/lib/chat-tools.ts executeTool の移植)"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from api.api_client import ApiClient

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

_PERIOD_LABELS = {"today": "今日", "week": "直近7日間", "month": "直近30日間"}


def _get_date_range(period: str) -> tuple[str, str]:
    now = datetime.now(JST)
    to_date = now.strftime("%Y-%m-%d")
    if period == "month":
        from_date = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    elif period == "week":
        from_date = (now - timedelta(days=6)).strftime("%Y-%m-%d")
    else:  # today
        from_date = to_date
    return from_date, to_date


def _period_start_iso(period: str) -> str:
    now = datetime.now(JST)
    if period == "month":
        dt = now - timedelta(days=30)
    elif period == "week":
        dt = now - timedelta(days=6)
    else:
        dt = now
    return dt.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()


def _mask_api_key(key: str) -> str:
    if len(key) <= 8:
        return "***"
    return key[:4] + "..." + key[-4:]


def _format_seconds(total: int) -> str:
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h > 0:
        return f"{h}時間{m}分"
    if m > 0:
        return f"{m}分{s}秒"
    return f"{s}秒"


class ToolExecutor:
    """Tool Search のツール実行を担当"""

    def __init__(self, api: ApiClient):
        self._api = api

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
            if name == "create_quest":
                return await self._create_quest(args)
            if name == "delete_quest":
                return await self._delete_quest(args)
            return f"不明なツール: {name}"
        except Exception as e:
            logger.exception(f"ツール実行エラー: {name}")
            return f"ツール実行中にエラーが発生しました: {e}"

    async def _browsing_times(self, args: dict) -> str:
        period = args.get("period", "today")
        from_date, to_date = _get_date_range(period)
        entries = await self._api.get_browsing_times(from_date, to_date)
        if not entries:
            return f"{_PERIOD_LABELS.get(period, period)}の閲覧データがありません。"

        total_seconds = sum(e.get("totalSeconds", 0) for e in entries)
        # カテゴリ別集計
        cat_totals: dict[str, int] = {}
        # サイト別集計
        domain_totals: dict[str, tuple[int, str]] = {}
        for entry in entries:
            for domain, info in entry.get("domains", {}).items():
                sec = info.get("totalSeconds", 0)
                cat = info.get("category", "その他")
                cat_totals[cat] = cat_totals.get(cat, 0) + sec
                prev = domain_totals.get(domain, (0, cat))
                domain_totals[domain] = (prev[0] + sec, cat)

        lines = [
            f"【{_PERIOD_LABELS.get(period, period)}のブラウジング時間】",
            f"合計: {_format_seconds(total_seconds)}",
            "",
            "■ カテゴリ別",
        ]
        for cat, sec in sorted(cat_totals.items(), key=lambda x: -x[1]):
            lines.append(f"- {cat}: {_format_seconds(sec)}")
        lines.append("")
        lines.append("■ サイト別")
        top_domains = sorted(domain_totals.items(), key=lambda x: -x[1][0])[:10]
        for domain, (sec, cat) in top_domains:
            lines.append(f"- {domain}: {_format_seconds(sec)}（{cat}）")
        return "\n".join(lines)

    async def _user_info(self, args: dict) -> str:
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
            s = await self._api.get_settings()
            if not s:
                return "設定情報を取得できませんでした。"
            return "\n".join([
                "【ユーザー設定】",
                f"- リリィ音声: {'ON' if s.get('lilyVoiceEnabled') else 'OFF'}",
                f"- 自動再生: {s.get('lilyAutoPlay', '不明')}",
                f"- デフォルトプライバシー: {s.get('defaultPrivacyMode', '不明')}",
                f"- リマインダー: {s.get('reminderTime', '未設定')}",
                f"- AI: {'ON' if s.get('aiEnabled') else 'OFF'}",
            ])
        if info_type == "meta":
            m = await self._api.get_meta()
            if not m:
                return "メタ情報を取得できませんでした。"
            return "\n".join([
                "【メタ情報】",
                f"- スキーマバージョン: {m.get('schemaVersion', '不明')}",
                f"- 最終日次サマリー: {m.get('lastDailySummaryDate', '未実行')}",
                f"- 最終週次振り返り: {m.get('lastWeeklyReflectionWeek', '未実行')}",
            ])
        return f"不明なtype: {info_type}"

    async def _quest_data(self, args: dict) -> str:
        data_type = args.get("type", "quests")
        if data_type == "quests":
            quests = await self._api.get_quests()
            if args.get("status"):
                quests = [q for q in quests if q.get("status") == args["status"]]
            if args.get("questType"):
                quests = [q for q in quests if q.get("questType") == args["questType"]]
            if args.get("category"):
                quests = [q for q in quests if q.get("category") == args["category"]]
            if not quests:
                return "該当するクエストがありません。"
            lines = [f"【クエスト一覧】", f"合計: {len(quests)}件", ""]
            for q in quests[:20]:
                tags = ", ".join(filter(None, [
                    "繰り返し" if q.get("questType") == "repeatable" else "一回限り",
                    q.get("status", ""),
                    q.get("category", ""),
                ]))
                lines.append(f"- [{q.get('id', '')}] {q.get('title', '')}（{tags}）XP: {q.get('xpReward', 10)}")
            if len(quests) > 20:
                lines.append(f"  ...他{len(quests) - 20}件")
            return "\n".join(lines)

        if data_type == "completions":
            completions = await self._api.get_completions()
            quests = await self._api.get_quests()
            quest_map = {q["id"]: q.get("title", "不明") for q in quests}
            filtered = [c for c in completions if not c.get("undoneAt")]
            if args.get("questId"):
                filtered = [c for c in filtered if c.get("questId") == args["questId"]]
            if args.get("period"):
                start = _period_start_iso(args["period"])
                filtered = [c for c in filtered if c.get("completedAt", "") >= start]
            filtered.sort(key=lambda c: c.get("completedAt", ""), reverse=True)
            if not filtered:
                return "該当する完了記録がありません。"
            period_label = _PERIOD_LABELS.get(args.get("period", ""), "全件")
            lines = [f"【クエスト完了記録（{period_label}）】", f"合計: {len(filtered)}件", ""]
            for c in filtered[:20]:
                title = quest_map.get(c.get("questId", ""), "不明なクエスト")
                lines.append(f"- {title} +{c.get('userXpAwarded', 0)} XP（{str(c.get('completedAt', ''))[:10]}）")
            if len(filtered) > 20:
                lines.append(f"  ...他{len(filtered) - 20}件")
            return "\n".join(lines)
        return f"不明なtype: {data_type}"

    async def _skill_data(self, args: dict) -> str:
        data_type = args.get("type", "skills")
        if data_type == "skills":
            skills = await self._api.get_skills()
            if args.get("status"):
                skills = [s for s in skills if s.get("status") == args["status"]]
            if args.get("category"):
                skills = [s for s in skills if s.get("category") == args["category"]]
            if not skills:
                return "該当するスキルがありません。"
            skills.sort(key=lambda s: s.get("totalXp", 0), reverse=True)
            lines = ["【スキル一覧】", f"合計: {len(skills)}件", ""]
            for s in skills[:20]:
                lines.append(f"- {s.get('name', '')} Lv.{s.get('level', 1)}（{s.get('totalXp', 0)} XP, {s.get('category', '')}）")
            if len(skills) > 20:
                lines.append(f"  ...他{len(skills) - 20}件")
            return "\n".join(lines)

        if data_type == "dictionary":
            dictionary = await self._api.get_dictionary()
            skills = await self._api.get_skills()
            skill_map = {s["id"]: s.get("name", "不明") for s in skills}
            if not dictionary:
                return "個人スキル辞書にエントリがありません。"
            lines = ["【個人スキル辞書】", f"合計: {len(dictionary)}件", ""]
            for d in dictionary[:20]:
                skill_name = skill_map.get(d.get("mappedSkillId", ""), "不明")
                lines.append(f"- 「{d.get('phrase', '')}」→ {skill_name}（{d.get('createdBy', '')}）")
            if len(dictionary) > 20:
                lines.append(f"  ...他{len(dictionary) - 20}件")
            return "\n".join(lines)
        return f"不明なtype: {data_type}"

    async def _messages_and_logs(self, args: dict) -> str:
        data_type = args.get("type", "assistant_messages")

        if data_type == "assistant_messages":
            messages = await self._api.get_messages()
            if args.get("triggerType"):
                messages = [m for m in messages if m.get("triggerType") == args["triggerType"]]
            if args.get("period"):
                start = _period_start_iso(args["period"])
                messages = [m for m in messages if m.get("createdAt", "") >= start]
            messages.sort(key=lambda m: m.get("createdAt", ""), reverse=True)
            if not messages:
                return "該当するメッセージがありません。"
            period_label = _PERIOD_LABELS.get(args.get("period", ""), "全件")
            lines = [f"【アシスタントメッセージ（{period_label}）】", f"合計: {len(messages)}件", ""]
            for m in messages[:20]:
                lines.append(f"- [{m.get('triggerType', '')}] {m.get('text', '')}（{str(m.get('createdAt', ''))[:10]}）")
            if len(messages) > 20:
                lines.append(f"  ...他{len(messages) - 20}件")
            return "\n".join(lines)

        if data_type == "ai_config":
            cfg = await self._api.get_ai_config()
            if not cfg:
                return "AI設定を取得できませんでした。"
            lines = ["【AI設定】", f"- アクティブプロバイダー: {cfg.get('activeProvider', '不明')}"]
            for name, provider in cfg.get("providers", {}).items():
                lines.append(f"■ {name}")
                lines.append(f"  - APIキー: {_mask_api_key(provider.get('apiKey', ''))}")
                lines.append(f"  - モデル: {provider.get('model', '不明')}")
            return "\n".join(lines)

        if data_type == "activity_logs":
            period = args.get("period", "week")
            from_date, to_date = _get_date_range(period)
            logs = await self._api.get_activity_logs(from_date, to_date)
            if not logs:
                return f"{_PERIOD_LABELS.get(period, period)}のアクティビティログがありません。"
            lines = [f"【アクティビティログ（{_PERIOD_LABELS.get(period, period)}）】", f"合計: {len(logs)}件", ""]
            for log in logs[:20]:
                lines.append(f"- [{log.get('category', '')}] {log.get('action', '')}（{str(log.get('timestamp', ''))[:16]}）")
            if len(logs) > 20:
                lines.append(f"  ...他{len(logs) - 20}件")
            return "\n".join(lines)

        if data_type == "chat_sessions":
            sessions = await self._api.get_chat_sessions()
            if not sessions:
                return "チャットセッションがありません。"
            lines = ["【チャットセッション一覧】", f"合計: {len(sessions)}件", ""]
            for s in sessions[:20]:
                lines.append(f"- {s.get('title', '')}（{str(s.get('createdAt', ''))[:10]}）ID: {s.get('id', '')}")
            if len(sessions) > 20:
                lines.append(f"  ...他{len(sessions) - 20}件")
            return "\n".join(lines)

        if data_type == "chat_messages":
            session_id = args.get("sessionId")
            if not session_id:
                return "sessionIdを指定してください。"
            messages = await self._api.get_chat_messages(session_id)
            if not messages:
                return "該当するメッセージがありません。"
            lines = [f"【チャットメッセージ（セッション: {session_id}）】", f"合計: {len(messages)}件", ""]
            for m in messages[:30]:
                label = "ユーザー" if m.get("role") == "user" else "リリィ"
                content = str(m.get("content", ""))[:100]
                lines.append(f"- [{label}] {content}（{str(m.get('createdAt', ''))[:16]}）")
            if len(messages) > 30:
                lines.append(f"  ...他{len(messages) - 30}件")
            return "\n".join(lines)

        return f"不明なtype: {data_type}"

    async def _create_quest(self, args: dict) -> str:
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

    async def _delete_quest(self, args: dict) -> str:
        quest_id = args.get("questId")
        title = args.get("title")
        mode = args.get("mode", "delete")

        if not quest_id and not title:
            return "questIdまたはtitleを指定してください。"

        quests = await self._api.get_quests()

        if quest_id:
            target = next((q for q in quests if q.get("id") == quest_id), None)
            if not target:
                return f"ID「{quest_id}」のクエストが見つかりません。"
        else:
            matches = [q for q in quests if title in q.get("title", "")]
            if not matches:
                return f"「{title}」に該当するクエストが見つかりません。"
            if len(matches) > 1:
                names = "、".join(f"「{q['title']}」" for q in matches)
                return f"「{title}」に複数のクエストが該当します: {names}。questIdで指定してください。"
            target = matches[0]

        target_id = target["id"]
        target_title = target.get("title", "")

        if mode == "archive":
            await self._api.put_quest(target_id, {"status": "archived"})
            return f"クエスト「{target_title}」をアーカイブしました。"

        # 完了履歴チェック
        completions = await self._api.get_completions()
        has_completions = any(
            c.get("questId") == target_id and not c.get("undoneAt")
            for c in completions
        )
        if has_completions:
            return f"クエスト「{target_title}」には完了履歴があるため削除できません。mode='archive'でアーカイブしてください。"

        await self._api.delete_quest(target_id)
        return f"クエスト「{target_title}」を削除しました。"
