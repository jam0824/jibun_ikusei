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
from ai.chat_engine import ChatEngine
from ai.tool_definitions import CHAT_TOOLS
from ai.tool_executor import ToolExecutor
from api.api_client import ApiClient
from api.auth import CognitoAuth
from core.action_log_organizer import ActionLogOrganizer
from core.action_log_summary_backfill_service import ActionLogSummaryBackfillService
from core.activity_capture_service import (
    ActivityCaptureService,
    default_device_id,
    purge_raw_event_range,
)
from core.background_event_runtime import register_background_event_handlers
from core.camera import find_camera_index
from core.chrome_audible_tabs import ChromeAudibleTabsTracker
from core.config import (
    load_config,
    save_camera_device,
    save_healthplanet_token,
    save_voice_device,
)
from core.desktop_context import format_context_log
from core.domain_events import (
    ActionLogOrganizeRequested,
    ActionLogSummaryBackfillRequested,
    ActionLogSyncRequested,
    AppStarted,
    CaptureSnapshotRequested,
    CaptureSummaryDue,
    ChatAutoTalkDue,
    DomainEventHub,
    HealthPlanetSyncRequested,
    LevelWatchRequested,
)
from core.event_bus import bus
from core.job_manager import JobManager
from core.level_watch import LevelWatchService
from core.local_http_bridge import LocalHttpBridge, start_local_http_bridge
from core.runtime_logging import configure_runtime_logging
from core.situation_capture import SituationCaptureCoordinator
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
from fitbit.fitbit_client import FitbitClient
from fitbit.fitbit_sync import FitbitSync

logger = logging.getLogger(__name__)
JST = timezone(timedelta(hours=9))


