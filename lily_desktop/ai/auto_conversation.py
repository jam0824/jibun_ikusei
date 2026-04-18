"""自動雑談エンジン — タイマー駆動でリリィと葉留佳の掛け合いを発火する"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from dataclasses import dataclass

from PySide6.QtCore import QTimer

from ai.openai_client import TextResult, send_chat_message
from ai.system_prompts import build_haruka_system_prompt
from ai.talk_seed import TalkSeed, TalkSeedManager
from core.config import AppConfig
from core.domain_events import ChatAutoTalkDue, ChatFollowUpRequested, DomainEventHub
from core.event_bus import bus
from core.situation_capture import SituationCaptureCoordinator
from data.session_manager import SessionManager

logger = logging.getLogger(__name__)

# UI体験に関わる固定値（config化しない）
_TURN_DELAY = 4.0       # ターン間の待ち秒数
_FOLLOW_UP_DELAY = 3.0  # リリィ応答後、はるかが反応するまでの秒数

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
{{"text": "リリィのセリフ", "pose_category": "カテゴリ名"}}

pose_categoryには以下のいずれかを指定してください:
default(通常), joy(喜び), anger(怒り), sad(哀しみ), fun(楽しい),
shy(照れ), worried(悩み), surprised(驚き),
proud(得意), caring(気遣い), serious(真剣), sleepy(眠い), playful(いたずら)
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
{{"text": "葉留佳のセリフ", "pose_category": "カテゴリ名"}}

pose_categoryには以下のいずれかを指定してください:
default(通常), joy(喜び), anger(怒り), sad(哀しみ), fun(楽しい),
shy(照れ), worried(悩み), surprised(驚き)
"""

# フォローアップ用プロンプト（ユーザー応答後の掛け合い）
_FOLLOW_UP_HARUKA_FIRST = """\
{haruka_base}

リリィが峰生から話しかけられ、こう返答しました。
峰生の発言:「{user_text}」
リリィの返答:「{lily_text}」

はるかとして、この会話を横で見ていて思わず口を挟んでください。
リリィに話しかける形で、ツッコミや感想、脱線などを自然に返してください。
応答は80〜120文字程度。
毎回相手の名前を呼ばないこと。

以下のJSON形式で回答してください。他の文章は不要です。
{{"text": "葉留佳のセリフ", "pose_category": "カテゴリ名"}}

pose_categoryには以下のいずれかを指定してください:
default(通常), joy(喜び), anger(怒り), sad(哀しみ), fun(楽しい),
shy(照れ), worried(悩み), surprised(驚き)
"""

@dataclass
class _PrefetchResult:
    """プリフェッチ済みのセリフ + 音声データ"""
    text: str
    pose_category: str
    audio_bytes: bytes | None
    audio_format: str  # "wav" or "pcm"


_FOLLOW_UP_LILY = """\
あなたの名前はリリィです。デスクトップマスコットとして峰生のパソコンの画面に立っています。
相方の三枝葉留佳（はるちん）が隣にいます。
日本語で会話してください。
アニメのヒロインのようなフレンドリーなタメ口で話してください。

峰生から話しかけられて返答した直後、はるかに話しかけられました。
はるかに話しかける形で会話を続けてください。峰生はそばで聞いています。
応答は80〜150文字程度。毎回相手の名前を呼ばないこと。

{conv_context}

以下のJSON形式で回答してください。他の文章は不要です。
{{"text": "リリィのセリフ", "pose_category": "カテゴリ名"}}

pose_categoryには以下のいずれかを指定してください:
default(通常), joy(喜び), anger(怒り), sad(哀しみ), fun(楽しい),
shy(照れ), worried(悩み), surprised(驚き),
proud(得意), caring(気遣い), serious(真剣), sleepy(眠い), playful(いたずら)
"""


