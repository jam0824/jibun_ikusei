"""UserBalloonWidget のユニットテスト"""

import os

import pytest
from PySide6.QtGui import QColor

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtWidgets import QApplication

from core.config import DEFAULT_USER_BALLOON_DISPLAY_SECONDS
from ui.user_balloon_widget import UserBalloonWidget


@pytest.fixture(scope="session")
def qapp():
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def test_show_message_設定秒数でタイマーを開始する(qapp):
    widget = UserBalloonWidget(display_seconds=10)

    widget.show_message("こんにちは")

    assert widget._hide_timer.interval() == 10_000
    widget.close()


@pytest.mark.parametrize("display_seconds", ["abc", 0, -3, None])
def test_show_message_不正な秒数は既定値にフォールバックする(qapp, display_seconds):
    widget = UserBalloonWidget(display_seconds=display_seconds)

    widget.show_message("こんにちは")

    assert (
        widget._hide_timer.interval()
        == round(DEFAULT_USER_BALLOON_DISPLAY_SECONDS * 1000)
    )
    widget.close()


def test_show_message_system_variant_uses_distinct_blue_background(qapp):
    widget = UserBalloonWidget()

    widget.show_message("システム通知です", variant="system")

    assert widget._variant == "system"
    assert widget._background_color == QColor(14, 116, 144, 210)
    widget.close()
