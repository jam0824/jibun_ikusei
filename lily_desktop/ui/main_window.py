from __future__ import annotations

from PySide6.QtCore import QPoint, Qt
from PySide6.QtGui import QAction
from PySide6.QtWidgets import QApplication, QHBoxLayout, QMenu, QVBoxLayout, QWidget

from core.config import AppConfig, save_window_position
from core.constants import HARUKA_DEFAULT_IMAGE, LILY_DEFAULT_IMAGE
from core.event_bus import bus
from ui.balloon_widget import BalloonWidget
from ui.character_widget import CharacterWidget
from ui.input_widget import InputWidget
from ui.mic_button import MicButton
from ui.user_balloon_widget import UserBalloonWidget

# ドラッグ判定の閾値（ピクセル）— これ以上動いたらドラッグとみなす
_DRAG_THRESHOLD = 5


class MainWindow(QWidget):
    """透過フレームレスウィンドウ — デスクトップにキャラクターを表示"""

    def __init__(self, config: AppConfig):
        super().__init__()
        self._config = config
        self._drag_start: QPoint | None = None
        self._drag_offset: QPoint | None = None
        self._is_dragging = False
        self._anchor_bottom: int | None = None  # ウィンドウ下端のY座標（基準点）

        # ウィンドウ設定: フレームレス、最前面、透過、タスクバー非表示
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint
            | Qt.WindowType.WindowStaysOnTopHint
            | Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)

        self._init_ui()
        self._connect_signals()
        self._restore_position()
        self.input_widget.raise_()

    def _init_ui(self) -> None:
        root_layout = QVBoxLayout(self)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(4)

        # 吹き出し
        self.balloon = BalloonWidget()
        self._root_layout = root_layout
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
        # ユーザー発言の吹き出し（入力ボックスの上に表示）
        self.user_balloon = UserBalloonWidget(self)
        # マイクON/OFFボタン（キャラクター付近に常時表示）
        self.mic_button = MicButton(self)

    def _connect_signals(self) -> None:
        bus.balloon_show.connect(self._on_balloon_show)
        bus.balloon_hide.connect(self._on_balloon_hide)
        bus.user_message_received.connect(self._on_user_message)

    def _on_balloon_show(self, speaker: str, text: str) -> None:
        # 話者に応じて吹き出し位置を切り替え
        if speaker in ("葉留佳", "はるちん", "はるか"):
            self._root_layout.setAlignment(
                self.balloon, Qt.AlignmentFlag.AlignLeft
            )
        else:
            self._root_layout.setAlignment(
                self.balloon, Qt.AlignmentFlag.AlignRight
            )
        self.balloon.show_message(speaker, text)
        self.adjustSize()

    def _on_balloon_hide(self) -> None:
        self.balloon.hide()
        self.adjustSize()

    def _on_user_message(self, text: str) -> None:
        # ユーザー発言を吹き出しに表示
        self.user_balloon.show_message(text)
        self._position_user_balloon()

    # --- ウィンドウ位置の保存・復元 ---

    def _restore_position(self) -> None:
        """保存済み位置があればそこに、なければ画面右下に配置する。

        window_y はウィンドウ下端のY座標として保存されている。
        """
        self.adjustSize()
        dc = self._config.display
        if dc.window_x is not None and dc.window_y is not None:
            self._anchor_bottom = dc.window_y
            self.move(dc.window_x, self._anchor_bottom - self.height())
        else:
            self._position_default()

    def _position_default(self) -> None:
        """デフォルト位置: プライマリスクリーンの右下。"""
        screen = QApplication.primaryScreen()
        if screen is None:
            return
        geo = screen.availableGeometry()
        self.adjustSize()
        x = geo.right() - self.width()
        self._anchor_bottom = geo.bottom()
        self.move(x, self._anchor_bottom - self.height())

    def _save_position(self) -> None:
        """現在のウィンドウ位置を config.yaml に保存する。

        window_y にはウィンドウ下端のY座標を保存する。
        """
        self._anchor_bottom = self.y() + self.height()
        save_window_position(self.x(), self._anchor_bottom)

    # --- ドラッグ移動 ---

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_start = event.globalPosition().toPoint()
            self._drag_offset = self._drag_start - self.pos()
            self._is_dragging = False
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event) -> None:
        if self._drag_start is not None and event.buttons() & Qt.MouseButton.LeftButton:
            current = event.globalPosition().toPoint()
            delta = current - self._drag_start
            if not self._is_dragging and (abs(delta.x()) > _DRAG_THRESHOLD or abs(delta.y()) > _DRAG_THRESHOLD):
                self._is_dragging = True
            if self._is_dragging and self._drag_offset is not None:
                self.move(current - self._drag_offset)
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            if self._is_dragging:
                # ドラッグ終了 → 位置を保存
                self._save_position()
            else:
                # クリック → 入力バートグル
                self.input_widget.toggle()
            self._drag_start = None
            self._drag_offset = None
            self._is_dragging = False
        super().mouseReleaseEvent(event)

    # --- レイアウト ---

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        # ボトム基準: 高さが変わったらY位置を調整して下端を固定
        if self._anchor_bottom is not None and not self._is_dragging:
            new_y = self._anchor_bottom - self.height()
            if self.y() != new_y:
                self.move(self.x(), new_y)
        self._position_input_widget()
        self._position_mic_button()

    def _position_mic_button(self) -> None:
        """マイクボタンをウィンドウ右下（キャラクターの足元付近）に配置"""
        btn = self.mic_button
        x = self.width() - btn.width() - 4
        y = self.height() - btn.height() - 4
        btn.move(x, y)
        btn.raise_()

    def _position_input_widget(self) -> None:
        """入力ウィジェットをマイクボタンの上にオーバーレイ配置"""
        iw = self.input_widget
        btn = self.mic_button
        x = self.width() - iw.width()
        y = self.height() - iw.sizeHint().height() - btn.height() - 12
        iw.move(x, y)
        self._position_user_balloon()

    def _position_user_balloon(self) -> None:
        """ユーザー吹き出しを入力ウィジェットの上に配置"""
        ub = self.user_balloon
        iw = self.input_widget
        x = self.width() - ub.width()
        y = iw.y() - ub.height() - 4
        ub.move(x, y)

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

        auto_talk_action = QAction("掛け合い雑談を開始", self)
        auto_talk_action.triggered.connect(
            lambda: bus.auto_talk_requested.emit()
        )
        debug_menu.addAction(auto_talk_action)

        camera_action = QAction("カメラ状況を取得", self)
        camera_action.triggered.connect(
            lambda: bus.camera_capture_requested.emit()
        )
        debug_menu.addAction(camera_action)

        menu.addSeparator()

        hide_action = QAction("非表示", self)
        hide_action.triggered.connect(self.hide)
        menu.addAction(hide_action)

        quit_action = QAction("終了", self)
        quit_action.triggered.connect(QApplication.quit)
        menu.addAction(quit_action)

        menu.exec(event.globalPos())
