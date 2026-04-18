from __future__ import annotations

from PySide6.QtCore import QUrl
from PySide6.QtWidgets import QApplication

import pytest

from ui.web_links import WEB_LINK_ITEMS, build_web_url, open_web_path


@pytest.fixture
def qapp():
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def test_build_web_url_joins_hash_base_and_path():
    url = build_web_url("http://127.0.0.1:5173/#", "/records/activity/today")

    assert url == "http://127.0.0.1:5173/#/records/activity/today"


def test_build_web_url_appends_hash_when_missing():
    url = build_web_url("http://127.0.0.1:5173", "/settings")

    assert url == "http://127.0.0.1:5173/#/settings"


def test_open_web_path_uses_expected_url(monkeypatch, qapp):
    captured: list[QUrl] = []

    def _fake_open_url(url: QUrl) -> bool:
        captured.append(url)
        return True

    monkeypatch.setattr("ui.web_links.QDesktopServices.openUrl", _fake_open_url)

    assert open_web_path("http://127.0.0.1:5173/#", "/records/activity/search") is True
    assert captured[0].toString() == "http://127.0.0.1:5173/#/records/activity/search"


def test_web_link_items_include_activity_routes():
    labels = [item.label for item in WEB_LINK_ITEMS]
    paths = [item.path for item in WEB_LINK_ITEMS]

    assert "今日の行動ログ" in labels
    assert "行動ログカレンダー" in labels
    assert "行動ログ検索" in labels
    assert "週次行動レビュー" in labels
    assert "/records/activity/today" in paths
    assert "/records/activity/calendar" in paths
    assert "/records/activity/search" in paths
    assert "/records/activity/review/year" in paths