class AutoConversation:
    """タイマー駆動の自動雑談（〜10ターン掛け合い + ユーザー割り込み対応）"""

    def __init__(
        self,
        config: AppConfig,
        session_mgr: SessionManager,
        api_client=None,
        situation_capture_coordinator: SituationCaptureCoordinator | None = None,
        activity_capture_service=None,
        event_hub: DomainEventHub | None = None,
    ):
        self._config = config
        self._session_mgr = session_mgr
        self._event_hub = event_hub
        rakuten_cfg = getattr(config, "rakuten", None)
        desktop_cfg = getattr(config, "desktop", None)
        self._seed_mgr = TalkSeedManager(
            openai_api_key=config.openai.api_key,
            screen_analysis_model=getattr(
                desktop_cfg,
                "analysis_model",
                config.openai.screen_analysis_model,
            ),
            desktop_analysis_provider=getattr(
                desktop_cfg,
                "analysis_provider",
                "openai",
            ),
            desktop_analysis_base_url=getattr(
                desktop_cfg,
                "analysis_base_url",
                "",
            ),
            annict_access_token=config.annict.access_token,
            camera_enabled=config.camera.enabled,
            camera_analysis_provider=getattr(config.camera, "analysis_provider", "openai"),
            camera_analysis_base_url=getattr(config.camera, "analysis_base_url", ""),
            camera_analysis_model=config.camera.analysis_model,
            interest_topics=config.talk_seeds.interest_topics,
            memory_directory=getattr(config.talk_seeds, "memory_directory", ""),
            rakuten_application_id=getattr(rakuten_cfg, "application_id", ""),
            rakuten_access_key=getattr(rakuten_cfg, "access_key", ""),
            rakuten_origin=getattr(rakuten_cfg, "origin", ""),
            api_client=api_client,
            situation_capture_coordinator=situation_capture_coordinator,
            activity_capture_service=activity_capture_service,
        )
        self._timer = QTimer()
        self._timer.setSingleShot(False)
        self._timer.timeout.connect(self._on_timer)
        self._is_talking = False
        self._interrupted = False  # ユーザー割り込みフラグ
        self._tts = None  # TTSEngine（optional）
        self._prefetch_task: asyncio.Task | None = None  # プリフェッチ用タスク

    def set_activity_capture_service(self, activity_capture_service) -> None:
        self._seed_mgr.set_activity_capture_service(activity_capture_service)

    def set_tts(self, tts_engine) -> None:
        """TTSEngine の参照を設定/解除する"""
        self._tts = tts_engine

    async def _wait_for_turn(self) -> None:
        """TTS 再生完了を待ってからターン間の間を置く"""
        if self._tts is not None:
            await self._tts.wait_until_idle()
        await asyncio.sleep(1.0)

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
            if self._prefetch_task and not self._prefetch_task.done():
                self._prefetch_task.cancel()
            logger.info("ユーザー割り込みにより掛け合い中断")

    def trigger_follow_up(
        self,
        user_text: str,
        lily_text: str,
    ) -> tuple[asyncio.Task[None], ...]:
        """リリィがユーザーに返答した後、はるかを交えた掛け合いを開始する"""
        if self._is_talking:
            logger.info("掛け合い中のためフォローアップをスキップ")
            return ()
        return (asyncio.ensure_future(self._run_follow_up(user_text, lily_text)),)

    @property
    def is_talking(self) -> bool:
        return self._is_talking

    def _on_timer(self) -> None:
        if self._is_talking:
            logger.info("雑談中のためタイマースキップ")
            return
        asyncio.ensure_future(self._run_conversation())

    async def _run_conversation(self, forced_source: str | None = None) -> None:
        """掛け合い雑談を実行する（〜10ターン）"""
        self._is_talking = True
        self._interrupted = False
        try:
            # 1. カテゴリを抽選し、必要な種だけ取得して選択
            seed = await self._seed_mgr.collect_seed(forced_source=forced_source)

            if seed is None:
                if forced_source:
                    logger.info(
                        "指定カテゴリの雑談の種が見つからなかったためスキップ: source=%s",
                        forced_source,
                    )
                    return
                logger.info("雑談の種が見つからなかったためスキップ")
                return

            logger.info("雑談の種を選択: source=%s summary=%s", seed.source, seed.summary)

            # 会話履歴（掛け合い内）
            conv_history: list[dict[str, str]] = []

            # ターン数を決定
            cfg = self._config.chat
            num_turns = random.randint(cfg.auto_talk_min_turns, cfg.auto_talk_max_turns)
            logger.info("掛け合いターン数: %d", num_turns)

            prefetch: _PrefetchResult | None = None

            for turn in range(num_turns):
                if self._interrupted:
                    logger.info("ユーザー割り込みのため掛け合い終了 (turn %d/%d)", turn, num_turns)
                    break

                is_last_turn = turn == num_turns - 1

                # --- リリィの発話 ---
                if prefetch is not None:
                    lily_text, lily_pose = prefetch.text, prefetch.pose_category
                    lily_audio, lily_fmt = prefetch.audio_bytes, prefetch.audio_format
                    prefetch = None
                else:
                    lily_text, lily_pose = await self._generate_lily(
                        seed, conv_history, is_last_turn
                    )
                    lily_audio, lily_fmt = None, "wav"

                if not lily_text or self._interrupted:
                    break

                self._emit_and_enqueue("リリィ", lily_text, lily_pose, lily_audio, lily_fmt)
                await self._session_mgr.save_message(
                    "assistant", f"[雑談:リリィ] {lily_text}"
                )
                conv_history.append({"speaker": "リリィ", "text": lily_text})

                # TTS 再生中に葉留佳のセリフ + 音声を先行生成
                self._prefetch_task = asyncio.ensure_future(
                    self._prefetch_next("葉留佳", seed, conv_history)
                )
                await self._wait_for_turn()
                if self._interrupted:
                    self._prefetch_task.cancel()
                    break

                # プリフェッチ結果を回収（失敗時はフォールバック）
                haruka_pf = await self._prefetch_task
                self._prefetch_task = None

                if haruka_pf and haruka_pf.text:
                    haruka_text, haruka_pose = haruka_pf.text, haruka_pf.pose_category
                    haruka_audio, haruka_fmt = haruka_pf.audio_bytes, haruka_pf.audio_format
                else:
                    haruka_text, haruka_pose = await self._generate_haruka(
                        seed, conv_history
                    )
                    haruka_audio, haruka_fmt = None, "wav"

                if not haruka_text or self._interrupted:
                    break

                self._emit_and_enqueue("葉留佳", haruka_text, haruka_pose, haruka_audio, haruka_fmt)
                await self._session_mgr.save_message(
                    "assistant", f"[雑談:葉留佳] {haruka_text}"
                )
                conv_history.append({"speaker": "葉留佳", "text": haruka_text})

                # 最後のターン以外: TTS 再生中にリリィの次のセリフを先行生成
                if not is_last_turn:
                    next_is_last = (turn + 1) == num_turns - 1
                    self._prefetch_task = asyncio.ensure_future(
                        self._prefetch_next(
                            "リリィ", seed, conv_history, is_last_turn=next_is_last
                        )
                    )
                    await self._wait_for_turn()
                    if self._interrupted:
                        self._prefetch_task.cancel()
                        break
                    prefetch = await self._prefetch_task
                    self._prefetch_task = None

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

        if not conv_history and seed.source in ("wikimedia", "wikimedia_interest", "annict", "books", "memory"):
            context_parts.append("")
            if seed.source == "memory":
                context_parts.append(
                    "【最初の一言について】"
                    "これはリリィ自身の思い出として話してください。"
                    "思い出話でも、セリフの冒頭で何の思い出かが伝わるひと言から始めてください。"
                    "セリフの冒頭から、思い出して少し懐かしむように自然に入り、"
                    "「ファイルには」「文章には」のようなメタ説明はしないこと。"
                    "本文を長くそのまま引用せず、思い出している人の話し方でやわらかく要約してください。"
                )
            else:
                context_parts.append(
                    "【最初の一言について】"
                    "これが話題の切り出しです。"
                    "セリフの冒頭で「～の話だけど」「～って知ってる？」のように、"
                    "何の話かが伝わるひと言から始めてください。"
                )

        if seed.source == "camera":
            context_parts.append("")
            context_parts.append("【カメラ話題の話し方】")
            context_parts.append(
                "この話題はカメラ由来でも、「カメラに映ってる」「画像で見ると」などのメタな言い方はしないこと。"
                "二人がその場の外や周囲を一緒に見ているように自然に話してください。"
            )

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
        user_parts = [
            "【これまでの掛け合い】",
            history_text,
            "",
            "【雑談の種】",
            f"- 話題: {seed.summary}",
            f"- あなたの切り口: {seed.haruka_perspective}",
        ]
        if seed.source == "camera":
            user_parts.extend(
                [
                    "",
                    "【カメラ話題の話し方】",
                    "この話題はカメラ由来でも、「映ってる」「カメラ越しに」などのメタな言い方は避け、"
                    "二人が今その場を見ているように自然に反応してください。",
                ]
            )
        user_parts.extend(
            [
                "",
                "上の流れを踏まえて、自然に反応してください。",
            ]
        )
        user_msg = "\n".join(user_parts)

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


    async def _run_follow_up(self, user_text: str, lily_text: str) -> None:
        """ユーザー応答後のはるか割り込み → 掛け合い継続を実行する"""
        self._is_talking = True
        self._interrupted = False
        try:
            conv_history: list[dict[str, str]] = [
                {"speaker": "峰生", "text": user_text},
                {"speaker": "リリィ", "text": lily_text},
            ]

            # --- はるかの初回反応（リリィの TTS 再生中に先行生成） ---
            self._prefetch_task = asyncio.ensure_future(
                self._prefetch_haruka_follow_up_first(user_text, lily_text)
            )
            await self._wait_for_turn()
            if self._interrupted:
                self._prefetch_task.cancel()
                return

            # プリフェッチ結果を回収
            haruka_pf = await self._prefetch_task
            self._prefetch_task = None

            if haruka_pf and haruka_pf.text:
                haruka_text, haruka_pose = haruka_pf.text, haruka_pf.pose_category
                haruka_audio, haruka_fmt = haruka_pf.audio_bytes, haruka_pf.audio_format
            else:
                haruka_text, haruka_pose = await self._generate_haruka_follow_up_first(
                    user_text, lily_text
                )
                haruka_audio, haruka_fmt = None, "wav"

            if not haruka_text or self._interrupted:
                return

            self._emit_and_enqueue("葉留佳", haruka_text, haruka_pose, haruka_audio, haruka_fmt)
            await self._session_mgr.save_message("assistant", f"[掛け合い:葉留佳] {haruka_text}")
            conv_history.append({"speaker": "葉留佳", "text": haruka_text})

            # --- 追加ターン（リリィ → はるか を繰り返す）---
            cfg = self._config.chat
            extra_turns = random.randint(cfg.follow_up_min_extra, cfg.follow_up_max_extra)
            logger.info("フォローアップ追加ターン数: %d", extra_turns)

            prefetch: _PrefetchResult | None = None

            for turn in range(extra_turns):
                if self._interrupted:
                    break

                # TTS 再生中にリリィのセリフを先行生成
                self._prefetch_task = asyncio.ensure_future(
                    self._prefetch_follow_up_next("リリィ", conv_history)
                )
                await self._wait_for_turn()
                if self._interrupted:
                    self._prefetch_task.cancel()
                    break

                # プリフェッチ結果を回収
                prefetch = await self._prefetch_task
                self._prefetch_task = None

                # リリィの返し
                if prefetch and prefetch.text:
                    lily_follow, lily_pose_val = prefetch.text, prefetch.pose_category
                    lily_audio, lily_fmt = prefetch.audio_bytes, prefetch.audio_format
                else:
                    lily_follow, lily_pose_val = await self._generate_lily_follow_up(conv_history)
                    lily_audio, lily_fmt = None, "wav"

                if not lily_follow or self._interrupted:
                    break

                self._emit_and_enqueue("リリィ", lily_follow, lily_pose_val, lily_audio, lily_fmt)
                await self._session_mgr.save_message("assistant", f"[掛け合い:リリィ] {lily_follow}")
                conv_history.append({"speaker": "リリィ", "text": lily_follow})

                # TTS 再生中にはるかのセリフを先行生成
                self._prefetch_task = asyncio.ensure_future(
                    self._prefetch_follow_up_next("葉留佳", conv_history)
                )
                await self._wait_for_turn()
                if self._interrupted:
                    self._prefetch_task.cancel()
                    break

                # プリフェッチ結果を回収
                prefetch = await self._prefetch_task
                self._prefetch_task = None

                # はるかの返し
                if prefetch and prefetch.text:
                    haruka_follow, haruka_pose2 = prefetch.text, prefetch.pose_category
                    haruka_audio, haruka_fmt = prefetch.audio_bytes, prefetch.audio_format
                else:
                    haruka_follow, haruka_pose2 = await self._generate_haruka(
                        _make_dummy_seed(conv_history), conv_history
                    )
                    haruka_audio, haruka_fmt = None, "wav"

                if not haruka_follow or self._interrupted:
                    break

                self._emit_and_enqueue("葉留佳", haruka_follow, haruka_pose2, haruka_audio, haruka_fmt)
                await self._session_mgr.save_message("assistant", f"[掛け合い:葉留佳] {haruka_follow}")
                conv_history.append({"speaker": "葉留佳", "text": haruka_follow})

        except Exception:
            logger.exception("フォローアップ掛け合いの実行に失敗")
        finally:
            self._is_talking = False
            self._interrupted = False

    async def _generate_haruka_follow_up_first(
        self, user_text: str, lily_text: str
    ) -> tuple[str, str]:
        """はるかの初回フォローアップ反応を生成する"""
        haruka_base = build_haruka_system_prompt()
        system = _FOLLOW_UP_HARUKA_FIRST.format(
            haruka_base=haruka_base,
            user_text=user_text,
            lily_text=lily_text,
        )
        try:
            result = await send_chat_message(
                api_key=self._config.openai.api_key,
                model=self._config.openai.chat_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": "反応してください。"},
                ],
            )
            if isinstance(result, TextResult):
                return _parse_talk_response(result.content)
        except Exception:
            logger.exception("はるかのフォローアップ初回生成に失敗")
        return "", "default"

    async def _generate_lily_follow_up(
        self, conv_history: list[dict[str, str]]
    ) -> tuple[str, str]:
        """フォローアップ中のリリィ発話を生成する"""
        recent = conv_history[-6:]
        conv_lines = "\n".join(f"{e['speaker']}: 「{e['text']}」" for e in recent)
        conv_context = f"【これまでの流れ】\n{conv_lines}\n\n上の流れを受けて自然に返してください。"

        system = _FOLLOW_UP_LILY.format(conv_context=conv_context)
        try:
            result = await send_chat_message(
                api_key=self._config.openai.api_key,
                model=self._config.openai.chat_model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": "続けてください。"},
                ],
            )
            if isinstance(result, TextResult):
                return _parse_talk_response(result.content)
        except Exception:
            logger.exception("リリィのフォローアップ発話生成に失敗")
        return "", "default"


    # ---- プリフェッチ（パイプライン化） ----

    async def _prefetch_next(
        self,
        speaker: str,
        seed: TalkSeed,
        conv_history: list[dict[str, str]],
        is_last_turn: bool = False,
    ) -> _PrefetchResult | None:
        """次の話者のセリフ生成 + 音声合成を先行実行する。"""
        try:
            if speaker == "葉留佳":
                text, pose = await self._generate_haruka(seed, conv_history)
            else:
                text, pose = await self._generate_lily(
                    seed, conv_history, is_last_turn
                )

            if not text:
                return None

            # 音声合成（TTS が有効な場合のみ）
            audio_bytes = None
            audio_format = "wav"
            if self._tts is not None:
                result = await self._tts.synthesize(speaker, text)
                if result:
                    audio_bytes, audio_format = result

            return _PrefetchResult(
                text=text,
                pose_category=pose,
                audio_bytes=audio_bytes,
                audio_format=audio_format,
            )
        except asyncio.CancelledError:
            logger.debug("プリフェッチがキャンセルされました: %s", speaker)
            return None
        except Exception:
            logger.exception("プリフェッチに失敗: %s", speaker)
            return None

    async def _prefetch_haruka_follow_up_first(
        self, user_text: str, lily_text: str
    ) -> _PrefetchResult | None:
        """はるかの初回フォローアップ反応を先行生成する（リリィの TTS 再生中に実行）。"""
        try:
            text, pose = await self._generate_haruka_follow_up_first(
                user_text, lily_text
            )
            if not text:
                return None

            audio_bytes = None
            audio_format = "wav"
            if self._tts is not None:
                result = await self._tts.synthesize("葉留佳", text)
                if result:
                    audio_bytes, audio_format = result

            return _PrefetchResult(
                text=text,
                pose_category=pose,
                audio_bytes=audio_bytes,
                audio_format=audio_format,
            )
        except asyncio.CancelledError:
            logger.debug("はるか初回フォローアッププリフェッチがキャンセルされました")
            return None
        except Exception:
            logger.exception("はるか初回フォローアッププリフェッチに失敗")
            return None

    async def _prefetch_follow_up_next(
        self,
        speaker: str,
        conv_history: list[dict[str, str]],
    ) -> _PrefetchResult | None:
        """フォローアップ掛け合いの次の話者を先行生成する。"""
        try:
            if speaker == "葉留佳":
                text, pose = await self._generate_haruka(
                    _make_dummy_seed(conv_history), conv_history
                )
            else:
                text, pose = await self._generate_lily_follow_up(conv_history)

            if not text:
                return None

            audio_bytes = None
            audio_format = "wav"
            if self._tts is not None:
                result = await self._tts.synthesize(speaker, text)
                if result:
                    audio_bytes, audio_format = result

            return _PrefetchResult(
                text=text,
                pose_category=pose,
                audio_bytes=audio_bytes,
                audio_format=audio_format,
            )
        except asyncio.CancelledError:
            logger.debug("フォローアッププリフェッチがキャンセルされました: %s", speaker)
            return None
        except Exception:
            logger.exception("フォローアッププリフェッチに失敗: %s", speaker)
            return None

    def _emit_and_enqueue(
        self, speaker: str, text: str, pose: str,
        audio_bytes: bytes | None = None, audio_format: str = "wav",
    ) -> None:
        """UI更新シグナル発火 + TTS enqueue を一括で行う。"""
        bus.ai_response_ready_no_tts.emit(speaker, text, pose)
        if self._tts is not None:
            if audio_bytes:
                self._tts.enqueue_audio(speaker, audio_bytes, audio_format)
            else:
                self._tts.enqueue(speaker, text)


