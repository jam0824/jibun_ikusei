#!/usr/bin/env python
"""話者登録スクリプト — WAV ファイルから埋め込みを抽出して speaker_profile.pt に保存する

使い方:
    uv run python enroll_speaker.py --refs me01.wav me02.wav me03.wav --out speaker_profile.pt
    uv run python enroll_speaker.py --dir recorded_voices --out speaker_profile.pt
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Sequence

import torch
import torchaudio


_MODEL_SOURCE = "speechbrain/spkrec-ecapa-voxceleb"
_TARGET_SR = 16000


def load_wav(path: Path) -> torch.Tensor:
    """WAV を 16kHz / モノラル / float32 (1, T) で読み込む。"""
    wav, sr = torchaudio.load(str(path))
    if wav.shape[0] > 1:
        wav = wav.mean(dim=0, keepdim=True)  # ステレオ → モノラル
    if sr != _TARGET_SR:
        wav = torchaudio.functional.resample(wav, orig_freq=sr, new_freq=_TARGET_SR)
    return wav


def extract_embedding(classifier, wav: torch.Tensor) -> torch.Tensor:
    """(1, T) の音声テンソルから L2正規化済み埋め込み (1, D) を返す。"""
    with torch.no_grad():
        emb = classifier.encode_batch(wav)  # (1, 1, D)
        emb = emb.squeeze(1)               # (1, D)
        emb = torch.nn.functional.normalize(emb, p=2, dim=-1)
    return emb


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="話者登録: WAV → speaker_profile.pt")
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--refs", nargs="+", help="参照 WAV ファイル（複数可）")
    source_group.add_argument("--dir", help="参照 WAV ファイルを含むフォルダ（直下の *.wav を読み込む）")
    parser.add_argument("--out", default="speaker_profile.pt", help="出力プロファイルパス")
    parser.add_argument("--threshold", type=float, default=0.25, help="照合閾値（デフォルト: 0.25）")
    return parser.parse_args(argv)


def resolve_reference_paths(
    refs: Sequence[str] | None,
    refs_dir: str | None,
) -> list[Path]:
    if refs:
        return [Path(ref_path) for ref_path in refs]

    if refs_dir is None:
        raise ValueError("参照 WAV ファイルが指定されていません。")

    dir_path = Path(refs_dir)
    if not dir_path.exists():
        raise ValueError(f"フォルダが見つかりません: {dir_path}")
    if not dir_path.is_dir():
        raise ValueError(f"指定したパスはフォルダではありません: {dir_path}")

    ref_paths = sorted(
        path
        for path in dir_path.glob("*.wav")
        if path.is_file()
    )
    if not ref_paths:
        raise ValueError(f"フォルダ内に参照 WAV ファイルがありません: {dir_path}")

    return ref_paths


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)

    try:
        ref_paths = resolve_reference_paths(args.refs, args.dir)
    except ValueError as exc:
        print(f"[エラー] {exc}")
        return

    print(f"SpeechBrain モデルを読み込み中: {_MODEL_SOURCE}")
    from speechbrain.inference.classifiers import EncoderClassifier  # type: ignore

    classifier = EncoderClassifier.from_hparams(
        source=_MODEL_SOURCE,
        run_opts={"device": "cpu"},
    )

    embeddings: list[torch.Tensor] = []
    for ref_path in ref_paths:
        if not ref_path.exists():
            print(f"  [警告] ファイルが見つかりません: {ref_path}")
            continue
        print(f"  処理中: {ref_path}")
        wav = load_wav(ref_path)
        emb = extract_embedding(classifier, wav)
        embeddings.append(emb)
        print(f"    埋め込み shape: {emb.shape}")

    if not embeddings:
        print("[エラー] 有効なファイルがありませんでした。")
        return

    # 複数ファイルの埋め込みを平均して再 L2正規化
    avg_emb = torch.stack(embeddings).mean(dim=0)  # (1, D)
    avg_emb = torch.nn.functional.normalize(avg_emb, p=2, dim=-1)

    out_path = Path(args.out)
    torch.save(avg_emb, out_path)
    print(f"\n話者プロファイルを保存しました: {out_path}")
    print(f"  埋め込み shape: {avg_emb.shape}")
    print(f"  照合閾値: {args.threshold}")
    print(f"\n使い方 (config.yaml):")
    print(f"  voice:")
    print(f"    speaker_verification_enabled: true")
    print(f"    speaker_profile_path: {out_path}")
    print(f"    speaker_verification_threshold: {args.threshold}")


if __name__ == "__main__":
    main()
