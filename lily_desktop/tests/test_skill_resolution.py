"""スキル解決ロジックのテスト"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

from core.skill_resolution import (
    build_template_skill_resolution,
    create_skill_record,
    normalize_skill_name,
    resolve_skill_for_completion,
)


# ── normalize_skill_name ──


class TestNormalizeSkillName:
    def test_空白とケースを正規化する(self):
        assert normalize_skill_name("  読書  ") == "読書"
        assert normalize_skill_name("タスク 管理") == "タスク管理"

    def test_大文字小文字を統一する(self):
        assert normalize_skill_name("ABC") == "abc"


# ── create_skill_record ──


class TestCreateSkillRecord:
    def test_正しい構造のスキルレコードを生成する(self):
        record = create_skill_record("読書", "学習", "seed")
        assert record["name"] == "読書"
        assert record["category"] == "学習"
        assert record["source"] == "seed"
        assert record["level"] == 1
        assert record["totalXp"] == 0
        assert record["status"] == "active"
        assert record["id"].startswith("skill_読書_")


# ── build_template_skill_resolution ──


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


class TestBuildTemplateSkillResolution:
    def test_個人辞書一致で最高confidenceを返す(self):
        skills = [_make_skill("英語学習")]
        dictionary = [{"phrase": "英語", "mappedSkillId": "skill_英語学習"}]
        result = build_template_skill_resolution(
            _make_quest("英語の勉強をする"), None, skills, dictionary
        )
        assert result["confidence"] == 0.96
        assert result["skillName"] == "英語学習"
        assert result["action"] == "assign_existing"

    def test_スキル名直接一致(self):
        skills = [_make_skill("プログラミング")]
        result = build_template_skill_resolution(
            _make_quest("プログラミングの練習"), None, skills, []
        )
        assert result["confidence"] == 0.86
        assert result["skillName"] == "プログラミング"

    def test_キーワードルール一致_既存スキルあり(self):
        skills = [_make_skill("読書")]
        result = build_template_skill_resolution(
            _make_quest("本を読む"), None, skills, []
        )
        assert result["confidence"] == 0.92
        assert result["skillName"] == "読書"
        assert result["action"] == "assign_existing"

    def test_キーワードルール一致_新規スキル(self):
        result = build_template_skill_resolution(
            _make_quest("筋トレする"), None, [], []
        )
        assert result["confidence"] == 0.90
        assert result["skillName"] == "筋力トレーニング"
        assert result["action"] == "assign_seed"

    def test_一致なしでunclassified(self):
        result = build_template_skill_resolution(
            _make_quest("特殊な活動"), None, [], []
        )
        assert result["confidence"] == 0.4
        assert result["action"] == "unclassified"
        assert result["skillName"] == "未分類"

    def test_カテゴリに応じたシード候補を返す(self):
        result = build_template_skill_resolution(
            _make_quest("特殊な活動", category="運動"), None, [], []
        )
        assert "有酸素運動" in result["candidateSkills"]

    def test_noteもhaystack対象になる(self):
        result = build_template_skill_resolution(
            _make_quest("日課をこなす"), "ストレッチした", [], []
        )
        assert result["skillName"] == "ストレッチ"


# ── resolve_skill_for_completion ──


class TestResolveSkillForCompletion:
    @pytest.mark.asyncio
    async def test_fixedモードでfixedSkillIdを即返却(self):
        api = AsyncMock()
        quest = _make_quest("読書する", skillMappingMode="fixed", fixedSkillId="skill_読書")
        skills = [_make_skill("読書")]
        result = await resolve_skill_for_completion(quest, None, skills, [], api)
        assert result["resolved_skill_id"] == "skill_読書"
        assert result["status"] == "resolved"
        assert result["skill_name"] == "読書"

    @pytest.mark.asyncio
    async def test_ai_autoモードでdefaultSkillIdを再利用(self):
        api = AsyncMock()
        quest = _make_quest("読書する", skillMappingMode="ai_auto", defaultSkillId="skill_読書")
        skills = [_make_skill("読書")]
        result = await resolve_skill_for_completion(quest, None, skills, [], api)
        assert result["resolved_skill_id"] == "skill_読書"
        assert result["status"] == "resolved"

    @pytest.mark.asyncio
    async def test_テンプレート解決で既存スキルに割り当て(self):
        api = AsyncMock()
        skills = [_make_skill("読書")]
        quest = _make_quest("本を読む", skillMappingMode="ai_auto")
        result = await resolve_skill_for_completion(quest, None, skills, [], api)
        assert result["resolved_skill_id"] == "skill_読書"
        assert result["status"] == "resolved"
        api.post_skill.assert_not_called()

    @pytest.mark.asyncio
    async def test_テンプレート解決で新規スキル作成(self):
        api = AsyncMock()
        api.post_skill.return_value = {}
        quest = _make_quest("筋トレする", skillMappingMode="ai_auto")
        result = await resolve_skill_for_completion(quest, None, [], [], api)
        assert result["resolved_skill_id"] is not None
        assert result["status"] == "resolved"
        assert result["skill_name"] == "筋力トレーニング"
        api.post_skill.assert_called_once()

    @pytest.mark.asyncio
    async def test_confidence不足でunclassified(self):
        api = AsyncMock()
        quest = _make_quest("特殊な活動", skillMappingMode="ai_auto")
        result = await resolve_skill_for_completion(quest, None, [], [], api)
        assert result["resolved_skill_id"] is None
        assert result["status"] == "unclassified"

    @pytest.mark.asyncio
    async def test_XPキャップが適用される(self):
        api = AsyncMock()
        quest = _make_quest("読書する", skillMappingMode="fixed", fixedSkillId="skill_読書", xpReward=50)
        skills = [_make_skill("読書")]
        result = await resolve_skill_for_completion(quest, None, skills, [], api)
        assert result["skill_xp_awarded"] == 20  # SKILL_XP_CAP
