from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

import pytest

from core.domain_events import AppStarted, DomainEventHub


def test_domain_event_defaults_to_jst_and_keeps_ids():
    event = AppStarted(source="test", correlation_id="corr-1")

    assert event.event_id
    assert event.correlation_id == "corr-1"
    assert event.occurred_at.tzinfo is not None
    assert event.occurred_at.utcoffset() == timedelta(hours=9)


def test_domain_event_normalizes_occurred_at_to_jst():
    event = AppStarted(
        source="utc-source",
        occurred_at=datetime(2026, 4, 5, 0, 0, tzinfo=UTC),
    )

    assert event.occurred_at.isoformat() == "2026-04-05T09:00:00+09:00"


@pytest.mark.asyncio
async def test_domain_event_hub_dispatches_all_handlers_when_one_fails(caplog):
    hub = DomainEventHub()
    handled: list[str] = []
    completed = asyncio.Event()

    async def first_handler(event):
        handled.append(f"first:{event.source}")

    async def failing_handler(_event):
        raise RuntimeError("boom")

    async def third_handler(event):
        handled.append(f"third:{event.source}")
        completed.set()

    hub.subscribe(AppStarted, first_handler)
    hub.subscribe(AppStarted, failing_handler)
    hub.subscribe(AppStarted, third_handler)

    with caplog.at_level(logging.ERROR):
        tasks = hub.publish(AppStarted(source="hub-test"))
        await asyncio.gather(*tasks)
        await asyncio.wait_for(completed.wait(), timeout=1)

    assert handled == ["first:hub-test", "third:hub-test"]
    assert "Unhandled domain event handler error" in caplog.text
