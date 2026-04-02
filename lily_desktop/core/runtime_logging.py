from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path


JST = timezone(timedelta(hours=9))

_BASE_DIR = Path(__file__).resolve().parent.parent
_RUNTIME_LOG_DIR = _BASE_DIR / "logs" / "runtime"
_LOG_FORMAT = "%(asctime)s [%(name)s] %(levelname)s: %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


class JstFormatter(logging.Formatter):
    """ログ時刻を常に JST で出力する formatter。"""

    def converter(self, timestamp: float):  # type: ignore[override]
        return datetime.fromtimestamp(timestamp, JST).timetuple()


def build_runtime_log_path(
    *,
    log_dir: Path = _RUNTIME_LOG_DIR,
    now: datetime | None = None,
) -> Path:
    """JST の当日日付から実行ログファイルパスを返す。"""
    current = now.astimezone(JST) if now is not None else datetime.now(JST)
    return log_dir / f"{current.strftime('%Y-%m-%d')}.log"


def configure_runtime_logging(
    *,
    log_dir: Path = _RUNTIME_LOG_DIR,
    level: int = logging.INFO,
    now: datetime | None = None,
) -> Path:
    """コンソールとファイルの両方へ出力する実行ログを初期化する。"""
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = build_runtime_log_path(log_dir=log_dir, now=now)

    formatter = JstFormatter(_LOG_FORMAT, datefmt=_DATE_FORMAT)

    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(level)
    stream_handler.setFormatter(formatter)

    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setLevel(level)
    file_handler.setFormatter(formatter)

    logging.basicConfig(
        level=level,
        handlers=[stream_handler, file_handler],
        force=True,
    )
    logging.captureWarnings(True)
    logging.getLogger(__name__).info("実行ログの保存を開始しました: %s", log_path)
    return log_path
