"""音声合成エンジン — VOICEVOX / Gemini TTS で音声合成し、キュー順に再生する"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
from dataclasses import dataclass

import httpx
import numpy as np
import sounddevice as sd
import soundfile as sf

from core.config import TTSConfig
from core.event_bus import bus

logger = logging.getLogger(__name__)


@dataclass
class _TTSJob:
    speaker: str
    text: str
    engine: str           # "voicevox" or "gemini"
    speaker_id: int       # VOICEVOX用
    gemini_voice: str     # Gemini TTS用


@dataclass
class _TTSAudioJob:
    """事前合成済み音声の再生専用ジョブ"""
    speaker: str
    audio_bytes: bytes
    audio_format: str     # "wav" or "pcm"


class TTSEngine:
    """VOICEVOX / Gemini TTS によるキュー順再生エンジン"""

    def __init__(self, config: TTSConfig):
        self._config = config
        self._queue: asyncio.Queue[_TTSJob | _TTSAudioJob] = asyncio.Queue()
        self._idle_event = asyncio.Event()
        self._idle_event.set()
        self._running = False
        self._http: httpx.AsyncClient | None = None        # VOICEVOX用
        self._gemini_http: httpx.AsyncClient | None = None  # Gemini TTS用
        self._worker_task: asyncio.Task | None = None
        self._current_job: _TTSJob | _TTSAudioJob | None = None
        self._current_job_done = asyncio.Event()
        self._current_job_done.set()

    async def start(self) -> None:
        """バックグラウンドワーカーを起動する。"""
        self._running = True

        uses_voicevox = (
            self._config.lily_engine == "voicevox"
            or self._config.haruka_engine == "voicevox"
        )
        uses_gemini = (
            self._config.lily_engine == "gemini"
            or self._config.haruka_engine == "gemini"
        )

        # VOICEVOX クライアント（必要な場合のみ）
        if uses_voicevox:
            self._http = httpx.AsyncClient(
                base_url=self._config.voicevox_url, timeout=30.0
            )
            try:
                r = await self._http.get("/version")
                logger.info("VOICEVOX 接続OK: version=%s", r.text.strip('"'))
            except Exception:
                logger.warning(
                    "VOICEVOX に接続できません (%s)。読み上げは無効です。",
                    self._config.voicevox_url,
                )

        # Gemini TTS クライアント（必要な場合のみ）
        if uses_gemini:
            if self._config.gemini_api_key:
                self._gemini_http = httpx.AsyncClient(timeout=30.0)
                logger.info(
                    "Gemini TTS を有効化 (model=%s)", self._config.gemini_model
                )
            else:
                logger.warning(
                    "Gemini TTS が設定されていますが GEMINI_API_KEY がありません"
                )

        self._worker_task = asyncio.ensure_future(self._worker())
        logger.info("TTSEngine を開始")

    async def stop(self) -> None:
        """エンジンを停止する。"""
        self._running = False
        if self._worker_task is not None:
            self._worker_task.cancel()
            self._worker_task = None
        if self._http is not None:
            await self._http.aclose()
            self._http = None
        if self._gemini_http is not None:
            await self._gemini_http.aclose()
            self._gemini_http = None
        logger.info("TTSEngine を停止")

    def enqueue(self, speaker: str, text: str) -> None:
        """TTS ジョブをキューに追加する（ノンブロッキング）。"""
        if not self._running:
            return
        engine, speaker_id, gemini_voice = self._resolve_speaker_config(speaker)
        self._idle_event.clear()
        self._queue.put_nowait(_TTSJob(
            speaker=speaker, text=text,
            engine=engine, speaker_id=speaker_id, gemini_voice=gemini_voice,
        ))

    async def wait_until_idle(self) -> None:
        """全キューの再生が完了するまで待つ（auto_conversation 用）。"""
        await self._idle_event.wait()

    @property
    def has_current_job(self) -> bool:
        """合成または再生中のTTSジョブがあるかを返す。"""
        return self._current_job is not None

    async def wait_current_job_done(self) -> None:
        """現在処理中の1ジョブが終わるまで待つ。"""
        await self._current_job_done.wait()

    async def synthesize(self, speaker: str, text: str) -> tuple[bytes, str] | None:
        """音声合成のみ実行する（再生・キュー投入なし）。プリフェッチ用。

        Returns:
            (audio_bytes, audio_format) or None.
            audio_format は "wav"（VOICEVOX）または "pcm"（Gemini）。
        """
        engine, speaker_id, gemini_voice = self._resolve_speaker_config(speaker)
        if engine == "gemini":
            data = await self._synthesize_gemini(text, gemini_voice)
            return (data, "pcm") if data else None
        else:
            data = await self._synthesize_voicevox(text, speaker_id)
            return (data, "wav") if data else None

    def enqueue_audio(
        self, speaker: str, audio_bytes: bytes, audio_format: str
    ) -> None:
        """事前合成済み音声をキューに追加する（合成スキップ、再生のみ）。"""
        if not self._running:
            return
        self._idle_event.clear()
        self._queue.put_nowait(
            _TTSAudioJob(
                speaker=speaker,
                audio_bytes=audio_bytes,
                audio_format=audio_format,
            )
        )

    def clear_queue(self) -> None:
        """キューをクリアし、再生中の音声も停止する（TTS停止・終了用）。"""
        self._drain_pending_queue()
        sd.stop()
        self._idle_event.set()

    def clear_pending_queue(self) -> None:
        """現在の再生は止めず、未再生のTTSジョブだけ破棄する。"""
        self._drain_pending_queue()
        if self._current_job is None:
            self._idle_event.set()
        else:
            self._idle_event.clear()

    def _drain_pending_queue(self) -> None:
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    def _resolve_speaker_config(self, speaker: str) -> tuple[str, int, str]:
        """話者名から (engine, voicevox_speaker_id, gemini_voice) を返す。"""
        if speaker in ("葉留佳", "はるちん", "はるか"):
            return (
                self._config.haruka_engine,
                self._config.haruka_speaker_id,
                self._config.haruka_gemini_voice,
            )
        return (
            self._config.lily_engine,
            self._config.lily_speaker_id,
            self._config.lily_gemini_voice,
        )

    async def _worker(self) -> None:
        """キューからジョブを取り出して順番に再生する。"""
        while self._running:
            try:
                job = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            try:
                self._current_job = job
                self._current_job_done.clear()
                if isinstance(job, _TTSAudioJob):
                    # 事前合成済み音声 → 合成スキップ、再生のみ
                    bus.tts_playback_started.emit()
                    if job.audio_format == "pcm":
                        await self._play_pcm_audio(job.audio_bytes)
                    else:
                        await self._play_audio(job.audio_bytes)
                    bus.tts_playback_finished.emit()
                elif job.engine == "gemini":
                    pcm_bytes = await self._synthesize_gemini(
                        job.text, job.gemini_voice
                    )
                    if pcm_bytes:
                        bus.tts_playback_started.emit()
                        await self._play_pcm_audio(pcm_bytes)
                        bus.tts_playback_finished.emit()
                else:
                    wav_bytes = await self._synthesize_voicevox(
                        job.text, job.speaker_id
                    )
                    if wav_bytes:
                        bus.tts_playback_started.emit()
                        await self._play_audio(wav_bytes)
                        bus.tts_playback_finished.emit()
            except Exception:
                logger.exception("TTS 再生エラー: %s", getattr(job, 'text', '(prefetched)')[:30])
            finally:
                self._current_job = None
                self._current_job_done.set()
                if self._queue.empty():
                    self._idle_event.set()

    # ---- VOICEVOX 合成 ----

    async def _synthesize_voicevox(self, text: str, speaker_id: int) -> bytes | None:
        """VOICEVOX の 2 ステップ API で音声合成する。"""
        if self._http is None:
            return None
        try:
            # Step 1: audio_query
            r1 = await self._http.post(
                "/audio_query",
                params={"text": text, "speaker": speaker_id},
            )
            r1.raise_for_status()
            query = r1.json()

            # Step 2: synthesis
            r2 = await self._http.post(
                "/synthesis",
                params={"speaker": speaker_id},
                json=query,
            )
            r2.raise_for_status()
            return r2.content

        except httpx.ConnectError:
            logger.warning("VOICEVOX に接続できません: %s", self._config.voicevox_url)
            return None
        except Exception:
            logger.exception("VOICEVOX 音声合成エラー")
            return None

    # ---- Gemini TTS 合成 ----

    async def _synthesize_gemini(self, text: str, voice_name: str) -> bytes | None:
        """Gemini TTS API で音声合成し、PCM-16 バイト列を返す。"""
        if self._gemini_http is None:
            return None
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self._config.gemini_model}:generateContent"
        )
        payload = {
            "contents": [{"role": "user", "parts": [{"text": text}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": voice_name},
                    },
                },
            },
        }
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self._config.gemini_api_key,
        }
        try:
            r = await self._gemini_http.post(url, json=payload, headers=headers)
            if not r.is_success:
                logger.error(
                    "Gemini TTS API エラー %d: %s", r.status_code, r.text[:500]
                )
                return None
            data = r.json()
            inline = (
                data["candidates"][0]["content"]["parts"][0]["inlineData"]
            )
            return base64.b64decode(inline["data"])
        except httpx.ConnectError:
            logger.warning("Gemini TTS API に接続できません")
            return None
        except Exception:
            logger.exception("Gemini TTS 音声合成エラー")
            return None

    # ---- 再生 ----

    async def _play_audio(self, wav_bytes: bytes) -> None:
        """WAV バイト列を再生する（ブロッキング部分は executor で実行）。"""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._play_wav_blocking, wav_bytes)

    async def _play_pcm_audio(self, pcm_bytes: bytes) -> None:
        """PCM-16 バイト列を再生する（ブロッキング部分は executor で実行）。"""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._play_pcm_blocking, pcm_bytes)

    @staticmethod
    def _play_wav_blocking(wav_bytes: bytes) -> None:
        """sounddevice + soundfile で WAV を同期再生する。"""
        data, samplerate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
        sd.play(data, samplerate)
        sd.wait()

    @staticmethod
    def _play_pcm_blocking(pcm_bytes: bytes, samplerate: int = 24000) -> None:
        """Raw PCM-16 (mono, little-endian) を同期再生する。"""
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0
        sd.play(samples, samplerate)
        sd.wait()
