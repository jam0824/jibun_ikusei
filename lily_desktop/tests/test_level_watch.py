from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from core.level_watch import LevelWatchService


JST = timezone(timedelta(hours=9))


class _FakeApi:
    def __init__(self, *, user: dict | None, skills: list[dict], error: Exception | None = None):
        self._user = user
        self._skills = skills
        self._error = error

    async def get_user(self) -> dict | None:
        if self._error is not None:
            raise self._error
        return self._user

    async def get_skills(self) -> list[dict]:
        if self._error is not None:
            raise self._error
        return self._skills


def _snapshot_path(tmp_path):
    return tmp_path / "logs" / "level_watch" / "last_snapshot.json"


def _read_snapshot(path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.asyncio
async def test_initial_snapshot_is_saved_without_notification(tmp_path):
    path = _snapshot_path(tmp_path)
    service = LevelWatchService(snapshot_path=path)
    api = _FakeApi(
        user={"id": "local_user", "level": 2, "totalXp": 120},
        skills=[
            {"id": "skill_reading", "name": "読書", "status": "active", "level": 3, "totalXp": 120},
        ],
    )

    message = await service.check_once(api)

    assert message is None
    assert path.exists()
    saved = _read_snapshot(path)
    assert saved["user"] == {"level": 2, "totalXp": 120}
    assert saved["skills"] == [
        {"id": "skill_reading", "name": "読書", "level": 3, "totalXp": 120}
    ]
    assert datetime.fromisoformat(saved["capturedAt"]).tzinfo is not None


@pytest.mark.asyncio
async def test_user_level_up_only_returns_notification(tmp_path):
    path = _snapshot_path(tmp_path)
    service = LevelWatchService(snapshot_path=path)

    first_api = _FakeApi(
        user={"id": "local_user", "level": 2, "totalXp": 180},
        skills=[
            {"id": "skill_reading", "name": "読書", "status": "active", "level": 3, "totalXp": 120},
        ],
    )
    second_api = _FakeApi(
        user={"id": "local_user", "level": 3, "totalXp": 205},
        skills=[
            {"id": "skill_reading", "name": "読書", "status": "active", "level": 3, "totalXp": 120},
        ],
    )

    await service.check_once(first_api)
    message = await service.check_once(second_api)

    assert message == "レベルアップを検知しました。ユーザーレベルが Lv.2 → Lv.3 に上がりました。"


@pytest.mark.asyncio
async def test_multiple_skill_level_ups_are_aggregated_into_one_message(tmp_path):
    path = _snapshot_path(tmp_path)
    service = LevelWatchService(snapshot_path=path)

    await service.check_once(
        _FakeApi(
            user={"id": "local_user", "level": 2, "totalXp": 150},
            skills=[
                {"id": "skill_reading", "name": "読書", "status": "active", "level": 4, "totalXp": 180},
                {"id": "skill_training", "name": "運動", "status": "active", "level": 1, "totalXp": 45},
            ],
        )
    )

    message = await service.check_once(
        _FakeApi(
            user={"id": "local_user", "level": 3, "totalXp": 220},
            skills=[
                {"id": "skill_reading", "name": "読書", "status": "active", "level": 5, "totalXp": 210},
                {"id": "skill_training", "name": "運動", "status": "active", "level": 2, "totalXp": 55},
            ],
        )
    )

    assert (
        message
        == "レベルアップを検知しました。ユーザーレベルが Lv.2 → Lv.3 に上がりました。読書が Lv.4 → Lv.5、運動が Lv.1 → Lv.2 に上がりました。"
    )


@pytest.mark.asyncio
async def test_new_skill_is_not_notified_on_first_appearance(tmp_path):
    path = _snapshot_path(tmp_path)
    service = LevelWatchService(snapshot_path=path)

    await service.check_once(
        _FakeApi(
            user={"id": "local_user", "level": 2, "totalXp": 150},
            skills=[
                {"id": "skill_reading", "name": "読書", "status": "active", "level": 3, "totalXp": 120},
            ],
        )
    )

    message = await service.check_once(
        _FakeApi(
            user={"id": "local_user", "level": 2, "totalXp": 160},
            skills=[
                {"id": "skill_reading", "name": "読書", "status": "active", "level": 3, "totalXp": 125},
                {"id": "skill_new", "name": "作文", "status": "active", "level": 2, "totalXp": 60},
            ],
        )
    )

    assert message is None


@pytest.mark.asyncio
async def test_fetch_failure_keeps_previous_snapshot(tmp_path):
    path = _snapshot_path(tmp_path)
    service = LevelWatchService(snapshot_path=path)

    await service.check_once(
        _FakeApi(
            user={"id": "local_user", "level": 2, "totalXp": 150},
            skills=[
                {"id": "skill_reading", "name": "読書", "status": "active", "level": 3, "totalXp": 120},
            ],
        )
    )
    before = _read_snapshot(path)

    with pytest.raises(RuntimeError, match="network error"):
        await service.check_once(
            _FakeApi(
                user=None,
                skills=[],
                error=RuntimeError("network error"),
            )
        )

    after = _read_snapshot(path)
    assert after == before
