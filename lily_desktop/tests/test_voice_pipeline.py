"""Tests for microphone resume recovery."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core.config import VoiceConfig
from voice.voice_pipeline import VoicePipeline


class _FakeVadGate:
    def __init__(self, *args, **kwargs):
        pass

    def reset(self) -> None:
        return None

    def process_frame(self, frame: bytes) -> None:
        return None


class _FakeSpeechRecognizer:
    def __init__(self, *args, **kwargs):
        pass

    async def recognize(self, audio_data: bytes) -> str:
        return "リリィ テスト"


class _AliveThread:
    def __init__(self):
        self._alive = True

    def is_alive(self) -> bool:
        return self._alive

    def join(self, timeout: float | None = None) -> None:
        self._alive = False


class _ThreadFactory:
    def __init__(self, *args, **kwargs):
        self._alive = False

    def start(self) -> None:
        self._alive = True

    def is_alive(self) -> bool:
        return self._alive

    def join(self, timeout: float | None = None) -> None:
        self._alive = False


class _FakeCapture:
    def __init__(self, device_index: int | None = None, start_behavior=None):
        self._device_index = device_index
        self._start_behavior = start_behavior or (lambda device_index: None)
        self.start_calls: list[int | None] = []
        self.set_device_calls: list[int | None] = []
        self.stop_calls = 0

    def set_device(self, device_index: int | None) -> None:
        self._device_index = device_index
        self.set_device_calls.append(device_index)

    def start(self) -> None:
        self.start_calls.append(self._device_index)
        self._start_behavior(self._device_index)

    def stop(self) -> None:
        self.stop_calls += 1

    def read_frame(self, timeout: float = 1.0) -> None:
        return None


class _ImmediateExecutorLoop:
    def __init__(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop

    def run_in_executor(self, executor, func, *args):
        future = self._loop.create_future()
        try:
            future.set_result(func(*args))
        except Exception as exc:
            future.set_exception(exc)
        return future


def _make_config(device_name: str = "Yeti Nano") -> VoiceConfig:
    return VoiceConfig(
        enabled=True,
        google_api_key="test-google-key",
        device_name=device_name,
    )


def _build_pipeline(
    monkeypatch,
    *,
    find_device_index,
    capture: _FakeCapture,
    loop: asyncio.AbstractEventLoop | None = None,
) -> VoicePipeline:
    import voice.voice_pipeline as mod

    monkeypatch.setattr(mod, "VadGate", _FakeVadGate)
    monkeypatch.setattr(mod, "SpeechRecognizer", _FakeSpeechRecognizer)
    monkeypatch.setattr(mod, "find_device_index", find_device_index)
    monkeypatch.setattr(mod, "AudioCapture", lambda device_index=None: capture)
    monkeypatch.setattr(mod.threading, "Thread", _ThreadFactory)

    loop = loop or asyncio.new_event_loop()
    pipeline = VoicePipeline(_make_config(), loop)
    pipeline._thread = _AliveThread()
    return pipeline


JST = timezone(timedelta(hours=9))


def test_process_audio_saves_verified_recording_when_enabled(monkeypatch):
    import voice.voice_pipeline as mod

    capture = _FakeCapture()
    pipeline = _build_pipeline(
        monkeypatch,
        find_device_index=lambda device_name: 5,
        capture=capture,
    )
    pipeline._config.speaker_verification_enabled = True
    pipeline._config.speaker_verification_recording_enabled = True
    pipeline._config.speaker_verification_recording_threshold = 0.25
    pipeline._speaker_profile = type("Profile", (), {"threshold": 0.25})()

    saved_audio: list[bytes] = []
    saved_thresholds: list[float] = []
    recognized_audio: list[bytes] = []

    monkeypatch.setattr(
        pipeline,
        "_verify_speaker",
        lambda audio_data: {"score": 0.31, "accepted": True},
    )

    def fake_save_verified_recording(audio_data: bytes, threshold: float) -> Path:
        saved_audio.append(audio_data)
        saved_thresholds.append(threshold)
        return Path(f"verified_{threshold}.wav")

    async def fake_recognize_and_emit(audio_data: bytes) -> None:
        recognized_audio.append(audio_data)

    monkeypatch.setattr(pipeline, "_save_verified_recording", fake_save_verified_recording)
    monkeypatch.setattr(pipeline, "_recognize_and_emit", fake_recognize_and_emit)
    loop = asyncio.new_event_loop()
    monkeypatch.setattr(mod.asyncio, "get_event_loop", lambda: _ImmediateExecutorLoop(loop))

    try:
        loop.run_until_complete(pipeline._process_audio(b"accepted-audio"))
    finally:
        loop.close()

    assert saved_audio == [b"accepted-audio"]
    assert saved_thresholds == [0.25]
    assert recognized_audio == [b"accepted-audio"]


def test_process_audio_saves_recording_for_learning_even_when_rejected(monkeypatch):
    import voice.voice_pipeline as mod

    capture = _FakeCapture()
    pipeline = _build_pipeline(
        monkeypatch,
        find_device_index=lambda device_name: 5,
        capture=capture,
    )
    pipeline._config.speaker_verification_enabled = True
    pipeline._config.speaker_verification_recording_enabled = True
    pipeline._config.speaker_verification_recording_threshold = 0.25
    pipeline._speaker_profile = type("Profile", (), {"threshold": 0.36})()

    saved_audio: list[bytes] = []
    recognized_audio: list[bytes] = []

    monkeypatch.setattr(
        pipeline,
        "_verify_speaker",
        lambda audio_data: {"score": 0.30, "accepted": False},
    )

    def fake_save_verified_recording(audio_data: bytes, threshold: float) -> Path:
        saved_audio.append(audio_data)
        return Path(f"verified_{threshold}.wav")

    async def fake_recognize_and_emit(audio_data: bytes) -> None:
        recognized_audio.append(audio_data)

    monkeypatch.setattr(pipeline, "_save_verified_recording", fake_save_verified_recording)
    monkeypatch.setattr(pipeline, "_recognize_and_emit", fake_recognize_and_emit)
    loop = asyncio.new_event_loop()
    monkeypatch.setattr(mod.asyncio, "get_event_loop", lambda: _ImmediateExecutorLoop(loop))

    try:
        loop.run_until_complete(pipeline._process_audio(b"accepted-audio"))
    finally:
        loop.close()

    assert saved_audio == [b"accepted-audio"]
    assert recognized_audio == []


def test_process_audio_skips_verified_recording_when_disabled(monkeypatch):
    import voice.voice_pipeline as mod

    capture = _FakeCapture()
    pipeline = _build_pipeline(
        monkeypatch,
        find_device_index=lambda device_name: 5,
        capture=capture,
    )
    pipeline._config.speaker_verification_enabled = True
    pipeline._config.speaker_verification_recording_enabled = False
    pipeline._config.speaker_verification_recording_threshold = 0.25
    pipeline._speaker_profile = type("Profile", (), {"threshold": 0.25})()

    recognized_audio: list[bytes] = []

    monkeypatch.setattr(
        pipeline,
        "_verify_speaker",
        lambda audio_data: {"score": 0.31, "accepted": True},
    )

    def fail_if_called(*args, **kwargs) -> Path:
        raise AssertionError("recording save should be disabled")

    async def fake_recognize_and_emit(audio_data: bytes) -> None:
        recognized_audio.append(audio_data)

    monkeypatch.setattr(pipeline, "_save_verified_recording", fail_if_called)
    monkeypatch.setattr(pipeline, "_recognize_and_emit", fake_recognize_and_emit)
    loop = asyncio.new_event_loop()
    monkeypatch.setattr(mod.asyncio, "get_event_loop", lambda: _ImmediateExecutorLoop(loop))

    try:
        loop.run_until_complete(pipeline._process_audio(b"accepted-audio"))
    finally:
        loop.close()

    assert recognized_audio == [b"accepted-audio"]


def test_save_verified_recording_uses_threshold_and_jst_timestamp(tmp_path, monkeypatch):
    import voice.voice_pipeline as mod

    capture = _FakeCapture()
    pipeline = _build_pipeline(
        monkeypatch,
        find_device_index=lambda device_name: 5,
        capture=capture,
    )
    pipeline._verified_recordings_dir = tmp_path

    class _FixedDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 4, 12, 9, 10, 11, tzinfo=JST)

    monkeypatch.setattr(mod, "datetime", _FixedDateTime)

    saved_path = pipeline._save_verified_recording(b"\x01\x00\x02\x00", 0.25)

    assert saved_path.name == "speaker_verified_threshold0.25_20260412_091011.wav"
    assert saved_path.exists()


def test_resume_reresolves_saved_device_and_falls_back_to_default(monkeypatch):
    def start_behavior(device_index: int | None) -> None:
        if device_index == 5:
            raise RuntimeError("preferred device failed")

    capture = _FakeCapture(start_behavior=start_behavior)
    pipeline = _build_pipeline(
        monkeypatch,
        find_device_index=lambda device_name: 5,
        capture=capture,
    )

    pipeline.resume()

    assert capture.start_calls == [5, None]


def test_resume_disables_auto_resume_after_primary_and_fallback_failures(monkeypatch):
    def start_behavior(device_index: int | None) -> None:
        raise RuntimeError(f"failed for {device_index}")

    capture = _FakeCapture(start_behavior=start_behavior)
    pipeline = _build_pipeline(
        monkeypatch,
        find_device_index=lambda device_name: 5,
        capture=capture,
    )

    pipeline.resume()
    first_start_calls = list(capture.start_calls)
    pipeline.resume()

    assert first_start_calls == [5, None]
    assert capture.start_calls == first_start_calls


def test_set_device_reenables_auto_resume_after_resume_failure(monkeypatch):
    def find_device_index(device_name: str) -> int | None:
        if device_name == "New Mic":
            return 7
        return 5

    def start_behavior(device_index: int | None) -> None:
        if device_index in (5, None):
            raise RuntimeError(f"failed for {device_index}")

    capture = _FakeCapture(start_behavior=start_behavior)
    pipeline = _build_pipeline(
        monkeypatch,
        find_device_index=find_device_index,
        capture=capture,
    )

    pipeline.resume()
    pipeline.set_device(7, "New Mic")
    pipeline.pause()
    pipeline.resume()

    assert capture.start_calls == [5, None, 7, 7]
