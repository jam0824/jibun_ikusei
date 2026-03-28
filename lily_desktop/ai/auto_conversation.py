"""自動雑談エンジン — タイマー駆動でリリィと葉留佳の掛け合いを発火する"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from PySide6.QtCore import QTimer

from ai.openai_client import TextResult, send_chat_message
from ai.system_prompts import build_haruka_system_prompt
from ai.talk_seed import TalkSeed, TalkSeedManager
from core.config import AppConfig
from core.event_bus import bus
from data.session_manager import SessionManager

logger = logging.getLogger(__name__)

_TALK_PROMPT_TEMPLATE = """\
あなたの名前はリリィです。デスクトップマスコットとして峰生のパソコンの画面に立っています。
相方の三枝葉留佳（はるちん）が隣にいます。
ユーザーの名前は峰生（みねお）です。
日本語で会話してください。
アニメのヒロインのようなフレンドリーなタメ口で話してください。
「です・ます」調は使わず、「〜だよ」「〜だね」のような親しみのある口調で話してください。

あなたは今、雑談として峰生に話しかけようとしています。
以下の「雑談の種」をもとに、自然な形で話しかけてください。

【雑談の種】
- 話題: {summary}
- タグ: {tags}
- 出典: {source}
- あなたの切り口: {lily_perspective}

【重要なルール】
- 画面上の文章やコードをそのまま引用しないこと
- 「集中してるね」「今日は調べものモードだね」のように柔らかく要約して話すこと
- 応答は80〜150文字程度に収めること
- 最後に峰生が会話に入りやすいよう、軽い問いかけを入れること

以下のJSON形式で回答してください。他の文章は不要です。
{{"text": "リリィのセリフ", "pose_hint": "happy"}}
"""

_HARUKA_TALK_PROMPT_TEMPLATE = """\
{haruka_base_prompt}

リリィが以下のように話しかけました。これに対して反応してください。

リリィの発言: 「{lily_text}」

【雑談の種】
- 話題: {summary}
- あなたの切り口: {haruka_perspective}

【重要なルール】
- リリィの発言に対するツッコミ、補足、脱線、同意などを返すこと
- ハイテンションで場を盛り上げること
- 応答は80〜120文字程度に収めること

以下のJSON形式で回答してください。他の文章は不要です。
{{"text": "葉留佳のセリフ", "pose_hint": "excited"}}
"""


class AutoConversation:
    """タイマー駆動の自動雑談"""

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
        self._is_talking = False  # 雑談中フラグ

    def start(self) -> None:
        """自動雑談タイマーを開始"""
        interval_ms = self._config.chat.auto_talk_interval_minutes * 60 * 1000
        self._timer.start(interval_ms)
        logger.info(
            "自動雑談タイマー開始: %d 分間隔",
            self._config.chat.auto_talk_interval_minutes,
        )

    def stop(self) -> None:
        """自動雑談タイマーを停止"""
        self._timer.stop()
        logger.info("自動雑談タイマー停止")

    def trigger_now(self) -> None:
        """手動で雑談を即時発火する（デバッグ用）"""
        if self._is_talking:
            logger.info("雑談中のためスキップ")
            return
        asyncio.ensure_future(self._run_conversation())

    def _on_timer(self) -> None:
        if self._is_talking:
            logger.info("雑談中のためタイマースキップ")
            return
        asyncio.ensure_future(self._run_conversation())

    async def _run_conversation(self) -> None:
        """雑談を実行する"""
        self._is_talking = True
        try:
            # 1. 種を収集・選択
            seeds = await self._seed_mgr.collect_seeds()
            seed = self._seed_mgr.select_best_seed(seeds)

            if seed is None:
                logger.info("雑談の種が見つからなかったためスキップ")
                return

            logger.info("雑談の種を選択: source=%s summary=%s", seed.source, seed.summary)

            # 2. リリィの発話を生成
            lily_text, lily_pose = await self._generate_lily_talk(seed)
            if not lily_text:
                return

            bus.ai_response_ready.emit("リリィ", lily_text, lily_pose)
            await self._session_mgr.save_message("assistant", f"[雑談:リリィ] {lily_text}")

            # 少し間をおいて葉留佳の反応
            await asyncio.sleep(3)

            # 3. 葉留佳の反応を生成
            haruka_text, haruka_pose = await self._generate_haruka_talk(seed, lily_text)
            if haruka_text:
                bus.ai_response_ready.emit("葉留佳", haruka_text, haruka_pose)
                await self._session_mgr.save_message(
                    "assistant", f"[雑談:葉留佳] {haruka_text}"
                )

            # 4. 種を使用済みに
            self._seed_mgr.mark_used(seed)

        except Exception:
            logger.exception("自動雑談の実行に失敗")
        finally:
            self._is_talking = False

    async def _generate_lily_talk(self, seed: TalkSeed) -> tuple[str, str]:
        """リリィの雑談発話を生成する"""
        prompt = _TALK_PROMPT_TEMPLATE.format(
            summary=seed.summary,
            tags=", ".join(seed.tags),
            source=seed.source,
            lily_perspective=seed.lily_perspective,
        )

        try:
            result = await send_chat_message(
                api_key=self._config.openai.api_key,
                model=self._config.openai.chat_model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": "雑談を始めてください。"},
                ],
            )
            if isinstance(result, TextResult):
                return _parse_talk_response(result.content)
        except Exception:
            logger.exception("リリィの雑談生成に失敗")

        return "", "default"

    async def _generate_haruka_talk(
        self, seed: TalkSeed, lily_text: str
    ) -> tuple[str, str]:
        """葉留佳の雑談反応を生成する"""
        haruka_base = build_haruka_system_prompt()
        prompt = _HARUKA_TALK_PROMPT_TEMPLATE.format(
            haruka_base_prompt=haruka_base,
            lily_text=lily_text,
            summary=seed.summary,
            haruka_perspective=seed.haruka_perspective,
        )

        try:
            result = await send_chat_message(
                api_key=self._config.openai.api_key,
                model=self._config.openai.chat_model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": "リリィの発言に反応してください。"},
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
    # コードブロック除去
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
        # JSONパース失敗時は生テキストをそのまま使う
        logger.warning("雑談レスポンスのJSONパース失敗: %s", raw[:100])
        return raw.strip()[:200], "default"
