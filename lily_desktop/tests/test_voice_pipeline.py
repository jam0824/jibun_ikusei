"""Tests for microphone resume recovery."""

from __future__ import annotations

import asyncio

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


def _make_config(device_name: str = "Yeti Nano") -> VoiceConfig:
    return VoiceConfig(
        enabled=True,
        google_api_key="test-google-key",
        device_name=device_name,
    )


def _build_pipeline(monkeypatch, *, find_device_index, capture: _FakeCapture) -> VoicePipeline:
    import voice.voice_pipeline as mod

    monkeypatch.setattr(mod, "VadGate", _FakeVadGate)
    monkeypatch.setattr(mod, "SpeechRecognizer", _FakeSpeechRecognizer)
    monkeypatch.setattr(mod, "find_device_index", find_device_index)
    monkeypatch.setattr(mod, "AudioCapture", lambda device_index=None: capture)
    monkeypatch.setattr(mod.threading, "Thread", _ThreadFactory)

    loop = asyncio.new_event_loop()
    pipeline = VoicePipeline(_make_config(), loop)
    pipeline._thread = _AliveThread()
    return pipeline


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
