"""VAD ゲート — webrtcvad で発話区間を検出する"""

from __future__ import annotations

import logging
import math
import struct

import webrtcvad

from voice.audio_capture import FRAME_BYTES, FRAME_DURATION_MS, SAMPLE_RATE

logger = logging.getLogger(__name__)

# デフォルトの発話検出パラメータ
_START_THRESHOLD = 10   # 発話開始に必要な連続音声フレーム数
_END_THRESHOLD = 30     # 発話終了と判定する連続無音フレーム数
_MAX_DURATION_S = 55    # 最大発話時間（秒）— STT制限60秒に余裕を持たせる
_MAX_FRAMES = int(_MAX_DURATION_S * 1000 / FRAME_DURATION_MS)


def _compute_rms(frame: bytes) -> int:
    """フレームのRMS振幅を計算する（16bit PCM）"""
    n_samples = len(frame) // 2
    samples = struct.unpack(f"<{n_samples}h", frame)
    sum_sq = sum(s * s for s in samples)
    return int(math.sqrt(sum_sq / n_samples))


class VadGate:
    """フレーム単位で音声/無音を判定し、発話区間を切り出す"""

    def __init__(
        self,
        aggressiveness: int = 3,
        start_threshold: int = _START_THRESHOLD,
        end_threshold: int = _END_THRESHOLD,
        max_speech_seconds: float = _MAX_DURATION_S,
        volume_threshold: int = 0,
    ):
        self._vad = webrtcvad.Vad(aggressiveness)
        self._start_threshold = start_threshold
        self._end_threshold = end_threshold
        self._max_frames = int(max_speech_seconds * 1000 / FRAME_DURATION_MS)
        self._volume_threshold = volume_threshold
        self.reset()

    def reset(self) -> None:
        """状態をリセットする"""
        self._is_speaking = False
        self._speech_frames: list[bytes] = []
        self._voiced_count = 0    # 連続音声フレーム数
        self._silence_count = 0   # 連続無音フレーム数

    def process_frame(self, frame: bytes) -> bytes | None:
        """フレームを処理し、発話が完了したら全体の音声bytesを返す。

        発話中 or 無音中は None を返す。
        """
        # フレームサイズが合わない場合はスキップ
        if len(frame) != FRAME_BYTES:
            return None

        # 音量閾値フィルター
        if self._volume_threshold > 0:
            rms = _compute_rms(frame)
            if rms < self._volume_threshold:
                # 音量が低い → 無音として扱う
                is_speech = False
            else:
                is_speech = self._vad.is_speech(frame, SAMPLE_RATE)
        else:
            is_speech = self._vad.is_speech(frame, SAMPLE_RATE)

        if not self._is_speaking:
            # 待機中 — 発話開始を検出
            if is_speech:
                self._voiced_count += 1
                self._speech_frames.append(frame)
                if self._voiced_count >= self._start_threshold:
                    self._is_speaking = True
                    self._silence_count = 0
                    rms = _compute_rms(frame)
                    logger.info("発話開始を検出 (RMS: %d)", rms)
            else:
                self._voiced_count = 0
                self._speech_frames.clear()
        else:
            # 発話中 — 発話終了を検出
            self._speech_frames.append(frame)

            if is_speech:
                self._silence_count = 0
            else:
                self._silence_count += 1

            # 発話終了判定
            if self._silence_count >= self._end_threshold:
                return self._finalize()

            # 最大長に達した場合は強制終了
            if len(self._speech_frames) >= self._max_frames:
                logger.info("最大発話時間(%.1f秒)に達したため終了", self._max_frames * FRAME_DURATION_MS / 1000)
                return self._finalize()

        return None

    def _finalize(self) -> bytes:
        """蓄積したフレームを結合して返し、状態をリセットする"""
        audio_data = b"".join(self._speech_frames)
        duration_ms = len(self._speech_frames) * FRAME_DURATION_MS
        logger.info("発話区間を検出: %d ms (%d bytes)", duration_ms, len(audio_data))
        self.reset()
        return audio_data