class App:
    """アプリケーション全体の初期化と配線"""

    def __init__(self):
        self.config = load_config()
        self.event_hub = DomainEventHub()
        self.job_manager = JobManager()
        self.auth = CognitoAuth(
            self.config.cognito.email, self.config.cognito.password
        )
        self.api_client = ApiClient(self.auth)
        self.session_mgr = SessionManager(self.api_client)
        self.pose_mgr = PoseManager()
        self.tool_executor = ToolExecutor(self.api_client, config=self.config)
        self.chat_engine = ChatEngine(
            self.config, self.api_client, self.session_mgr
        )
        self.chat_engine.set_tools(CHAT_TOOLS, self.tool_executor.execute)
        self.situation_capture = SituationCaptureCoordinator()
        self.auto_conversation = AutoConversation(
            self.config,
            self.session_mgr,
            api_client=self.api_client,
            situation_capture_coordinator=self.situation_capture,
            event_hub=self.event_hub,
        )
        self.voice_pipeline: VoicePipeline | None = None
        self.tts_engine: TTSEngine | None = None
        self.active_user_conversation = False
        self.pending_periodic_auto_talk: ChatAutoTalkDue | None = None
        self.pending_periodic_expires_at: datetime | None = None
        self.chrome_audible_tabs_tracker = ChromeAudibleTabsTracker()
        self.level_watch = LevelWatchService()
        self.activity_capture_service: ActivityCaptureService | None = None
        self.action_log_organizer: ActionLogOrganizer | None = None
        self.action_log_summary_backfill_service: ActionLogSummaryBackfillService | None = None

        # Fitbit 同期
        self.fitbit_sync: FitbitSync | None = None
        if self.config.fitbit.enabled:
            config_path = Path(__file__).resolve().parent / self.config.fitbit.config_file
            if config_path.exists():
                self.fitbit_sync = FitbitSync(
                    client=FitbitClient(config_path),
                    api_client=self.api_client,
                )
            else:
                logger.warning("fitbit_config.json が見つかりません: %s", config_path)

        # カメラシステム
        self._camera_device_index: int = 0
        self._camera_timer = QTimer()
        self._camera_timer.setSingleShot(False)
        self._summary_timer = QTimer()
        self._summary_timer.setSingleShot(False)
        self._level_watch_timer = QTimer()
        self._level_watch_timer.setSingleShot(False)
        self._level_watch_timer.timeout.connect(self._on_level_watch_timer)
        self._action_log_sync_timer = QTimer()
        self._action_log_sync_timer.setSingleShot(False)
        self._action_log_sync_timer.timeout.connect(self._on_action_log_sync_timer)
        self._healthplanet_timer = QTimer()
        self._healthplanet_timer.setSingleShot(False)
        self._healthplanet_timer.timeout.connect(self._on_healthplanet_timer)
        self._healthplanet_sync_in_progress = False
        self._healthplanet_oauth_dialog: HealthPlanetOAuthDialog | None = None
        self._last_situation_capture_skip_reason = ""
        self.situation_logger = SituationLogger(
            openai_api_key=self.config.openai.api_key,
            summary_provider=self.config.camera.summary_provider,
            summary_base_url=self.config.camera.summary_base_url,
            summary_model=self.config.camera.summary_model,
        )
        self.http_bridge: LocalHttpBridge | None = None
        register_background_event_handlers(
            self,
            self.event_hub,
            self.job_manager,
        )

    def connect_signals(self, window: MainWindow) -> None:
        """イベントバスとUIの配線"""
        # ユーザーメッセージ → AI会話（window側の吹き出し表示も残す）
        bus.user_message_received.connect(self._on_user_message)
        bus.system_message_received.connect(self._on_system_message)

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
        bus.books_talk_requested.connect(self._on_books_talk_requested)
        bus.memory_talk_requested.connect(self._on_memory_talk_requested)
        bus.quest_weekly_talk_requested.connect(self._on_quest_weekly_talk_requested)
        bus.quest_today_talk_requested.connect(self._on_quest_today_talk_requested)
        bus.camera_capture_requested.connect(self._on_camera_capture_requested)

    def _on_user_message(self, text: str) -> None:
        self._on_incoming_message(text, is_system=False)

    def _on_system_message(self, text: str) -> None:
        self._on_incoming_message(text, is_system=True)

    def _on_incoming_message(self, text: str, *, is_system: bool) -> None:
        # 掛け合い中ならユーザー割り込みで中断
        if self.auto_conversation.is_talking:
            self.auto_conversation.interrupt()
        # TTS再生中ならキューをクリア
        if self.tts_engine is not None:
            self.tts_engine.clear_queue()
        handler = (
            self._handle_system_message_with_follow_up
            if is_system
            else self._handle_user_message_with_follow_up
        )
        asyncio.ensure_future(handler(text))

    async def _handle_user_message_with_follow_up(self, text: str) -> None:
        """リリィの応答後にはるかを交えた掛け合いを起動する"""
        self.active_user_conversation = True
        try:
            lily_text = await self.chat_engine.handle_user_message(text)
            if lily_text:
                follow_up_tasks = self.auto_conversation.trigger_follow_up(text, lily_text)
                if follow_up_tasks:
                    await asyncio.gather(*follow_up_tasks)
        finally:
            self.active_user_conversation = False
            await self._drain_pending_periodic_auto_talk_if_needed()

    async def _handle_system_message_with_follow_up(self, text: str) -> None:
        self.active_user_conversation = True
        try:
            lily_text = await self.chat_engine.handle_system_message(text)
            if lily_text:
                follow_up_tasks = self.auto_conversation.trigger_follow_up(text, lily_text)
                if follow_up_tasks:
                    await asyncio.gather(*follow_up_tasks)
        finally:
            self.active_user_conversation = False
            await self._drain_pending_periodic_auto_talk_if_needed()

    async def handle_chat_auto_talk_due(self, event: ChatAutoTalkDue) -> None:
        """定期自動雑談は通常会話中なら1件だけ保留し、空いたら実行する。"""
        is_periodic_timer = (
            event.source == "auto_conversation.timer"
            and event.forced_source is None
        )
        if is_periodic_timer and self.active_user_conversation:
            self.pending_periodic_auto_talk = event
            self.pending_periodic_expires_at = event.occurred_at + timedelta(minutes=5)
            logger.info(
                "定期自動雑談を保留: occurred_at=%s expires_at=%s",
                event.occurred_at.isoformat(),
                self.pending_periodic_expires_at.isoformat(),
            )
            return
        if is_periodic_timer:
            matched_domain = self._find_matching_skip_audible_domain()
            if matched_domain:
                logger.info(
                    "定期自動雑談をスキップ: Chrome可聴タブ domain=%s",
                    matched_domain,
                )
                return

        await self.job_manager.submit(
            "chat.auto_talk",
            "single_flight_drop",
            lambda: self.auto_conversation.run_auto_talk_job(event.forced_source),
        )

    async def _drain_pending_periodic_auto_talk_if_needed(self) -> None:
        event = self.pending_periodic_auto_talk
        expires_at = self.pending_periodic_expires_at
        self.pending_periodic_auto_talk = None
        self.pending_periodic_expires_at = None

        if event is None:
            return

        now = datetime.now(JST)
        if expires_at is not None and now > expires_at:
            logger.info(
                "保留中の定期自動雑談を破棄: occurred_at=%s expired_at=%s now=%s",
                event.occurred_at.isoformat(),
                expires_at.isoformat(),
                now.isoformat(),
            )
            return
        matched_domain = self._find_matching_skip_audible_domain()
        if matched_domain:
            logger.info(
                "保留中の定期自動雑談をスキップ: Chrome可聴タブ domain=%s",
                matched_domain,
            )
            return

        logger.info("保留中の定期自動雑談を実行")
        await self.job_manager.submit(
            "chat.auto_talk",
            "single_flight_drop",
            lambda: self.auto_conversation.run_auto_talk_job(event.forced_source),
        )

    def _find_matching_skip_audible_domain(self) -> str | None:
        chat_cfg = getattr(getattr(self, "config", None), "chat", None)
        domains = getattr(chat_cfg, "auto_talk_skip_audible_domains", [])
        if not domains:
            return None
        tracker = getattr(self, "chrome_audible_tabs_tracker", None)
        if tracker is None:
            return None
        return tracker.find_fresh_matching_domain(domains, now=datetime.now(JST))

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
        if (
            self.config.voice.pause_during_tts
            and self.voice_pipeline is not None
            and self.voice_pipeline.is_running
        ):
            self.voice_pipeline.pause()

    def _on_tts_finished(self) -> None:
        """TTS再生終了 → マイク再開"""
        if (
            self.config.voice.pause_during_tts
            and self.voice_pipeline is not None
            and self.voice_pipeline.is_running
        ):
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

    def start_level_watch_timer(self) -> None:
        interval_ms = self.config.desktop.level_watch_interval_minutes * 60 * 1000
        self._level_watch_timer.start(interval_ms)
        logger.info(
            "レベル監視タイマー開始: %d分間隔",
            self.config.desktop.level_watch_interval_minutes,
        )

    def stop_level_watch_timer(self) -> None:
        self._level_watch_timer.stop()

    def _on_level_watch_timer(self) -> None:
        asyncio.ensure_future(self.run_level_watch_job())

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

            if not self.auth.is_configured or not new_records:
                return

            try:
                await self.api_client.post_health_data(new_records)
                logger.info("Health Planet cloud sync posted %d records", len(new_records))
                return
            except Exception:
                logger.exception("Health Planet cloud sync failed")

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

    def start_http_bridge(self, event_loop: asyncio.AbstractEventLoop) -> None:
        """Local HTTP Bridge を起動する。"""
        if self.activity_capture_service is None:
            self.start_activity_capture_service()
        self.http_bridge = start_local_http_bridge(
            self.config.http_bridge,
            event_loop=event_loop,
            emit_user_message=bus.user_message_received.emit,
            emit_system_message=bus.system_message_received.emit,
            update_chrome_audible_tabs=lambda received_at, audible_tabs: self.chrome_audible_tabs_tracker.update(
                received_at=received_at,
                audible_tabs=audible_tabs,
            ),
            ingest_browser_event=(
                self.activity_capture_service.ingest_browser_event
                if self.activity_capture_service is not None
                else None
            ),
            logger_instance=logger,
        )

    def stop_http_bridge(self) -> None:
        """Local HTTP Bridge を停止する。"""
        if self.http_bridge is None:
            return
        self.http_bridge.stop()
        self.http_bridge = None

    def start_activity_capture_service(self) -> None:
        cfg = self.config.activity_capture
        if not cfg.enabled:
            logger.info("Activity capture is disabled by config")
            self.activity_capture_service = None
            return
        if self.activity_capture_service is not None:
            return

        service = ActivityCaptureService(
            device_id=default_device_id(),
            initial_state=cfg.initial_state,
            poll_interval_seconds=cfg.poll_interval_seconds,
            privacy_rules=cfg.privacy_rules,
            logger_instance=logger,
        )
        service.start()
        self.activity_capture_service = service

    def stop_activity_capture_service(self) -> None:
        if self.activity_capture_service is None:
            return
        self.activity_capture_service.stop()
        self.activity_capture_service = None

    def start_action_log_sync_timer(self) -> None:
        if not self.config.activity_capture.enabled:
            return
        self._action_log_sync_timer.start(
            self.config.activity_capture.sync_interval_seconds * 1000
        )

    def stop_action_log_sync_timer(self) -> None:
        self._action_log_sync_timer.stop()

    def stop_camera_system(self) -> None:
        """カメラシステムを停止する"""
        self._camera_timer.stop()
        self._summary_timer.stop()
        logger.info("カメラシステム停止")

    def _on_camera_timer(self) -> None:
        """3分間隔のカメラキャプチャ + デスクトップ状況取得"""
        asyncio.ensure_future(self._capture_and_record_coordinated())

    def _on_summary_timer(self) -> None:
        """30分間隔のサーバー要約"""
        asyncio.ensure_future(self._generate_and_send_summary())

    def _on_action_log_sync_timer(self) -> None:
        if getattr(self, "event_hub", None) is not None:
            self.event_hub.publish(ActionLogSyncRequested(source="action_log.sync.timer"))
            self.event_hub.publish(
                ActionLogOrganizeRequested(source="action_log.organize.timer")
            )
            return
        asyncio.ensure_future(self.handle_action_log_sync_request())
        asyncio.ensure_future(self.handle_action_log_organize_request())

    async def handle_action_log_sync_request(self) -> None:
        if not self.config.activity_capture.enabled:
            return
        if not getattr(self.auth, "is_configured", False):
            logger.info("Action log sync skipped: Cognito not configured")
            return

        capture_service = self.activity_capture_service
        device_id = (
            capture_service.device_id if capture_service is not None else default_device_id()
        )
        current_capture_state = (
            getattr(capture_service, "capture_state", self.config.activity_capture.initial_state)
            if capture_service is not None
            else self.config.activity_capture.initial_state
        )

        try:
            devices = await self.api_client.get_action_log_devices()
        except Exception:
            logger.exception("Action log device sync failed")
            return

        matched_device = next(
            (
                device
                for device in devices
                if str(device.get("id", "")).strip() == device_id
            ),
            None,
        )
        if matched_device is None:
            try:
                await self.api_client.put_action_log_device(
                    device_id,
                    {
                        "id": device_id,
                        "name": device_id,
                        "captureState": current_capture_state,
                    },
                )
            except Exception:
                logger.exception("Action log device registration failed")
                return
            effective_capture_state = current_capture_state
        else:
            effective_capture_state = str(
                matched_device.get("captureState", current_capture_state)
            ).strip() or current_capture_state

        if effective_capture_state not in {"active", "paused", "disabled"}:
            effective_capture_state = current_capture_state

        if effective_capture_state == "disabled":
            stop_capture = getattr(self, "stop_activity_capture_service", None)
            if callable(stop_capture):
                stop_capture()
            capture_service = self.activity_capture_service
        else:
            if capture_service is None:
                self.config.activity_capture.initial_state = effective_capture_state
                start_capture = getattr(self, "start_activity_capture_service", None)
                if callable(start_capture):
                    start_capture()
                capture_service = self.activity_capture_service
            if capture_service is not None:
                capture_service.set_capture_state(effective_capture_state)

        try:
            privacy_rules = await self.api_client.get_action_log_privacy_rules()
        except Exception:
            logger.exception("Action log privacy rule sync failed")
            return

        if capture_service is not None:
            capture_service.set_privacy_rules(privacy_rules)

        try:
            deletion_requests = await self.api_client.get_action_log_deletion_requests()
        except Exception:
            logger.exception("Action log deletion-request sync failed")
            return

        for request in deletion_requests:
            request_id = str(request.get("id", "")).strip()
            from_date = str(request.get("from", "")).strip()
            to_date = str(request.get("to", "")).strip()
            if not request_id or not from_date or not to_date:
                continue
            purge_raw_event_range(from_date=from_date, to_date=to_date)
            try:
                await self.api_client.ack_action_log_deletion_request(request_id)
            except Exception:
                logger.exception(
                    "Action log deletion-request ack failed: %s",
                    request_id,
                )

        if capture_service is None:
            return

        while True:
            pending = capture_service.snapshot_pending_raw_events(limit=100)
            if not pending:
                return

            try:
                await self.api_client.post_action_log_raw_events(
                    {
                        "deviceId": capture_service.device_id,
                        "events": [entry["event"] for entry in pending],
                    }
                )
            except Exception:
                logger.exception("Action log raw-event sync failed")
                return

            capture_service.ack_pending_raw_events(pending)

    async def handle_action_log_organize_request(self) -> None:
        if not self.config.activity_capture.enabled:
            return
        if not getattr(self.auth, "is_configured", False):
            logger.info("Action log organize skipped: Cognito not configured")
            return

        organizer = self._get_action_log_organizer()
        await organizer.organize_and_sync()

    async def handle_action_log_summary_backfill_request(self) -> None:
        if not self.config.activity_capture.enabled:
            return
        if not getattr(self.auth, "is_configured", False):
            logger.info("Action log summary backfill skipped: Cognito not configured")
            return

        service = self._get_action_log_summary_backfill_service()
        await service.backfill_missing_summaries()

    def _get_action_log_organizer(self) -> ActionLogOrganizer:
        if self.action_log_organizer is None:
            self.action_log_organizer = ActionLogOrganizer(
                device_id=(
                    self.activity_capture_service.device_id
                    if self.activity_capture_service is not None
                    else default_device_id()
                ),
                api_client=self.api_client,
                processing_config=self.config.activity_processing,
                logger_instance=logger,
            )
        return self.action_log_organizer

    def _get_action_log_summary_backfill_service(
        self,
    ) -> ActionLogSummaryBackfillService:
        if self.action_log_summary_backfill_service is None:
            self.action_log_summary_backfill_service = ActionLogSummaryBackfillService(
                api_client=self.api_client,
                openai_api_key=self.config.openai.api_key,
                logger_instance=logger,
            )
        return self.action_log_summary_backfill_service

    async def run_level_watch_job(self) -> None:
        if not getattr(self.auth, "is_configured", False):
            logger.info("レベル監視をスキップ: Cognito未設定")
            return

        try:
            message = await self.level_watch.check_once(self.api_client)
        except Exception:
            logger.exception("レベル監視ジョブに失敗")
            return

        if not message:
            return

        self.chat_engine.invalidate_context_cache()
        logger.info("レベルアップ通知を system_message に送信: %s", message)
        bus.system_message_received.emit(message)

    async def _capture_and_record(self) -> SituationRecord | None:
        """カメラ画像取得 + デスクトップ文脈取得の統合版。"""
        return await self._capture_and_record_coordinated()

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

    def _on_books_talk_requested(self) -> None:
        if getattr(self, "event_hub", None) is not None:
            self.event_hub.publish(
                ChatAutoTalkDue(
                    source="auto_conversation.manual_books",
                    forced_source="books",
                )
            )
            return
        self.auto_conversation.trigger_books_now()

    def _on_memory_talk_requested(self) -> None:
        if getattr(self, "event_hub", None) is not None:
            self.event_hub.publish(
                ChatAutoTalkDue(
                    source="auto_conversation.manual_memory",
                    forced_source="memory",
                )
            )
            return
        self.auto_conversation.trigger_memory_now()

    def _on_quest_weekly_talk_requested(self) -> None:
        if getattr(self, "event_hub", None) is not None:
            self.event_hub.publish(
                ChatAutoTalkDue(
                    source="auto_conversation.manual_quest_weekly",
                    forced_source="quest_weekly",
                )
            )
            return
        self.auto_conversation.trigger_quest_weekly_now()

    def _on_quest_today_talk_requested(self) -> None:
        if getattr(self, "event_hub", None) is not None:
            self.event_hub.publish(
                ChatAutoTalkDue(
                    source="auto_conversation.manual_quest_today",
                    forced_source="quest_today",
                )
            )
            return
        self.auto_conversation.trigger_quest_today_now()

    def _on_desktop_context_requested(self) -> None:
        asyncio.ensure_future(self._fetch_and_show_desktop_context_coordinated())

    async def _fetch_and_show_desktop_context(self) -> None:
        """デスクトップ文脈取得の統合版。"""
        await self._fetch_and_show_desktop_context_coordinated()

    def _on_camera_capture_requested(self) -> None:
        asyncio.ensure_future(self._debug_capture_and_record_coordinated())

    async def _debug_capture_and_record(self) -> None:
        """デバッグ用の状況取得統合版。"""
        await self._debug_capture_and_record_coordinated()

    async def _capture_and_record_coordinated(self) -> SituationRecord | None:
        """共有コーディネータ経由で状況を取得して記録する。"""
        from core.active_window import get_active_window_info

        record = SituationRecord()
        record.timestamp = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")
        self._last_situation_capture_skip_reason = ""
        desktop_cfg = getattr(self.config, "desktop", None)

        capture = await self.situation_capture.capture_for_record(
            api_key=self.config.openai.api_key,
            camera_provider=self.config.camera.analysis_provider,
            camera_base_url=self.config.camera.analysis_base_url,
            camera_model=self.config.camera.analysis_model,
            screen_provider=getattr(desktop_cfg, "analysis_provider", "openai"),
            screen_base_url=getattr(desktop_cfg, "analysis_base_url", ""),
            screen_model=getattr(
                desktop_cfg,
                "analysis_model",
                self.config.openai.screen_analysis_model,
            ),
            camera_device_index=self._camera_device_index,
        )
        if capture.skipped:
            self._last_situation_capture_skip_reason = capture.skip_reason
            logger.info("状況記録をスキップ: %s", capture.skip_reason)
            return None

        if capture.camera.analysis is not None:
            record.camera_summary = capture.camera.analysis.summary
            record.camera_tags = capture.camera.analysis.tags
            record.camera_scene_type = capture.camera.analysis.scene_type

        ctx = capture.desktop.context
        if ctx is not None and ctx.analysis:
            record.desktop_summary = ctx.analysis.summary
            record.desktop_tags = ctx.analysis.tags
            record.desktop_activity_type = ctx.analysis.activity_type

        try:
            win_info = ctx.window_info if ctx is not None else get_active_window_info()
            record.active_app = win_info.app_name
            record.window_title = win_info.window_title[:80]
        except Exception:
            logger.exception("アクティブアプリ取得に失敗")

        self.situation_logger.record(record)
        return record

    async def _fetch_and_show_desktop_context_coordinated(self) -> None:
        """共有コーディネータ経由でデスクトップ状況を取得して表示する。"""
        bus.balloon_show.emit("リリィ", "画面の状況を確認中…")
        try:
            desktop_cfg = getattr(self.config, "desktop", None)
            attempt = await self.situation_capture.capture_desktop(
                api_key=self.config.openai.api_key,
                provider=getattr(desktop_cfg, "analysis_provider", "openai"),
                base_url=getattr(desktop_cfg, "analysis_base_url", ""),
                model=getattr(
                    desktop_cfg,
                    "analysis_model",
                    self.config.openai.screen_analysis_model,
                ),
            )
            if attempt.skipped:
                bus.balloon_show.emit(
                    "リリィ",
                    f"[デバッグ] 取得中のためスキップ\n{attempt.skip_reason}",
                )
                return
            if attempt.error or attempt.context is None:
                bus.balloon_show.emit(
                    "リリィ",
                    f"[デバッグ] エラー: {attempt.error or '状況取得に失敗'}",
                )
                return

            ctx = attempt.context
            self._last_desktop_context = ctx
            logger.info("\n%s", format_context_log(ctx))

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
                    f"種類: {ctx.analysis.activity_type}\n"
                    f"詳細: {ctx.analysis.detail}",
                )
        except Exception:
            logger.exception("デスクトップ状況取得に失敗")
            bus.balloon_show.emit("リリィ", "[デバッグ] 状況取得に失敗しちゃった…")

    async def _debug_capture_and_record_coordinated(self) -> None:
        """共有コーディネータ経由で状況記録を確認する。"""
        bus.balloon_show.emit("リリィ", "カメラ・デスクトップ状況を確認中…")
        try:
            record = await self._capture_and_record_coordinated()
            if record is None:
                bus.balloon_show.emit(
                    "リリィ",
                    f"[デバッグ] 取得中のためスキップ\n{self._last_situation_capture_skip_reason or '状況取得はすでに実行中です'}",
                )
                return

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


