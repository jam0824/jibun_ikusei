"""会話オーケストレーション — ユーザー→リリィ応答→任意で葉留佳反応"""

from __future__ import annotations

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


class ChatEngine:
    """リリィとの会話を管理するエンジン"""

    def __init__(self, config: AppConfig, api_client: ApiClient, session_mgr: SessionManager):
        self._config = config
        self._api = api_client
        self._session_mgr = session_mgr
        self._history: list[dict[str, Any]] = []
        self._tools: list[dict] | None = None
        self._tool_executor = None

    def set_tools(self, tools: list[dict], executor) -> None:
        self._tools = tools
        self._tool_executor = executor

    async def handle_user_message(self, text: str) -> None:
        """ユーザーメッセージを処理し、リリィの応答を返す"""
        try:
            # ユーザーメッセージをDB保存
            await self._session_mgr.save_message("user", text)
            self._history.append({"role": "user", "content": text})

            # リリィ応答
            lily_response = await self._get_lily_response()
            bus.ai_response_ready.emit("リリィ", lily_response, "default")

            # リリィ応答をDB保存
            await self._session_mgr.save_message("assistant", lily_response)
            self._history.append({"role": "assistant", "content": lily_response})

        except Exception as e:
            logger.exception("会話処理エラー")
            bus.balloon_show.emit("システム", f"エラー: {e}")

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
        from_date = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        to_date = now.strftime("%Y-%m-%d")

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
        except Exception:
            logger.warning("セッション履歴読み込み失敗")
            self._history = []
