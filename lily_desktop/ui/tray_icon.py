from __future__ import annotations

from PySide6.QtGui import QAction, QIcon
from PySide6.QtWidgets import QApplication, QMenu, QSystemTrayIcon, QWidget

from core.constants import LILY_DEFAULT_IMAGE


class TrayIcon(QSystemTrayIcon):
    """システムトレイアイコン — 表示/非表示/終了"""

    def __init__(self, main_window: QWidget, parent=None):
        icon = QIcon(str(LILY_DEFAULT_IMAGE))
        super().__init__(icon, parent)
        self._main_window = main_window

        menu = QMenu()

        self._toggle_action = QAction("非表示", menu)
        self._toggle_action.triggered.connect(self._toggle_visibility)
        menu.addAction(self._toggle_action)

        menu.addSeparator()

        quit_action = QAction("終了", menu)
        quit_action.triggered.connect(QApplication.quit)
        menu.addAction(quit_action)

        self.setContextMenu(menu)
        self.activated.connect(self._on_activated)
        self.setToolTip("リリィデスクトップ")

    def _toggle_visibility(self) -> None:
        if self._main_window.isVisible():
            self._main_window.hide()
            self._toggle_action.setText("表示")
        else:
            self._main_window.show()
            self._toggle_action.setText("非表示")

    def _on_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self._toggle_visibility()
