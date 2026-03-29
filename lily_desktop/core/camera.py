"""カメラデバイス列挙・画像キャプチャ"""

from __future__ import annotations

import logging
import subprocess

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# Windows環境でOpenCVがスキャンするカメラインデックスの最大値
_MAX_CAMERA_INDEX = 8


def _get_pnp_camera_names() -> list[str]:
    """Windows PnP からカメラデバイス名を取得する。

    返却順はPnPの列挙順で、OpenCVのインデックス順と一致する保証はないが、
    多くの環境では同じ順序になる。
    """
    try:
        result = subprocess.run(
            [
                "powershell", "-Command",
                "Get-PnpDevice -Class Camera -Status OK "
                "| Select-Object FriendlyName | ConvertTo-Json",
            ],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode != 0:
            return []

        import json
        data = json.loads(result.stdout)
        # 1台の場合はdictで返る、複数台はlist
        if isinstance(data, dict):
            data = [data]
        return [d["FriendlyName"] for d in data if d.get("FriendlyName")]
    except Exception:
        logger.debug("PnPカメラ名取得に失敗", exc_info=True)
        return []


def list_cameras() -> list[dict]:
    """利用可能なカメラデバイスの一覧を返す。

    Returns:
        [{"index": int, "name": str}, ...]
    """
    pnp_names = _get_pnp_camera_names()

    result: list[dict] = []
    for i in range(_MAX_CAMERA_INDEX):
        cap = cv2.VideoCapture(i, cv2.CAP_MSMF)
        if cap.isOpened():
            # PnP名があればそれを使い、なければインデックスベースの名前
            if i < len(pnp_names):
                name = pnp_names[i]
            else:
                name = f"カメラ {i}"
            result.append({
                "index": i,
                "name": name,
            })
            cap.release()
    return result


def find_camera_index(device_name: str) -> int | None:
    """デバイス名からインデックスを検索する。見つからなければNone。"""
    for cam in list_cameras():
        if cam["name"] == device_name:
            return cam["index"]
    return None


def capture_camera_frame(device_index: int = 0) -> bytes | None:
    """指定カメラから1フレームをキャプチャしてPNGバイト列で返す。

    Args:
        device_index: カメラデバイスのインデックス

    Returns:
        PNG画像のバイト列。失敗時はNone。
    """
    cap = cv2.VideoCapture(device_index, cv2.CAP_MSMF)
    if not cap.isOpened():
        logger.warning("カメラ %d を開けませんでした", device_index)
        return None

    try:
        ret, frame = cap.read()
        if not ret or frame is None:
            logger.warning("カメラ %d からフレームを取得できませんでした", device_index)
            return None

        success, buf = cv2.imencode(".png", frame)
        if not success:
            logger.warning("PNG エンコードに失敗しました")
            return None

        return buf.tobytes()
    finally:
        cap.release()
