"""マイク入力キャプチャ — sounddevice ラッパー"""

from __future__ import annotations

import logging
import queue

import numpy as np
import sounddevice as sd

logger = logging.getLogger(__name__)

# webrtcvad の要求: 16kHz, 16bit, mono, 30ms = 960 bytes
SAMPLE_RATE = 16000
CHANNELS = 1
FRAME_DURATION_MS = 30
FRAME_SIZE = int(SAMPLE_RATE * FRAME_DURATION_MS / 1000)  # 480 samples
FRAME_BYTES = FRAME_SIZE * 2  # 16bit = 2 bytes per sample → 960 bytes


def list_input_devices() -> list[dict]:
    """利用可能な入力デバイスの一覧を返す。

    Returns:
        [{"index": int, "name": str, "channels": int}, ...]
    """
    devices = sd.query_devices()
    result = []
    for i, dev in enumerate(devices):
        if dev["max_input_channels"] > 0:
            result.append({
                "index": i,
                "name": dev["name"],
                "channels": dev["max_input_channels"],
            })
    return result


def find_device_index(device_name: str) -> int | None:
    """デバイス名からインデックスを検索する。見つからなければNone。"""
    for dev in list_input_devices():
        if dev["name"] == device_name:
            return dev["index"]
    return None


class AudioCapture:
    """マイクから PCM フレームを取得する"""

    def __init__(self, device_index: int | None = None):
        self._queue: queue.Queue[bytes] = queue.Queue()
        self._stream: sd.InputStream | None = None
        self._device_index = device_index

    def set_device(self, device_index: int | None) -> None:
        """使用するデバイスを変更する。実行中なら再起動が必要。"""
        self._device_index = device_index

    def start(self) -> None:
        """マイク入力を開始する"""
        if self._stream is not None:
            return

        # 使用するデバイス情報をログ出力
        if self._device_index is not None:
            dev_info = sd.query_devices(self._device_index)
            logger.info("使用マイク: [%d] %s", self._device_index, dev_info["name"])
        else:
            dev_info = sd.query_devices(kind="input")
            logger.info("使用マイク（デフォルト）: %s", dev_info.get("name", "不明"))

        self._stream = sd.InputStream(
            device=self._device_index,
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="int16",
            blocksize=FRAME_SIZE,
            callback=self._callback,
        )
        self._stream.start()
        logger.info("マイク入力を開始: %dHz, %dch, %dms フレーム", SAMPLE_RATE, CHANNELS, FRAME_DURATION_MS)

    def stop(self) -> None:
        """マイク入力を停止する"""
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
            # キューをクリア
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except queue.Empty:
                    break
            logger.info("マイク入力を停止")

    def read_frame(self, timeout: float = 1.0) -> bytes | None:
        """キューから1フレーム取得する。タイムアウト時はNone。"""
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None

    def _callback(self, indata: np.ndarray, frames: int, time_info, status) -> None:
        """sounddevice コールバック（別スレッドで呼ばれる）"""
        if status:
            logger.warning("オーディオステータス: %s", status)
        self._queue.put(indata.tobytes())