def _make_dummy_seed(conv_history: list[dict[str, str]]):
    """掛け合い継続用のダミーシードを作成する（_generate_haruka の引数に使用）"""
    from ai.talk_seed import TalkSeed
    recent_text = " / ".join(e["text"] for e in conv_history[-3:])
    return TalkSeed(
        summary=recent_text[:80],
        tags=[],
        source="follow_up",
        lily_perspective="",
        haruka_perspective="リリィとの会話の流れを受けて、自然に返してください。",
        freshness="fresh",
        created_at="",
    )


def _parse_talk_response(raw: str) -> tuple[str, str]:
    """AIの雑談レスポンスをパースして (text, pose_category) を返す"""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        cleaned = "\n".join(lines)

    try:
        data = json.loads(cleaned)
        text = data.get("text", "")
        pose_category = data.get("pose_category", "default")
        return text, pose_category
    except json.JSONDecodeError:
        logger.warning("雑談レスポンスのJSONパース失敗: %s", raw[:100])
        return raw.strip()[:200], "default"


def _evented_trigger_now(self: AutoConversation) -> None:
    if self._event_hub is not None:
        self._event_hub.publish(
            ChatAutoTalkDue(source="auto_conversation.manual")
        )
        return
    if self._is_talking:
        logger.info("雑談中のためスキップ")
        return
    asyncio.ensure_future(self._run_conversation())


