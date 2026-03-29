"""雑談の種マネージャー — 3系統の話題を収集・優先度判定・クールダウン管理"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from ai.annict_client import AnnictWork, fetch_seasonal_works
from ai.camera_analyzer import CameraAnalysis, analyze_camera_frame
from ai.screen_analyzer import ScreenAnalysis
from ai.wikimedia_client import WikimediaArticle, fetch_featured_content
from core.camera import capture_camera_frame
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
        camera_enabled: bool = False,
        camera_analysis_model: str = "gpt-5",
        camera_device_index: int = 0,
    ):
        self._openai_api_key = openai_api_key
        self._screen_analysis_model = screen_analysis_model
        self._annict_access_token = annict_access_token
        self._camera_enabled = camera_enabled
        self._camera_analysis_model = camera_analysis_model
        self._camera_device_index = camera_device_index
        self._used_history: list[tuple[str, datetime]] = []  # (source_key, used_at)
        self._last_camera_analysis: CameraAnalysis | None = None

    async def collect_seeds(self) -> list[TalkSeed]:
        """4系統から雑談の種を並行収集する"""
        seeds: list[TalkSeed] = []

        # 並行で取得
        desktop_task = asyncio.create_task(self._collect_desktop())
        wiki_task = asyncio.create_task(self._collect_wikimedia())
        annict_task = asyncio.create_task(self._collect_annict())
        camera_task = asyncio.create_task(self._collect_camera())

        desktop_seeds = await desktop_task
        wiki_seeds = await wiki_task
        annict_seeds = await annict_task
        camera_seeds = await camera_task

        seeds.extend(desktop_seeds)
        seeds.extend(wiki_seeds)
        seeds.extend(annict_seeds)
        seeds.extend(camera_seeds)

        logger.info(
            "雑談の種: desktop=%d wiki=%d annict=%d camera=%d 合計=%d",
            len(desktop_seeds), len(wiki_seeds), len(annict_seeds),
            len(camera_seeds), len(seeds),
        )
        return seeds

    def select_best_seed(self, seeds: list[TalkSeed]) -> TalkSeed | None:
        """話題のバランスを考慮して種を選ぶ。

        デスクトップ状況 25% / カメラ状況 25% / その他（Wikimedia・Annict）50% の配分。
        該当カテゴリの種がない場合は、残りのカテゴリで再配分する。
        クールダウン中の種は除外。
        """
        self._cleanup_cooldown()

        cooled_down_keys = {key for key, _ in self._used_history}

        # クールダウンチェック後の候補
        available = [s for s in seeds if s._source_key not in cooled_down_keys]
        if not available:
            available = seeds

        if not available:
            return None

        desktop_seeds = [s for s in available if s.source == "desktop"]
        camera_seeds = [s for s in available if s.source == "camera"]
        other_seeds = [s for s in available if s.source not in ("desktop", "camera")]

        # 利用可能なカテゴリで重み付き抽選
        candidates: list[tuple[float, list[TalkSeed]]] = []
        if desktop_seeds:
            candidates.append((0.25, desktop_seeds))
        if camera_seeds:
            candidates.append((0.25, camera_seeds))
        if other_seeds:
            candidates.append((0.50, other_seeds))

        if not candidates:
            return None

        # 重みを正規化して抽選
        total_weight = sum(w for w, _ in candidates)
        roll = random.random() * total_weight
        cumulative = 0.0
        for weight, seed_list in candidates:
            cumulative += weight
            if roll < cumulative:
                return random.choice(seed_list) if len(seed_list) > 1 else seed_list[0]

        # フォールバック
        return candidates[-1][1][0]

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

    async def _collect_camera(self) -> list[TalkSeed]:
        """カメラ画像から種を生成"""
        if not self._camera_enabled:
            return []
        try:
            frame_png = capture_camera_frame(self._camera_device_index)
            if frame_png is None:
                return []

            analysis = await analyze_camera_frame(
                api_key=self._openai_api_key,
                model=self._camera_analysis_model,
                frame_png=frame_png,
            )
            self._last_camera_analysis = analysis

            # 「特に変化なし」的な内容は雑談向きでないのでスキップ
            if analysis.scene_type == "quiet" and "変化" not in analysis.summary:
                return []

            now_str = datetime.now(JST).strftime("%Y-%m-%d %H:%M:%S")
            return [TalkSeed(
                summary=analysis.summary,
                tags=analysis.tags,
                freshness="fresh",
                source="camera",
                lily_perspective=_camera_lily_perspective(analysis),
                haruka_perspective=_camera_haruka_perspective(analysis),
                created_at=now_str,
                _source_key=f"camera:{analysis.scene_type}:{analysis.summary[:20]}",
            )]
        except Exception:
            logger.exception("カメラ画像の収集に失敗")
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


def _camera_lily_perspective(analysis: CameraAnalysis) -> str:
    """カメラ画像に基づくリリィの切り口"""
    perspectives = {
        "outdoor": "外の様子について話しかける",
        "indoor": "部屋の中の様子について声をかける",
        "weather": "天気の話をする",
        "people": "誰かが来たみたいだね、と声をかける",
        "animal": "動物がいるよ！とテンション上げて教える",
        "quiet": "静かだね、と穏やかに声をかける",
    }
    return perspectives.get(analysis.scene_type, "カメラに映った状況について柔らかく話す")


def _camera_haruka_perspective(analysis: CameraAnalysis) -> str:
    """カメラ画像に基づく葉留佳の切り口"""
    perspectives = {
        "outdoor": "外の様子にリアクションする",
        "indoor": "おっ、なんか映ってるじゃん！と乗っかる",
        "weather": "天気に対してハイテンションにコメントする",
        "people": "誰？誰？とテンション高く絡む",
        "animal": "かわいい！！とめちゃくちゃ盛り上がる",
        "quiet": "静かだねー、とリリィの話に乗っかる",
    }
    return perspectives.get(analysis.scene_type, "リリィの話にテンション高く乗っかる")


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
