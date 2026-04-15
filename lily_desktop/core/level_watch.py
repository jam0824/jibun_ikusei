from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


logger = logging.getLogger(__name__)
JST = timezone(timedelta(hours=9))
_BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_LEVEL_WATCH_SNAPSHOT_PATH = (
    _BASE_DIR / "logs" / "level_watch" / "last_snapshot.json"
)


@dataclass(slots=True)
class SkillLevelSnapshot:
    id: str
    name: str
    level: int
    total_xp: int

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "level": self.level,
            "totalXp": self.total_xp,
        }


@dataclass(slots=True)
class LevelWatchSnapshot:
    captured_at: datetime
    user_level: int
    user_total_xp: int
    skills: list[SkillLevelSnapshot]

    def to_dict(self) -> dict[str, object]:
        return {
            "capturedAt": self.captured_at.astimezone(JST).isoformat(),
            "user": {
                "level": self.user_level,
                "totalXp": self.user_total_xp,
            },
            "skills": [skill.to_dict() for skill in self.skills],
        }

    @classmethod
    def from_dict(cls, payload: dict[str, object]) -> "LevelWatchSnapshot":
        captured_at = datetime.fromisoformat(str(payload["capturedAt"])).astimezone(JST)
        user = payload.get("user", {})
        if not isinstance(user, dict):
            raise ValueError("snapshot.user must be an object")
        skills_payload = payload.get("skills", [])
        if not isinstance(skills_payload, list):
            raise ValueError("snapshot.skills must be an array")
        skills = [
            SkillLevelSnapshot(
                id=str(item["id"]),
                name=str(item["name"]),
                level=int(item["level"]),
                total_xp=int(item["totalXp"]),
            )
            for item in skills_payload
            if isinstance(item, dict)
        ]
        return cls(
            captured_at=captured_at,
            user_level=int(user.get("level", 1)),
            user_total_xp=int(user.get("totalXp", 0)),
            skills=skills,
        )


@dataclass(slots=True)
class SkillLevelChange:
    name: str
    previous_level: int
    current_level: int


@dataclass(slots=True)
class LevelWatchChanges:
    user_level_change: tuple[int, int] | None
    skill_level_changes: list[SkillLevelChange]

    @property
    def has_changes(self) -> bool:
        return self.user_level_change is not None or bool(self.skill_level_changes)


def build_snapshot(
    user: dict[str, object] | None,
    skills: list[dict[str, object]],
    *,
    captured_at: datetime | None = None,
) -> LevelWatchSnapshot:
    if user is None:
        raise RuntimeError("user profile is unavailable")

    active_skills: list[SkillLevelSnapshot] = []
    for skill in skills:
        if skill.get("status") != "active":
            continue
        active_skills.append(
            SkillLevelSnapshot(
                id=str(skill.get("id", "")),
                name=str(skill.get("name", "")),
                level=int(skill.get("level", 1)),
                total_xp=int(skill.get("totalXp", 0)),
            )
        )

    return LevelWatchSnapshot(
        captured_at=(captured_at or datetime.now(JST)).astimezone(JST),
        user_level=int(user.get("level", 1)),
        user_total_xp=int(user.get("totalXp", 0)),
        skills=active_skills,
    )


def detect_changes(
    previous: LevelWatchSnapshot,
    current: LevelWatchSnapshot,
) -> LevelWatchChanges:
    user_level_change: tuple[int, int] | None = None
    if current.user_level > previous.user_level:
        user_level_change = (previous.user_level, current.user_level)

    previous_skills = {skill.id: skill for skill in previous.skills}
    skill_level_changes: list[SkillLevelChange] = []
    for skill in current.skills:
        previous_skill = previous_skills.get(skill.id)
        if previous_skill is None:
            continue
        if skill.level > previous_skill.level:
            skill_level_changes.append(
                SkillLevelChange(
                    name=skill.name,
                    previous_level=previous_skill.level,
                    current_level=skill.level,
                )
            )

    return LevelWatchChanges(
        user_level_change=user_level_change,
        skill_level_changes=skill_level_changes,
    )


def format_notification_message(changes: LevelWatchChanges) -> str | None:
    if not changes.has_changes:
        return None

    parts = ["レベルアップを検知しました。"]
    if changes.user_level_change is not None:
        before, after = changes.user_level_change
        parts.append(f"ユーザーレベルが Lv.{before} → Lv.{after} に上がりました。")
    if changes.skill_level_changes:
        skill_text = "、".join(
            f"{change.name}が Lv.{change.previous_level} → Lv.{change.current_level}"
            for change in changes.skill_level_changes
        )
        parts.append(f"{skill_text} に上がりました。")
    return "".join(parts)


class LevelWatchService:
    def __init__(
        self,
        *,
        snapshot_path: Path = DEFAULT_LEVEL_WATCH_SNAPSHOT_PATH,
        logger_instance: logging.Logger | None = None,
    ) -> None:
        self._snapshot_path = Path(snapshot_path)
        self._logger = logger_instance or logger

    async def check_once(self, api_client) -> str | None:
        user, skills = await asyncio.gather(
            api_client.get_user(),
            api_client.get_skills(),
        )
        current = build_snapshot(user, skills)
        previous = self.load_snapshot()
        self.save_snapshot(current)
        if previous is None:
            return None
        return format_notification_message(detect_changes(previous, current))

    def load_snapshot(self) -> LevelWatchSnapshot | None:
        if not self._snapshot_path.exists():
            return None
        try:
            payload = json.loads(self._snapshot_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("snapshot payload must be an object")
            return LevelWatchSnapshot.from_dict(payload)
        except Exception:
            self._logger.exception(
                "Failed to load level watch snapshot: %s",
                self._snapshot_path,
            )
            return None

    def save_snapshot(self, snapshot: LevelWatchSnapshot) -> None:
        self._snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        self._snapshot_path.write_text(
            json.dumps(snapshot.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
