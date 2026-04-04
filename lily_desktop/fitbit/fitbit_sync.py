"""Fitbit 同期オーケストレーター — 起動時に直近3日分を取得・保存する"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fitbit.fitbit_client import FitbitClient
from fitbit.fitbit_summarizer import (
    summarize_activity,
    summarize_azm,
    summarize_heart,
    summarize_sleep,
)

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

_DEFAULT_RAW_LOG_DIR = Path(__file__).resolve().parent.parent / "logs" / "fitbit"


def _today_jst() -> str:
    """JST 基準の今日の日付文字列を返す（モック用に独立した関数にする）"""
    return datetime.now(tz=JST).strftime("%Y-%m-%d")


def _target_dates(today: str) -> list[str]:
    """当日・前日・前々日の日付リストを返す（降順）"""
    base = datetime.strptime(today, "%Y-%m-%d")
    return [(base - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(3)]


class FitbitSync:
    """Fitbit API から直近3日分のデータを取得し DynamoDB に upsert する。"""

    def __init__(
        self,
        client: FitbitClient,
        api_client,
        raw_log_dir: Path | None = None,
    ) -> None:
        self._client = client
        self._api = api_client
        self._raw_log_dir = raw_log_dir or _DEFAULT_RAW_LOG_DIR

    async def run(self) -> None:
        """3日分の取得・summary化・保存を実行する。"""
        run_id = uuid.uuid4().hex[:8]
        today = _today_jst()
        targets = _target_dates(today)

        logger.info("[fitbit][%s] 開始: 対象日=%s", run_id, targets)

        success_count = 0
        fail_count = 0

        for date_str in targets:
            ok = await self._sync_one_day(run_id, date_str)
            if ok:
                success_count += 1
            else:
                fail_count += 1

        if fail_count == 0:
            logger.info("[fitbit][%s] 完了: %d日分保存", run_id, success_count)
        elif success_count == 0:
            logger.warning("[fitbit][%s] 全件失敗: %d日分", run_id, fail_count)
        else:
            logger.warning(
                "[fitbit][%s] 部分成功: 成功=%d 失敗=%d",
                run_id, success_count, fail_count,
            )

    async def _sync_one_day(self, run_id: str, date_str: str) -> bool:
        """1日分を取得・summary化・upsert する。失敗時は False を返す。"""
        raw: dict | None = None

        # --- API 取得 ---
        try:
            heart = self._client.get_heart_rate(date_str)
            azm = self._client.get_active_zone_minutes(date_str)
            sleep = self._client.get_sleep(date_str)
            activity_raw = self._client.get_activity(date_str)
            raw = {
                "date": date_str,
                "heart": heart,
                "active_zone_minutes": azm,
                "sleep": sleep,
                "activity": activity_raw,
            }
            logger.info("[fitbit][%s] %s: API取得成功", run_id, date_str)
        except Exception:
            logger.exception("[fitbit][%s] %s: API取得失敗", run_id, date_str)
            return False

        # --- summary 化 ---
        try:
            summary = {
                "date": date_str,
                "heart": summarize_heart(heart),
                "active_zone_minutes": summarize_azm(azm),
                "sleep": summarize_sleep(sleep),
                "activity": summarize_activity(
                    steps_json=activity_raw["steps"],
                    distance_json=activity_raw["distance"],
                    calories_json=activity_raw["calories"],
                    minutes_json={
                        "very_active_minutes": activity_raw["very_active_minutes"],
                        "fairly_active_minutes": activity_raw["fairly_active_minutes"],
                        "lightly_active_minutes": activity_raw["lightly_active_minutes"],
                        "sedentary_minutes": activity_raw["sedentary_minutes"],
                    },
                ),
            }
            logger.info("[fitbit][%s] %s: summary化成功", run_id, date_str)
        except Exception:
            logger.exception("[fitbit][%s] %s: summary化失敗", run_id, date_str)
            self._save_raw(run_id, date_str, raw)
            return False

        # --- upsert ---
        try:
            await self._api.post_fitbit_data(summary)
            logger.info("[fitbit][%s] %s: upsert成功", run_id, date_str)
            return True
        except Exception:
            logger.exception("[fitbit][%s] %s: upsert失敗", run_id, date_str)
            return False

    def _save_raw(self, run_id: str, date_str: str, raw: dict) -> None:
        """デバッグ用に raw JSON をローカルファイルに保存する。"""
        try:
            self._raw_log_dir.mkdir(parents=True, exist_ok=True)
            path = self._raw_log_dir / f"fitbit_raw_{date_str}.json"
            path.write_text(json.dumps(raw, indent=2, ensure_ascii=False), encoding="utf-8")
            logger.info("[fitbit][%s] %s: raw JSON保存: %s", run_id, date_str, path)
        except Exception:
            logger.exception("[fitbit][%s] %s: raw JSON保存失敗", run_id, date_str)
