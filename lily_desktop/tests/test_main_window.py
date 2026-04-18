from __future__ import annotations

from types import SimpleNamespace

from PySide6.QtWidgets import QApplication

import pytest

from ui.main_window import MainWindow


@pytest.fixture
def qapp():
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def _make_config():
    return SimpleNamespace(
        display=SimpleNamespace(
            lily_scale=0.3,
            haruka_scale=0.7,
            user_balloon_display_seconds=8.0,
            window_x=None,
            window_y=None,
        ),
        web=SimpleNamespace(base_url="http://127.0.0.1:5173/#"),
    )


def test_build_context_menu_includes_web_submenu(qapp):
    window = MainWindow(_make_config())

    menu = window.build_context_menu()
    actions = menu.actions()
    web_action = next(action for action in actions if action.text() == "Web を開く")
    web_menu = web_action.menu()

    assert web_menu is not None
    labels = [action.text() for action in web_menu.actions()]
    assert "ホーム" in labels
    assert "今日の行動ログ" in labels
    assert "行動ログカレンダー" in labels
    assert "行動ログ検索" in labels
    assert "週次行動レビュー" in labels


def test_build_context_menu_replaces_debug_capture_actions(qapp):
    window = MainWindow(_make_config())

    menu = window.build_context_menu()
    actions = menu.actions()
    debug_action = next(action for action in actions if action.text() == "デバッグ")
    debug_menu = debug_action.menu()

    assert debug_menu is not None
    labels = [action.text() for action in debug_menu.actions()]
    assert "5分記録を実行" in labels
    assert "30分記録を実行" in labels
    assert "デスクトップ状況を取得" not in labels
    assert "カメラ状況を取得" not in labels
