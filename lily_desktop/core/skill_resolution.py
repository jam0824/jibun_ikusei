"""Desktop skill resolution helpers.

This module mirrors the web app's local fallback heuristics and adds
OpenAI-backed structured classification for post-save re-evaluation.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from ai.openai_client import request_openai_json

if TYPE_CHECKING:
    from api.api_client import ApiClient

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))
SKILL_XP_CAP = 20
UNKNOWN_SKILL_NAME = "未分類"
RESOLVED_CONFIDENCE = 0.8
NEEDS_CONFIRMATION_CONFIDENCE = 0.55
DEFAULT_CATEGORY = "その他"

KEYWORD_RULES: list[dict[str, Any]] = [
    {
        "keywords": ["読書", "本", "書籍", "学習", "勉強"],
        "skillName": "読書",
        "category": "学習",
        "confidence": 0.92,
    },
    {
        "keywords": ["プレゼン", "発表", "会話", "相談", "コミュニケーション"],
        "skillName": "コミュニケーション",
        "category": "人間関係",
        "confidence": 0.86,
    },
    {
        "keywords": ["エアロバイク", "バイク", "ランニング", "ジョギング", "ウォーキング", "cycling"],
        "skillName": "有酸素運動",
        "category": "運動",
        "confidence": 0.94,
    },
    {
        "keywords": ["筋トレ", "スクワット", "腹筋", "トレーニング"],
        "skillName": "筋力トレーニング",
        "category": "運動",
        "confidence": 0.90,
    },
    {
        "keywords": ["ストレッチ", "ヨガ", "ほぐし"],
        "skillName": "ストレッチ",
        "category": "運動",
        "confidence": 0.88,
    },
    {
        "keywords": ["料理", "自炊", "献立", "食事記録"],
        "skillName": "料理",
        "category": "健康",
        "confidence": 0.84,
    },
    {
        "keywords": ["タスク", "整理", "記録", "メモ"],
        "skillName": "タスク管理",
        "category": "仕事",
        "confidence": 0.82,
    },
]

SEED_SKILLS: list[dict[str, Any]] = [
    {"category": "学習", "names": ["読書", "学習習慣", "情報整理"]},
    {"category": "運動", "names": ["有酸素運動", "筋力トレーニング", "ストレッチ"]},
    {"category": "仕事", "names": ["タスク管理", "文章作成", "振り返り"]},
    {"category": "健康", "names": ["睡眠改善", "食事管理", "生活リズム"]},
    {"category": "人間関係", "names": ["コミュニケーション", "傾聴", "気配り"]},
    {"category": "創作", "names": ["ライティング", "デザイン", "アイデア発想"]},
    {"category": DEFAULT_CATEGORY, "names": ["生活改善", "継続力", "振り返り"]},
]

SKILL_RESOLUTION_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "action": {
            "type": "string",
            "enum": ["assign_existing", "assign_seed", "propose_new", "unclassified"],
        },
        "skillName": {"type": "string"},
        "category": {"type": "string"},
        "confidence": {"type": "number"},
        "reason": {"type": "string"},
        "candidateSkills": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 3,
        },
    },
    "required": ["action", "skillName", "category", "confidence", "reason", "candidateSkills"],
}

SKILL_RESOLUTION_SYSTEM_PROMPT_PREFIX = (
    "You classify completed quests into the most relevant life skill for a self-growth app. "
    "Return only valid JSON that strictly matches the provided schema. "
    "Use the literal meaning of the activity, not a metaphor. "
    "Physical activities such as cycling, aerobike, running, walking, stretching, workouts, and training "
    "belong to exercise or fitness related skills, not study or learning. "
    "Reuse an existing skill or seed skill when it is semantically close."
)


def normalize_skill_name(name: str) -> str:
    return re.sub(r"\s+", "", name.strip().lower())


def _slugify(name: str) -> str:
    slug = name.strip().lower().replace(" ", "-").replace("\u3000", "-")
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


def _normalize_category(category: Any) -> str:
    if not isinstance(category, str):
        return DEFAULT_CATEGORY

    trimmed = category.strip()
    if not trimmed:
        return DEFAULT_CATEGORY

    aliases = {
        "study": "学習",
        "exercise": "運動",
        "fitness": "運動",
        "work": "仕事",
        "health": "健康",
        "social": "人間関係",
        "creative": "創作",
        "other": DEFAULT_CATEGORY,
    }
    return aliases.get(trimmed.lower(), trimmed)


def _is_unknown_skill_name(skill_name: str) -> bool:
    return normalize_skill_name(skill_name) in {"", normalize_skill_name(UNKNOWN_SKILL_NAME)}


def _resolution_source(action: str) -> str:
    if action == "assign_seed":
        return "seed"
    if action == "propose_new":
        return "ai"
    return "manual"


def _build_skill_resolution_system_prompt(skills: list[dict[str, Any]]) -> str:
    categories = sorted(
        {
            _normalize_category(skill.get("category"))
            for skill in skills
            if isinstance(skill.get("category"), str) and skill.get("category", "").strip()
        }
    )
    if not categories:
        return SKILL_RESOLUTION_SYSTEM_PROMPT_PREFIX
    return f"{SKILL_RESOLUTION_SYSTEM_PROMPT_PREFIX} Prefer these known categories when appropriate: {', '.join(categories)}."


def _build_openai_skill_resolution_payload(
    quest: dict[str, Any],
    note: str | None,
    skills: list[dict[str, Any]],
    dictionary: list[dict[str, Any]],
) -> dict[str, Any]:
    skill_name_by_id = {
        skill.get("id"): skill.get("name")
        for skill in skills
        if isinstance(skill.get("id"), str) and isinstance(skill.get("name"), str)
    }

    return {
        "task": "quest_skill_resolution",
        "quest": {
            "title": quest.get("title"),
            "description": quest.get("description"),
            "category": quest.get("category"),
            "note": note,
        },
        "existingSkills": [
            {"name": skill.get("name"), "category": _normalize_category(skill.get("category"))}
            for skill in skills
            if isinstance(skill.get("name"), str)
        ],
        "seedSkills": [
            {"name": skill.get("name"), "category": _normalize_category(skill.get("category"))}
            for skill in skills
            if skill.get("source") == "seed" and isinstance(skill.get("name"), str)
        ],
        "userDictionary": [
            {
                "phrase": entry.get("phrase"),
                "mappedSkillName": skill_name_by_id.get(entry.get("mappedSkillId")),
            }
            for entry in dictionary
            if isinstance(entry.get("phrase"), str) and skill_name_by_id.get(entry.get("mappedSkillId"))
        ],
    }


def _normalize_ai_resolution_result(result: dict[str, Any]) -> dict[str, Any]:
    action = result.get("action")
    skill_name = result.get("skillName")
    category = result.get("category")
    reason = result.get("reason")
    confidence = result.get("confidence")
    candidate_skills = result.get("candidateSkills")

    if action not in {"assign_existing", "assign_seed", "propose_new", "unclassified"}:
        raise ValueError("Invalid skill resolution action.")
    if not isinstance(skill_name, str) or not skill_name.strip():
        raise ValueError("Invalid skill name.")
    if not isinstance(category, str) or not category.strip():
        raise ValueError("Invalid skill category.")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("Invalid skill resolution reason.")
    if not isinstance(confidence, (int, float)):
        raise ValueError("Invalid skill confidence.")
    if not isinstance(candidate_skills, list):
        raise ValueError("Invalid candidate skills.")

    normalized_candidates = [
        candidate.strip()
        for candidate in candidate_skills
        if isinstance(candidate, str) and candidate.strip()
    ][:3]
    if not normalized_candidates:
        raise ValueError("Candidate skills are required.")

    return {
        "action": action,
        "skillName": skill_name.strip(),
        "category": _normalize_category(category),
        "confidence": max(0.0, min(float(confidence), 1.0)),
        "reason": reason.strip(),
        "candidateSkills": normalized_candidates,
    }


def build_template_skill_resolution(
    quest: dict[str, Any],
    note: str | None,
    skills: list[dict[str, Any]],
    dictionary: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build the local fallback resolution used by desktop and web."""

    haystack = f"{quest.get('title', '')} {quest.get('description', '')} {note or ''}".lower()

    for entry in dictionary:
        phrase = str(entry.get("phrase", "")).strip().lower()
        if not phrase or phrase not in haystack:
            continue
        mapped_skill_id = entry.get("mappedSkillId", "")
        skill = next((candidate for candidate in skills if candidate.get("id") == mapped_skill_id), None)
        if skill is None:
            continue
        return {
            "action": "assign_existing",
            "skillName": skill["name"],
            "category": _normalize_category(skill.get("category")),
            "confidence": 0.96,
            "reason": "ユーザー辞書に一致したため、既存スキルを再利用しました。",
            "candidateSkills": [skill["name"]],
        }

    for skill in skills:
        if skill.get("status") != "active":
            continue
        skill_name = str(skill.get("name", "")).strip()
        if skill_name and skill_name.lower() in haystack:
            return {
                "action": "assign_existing",
                "skillName": skill_name,
                "category": _normalize_category(skill.get("category")),
                "confidence": 0.86,
                "reason": "クエスト名やメモに既存スキル名が含まれていました。",
                "candidateSkills": [skill_name],
            }

    for rule in KEYWORD_RULES:
        if not any(keyword.lower() in haystack for keyword in rule["keywords"]):
            continue
        exists = any(skill.get("name") == rule["skillName"] for skill in skills)
        return {
            "action": "assign_existing" if exists else "assign_seed",
            "skillName": rule["skillName"],
            "category": rule["category"],
            "confidence": rule["confidence"],
            "reason": "キーワード一致からスキルを推定しました。",
            "candidateSkills": [rule["skillName"]],
        }

    category = _normalize_category(quest.get("category"))
    seed_group = next((group for group in SEED_SKILLS if group["category"] == category), None)
    if seed_group is None:
        seed_group = next(group for group in SEED_SKILLS if group["category"] == DEFAULT_CATEGORY)

    return {
        "action": "unclassified",
        "skillName": UNKNOWN_SKILL_NAME,
        "category": category,
        "confidence": 0.4,
        "reason": "ローカル判定では十分な手がかりが見つかりませんでした。",
        "candidateSkills": seed_group["names"][:3],
    }


