"""状況記録 — カメラ+デスクトップ+アクティブアプリの状況をローカルに記録し、定期要約を生成する"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

_BASE_DIR = Path(__file__).resolve().parent.parent
_LOG_DIR = _BASE_DIR / "logs" / "situations"


@dataclass
class SituationRecord:
    """1回分の状況記録"""
    timestamp: str = ""
    # カメラ
    camera_summary: str = ""
    camera_tags: list[str] = field(default_factory=list)
    camera_scene_type: str = ""
    # デスクトップ
    desktop_summary: str = ""
    desktop_tags: list[str] = field(default_factory=list)
    desktop_activity_type: str = ""
    # アクティブアプリ
    active_app: str = ""
    window_title: str = ""


class SituationLogger:
    """状況をローカルJSONLに記録し、定期的に要約を生成する"""

    def __init__(self, *, openai_api_key: str, summary_model: str):
        self._openai_api_key = openai_api_key
        self._summary_model = summary_model
        self._pending_records: list[SituationRecord] = []
        _LOG_DIR.mkdir(parents=True, exist_ok=True)

    def _log_file_path(self) -> Path:
        """今日の日付のログファイルパスを返す"""
        today = datetime.now(JST).strftime("%Y-%m-%d")
        return _LOG_DIR / f"{today}.jsonl"

    def record(self, record: SituationRecord) -> None:
        """状況をローカルファイルに追記し、要約用バッファに保持する"""
        # JSONL に追記
        log_path = self._log_file_path()
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(record), ensure_ascii=False) + "\n")

        self._pending_records.append(record)
        logger.info("状況記録: camera=%s desktop=%s app=%s",
                     record.camera_summary, record.desktop_summary, record.active_app)

    async def generate_summary(self) -> dict | None:
        """蓄積した記録から30分間の要約を生成し、バッファをクリアする。

        Returns:
            サーバー送信用の要約dict。記録がない場合はNone。
            {
                "summary": "要約テキスト",
                "timestamp": "ISO8601",
                "details": {
                    "camera_summaries": [...],
                    "desktop_summaries": [...],
                    "active_apps": [...]
                }
            }
        """
        if not self._pending_records:
            logger.info("要約対象の記録がありません")
            return None

        records_text = self._format_records_for_summary()
        details = self._extract_details()
        self._pending_records.clear()

        try:
            summary_text = await self._call_summary_ai(records_text)
            logger.info("30分要約を生成: %s", summary_text[:100])
            now = datetime.now(JST).strftime("%Y-%m-%dT%H:%M:%S+09:00")
            return {
                "summary": summary_text,
                "timestamp": now,
                "details": details,
            }
        except Exception:
            logger.exception("要約生成に失敗")
            return None

    def _extract_details(self) -> dict:
        """バッファ内の記録から詳細情報を抽出する"""
        camera_summaries: list[str] = []
        desktop_summaries: list[str] = []
        active_apps: list[str] = []

        for r in self._pending_records:
            if r.camera_summary:
                camera_summaries.append(r.camera_summary)
            if r.desktop_summary:
                desktop_summaries.append(r.desktop_summary)
            if r.active_app and r.active_app not in active_apps:
                active_apps.append(r.active_app)

        return {
            "camera_summaries": camera_summaries,
            "desktop_summaries": desktop_summaries,
            "active_apps": active_apps,
        }

    def _format_records_for_summary(self) -> str:
        """バッファ内の記録を要約AI用のテキストに整形する"""
        lines: list[str] = []
        for r in self._pending_records:
            parts = [f"[{r.timestamp}]"]
            if r.camera_summary:
                parts.append(f"カメラ: {r.camera_summary}")
            if r.desktop_summary:
                parts.append(f"デスクトップ: {r.desktop_summary}")
            if r.active_app:
                parts.append(f"アプリ: {r.active_app}")
            lines.append(" / ".join(parts))
        return "\n".join(lines)

    async def _call_summary_ai(self, records_text: str) -> str:
        """要約AIを呼び出す"""
        system = (
            "あなたは状況記録を要約するアシスタントです。\n"
            "以下の時系列の状況記録を読み、この30分間にユーザーの周囲と"
            "デスクトップで何が起きていたかを自然な日本語で3〜5文に要約してください。\n"
            "個人情報や機密情報は含めないでください。"
        )

        body = {
            "model": self._summary_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": records_text},
            ],
            "max_completion_tokens": 500,
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self._openai_api_key}",
                },
                json=body,
            )

        if not resp.is_success:
            raise Exception(f"Summary API failed: {resp.status_code} - {resp.text[:200]}")

        payload = resp.json()
        return payload["choices"][0]["message"]["content"]
