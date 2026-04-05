from __future__ import annotations

import asyncio
import inspect
import logging
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone


logger = logging.getLogger(__name__)
JST = timezone(timedelta(hours=9))


def _default_occurred_at() -> datetime:
    return datetime.now(JST)


def _normalize_occurred_at(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=JST)
    return value.astimezone(JST)


@dataclass(slots=True, kw_only=True)
class DomainEvent:
    source: str
    correlation_id: str | None = None
    event_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    occurred_at: datetime = field(default_factory=_default_occurred_at)

    def __post_init__(self) -> None:
        self.occurred_at = _normalize_occurred_at(self.occurred_at)


@dataclass(slots=True, kw_only=True)
class AppStarted(DomainEvent):
    pass


@dataclass(slots=True, kw_only=True)
class HealthPlanetSyncRequested(DomainEvent):
    interactive_auth: bool = True


@dataclass(slots=True, kw_only=True)
class FitbitSyncRequested(DomainEvent):
    pass


@dataclass(slots=True, kw_only=True)
class ChatAutoTalkDue(DomainEvent):
    forced_source: str | None = None


@dataclass(slots=True, kw_only=True)
class ChatFollowUpRequested(DomainEvent):
    user_text: str
    lily_text: str


@dataclass(slots=True, kw_only=True)
class CaptureSnapshotRequested(DomainEvent):
    pass


@dataclass(slots=True, kw_only=True)
class CaptureSummaryDue(DomainEvent):
    pass


EventHandler = Callable[[DomainEvent], Awaitable[None] | None]


class DomainEventHub:
    def __init__(self) -> None:
        self._handlers: dict[type[DomainEvent], list[EventHandler]] = {}

    def subscribe(
        self,
        event_type: type[DomainEvent],
        handler: EventHandler,
    ) -> None:
        self._handlers.setdefault(event_type, []).append(handler)

    def publish(self, event: DomainEvent) -> tuple[asyncio.Task[None], ...]:
        handlers = tuple(self._handlers.get(type(event), ()))
        loop = asyncio.get_running_loop()
        return tuple(
            loop.create_task(self._run_handler(handler, event))
            for handler in handlers
        )

    async def _run_handler(self, handler: EventHandler, event: DomainEvent) -> None:
        try:
            result = handler(event)
            if inspect.isawaitable(result):
                await result
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception(
                "Unhandled domain event handler error: event=%s handler=%r",
                type(event).__name__,
                handler,
            )
