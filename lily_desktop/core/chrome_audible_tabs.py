from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Iterable, Mapping


JST = timezone(timedelta(hours=9))
DEFAULT_CHROME_AUDIBLE_TABS_FRESHNESS = timedelta(seconds=90)


def normalize_domain(value: str) -> str:
    normalized = value.strip().lower()
    if normalized.startswith("www."):
        return normalized[4:]
    return normalized


@dataclass(frozen=True, slots=True)
class ChromeAudibleTab:
    tab_id: int
    domain: str


@dataclass(slots=True)
class ChromeAudibleTabsSnapshot:
    received_at: datetime | None = None
    audible_tabs: tuple[ChromeAudibleTab, ...] = field(default_factory=tuple)


class ChromeAudibleTabsTracker:
    def __init__(
        self,
        *,
        freshness: timedelta = DEFAULT_CHROME_AUDIBLE_TABS_FRESHNESS,
    ) -> None:
        self._freshness = freshness
        self._snapshot = ChromeAudibleTabsSnapshot()

    def update(
        self,
        *,
        received_at: datetime,
        audible_tabs: Iterable[Mapping[str, object]],
    ) -> None:
        normalized_received_at = (
            received_at.astimezone(JST)
            if received_at.tzinfo is not None
            else received_at.replace(tzinfo=JST)
        )
        normalized_tabs: list[ChromeAudibleTab] = []
        for tab in audible_tabs:
            tab_id = tab.get("tabId")
            domain = tab.get("domain")
            if isinstance(tab_id, bool) or not isinstance(tab_id, int):
                continue
            if not isinstance(domain, str):
                continue
            normalized_domain = normalize_domain(domain)
            if not normalized_domain:
                continue
            normalized_tabs.append(
                ChromeAudibleTab(tab_id=tab_id, domain=normalized_domain)
            )
        self._snapshot = ChromeAudibleTabsSnapshot(
            received_at=normalized_received_at,
            audible_tabs=tuple(normalized_tabs),
        )

    def find_fresh_matching_domain(
        self,
        domains: list[str],
        *,
        now: datetime | None = None,
    ) -> str | None:
        normalized_domains = [
            normalize_domain(domain)
            for domain in domains
            if isinstance(domain, str) and normalize_domain(domain)
        ]
        if not normalized_domains:
            return None

        snapshot = self._snapshot
        if snapshot.received_at is None:
            return None

        current_time = (
            now.astimezone(JST)
            if now is not None and now.tzinfo is not None
            else now.replace(tzinfo=JST)
            if now is not None
            else datetime.now(JST)
        )
        if current_time - snapshot.received_at > self._freshness:
            return None

        for audible_tab in snapshot.audible_tabs:
            for blocked_domain in normalized_domains:
                if (
                    audible_tab.domain == blocked_domain
                    or audible_tab.domain.endswith("." + blocked_domain)
                ):
                    return blocked_domain
        return None
