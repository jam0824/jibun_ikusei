from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from voice.tts import TTSEngine


def _make_config() -> SimpleNamespace:
    return SimpleNamespace(
        lily_engine="voicevox",
        haruka_engine="voicevox",
        lily_speaker_id=20,
        haruka_speaker_id=3,
        lily_gemini_voice="",
        haruka_gemini_voice="",
        voicevox_url="http://localhost:50021",
        gemini_api_key="",
        gemini_model="",
    )


@pytest.mark.asyncio
async def test_soft_interrupt_clears_pending_queue_without_stopping_current_audio(monkeypatch):
    engine = TTSEngine(_make_config())
    engine._running = True
    engine.enqueue("リリィ", "pending 1")
    engine.enqueue("葉留佳", "pending 2")
    engine._current_job = SimpleNamespace(text="current")
    engine._current_job_done.clear()
    engine._idle_event.clear()

    stop = Mock()
    monkeypatch.setattr("voice.tts.sd.stop", stop)

    engine.clear_pending_queue()

    assert engine._queue.empty()
    assert engine._idle_event.is_set() is False
    stop.assert_not_called()


@pytest.mark.asyncio
async def test_soft_interrupt_marks_idle_when_there_is_no_current_audio(monkeypatch):
    engine = TTSEngine(_make_config())
    engine._running = True
    engine.enqueue("リリィ", "pending")
    engine._idle_event.clear()

    stop = Mock()
    monkeypatch.setattr("voice.tts.sd.stop", stop)

    engine.clear_pending_queue()

    assert engine._queue.empty()
    assert engine._idle_event.is_set() is True
    stop.assert_not_called()
