"""マイクON/OFFトグルボタン — キャラクターの近くに常時表示"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QFont
from PySide6.QtWidgets import QPushButton

from core.event_bus import bus

_STYLE_ON = (
    "QPushButton { background: rgba(124, 58, 237, 200); color: white; border: none; "
    "border-radius: 12px; padding: 4px 10px; }"
    "QPushButton:hover { background: rgba(109, 40, 217, 220); }"
)

_STYLE_OFF = (
    "QPushButton { background: rgba(180, 180, 180, 200); color: white; border: none; "
    "border-radius: 12px; padding: 4px 10px; }"
    "QPushButton:hover { background: rgba(150, 150, 150, 220); }"
)


class MicButton(QPushButton):
    """マイクのON/OFFを切り替える小さなフローティングボタン"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._is_on = False
        self.setFont(QFont("Yu Gothic UI", 9))
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setFixedHeight(24)
        self._update_appearance()

        self.clicked.connect(lambda: bus.voice_toggle_requested.emit())
        bus.voice_state_changed.connect(self._on_state_changed)

    def _on_state_changed(self, is_running: bool) -> None:
        self._is_on = is_running
        self._update_appearance()

    def _update_appearance(self) -> None:
        if self._is_on:
            self.setText("🎤 ON")
            self.setStyleSheet(_STYLE_ON)
        else:
            self.setText("🎤 OFF")
            self.setStyleSheet(_STYLE_OFF)
        self.adjustSize()
