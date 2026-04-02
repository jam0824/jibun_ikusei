"""リリィデスクトップ — エントリポイント"""

import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import qasync
from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

from ai.auto_conversation import AutoConversation
from ai.camera_analyzer import analyze_camera_frame
from ai.chat_engine import ChatEngine
from ai.tool_definitions import CHAT_TOOLS
from ai.tool_executor import ToolExecutor
from api.api_client import ApiClient
from api.auth import CognitoAuth
from core.camera import capture_camera_frame, find_camera_index
from core.config import load_config, save_camera_device, save_voice_device, save_healthplanet_token
from core.desktop_context import DesktopContext, fetch_desktop_context, format_context_log
from core.event_bus import bus
from core.runtime_logging import configure_runtime_logging
from core.situation_logger import SituationLogger, SituationRecord
from data.session_manager import SessionManager
from pose.pose_generator import ensure_pose
from pose.pose_manager import PoseManager
from ui.main_window import MainWindow
from ui.tray_icon import TrayIcon
from voice.tts import TTSEngine
from voice.voice_pipeline import VoicePipeline
from health.healthplanet_client import (
    sync_health_data,
    is_token_valid,
    build_auth_url,
    exchange_code_for_token,
    query_health_data,
)
from health.oauth_dialog import HealthPlanetOAuthDialog
from health.sync_policy import (
    choose_healthplanet_sync_action,
    emit_weight_quest_clear_for_new_records,
    get_healthplanet_sync_interval_ms,
)

