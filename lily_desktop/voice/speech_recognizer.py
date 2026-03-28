"""Google Cloud Speech-to-Text REST API クライアント"""

from __future__ import annotations

import base64
import logging

import httpx

from voice.audio_capture import SAMPLE_RATE

logger = logging.getLogger(__name__)

_STT_ENDPOINT = "https://speech.googleapis.com/v1/speech:recognize"


class SpeechRecognizer:
    """PCM 音声データを Google Cloud STT に送信して認識テキストを返す"""

    def __init__(self, api_key: str, language: str = "ja-JP"):
        self._api_key = api_key
        self._language = language

    async def recognize(self, audio_data: bytes) -> str:
        """PCM音声データをGoogle STTに送信し、認識テキストを返す。

        認識結果が空の場合は空文字列を返す。
        """
        audio_b64 = base64.b64encode(audio_data).decode("ascii")

        body = {
            "config": {
                "encoding": "LINEAR16",
                "sampleRateHertz": SAMPLE_RATE,
                "languageCode": self._language,
            },
            "audio": {
                "content": audio_b64,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    _STT_ENDPOINT,
                    params={"key": self._api_key},
                    json=body,
                )

            if not resp.is_success:
                detail = resp.text[:300]
                logger.error("STT API エラー: %d %s", resp.status_code, detail)
                return ""

            payload = resp.json()
            results = payload.get("results", [])
            if not results:
                logger.debug("STT: 認識結果なし")
                return ""

            # 最も信頼度の高い結果を返す
            transcript = results[0]["alternatives"][0].get("transcript", "")
            logger.info("STT 認識結果: %s", transcript)
            return transcript

        except Exception:
            logger.exception("STT 認識に失敗")
            return ""