_LEGACY_START_HEALTHPLANET_SYNC = App.start_healthplanet_sync
_LEGACY_ON_HEALTHPLANET_TIMER = App._on_healthplanet_timer
_LEGACY_ON_CAMERA_TIMER = App._on_camera_timer
_LEGACY_ON_SUMMARY_TIMER = App._on_summary_timer
_LEGACY_ON_LEVEL_WATCH_TIMER = App._on_level_watch_timer


async def _evented_handle_healthplanet_sync_request(
    self: App,
    *,
    interactive_auth: bool,
) -> None:
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
            logger.info(
                "Health Planet startup sync skipped because interactive auth is disabled"
            )
        return

    if action == "oauth":
        if self._healthplanet_oauth_dialog is None:
            dialog = HealthPlanetOAuthDialog(build_auth_url(hp.client_id))
            dialog.code_submitted.connect(self._on_healthplanet_code)
            dialog.finished.connect(self._on_healthplanet_oauth_dialog_closed)
            self._healthplanet_oauth_dialog = dialog

        self._healthplanet_oauth_dialog.show()
        return

    await self._run_healthplanet_sync()


async def _evented_handle_fitbit_sync_request(self: App) -> None:
    if self.fitbit_sync is None:
        return
    try:
        await self.fitbit_sync.run()
    except Exception:
        logger.exception("Fitbit startup sync failed")