logger = logging.getLogger(__name__)
JST = timezone(timedelta(hours=9))


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
        self.tts_engine: TTSEngine | None = None

        # カメラシステム
        self._camera_device_index: int = 0
        self._camera_timer = QTimer()
        self._camera_timer.setSingleShot(False)
        self._summary_timer = QTimer()
        self._summary_timer.setSingleShot(False)
        self._healthplanet_timer = QTimer()
        self._healthplanet_timer.setSingleShot(False)
        self._healthplanet_timer.timeout.connect(self._on_healthplanet_timer)
        self._healthplanet_sync_in_progress = False
        self._healthplanet_oauth_dialog: HealthPlanetOAuthDialog | None = None
        self.situation_logger = SituationLogger(
            openai_api_key=self.config.openai.api_key,
            summary_model=self.config.camera.summary_model,
        )

    def connect_signals(self, window: MainWindow) -> None:
        """イベントバスとUIの配線"""
        # ユーザーメッセージ → AI会話（window側の吹き出し表示も残す）
        bus.user_message_received.connect(self._on_user_message)

        # 新しい会話
        bus.new_chat_requested.connect(self._on_new_chat)

        # AI応答 → 吹き出し表示 + ポーズ変更
        bus.ai_response_ready.connect(self._on_ai_response)
        bus.ai_response_ready_no_tts.connect(self._on_ai_response_no_tts)

        # 音声入力
        bus.voice_toggle_requested.connect(self._on_voice_toggle)
        bus.voice_device_selected.connect(self._on_voice_device_selected)

        # TTS再生中のマイク制御
        bus.tts_playback_started.connect(self._on_tts_started)
        bus.tts_playback_finished.connect(self._on_tts_finished)
        bus.tts_toggle_requested.connect(self._on_tts_toggle)

        # カメラ
        bus.camera_device_selected.connect(self._on_camera_device_selected)

        # デバッグ
        bus.desktop_context_requested.connect(self._on_desktop_context_requested)
        bus.auto_talk_requested.connect(self._on_auto_talk_requested)
        bus.camera_capture_requested.connect(self._on_camera_capture_requested)

    def _on_user_message(self, text: str) -> None:
        # 掛け合い中ならユーザー割り込みで中断
        if self.auto_conversation.is_talking:
            self.auto_conversation.interrupt()
        # TTS再生中ならキューをクリア
        if self.tts_engine is not None:
            self.tts_engine.clear_queue()
        asyncio.ensure_future(self._handle_user_message_with_follow_up(text))

    async def _handle_user_message_with_follow_up(self, text: str) -> None:
        """リリィの応答後にはるかを交えた掛け合いを起動する"""
        lily_text = await self.chat_engine.handle_user_message(text)
        if lily_text:
            self.auto_conversation.trigger_follow_up(text, lily_text)

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
            bus.voice_state_changed.emit(False)
            bus.balloon_show.emit("リリィ", "音声入力をオフにしたよ")
        else:
            self.voice_pipeline.start()
            if self.voice_pipeline.is_running:
                bus.voice_state_changed.emit(True)
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

    # --- TTS ---

    def _on_tts_started(self) -> None:
        """TTS再生開始 → マイク一時停止"""
        if self.voice_pipeline is not None and self.voice_pipeline.is_running:
            self.voice_pipeline.pause()

    def _on_tts_finished(self) -> None:
        """TTS再生終了 → マイク再開"""
        if self.voice_pipeline is not None and self.voice_pipeline.is_running:
            self.voice_pipeline.resume()

    def _on_tts_toggle(self) -> None:
        """読み上げのON/OFFを切り替える"""
        if self.tts_engine is None:
            # 未初期化 → 起動
            self.tts_engine = TTSEngine(self.config.tts)
            self.auto_conversation.set_tts(self.tts_engine)
            asyncio.ensure_future(self.tts_engine.start())
            bus.balloon_show.emit("リリィ", "読み上げをオンにしたよ！")
        elif self.tts_engine._running:
            # 動作中 → 停止
            self.tts_engine.clear_queue()
            asyncio.ensure_future(self.tts_engine.stop())
            self.auto_conversation.set_tts(None)
            bus.balloon_show.emit("リリィ", "読み上げをオフにしたよ")
        else:
            # 停止中 → 再起動
            asyncio.ensure_future(self.tts_engine.start())
            self.auto_conversation.set_tts(self.tts_engine)
            bus.balloon_show.emit("リリィ", "読み上げをオンにしたよ！")

    # --- カメラ ---

    def _on_camera_device_selected(self, device_index: int, device_name: str) -> None:
        """カメラデバイスを切り替えて設定を保存する"""
        self._camera_device_index = device_index
        self.config.camera.device_name = device_name
        # TalkSeedManager にも反映
        self.auto_conversation._seed_mgr._camera_device_index = device_index
        save_camera_device(device_name)
        logger.info("カメラを選択・保存: %s (index=%d)", device_name, device_index)
        bus.balloon_show.emit("リリィ", f"カメラを「{device_name}」に切り替えたよ！")

    def start_healthplanet_sync(self, *, interactive_auth: bool = True) -> None:
        """Health Planet データ同期を開始する。起動時のみ OAuth ダイアログを出す。"""
        hp = self.config.healthplanet
        has_credentials = bool(hp.client_id and hp.client_secret)
        token_valid = is_token_valid(hp.access_token, hp.token_expires_at)
        action = choose_healthplanet_sync_action(
            has_credentials=has_credentials,
            token_valid=token_valid,
            interactive_auth=interactive_auth,
            sync_in_progress=self._healthplanet_sync_in_progress,
        )

        if action == "skip":
            if has_credentials and not token_valid and not interactive_auth:
                logger.info("Health Planet 定期同期をスキップ: トークン無効のため再認証待ち")
            return

        if action == "oauth":
            if self._healthplanet_oauth_dialog is None:
                dialog = HealthPlanetOAuthDialog(build_auth_url(hp.client_id))
                dialog.code_submitted.connect(self._on_healthplanet_code)
                dialog.finished.connect(self._on_healthplanet_oauth_dialog_closed)
                self._healthplanet_oauth_dialog = dialog

            self._healthplanet_oauth_dialog.show()
            return

        asyncio.ensure_future(self._run_healthplanet_sync())

    def start_healthplanet_timer(self) -> None:
        hp = self.config.healthplanet
        if not hp.client_id or not hp.client_secret:
            return
        self._healthplanet_timer.start(
            get_healthplanet_sync_interval_ms(hp.sync_interval_minutes)
        )

    def _on_healthplanet_timer(self) -> None:
        self.start_healthplanet_sync(interactive_auth=False)

    def _on_healthplanet_oauth_dialog_closed(self) -> None:
        self._healthplanet_oauth_dialog = None

    def _on_healthplanet_code(self, code: str) -> None:
        asyncio.ensure_future(self._exchange_and_sync(code))

    async def _exchange_and_sync(self, code: str) -> None:
        hp = self.config.healthplanet
        try:
            res = await asyncio.to_thread(
                exchange_code_for_token, hp.client_id, hp.client_secret, code
            )
            access_token = res["access_token"]
            expires_at = int(datetime.now(JST).timestamp()) + int(res.get("expires_in", 3600))
            save_healthplanet_token(access_token, expires_at)
            self.config.healthplanet.access_token = access_token
            self.config.healthplanet.token_expires_at = expires_at
            if self._healthplanet_oauth_dialog is not None:
                self._healthplanet_oauth_dialog.close()
            await self._run_healthplanet_sync()
        except Exception:
            logger.exception("Health Planet OAuth 失敗")

    async def _run_healthplanet_sync(self) -> None:
        if self._healthplanet_sync_in_progress:
            return

        hp = self.config.healthplanet
        self._healthplanet_sync_in_progress = True
        try:
            new_records, error = await sync_health_data(
                hp.client_id,
                hp.client_secret,
                hp.access_token,
            )
            if error:
                logger.warning("Health Planet 同期エラー: %s", error)
                return

            logger.info("Health Planet 同期完了: %d 件新規", len(new_records))
            latest_record = emit_weight_quest_clear_for_new_records(
                new_records,
                bus.user_message_received.emit,
            )
            if latest_record is not None:
                logger.info(
                    "Health Planet 新規計測をクエスト発話に変換: %s %s",
                    latest_record.get("date", ""),
                    latest_record.get("time", ""),
                )

            if not self.auth.is_configured:
                return

            today = datetime.now(JST).date().isoformat()
            from_date = (datetime.now(JST).date() - timedelta(days=30)).isoformat()
            try:
                records = await asyncio.to_thread(query_health_data, from_date, today)
                if records:
                    await self.api_client.post_health_data(records)
                    logger.info("Health Planet クラウド同期完了: %d 件", len(records))
            except Exception:
                logger.exception("Health Planet クラウド同期に失敗")
        finally:
            self._healthplanet_sync_in_progress = False

    def start_camera_system(self) -> None:
        """カメラシステムを開始する（3分間隔キャプチャ + 30分間隔要約）"""
        cam_cfg = self.config.camera

        # カメラデバイスの初期設定
        if cam_cfg.device_name:
            idx = find_camera_index(cam_cfg.device_name)
            if idx is not None:
                self._camera_device_index = idx
                self.auto_conversation._seed_mgr._camera_device_index = idx

        # 3分間隔キャプチャタイマー
        self._camera_timer.timeout.connect(self._on_camera_timer)
        self._camera_timer.start(cam_cfg.interval_seconds * 1000)

        # 30分間隔要約タイマー
        self._summary_timer.timeout.connect(self._on_summary_timer)
        self._summary_timer.start(cam_cfg.summary_interval_seconds * 1000)

        logger.info(
            "カメラシステム開始: キャプチャ %d秒間隔, 要約 %d秒間隔",
            cam_cfg.interval_seconds,
            cam_cfg.summary_interval_seconds,
        )

    def stop_camera_system(self) -> None:
        """カメラシステムを停止する"""
        self._camera_timer.stop()
        self._summary_timer.stop()
        logger.info("カメラシステム停止")

    def _on_camera_timer(self) -> None:
        """3分間隔のカメラキャプチャ + デスクトップ状況取得"""
        asyncio.ensure_future(self._capture_and_record())

    def _on_summary_timer(self) -> None:
        """30分間隔のサーバー要約"""
        asyncio.ensure_future(self._generate_and_send_summary())

    async def _capture_and_record(self) -> None:
        """カメラ画像取得 + デスクトップ状況取得 → ローカル記録"""
        from core.active_window import get_active_window_info

        record = SituationRecord()
        record.timestamp = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")

        # カメラ画像取得・分析
        try:
            frame_png = capture_camera_frame(self._camera_device_index)
            if frame_png is not None:
                analysis = await analyze_camera_frame(
                    api_key=self.config.openai.api_key,
                    model=self.config.camera.analysis_model,
                    frame_png=frame_png,
                )
                record.camera_summary = analysis.summary
                record.camera_tags = analysis.tags
                record.camera_scene_type = analysis.scene_type
        except Exception:
            logger.exception("カメラキャプチャ・分析に失敗")

        # デスクトップ状況取得
        try:
            ctx = await fetch_desktop_context(
                api_key=self.config.openai.api_key,
                model=self.config.openai.screen_analysis_model,
            )
            if ctx.analysis:
                record.desktop_summary = ctx.analysis.summary
                record.desktop_tags = ctx.analysis.tags
                record.desktop_activity_type = ctx.analysis.activity_type
        except Exception:
            logger.exception("デスクトップ状況取得に失敗")

        # アクティブアプリ取得
        try:
            win_info = get_active_window_info()
            record.active_app = win_info.app_name
            record.window_title = win_info.window_title[:80]
        except Exception:
            logger.exception("アクティブアプリ取得に失敗")

        self.situation_logger.record(record)
        return record

    async def _generate_and_send_summary(self) -> None:
        """30分間の要約を生成してサーバーに送信する"""
        summary_data = await self.situation_logger.generate_summary()
        if summary_data:
            try:
                await self.api_client.post_situation_log(summary_data)
                logger.info("30分要約をサーバーに送信: %s", summary_data["summary"][:100])
            except Exception:
                logger.exception("30分要約のサーバー送信に失敗")

    # --- デバッグ ---

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

    def _on_camera_capture_requested(self) -> None:
        asyncio.ensure_future(self._debug_capture_and_record())

    async def _debug_capture_and_record(self) -> None:
        """カメラ+デスクトップ+アクティブアプリを取得・記録して吹き出しに表示（デバッグ用）"""
        bus.balloon_show.emit("リリィ", "カメラ・デスクトップ状況を確認中…")
        try:
            record = await self._capture_and_record()

            parts = ["[デバッグ] 状況記録完了"]
            if record.camera_summary:
                parts.append(f"カメラ: {record.camera_summary}")
            else:
                parts.append("カメラ: 取得できず")
            if record.desktop_summary:
                parts.append(f"デスクトップ: {record.desktop_summary}")
            if record.active_app:
                parts.append(f"アプリ: {record.active_app}")

            bus.balloon_show.emit("リリィ", "\n".join(parts))
        except Exception:
            logger.exception("デバッグ: 状況記録に失敗")
            bus.balloon_show.emit("リリィ", "[デバッグ] 状況記録に失敗しちゃった…")

    def _on_ai_response(self, speaker: str, text: str, pose_category: str) -> None:
        self._update_ui_for_response(speaker, text, pose_category)
        # TTS読み上げ
        if self.tts_engine is not None and self.tts_engine._running:
            self.tts_engine.enqueue(speaker, text)

    def _on_ai_response_no_tts(self, speaker: str, text: str, pose_category: str) -> None:
        """UI更新のみ（TTS enqueue は呼び出し元が管理する）"""
        self._update_ui_for_response(speaker, text, pose_category)

    def _update_ui_for_response(self, speaker: str, text: str, pose_category: str) -> None:
        """吹き出し表示 + ポーズ変更の共通処理"""
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
            await app_instance.session_mgr.create_new_session()
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
        if app_instance.voice_pipeline.is_running:
            bus.voice_state_changed.emit(True)

    # TTS の自動開始
    if app_instance.config.tts.enabled:
        app_instance.tts_engine = TTSEngine(app_instance.config.tts)
        app_instance.auto_conversation.set_tts(app_instance.tts_engine)
        await app_instance.tts_engine.start()

    # カメラシステムの自動開始
    if app_instance.config.camera.enabled:
        app_instance.start_camera_system()

    # Health Planet データ同期
    if app_instance.config.healthplanet.client_id:
        app_instance.start_healthplanet_timer()
        app_instance.start_healthplanet_sync()


def main() -> None:
    log_path = configure_runtime_logging()
    logger.info("リリィデスクトップを起動します: %s", log_path)

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

    # アプリ終了時にパイプライン・TTSを停止
    def on_quit():
        logger.info("リリィデスクトップを終了します")
        if app_instance.voice_pipeline is not None:
            app_instance.voice_pipeline.stop()
        if app_instance.tts_engine is not None:
            app_instance.tts_engine.clear_queue()
        app_instance.stop_camera_system()

    qt_app.aboutToQuit.connect(on_quit)

    # 非同期初期化を開始
    asyncio.ensure_future(async_init(app_instance))

    with loop:
        loop.run_forever()


if __name__ == "__main__":
    main()
