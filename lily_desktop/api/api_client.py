from __future__ import annotations

import logging
from typing import Any

import httpx

from api.auth import CognitoAuth
from core.constants import API_BASE_URL

logger = logging.getLogger(__name__)


class ApiClient:
    """既存API Gatewayへのクライアント (src/lib/api-client.ts の Python移植)"""

    def __init__(self, auth: CognitoAuth):
        self._auth = auth
        self._http = httpx.AsyncClient(timeout=30.0)
        self._base = API_BASE_URL

    async def _request(
        self, method: str, path: str, json: Any = None, params: dict | None = None
    ) -> Any:
        token = await self._auth.get_id_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        resp = await self._http.request(
            method, f"{self._base}{path}", headers=headers, json=json, params=params
        )
        resp.raise_for_status()
        return resp.json()

    # ---- ユーザー ----
    async def get_user(self) -> dict | None:
        return await self._request("GET", "/user")

    # ---- クエスト ----
    async def get_quests(self) -> list[dict]:
        return await self._request("GET", "/quests")

    async def post_quest(self, quest: dict) -> dict:
        return await self._request("POST", "/quests", json=quest)

    async def delete_quest(self, quest_id: str) -> dict:
        return await self._request("DELETE", f"/quests/{quest_id}")

    async def put_quest(self, quest_id: str, updates: dict) -> dict:
        return await self._request("PUT", f"/quests/{quest_id}", json=updates)

    # ---- 完了記録 ----
    async def get_completions(self) -> list[dict]:
        return await self._request("GET", "/completions")

    async def post_completion(self, completion: dict) -> dict:
        return await self._request("POST", "/completions", json=completion)

    async def put_completion(self, completion_id: str, updates: dict) -> dict:
        return await self._request("PUT", f"/completions/{completion_id}", json=updates)

    # ---- スキル ----
    async def get_skills(self) -> list[dict]:
        return await self._request("GET", "/skills")

    async def post_skill(self, skill: dict) -> dict:
        return await self._request("POST", "/skills", json=skill)

    # ---- 設定 ----
    async def get_settings(self) -> dict | None:
        return await self._request("GET", "/settings")

    # ---- AI設定 ----
    async def get_ai_config(self) -> dict | None:
        return await self._request("GET", "/ai-config")

    # ---- メタ ----
    async def get_meta(self) -> dict | None:
        return await self._request("GET", "/meta")

    # ---- メッセージ ----
    async def get_messages(self) -> list[dict]:
        return await self._request("GET", "/messages")

    # ---- ブラウジング時間 ----
    async def get_browsing_times(self, from_date: str, to_date: str) -> list[dict]:
        return await self._request(
            "GET", "/browsing-times", params={"from": from_date, "to": to_date}
        )

    # ---- 体重・体脂肪率 ----
    async def get_health_data(self, from_date: str, to_date: str) -> list[dict]:
        return await self._request(
            "GET", "/health-data", params={"from": from_date, "to": to_date}
        )

    async def post_health_data(self, entries: list[dict]) -> dict:
        return await self._request("POST", "/health-data", json={"entries": entries})

    # ---- Fitbit ----
    async def post_fitbit_data(self, summary: dict) -> dict:
        return await self._request("POST", "/fitbit-data", json=summary)

    async def get_fitbit_data(self, from_date: str, to_date: str) -> list[dict]:
        return await self._request(
            "GET", "/fitbit-data", params={"from": from_date, "to": to_date}
        )

    # ---- アクティビティログ ----
    async def get_activity_logs(self, from_date: str, to_date: str) -> list[dict]:
        return await self._request(
            "GET", "/activity-logs", params={"from": from_date, "to": to_date}
        )

    # ---- 栄養素 ----
    async def get_nutrition_range(self, from_date: str, to_date: str) -> dict:
        return await self._request(
            "GET", "/nutrition", params={"from": from_date, "to": to_date}
        )

    # ---- 状況ログ ----
    async def get_situation_logs(self, from_date: str, to_date: str) -> list[dict]:
        return await self._request(
            "GET", "/situation-logs", params={"from": from_date, "to": to_date}
        )

    async def post_situation_log(self, log: dict) -> dict:
        return await self._request("POST", "/situation-logs", json=log)

    # ---- 辞書 ----
    async def get_dictionary(self) -> list[dict]:
        return await self._request("GET", "/dictionary")

    # ---- チャットセッション ----
    async def get_chat_sessions(self) -> list[dict]:
        return await self._request("GET", "/chat-sessions")

    async def post_chat_session(self, session: dict) -> dict:
        return await self._request("POST", "/chat-sessions", json=session)

    async def put_chat_session(self, session_id: str, updates: dict) -> dict:
        return await self._request(
            "PUT", f"/chat-sessions/{session_id}", json=updates
        )

    async def delete_chat_session(self, session_id: str) -> dict:
        return await self._request("DELETE", f"/chat-sessions/{session_id}")

    # ---- チャットメッセージ ----
    async def get_chat_messages(self, session_id: str) -> list[dict]:
        return await self._request(
            "GET", f"/chat-sessions/{session_id}/messages"
        )

    async def post_chat_message(self, session_id: str, message: dict) -> dict:
        return await self._request(
            "POST", f"/chat-sessions/{session_id}/messages", json=message
        )

    async def close(self) -> None:
        await self._http.aclose()
