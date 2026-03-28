"""音声合成エンジン — VOICEVOX で TTS を実行し、キュー順に再生する"""

from __future__ import annotations

import asyncio
import io
import logging
from dataclasses import dataclass

import httpx
import sounddevice as sd
import soundfile as sf

from core.config import TTSConfig
from core.event_bus import bus

logger = logging.getLogger(__name__)


@dataclass
class _TTSJob:
    speaker: str
    text: str
    speaker_id: int


class TTSEngine:
    """VOICEVOX による TTS + キュー順再生エンジン"""

    def __init__(self, config: TTSConfig):
        self._config = config
        self._queue: asyncio.Queue[_TTSJob] = asyncio.Queue()
        self._idle_event = asyncio.Event()
        self._idle_event.set()
        self._running = False
        self._http: httpx.AsyncClient | None = None
        self._worker_task: asyncio.Task | None = None

    async def start(self) -> None:
        """バックグラウンドワーカーを起動する。"""
        self._http = httpx.AsyncClient(
            base_url=self._config.voicevox_url, timeout=30.0
        )
        self._running = True

        # VOICEVOX の接続確認
        try:
            r = await self._http.get("/version")
            logger.info("VOICEVOX 接続OK: version=%s", r.text.strip('"'))
        except Exception:
            logger.warning(
                "VOICEVOX に接続できません (%s)。読み上げは無効です。",
                self._config.voicevox_url,
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
        logger.info("TTSEngine を停止")

    def enqueue(self, speaker: str, text: str) -> None:
        """TTS ジョブをキューに追加する（ノンブロッキング）。"""
        if not self._running:
            return
        speaker_id = self._resolve_speaker_id(speaker)
        self._idle_event.clear()
        self._queue.put_nowait(_TTSJob(speaker=speaker, text=text, speaker_id=speaker_id))

    async def wait_until_idle(self) -> None:
        """全キューの再生が完了するまで待つ（auto_conversation 用）。"""
        await self._idle_event.wait()

    def clear_queue(self) -> None:
        """キューをクリアし、再生中の音声も停止する（ユーザー割り込み用）。"""
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        sd.stop()
        self._idle_event.set()

    def _resolve_speaker_id(self, speaker: str) -> int:
        """話者名から speaker_id を解決する。"""
        if speaker in ("葉留佳", "はるちん", "はるか"):
            return self._config.haruka_speaker_id
        return self._config.lily_speaker_id

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
                wav_bytes = await self._synthesize(job.text, job.speaker_id)
                if wav_bytes:
                    bus.tts_playback_started.emit()
                    await self._play_audio(wav_bytes)
                    bus.tts_playback_finished.emit()
            except Exception:
                logger.exception("TTS 再生エラー: %s", job.text[:30])
            finally:
                if self._queue.empty():
                    self._idle_event.set()

    async def _synthesize(self, text: str, speaker_id: int) -> bytes | None:
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

    async def _play_audio(self, wav_bytes: bytes) -> None:
        """WAV バイト列を再生する（ブロッキング部分は executor で実行）。"""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._play_blocking, wav_bytes)

    @staticmethod
    def _play_blocking(wav_bytes: bytes) -> None:
        """sounddevice + soundfile で WAV を同期再生する。"""
        data, samplerate = sf.read(io.BytesIO(wav_bytes), dtype="float32")
        sd.play(data, samplerate)
        sd.wait()
