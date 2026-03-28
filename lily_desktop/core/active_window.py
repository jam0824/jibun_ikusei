"""アクティブウィンドウ情報の取得とスクリーンショット"""

from __future__ import annotations

import ctypes
import ctypes.wintypes
import io
import logging
import re
from dataclasses import dataclass, field

from PIL import ImageGrab

logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# 解析対象外の判定ルール
# ------------------------------------------------------------------

# アプリ名（プロセス名）で除外するパターン
_EXCLUDED_APP_PATTERNS: list[re.Pattern] = [
    re.compile(r"(?i)keepass"),
    re.compile(r"(?i)1password"),
    re.compile(r"(?i)bitwarden"),
    re.compile(r"(?i)lastpass"),
    re.compile(r"(?i)authy"),
    re.compile(r"(?i)authenticator"),
]

# ウィンドウタイトルで除外するパターン
_EXCLUDED_TITLE_PATTERNS: list[re.Pattern] = [
    re.compile(r"(?i)password"),
    re.compile(r"(?i)パスワード"),
    re.compile(r"(?i)認証コード"),
    re.compile(r"(?i)verification\s*code"),
    re.compile(r"(?i)two.factor"),
    re.compile(r"(?i)2fa"),
]

# ブラウザのプロセス名
_BROWSER_PROCESSES: set[str] = {
    "chrome.exe", "msedge.exe", "firefox.exe", "brave.exe",
    "opera.exe", "vivaldi.exe", "arc.exe",
}

# ブラウザで除外するドメイン（部分一致）
_EXCLUDED_DOMAINS: list[str] = [
    # メール
    "mail.google.com", "outlook.live.com", "outlook.office.com", "mail.yahoo",
    # チャット・メッセージ
    "slack.com", "discord.com", "teams.microsoft.com", "web.whatsapp.com",
    "messenger.com", "telegram.org", "line.me",
    # SNS DM（メインページではなくDMパス）
    "twitter.com/messages", "x.com/messages",
    # 銀行・決済
    "banking", "netbank", "online-bank", "pay.google.com",
    "paypal.com", "stripe.com",
    # パスワード・認証
    "vault.bitwarden.com", "my.1password.com",
    "accounts.google.com", "login.microsoftonline.com",
    "auth0.com", "okta.com",
]

# ブラウザのドメイン丸ごと除外（完全一致）
_EXCLUDED_DOMAIN_EXACT: set[str] = set()


@dataclass
class ActiveWindowInfo:
    """アクティブウィンドウの情報"""
    app_name: str = ""          # プロセス名 (例: "chrome.exe")
    window_title: str = ""      # ウィンドウタイトル
    domain: str = ""            # ブラウザの場合のドメイン (タイトルから推定)
    is_browser: bool = False
    is_excluded: bool = False   # 解析対象外か
    exclude_reason: str = ""    # 除外理由


def get_active_window_info() -> ActiveWindowInfo:
    """現在のアクティブウィンドウの情報を取得する"""
    info = ActiveWindowInfo()

    try:
        hwnd = ctypes.windll.user32.GetForegroundWindow()
        if not hwnd:
            return info

        # ウィンドウタイトル
        length = ctypes.windll.user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buf = ctypes.create_unicode_buffer(length + 1)
            ctypes.windll.user32.GetWindowTextW(hwnd, buf, length + 1)
            info.window_title = buf.value

        # プロセス名
        pid = ctypes.wintypes.DWORD()
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value:
            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            h_proc = ctypes.windll.kernel32.OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value
            )
            if h_proc:
                try:
                    buf = ctypes.create_unicode_buffer(260)
                    size = ctypes.wintypes.DWORD(260)
                    if ctypes.windll.kernel32.QueryFullProcessImageNameW(
                        h_proc, 0, buf, ctypes.byref(size)
                    ):
                        full_path = buf.value
                        info.app_name = full_path.rsplit("\\", 1)[-1]
                finally:
                    ctypes.windll.kernel32.CloseHandle(h_proc)

        # ブラウザ判定
        info.is_browser = info.app_name.lower() in _BROWSER_PROCESSES

        # ブラウザの場合、タイトルからドメインを推定
        if info.is_browser:
            info.domain = _extract_domain_from_title(info.window_title)

        # 除外判定
        _check_exclusion(info)

    except Exception:
        logger.exception("アクティブウィンドウ情報の取得に失敗")

    return info


def _extract_domain_from_title(title: str) -> str:
    """ブラウザのタイトルからドメインを推定する。

    多くのブラウザは「ページタイトル - ブラウザ名」の形式。
    ドメインがタイトルに含まれることが多い。
    """
    # 「- Google Chrome」「- Microsoft Edge」等のサフィックスを除去
    cleaned = re.sub(
        r"\s*[-–—]\s*(Google Chrome|Microsoft Edge|Firefox|Brave|Opera|Vivaldi|Arc).*$",
        "", title, flags=re.IGNORECASE,
    )

    # URLっぽい部分を探す
    url_match = re.search(r"https?://([^/\s]+)", cleaned)
    if url_match:
        return url_match.group(1)

    # タイトル末尾にドメインが含まれるパターン (「ページ名 - example.com」)
    domain_match = re.search(r"[-–—]\s*([a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,})\s*$", cleaned)
    if domain_match:
        return domain_match.group(1)

    return ""


def _check_exclusion(info: ActiveWindowInfo) -> None:
    """解析対象外かどうかを判定する"""

    # アプリ名での除外
    for pattern in _EXCLUDED_APP_PATTERNS:
        if pattern.search(info.app_name):
            info.is_excluded = True
            info.exclude_reason = f"除外アプリ: {info.app_name}"
            return

    # タイトルでの除外
    for pattern in _EXCLUDED_TITLE_PATTERNS:
        if pattern.search(info.window_title):
            info.is_excluded = True
            info.exclude_reason = f"除外タイトル: {pattern.pattern}"
            return

    # ブラウザのドメインでの除外
    if info.is_browser and info.domain:
        domain_lower = info.domain.lower()
        for excluded in _EXCLUDED_DOMAINS:
            if excluded in domain_lower or domain_lower in excluded:
                info.is_excluded = True
                info.exclude_reason = f"除外ドメイン: {excluded}"
                return
        if domain_lower in _EXCLUDED_DOMAIN_EXACT:
            info.is_excluded = True
            info.exclude_reason = f"除外ドメイン(完全一致): {domain_lower}"
            return


def capture_screenshot() -> bytes | None:
    """デスクトップ全体のスクリーンショットをPNGバイト列として取得する。

    Returns:
        PNG画像のバイト列。失敗時はNone。
    """
    try:
        img = ImageGrab.grab()
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()
    except Exception:
        logger.exception("スクリーンショットの取得に失敗")
        return None
