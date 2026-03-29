"""テンプレートベースのスキル解決ロジック。

webアプリの src/domain/logic.ts:buildTemplateSkillResolution を Python に移植。
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from lily_desktop.api.api_client import ApiClient

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

SKILL_XP_CAP = 20

QUEST_CATEGORIES = ["学習", "運動", "仕事", "生活", "対人", "創作", "その他"]

KEYWORD_RULES: list[dict[str, Any]] = [
    {"keywords": ["読書", "本", "書籍", "勉強", "学習"], "skillName": "読書", "category": "学習", "confidence": 0.92},
    {"keywords": ["調べ", "調査", "リサーチ", "情報整理", "まとめ"], "skillName": "調査", "category": "学習", "confidence": 0.86},
    {"keywords": ["エアロバイク", "バイク", "有酸素", "ランニング", "ジョギング", "ウォーキング", "cycling"], "skillName": "有酸素運動", "category": "運動", "confidence": 0.94},
    {"keywords": ["筋トレ", "スクワット", "腹筋", "腕立て", "トレーニング"], "skillName": "筋力トレーニング", "category": "運動", "confidence": 0.90},
    {"keywords": ["ストレッチ", "ヨガ", "柔軟"], "skillName": "ストレッチ", "category": "運動", "confidence": 0.88},
    {"keywords": ["企画", "文章", "資料", "文書", "メモ", "書く"], "skillName": "文書作成", "category": "仕事", "confidence": 0.90},
    {"keywords": ["タスク", "予定", "整理", "進行", "管理"], "skillName": "タスク管理", "category": "仕事", "confidence": 0.86},
    {"keywords": ["掃除", "洗濯", "片付け", "料理"], "skillName": "家事", "category": "生活", "confidence": 0.88},
    {"keywords": ["睡眠", "早起き", "食事", "健康"], "skillName": "健康管理", "category": "生活", "confidence": 0.84},
    {"keywords": ["会話", "連絡", "相談", "対話"], "skillName": "コミュニケーション", "category": "対人", "confidence": 0.85},
    {"keywords": ["傾聴", "聞く", "ヒアリング"], "skillName": "傾聴", "category": "対人", "confidence": 0.82},
    {"keywords": ["デザイン", "レイアウト", "配色"], "skillName": "デザイン", "category": "創作", "confidence": 0.85},
    {"keywords": ["執筆", "ライティング", "記事", "文章作成"], "skillName": "ライティング", "category": "創作", "confidence": 0.84},
]

SEED_SKILLS: list[dict[str, Any]] = [
    {"category": "学習", "names": ["読書", "学習習慣", "情報整理", "調査"]},
    {"category": "運動", "names": ["有酸素運動", "筋力トレーニング", "ストレッチ"]},
    {"category": "仕事", "names": ["文書作成", "タスク管理", "集中作業", "企画設計"]},
    {"category": "生活", "names": ["家事", "健康管理", "睡眠習慣"]},
    {"category": "対人", "names": ["コミュニケーション", "傾聴", "気配り"]},
    {"category": "創作", "names": ["ライティング", "デザイン", "発想力"]},
]


def normalize_skill_name(name: str) -> str:
    return re.sub(r"\s+", "", name.strip().lower())


def _slugify(name: str) -> str:
    slug = name.strip().lower().replace(" ", "-").replace("　", "-")
    # Keep alphanumeric, hyphens, and CJK characters
    slug = re.sub(r"[^\w\u3000-\u9fff\uf900-\ufaff-]", "", slug)
    return slug[:40] or "skill"


def create_skill_record(name: str, category: str, source: str = "manual") -> dict[str, Any]:
    now = datetime.now(JST).isoformat()
    slug = _slugify(name)
    short_id = uuid.uuid4().hex[:8]
    return {
        "id": f"skill_{slug}_{short_id}",
        "name": name,
        "normalizedName": normalize_skill_name(name),
        "category": category,
        "level": 1,
        "totalXp": 0,
        "source": source,
        "status": "active",
        "createdAt": now,
        "updatedAt": now,
    }


def build_template_skill_resolution(
    quest: dict[str, Any],
    note: str | None,
    skills: list[dict[str, Any]],
    dictionary: list[dict[str, Any]],
) -> dict[str, Any]:
    """辞書 → スキル名直接一致 → キーワード → fallback の順でスキルを判定。"""
    haystack = f"{quest.get('title', '')} {quest.get('description', '')} {note or ''}".lower()

    # 1. 個人スキル辞書
    for entry in dictionary:
        phrase = (entry.get("phrase") or entry.get("id", "")).lower()
        if phrase and phrase in haystack:
            mapped_skill_id = entry.get("mappedSkillId", "")
            skill = next((s for s in skills if s.get("id") == mapped_skill_id), None)
            if skill:
                return {
                    "action": "assign_existing",
                    "skillName": skill["name"],
                    "category": skill.get("category", "その他"),
                    "confidence": 0.96,
                    "reason": "ユーザー辞書に一致したため、既存スキルを再利用しました。",
                    "candidateSkills": [skill["name"]],
                }

    # 2. スキル名直接一致
    for skill in skills:
        if skill.get("status") != "active":
            continue
        if skill.get("name", "").lower() in haystack:
            return {
                "action": "assign_existing",
                "skillName": skill["name"],
                "category": skill.get("category", "その他"),
                "confidence": 0.86,
                "reason": "クエスト文面に既存スキル名が含まれていたため再利用しました。",
                "candidateSkills": [skill["name"]],
            }

    # 3. キーワードルール
    for rule in KEYWORD_RULES:
        if any(kw.lower() in haystack for kw in rule["keywords"]):
            existing = any(s.get("name") == rule["skillName"] for s in skills)
            return {
                "action": "assign_existing" if existing else "assign_seed",
                "skillName": rule["skillName"],
                "category": rule["category"],
                "confidence": rule["confidence"],
                "reason": "キーワード一致から近いスキルを推定しました。",
                "candidateSkills": [rule["skillName"]],
            }

    # 4. fallback
    category = quest.get("category", "その他")
    if category not in QUEST_CATEGORIES:
        category = "その他"

    seed_group = next((g for g in SEED_SKILLS if g["category"] == category), None)
    candidate_names = seed_group["names"][:3] if seed_group else []

    return {
        "action": "unclassified",
        "skillName": "未分類",
        "category": category,
        "confidence": 0.4,
        "reason": "ローカル判定では十分な手がかりが見つかりませんでした。",
        "candidateSkills": candidate_names,
    }


async def resolve_skill_for_completion(
    quest: dict[str, Any],
    note: str | None,
    skills: list[dict[str, Any]],
    dictionary: list[dict[str, Any]],
    api: ApiClient,
) -> dict[str, Any]:
    """クエスト完了時のスキル解決オーケストレーター。

    Returns:
        dict with keys: resolved_skill_id, skill_xp_awarded, skill_name, status, reason
    """
    xp_award = min(quest.get("xpReward", 10), SKILL_XP_CAP)

    # fixed モード
    if quest.get("skillMappingMode") == "fixed" and quest.get("fixedSkillId"):
        skill_id = quest["fixedSkillId"]
        skill = next((s for s in skills if s.get("id") == skill_id), None)
        return {
            "resolved_skill_id": skill_id,
            "skill_xp_awarded": xp_award,
            "skill_name": skill["name"] if skill else "固定スキル",
            "status": "resolved",
            "reason": "固定スキル設定に基づいて即時反映しました。",
        }

    # ai_auto + defaultSkillId → 前回の解決結果を再利用
    if quest.get("skillMappingMode") == "ai_auto" and quest.get("defaultSkillId"):
        skill_id = quest["defaultSkillId"]
        skill = next((s for s in skills if s.get("id") == skill_id), None)
        return {
            "resolved_skill_id": skill_id,
            "skill_xp_awarded": xp_award,
            "skill_name": skill["name"] if skill else "",
            "status": "resolved",
            "reason": "前回の解決結果を再利用",
        }

    # テンプレート解決
    resolution = build_template_skill_resolution(quest, note, skills, dictionary)

    if resolution["confidence"] >= 0.8 and resolution["skillName"] != "未分類":
        skill_name = resolution["skillName"].strip()
        normalized = normalize_skill_name(skill_name)

        # 既存スキルを探す
        existing = next(
            (s for s in skills if s.get("status") == "active" and normalize_skill_name(s.get("name", "")) == normalized),
            None,
        )

        if existing:
            skill_id = existing["id"]
        else:
            # 新規スキル作成
            source = "seed" if resolution["action"] == "assign_seed" else "manual"
            new_skill = create_skill_record(skill_name, resolution["category"], source)
            skill_id = new_skill["id"]
            await api.post_skill(new_skill)

        return {
            "resolved_skill_id": skill_id,
            "skill_xp_awarded": xp_award,
            "skill_name": skill_name,
            "status": "resolved",
            "reason": resolution["reason"],
        }

    # confidence 不足 → unclassified
    return {
        "resolved_skill_id": None,
        "skill_xp_awarded": 0,
        "skill_name": "",
        "status": "unclassified",
        "reason": resolution["reason"],
    }
