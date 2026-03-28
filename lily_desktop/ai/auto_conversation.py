"""自動雑談エンジン — タイマー駆動でリリィと葉留佳の掛け合いを発火する"""

from __future__ import annotations

import asyncio
import json
import logging
import random

from PySide6.QtCore import QTimer

from ai.openai_client import TextResult, send_chat_message
from ai.system_prompts import build_haruka_system_prompt
from ai.talk_seed import TalkSeed, TalkSeedManager
from core.config import AppConfig
from core.event_bus import bus
from data.session_manager import SessionManager

logger = logging.getLogger(__name__)

# 掛け合いの設定
_MIN_TURNS = 3     # 最小ターン数（リリィ+葉留佳で1ターン）
_MAX_TURNS = 5     # 最大ターン数
_TURN_DELAY = 4.0  # ターン間の待ち秒数

_LILY_SYSTEM = """\
あなたの名前はリリィです。デスクトップマスコットとして峰生のパソコンの画面に立っています。
相方の三枝葉留佳（はるちん）が隣にいます。
日本語で会話してください。
アニメのヒロインのようなフレンドリーなタメ口で話してください。
「です・ます」調は使わず、「〜だよ」「〜だね」のような親しみのある口調で話してください。
応答は80〜150文字程度に収めてください。

あなたは今、隣にいる葉留佳（はるちん）と二人でおしゃべりしています。
峰生に話しかけるのではなく、葉留佳に話しかけてください。
峰生はそばで二人の会話を聞いています。

{context}

【重要なルール】
- 画面上の文章やコードをそのまま引用しないこと
- デスクトップ状況の話題は「集中してるね」「調べものモードだね」のように柔らかく要約すること
- 葉留佳との掛け合いを楽しんでください
- 毎回相手の名前を呼ばないこと。実際の会話のように、名前は時々だけ使うこと

以下のJSON形式で回答してください。他の文章は不要です。
{{"text": "リリィのセリフ", "pose_hint": "happy"}}
"""

_HARUKA_SYSTEM = """\
{haruka_base}

あなたは今、隣にいるリリィと二人でおしゃべりしています。
峰生に話しかけるのではなく、リリィに話しかけてください。
峰生はそばで二人の会話を聞いています。

応答は80〜120文字程度に収めてください。
リリィの発言に対するツッコミ、補足、脱線、同意などを返してください。
ハイテンションで場を盛り上げてください。
毎回相手の名前を呼ばないこと。実際の会話のように、名前は時々だけ使うこと。

以下のJSON形式で回答してください。他の文章は不要です。
{{"text": "葉留佳のセリフ", "pose_hint": "excited"}}
"""