async def _evented_run_capture_snapshot_job(self: App) -> None:
    await self._capture_and_record_coordinated()


async def _evented_run_capture_summary_job(self: App) -> None:
    await self._generate_and_send_summary()


def _evented_start_healthplanet_sync(
    self: App,
    *,
    interactive_auth: bool = True,
) -> None:
    if getattr(self, "event_hub", None) is not None:
        self.event_hub.publish(
            HealthPlanetSyncRequested(
                source="app.start_healthplanet_sync",
                interactive_auth=interactive_auth,
            )
        )
        return
    _LEGACY_START_HEALTHPLANET_SYNC(self, interactive_auth=interactive_auth)


def _evented_on_healthplanet_timer(self: App) -> None:
    if getattr(self, "event_hub", None) is not None:
        self.event_hub.publish(
            HealthPlanetSyncRequested(
                source="healthplanet.timer",
                interactive_auth=False,
            )
        )
        return
    _LEGACY_ON_HEALTHPLANET_TIMER(self)


def _evented_on_camera_timer(self: App) -> None:
    if getattr(self, "event_hub", None) is not None:
        self.event_hub.publish(CaptureSnapshotRequested(source="camera.timer"))
        return
    _LEGACY_ON_CAMERA_TIMER(self)


def _evented_on_summary_timer(self: App) -> None:
    if getattr(self, "event_hub", None) is not None:
        self.event_hub.publish(CaptureSummaryDue(source="camera.summary_timer"))
        return
    _LEGACY_ON_SUMMARY_TIMER(self)


