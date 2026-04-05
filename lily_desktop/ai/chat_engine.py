"""会話オーケストレーション — ユーザー→リリィ応答→任意で葉留佳反応"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from ai.openai_client import (
    ChatCompletionResult,
    TextResult,
    ToolCallsResult,
    send_chat_message,
)
from ai.system_prompts import build_haruka_system_prompt, build_lily_system_prompt
from api.api_client import ApiClient
from core.config import AppConfig
from core.event_bus import bus
from data.session_manager import SessionManager

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
CONTEXT_CACHE_TTL_SECONDS = 30


def parse_ai_response(raw: str) -> tuple[str, str]:
    """AIレスポンス(JSON)をパースして (text, pose_category) を返す。

    期待形式: {"text": "セリフ", "pose_category": "joy"}
    パース失敗時は生テキストをそのまま使い、pose_categoryは"default"にする。
    """
    cleaned = raw.strip()
    # コードブロック除去
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        data = json.loads(cleaned)
        text = data.get("text", "")
        pose = data.get("pose_category", "default")
        return text, pose
    except json.JSONDecodeError:
        # JSONでない場合は生テキストをそのまま使用
        return raw.strip(), "default"


class ChatEngine:
    """リリィとの会話を管理するエンジン"""

    def __init__(self, config: AppConfig, api_client: ApiClient, session_mgr: SessionManager):
        self._config = config
        self._api = api_client
        self._session_mgr = session_mgr
        self._history: list[dict[str, Any]] = []
        self._current_session_messages: list[dict[str, Any]] = []
        self._tools: list[dict] | None = None
        self._tool_executor = None
        self._context_cache: tuple[Any, list[dict], list[dict], list[dict], list[dict]] | None = None
        self._context_cache_expires_at: datetime | None = None
        self._last_successful_context: tuple[Any, list[dict], list[dict], list[dict], list[dict]] | None = None

    def set_tools(self, tools: list[dict], executor) -> None:
        self._tools = tools
        self._tool_executor = executor

        executor_owner = getattr(executor, "__self__", None)
        set_context_provider = getattr(executor_owner, "set_context_provider", None)
        if callable(set_context_provider):
            set_context_provider(self.get_tool_runtime_context)
        set_context_invalidator = getattr(executor_owner, "set_context_invalidator", None)
        if callable(set_context_invalidator):
            set_context_invalidator(self.invalidate_context_cache)

    def invalidate_context_cache(self) -> None:
        self._context_cache = None
        self._context_cache_expires_at = None

    def get_tool_runtime_context(self) -> dict[str, Any]:
        session_id = self._session_mgr.current_session_id
        chat_messages = []
        if session_id:
            chat_messages = [
                dict(message)
                for message in self._current_session_messages
                if message.get("sessionId") == session_id
            ]

        return {
            "current_session_id": session_id,
            "chat_messages": chat_messages,
        }

    def _append_current_session_message(self, role: str, content: str) -> None:
        session_id = self._session_mgr.current_session_id
        if not session_id:
            return

        self._current_session_messages.append({
            "sessionId": session_id,
            "role": role,
            "content": content,
            "createdAt": datetime.now(JST).isoformat(),
        })

    async def handle_user_message(self, text: str) -> str | None:
        """ユーザーメッセージを処理し、リリィの応答テキストを返す（掛け合い連携用）"""
        try:
            # ユーザーメッセージをDB保存
            await self._session_mgr.save_message("user", text)
            self._history.append({"role": "user", "content": text})
            self._append_current_session_message("user", text)

            # リリィ応答（JSON形式）
            raw_response = await self._get_lily_response()
            lily_text, pose_category = parse_ai_response(raw_response)

            bus.ai_response_ready.emit("リリィ", lily_text, pose_category)

            # リリィ応答をDB保存（テキスト部分のみ）
            await self._session_mgr.save_message("assistant", lily_text)
            self._history.append({"role": "assistant", "content": lily_text})
            self._append_current_session_message("assistant", lily_text)

            return lily_text

        except Exception as e:
            logger.exception("会話処理エラー")
            bus.balloon_show.emit("システム", f"エラー: {e}")
            return None

    async def _get_lily_response(self) -> str:
        """リリィのシステムプロンプトを構築してAI応答を取得"""
        # コンテキスト情報を取得
        user_data, skills, quests, completions, activity_logs = await self._fetch_context()

        # 完了記録にクエストタイトルを紐付け
        quest_map = {q["id"]: q.get("title", "不明") for q in quests}
        now = datetime.now(JST)
        week_ago = (now - timedelta(days=7)).isoformat()
        recent_completions = [
            {
                "questTitle": quest_map.get(c.get("questId", ""), "不明なクエスト"),
                "completedAt": c.get("completedAt", ""),
            }
            for c in completions
            if not c.get("undoneAt") and c.get("completedAt", "") >= week_ago
        ][:10]

        system_prompt = build_lily_system_prompt(
            user=user_data,
            skills=skills,
            quests=quests,
            recent_completions=recent_completions,
            activity_logs=activity_logs,
        )

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            *self._history,
        ]

        result = await send_chat_message(
            api_key=self._config.openai.api_key,
            model=self._config.openai.chat_model,
            messages=messages,
            tools=self._tools,
        )

        # Tool呼び出し処理（最大1ラウンド）
        if isinstance(result, ToolCallsResult) and result.tool_calls:
            messages.append(result.assistant_message)

            for tc in result.tool_calls:
                try:
                    args = json.loads(tc.function_arguments)
                    tool_result = await self._tool_executor(tc.function_name, args)
                except Exception:
                    tool_result = "ツールの実行に失敗しました。"
                messages.append({
                    "role": "tool",
                    "content": tool_result,
                    "tool_call_id": tc.id,
                })

            result = await send_chat_message(
                api_key=self._config.openai.api_key,
                model=self._config.openai.chat_model,
                messages=messages,
            )

        if isinstance(result, TextResult):
            return result.content
        return "リリィからの応答を取得できませんでした。"

    async def _fetch_context(self):
        """API経由でコンテキスト情報を一括取得"""
        now = datetime.now(JST)
        if (
            self._context_cache is not None
            and self._context_cache_expires_at is not None
            and now < self._context_cache_expires_at
        ):
            return self._context_cache
        from_date = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        to_date = now.strftime("%Y-%m-%d")

        defaults = (None, [], [], [], [])
        previous = self._last_successful_context or defaults
        labels = (
            "user",
            "skills",
            "quests",
            "completions",
            "activity_logs",
        )

        results = await asyncio.gather(
            self._api.get_user(),
            self._api.get_skills(),
            self._api.get_quests(),
            self._api.get_completions(),
            self._api.get_activity_logs(from_date, to_date),
            return_exceptions=True,
        )

        merged: list[Any] = []
        for index, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning("%s蜿門ｾ怜､ｱ謨・", labels[index], exc_info=True)
                merged.append(previous[index])
            else:
                merged.append(result)

        context = tuple(merged)
        self._context_cache = context
        self._last_successful_context = context
        self._context_cache_expires_at = now + timedelta(seconds=CONTEXT_CACHE_TTL_SECONDS)
        return context

        user_data = None
        skills: list[dict] = []
        quests: list[dict] = []
        completions: list[dict] = []
        activity_logs: list[dict] = []

        try:
            user_data = await self._api.get_user()
        except Exception:
            logger.warning("ユーザー情報取得失敗")

        try:
            skills = await self._api.get_skills()
        except Exception:
            logger.warning("スキル取得失敗")

        try:
            quests = await self._api.get_quests()
        except Exception:
            logger.warning("クエスト取得失敗")

        try:
            completions = await self._api.get_completions()
        except Exception:
            logger.warning("完了記録取得失敗")

        try:
            activity_logs = await self._api.get_activity_logs(from_date, to_date)
        except Exception:
            logger.warning("アクティビティログ取得失敗")

        return user_data, skills, quests, completions, activity_logs

    async def load_session_history(self) -> None:
        """現在のセッションの会話履歴を読み込む"""
        session_id = self._session_mgr.current_session_id
        if not session_id:
            return
        try:
            messages = await self._api.get_chat_messages(session_id)
            self._history = [
                {"role": m["role"], "content": m["content"]}
                for m in messages
            ]
            self._current_session_messages = [
                {
                    "sessionId": m.get("sessionId", session_id),
                    "role": m.get("role", ""),
                    "content": m.get("content", ""),
                    "createdAt": m.get("createdAt", ""),
                }
                for m in messages
            ]
        except Exception:
            logger.warning("セッション履歴読み込み失敗")
            self._history = []
            self._current_session_messages = []
