from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QHBoxLayout, QLineEdit, QPushButton, QWidget

from core.event_bus import bus


class InputWidget(QWidget):
    """最小限のテキスト入力バー"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setStyleSheet(
            "InputWidget { background: rgba(255, 255, 255, 200); border-radius: 8px; }"
        )

        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 4, 8, 4)

        self._input = QLineEdit()
        self._input.setPlaceholderText("メッセージを入力...")
        self._input.setFont(QFont("Yu Gothic UI", 11))
        self._input.setStyleSheet(
            "QLineEdit { border: 1px solid #ccc; border-radius: 4px; padding: 4px 8px; "
            "background: white; }"
        )
        self._input.returnPressed.connect(self._send)
        layout.addWidget(self._input)

        send_btn = QPushButton("送信")
        send_btn.setFont(QFont("Yu Gothic UI", 10))
        send_btn.setStyleSheet(
            "QPushButton { background: #7c3aed; color: white; border: none; "
            "border-radius: 4px; padding: 4px 12px; }"
            "QPushButton:hover { background: #6d28d9; }"
        )
        send_btn.clicked.connect(self._send)
        layout.addWidget(send_btn)

        self.setFixedWidth(360)

    def toggle(self) -> None:
        if self.isVisible():
            self.hide()
        else:
            self.show()
            self._input.setFocus()

    def _send(self) -> None:
        text = self._input.text().strip()
        if not text:
            return
        self._input.clear()
        bus.user_message_received.emit(text)

    def keyPressEvent(self, event) -> None:
        if event.key() == Qt.Key.Key_Escape:
            self.hide()
        else:
            super().keyPressEvent(event)
