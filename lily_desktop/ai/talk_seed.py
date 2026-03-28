"""雑談の種マネージャー — 3系統の話題を収集・優先度判定・クールダウン管理"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from ai.annict_client import AnnictWork, fetch_seasonal_works
from ai.screen_analyzer import ScreenAnalysis
from ai.wikimedia_client import WikimediaArticle, fetch_featured_content
from core.desktop_context import DesktopContext, fetch_desktop_context

logger = logging.getLogger(__name__)

JST = timezone(timedelta(hours=9))

_COOLDOWN_MINUTES = 30  # 同じ種を再利用するまでの待ち時間
_MAX_HISTORY = 10       # 使用履歴の保持件数


@dataclass
class TalkSeed:
    """雑談の種カード"""
    summary: str = ""
    tags: list[str] = field(default_factory=list)
    freshness: str = "fresh"   # fresh | stale
    source: str = ""           # desktop | wikimedia | annict
    lily_perspective: str = "" # リリィ側の切り口
    haruka_perspective: str = ""  # 相方側の切り口
    created_at: str = ""
    _source_key: str = ""      # クールダウン用のユニークキー


class TalkSeedManager:
    """雑談の種を収集・選択するマネージャー"""

    def __init__(
        self,
        *,
        openai_api_key: str,
        screen_analysis_model: str,
        annict_access_token: str = "",
    ):
        self._openai_api_key = openai_api_key
        self._screen_analysis_model = screen_analysis_model
        self._annict_access_token = annict_access_token
        self._used_history: list[tuple[str, datetime]] = []  # (source_key, used_at)

    async def collect_seeds(self) -> list[TalkSeed]:
        """3系統から雑談の種を並行収集する"""
        seeds: list[TalkSeed] = []

        # 並行で取得
        desktop_task = asyncio.create_task(self._collect_desktop())
        wiki_task = asyncio.create_task(self._collect_wikimedia())
        annict_task = asyncio.create_task(self._collect_annict())

        desktop_seeds = await desktop_task
        wiki_seeds = await wiki_task
        annict_seeds = await annict_task

        seeds.extend(desktop_seeds)
        seeds.extend(wiki_seeds)
        seeds.extend(annict_seeds)

        logger.info(
            "雑談の種: desktop=%d wiki=%d annict=%d 合計=%d",
            len(desktop_seeds), len(wiki_seeds), len(annict_seeds), len(seeds),
        )
        return seeds

    def select_best_seed(self, seeds: list[TalkSeed]) -> TalkSeed | None:
        """話題のバランスを考慮して種を選ぶ。

        デスクトップ状況 50% / その他（Wikimedia・Annict）50% の配分。
        クールダウン中の種は除外。
        """
        self._cleanup_cooldown()

        cooled_down_keys = {key for key, _ in self._used_history}

        # クールダウンチェック後の候補
        available = [s for s in seeds if s._source_key not in cooled_down_keys]
        if not available:
            # クールダウンを無視して全候補から選ぶ
            available = seeds

        if not available:
            return None

        desktop_seeds = [s for s in available if s.source == "desktop"]
        other_seeds = [s for s in available if s.source != "desktop"]

        # 両方ある場合は50%ずつ
        if desktop_seeds and other_seeds:
            if random.random() < 0.5:
                return desktop_seeds[0]
            return random.choice(other_seeds)

        # 片方しかない場合はそちらから選ぶ
        if desktop_seeds:
            return desktop_seeds[0]
        return random.choice(other_seeds)

    def mark_used(self, seed: TalkSeed) -> None:
        """種を使用済みとして記録する"""
        now = datetime.now(JST)
        self._used_history.append((seed._source_key, now))
        # 履歴が多すぎる場合は古いものを削除
        if len(self._used_history) > _MAX_HISTORY:
            self._used_history = self._used_history[-_MAX_HISTORY:]
        logger.info("雑談の種を使用済みに: %s (%s)", seed._source_key, seed.source)

    def _cleanup_cooldown(self) -> None:
        """期限切れのクールダウンを削除する"""
        cutoff = datetime.now(JST) - timedelta(minutes=_COOLDOWN_MINUTES)
        self._used_history = [
            (key, used_at) for key, used_at in self._used_history
            if used_at > cutoff
        ]

    async def _collect_desktop(self) -> list[TalkSeed]:
        """デスクトップ状況から種を生成"""
        try:
            ctx = await fetch_desktop_context(
                api_key=self._openai_api_key,
                model=self._screen_analysis_model,
            )
            if ctx.skipped or ctx.error or ctx.analysis is None:
                return []

            analysis = ctx.analysis
            # idle 状態は雑談向きでないのでスキップ
            if analysis.activity_type == "idle":
                return []

            now_str = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")
            return [TalkSeed(
                summary=analysis.summary,
                tags=analysis.tags,
                freshness="fresh",
                source="desktop",
                lily_perspective=_desktop_lily_perspective(analysis),
                haruka_perspective=_desktop_haruka_perspective(analysis),
                created_at=now_str,
                _source_key=f"desktop:{analysis.activity_type}",
            )]
        except Exception:
            logger.exception("デスクトップ状況の収集に失敗")
            return []

    async def _collect_wikimedia(self) -> list[TalkSeed]:
        """Wikimedia から種を生成"""
        try:
            articles = await fetch_featured_content()
            seeds: list[TalkSeed] = []
            now_str = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")

            for article in articles[:3]:  # 最大3件
                seeds.append(TalkSeed(
                    summary=article.extract[:100] if article.extract else article.title,
                    tags=[article.article_type, "豆知識"],
                    freshness="fresh",
                    source="wikimedia",
                    lily_perspective=f"「{article.title}」について豆知識として話を振る",
                    haruka_perspective=f"「{article.title}」に対してリアクションや脱線コメントを返す",
                    created_at=now_str,
                    _source_key=f"wiki:{article.title[:30]}",
                ))
            return seeds
        except Exception:
            logger.exception("Wikimedia の収集に失敗")
            return []

    async def _collect_annict(self) -> list[TalkSeed]:
        """Annict から種を生成"""
        if not self._annict_access_token:
            return []
        try:
            works = await fetch_seasonal_works(
                access_token=self._annict_access_token,
                per_page=5,
            )
            seeds: list[TalkSeed] = []
            now_str = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")

            for work in works[:3]:  # 最大3件
                seeds.append(TalkSeed(
                    summary=f"今期のアニメ「{work.title}」({work.watchers_count}人が視聴中)",
                    tags=["アニメ", work.media_type, work.season_name],
                    freshness="fresh",
                    source="annict",
                    lily_perspective=f"「{work.title}」について、見たことあるか聞いたり感想を共有する",
                    haruka_perspective=f"「{work.title}」についてテンション高くコメントする",
                    created_at=now_str,
                    _source_key=f"annict:{work.title[:30]}",
                ))
            return seeds
        except Exception:
            logger.exception("Annict の収集に失敗")
            return []


def _desktop_lily_perspective(analysis: ScreenAnalysis) -> str:
    """デスクトップ状況に基づくリリィの切り口"""
    perspectives = {
        "coding": "頑張ってコーディングしてるね、と声をかける",
        "reading": "何を読んでるの？と興味を示す",
        "browsing": "調べものしてるんだね、と話しかける",
        "watching": "何か面白いもの見てるの？とリラックスした声をかける",
        "gaming": "ゲーム楽しんでるね！と一緒に盛り上がる",
        "chatting": "お話し中だね、と軽く声をかける",
    }
    return perspectives.get(analysis.activity_type, "今の状況について柔らかく声をかける")


def _desktop_haruka_perspective(analysis: ScreenAnalysis) -> str:
    """デスクトップ状況に基づく葉留佳の切り口"""
    perspectives = {
        "coding": "おー、プログラミングやってるじゃん！とテンション高くツッコむ",
        "reading": "何々？はるちんにも教えてよー！と絡む",
        "browsing": "ネットサーフィンってやつだね！と盛り上がる",
        "watching": "何見てるのー？はるちんも気になる！と乗っかる",
        "gaming": "ゲームだー！はるちんもやりたい！と大はしゃぎ",
        "chatting": "誰と話してるの？気になるー！とちょっかいを出す",
    }
    return perspectives.get(analysis.activity_type, "リリィの話に乗っかってツッコミを入れる")
