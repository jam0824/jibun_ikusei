"""状況記録のユニットテスト"""

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import pytest

from core.situation_logger import SituationLogger, SituationRecord


@pytest.fixture
def logger_instance(tmp_path, monkeypatch):
    """テスト用のSituationLoggerを作成する（ログディレクトリをtmp_pathに差し替え）"""
    import core.situation_logger as mod
    monkeypatch.setattr(mod, "_LOG_DIR", tmp_path)
    return SituationLogger(
        openai_api_key="test-key",
        summary_model="gpt-5.4",
    )


class _FakeResponse:
    def __init__(self, payload: dict[str, Any], status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = ""

    @property
    def is_success(self) -> bool:
        return 200 <= self.status_code < 300

    def json(self) -> dict[str, Any]:
        return self._payload


class _FakeAsyncClient:
    def __init__(self, responses: Sequence[_FakeResponse]):
        self._responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def post(self, url: str, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self._responses.pop(0)


class TestSituationLogger:
    def test_記録がJSONLファイルに追記される(self, logger_instance, tmp_path):
        record = SituationRecord(
            timestamp="2026-03-29 12:00:00",
            camera_summary="外は晴れ",
            camera_tags=["天気"],
            camera_scene_type="weather",
            desktop_summary="コーディング中",
            desktop_tags=["開発"],
            desktop_activity_type="coding",
            active_app="VSCode",
            window_title="main.py",
        )
        logger_instance.record(record)

        # ログファイルが作成されている
        log_files = list(tmp_path.glob("*.jsonl"))
        assert len(log_files) == 1

        # JSONLの中身を確認
        lines = log_files[0].read_text(encoding="utf-8").strip().split("\n")
        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["camera_summary"] == "外は晴れ"
        assert data["desktop_summary"] == "コーディング中"
        assert data["active_app"] == "VSCode"

    def test_複数記録が同一ファイルに追記される(self, logger_instance, tmp_path):
        for i in range(3):
            record = SituationRecord(
                timestamp=f"2026-03-29 12:0{i}:00",
                camera_summary=f"状況{i}",
            )
            logger_instance.record(record)

        log_files = list(tmp_path.glob("*.jsonl"))
        assert len(log_files) == 1
        lines = log_files[0].read_text(encoding="utf-8").strip().split("\n")
        assert len(lines) == 3

    def test_バッファが蓄積される(self, logger_instance):
        record = SituationRecord(timestamp="2026-03-29 12:00:00", camera_summary="テスト")
        logger_instance.record(record)
        assert len(logger_instance._pending_records) == 1

    @pytest.mark.asyncio
    async def test_記録がない場合はNoneを返す(self, logger_instance):
        result = await logger_instance.generate_summary()
        assert result is None


@pytest.mark.asyncio
async def test_generate_summary_uses_openai_default_max_completion_tokens(tmp_path, monkeypatch):
    import core.situation_logger as mod

    fake_client = _FakeAsyncClient(
        [
            _FakeResponse(
                {
                    "choices": [
                        {
                            "message": {"content": "30分の要約です"},
                            "finish_reason": "stop",
                        }
                    ]
                }
            )
        ]
    )
    monkeypatch.setattr(mod, "_LOG_DIR", tmp_path)
    monkeypatch.setattr(mod.httpx, "AsyncClient", lambda timeout=30.0: fake_client)

    logger_instance = SituationLogger(
        openai_api_key="test-key",
        summary_provider="openai",
        summary_model="gpt-5-nano",
    )
    logger_instance.record(
        SituationRecord(
            timestamp="2026-03-29 12:00:00",
            camera_summary="外は晴れ",
            desktop_summary="コーディング中",
            active_app="VSCode",
        )
    )

    result = await logger_instance.generate_summary()

    assert result is not None
    assert len(fake_client.calls) == 1
    request = fake_client.calls[0]
    assert request["url"] == "https://api.openai.com/v1/chat/completions"
    assert request["json"]["max_completion_tokens"] == 1600
