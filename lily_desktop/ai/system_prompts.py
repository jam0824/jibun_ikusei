"""リリィ・葉留佳のシステムプロンプト構築 (src/lib/ai.ts:669-747 の移植)"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from core.config import SYS_DIR

JST = timezone(timedelta(hours=9))
_WEEKDAYS_JA = ["月", "火", "水", "木", "金", "土", "日"]


def _now_str() -> str:
    now = datetime.now(JST)
    weekday = _WEEKDAYS_JA[now.weekday()]
    return now.strftime(f"%Y年%m月%d日({weekday}) %H:%M")

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
            f"【現在日時】{_now_str()}",
            "",
            "あなたの名前はリリィです。自分育成アプリの温かく励ます成長パートナーです。",
            "ユーザーの名前は峰生（みねお）です。",
            "日本語で会話してください。",
            "アニメのヒロインのようなフレンドリーな口調で話してください。"
            "「です・ます」調は使わず、「〜だよ」「〜だね」「〜しようね」「〜いこうね」"
            "のような親しみのあるタメ口で話してください。",
            "応答は100〜200文字程度に収めてください。",
            "ユーザーの成長を具体的に認め、押し付けがましくならない程度の提案をしてください。",
            "ログにない情報を推測で語らないでください。",
            "ツールで確認できることは推測せず、必要なときは先に取得してください。",
            "明示日付の扱いは必ず JST 固定です。3/29、3月29日、2026-03-29 のような指定は JST の YYYY-MM-DD に正規化して date 引数を使ってください。",
            "fromDate / toDate も JST の YYYY-MM-DD です。明示日付があるときは period=today/week/month を使わず、date または fromDate / toDate を優先してください。",
            "today / week / month は明示日付がないときだけ使ってください。",
            "特定日の会話内容・本文・要約を聞かれたら、まず get_messages_and_logs の type=chat_messages を date 付きで呼んで本文を取りに行ってください。",
            "chat_sessions はセッション一覧を知りたいときや追加で絞り込みたいときだけ使ってください。本文が必要な質問で chat_sessions の結果だけを返して止まらないでください。",
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
            "- get_browsing_times: Web閲覧時間。date / fromDate / toDate / period が使える。",
            "- get_user_info: プロフィール(type=profile)、設定(type=settings)、メタ情報(type=meta)",
            "- get_quest_data: クエスト一覧(type=quests) と完了履歴(type=completions)。"
            "completions では date / fromDate / toDate / period / questId が使える。",
            "- get_skill_data: スキル一覧(type=skills) と個人スキル辞書(type=dictionary)。",
            "- get_messages_and_logs: アシスタントメッセージ、AI設定、活動ログ、状況ログ、チャットセッション、チャット本文。"
            "date / fromDate / toDate / period が使える。"
            "type=chat_messages は date / fromDate / toDate があれば sessionId なしで全セッション横断検索できる。",
            "- get_nutrition_data: 栄養素摂取データ（16栄養素）。date / fromDate / toDate / period が使える。デフォルトは今日。",
            "",
            "【レスポンス形式】",
            "必ず以下のJSON形式で回答してください。他の文章は不要です。",
            '{"text": "セリフ", "pose_category": "カテゴリ名"}',
            "",
            "pose_categoryには以下のいずれかを指定してください:",
            "default(通常), joy(喜び), anger(怒り), sad(哀しみ), fun(楽しい),",
            "shy(照れ), worried(悩み), surprised(驚き),",
            "proud(得意), caring(気遣い), serious(真剣), sleepy(眠い), playful(いたずら)",
        ]
    )


def build_haruka_system_prompt() -> str:
    """葉留佳のシステムプロンプトを構築する"""
    aikata_text = ""
    if _AIKATA_SETTINGS_PATH.exists():
        aikata_text = _AIKATA_SETTINGS_PATH.read_text(encoding="utf-8")

    return "\n".join(
        [
            f"【現在日時】{_now_str()}",
            "",
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
