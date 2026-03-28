"""ポーズ選択 — pose_hintから最適な画像を選択する"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from core.constants import AIKATA_IMAGES_DIR, LILY_IMAGES_DIR

logger = logging.getLogger(__name__)

_POSE_DIR = Path(__file__).resolve().parent


def _load_pose_map(filename: str) -> list[dict]:
    path = _POSE_DIR / filename
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("poses", [])


class PoseManager:
    """キャラクターのポーズを管理・選択する"""

    def __init__(self):
        self._lily_poses = _load_pose_map("lily_pose_map.json")
        self._haruka_poses = _load_pose_map("haruka_pose_map.json")

    def select_lily_pose(self, pose_hint: str) -> Path:
        return self._select("lily", self._lily_poses, pose_hint, LILY_IMAGES_DIR)

    def select_haruka_pose(self, pose_hint: str) -> Path:
        return self._select("haruka", self._haruka_poses, pose_hint, AIKATA_IMAGES_DIR)

    def _select(
        self, character: str, poses: list[dict], hint: str, base_dir: Path
    ) -> Path:
        hint_lower = hint.lower().strip()

        # 完全一致
        for pose in poses:
            if hint_lower in pose.get("emotions", []):
                path = base_dir / pose["filename"]
                if path.exists():
                    return path

        # 部分一致（hint がemotionの一部、またはその逆）
        for pose in poses:
            for emotion in pose.get("emotions", []):
                if hint_lower in emotion or emotion in hint_lower:
                    path = base_dir / pose["filename"]
                    if path.exists():
                        return path

        # デフォルトにフォールバック
        if poses:
            path = base_dir / poses[0]["filename"]
            if path.exists():
                return path

        # 何も見つからない場合
        logger.warning(f"{character}: ポーズ '{hint}' に該当する画像なし")
        return base_dir / poses[0]["filename"] if poses else base_dir