def _evented_trigger_books_now(self: AutoConversation) -> None:
    if self._event_hub is not None:
        self._event_hub.publish(
            ChatAutoTalkDue(
                source="auto_conversation.manual_books",
                forced_source="books",
            )
        )
        return
    if self._is_talking:
        logger.info("雑談中のため本雑談をスキップ")
        return
    asyncio.ensure_future(self._run_conversation(forced_source="books"))


def _evented_trigger_memory_now(self: AutoConversation) -> None:
    if self._event_hub is not None:
        self._event_hub.publish(
            ChatAutoTalkDue(
                source="auto_conversation.manual_memory",
                forced_source="memory",
            )
        )
        return
    if self._is_talking:
        logger.info("雑談中のため思い出雑談をスキップ")
        return
    asyncio.ensure_future(self._run_conversation(forced_source="memory"))


def _evented_trigger_quest_weekly_now(self: AutoConversation) -> None:
    if self._event_hub is not None:
        self._event_hub.publish(
            ChatAutoTalkDue(
                source="auto_conversation.manual_quest_weekly",
                forced_source="quest_weekly",
            )
        )
        return
    if self._is_talking:
        logger.info("雑談中のため週次クエスト雑談をスキップ")
        return
    asyncio.ensure_future(self._run_conversation(forced_source="quest_weekly"))


