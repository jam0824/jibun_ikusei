"""話者照合モジュール — SpeechBrain ECAPA-TDNN を使って話者を識別する"""

from __future__ import annotations

import logging
import struct
from pathlib import Path
from typing import NamedTuple

import torch

logger = logging.getLogger(__name__)

# SpeechBrain のモデル ID
_MODEL_SOURCE = "speechbrain/spkrec-ecapa-voxceleb"
_SAMPLE_RATE = 16000


class SpeakerProfile(NamedTuple):
    classifier: object  # EncoderClassifier
    ref_embedding: torch.Tensor  # shape (1, D), L2正規化済み
    threshold: float


def load_profile(profile_path: str | Path, threshold: float = 0.25) -> SpeakerProfile | None:
    """話者プロファイル (.pt) を読み込み、SpeakerProfile を返す。

    ファイルが存在しない場合は None を返す。
    """
    path = Path(profile_path)
    if not path.exists():
        logger.warning("話者プロファイルが見つかりません: %s", path)
        return None

    try:
        from speechbrain.inference.classifiers import EncoderClassifier  # type: ignore

        classifier = EncoderClassifier.from_hparams(
            source=_MODEL_SOURCE,
            run_opts={"device": "cpu"},
        )
        ref_embedding: torch.Tensor = torch.load(path, weights_only=True)
        logger.info("話者プロファイルを読み込み: %s (shape=%s)", path, ref_embedding.shape)
        return SpeakerProfile(classifier=classifier, ref_embedding=ref_embedding, threshold=threshold)
    except Exception:
        logger.exception("話者プロファイルの読み込みに失敗しました")
        return None


def make_embedding_from_bytes(classifier: object, audio_bytes: bytes) -> torch.Tensor:
    """16kHz / mono / 16bit PCM バイト列から埋め込みベクトルを生成する。"""
    n_samples = len(audio_bytes) // 2
    samples = struct.unpack(f"<{n_samples}h", audio_bytes)
    wav_tensor = torch.tensor(samples, dtype=torch.float32) / 32768.0  # [-1, 1] に正規化
    wav_tensor = wav_tensor.unsqueeze(0)  # (1, T)
    return _encode(classifier, wav_tensor)


def _encode(classifier: object, wav_tensor: torch.Tensor) -> torch.Tensor:
    """wav_tensor (1, T) から L2正規化済み埋め込みを返す。"""
    with torch.no_grad():
        emb = classifier.encode_batch(wav_tensor)  # (1, 1, D)
        emb = emb.squeeze(1)  # (1, D)
        emb = torch.nn.functional.normalize(emb, p=2, dim=-1)
    return emb


def verify_embedding(
    ref_emb: torch.Tensor, test_emb: torch.Tensor, threshold: float
) -> tuple[float, bool]:
    """コサイン類似度でテスト埋め込みが話者と一致するか判定する。

    Returns:
        (score, accepted) — score は [−1, 1] のコサイン類似度
    """
    score = torch.nn.functional.cosine_similarity(ref_emb, test_emb, dim=-1).item()
    accepted = score >= threshold
    return score, accepted
