from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from core.skill_resolution import (
    build_template_skill_resolution,
    create_skill_record,
    normalize_skill_name,
    resolve_skill_for_completion,
    resolve_skill_for_completion_with_ai,
)


def _make_quest(title: str, **kwargs) -> dict:
    return {"id": "q1", "title": title, "xpReward": 10, **kwargs}


def _make_skill(name: str, **kwargs) -> dict:
    return {
        "id": f"skill_{name}",
        "name": name,
        "category": "学習",
        "status": "active",
        **kwargs,
    }


class TestNormalizeSkillName:
    def test_normalizes_spacing_and_case(self):
        assert normalize_skill_name("  読書  ") == "読書"
        assert normalize_skill_name("ABC") == "abc"


class TestCreateSkillRecord:
    def test_creates_active_skill_record(self):
        record = create_skill_record("読書", "学習", "seed")
        assert record["name"] == "読書"
        assert record["category"] == "学習"
        assert record["source"] == "seed"
        assert record["level"] == 1
        assert record["totalXp"] == 0
        assert record["status"] == "active"
        assert record["id"].startswith("skill_")


class TestBuildTemplateSkillResolution:
    def test_prefers_dictionary_matches(self):
        skills = [_make_skill("読書")]
        dictionary = [{"phrase": "朝読書", "mappedSkillId": "skill_読書"}]

        result = build_template_skill_resolution(
            _make_quest("朝読書をする"),
            None,
            skills,
            dictionary,
        )

        assert result["action"] == "assign_existing"
        assert result["skillName"] == "読書"
        assert result["confidence"] == 0.96

    def test_matches_existing_skill_by_keyword(self):
        result = build_template_skill_resolution(
            _make_quest("本を読む"),
            None,
            [_make_skill("読書")],
            [],
        )

        assert result["action"] == "assign_existing"
        assert result["skillName"] == "読書"
        assert result["confidence"] >= 0.8

    def test_returns_seed_skill_for_known_keyword(self):
        result = build_template_skill_resolution(
            _make_quest("筋トレする"),
            None,
            [],
            [],
        )

        assert result["action"] == "assign_seed"
        assert result["skillName"] != "未分類"
        assert result["confidence"] >= 0.8

    def test_returns_unclassified_for_unknown_activity(self):
        result = build_template_skill_resolution(
            _make_quest("特殊な活動", category="健康"),
            None,
            [],
            [],
        )

        assert result["action"] == "unclassified"
        assert result["confidence"] == 0.4
        assert result["candidateSkills"]

    def test_note_is_included_in_matching(self):
        result = build_template_skill_resolution(
            _make_quest("今日の記録"),
            "ストレッチをした",
            [],
            [],
        )

        assert result["skillName"] == "ストレッチ"


class TestResolveSkillForCompletion:
    @pytest.mark.asyncio
    async def test_fixed_mode_resolves_immediately(self):
        api = AsyncMock()
        quest = _make_quest("読書する", skillMappingMode="fixed", fixedSkillId="skill_読書")

        result = await resolve_skill_for_completion(quest, None, [_make_skill("読書")], [], api)

        assert result["resolved_skill_id"] == "skill_読書"
        assert result["status"] == "resolved"
        assert result["skill_name"] == "読書"

    @pytest.mark.asyncio
    async def test_ai_auto_reuses_default_skill(self):
        api = AsyncMock()
        quest = _make_quest("読書する", skillMappingMode="ai_auto", defaultSkillId="skill_読書")

        result = await resolve_skill_for_completion(quest, None, [_make_skill("読書")], [], api)

        assert result["resolved_skill_id"] == "skill_読書"
        assert result["status"] == "resolved"

    @pytest.mark.asyncio
    async def test_local_resolution_reuses_existing_skill(self):
        api = AsyncMock()
        quest = _make_quest("本を読む", skillMappingMode="ai_auto")

        result = await resolve_skill_for_completion(quest, None, [_make_skill("読書")], [], api)

        assert result["resolved_skill_id"] == "skill_読書"
        assert result["status"] == "resolved"
        api.post_skill.assert_not_called()

    @pytest.mark.asyncio
    async def test_local_resolution_creates_new_skill_for_high_confidence_seed(self):
        api = AsyncMock()
        api.post_skill.return_value = {}
        quest = _make_quest("筋トレする", skillMappingMode="ai_auto")

        result = await resolve_skill_for_completion(quest, None, [], [], api)

        assert result["resolved_skill_id"] is not None
        assert result["status"] == "resolved"
        assert result["skill_name"]
        api.post_skill.assert_called_once()

    @pytest.mark.asyncio
    async def test_unknown_activity_becomes_unclassified(self):
        api = AsyncMock()
        quest = _make_quest("特殊な活動", skillMappingMode="ai_auto", category="健康")

        result = await resolve_skill_for_completion(quest, None, [], [], api)

        assert result["resolved_skill_id"] is None
        assert result["status"] == "unclassified"

    @pytest.mark.asyncio
    async def test_heel_raise_after_meals_stays_unclassified_without_ai(self):
        api = AsyncMock()
        quest = _make_quest("食後のかかと上げ", skillMappingMode="ai_auto", category="健康")

        result = await resolve_skill_for_completion(quest, None, [], [], api)

        assert result["resolved_skill_id"] is None
        assert result["status"] == "unclassified"

    @pytest.mark.asyncio
    async def test_skill_xp_is_capped(self):
        api = AsyncMock()
        quest = _make_quest("読書する", skillMappingMode="fixed", fixedSkillId="skill_読書", xpReward=50)

        result = await resolve_skill_for_completion(quest, None, [_make_skill("読書")], [], api)

        assert result["skill_xp_awarded"] == 20

    @pytest.mark.asyncio
    async def test_ai_failure_falls_back_to_local_resolution(self, monkeypatch):
        api = AsyncMock()
        quest = _make_quest("食後のかかと上げ", skillMappingMode="ai_auto", category="健康")
        monkeypatch.setattr(
            "core.skill_resolution.request_openai_json",
            AsyncMock(side_effect=RuntimeError("boom")),
        )

        result = await resolve_skill_for_completion_with_ai(
            quest,
            None,
            [],
            [],
            api,
            api_key="sk-test",
            model="gpt-5.4",
        )

        assert result["resolved_skill_id"] is None
        assert result["status"] == "unclassified"
