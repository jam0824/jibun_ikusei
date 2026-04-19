from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

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


def _quest(quest_id: str, title: str = "朝の読書") -> dict:
    return {
        "id": quest_id,
        "title": title,
        "category": "学習",
        "questType": "repeatable",
        "status": "active",
    }


def _completion(
    completion_id: str,
    *,
    quest_id: str,
    completed_at: str,
) -> dict:
    return {
        "id": completion_id,
        "questId": quest_id,
        "completedAt": completed_at,
        "note": "進めた",
    }


def _health_entry(date_key: str, time: str = "07:10") -> dict:
    return {
        "date": date_key,
        "time": time,
        "weight_kg": 61.2,
        "body_fat_pct": 18.1,
        "source": "health-planet",
    }


def _fitbit_entry(date_key: str) -> dict:
    return {
        "date": date_key,
        "heart": {
            "resting_heart_rate": 58,
            "intraday_points": 0,
            "heart_zones": [],
        },
        "active_zone_minutes": {
            "intraday_points": 0,
            "minutes_total_estimate": 22,
            "summary_rows": 1,
        },
        "sleep": {
            "main_sleep": {
                "date_of_sleep": date_key,
                "start_time": f"{date_key}T00:15:00.000",
                "end_time": f"{date_key}T06:40:00.000",
                "minutes_asleep": 390,
                "minutes_awake": 25,
                "time_in_bed": 415,
                "deep_minutes": 70,
                "light_minutes": 240,
                "rem_minutes": 80,
                "wake_minutes": 25,
            },
            "all_sleep_count": 1,
        },
        "activity": {
            "steps": 8123,
            "distance": 5.4,
            "calories": 2100,
            "very_active_minutes": 12,
            "fairly_active_minutes": 18,
            "lightly_active_minutes": 30,
            "sedentary_minutes": 500,
        },
    }


def _nutrition_day(date_key: str) -> dict:
    return {
        date_key: {
            "breakfast": None,
            "lunch": None,
            "dinner": None,
            "daily": {
                "userId": "user_1",
                "date": date_key,
                "mealType": "daily",
                "nutrients": {
                    "energy": {"value": 1850, "unit": "kcal", "label": "適正", "threshold": None},
                    "protein": {"value": 70, "unit": "g", "label": "適正", "threshold": None},
                    "fiber": {"value": 14, "unit": "g", "label": "不足", "threshold": None},
                    "salt": {"value": 9, "unit": "g", "label": "過剰", "threshold": None},
                },
                "createdAt": f"{date_key}T20:00:00+09:00",
                "updatedAt": f"{date_key}T20:00:00+09:00",
            },
        }
    }


@dataclass
class _FakeApiClient:
    daily_logs: dict[str, dict | None] = field(default_factory=dict)
    weekly_reviews: dict[str, dict | None] = field(default_factory=dict)
    daily_sessions: dict[str, list[dict]] = field(default_factory=dict)
    weekly_sessions: dict[tuple[str, str], list[dict]] = field(default_factory=dict)
    quests: list[dict] = field(default_factory=list)
    completions: list[dict] = field(default_factory=list)
    health_data: dict[tuple[str, str], list[dict]] = field(default_factory=dict)
    fitbit_data: dict[tuple[str, str], list[dict]] = field(default_factory=dict)
    nutrition_range: dict[tuple[str, str], dict] = field(default_factory=dict)
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

    async def get_quests(self) -> list[dict]:
        return list(self.quests)

    async def get_completions(self) -> list[dict]:
        return list(self.completions)

    async def get_health_data(self, from_date: str, to_date: str) -> list[dict]:
        return list(self.health_data.get((from_date, to_date), []))

    async def get_fitbit_data(self, from_date: str, to_date: str) -> list[dict]:
        return list(self.fitbit_data.get((from_date, to_date), []))

    async def get_nutrition_range(self, from_date: str, to_date: str) -> dict:
        return dict(self.nutrition_range.get((from_date, to_date), {}))