async def request_ai_skill_resolution(
    quest: dict[str, Any],
    note: str | None,
    skills: list[dict[str, Any]],
    dictionary: list[dict[str, Any]],
    *,
    api_key: str,
    model: str,
) -> dict[str, Any]:
    payload = _build_openai_skill_resolution_payload(quest, note, skills, dictionary)
    result = await request_openai_json(
        api_key=api_key,
        model=model,
        schema_name="skill_resolution",
        schema=SKILL_RESOLUTION_JSON_SCHEMA,
        input_payload=payload,
        system_prompt=_build_skill_resolution_system_prompt(skills),
    )
    if not isinstance(result, dict):
        raise ValueError("OpenAI skill resolution result must be an object.")
    return _normalize_ai_resolution_result(result)


async def _ensure_skill_id(
    skill_name: str,
    category: str,
    source: str,
    skills: list[dict[str, Any]],
    api: ApiClient,
) -> tuple[str, list[dict[str, Any]]]:
    normalized = normalize_skill_name(skill_name)
    existing = next(
        (
            skill
            for skill in skills
            if skill.get("status") == "active"
            and normalize_skill_name(str(skill.get("name", ""))) == normalized
        ),
        None,
    )
    if existing is not None:
        return existing["id"], skills

    new_skill = create_skill_record(skill_name, category, source)
    await api.post_skill(new_skill)
    return new_skill["id"], [new_skill, *skills]


