"""リリィデスクトップ — エントリポイント"""

import asyncio
import logging
import sys

import qasync
from PySide6.QtWidgets import QApplication

from ai.auto_conversation import AutoConversation
from ai.chat_engine import ChatEngine
from ai.tool_definitions import CHAT_TOOLS
from ai.tool_executor import ToolExecutor
from api.api_client import ApiClient
from api.auth import CognitoAuth
from core.config import load_config, save_voice_device
from core.desktop_context import DesktopContext, fetch_desktop_context, format_context_log
from core.event_bus import bus
from data.session_manager import SessionManager
from pose.pose_generator import ensure_pose
from pose.pose_manager import PoseManager
from ui.main_window import MainWindow
from ui.tray_icon import TrayIcon
from voice.voice_pipeline import VoicePipeline

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
        self.auto_conversation = AutoConversation(self.config, self.session_mgr)
        self.voice_pipeline: VoicePipeline | None = None

    def connect_signals(self, window: MainWindow) -> None:
        """イベントバスとUIの配線"""
        # ユーザーメッセージ → AI会話（window側の吹き出し表示も残す）
        bus.user_message_received.connect(self._on_user_message)

        # 新しい会話
        bus.new_chat_requested.connect(self._on_new_chat)

        # AI応答 → 吹き出し表示 + ポーズ変更
        bus.ai_response_ready.connect(self._on_ai_response)

        # 音声入力
        bus.voice_toggle_requested.connect(self._on_voice_toggle)
        bus.voice_device_selected.connect(self._on_voice_device_selected)

        # デバッグ
        bus.desktop_context_requested.connect(self._on_desktop_context_requested)
        bus.auto_talk_requested.connect(self._on_auto_talk_requested)

    def _on_user_message(self, text: str) -> None:
        # 掛け合い中ならユーザー割り込みで中断
        if self.auto_conversation.is_talking:
            self.auto_conversation.interrupt()
        asyncio.ensure_future(self.chat_engine.handle_user_message(text))

    def _on_new_chat(self) -> None:
        asyncio.ensure_future(self._create_new_chat())

    async def _create_new_chat(self) -> None:
        await self.session_mgr.create_new_session()
        self.chat_engine._history.clear()
        bus.balloon_show.emit("リリィ", "新しい会話を始めるね！")

    def _on_voice_toggle(self) -> None:
        """音声入力のON/OFFを切り替える"""
        if self.voice_pipeline is None:
            self.voice_pipeline = VoicePipeline(
                config=self.config.voice,
                loop=asyncio.get_event_loop(),
            )

        if self.voice_pipeline.is_running:
            self.voice_pipeline.stop()
            bus.balloon_show.emit("リリィ", "音声入力をオフにしたよ")
        else:
            self.voice_pipeline.start()
            if self.voice_pipeline.is_running:
                bus.balloon_show.emit("リリィ", "音声入力をオンにしたよ！話しかけてね")

    def _on_voice_device_selected(self, device_index: int, device_name: str) -> None:
        """マイクデバイスを切り替えて設定を保存する"""
        if self.voice_pipeline is None:
            self.voice_pipeline = VoicePipeline(
                config=self.config.voice,
                loop=asyncio.get_event_loop(),
            )

        self.voice_pipeline.set_device(device_index, device_name)
        self.config.voice.device_name = device_name

        # config.yaml に保存
        save_voice_device(device_name)
        logger.info("マイクを選択・保存: %s", device_name)
        bus.balloon_show.emit("リリィ", f"マイクを「{device_name}」に切り替えたよ！")

    def _on_auto_talk_requested(self) -> None:
        self.auto_conversation.trigger_now()

    def _on_desktop_context_requested(self) -> None:
        asyncio.ensure_future(self._fetch_and_show_desktop_context())

    async def _fetch_and_show_desktop_context(self) -> None:
        """デスクトップ状況を取得してログ出力 + 吹き出しに表示（デバッグ用）"""
        bus.balloon_show.emit("リリィ", "画面の状況を確認中…")
        try:
            ctx = await fetch_desktop_context(
                api_key=self.config.openai.api_key,
                model=self.config.openai.screen_analysis_model,
            )
            self._last_desktop_context = ctx
            log_text = format_context_log(ctx)
            logger.info("\n%s", log_text)

            # 吹き出しにデバッグ結果を表示
            if ctx.skipped:
                bus.balloon_show.emit(
                    "リリィ",
                    f"[デバッグ] 解析対象外だよ\n{ctx.window_info.exclude_reason}",
                )
            elif ctx.error:
                bus.balloon_show.emit("リリィ", f"[デバッグ] エラー: {ctx.error}")
            elif ctx.analysis:
                bus.balloon_show.emit(
                    "リリィ",
                    f"[デバッグ] {ctx.analysis.summary}\n"
                    f"タグ: {', '.join(ctx.analysis.tags)}\n"
                    f"種別: {ctx.analysis.activity_type}\n"
                    f"詳細: {ctx.analysis.detail}",
                )
        except Exception:
            logger.exception("デスクトップ状況取得に失敗")
            bus.balloon_show.emit("リリィ", "[デバッグ] 状況取得に失敗しちゃった…")

    def _on_ai_response(self, speaker: str, text: str, pose_category: str) -> None:
        bus.balloon_show.emit(speaker, text)
        # ポーズ変更
        if speaker == "リリィ":
            path = self.pose_mgr.select_lily_pose(pose_category)
            bus.pose_change.emit("lily", str(path))
            # 不足ポーズの自動生成をバックグラウンドで実行
            asyncio.ensure_future(self._ensure_lily_pose(pose_category))
        elif speaker in ("葉留佳", "はるちん", "はるか"):
            path = self.pose_mgr.select_haruka_pose(pose_category)
            bus.pose_change.emit("haruka", str(path))

    async def _ensure_lily_pose(self, category: str) -> None:
        """リリィのポーズが不足していれば1枚生成する"""
        try:
            await ensure_pose(
                api_key=self.config.openai.api_key,
                model=self.config.openai.image_model,
                category=category,
                pose_mgr=self.pose_mgr,
            )
        except Exception:
            logger.warning("ポーズ自動生成に失敗: category=%s", category)


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

    # 自動雑談タイマーを開始
    app_instance.auto_conversation.start()

    # 音声入力の自動開始
    if app_instance.config.voice.enabled and app_instance.config.voice.google_api_key:
        app_instance.voice_pipeline = VoicePipeline(
            config=app_instance.config.voice,
            loop=asyncio.get_event_loop(),
        )
        app_instance.voice_pipeline.start()


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

    # アプリ終了時に音声パイプラインを停止
    def on_quit():
        if app_instance.voice_pipeline is not None:
            app_instance.voice_pipeline.stop()

    qt_app.aboutToQuit.connect(on_quit)

    # 非同期初期化を開始
    asyncio.ensure_future(async_init(app_instance))

    with loop:
        loop.run_forever()


if __name__ == "__main__":
    main()
