from __future__ import annotations

from datetime import datetime, timedelta, timezone

from core.chrome_audible_tabs import ChromeAudibleTabsTracker


JST = timezone(timedelta(hours=9))


def test_fresh_matching_snapshot_returns_matching_domain():
    tracker = ChromeAudibleTabsTracker()
    received_at = datetime(2026, 4, 11, 21, 0, tzinfo=JST)

    tracker.update(
        received_at=received_at,
        audible_tabs=[
            {"tabId": 1, "domain": "www.youtube.com"},
            {"tabId": 2, "domain": "docs.python.org"},
        ],
    )

    matched = tracker.find_fresh_matching_domain(
        ["youtube.com"],
        now=received_at + timedelta(seconds=30),
    )

    assert matched == "youtube.com"


def test_stale_snapshot_does_not_match():
    tracker = ChromeAudibleTabsTracker()
    received_at = datetime(2026, 4, 11, 21, 0, tzinfo=JST)

    tracker.update(
        received_at=received_at,
        audible_tabs=[{"tabId": 1, "domain": "netflix.com"}],
    )

    matched = tracker.find_fresh_matching_domain(
        ["netflix.com"],
        now=received_at + timedelta(seconds=91),
    )

    assert matched is None


def test_empty_snapshot_clears_previous_match():
    tracker = ChromeAudibleTabsTracker()
    received_at = datetime(2026, 4, 11, 21, 0, tzinfo=JST)

    tracker.update(
        received_at=received_at,
        audible_tabs=[{"tabId": 1, "domain": "primevideo.com"}],
    )
    tracker.update(
        received_at=received_at + timedelta(seconds=10),
        audible_tabs=[],
    )

    matched = tracker.find_fresh_matching_domain(
        ["primevideo.com"],
        now=received_at + timedelta(seconds=20),
    )

    assert matched is None