async def _ensure_candidate_skill_ids(
    candidate_names: list[str],
    category: str,
    source: str,
    skills: list[dict[str, Any]],
    api: ApiClient,
) -> tuple[list[str], list[dict[str, Any]]]:
    candidate_ids: list[str] = []
    current_skills = list(skills)

    for candidate_name in candidate_names:
        normalized_candidate = candidate_name.strip()
        if _is_unknown_skill_name(normalized_candidate):
            continue
        skill_id, current_skills = await _ensure_skill_id(
            normalized_candidate,
            category,
            source,
            current_skills,
            api,
        )
        if skill_id not in candidate_ids:
            candidate_ids.append(skill_id)
        if len(candidate_ids) >= 3:
            break

    return candidate_ids, current_skills


async def apply_skill_resolution_result(
    quest: dict[str, Any],
    resolution: dict[str, Any],
    skills: list[dict[str, Any]],
    api: ApiClient,
) -> dict[str, Any]:
    xp_award = min(int(quest.get("xpReward", 10)), SKILL_XP_CAP)
    category = _normalize_category(resolution.get("category"))
    reason = str(resolution.get("reason", "")).strip()
    action = str(resolution.get("action", "unclassified"))
    skill_name = str(resolution.get("skillName", "")).strip()
    candidate_names = [
        str(candidate).strip()
        for candidate in resolution.get("candidateSkills", [])
        if str(candidate).strip()
    ]

    if float(resolution.get("confidence", 0.0)) >= RESOLVED_CONFIDENCE and not _is_unknown_skill_name(skill_name):
        skill_id, _ = await _ensure_skill_id(
            skill_name,
            category,
            _resolution_source(action),
            skills,
            api,
        )
        return {
            "resolved_skill_id": skill_id,
            "skill_xp_awarded": xp_award,
            "skill_name": skill_name,
            "status": "resolved",
            "reason": reason,
            "candidate_skill_ids": [],
        }

    if float(resolution.get("confidence", 0.0)) >= NEEDS_CONFIRMATION_CONFIDENCE:
        candidate_skill_ids, _ = await _ensure_candidate_skill_ids(
            candidate_names,
            category,
            _resolution_source(action),
            skills,
            api,
        )
        return {
            "resolved_skill_id": None,
            "skill_xp_awarded": 0,
            "skill_name": "",
            "status": "needs_confirmation" if candidate_skill_ids else "unclassified",
            "reason": reason,
            "candidate_skill_ids": candidate_skill_ids,
        }

    return {
        "resolved_skill_id": None,
        "skill_xp_awarded": 0,
        "skill_name": "",
        "status": "unclassified",
        "reason": reason,
        "candidate_skill_ids": [],
    }


