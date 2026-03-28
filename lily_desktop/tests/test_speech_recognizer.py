"""SpeechRecognizer のユニットテスト"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from voice.speech_recognizer import SpeechRecognizer


@pytest.fixture
def recognizer():
    return SpeechRecognizer(api_key="test-api-key", language="ja-JP")


def _make_mock_response(*, is_success: bool, json_data: dict | None = None,
                         status_code: int = 200, text: str = ""):
    """httpx レスポンスのモックを作成する"""
    mock = MagicMock()
    mock.is_success = is_success
    mock.status_code = status_code
    mock.text = text
    if json_data is not None:
        mock.json.return_value = json_data
    return mock


def _patch_httpx(mock_response):
    """httpx.AsyncClient をモックするコンテキストマネージャを返す"""
    mock_client = AsyncMock()
    mock_client.post.return_value = mock_response

    mock_cls = MagicMock()
    mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

    return patch("voice.speech_recognizer.httpx.AsyncClient", mock_cls)


class TestSpeechRecognizer:
    @pytest.mark.asyncio
    async def test_認識成功時にテキストを返す(self, recognizer):
        """正常なAPIレスポンスからtranscriptを取得する"""
        resp = _make_mock_response(
            is_success=True,
            json_data={
                "results": [
                    {"alternatives": [{"transcript": "こんにちは", "confidence": 0.95}]}
                ]
            },
        )
        with _patch_httpx(resp):
            result = await recognizer.recognize(b"\x00" * 960)
            assert result == "こんにちは"

    @pytest.mark.asyncio
    async def test_認識結果が空の場合は空文字列を返す(self, recognizer):
        """resultsが空の場合"""
        resp = _make_mock_response(is_success=True, json_data={})
        with _patch_httpx(resp):
            result = await recognizer.recognize(b"\x00" * 960)
            assert result == ""

    @pytest.mark.asyncio
    async def test_APIエラー時は空文字列を返す(self, recognizer):
        """HTTPエラーの場合"""
        resp = _make_mock_response(is_success=False, status_code=403, text="Forbidden")
        with _patch_httpx(resp):
            result = await recognizer.recognize(b"\x00" * 960)
            assert result == ""

    @pytest.mark.asyncio
    async def test_例外発生時は空文字列を返す(self, recognizer):
        """ネットワークエラーなどの例外"""
        mock_client = AsyncMock()
        mock_client.post.side_effect = Exception("Network error")

        mock_cls = MagicMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("voice.speech_recognizer.httpx.AsyncClient", mock_cls):
            result = await recognizer.recognize(b"\x00" * 960)
            assert result == ""
