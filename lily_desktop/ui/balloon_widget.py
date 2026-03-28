from __future__ import annotations

from collections import deque

from PySide6.QtCore import QRect, Qt, QTimer
from PySide6.QtGui import QColor, QFont, QFontMetrics, QPainter, QPixmap
from PySide6.QtWidgets import QWidget

from core.constants import BALLOON_DISPLAY_SECONDS, MESSAGE_WINDOW_IMAGE


class BalloonWidget(QWidget):
    """message_window.png を背景に使った吹き出しウィジェット"""

    _PADDING_X = 30
    _PADDING_Y = 16
    _MIN_WIDTH = 320
    _MAX_WIDTH = 480

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setStyleSheet("background: transparent;")

        self._bg_pixmap = QPixmap(str(MESSAGE_WINDOW_IMAGE))
        self._speaker = ""
        self._text = ""
        self._queue: deque[tuple[str, str]] = deque()

        self._font = QFont("Yu Gothic UI", 11)
        self._font.setStyleStrategy(QFont.StyleStrategy.PreferAntialias)
        self._name_font = QFont("Yu Gothic UI", 11, QFont.Weight.Bold)

        self._hide_timer = QTimer(self)
        self._hide_timer.setSingleShot(True)
        self._hide_timer.timeout.connect(self._on_timer)

        self.hide()

    def show_message(self, speaker: str, text: str) -> None:
        if self.isVisible() and self._queue:
            # キュー内のメッセージがあれば追加
            self._queue.append((speaker, text))
            return
        if self.isVisible():
            # 表示中 → 次のメッセージとしてキューに入れて即切り替え
            self._queue.append((speaker, text))
            self._advance_queue()
            return
        self._display(speaker, text)

    def _display(self, speaker: str, text: str) -> None:
        self._hide_timer.stop()
        self._speaker = speaker
        self._text = text
        self._update_size()
        self.show()
        self.update()

        # 文字数に応じた表示時間後に次のメッセージへ切り替え or 非表示
        char_count = len(text)
        duration = max(BALLOON_DISPLAY_SECONDS * 1000, char_count * 200)
        self._hide_timer.start(int(duration))

    def _advance_queue(self) -> None:
        if self._queue:
            speaker, text = self._queue.popleft()
            self._display(speaker, text)

    def _on_timer(self) -> None:
        if self._queue:
            self._advance_queue()
        else:
            self.hide()

    def _update_size(self) -> None:
        fm = QFontMetrics(self._font)
        display_text = f"「{self._text}」"
        text_rect = fm.boundingRect(
            QRect(0, 0, self._MAX_WIDTH - self._PADDING_X * 2, 0),
            Qt.TextFlag.TextWordWrap,
            display_text,
        )
        name_height = QFontMetrics(self._name_font).height()
        content_w = max(self._MIN_WIDTH, text_rect.width() + self._PADDING_X * 2)
        content_h = name_height + 4 + text_rect.height() + self._PADDING_Y * 2
        self.setFixedSize(content_w, content_h)

    def hideEvent(self, event) -> None:
        """非表示時に親ウィンドウのサイズを再調整する"""
        super().hideEvent(event)
        parent = self.parentWidget()
        if parent is not None:
            parent.adjustSize()

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)

        # 背景画像を伸縮描画
        painter.drawPixmap(self.rect(), self._bg_pixmap)

        # 話者名
        painter.setFont(self._name_font)
        painter.setPen(QColor(255, 255, 255))
        name_text = f"【{self._speaker}】"
        name_fm = QFontMetrics(self._name_font)
        name_y = self._PADDING_Y + name_fm.ascent()
        painter.drawText(self._PADDING_X, name_y, name_text)

        # セリフ
        painter.setFont(self._font)
        painter.setPen(QColor(255, 255, 255))
        text_top = self._PADDING_Y + name_fm.height() + 4
        text_rect = QRect(
            self._PADDING_X,
            text_top,
            self.width() - self._PADDING_X * 2,
            self.height() - text_top - self._PADDING_Y,
        )
        painter.drawText(text_rect, Qt.TextFlag.TextWordWrap, f"「{self._text}」")

        painter.end()