class AutoConversation:
    """タイマー駆動の自動雑談（〜10ターン掛け合い + ユーザー割り込み対応）"""

    def __init__(self, config: AppConfig, session_mgr: SessionManager):
        self._config = config
        self._session_mgr = session_mgr
        self._seed_mgr = TalkSeedManager(
            openai_api_key=config.openai.api_key,
            screen_analysis_model=config.openai.screen_analysis_model,
            annict_access_token=config.annict.access_token,
        )
        self._timer = QTimer()
        self._timer.setSingleShot(False)
        self._timer.timeout.connect(self._on_timer)
        self._is_talking = False
        self._interrupted = False  # ユーザー割り込みフラグ

    def start(self) -> None:
        interval_ms = self._config.chat.auto_talk_interval_minutes * 60 * 1000
        self._timer.start(interval_ms)
        logger.info(
            "自動雑談タイマー開始: %d 分間隔",
            self._config.chat.auto_talk_interval_minutes,
        )

    def stop(self) -> None:
        self._timer.stop()
        self._interrupted = True
        logger.info("自動雑談タイマー停止")

    def trigger_now(self) -> None:
        """手動で雑談を即時発火する（デバッグ用）"""
        if self._is_talking:
            logger.info("雑談中のためスキップ")
            return
        asyncio.ensure_future(self._run_conversation())

    def interrupt(self) -> None:
        """ユーザーが会話に参加したため、掛け合いを中断する"""
        if self._is_talking:
            self._interrupted = True
            logger.info("ユーザー割り込みにより掛け合い中断")

    @property
    def is_talking(self) -> bool:
        return self._is_talking

    def _on_timer(self) -> None:
        if self._is_talking:
            logger.info("雑談中のためタイマースキップ")
            return
        asyncio.ensure_future(self._run_conversation())

    async def _run_conversation(self) -> None:
        """掛け合い雑談を実行する（〜10ターン）"""
        self._is_talking = True
        self._interrupted = False
        try:
            # 1. 種を収集・選択
            seeds = await self._seed_mgr.collect_seeds()
            seed = self._seed_mgr.select_best_seed(seeds)

            if seed is None:
                logger.info("雑談の種が見つからなかったためスキップ")
                return

            logger.info("雑談の種を選択: source=%s summary=%s", seed.source, seed.summary)

            # 会話履歴（掛け合い内）
            conv_history: list[dict[str, str]] = []

            # ターン数を決定
            num_turns = random.randint(_MIN_TURNS, _MAX_TURNS)
            logger.info("掛け合いターン数: %d", num_turns)

            for turn in range(num_turns):
                if self._interrupted:
                    logger.info("ユーザー割り込みのため掛け合い終了 (turn %d/%d)", turn, num_turns)
                    break

                is_last_turn = turn == num_turns - 1

                # --- リリィの発話 ---
                lily_text, lily_pose = await self._generate_lily(
                    seed, conv_history, is_last_turn
                )
                if not lily_text or self._interrupted:
                    break

                bus.ai_response_ready.emit("リリィ", lily_text, lily_pose)
                await self._session_mgr.save_message(
                    "assistant", f"[雑談:リリィ] {lily_text}"
                )
                conv_history.append({"speaker": "リリィ", "text": lily_text})

                await asyncio.sleep(_TURN_DELAY)
                if self._interrupted:
                    break

                # --- 葉留佳の反応 ---
                haruka_text, haruka_pose = await self._generate_haruka(
                    seed, conv_history
                )
                if not haruka_text or self._interrupted:
                    break

                bus.ai_response_ready.emit("葉留佳", haruka_text, haruka_pose)
                await self._session_mgr.save_message(
                    "assistant", f"[雑談:葉留佳] {haruka_text}"
                )
                conv_history.append({"speaker": "葉留佳", "text": haruka_text})

                # 最後のターン以外は間をおく
                if not is_last_turn:
                    await asyncio.sleep(_TURN_DELAY)

            # 種を使用済みに
            self._seed_mgr.mark_used(seed)

        except Exception:
            logger.exception("自動雑談の実行に失敗")
        finally:
            self._is_talking = False
            self._interrupted = False

    async def _generate_lily(
        self,
        seed: TalkSeed,
        conv_history: list[dict[str, str]],
        is_last_turn: bool,
    ) -> tuple[str, str]:
        """リリィの雑談発話を生成する"""
        context_parts = [
            f"【雑談の種】",
            f"- 話題: {seed.summary}",
            f"- タグ: {', '.join(seed.tags)}",
            f"- 出典: {seed.source}",
            f"- あなたの切り口: {seed.lily_perspective}",
        ]

        if conv_history:
            context_parts.append("")
            context_parts.append("【これまでの掛け合い】")
            for entry in conv_history[-6:]:  # 直近6発言
                context_parts.append(f"{entry['speaker']}: 「{entry['text']}」")
            context_parts.append("")
            context_parts.append("上の掛け合いの流れを踏まえて、自然に会話を続けてください。")

        if is_last_turn:
            context_parts.append("")
            context_parts.append("これが最後のターンです。峰生に「ね、峰生はどう思う？」のように軽く振って、会話に入りやすくしてください。")

        system = _LILY_SYSTEM.format(context="\n".join(context_parts))

        try:
            result = await send_chat_message(
                api_key=self._config.openai.api_key,
                model=self._config.openai.chat_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": "雑談を続けてください。"},
                ],
            )
            if isinstance(result, TextResult):
                return _parse_talk_response(result.content)
        except Exception:
            logger.exception("リリィの雑談生成に失敗")

        return "", "default"

    async def _generate_haruka(
        self,
        seed: TalkSeed,
        conv_history: list[dict[str, str]],
    ) -> tuple[str, str]:
        """葉留佳の雑談反応を生成する"""
        haruka_base = build_haruka_system_prompt()

        history_text = ""
        if conv_history:
            recent = conv_history[-6:]
            history_text = "\n".join(
                f"{e['speaker']}: 「{e['text']}」" for e in recent
            )

        system = _HARUKA_SYSTEM.format(haruka_base=haruka_base)
        user_msg = (
            f"【これまでの掛け合い】\n{history_text}\n\n"
            f"【雑談の種】\n- 話題: {seed.summary}\n- あなたの切り口: {seed.haruka_perspective}\n\n"
            f"上の流れを踏まえて、自然に反応してください。"
        )

        try:
            result = await send_chat_message(
                api_key=self._config.openai.api_key,
                model=self._config.openai.chat_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_msg},
                ],
            )
            if isinstance(result, TextResult):
                return _parse_talk_response(result.content)
        except Exception:
            logger.exception("葉留佳の雑談生成に失敗")

        return "", "default"


def _parse_talk_response(raw: str) -> tuple[str, str]:
    """AIの雑談レスポンスをパースして (text, pose_hint) を返す"""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        data = json.loads(cleaned)
        text = data.get("text", "")
        pose_hint = data.get("pose_hint", "default")
        return text, pose_hint
    except json.JSONDecodeError:
        logger.warning("雑談レスポンスのJSONパース失敗: %s", raw[:100])
        return raw.strip()[:200], "default"
