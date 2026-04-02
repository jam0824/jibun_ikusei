from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import pytest

from core.runtime_logging import configure_runtime_logging


JST = timezone(timedelta(hours=9))


@pytest.fixture(autouse=True)
def restore_root_logger():
    root_logger = logging.getLogger()
    original_handlers = list(root_logger.handlers)
    original_level = root_logger.level
    try:
        yield
    finally:
        for handler in list(root_logger.handlers):
            handler.close()
        root_logger.handlers = original_handlers
        root_logger.setLevel(original_level)


def test_configure_runtime_logging_uses_jst_date_for_filename(tmp_path):
    log_path = configure_runtime_logging(
        log_dir=tmp_path,
        now=datetime(2026, 4, 2, 15, 30, tzinfo=timezone.utc),
    )

    assert log_path == tmp_path / "2026-04-03.log"


def test_configure_runtime_logging_writes_logs_to_jst_daily_file(tmp_path):
    log_path = configure_runtime_logging(
        log_dir=tmp_path,
        now=datetime(2026, 4, 3, 7, 30, tzinfo=JST),
    )

    logger = logging.getLogger("tests.runtime_logging")
    logger.info("desktop app started")

    for handler in logging.getLogger().handlers:
        handler.flush()

    assert log_path == tmp_path / "2026-04-03.log"
    assert log_path.exists()
    content = log_path.read_text(encoding="utf-8")
    assert "desktop app started" in content
    assert "[tests.runtime_logging] INFO" in content


def test_configure_runtime_logging_replaces_existing_handlers(tmp_path):
    root_logger = logging.getLogger()
    root_logger.addHandler(logging.NullHandler())

    configure_runtime_logging(
        log_dir=tmp_path,
        now=datetime(2026, 4, 3, 9, 0, tzinfo=JST),
    )

    file_handlers = [
        handler for handler in root_logger.handlers
        if isinstance(handler, logging.FileHandler)
    ]
    stream_handlers = [
        handler for handler in root_logger.handlers
        if type(handler) is logging.StreamHandler
    ]

    assert len(file_handlers) == 1
    assert len(stream_handlers) == 1
