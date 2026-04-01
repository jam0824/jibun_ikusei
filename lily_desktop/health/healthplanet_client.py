"""Health Planet API クライアント — OAuth + innerscan fetch + JSONL保存"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, parse_qs, urlparse

import requests

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
REDIRECT_URI = "https://jam0824.github.io/"
AUTH_URL = "https://www.healthplanet.jp/oauth/auth"
TOKEN_URL = "https://www.healthplanet.jp/oauth/token"
INNERSCAN_URL = "https://www.healthplanet.jp/status/innerscan.json"
_TOKEN_BUFFER_SECONDS = 300  # 有効期限5分前に期限切れとみなす

_HEALTH_LOG_DIR = Path(__file__).resolve().parent.parent / "logs" / "health"


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def is_token_valid(access_token: str, expires_at: int) -> bool:
    """トークンが存在し、5分以上有効なら True"""
    if not access_token:
        return False
    now_ts = int(datetime.now(JST).timestamp())
    return expires_at - now_ts > _TOKEN_BUFFER_SECONDS


def build_auth_url(client_id: str) -> str:
    """OAuth 認証 URL を生成する"""
    params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "scope": "innerscan",
        "response_type": "code",
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def exchange_code_for_token(client_id: str, client_secret: str, code: str) -> dict:
    """認証コードをアクセストークンに交換する（同期）"""
    res = requests.post(TOKEN_URL, data={
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    })
    res.raise_for_status()
    return res.json()


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def fetch_innerscan_sync(
    access_token: str,
    from_dt: datetime,
    to_dt: datetime,
) -> list[dict]:
    """
    体重(6021)・体脂肪率(6022)を取得し、同一 date+time をマージして返す（同期）。

    戻り値例:
      [{"date": "2026-03-15", "time": "14:30", "weight_kg": 65.5, "body_fat_pct": 18.2}, ...]
    """
    res = requests.get(INNERSCAN_URL, params={
        "access_token": access_token,
        "date": 1,  # 測定日基準
        "from": from_dt.strftime("%Y%m%d%H%M%S"),
        "to": to_dt.strftime("%Y%m%d%H%M%S"),
        "tag": "6021,6022",
    })
    res.raise_for_status()
    raw_items = res.json().get("data", [])

    # (date, time) をキーにマージ
    merged: dict[tuple[str, str], dict] = {}
    for item in raw_items:
        dt_str = item.get("date", "")  # yyyyMMddHHmm
        if len(dt_str) < 12:
            continue
        date = f"{dt_str[:4]}-{dt_str[4:6]}-{dt_str[6:8]}"
        time = f"{dt_str[8:10]}:{dt_str[10:12]}"
        key = (date, time)
        if key not in merged:
            merged[key] = {"date": date, "time": time, "weight_kg": None, "body_fat_pct": None}
        tag = item.get("tag", "")
        value_str = item.get("keydata", "")
        try:
            value = float(value_str)
        except (ValueError, TypeError):
            continue
        if tag == "6021":
            merged[key]["weight_kg"] = value
        elif tag == "6022":
            merged[key]["body_fat_pct"] = value

    return sorted(merged.values(), key=lambda r: (r["date"], r["time"]))


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _load_stored_keys(date_str: str) -> set[tuple[str, str]]:
    """指定日の JSONL に保存済みの (date, time) セットを返す"""
    path = _HEALTH_LOG_DIR / f"{date_str}.jsonl"
    if not path.exists():
        return set()
    keys: set[tuple[str, str]] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
            keys.add((rec["date"], rec["time"]))
        except (json.JSONDecodeError, KeyError):
            continue
    return keys


def save_records(records: list[dict]) -> int:
    """
    records を JSONL に追記する。(date, time) が重複する行はスキップ。
    新規保存件数を返す。
    """
    _HEALTH_LOG_DIR.mkdir(parents=True, exist_ok=True)

    # 日付ごとにグループ化
    by_date: dict[str, list[dict]] = {}
    for r in records:
        by_date.setdefault(r["date"], []).append(r)

    new_count = 0
    for date_str, day_records in by_date.items():
        stored = _load_stored_keys(date_str)
        path = _HEALTH_LOG_DIR / f"{date_str}.jsonl"
        with path.open("a", encoding="utf-8") as f:
            for r in day_records:
                key = (r["date"], r["time"])
                if key in stored:
                    continue
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
                stored.add(key)
                new_count += 1

    return new_count


def query_health_data(from_date: str | None, to_date: str | None) -> list[dict]:
    """
    from_date〜to_date の範囲の JSONL レコードを読み込んで返す（Tool Search用）。
    日付は YYYY-MM-DD 形式。
    """
    if not _HEALTH_LOG_DIR.exists():
        return []

    results: list[dict] = []
    for path in sorted(_HEALTH_LOG_DIR.glob("*.jsonl")):
        date_str = path.stem  # YYYY-MM-DD
        if from_date and date_str < from_date:
            continue
        if to_date and date_str > to_date:
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                results.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    return sorted(results, key=lambda r: (r["date"], r["time"]))


# ---------------------------------------------------------------------------
# Async entry point
# ---------------------------------------------------------------------------

async def sync_health_data(
    client_id: str,
    client_secret: str,
    access_token: str,
) -> tuple[int, str | None]:
    """
    過去30日分を fetch して保存する（起動時呼び出し用）。
    戻り値: (新規件数, エラーメッセージ or None)
    """
    now = datetime.now(tz=JST)
    from_dt = now - timedelta(days=30)
    try:
        records = await asyncio.to_thread(
            fetch_innerscan_sync, access_token, from_dt, now
        )
        new_count = await asyncio.to_thread(save_records, records)
        return new_count, None
    except requests.HTTPError as exc:
        return 0, f"HTTP {exc.response.status_code}: {exc.response.text[:200]}"
    except Exception as exc:
        return 0, str(exc)
