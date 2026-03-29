"""音声入力パイプライン — マイク → VAD → (話者照合) → STT → イベント発火"""

from __future__ import annotations

import asyncio
import logging
import threading

from core.config import VoiceConfig
from core.event_bus import bus
from voice.audio_capture import AudioCapture, find_device_index
from voice.speech_recognizer import SpeechRecognizer
from voice.vad import VadGate

logger = logging.getLogger(__name__)


class VoicePipeline:
    """マイク入力 → VAD → (話者照合) → Google STT → bus.user_message_received の統合パイプライン"""

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

        # 話者照合プロファイルの読み込み（有効時のみ）
        self._speaker_profile = None
        if config.speaker_verification_enabled:
            from voice.speaker_verifier import load_profile
            self._speaker_profile = load_profile(
                config.speaker_profile_path,
                threshold=config.speaker_verification_threshold,
            )
            if self._speaker_profile is None:
                logger.warning(
                    "話者プロファイルの読み込みに失敗。話者照合を無効化します。"
                    " enroll_speaker.py を実行してプロファイルを作成してください。"
                )

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

    def pause(self) -> None:
        """TTS再生中、マイク入力を一時停止する"""
        if self.is_running:
            self._capture.stop()
            self._vad.reset()
            logger.debug("マイク入力を一時停止（TTS再生中）")

    def resume(self) -> None:
        """TTS再生後、マイク入力を再開する"""
        if self.is_running:
            try:
                self._capture.start()
                logger.debug("マイク入力を再開")
            except Exception:
                logger.exception("マイク再開に失敗しました")

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

            audio_data = self._vad.process_frame(frame)
            if audio_data is not None:
                duration_s = len(audio_data) / (16000 * 2)
                logger.info("発話検出 → 処理開始 (%.1f秒, %d bytes)", duration_s, len(audio_data))
                # 発話検出 — asyncio 側で処理を実行
                self._loop.call_soon_threadsafe(
                    asyncio.ensure_future,
                    self._process_audio(audio_data),
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

    async def _process_audio(self, audio_data: bytes) -> None:
        """発話音声を処理する: (話者照合 →) STT → イベント発火"""
        # 話者照合（有効かつプロファイルが読み込まれている場合）
        if self._config.speaker_verification_enabled and self._speaker_profile is not None:
            accepted = await asyncio.get_event_loop().run_in_executor(
                None, self._verify_speaker, audio_data
            )
            if not accepted:
                return

        await self._recognize_and_emit(audio_data)

    def _verify_speaker(self, audio_data: bytes) -> bool:
        """話者照合を実行する（ブロッキング、executor から呼ぶ）。"""
        from voice.speaker_verifier import make_embedding_from_bytes, verify_embedding

        profile = self._speaker_profile
        try:
            test_emb = make_embedding_from_bytes(profile.classifier, audio_data)
            score, accepted = verify_embedding(profile.ref_embedding, test_emb, profile.threshold)
            logger.info(
                "話者照合: score=%.3f (閾値=%.2f) → %s",
                score,
                profile.threshold,
                "OK" if accepted else "NG (スキップ)",
            )
            return accepted
        except Exception:
            logger.exception("話者照合中にエラーが発生しました。照合をスキップします。")
            return True  # エラー時は通過させる

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

        # 無視ワード判定
        ignore_words = self._config.ignore_words
        if ignore_words:
            matched_ignore = [w for w in ignore_words if w in text]
            if matched_ignore:
                logger.info("無視ワード検出のためスキップ: %s (検出: %s)", text, matched_ignore)
                return

        # ウェイクワード判定
        wake_words = self._config.wake_words
        if self._config.use_wake_words and wake_words:
            matched = [w for w in wake_words if w in text]
            if not matched:
                logger.debug("ウェイクワード未検出のためスキップ: %s", text)
                return
            logger.info("ウェイクワード検出: %s → 応答生成へ", matched)

        bus.user_message_received.emit(text.strip())
