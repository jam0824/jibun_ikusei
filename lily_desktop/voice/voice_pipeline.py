"""音声入力パイプライン — マイク → VAD → STT → イベント発火"""

from __future__ import annotations

import asyncio
import logging
import threading

from core.config import VoiceConfig
from core.event_bus import bus
from voice.audio_capture import AudioCapture, find_device_index
from voice.vad import _compute_rms
from voice.speech_recognizer import SpeechRecognizer
from voice.vad import VadGate

logger = logging.getLogger(__name__)


class VoicePipeline:
    """マイク入力 → VAD → Google STT → bus.user_message_received の統合パイプライン"""

    def __init__(self, config: VoiceConfig, loop: asyncio.AbstractEventLoop):
        self._config = config
        self._loop = loop
        # 保存済みデバイス名からインデックスを解決
        device_index = None
        if config.device_name:
            device_index = find_device_index(config.device_name)
            if device_index is not None:
                logger.info("保存済みマイクを使用: %s", config.device_name)
            else:
                logger.warning("保存済みマイク '%s' が見つかりません。デフォルトを使用します", config.device_name)
        self._capture = AudioCapture(device_index=device_index)
        self._vad = VadGate(
            aggressiveness=config.vad_aggressiveness,
            start_threshold=config.vad_start_frames,
            end_threshold=config.vad_end_frames,
            max_speech_seconds=config.max_speech_seconds,
            volume_threshold=config.volume_threshold,
        )
        self._recognizer = SpeechRecognizer(
            api_key=config.google_api_key,
            language=config.language,
        )
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self) -> None:
        """別スレッドでマイクキャプチャ + VAD ループを開始する"""
        if self.is_running:
            return

        if not self._config.google_api_key:
            logger.warning("GOOGLE_CLOUD_API_KEY が未設定のため音声入力を開始できません")
            return

        self._stop_event.clear()

        try:
            self._capture.start()
        except Exception:
            logger.exception("マイクの初期化に失敗しました")
            return

        self._thread = threading.Thread(
            target=self._worker,
            name="voice-pipeline",
            daemon=True,
        )
        self._thread.start()
        logger.info("音声入力パイプラインを開始")

    def stop(self) -> None:
        """パイプラインを停止する"""
        if not self.is_running:
            return

        self._stop_event.set()
        self._capture.stop()

        if self._thread is not None:
            self._thread.join(timeout=3.0)
            self._thread = None

        self._vad.reset()
        logger.info("音声入力パイプラインを停止")

    def _worker(self) -> None:
        """ワーカースレッド: マイクからフレームを読み、VADで発話区間を検出する"""
        frame_count = 0
        while not self._stop_event.is_set():
            frame = self._capture.read_frame(timeout=0.5)
            if frame is None:
                continue

            frame_count += 1
            # 最初のフレーム受信をログ出力（マイクからデータが来ているか確認）
            if frame_count == 1:
                logger.info("マイクからフレーム受信開始 (%d bytes)", len(frame))
            # 1秒ごとに音量をログ出力（閾値調整用）
            if frame_count % 33 == 0:
                rms = _compute_rms(frame)
                logger.info("RMS: %d (閾値: %d)", rms, self._config.volume_threshold)

            audio_data = self._vad.process_frame(frame)
            if audio_data is not None:
                duration_s = len(audio_data) / (16000 * 2)
                logger.info("発話検出 → STT送信 (%.1f秒, %d bytes)", duration_s, len(audio_data))
                # 発話検出 — asyncio 側で STT を実行
                self._loop.call_soon_threadsafe(
                    asyncio.ensure_future,
                    self._recognize_and_emit(audio_data),
                )

    def set_device(self, device_index: int | None, device_name: str) -> None:
        """マイクデバイスを切り替える。実行中なら再起動する。"""
        was_running = self.is_running
        if was_running:
            self.stop()

        self._capture.set_device(device_index)
        self._config.device_name = device_name
        logger.info("マイクを切り替え: %s (index=%s)", device_name, device_index)

        if was_running:
            self.start()

    async def _recognize_and_emit(self, audio_data: bytes) -> None:
        """STT を実行し、ウェイクワードが含まれていればイベントバスに流す"""
        text = await self._recognizer.recognize(audio_data)
        if not text.strip():
            return

        logger.info("STT認識結果: %s", text)

        # エイリアス変換（誤認識パターンを「リリィ」に置換）
        for alias in self._config.wake_word_aliases:
            if alias in text:
                text = text.replace(alias, "リリィ")
                logger.info("エイリアス変換: %s → リリィ: %s", alias, text)

        # ウェイクワード判定
        wake_words = self._config.wake_words
        if self._config.use_wake_words and wake_words:
            matched = [w for w in wake_words if w in text]
            if not matched:
                logger.debug("ウェイクワード未検出のためスキップ: %s", text)
                return
            logger.info("ウェイクワード検出: %s → 応答生成へ", matched)

        bus.user_message_received.emit(text.strip())