def _evented_trigger_quest_today_now(self: AutoConversation) -> None:
    if self._event_hub is not None:
        self._event_hub.publish(
            ChatAutoTalkDue(
                source="auto_conversation.manual_quest_today",
                forced_source="quest_today",
            )
        )
        return
    if self._is_talking:
        logger.info("雑談中のため今日のクエスト雑談をスキップ")
        return
    asyncio.ensure_future(self._run_conversation(forced_source="quest_today"))


def _evented_trigger_follow_up(
    self: AutoConversation,
    user_text: str,
    lily_text: str,
) -> tuple[asyncio.Task[None], ...]:
    if self._event_hub is not None:
        return self._event_hub.publish(
            ChatFollowUpRequested(
                source="auto_conversation.follow_up",
                user_text=user_text,
                lily_text=lily_text,
            )
        )
    if self._is_talking:
        logger.info("掛け合い中のためフォローアップをスキップ")
        return ()
    return (asyncio.ensure_future(self._run_follow_up(user_text, lily_text)),)


def _evented_on_timer(self: AutoConversation) -> None:
    if self._event_hub is not None:
        self._event_hub.publish(
            ChatAutoTalkDue(source="auto_conversation.timer")
        )
        return
    if self._is_talking:
        logger.info("雑談中のためタイマースキップ")
        return
    asyncio.ensure_future(self._run_conversation())


async def _run_auto_talk_job(
    self: AutoConversation,
    forced_source: str | None = None,
) -> None:
    await self._run_conversation(forced_source=forced_source)


async def _run_follow_up_job(
    self: AutoConversation,
    user_text: str,
    lily_text: str,
) -> None:
    await self._run_follow_up(user_text, lily_text)


AutoConversation.trigger_now = _evented_trigger_now
AutoConversation.trigger_books_now = _evented_trigger_books_now
AutoConversation.trigger_memory_now = _evented_trigger_memory_now
AutoConversation.trigger_quest_weekly_now = _evented_trigger_quest_weekly_now
AutoConversation.trigger_quest_today_now = _evented_trigger_quest_today_now
AutoConversation.trigger_follow_up = _evented_trigger_follow_up
AutoConversation._on_timer = _evented_on_timer
AutoConversation.run_auto_talk_job = _run_auto_talk_job
AutoConversation.run_follow_up_job = _run_follow_up_job
