#!/usr/bin/env python
"""音声録音スクリプト — config.yaml のマイクを使って WAV ファイルに保存する

使い方:
    uv run python record_voice.py                        # 対話モード（ファイル名を自動採番）
    uv run python record_voice.py --out me01.wav         # 保存先を指定
    uv run python record_voice.py --out me01.wav --sec 5 # 録音秒数を指定
"""

from __future__ import annotations

import argparse
import queue
import struct
import sys
import threading
import wave
from pathlib import Path

import sounddevice as sd

# config.yaml 読み込みのためパスを追加
sys.path.insert(0, str(Path(__file__).parent))

from core.config import load_config
from voice.audio_capture import CHANNELS, FRAME_DURATION_MS, FRAME_SIZE, SAMPLE_RATE, find_device_index

_DEFAULT_SECONDS = 4


def record(device_index: int | None, seconds: float) -> bytes:
    """指定秒数だけ録音し、16bit PCM バイト列を返す。"""
    buf: queue.Queue[bytes] = queue.Queue()
    stop_event = threading.Event()

    def callback(indata, frames, time_info, status):
        if status:
            print(f"  [警告] {status}")
        buf.put(indata.tobytes())

    frames_needed = int(seconds * 1000 / FRAME_DURATION_MS)
    collected = 0
    chunks: list[bytes] = []

    with sd.InputStream(
        device=device_index,
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
        blocksize=FRAME_SIZE,
        callback=callback,
    ):
        print(f"  録音中 ... {seconds:.1f}秒", end="", flush=True)
        for i in range(frames_needed):
            try:
                chunk = buf.get(timeout=2.0)
                chunks.append(chunk)
                # プログレス表示
                dots_total = 20
                dot = int((i + 1) / frames_needed * dots_total)
                prev_dot = int(i / frames_needed * dots_total)
                if dot > prev_dot:
                    print(".", end="", flush=True)
            except queue.Empty:
                print("\n  [エラー] マイクからデータが取得できませんでした")
                break
    print(" 完了")

    return b"".join(chunks)


def save_wav(path: Path, pcm_data: bytes) -> None:
    """PCM バイト列を WAV ファイルとして保存する。"""
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2)  # 16bit = 2 bytes
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(pcm_data)


def rms(pcm_data: bytes) -> int:
    """PCM データの RMS を計算する（録音品質確認用）。"""
    import math
    n = len(pcm_data) // 2
    if n == 0:
        return 0
    samples = struct.unpack(f"<{n}h", pcm_data)
    return int(math.sqrt(sum(s * s for s in samples) / n))


def interactive_mode(device_index: int | None, device_name: str, seconds: float) -> None:
    """複数ファイルを連続録音するインタラクティブモード。"""
    print(f"\n話者登録用音声録音ツール")
    print(f"マイク: {device_name}")
    print(f"録音時間: {seconds}秒 / ファイル")
    print(f"録音後に enroll_speaker.py を実行してプロファイルを作成してください\n")

    file_index = 1
    saved_files: list[Path] = []

    while True:
        out_path = Path(f"voice_{file_index:02d}.wav")
        print(f"[{file_index}] Enterで録音開始（'q' + Enterで終了）: ", end="", flush=True)
        try:
            line = input().strip()
        except (EOFError, KeyboardInterrupt):
            break

        if line.lower() == "q":
            break

        print(f"  → {out_path} に保存します")
        pcm = record(device_index, seconds)
        volume = rms(pcm)
        print(f"  音量 (RMS): {volume}")
        if volume < 100:
            print("  [警告] 音量が非常に低いです。マイクの設定を確認してください。")

        save_wav(out_path, pcm)
        saved_files.append(out_path)
        print(f"  保存完了: {out_path} ({len(pcm)} bytes)\n")
        file_index += 1

    if saved_files:
        files_str = " ".join(f'"{p}"' for p in saved_files)
        print(f"\n録音ファイル: {', '.join(str(p) for p in saved_files)}")
        print(f"\n次のコマンドで話者登録を行ってください:")
        print(f"  uv run python enroll_speaker.py --refs {files_str} --out speaker_profile.pt")
    else:
        print("録音ファイルはありません。")


def main() -> None:
    parser = argparse.ArgumentParser(description="音声録音: マイク → WAV ファイル")
    parser.add_argument("--out", default=None, help="出力 WAV ファイルパス（省略時は対話モード）")
    parser.add_argument("--sec", type=float, default=_DEFAULT_SECONDS, help=f"録音秒数（デフォルト: {_DEFAULT_SECONDS}）")
    args = parser.parse_args()

    config = load_config()
    device_name = config.voice.device_name or "(デフォルト)"
    device_index = None
    if config.voice.device_name:
        device_index = find_device_index(config.voice.device_name)
        if device_index is None:
            print(f"[警告] 設定されたマイク '{config.voice.device_name}' が見つかりません。デフォルトを使用します。")
            device_name = "(デフォルト)"

    print(f"使用マイク: {device_name}" + (f" (index={device_index})" if device_index is not None else ""))

    if args.out is None:
        # 対話モード
        interactive_mode(device_index, device_name, args.sec)
    else:
        # 単発録音
        out_path = Path(args.out)
        print(f"録音先: {out_path}")
        pcm = record(device_index, args.sec)
        volume = rms(pcm)
        print(f"音量 (RMS): {volume}")
        if volume < 100:
            print("[警告] 音量が非常に低いです。マイクの設定を確認してください。")
        save_wav(out_path, pcm)
        print(f"保存完了: {out_path} ({len(pcm)} bytes)")


if __name__ == "__main__":
    main()
