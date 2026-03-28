"""ポーズ選択 — pose_categoryからカテゴリベースで画像を選択する"""

from __future__ import annotations

import json
import logging
import random
from pathlib import Path

from core.constants import AIKATA_IMAGES_DIR, LILY_IMAGES_DIR

logger = logging.getLogger(__name__)

_POSE_DIR = Path(__file__).resolve().parent

# 全カテゴリ定義
SHARED_CATEGORIES = ["default", "joy", "anger", "sad", "fun", "shy", "worried", "surprised"]
LILY_ONLY_CATEGORIES = ["proud", "caring", "serious", "sleepy", "playful"]
ALL_LILY_CATEGORIES = SHARED_CATEGORIES + LILY_ONLY_CATEGORIES

# リリィ専用カテゴリ → 共通カテゴリへのフォールバック（葉留佳用）
_LILY_TO_SHARED_FALLBACK = {
    "proud": "joy",
    "caring": "worried",
    "serious": "default",
    "sleepy": "sad",
    "playful": "fun",
}

MAX_PER_CATEGORY = 5


def _load_category_map(filename: str) -> dict[str, list[dict]]:
    """カテゴリベースのポーズマップを読み込む"""
    path = _POSE_DIR / filename
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("categories", {})


def _save_category_map(filename: str, categories: dict[str, list[dict]]) -> None:
    """カテゴリベースのポーズマップを保存する"""
    path = _POSE_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"categories": categories, "max_per_category": MAX_PER_CATEGORY}, f, ensure_ascii=False, indent=2)


class PoseManager:
    """キャラクターのポーズをカテゴリベースで管理・選択する"""

    def __init__(self):
        self._lily_categories = _load_category_map("lily_pose_map.json")
        self._haruka_categories = _load_category_map("haruka_pose_map.json")

    def select_lily_pose(self, pose_category: str) -> Path:
        """リリィのポーズをカテゴリから選択する。該当なしならNoneを返しdefaultにフォールバック。"""
        category = pose_category.lower().strip()

        # カテゴリに画像があれば選択
        poses = self._lily_categories.get(category, [])
        if poses:
            return self._pick_random(poses, LILY_IMAGES_DIR)

        # defaultにフォールバック
        default_poses = self._lily_categories.get("default", [])
        if default_poses:
            return self._pick_random(default_poses, LILY_IMAGES_DIR)

        # レガシー: 何もなければlily_default.png
        return LILY_IMAGES_DIR / "lily_default.png"

    def select_haruka_pose(self, pose_category: str) -> Path:
        """葉留佳のポーズをカテゴリから選択する。リリィ専用カテゴリは共通にフォールバック。"""
        category = pose_category.lower().strip()

        # リリィ専用カテゴリの場合、共通カテゴリにフォールバック
        if category in _LILY_TO_SHARED_FALLBACK:
            category = _LILY_TO_SHARED_FALLBACK[category]

        poses = self._haruka_categories.get(category, [])
        if poses:
            return self._pick_random(poses, AIKATA_IMAGES_DIR)

        # defaultにフォールバック
        default_poses = self._haruka_categories.get("default", [])
        if default_poses:
            return self._pick_random(default_poses, AIKATA_IMAGES_DIR)

        return AIKATA_IMAGES_DIR / "05_saigusa_haruka01.png"

    def needs_generation(self, category: str) -> bool:
        """指定カテゴリのリリィポーズが不足しているか"""
        poses = self._lily_categories.get(category, [])
        return len(poses) < MAX_PER_CATEGORY

    def add_lily_pose(self, category: str, filename: str, description: str) -> None:
        """生成されたリリィのポーズをマップに追記する"""
        if category not in self._lily_categories:
            self._lily_categories[category] = []

        self._lily_categories[category].append({
            "filename": filename,
            "description": description,
        })

        # JSONファイルに保存
        _save_category_map("lily_pose_map.json", self._lily_categories)
        logger.info("リリィポーズ追加: category=%s filename=%s", category, filename)

    def get_lily_category_count(self, category: str) -> int:
        """指定カテゴリのリリィポーズ数を返す"""
        return len(self._lily_categories.get(category, []))

    def _pick_random(self, poses: list[dict], base_dir: Path) -> Path:
        """ポーズリストからランダムに1枚を選ぶ"""
        pose = random.choice(poses)
        path = base_dir / pose["filename"]
        if path.exists():
            return path
        # ファイルが存在しない場合は最初のポーズで試す
        for p in poses:
            fallback = base_dir / p["filename"]
            if fallback.exists():
                return fallback
        return base_dir / poses[0]["filename"]
