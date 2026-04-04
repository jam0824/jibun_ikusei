from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal


JobPolicy = Literal[
    "single_flight_drop",
    "single_flight_coalesce",
    "latest_wins",
    "serial",
]
JobRunner = Callable[[], Awaitable[None]]


@dataclass
class _JobState:
    current_task: asyncio.Task[None] | None = None
    pending_runner: JobRunner | None = None
    serial_queue: deque[tuple[JobRunner, asyncio.Future[None]]] = field(
        default_factory=deque
    )


class JobManager:
    def __init__(self) -> None:
        self._states: dict[str, _JobState] = {}

    def submit(
        self,
        job_key: str,
        policy: JobPolicy,
        runner: JobRunner,
    ) -> asyncio.Future[None]:
        if policy == "single_flight_drop":
            return self._submit_single_flight_drop(job_key, runner)
        if policy == "single_flight_coalesce":
            return self._submit_single_flight_coalesce(job_key, runner)
        if policy == "latest_wins":
            return self._submit_latest_wins(job_key, runner)
        if policy == "serial":
            return self._submit_serial(job_key, runner)
        raise ValueError(f"Unsupported job policy: {policy}")

    def _state_for(self, job_key: str) -> _JobState:
        return self._states.setdefault(job_key, _JobState())

    def _submit_single_flight_drop(
        self,
        job_key: str,
        runner: JobRunner,
    ) -> asyncio.Task[None]:
        state = self._state_for(job_key)
        if state.current_task is not None and not state.current_task.done():
            return state.current_task
        return self._start_task(job_key, runner)

    def _submit_single_flight_coalesce(
        self,
        job_key: str,
        runner: JobRunner,
    ) -> asyncio.Task[None]:
        state = self._state_for(job_key)
        if state.current_task is not None and not state.current_task.done():
            state.pending_runner = runner
            return state.current_task

        async def coalesced_runner() -> None:
            current_runner = runner
            while True:
                await current_runner()
                next_runner = state.pending_runner
                state.pending_runner = None
                if next_runner is None:
                    break
                current_runner = next_runner

        return self._start_task(job_key, coalesced_runner)

    def _submit_latest_wins(
        self,
        job_key: str,
        runner: JobRunner,
    ) -> asyncio.Task[None]:
        state = self._state_for(job_key)
        if state.current_task is not None and not state.current_task.done():
            state.current_task.cancel()
        return self._start_task(job_key, runner)

    def _submit_serial(
        self,
        job_key: str,
        runner: JobRunner,
    ) -> asyncio.Future[None]:
        state = self._state_for(job_key)
        completion = asyncio.get_running_loop().create_future()
        state.serial_queue.append((runner, completion))
        if state.current_task is None or state.current_task.done():
            state.current_task = asyncio.create_task(
                self._run_serial_queue(job_key, state)
            )
            state.current_task.add_done_callback(
                lambda task, key=job_key: self._on_task_done(key, task)
            )
        return completion

    def _start_task(
        self,
        job_key: str,
        runner: JobRunner,
    ) -> asyncio.Task[None]:
        task = asyncio.create_task(runner())
        state = self._state_for(job_key)
        state.current_task = task
        task.add_done_callback(
            lambda done, key=job_key: self._on_task_done(key, done)
        )
        return task

    async def _run_serial_queue(self, job_key: str, state: _JobState) -> None:
        while state.serial_queue:
            runner, completion = state.serial_queue.popleft()
            try:
                await runner()
            except asyncio.CancelledError:
                if not completion.done():
                    completion.cancel()
                raise
            except Exception as exc:
                if not completion.done():
                    completion.set_exception(exc)
            else:
                if not completion.done():
                    completion.set_result(None)
        self._cleanup_state(job_key)

    def _on_task_done(self, job_key: str, task: asyncio.Task[None]) -> None:
        state = self._states.get(job_key)
        if state is None:
            return
        if state.current_task is task:
            state.current_task = None
        self._cleanup_state(job_key)

    def _cleanup_state(self, job_key: str) -> None:
        state = self._states.get(job_key)
        if state is None:
            return
        if state.current_task is not None:
            return
        if state.pending_runner is not None:
            return
        if state.serial_queue:
            return
        self._states.pop(job_key, None)
