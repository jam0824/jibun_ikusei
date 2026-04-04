from __future__ import annotations

import asyncio

import pytest

from core.job_manager import JobManager


@pytest.mark.asyncio
async def test_single_flight_drop_keeps_only_first_runner():
    manager = JobManager()
    started = asyncio.Event()
    release = asyncio.Event()
    calls: list[str] = []

    async def first_runner():
        calls.append("first")
        started.set()
        await release.wait()

    async def second_runner():
        calls.append("second")

    first_task = manager.submit("job", "single_flight_drop", first_runner)
    await asyncio.wait_for(started.wait(), timeout=1)
    second_task = manager.submit("job", "single_flight_drop", second_runner)
    release.set()
    await asyncio.gather(first_task, second_task)

    assert calls == ["first"]


@pytest.mark.asyncio
async def test_single_flight_coalesce_reruns_once_after_current_job_finishes():
    manager = JobManager()
    first_started = asyncio.Event()
    release = asyncio.Event()
    second_finished = asyncio.Event()
    calls: list[str] = []

    async def first_runner():
        calls.append("first")
        first_started.set()
        await release.wait()

    async def second_runner():
        calls.append("second")
        second_finished.set()

    task = manager.submit("job", "single_flight_coalesce", first_runner)
    await asyncio.wait_for(first_started.wait(), timeout=1)
    manager.submit("job", "single_flight_coalesce", second_runner)
    release.set()
    await task
    await asyncio.wait_for(second_finished.wait(), timeout=1)

    assert calls == ["first", "second"]


@pytest.mark.asyncio
async def test_latest_wins_cancels_old_job_before_running_new_one():
    manager = JobManager()
    first_started = asyncio.Event()
    first_cancelled = asyncio.Event()
    second_finished = asyncio.Event()
    calls: list[str] = []

    async def first_runner():
        calls.append("first")
        first_started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            calls.append("first_cancelled")
            first_cancelled.set()
            raise

    async def second_runner():
        calls.append("second")
        second_finished.set()

    manager.submit("job", "latest_wins", first_runner)
    await asyncio.wait_for(first_started.wait(), timeout=1)
    second_task = manager.submit("job", "latest_wins", second_runner)
    await asyncio.wait_for(first_cancelled.wait(), timeout=1)
    await second_task
    await asyncio.wait_for(second_finished.wait(), timeout=1)

    assert calls == ["first", "first_cancelled", "second"]


@pytest.mark.asyncio
async def test_serial_runs_jobs_in_submission_order():
    manager = JobManager()
    first_started = asyncio.Event()
    release = asyncio.Event()
    order: list[str] = []

    async def first_runner():
        order.append("first:start")
        first_started.set()
        await release.wait()
        order.append("first:end")

    async def second_runner():
        order.append("second")

    first_future = manager.submit("job", "serial", first_runner)
    second_future = manager.submit("job", "serial", second_runner)
    await asyncio.wait_for(first_started.wait(), timeout=1)
    await asyncio.sleep(0)
    assert order == ["first:start"]

    release.set()
    await asyncio.gather(first_future, second_future)

    assert order == ["first:start", "first:end", "second"]
