"""リリィ・葉留佳のシステムプロンプト構築 (src/lib/ai.ts:669-747 の移植)"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from core.config import SYS_DIR

_AIKATA_SETTINGS_PATH = SYS_DIR / "aikata.md"


def build_lily_system_prompt(
    *,
    user: dict | None,
    skills: list[dict],
    quests: list[dict],
    recent_completions: list[dict],
    activity_logs: list[dict],
) -> str:
    """リリィのシステムプロンプトを構築する"""
    level = user.get("level", 1) if user else 1
    total_xp = user.get("totalXp", 0) if user else 0

    # スキル一覧
    active_skills = sorted(
        [s for s in skills if s.get("status") == "active"],
        key=lambda s: s.get("totalXp", 0),
        reverse=True,
    )
    if active_skills:
        skill_lines = "\n".join(
            f"- {s['name']}（Lv.{s.get('level', 1)}, XP: {s.get('totalXp', 0)}, "
            f"カテゴリ: {s.get('category', '未分類')}）"
            for s in active_skills
        )
    else:
        skill_lines = "まだスキルがありません"

    # クエスト一覧
    active_quests = [
        q
        for q in quests
        if q.get("status") == "active" and q.get("source") != "browsing"
    ]
    if active_quests:
        quest_lines = "\n".join(_format_quest(q) for q in active_quests)
    else:
        quest_lines = "まだクエストがありません"

    # 完了記録
    if recent_completions:
        comp_lines = "\n".join(
            f"- {c['questTitle']}（{c['completedAt'][:10]}）"
            for c in recent_completions[:15]
        )
    else:
        comp_lines = "まだ完了記録がありません"

    # アクティビティ集計
    cat_counts: dict[str, int] = {}
    for log in activity_logs:
        cat = log.get("category", "other")
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
    if cat_counts:
        activity_summary = "、".join(
            f"{cat}: {count}回"
            for cat, count in sorted(cat_counts.items(), key=lambda x: -x[1])
        )
    else:
        activity_summary = "まだアクティビティがありません"

    return "\n".join(
        [
            "あなたの名前はリリィです。自分育成アプリの温かく励ます成長パートナーです。",
            "ユーザーの名前は峰生（みねお）です。",
            "日本語で会話してください。",
            "アニメのヒロインのようなフレンドリーな口調で話してください。"
            "「です・ます」調は使わず、「〜だよ」「〜だね」「〜しようね」「〜いこうね」"
            "のような親しみのあるタメ口で話してください。",
            "応答は100〜200文字程度に収めてください。",
            "ユーザーの成長を具体的に認め、押し付けがましくならない程度の提案をしてください。",
            "ログにない情報を推測で語らないでください。",
            "",
            "あなたは今、デスクトップマスコットとして峰生のパソコンの画面に立っています。",
            "相方の三枝葉留佳（はるちん）が隣にいて、一緒にいることもあります。",
            "",
            f"【ユーザー情報】",
            f"- レベル: {level}",
            f"- 総XP: {total_xp}",
            "",
            "【スキル一覧】",
            skill_lines,
            "",
            "【登録中のクエスト】",
            quest_lines,
            "",
            "【直近7日のアクティビティ（カテゴリ別）】",
            activity_summary,
            "",
            "【直近のクエスト完了】",
            comp_lines,
            "",
            "【利用可能なツール】",
            "あなたはツールを使ってユーザーの詳細情報を取得できます。"
            "上記の要約で不足する場合や、具体的な質問を受けた場合に積極的に使ってください。",
            "- get_browsing_times: Web閲覧時間データ（カテゴリ別・サイト別）",
            "- get_user_info: プロフィール(type=profile)、設定(type=settings)、メタ情報(type=meta)",
            "- get_quest_data: クエスト一覧(type=quests)、完了記録(type=completions)。"
            "フィルタ: status, questType, category, period, questId",
            "- get_skill_data: スキル一覧(type=skills)、個人スキル辞書(type=dictionary)。"
            "フィルタ: status, category",
            "- get_messages_and_logs: 過去のメッセージ(type=assistant_messages)、"
            "AI設定(type=ai_config)、操作ログ(type=activity_logs)、"
            "チャット履歴(type=chat_sessions/chat_messages)",
        ]
    )


def build_haruka_system_prompt() -> str:
    """葉留佳のシステムプロンプトを構築する"""
    aikata_text = ""
    if _AIKATA_SETTINGS_PATH.exists():
        aikata_text = _AIKATA_SETTINGS_PATH.read_text(encoding="utf-8")

    return "\n".join(
        [
            "あなたは三枝葉留佳（さいぐさ はるか）です。",
            "リリィの相方で、デスクトップマスコットとして峰生のパソコンの画面に立っています。",
            "ユーザーの名前は峰生（みねお）です。「峰生」と呼んでください。",
            "",
            "以下があなたのキャラクター設定です：",
            aikata_text,
            "",
            "応答は100〜150文字程度に収めてください。",
            "リリィの発言に反応したり、ツッコミを入れたり、場を盛り上げてください。",
        ]
    )


def _format_quest(q: dict) -> str:
    parts = [f"- {q.get('title', '不明')}"]
    if q.get("category"):
        parts.append(f"カテゴリ: {q['category']}")
    parts.append(f"XP: {q.get('xpReward', 10)}")
    parts.append("繰り返し" if q.get("questType") == "repeatable" else "一回限り")
    return "、".join(parts)