@pytest.mark.asyncio
async def test_backfill_generates_missing_yesterday_daily_and_previous_week_weekly(monkeypatch, tmp_path):
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
        quests=[_quest("quest_daily", "前日の読書")],
        completions=[
            _completion(
                "completion_daily",
                quest_id="quest_daily",
                completed_at="2026-04-16T08:00:00+09:00",
            )
        ],
        health_data={
            ("2026-04-16", "2026-04-16"): [_health_entry("2026-04-16")]
        },
        fitbit_data={
            ("2026-04-16", "2026-04-16"): [_fitbit_entry("2026-04-16")]
        },
        nutrition_range={
            ("2026-04-16", "2026-04-16"): _nutrition_day("2026-04-16")
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

    request_calls: list[dict] = []

    async def _fake_request_openai_json(**kwargs):
        request_calls.append(kwargs)
        if kwargs["schema_name"] == "daily_activity_log_summary":
            return {
                "summary": "リリィは、前日の調査の流れを静かに見つめていた。",
                "mainThemes": ["Chrome拡張", "調査"],
                "reviewQuestions": ["次に確認したい仕様はどこだったか。"],
            }
        if kwargs["schema_name"] == "daily_activity_log_quest_summary":
            return {
                "questSummary": "リリィは、前日のクエスト達成が静かな区切りを作っていたと見ている。",
            }
        if kwargs["schema_name"] == "daily_activity_log_health_summary":
            return {
                "healthSummary": "リリィは、前日の健康記録が朝の輪郭を残していたと見ている。",
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
        state_path=_fresh_state_path(tmp_path),
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert api_client.session_calls == [
        ("2026-04-16", "2026-04-16"),
        ("2026-04-06", "2026-04-12"),
    ]
    assert request_calls[0]["schema_name"] == "daily_activity_log_summary"
    assert request_calls[0]["max_output_tokens"] == 1600
    assert request_calls[1]["schema_name"] == "daily_activity_log_quest_summary"
    assert request_calls[1]["max_output_tokens"] == 1600
    assert request_calls[2]["schema_name"] == "daily_activity_log_health_summary"
    assert request_calls[2]["max_output_tokens"] == 1600
    assert "fitbit-data" in request_calls[2]["input_payload"]
    assert "nutrition-data" in request_calls[2]["input_payload"]
    assert request_calls[3]["schema_name"] == "weekly_activity_review"
    assert request_calls[3]["max_output_tokens"] == 1600
    assert api_client.put_daily_calls[0]["id"] == "daily_2026-04-16"
    assert api_client.put_daily_calls[0]["summary"] == "リリィは、前日の調査の流れを静かに見つめていた。"
    assert api_client.put_daily_calls[0]["questSummary"] == "リリィは、前日のクエスト達成が静かな区切りを作っていたと見ている。"
    assert api_client.put_daily_calls[0]["healthSummary"] == "リリィは、前日の健康記録が朝の輪郭を残していたと見ている。"
    assert api_client.put_weekly_calls[0]["id"] == "weekly_2026-W15"
    assert api_client.put_weekly_calls[0]["summary"] == "リリィは、前週の調査と実装の往復を見つめていた。"


@pytest.mark.asyncio
async def test_backfill_does_not_regenerate_existing_complete_daily_or_weekly(monkeypatch, tmp_path):
    api_client = _FakeApiClient(
        daily_logs={
            "2026-04-16": {
                "id": "daily_2026-04-16",
                "summary": "existing",
                "questSummary": "existing quest",
                "healthSummary": "existing health",
            }
        },
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
        state_path=_fresh_state_path(tmp_path),
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert request_mock_called is False
    assert api_client.put_daily_calls == []
    assert api_client.put_weekly_calls == []


@pytest.mark.asyncio
async def test_backfill_saves_only_successful_daily_sections_when_some_generations_fail(monkeypatch, tmp_path):
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
        quests=[_quest("quest_daily", "前日の読書")],
        completions=[
            _completion(
                "completion_daily",
                quest_id="quest_daily",
                completed_at="2026-04-16T08:00:00+09:00",
            )
        ],
        health_data={
            ("2026-04-16", "2026-04-16"): [_health_entry("2026-04-16")]
        },
        fitbit_data={
            ("2026-04-16", "2026-04-16"): [_fitbit_entry("2026-04-16")]
        },
        nutrition_range={
            ("2026-04-16", "2026-04-16"): _nutrition_day("2026-04-16")
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

    async def _partially_failing_request_openai_json(**kwargs):
        if kwargs["schema_name"] == "daily_activity_log_summary":
            return {
                "summary": "リリィは、前日の調査の流れを静かに見つめていた。",
                "mainThemes": ["Chrome拡張", "調査"],
                "reviewQuestions": ["次に確認したい仕様はどこだったか。"],
            }
        if kwargs["schema_name"] == "daily_activity_log_health_summary":
            return {
                "healthSummary": "リリィは、前日の健康記録が朝の輪郭を残していたと見ている。",
            }
        if kwargs["schema_name"] == "daily_activity_log_quest_summary":
            raise RuntimeError("quest summary unavailable")
        return {
            "summary": "リリィは、前週の調査と実装の往復を見つめていた。",
            "focusThemes": ["Chrome拡張", "開発"],
        }

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _partially_failing_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
        state_path=_fresh_state_path(tmp_path),
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert api_client.put_daily_calls[0]["summary"].startswith("リリィ")
    assert (
        api_client.put_daily_calls[0].get("questSummary") is None
        or "questSummary" not in api_client.put_daily_calls[0]
    )
    assert api_client.put_daily_calls[0]["healthSummary"].startswith("リリィ")
    assert api_client.put_weekly_calls[0]["summary"].startswith("リリィ")


@pytest.mark.asyncio
async def test_backfill_regenerates_only_missing_daily_sections(monkeypatch, tmp_path):
    api_client = _FakeApiClient(
        daily_logs={
            "2026-04-16": {
                "id": "daily_2026-04-16",
                "dateKey": "2026-04-16",
                "summary": "既存のその日のまとめ",
                "mainThemes": ["既存テーマ"],
                "noteIds": [],
                "reviewQuestions": ["既存の問い"],
                "generatedAt": "2026-04-16T22:00:00+09:00",
            }
        },
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
        quests=[_quest("quest_daily", "前日の読書")],
        completions=[
            _completion(
                "completion_daily",
                quest_id="quest_daily",
                completed_at="2026-04-16T08:00:00+09:00",
            )
        ],
        health_data={
            ("2026-04-16", "2026-04-16"): [_health_entry("2026-04-16")]
        },
        fitbit_data={
            ("2026-04-16", "2026-04-16"): [_fitbit_entry("2026-04-16")]
        },
        nutrition_range={
            ("2026-04-16", "2026-04-16"): _nutrition_day("2026-04-16")
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
        if kwargs["schema_name"] == "daily_activity_log_quest_summary":
            return {
                "questSummary": "リリィは、前日のクエスト達成が静かな区切りを作っていたと見ている。",
            }
        if kwargs["schema_name"] == "daily_activity_log_health_summary":
            return {
                "healthSummary": "リリィは、前日の健康記録が朝の輪郭を残していたと見ている。",
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
        state_path=_fresh_state_path(tmp_path),
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert len(captured_inputs) == 3
    assert "openLoops" not in captured_inputs[0]
    assert "openLoops" not in captured_inputs[1]
    assert "openLoops" not in captured_inputs[2]
    assert api_client.put_daily_calls[0]["summary"] == "既存のその日のまとめ"
    assert api_client.put_daily_calls[0]["questSummary"].startswith("リリィ")
    assert api_client.put_daily_calls[0]["healthSummary"].startswith("リリィ")
    assert "openLoopIds" not in api_client.put_weekly_calls[0]


def _fresh_state_path(tmp_path: Path) -> Path:
    return tmp_path / "daily_log_backfill_state.json"


def _write_backfill_state(path: Path, date_key: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"lastBackfillDate": date_key}), encoding="utf-8")


@pytest.mark.asyncio
async def test_backfill_skips_failed_section_within_cooldown_window(monkeypatch, tmp_path):
    """6時間以内に失敗した section はクールダウンで再試行しない"""
    api_client = _FakeApiClient(
        daily_logs={
            "2026-04-16": {
                "id": "daily_2026-04-16",
                "dateKey": "2026-04-16",
                "summary": "既存のまとめ",
                "healthSummary": "既存の健康",
                "mainThemes": [],
                "noteIds": [],
                "reviewQuestions": [],
                "generatedAt": "2026-04-16T22:00:00+09:00",
                "sectionLastFailedAt": {
                    "questSummary": "2026-04-17T06:00:00+09:00",
                },
            }
        },
        weekly_reviews={"2026-W15": {"id": "weekly_2026-W15"}},
    )

    openai_calls: list[str] = []

    async def _fake_request_openai_json(**kwargs):
        openai_calls.append(kwargs["schema_name"])
        return {"questSummary": "should not happen"}

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
        state_path=_fresh_state_path(tmp_path),
    )

    # now は失敗時刻から 3 時間後 → クールダウン 6h 未満
    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert openai_calls == []
    assert api_client.put_daily_calls == []


@pytest.mark.asyncio
async def test_backfill_retries_failed_section_after_cooldown(monkeypatch, tmp_path):
    """6時間を過ぎた section は再試行する"""
    api_client = _FakeApiClient(
        daily_logs={
            "2026-04-16": {
                "id": "daily_2026-04-16",
                "dateKey": "2026-04-16",
                "summary": "既存のまとめ",
                "healthSummary": "既存の健康",
                "mainThemes": [],
                "noteIds": [],
                "reviewQuestions": [],
                "generatedAt": "2026-04-16T22:00:00+09:00",
                "sectionLastFailedAt": {
                    "questSummary": "2026-04-17T02:00:00+09:00",
                },
            }
        },
        quests=[_quest("quest_a", "読書")],
        completions=[
            _completion(
                "completion_a",
                quest_id="quest_a",
                completed_at="2026-04-16T08:00:00+09:00",
            )
        ],
        weekly_reviews={"2026-W15": {"id": "weekly_2026-W15"}},
    )

    openai_calls: list[str] = []

    async def _fake_request_openai_json(**kwargs):
        openai_calls.append(kwargs["schema_name"])
        return {"questSummary": "リリィは、クエストの区切りを静かに見つめていた。"}

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
        state_path=_fresh_state_path(tmp_path),
    )

    # 失敗時刻 02:00 → 09:00 は 7 時間後（6h を超過）
    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert openai_calls == ["daily_activity_log_quest_summary"]
    assert api_client.put_daily_calls[0]["questSummary"].startswith("リリィ")
    # 成功したので sectionLastFailedAt からは消える
    assert "questSummary" not in api_client.put_daily_calls[0].get(
        "sectionLastFailedAt", {}
    )


@pytest.mark.asyncio
async def test_backfill_records_failure_timestamp_on_openai_error(monkeypatch, tmp_path):
    """OpenAI 呼び出しが失敗した section は sectionLastFailedAt に JST タイムスタンプを記録する"""
    api_client = _FakeApiClient(
        daily_logs={
            "2026-04-16": {
                "id": "daily_2026-04-16",
                "dateKey": "2026-04-16",
                "summary": "既存のまとめ",
                "healthSummary": "既存の健康",
                "mainThemes": [],
                "noteIds": [],
                "reviewQuestions": [],
                "generatedAt": "2026-04-16T22:00:00+09:00",
            }
        },
        quests=[_quest("quest_a", "読書")],
        completions=[
            _completion(
                "completion_a",
                quest_id="quest_a",
                completed_at="2026-04-16T08:00:00+09:00",
            )
        ],
        weekly_reviews={"2026-W15": {"id": "weekly_2026-W15"}},
    )

    async def _fake_request_openai_json(**kwargs):
        raise RuntimeError("openai down")

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
        state_path=_fresh_state_path(tmp_path),
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert len(api_client.put_daily_calls) == 1
    assert api_client.put_daily_calls[0]["sectionLastFailedAt"] == {
        "questSummary": "2026-04-17T09:00:00+09:00",
    }


@pytest.mark.asyncio
async def test_backfill_clears_failure_timestamp_on_section_success(monkeypatch, tmp_path):
    """前回失敗した section が成功したら sectionLastFailedAt から該当キーを削除する"""
    api_client = _FakeApiClient(
        daily_logs={
            "2026-04-16": {
                "id": "daily_2026-04-16",
                "dateKey": "2026-04-16",
                "summary": "既存のまとめ",
                "healthSummary": "既存の健康",
                "mainThemes": [],
                "noteIds": [],
                "reviewQuestions": [],
                "generatedAt": "2026-04-16T22:00:00+09:00",
                "sectionLastFailedAt": {
                    "questSummary": "2026-04-16T23:00:00+09:00",
                    "summary": "2026-04-16T23:30:00+09:00",
                },
            }
        },
        quests=[_quest("quest_a", "読書")],
        completions=[
            _completion(
                "completion_a",
                quest_id="quest_a",
                completed_at="2026-04-16T08:00:00+09:00",
            )
        ],
        weekly_reviews={"2026-W15": {"id": "weekly_2026-W15"}},
    )

    async def _fake_request_openai_json(**kwargs):
        return {"questSummary": "リリィは、静かな区切りを見ていた。"}

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
        state_path=_fresh_state_path(tmp_path),
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    saved = api_client.put_daily_calls[0]
    # questSummary は成功 → クリア。summary は既存テキストで対象外（既に完成済み）だが
    # 失敗記録としては残したまま（ただし既存 summary があるのでそもそも target から外れている）
    assert "questSummary" not in saved.get("sectionLastFailedAt", {})
    assert saved.get("sectionLastFailedAt", {}).get("summary") == "2026-04-16T23:30:00+09:00"


@pytest.mark.asyncio
async def test_backfill_persists_failure_state_even_when_no_section_succeeds(
    monkeypatch, tmp_path
):
    """すべての section が失敗した場合も、次回のクールダウン判定のため sectionLastFailedAt を保存する"""
    api_client = _FakeApiClient(
        daily_logs={
            "2026-04-16": None,
        },
        daily_sessions={
            "2026-04-16": [
                _session(
                    "session_a",
                    date_key="2026-04-16",
                    started_at="2026-04-16T09:00:00+09:00",
                    ended_at="2026-04-16T09:30:00+09:00",
                    title="調査",
                )
            ]
        },
        quests=[_quest("quest_a", "読書")],
        completions=[
            _completion(
                "completion_a",
                quest_id="quest_a",
                completed_at="2026-04-16T08:00:00+09:00",
            )
        ],
        health_data={
            ("2026-04-16", "2026-04-16"): [_health_entry("2026-04-16")]
        },
        fitbit_data={
            ("2026-04-16", "2026-04-16"): [_fitbit_entry("2026-04-16")]
        },
        nutrition_range={
            ("2026-04-16", "2026-04-16"): _nutrition_day("2026-04-16")
        },
        weekly_reviews={"2026-W15": {"id": "weekly_2026-W15"}},
    )

    async def _fake_request_openai_json(**kwargs):
        raise RuntimeError("openai down")

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
        state_path=_fresh_state_path(tmp_path),
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 9, 0, tzinfo=JST)
    )

    assert len(api_client.put_daily_calls) == 1
    saved = api_client.put_daily_calls[0]
    assert saved["sectionLastFailedAt"] == {
        "summary": "2026-04-17T09:00:00+09:00",
        "questSummary": "2026-04-17T09:00:00+09:00",
        "healthSummary": "2026-04-17T09:00:00+09:00",
    }


@pytest.mark.asyncio
async def test_backfill_runs_only_once_per_jst_day(monkeypatch, tmp_path):
    """同一 JST 日の 2 回目の backfill は OpenAI を呼ばずにスキップする"""
    state_path = _fresh_state_path(tmp_path)
    _write_backfill_state(state_path, "2026-04-17")

    api_client = _FakeApiClient(
        daily_logs={"2026-04-16": None},
        weekly_reviews={"2026-W15": None},
    )

    openai_calls: list[str] = []

    async def _fake_request_openai_json(**kwargs):
        openai_calls.append(kwargs["schema_name"])
        return {}

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
        state_path=state_path,
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 17, 15, 0, tzinfo=JST)
    )

    assert openai_calls == []
    assert api_client.put_daily_calls == []
    assert api_client.put_weekly_calls == []


