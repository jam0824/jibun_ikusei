from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import pytest

from core.action_log_summary_backfill_service import ActionLogSummaryBackfillService


JST = timezone(timedelta(hours=9))


def _session(
    session_id: str,
    *,
    date_key: str,
    started_at: str,
    ended_at: str,
    title: str,
    primary_category: str = "学習",
) -> dict:
    return {
        "id": session_id,
        "deviceId": "device_1",
        "startedAt": started_at,
        "endedAt": ended_at,
        "dateKey": date_key,
        "title": title,
        "primaryCategory": primary_category,
        "activityKinds": ["調査"],
        "appNames": ["Chrome"],
        "domains": ["developer.chrome.com"],
        "projectNames": [],
        "summary": f"{title} を進めていた。",
        "searchKeywords": [title, "developer.chrome.com"],
        "noteIds": [],
        "hidden": False,
    }


@dataclass
class _FakeApiClient:
    daily_logs: dict[str, dict | None] = field(default_factory=dict)
    weekly_reviews: dict[str, dict | None] = field(default_factory=dict)
    daily_sessions: dict[str, list[dict]] = field(default_factory=dict)
    weekly_sessions: dict[tuple[str, str], list[dict]] = field(default_factory=dict)
    put_daily_calls: list[dict] = field(default_factory=list)
    put_weekly_calls: list[dict] = field(default_factory=list)
    session_calls: list[tuple[str, str]] = field(default_factory=list)

    async def get_action_log_daily_log(self, date_key: str) -> dict | None:
        return self.daily_logs.get(date_key)

    async def put_action_log_daily_log(self, log: dict) -> dict:
        self.put_daily_calls.append(log)
        return log

    async def get_action_log_weekly_review(self, week_key: str) -> dict | None:
        return self.weekly_reviews.get(week_key)

    async def put_action_log_weekly_review(self, review: dict) -> dict:
        self.put_weekly_calls.append(review)
        return review

    async def get_action_log_sessions(self, from_date: str, to_date: str) -> list[dict]:
        self.session_calls.append((from_date, to_date))
        if from_date == to_date:
            return list(self.daily_sessions.get(from_date, []))
        return list(self.weekly_sessions.get((from_date, to_date), []))


@pytest.mark.asyncio
async def test_backfill_generates_missing_yesterday_daily_and_previous_week_weekly(monkeypatch):
    api_client = _FakeApiClient(
        daily_sessions={
            "2026-04-16": [
                _session(
                    "session_daily",
                    date_key="2026-04-16",
                    started_at="2026-04-16T09:00:00+09:00",
                    ended_at="2026-04-16T09:40:00+09:00",
                    title="前日の調査",
                )
            ]
        },
        weekly_sessions={
            ("2026-04-06", "2026-04-12"): [
                _session(
                    "session_weekly",
                    date_key="2026-04-10",
                    started_at="2026-04-10T10:00:00+09:00",
                    ended_at="2026-04-10T10:45:00+09:00",
                    title="前週の調査",
                )
            ]
        },
    )

    async def _fake_request_openai_json(**kwargs):
        if kwargs["schema_name"] == "daily_activity_log":
            return {
                "summary": "リリィは、前日の調査の流れを静かに見つめていた。",
                "mainThemes": ["Chrome拡張", "調査"],
                "reviewQuestions": ["次に確認したい仕様はどこだったか。"],
            }
        return {
            "summary": "リリィは、前週の調査と実装の往復を見つめていた。",
            "focusThemes": ["Chrome拡張", "開発"],
        }

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert api_client.session_calls == [
        ("2026-04-16", "2026-04-16"),
        ("2026-04-06", "2026-04-12"),
    ]
    assert api_client.put_daily_calls[0]["id"] == "daily_2026-04-16"
    assert api_client.put_daily_calls[0]["summary"] == "リリィは、前日の調査の流れを静かに見つめていた。"
    assert api_client.put_weekly_calls[0]["id"] == "weekly_2026-W15"
    assert api_client.put_weekly_calls[0]["summary"] == "リリィは、前週の調査と実装の往復を見つめていた。"


@pytest.mark.asyncio
async def test_backfill_does_not_regenerate_existing_daily_or_weekly(monkeypatch):
    api_client = _FakeApiClient(
        daily_logs={"2026-04-16": {"id": "daily_2026-04-16"}},
        weekly_reviews={"2026-W15": {"id": "weekly_2026-W15"}},
    )

    request_mock_called = False

    async def _fake_request_openai_json(**kwargs):
        nonlocal request_mock_called
        request_mock_called = True
        return kwargs

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert request_mock_called is False
    assert api_client.put_daily_calls == []
    assert api_client.put_weekly_calls == []


@pytest.mark.asyncio
async def test_backfill_uses_template_fallback_when_openai_fails(monkeypatch):
    api_client = _FakeApiClient(
        daily_sessions={
            "2026-04-16": [
                _session(
                    "session_daily",
                    date_key="2026-04-16",
                    started_at="2026-04-16T09:00:00+09:00",
                    ended_at="2026-04-16T09:40:00+09:00",
                    title="前日の調査",
                )
            ]
        },
        weekly_sessions={
            ("2026-04-06", "2026-04-12"): [
                _session(
                    "session_weekly",
                    date_key="2026-04-10",
                    started_at="2026-04-10T10:00:00+09:00",
                    ended_at="2026-04-10T10:45:00+09:00",
                    title="前週の調査",
                )
            ]
        },
    )

    async def _failing_request_openai_json(**_kwargs):
        raise RuntimeError("openai unavailable")

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _failing_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert api_client.put_daily_calls[0]["summary"].startswith("リリィ")
    assert api_client.put_weekly_calls[0]["summary"].startswith("リリィ")


@pytest.mark.asyncio
async def test_backfill_uses_session_only_inputs_and_saves_without_open_loop_ids(monkeypatch):
    api_client = _FakeApiClient(
        daily_sessions={
            "2026-04-16": [
                _session(
                    "session_daily",
                    date_key="2026-04-16",
                    started_at="2026-04-16T09:00:00+09:00",
                    ended_at="2026-04-16T09:40:00+09:00",
                    title="前日の調査",
                )
            ]
        },
        weekly_sessions={
            ("2026-04-06", "2026-04-12"): [
                _session(
                    "session_weekly",
                    date_key="2026-04-10",
                    started_at="2026-04-10T10:00:00+09:00",
                    ended_at="2026-04-10T10:45:00+09:00",
                    title="前週の調査",
                )
            ]
        },
    )
    captured_inputs: list[dict] = []

    async def _fake_request_openai_json(**kwargs):
        captured_inputs.append(kwargs["input_payload"])
        if kwargs["schema_name"] == "daily_activity_log":
            return {
                "summary": "リリィは、前日の調査の流れを静かに見つめていた。",
                "mainThemes": ["Chrome拡張", "調査"],
                "reviewQuestions": ["次に確認したい仕様はどこだったか。"],
            }
        return {
            "summary": "リリィは、前週の調査と実装の往復を見つめていた。",
            "focusThemes": ["Chrome拡張", "開発"],
        }

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert "openLoops" not in captured_inputs[0]
    assert "openLoops" not in captured_inputs[1]
    assert "openLoopIds" not in api_client.put_daily_calls[0]
    assert "openLoopIds" not in api_client.put_weekly_calls[0]
