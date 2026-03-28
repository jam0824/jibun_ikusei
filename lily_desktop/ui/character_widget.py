from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QLabel


class CharacterWidget(QLabel):
    """キャラクター画像を表示するウィジェット"""

    def __init__(self, image_path: Path, scale: float, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.setStyleSheet("background: transparent;")
        self._scale = scale
        self._current_path: Path | None = None
        self.set_image(image_path)

    def set_image(self, image_path: Path) -> None:
        if not image_path.exists():
            return
        self._current_path = image_path
        pixmap = QPixmap(str(image_path))
        scaled = pixmap.scaled(
            int(pixmap.width() * self._scale),
            int(pixmap.height() * self._scale),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        self.setPixmap(scaled)
        self.setFixedSize(scaled.size())