@pytest.mark.asyncio
async def test_backfill_runs_again_on_next_jst_day(monkeypatch, tmp_path):
    """翌 JST 日になれば再び backfill を実行し、state を更新する"""
    state_path = _fresh_state_path(tmp_path)
    _write_backfill_state(state_path, "2026-04-17")

    api_client = _FakeApiClient(
        daily_logs={
            "2026-04-17": {
                "id": "daily_2026-04-17",
                "summary": "既に完成",
                "questSummary": "既に完成",
                "healthSummary": "既に完成",
            }
        },
        weekly_reviews={"2026-W15": {"id": "weekly_2026-W15"}},
    )

    async def _fake_request_openai_json(**kwargs):
        return {}

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
        state_path=state_path,
    )

    await service.backfill_missing_summaries(
        now=datetime(2026, 4, 18, 9, 0, tzinfo=JST)
    )

    saved = json.loads(state_path.read_text(encoding="utf-8"))
    assert saved == {"lastBackfillDate": "2026-04-18"}


@pytest.mark.asyncio
async def test_regenerate_previous_day_bypasses_once_per_day_guard(monkeypatch, tmp_path):
    """デバッグメニューの強制再生成は一日一回ガードを無視する"""
    state_path = _fresh_state_path(tmp_path)
    _write_backfill_state(state_path, "2026-04-17")

    api_client = _FakeApiClient(
        daily_logs={
            "2026-04-16": {
                "id": "daily_2026-04-16",
                "summary": "既存のまとめ",
                "questSummary": "既存のクエスト",
                "healthSummary": "既存の健康",
                "mainThemes": [],
                "noteIds": [],
                "reviewQuestions": [],
                "generatedAt": "2026-04-16T22:00:00+09:00",
            }
        },
        daily_sessions={
            "2026-04-16": [
                _session(
                    "session_a",
                    date_key="2026-04-16",
                    started_at="2026-04-16T09:00:00+09:00",
                    ended_at="2026-04-16T09:30:00+09:00",
                    title="調査",
                )
            ]
        },
        quests=[_quest("quest_a", "読書")],
        completions=[
            _completion(
                "completion_a",
                quest_id="quest_a",
                completed_at="2026-04-16T08:00:00+09:00",
            )
        ],
        health_data={
            ("2026-04-16", "2026-04-16"): [_health_entry("2026-04-16")]
        },
        fitbit_data={
            ("2026-04-16", "2026-04-16"): [_fitbit_entry("2026-04-16")]
        },
        nutrition_range={
            ("2026-04-16", "2026-04-16"): _nutrition_day("2026-04-16")
        },
    )

    openai_calls: list[str] = []

    async def _fake_request_openai_json(**kwargs):
        openai_calls.append(kwargs["schema_name"])
        if kwargs["schema_name"] == "daily_activity_log_summary":
            return {
                "summary": "再生成されたまとめ",
                "mainThemes": ["テーマ"],
                "reviewQuestions": ["問い"],
            }
        if kwargs["schema_name"] == "daily_activity_log_quest_summary":
            return {"questSummary": "再生成されたクエストまとめ"}
        if kwargs["schema_name"] == "daily_activity_log_health_summary":
            return {"healthSummary": "再生成された健康まとめ"}
        return {}

    monkeypatch.setattr(
        "core.action_log_summary_backfill_service.request_openai_json",
        _fake_request_openai_json,
    )

    service = ActionLogSummaryBackfillService(
        api_client=api_client,
        openai_api_key="sk-test",
        state_path=state_path,
    )

    result = await service.regenerate_previous_day_daily_log(
        now=datetime(2026, 4, 17, 15, 0, tzinfo=JST)
    )

    assert set(openai_calls) == {
        "daily_activity_log_summary",
        "daily_activity_log_quest_summary",
        "daily_activity_log_health_summary",
    }
    assert result["completed_sections"] == [
        "summary",
        "questSummary",
        "healthSummary",
    ]
    assert api_client.put_daily_calls[0]["summary"] == "再生成されたまとめ"
