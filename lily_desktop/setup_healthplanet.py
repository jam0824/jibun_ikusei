"""
Health Planet 初回認証スクリプト

実行すると：
  1. ブラウザで認証ページを開く
  2. code を貼り付けてアクセストークンを取得
  3. .env に自動保存

使い方:
  uv run python setup_healthplanet.py
"""

import sys
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlencode
import re

import requests
from dotenv import load_dotenv
import os

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_ENV_PATH = _PROJECT_ROOT / ".env"

load_dotenv(_ENV_PATH)

CLIENT_ID = os.environ.get("HEALTHPLANET_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("HEALTHPLANET_CLIENT_SECRET", "")
REDIRECT_URI = "https://jam0824.github.io/"
AUTH_URL = "https://www.healthplanet.jp/oauth/auth"
TOKEN_URL = "https://www.healthplanet.jp/oauth/token"


def _save_to_env(access_token: str, expires_at: int) -> None:
    updates = {
        "HEALTHPLANET_ACCESS_TOKEN": access_token,
        "HEALTHPLANET_TOKEN_EXPIRES_AT": str(expires_at),
    }
    lines: list[str] = []
    if _ENV_PATH.exists():
        lines = _ENV_PATH.read_text(encoding="utf-8").splitlines(keepends=True)

    written: set[str] = set()
    new_lines: list[str] = []
    for line in lines:
        key = line.partition("=")[0].strip()
        if key in updates:
            new_lines.append(f"{key}={updates[key]}\n")
            written.add(key)
        else:
            new_lines.append(line)

    for key, value in updates.items():
        if key not in written:
            new_lines.append(f"{key}={value}\n")

    _ENV_PATH.write_text("".join(new_lines), encoding="utf-8")


def _extract_code(text: str) -> str:
    match = re.search(r"[?&]code=([^&\s]+)", text)
    return match.group(1) if match else text.strip()


def main() -> None:
    if not CLIENT_ID or not CLIENT_SECRET:
        print("エラー: .env に HEALTHPLANET_CLIENT_ID と HEALTHPLANET_CLIENT_SECRET を設定してください。")
        sys.exit(1)

    # Step 1: 認証URL を開く
    params = urlencode({
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": "innerscan",
        "response_type": "code",
    })
    auth_url = f"{AUTH_URL}?{params}"
    print("ブラウザで Health Planet の認証ページを開きます...")
    webbrowser.open(auth_url)

    # Step 2: code を入力
    print("\nログイン・許可後にリダイレクトされた URL（または code= の値）を貼り付けてください。")
    text = input("> ").strip()
    code = _extract_code(text)
    if not code:
        print("エラー: code が取得できませんでした。")
        sys.exit(1)

    # Step 3: アクセストークンを取得
    print("\nアクセストークンを取得中...")
    res = requests.post(TOKEN_URL, data={
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    })
    try:
        res.raise_for_status()
    except requests.HTTPError:
        print(f"エラー: トークン取得に失敗しました。\n{res.text}")
        sys.exit(1)

    token_data = res.json()
    access_token = token_data["access_token"]
    expires_in = int(token_data.get("expires_in", 2592000))
    expires_at = int(time.time()) + expires_in

    # Step 4: .env に保存
    _save_to_env(access_token, expires_at)
    print(f"\n.env にアクセストークンを保存しました。（有効期限: {expires_in // 86400} 日）")
    print("lily_desktop を起動すると自動でデータが取得されます。")


if __name__ == "__main__":
    main()
