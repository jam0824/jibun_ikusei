"""ユーザー発言の吹き出し — 入力ボックスの上に表示し、5秒後に消える"""

from __future__ import annotations

from PySide6.QtCore import QRect, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QFontMetrics, QPainter, QPainterPath
from PySide6.QtWidgets import QWidget

_DISPLAY_MS = 5000
_PADDING_X = 16
_PADDING_Y = 10
_MAX_WIDTH = 360
_BORDER_RADIUS = 12


class UserBalloonWidget(QWidget):
    """ユーザーの発言を吹き出しで表示するウィジェット"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setStyleSheet("background: transparent;")

        self._text = ""
        self._font = QFont("Yu Gothic UI", 11)
        self._font.setStyleStrategy(QFont.StyleStrategy.PreferAntialias)

        self._hide_timer = QTimer(self)
        self._hide_timer.setSingleShot(True)
        self._hide_timer.timeout.connect(self.hide)

        self.hide()

    def show_message(self, text: str) -> None:
        """テキストを表示して5秒後に自動で隠す。"""
        self._hide_timer.stop()
        self._text = text
        self._update_size()
        self.show()
        self.update()
        self._hide_timer.start(_DISPLAY_MS)

    def _update_size(self) -> None:
        fm = QFontMetrics(self._font)
        text_rect = fm.boundingRect(
            QRect(0, 0, _MAX_WIDTH - _PADDING_X * 2, 0),
            Qt.TextFlag.TextWordWrap,
            self._text,
        )
        w = min(_MAX_WIDTH, text_rect.width() + _PADDING_X * 2)
        h = text_rect.height() + _PADDING_Y * 2
        self.setFixedSize(w, h)

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        # 背景（角丸の半透明パープル）
        path = QPainterPath()
        path.addRoundedRect(0.0, 0.0, self.width(), self.height(), _BORDER_RADIUS, _BORDER_RADIUS)
        painter.fillPath(path, QColor(124, 58, 237, 210))  # #7c3aed, 少し透過

        # テキスト
        painter.setFont(self._font)
        painter.setPen(QColor(255, 255, 255))
        text_rect = QRect(
            _PADDING_X,
            _PADDING_Y,
            self.width() - _PADDING_X * 2,
            self.height() - _PADDING_Y * 2,
        )
        painter.drawText(text_rect, Qt.TextFlag.TextWordWrap, self._text)
        painter.end()
