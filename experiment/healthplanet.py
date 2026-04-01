"""
Health Planet API から体重・体脂肪率を取得するスクリプト

OAuth 2.0 フロー:
  1. ブラウザで認証URL を開き、認証コードを取得
  2. 認証コードをアクセストークンに交換
  3. innerscan API で体重・体脂肪率を取得
"""

import os
import webbrowser
from pathlib import Path
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
import requests
from dotenv import load_dotenv

# experiment/ の一つ上（プロジェクトルート）の .env を明示的に読み込む
load_dotenv(Path(__file__).parent.parent / ".env")

JST = timezone(timedelta(hours=9))

CLIENT_ID = os.environ["HEALTHPLANET_CLIENT_ID"]
CLIENT_SECRET = os.environ["HEALTHPLANET_CLIENT_SECRET"]
REDIRECT_URI = "https://jam0824.github.io/"

AUTH_URL = "https://www.healthplanet.jp/oauth/auth"
TOKEN_URL = "https://www.healthplanet.jp/oauth/token"
INNERSCAN_URL = "https://www.healthplanet.jp/status/innerscan.json"


def get_auth_url() -> str:
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "innerscan",
        "response_type": "code",
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def get_access_token(code: str) -> dict:
    """認証コードをアクセストークンに交換する"""
    res = requests.post(TOKEN_URL, data={
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    })
    res.raise_for_status()
    return res.json()


def fetch_innerscan(
    access_token: str,
    from_dt: datetime | None = None,
    to_dt: datetime | None = None,
) -> list[dict]:
    """
    体重(tag=6021)・体脂肪率(tag=6022)を取得する。

    デフォルトは過去30日分。
    """
    now = datetime.now(tz=JST)
    if to_dt is None:
        to_dt = now
    if from_dt is None:
        from_dt = now - timedelta(days=30)

    res = requests.get(INNERSCAN_URL, params={
        "access_token": access_token,
        "date": 1,  # 測定日基準
        "from": from_dt.strftime("%Y%m%d%H%M%S"),
        "to": to_dt.strftime("%Y%m%d%H%M%S"),
        "tag": "6021,6022",  # 体重, 体脂肪率
    })
    res.raise_for_status()
    body = res.json()

    TAG_NAMES = {"6021": "体重(kg)", "6022": "体脂肪率(%)"}
    results = []
    for item in body.get("data", []):
        tag = item.get("tag", "")
        results.append({
            "日時": item["date"],  # yyyyMMddHHmm
            "種別": TAG_NAMES.get(tag, tag),
            "値": item["keydata"],
        })

    results.sort(key=lambda x: x["日時"])
    return results


def main():
    # --- Step 1: 認証URL を開く ---
    auth_url = get_auth_url()
    print(f"次のURLをブラウザで開いて認証してください:\n{auth_url}\n")
    webbrowser.open(auth_url)

    # --- Step 2: 認証コードを入力 ---
    # 認証後、リダイレクト先URL の ?code=XXXX を貼り付ける
    code = input("リダイレクト先URL の code= の値を貼り付けてください: ").strip()

    # --- Step 3: アクセストークン取得 ---
    token_res = get_access_token(code)
    print(f"\nトークン取得結果: {token_res}")
    access_token = token_res["access_token"]

    # --- Step 4: データ取得 ---
    records = fetch_innerscan(access_token)

    if not records:
        print("\nデータが見つかりませんでした。")
        return

    print(f"\n--- 取得データ ({len(records)} 件) ---")
    for r in records:
        dt_str = r["日時"]
        # yyyyMMddHHmm → YYYY-MM-DD HH:MM
        dt_fmt = f"{dt_str[:4]}-{dt_str[4:6]}-{dt_str[6:8]} {dt_str[8:10]}:{dt_str[10:12]}"
        print(f"  {dt_fmt}  {r['種別']}: {r['値']}")


if __name__ == "__main__":
    main()
