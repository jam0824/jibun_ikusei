from __future__ import annotations

from PySide6.QtGui import QAction, QIcon
from PySide6.QtWidgets import QApplication, QMenu, QSystemTrayIcon, QWidget

from core.constants import LILY_DEFAULT_IMAGE
from core.event_bus import bus


class TrayIcon(QSystemTrayIcon):
    """システムトレイアイコン — 表示/非表示/音声入力/終了"""

    def __init__(self, main_window: QWidget, parent=None):
        icon = QIcon(str(LILY_DEFAULT_IMAGE))
        super().__init__(icon, parent)
        self._main_window = main_window

        menu = QMenu()

        self._toggle_action = QAction("非表示", menu)
        self._toggle_action.triggered.connect(self._toggle_visibility)
        menu.addAction(self._toggle_action)

        self._voice_action = QAction("音声入力: OFF", menu)
        self._voice_action.triggered.connect(self._toggle_voice)
        menu.addAction(self._voice_action)

        # マイク選択サブメニュー
        self._mic_menu = QMenu("マイク選択", menu)
        menu.addMenu(self._mic_menu)
        self._mic_menu.aboutToShow.connect(self._populate_mic_menu)

        self._tts_action = QAction("読み上げ: OFF", menu)
        self._tts_action.triggered.connect(self._toggle_tts)
        menu.addAction(self._tts_action)

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

    def _toggle_voice(self) -> None:
        bus.voice_toggle_requested.emit()
        if self._voice_action.text() == "音声入力: OFF":
            self._voice_action.setText("音声入力: ON")
        else:
            self._voice_action.setText("音声入力: OFF")

    def _populate_mic_menu(self) -> None:
        """マイク選択サブメニューを開く時にデバイス一覧を更新する"""
        from voice.audio_capture import list_input_devices

        self._mic_menu.clear()
        devices = list_input_devices()

        if not devices:
            no_device = QAction("マイクが見つかりません", self._mic_menu)
            no_device.setEnabled(False)
            self._mic_menu.addAction(no_device)
            return

        for dev in devices:
            action = QAction(dev["name"], self._mic_menu)
            device_index = dev["index"]
            device_name = dev["name"]
            action.triggered.connect(
                lambda checked, idx=device_index, name=device_name: self._select_mic(idx, name)
            )
            self._mic_menu.addAction(action)

    def _select_mic(self, device_index: int, device_name: str) -> None:
        """マイクを選択してシグナルを発火する"""
        bus.voice_device_selected.emit(device_index, device_name)

    def _toggle_tts(self) -> None:
        bus.tts_toggle_requested.emit()
        if self._tts_action.text() == "読み上げ: OFF":
            self._tts_action.setText("読み上げ: ON")
        else:
            self._tts_action.setText("読み上げ: OFF")

    def _on_activated(self, reason: QSystemTrayIcon.ActivationReason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self._toggle_visibility()
