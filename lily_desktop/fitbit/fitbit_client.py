"""Fitbit API クライアント — トークン管理 + 各エンドポイント呼び出し"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.fitbit.com"
_TOKEN_URL = f"{_BASE_URL}/oauth2/token"


class FitbitClient:
    """Fitbit API クライアント。

    401 時のみ token refresh を行い、設定ファイルを上書き保存する。
    """

    def __init__(self, config_path: Path) -> None:
        self._config_path = config_path
        self._config = self._load_config()

    # ------------------------------------------------------------------
    # 設定ファイル
    # ------------------------------------------------------------------

    def _load_config(self) -> dict:
        with open(self._config_path, encoding="utf-8") as f:
            return json.load(f)

    def _save_config(self) -> None:
        with open(self._config_path, "w", encoding="utf-8") as f:
            json.dump(self._config, f, indent=2, ensure_ascii=False)

    # ------------------------------------------------------------------
    # HTTP
    # ------------------------------------------------------------------

    def _api_get(self, url: str) -> dict:
        """GET リクエストを送る。401 時のみ refresh → 再試行。"""
        headers = {"Authorization": f"Bearer {self._config['access_token']}"}
        res = requests.get(url, headers=headers)

        if res.status_code == 401 or "expired_token" in res.text:
            logger.info("Token expired, refreshing...")
            self._refresh_token()
            headers["Authorization"] = f"Bearer {self._config['access_token']}"
            res = requests.get(url, headers=headers)

        try:
            data = res.json()
        except Exception:
            raise Exception(
                f"API response is not JSON: status={res.status_code}, text={res.text}"
            )

        if res.status_code >= 400:
            raise Exception(f"API error: status={res.status_code}, body={data}")

        return data

    def _refresh_token(self) -> None:
        """アクセストークンをリフレッシュし、設定ファイルに保存する。"""
        res = requests.post(
            _TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": self._config["refresh_token"],
                "client_id": self._config["client_id"],
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        res_json = res.json()

        if "access_token" not in res_json:
            raise Exception(f"Refresh failed: {res_json}")

        self._config["access_token"] = res_json["access_token"]
        self._config["refresh_token"] = res_json["refresh_token"]
        self._save_config()
        logger.info("Token refreshed successfully.")

    # ------------------------------------------------------------------
    # 各エンドポイント
    # ------------------------------------------------------------------

    def get_heart_rate(self, date_str: str) -> dict:
        """心拍データ（日次 + intraday 1分刻み）を取得する。"""
        url = f"{_BASE_URL}/1/user/-/activities/heart/date/{date_str}/1d/1min.json"
        return self._api_get(url)

    def get_active_zone_minutes(self, date_str: str) -> dict:
        """Active Zone Minutes（日次 + intraday 1分刻み）を取得する。"""
        url = f"{_BASE_URL}/1/user/-/activities/active-zone-minutes/date/{date_str}/1d/1min.json"
        return self._api_get(url)

    def get_sleep(self, date_str: str) -> dict:
        """睡眠データを取得する。"""
        url = f"{_BASE_URL}/1.2/user/-/sleep/date/{date_str}.json"
        return self._api_get(url)

    def get_activity(self, date_str: str) -> dict:
        """活動データ（steps / distance / calories / active minutes）を取得する。

        各リソースを個別に取得し、まとめて返す。
        戻り値の各キーは summarize_activity() の minutes_json 引数に対応する。
        """
        # キー: get_activity 戻り値のキー名, 値: Fitbit API パスセグメント
        resources = {
            "steps": "steps",
            "distance": "distance",
            "calories": "calories",
            "very_active_minutes": "minutesVeryActive",
            "fairly_active_minutes": "minutesFairlyActive",
            "lightly_active_minutes": "minutesLightlyActive",
            "sedentary_minutes": "minutesSedentary",
        }
        result: dict = {}
        for key, resource in resources.items():
            url = f"{_BASE_URL}/1/user/-/activities/{resource}/date/{date_str}/1d.json"
            result[key] = self._api_get(url)
        return result
