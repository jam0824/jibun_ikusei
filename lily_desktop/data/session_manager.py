"""チャットセッション管理 — 作成・切り替え・メッセージ保存"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from api.api_client import ApiClient

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))


def _now_iso() -> str:
    return datetime.now(JST).isoformat()


def _create_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class SessionManager:
    """チャットセッションのライフサイクル管理"""

    def __init__(self, api: ApiClient):
        self._api = api
        self._current_session_id: str | None = None
        self._is_first_user_message = True

    @property
    def current_session_id(self) -> str | None:
        return self._current_session_id

    async def ensure_session(self) -> str:
        """現在のセッションがなければ新規作成"""
        if self._current_session_id:
            return self._current_session_id
        return await self.create_new_session()

    async def create_new_session(self) -> str:
        """新しいチャットセッションを作成"""
        now = _now_iso()
        session = {
            "id": _create_id("chat"),
            "title": "新しい会話",
            "createdAt": now,
            "updatedAt": now,
        }
        try:
            await self._api.post_chat_session(session)
        except Exception:
            logger.warning("セッション作成API呼び出し失敗（ローカルで続行）")
        self._current_session_id = session["id"]
        self._is_first_user_message = True
        logger.info(f"新規セッション作成: {session['id']}")
        return session["id"]

    async def load_latest_session(self) -> str | None:
        """最新のセッションを読み込む。なければ新規作成"""
        try:
            sessions = await self._api.get_chat_sessions()
            if sessions:
                latest = sessions[0]
                self._current_session_id = latest["id"]
                self._is_first_user_message = False
                return latest["id"]
        except Exception:
            logger.warning("セッション一覧取得失敗")
        return await self.create_new_session()

    async def save_message(self, role: str, content: str) -> None:
        """メッセージをAPIに保存"""
        session_id = await self.ensure_session()
        now = _now_iso()
        message = {
            "id": _create_id("cmsg"),
            "sessionId": session_id,
            "role": role,
            "content": content,
            "createdAt": now,
        }
        try:
            await self._api.post_chat_message(session_id, message)
        except Exception:
            logger.warning("メッセージ保存失敗")

        # 最初のユーザーメッセージでタイトル更新
        if role == "user" and self._is_first_user_message:
            self._is_first_user_message = False
            title = content[:30]
            try:
                await self._api.put_chat_session(session_id, {
                    "title": title,
                    "updatedAt": now,
                })
            except Exception:
                logger.warning("セッションタイトル更新失敗")
        else:
            try:
                await self._api.put_chat_session(session_id, {"updatedAt": now})
            except Exception:
                pass
