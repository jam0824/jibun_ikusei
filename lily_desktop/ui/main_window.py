from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction
from PySide6.QtWidgets import QApplication, QHBoxLayout, QMenu, QVBoxLayout, QWidget

from core.config import AppConfig
from core.constants import HARUKA_DEFAULT_IMAGE, LILY_DEFAULT_IMAGE
from core.event_bus import bus
from ui.balloon_widget import BalloonWidget
from ui.character_widget import CharacterWidget
from ui.input_widget import InputWidget


class MainWindow(QWidget):
    """透過フレームレスウィンドウ — デスクトップ右下にキャラクターを表示"""

    def __init__(self, config: AppConfig):
        super().__init__()
        self._config = config

        # ウィンドウ設定: フレームレス、最前面、透過、タスクバー非表示
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)

        self._init_ui()
        self._connect_signals()
        self._position_bottom_right()
        self.input_widget.raise_()

    def _init_ui(self) -> None:
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(4)

        # 吹き出し
        self.balloon = BalloonWidget()
        root_layout.addWidget(self.balloon, alignment=Qt.AlignmentFlag.AlignRight)

        # キャラクター行
        char_row = QWidget()
        char_row.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        char_row.setStyleSheet("background: transparent;")
        char_layout = QHBoxLayout(char_row)
        char_layout.setContentsMargins(0, 0, 0, 0)
        char_layout.setSpacing(0)

        # 葉留佳（左）
        self.haruka_widget = CharacterWidget(
            HARUKA_DEFAULT_IMAGE, self._config.display.haruka_scale
        )
        char_layout.addWidget(
            self.haruka_widget, alignment=Qt.AlignmentFlag.AlignBottom
        )

        # リリィ（右）
        self.lily_widget = CharacterWidget(
            LILY_DEFAULT_IMAGE, self._config.display.lily_scale
        )
        char_layout.addWidget(
            self.lily_widget, alignment=Qt.AlignmentFlag.AlignBottom
        )

        root_layout.addWidget(char_row)

        # テキスト入力（レイアウト外でキャラクターに重ねて表示）
        self.input_widget = InputWidget(self)

    def _connect_signals(self) -> None:
        bus.balloon_show.connect(self._on_balloon_show)
        bus.balloon_hide.connect(self.balloon.hide)
        # ユーザーメッセージ送信時のエコー表示（Phase 3でAI応答に置き換え）
        bus.user_message_received.connect(self._on_user_message)

    def _on_balloon_show(self, speaker: str, text: str) -> None:
        self.balloon.show_message(speaker, text)
        self._position_bottom_right()

    def _on_user_message(self, text: str) -> None:
        # フォールバック: AI未接続時のみ使われる（main.pyのAppで上書きされる）
        pass

    def _position_bottom_right(self) -> None:
        screen = QApplication.primaryScreen()
        if screen is None:
            return
        geo = screen.availableGeometry()
        self.adjustSize()
        x = geo.right() - self.width()
        y = geo.bottom() - self.height()
        self.move(x, y)

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._position_input_widget()

    def _position_input_widget(self) -> None:
        """入力ウィジェットをウィンドウ右下にオーバーレイ配置"""
        iw = self.input_widget
        x = self.width() - iw.width()
        y = self.height() - iw.sizeHint().height() - 8
        iw.move(x, y)

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self.input_widget.toggle()
        super().mousePressEvent(event)

    def contextMenuEvent(self, event) -> None:
        menu = QMenu(self)
        menu.setStyleSheet(
            "QMenu { background: white; border: 1px solid #ccc; border-radius: 4px; padding: 4px; }"
            "QMenu::item { padding: 4px 20px; }"
            "QMenu::item:selected { background: #7c3aed; color: white; }"
        )

        new_chat = QAction("新しい会話", self)
        new_chat.triggered.connect(lambda: bus.new_chat_requested.emit())
        menu.addAction(new_chat)

        toggle_input = QAction("入力バーを表示", self)
        toggle_input.triggered.connect(self.input_widget.toggle)
        menu.addAction(toggle_input)

        menu.addSeparator()

        # デバッグメニュー
        debug_menu = menu.addMenu("デバッグ")
        debug_menu.setStyleSheet(menu.styleSheet())

        desktop_ctx_action = QAction("デスクトップ状況を取得", self)
        desktop_ctx_action.triggered.connect(
            lambda: bus.desktop_context_requested.emit()
        )
        debug_menu.addAction(desktop_ctx_action)

        menu.addSeparator()

        hide_action = QAction("非表示", self)
        hide_action.triggered.connect(self.hide)
        menu.addAction(hide_action)

        quit_action = QAction("終了", self)
        quit_action.triggered.connect(QApplication.quit)
        menu.addAction(quit_action)

        menu.exec(event.globalPos())