async def resolve_skill_for_completion(
    quest: dict[str, Any],
    note: str | None,
    skills: list[dict[str, Any]],
    dictionary: list[dict[str, Any]],
    api: ApiClient,
) -> dict[str, Any]:
    """Resolve completion skill using fixed/default mapping or local fallback only."""

    xp_award = min(int(quest.get("xpReward", 10)), SKILL_XP_CAP)

    if quest.get("skillMappingMode") == "fixed" and quest.get("fixedSkillId"):
        skill_id = quest["fixedSkillId"]
        skill = next((candidate for candidate in skills if candidate.get("id") == skill_id), None)
        return {
            "resolved_skill_id": skill_id,
            "skill_xp_awarded": xp_award,
            "skill_name": skill["name"] if skill else "固定スキル",
            "status": "resolved",
            "reason": "固定スキル設定を使用しました。",
            "candidate_skill_ids": [],
        }

    if quest.get("skillMappingMode") == "ai_auto" and quest.get("defaultSkillId"):
        skill_id = quest["defaultSkillId"]
        skill = next((candidate for candidate in skills if candidate.get("id") == skill_id), None)
        return {
            "resolved_skill_id": skill_id,
            "skill_xp_awarded": xp_award,
            "skill_name": skill["name"] if skill else "",
            "status": "resolved",
            "reason": "前回の解決結果を再利用しました。",
            "candidate_skill_ids": [],
        }

    resolution = build_template_skill_resolution(quest, note, skills, dictionary)
    return await apply_skill_resolution_result(quest, resolution, skills, api)


async def resolve_skill_for_completion_with_ai(
    quest: dict[str, Any],
    note: str | None,
    skills: list[dict[str, Any]],
    dictionary: list[dict[str, Any]],
    api: ApiClient,
    *,
    api_key: str,
    model: str,
) -> dict[str, Any]:
    """Resolve completion skill with OpenAI, falling back to local rules on failure."""

    try:
        resolution = await request_ai_skill_resolution(
            quest,
            note,
            skills,
            dictionary,
            api_key=api_key,
            model=model,
        )
    except Exception:
        logger.warning("OpenAI skill resolution failed, falling back to local rules.", exc_info=True)
        return await resolve_skill_for_completion(quest, note, skills, dictionary, api)

    return await apply_skill_resolution_result(quest, resolution, skills, api)
