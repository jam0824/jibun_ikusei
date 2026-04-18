from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtCore import QUrl
from PySide6.QtGui import QDesktopServices

from core.config import normalize_web_base_url


@dataclass(frozen=True)
class WebLinkItem:
    label: str
    path: str


WEB_LINK_ITEMS: list[WebLinkItem] = [
    WebLinkItem(label="ホーム", path="/"),
    WebLinkItem(label="今日の成長記録", path="/records/quests?range=today"),
    WebLinkItem(label="今日の行動ログ", path="/records/activity/today"),
    WebLinkItem(label="行動ログカレンダー", path="/records/activity/calendar"),
    WebLinkItem(label="行動ログ検索", path="/records/activity/search"),
    WebLinkItem(label="週次行動レビュー", path="/records/activity/review/year"),
    WebLinkItem(label="週次ふりかえり", path="/weekly-reflection"),
    WebLinkItem(label="リリィチャット", path="/lily"),
    WebLinkItem(label="設定", path="/settings"),
]


def build_web_url(base_url: str, path: str) -> str:
    normalized_base_url = normalize_web_base_url(base_url)
    normalized_path = path if path.startswith("/") else f"/{path}"
    if normalized_base_url.endswith("/#") or normalized_base_url.endswith("#"):
        return f"{normalized_base_url}{normalized_path}"
    return f"{normalized_base_url}/#{normalized_path}"


def open_web_path(base_url: str, path: str) -> bool:
    return QDesktopServices.openUrl(QUrl(build_web_url(base_url, path)))
