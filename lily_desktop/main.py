"""リリィデスクトップ — エントリポイント"""

import asyncio
import logging
import sys

import qasync
from PySide6.QtWidgets import QApplication

from ai.chat_engine import ChatEngine
from ai.tool_definitions import CHAT_TOOLS
from ai.tool_executor import ToolExecutor
from api.api_client import ApiClient
from api.auth import CognitoAuth
from core.config import load_config
from core.event_bus import bus
from data.session_manager import SessionManager
from pose.pose_manager import PoseManager
from ui.main_window import MainWindow
from ui.tray_icon import TrayIcon

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


class App:
    """アプリケーション全体の初期化と配線"""

    def __init__(self):
        self.config = load_config()
        self.auth = CognitoAuth(
            self.config.cognito.email, self.config.cognito.password
        )
        self.api_client = ApiClient(self.auth)
        self.session_mgr = SessionManager(self.api_client)
        self.pose_mgr = PoseManager()
        self.tool_executor = ToolExecutor(self.api_client)
        self.chat_engine = ChatEngine(
            self.config, self.api_client, self.session_mgr
        )
        self.chat_engine.set_tools(CHAT_TOOLS, self.tool_executor.execute)

    def connect_signals(self, window: MainWindow) -> None:
        """イベントバスとUIの配線"""
        # ユーザーメッセージ → AI会話（Phase 2のエコー表示を上書き）
        bus.user_message_received.disconnect(window._on_user_message)
        bus.user_message_received.connect(self._on_user_message)

        # 新しい会話
        bus.new_chat_requested.connect(self._on_new_chat)

        # AI応答 → 吹き出し表示 + ポーズ変更
        bus.ai_response_ready.connect(self._on_ai_response)

    def _on_user_message(self, text: str) -> None:
        asyncio.ensure_future(self.chat_engine.handle_user_message(text))

    def _on_new_chat(self) -> None:
        asyncio.ensure_future(self._create_new_chat())

    async def _create_new_chat(self) -> None:
        await self.session_mgr.create_new_session()
        self.chat_engine._history.clear()
        bus.balloon_show.emit("リリィ", "新しい会話を始めるね！")

    def _on_ai_response(self, speaker: str, text: str, pose_hint: str) -> None:
        bus.balloon_show.emit(speaker, text)
        # ポーズ変更
        if speaker == "リリィ":
            path = self.pose_mgr.select_lily_pose(pose_hint)
            bus.pose_change.emit("lily", str(path))
        elif speaker in ("葉留佳", "はるちん", "はるか"):
            path = self.pose_mgr.select_haruka_pose(pose_hint)
            bus.pose_change.emit("haruka", str(path))


async def async_init(app_instance: App) -> None:
    """非同期初期化（認証、セッション読み込み）"""
    if app_instance.auth.is_configured:
        try:
            await app_instance.auth.get_id_token()
            logger.info("Cognito認証成功")
            await app_instance.session_mgr.load_latest_session()
            await app_instance.chat_engine.load_session_history()
        except Exception:
            logger.exception("初期化中にエラー（認証またはセッション読み込み失敗）")
    else:
        logger.warning("Cognito認証情報が未設定です。config.yamlを確認してください。")


def main() -> None:
    qt_app = QApplication(sys.argv)
    qt_app.setQuitOnLastWindowClosed(False)

    loop = qasync.QEventLoop(qt_app)
    asyncio.set_event_loop(loop)

    app_instance = App()

    window = MainWindow(app_instance.config)

    # ポーズ変更シグナルとキャラクター画像の接続
    def on_pose_change(character: str, path: str):
        from pathlib import Path

        p = Path(path)
        if character == "lily":
            window.lily_widget.set_image(p)
        elif character == "haruka":
            window.haruka_widget.set_image(p)

    bus.pose_change.connect(on_pose_change)

    app_instance.connect_signals(window)

    window.show()

    tray = TrayIcon(window)
    tray.show()

    # 非同期初期化を開始
    asyncio.ensure_future(async_init(app_instance))

    with loop:
        loop.run_forever()


if __name__ == "__main__":
    main()
