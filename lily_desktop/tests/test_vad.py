"""VadGate のユニットテスト"""

import struct
import math

import pytest

from voice.audio_capture import FRAME_BYTES, FRAME_DURATION_MS, SAMPLE_RATE
from voice.vad import VadGate, _END_THRESHOLD, _MAX_FRAMES, _START_THRESHOLD


def _make_silence_frame() -> bytes:
    """無音フレーム（960バイトのゼロ）"""
    return b"\x00" * FRAME_BYTES


def _make_speech_frame(frequency: int = 440, amplitude: int = 16000) -> bytes:
    """疑似音声フレーム（サイン波を生成してwebrtcvadが音声と判定するデータ）"""
    samples = FRAME_BYTES // 2
    data = bytearray()
    for i in range(samples):
        t = i / SAMPLE_RATE
        val = int(amplitude * math.sin(2 * math.pi * frequency * t))
        val = max(-32768, min(32767, val))
        data += struct.pack("<h", val)
    return bytes(data)


class TestVadGate:
    def test_無音のみでは発話を検出しない(self):
        vad = VadGate(aggressiveness=1)
        for _ in range(100):
            result = vad.process_frame(_make_silence_frame())
            assert result is None

    def test_発話開始後に無音が続くと発話を検出する(self):
        """十分な音声→十分な無音で発話区間のbytesが返る"""
        vad = VadGate(aggressiveness=0)  # 最も緩い判定

        # 発話開始
        speech = _make_speech_frame()
        for _ in range(_START_THRESHOLD + 20):
            vad.process_frame(speech)

        # 発話終了
        silence = _make_silence_frame()
        result = None
        for _ in range(_END_THRESHOLD + 10):
            result = vad.process_frame(silence)
            if result is not None:
                break

        assert result is not None
        assert isinstance(result, bytes)
        assert len(result) > 0

    def test_最大発話時間で強制分割される(self):
        """MAX_FRAMESを超えるとbytesが返る"""
        vad = VadGate(aggressiveness=0)

        speech = _make_speech_frame()
        result = None
        for _ in range(_MAX_FRAMES + _START_THRESHOLD + 10):
            result = vad.process_frame(speech)
            if result is not None:
                break

        assert result is not None
        assert isinstance(result, bytes)

    def test_リセット後は初期状態に戻る(self):
        vad = VadGate(aggressiveness=0)

        speech = _make_speech_frame()
        for _ in range(_START_THRESHOLD + 20):
            vad.process_frame(speech)

        vad.reset()
        assert vad._is_speaking is False
        assert len(vad._speech_frames) == 0

    def test_不正なフレームサイズはスキップされる(self):
        vad = VadGate(aggressiveness=1)
        result = vad.process_frame(b"\x00" * 100)
        assert result is None