def _evented_on_level_watch_timer(self: App) -> None:
    if getattr(self, "event_hub", None) is not None:
        self.event_hub.publish(
            LevelWatchRequested(source="desktop.level_watch.timer")
        )
        return
    _LEGACY_ON_LEVEL_WATCH_TIMER(self)


App.handle_healthplanet_sync_request = _evented_handle_healthplanet_sync_request
App.handle_fitbit_sync_request = _evented_handle_fitbit_sync_request
App.run_capture_snapshot_job = _evented_run_capture_snapshot_job
App.run_capture_summary_job = _evented_run_capture_summary_job
App.start_healthplanet_sync = _evented_start_healthplanet_sync
App._on_healthplanet_timer = _evented_on_healthplanet_timer
App._on_camera_timer = _evented_on_camera_timer
App._on_summary_timer = _evented_on_summary_timer
App._on_level_watch_timer = _evented_on_level_watch_timer


async def async_init(app_instance: App) -> None:
    """起動時の認証と各サブシステム初期化を行う。"""
    if app_instance.auth.is_configured:
        try:
            await app_instance.auth.get_id_token()
            logger.info("Cognito authentication succeeded")
            await app_instance.session_mgr.create_new_session()
        except Exception:
            logger.exception(
                "Failed to authenticate Cognito during startup session initialization"
            )
    else:
        logger.warning("Cognito認証情報が未設定です。config.yamlを確認してください。")

    app_instance.auto_conversation.start()

    if app_instance.config.voice.enabled and app_instance.config.voice.google_api_key:
        app_instance.voice_pipeline = VoicePipeline(
            config=app_instance.config.voice,
            loop=asyncio.get_event_loop(),
        )
        app_instance.voice_pipeline.start()
        if app_instance.voice_pipeline.is_running:
            bus.voice_state_changed.emit(True)

    if app_instance.config.tts.enabled:
        app_instance.tts_engine = TTSEngine(app_instance.config.tts)
        app_instance.auto_conversation.set_tts(app_instance.tts_engine)
        await app_instance.tts_engine.start()

    if app_instance.config.camera.enabled:
        app_instance.start_camera_system()

    if app_instance.config.healthplanet.client_id:
        app_instance.start_healthplanet_timer()
    app_instance.start_level_watch_timer()
    app_instance.start_action_log_sync_timer()

    if getattr(app_instance, "event_hub", None) is not None:
        app_instance.event_hub.publish(AppStarted(source="async_init"))
        return

    if app_instance.config.healthplanet.client_id:
        app_instance.start_healthplanet_sync()

    if app_instance.fitbit_sync is not None:
        try:
            await app_instance.fitbit_sync.run()
        except Exception:
            logger.exception("Fitbit startup sync failed")


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
    app_instance.start_http_bridge(loop)

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
        app_instance.stop_http_bridge()
        app_instance.stop_action_log_sync_timer()
        app_instance.stop_activity_capture_service()
        app_instance.stop_camera_system()
        app_instance.stop_level_watch_timer()

    qt_app.aboutToQuit.connect(on_quit)

    # 非同期初期化を開始
    asyncio.ensure_future(async_init(app_instance))

    with loop:
        loop.run_forever()


if __name__ == "__main__":
    main()
