import types
from pathlib import Path
import sys

import pytest
import torch

import enroll_speaker


def _install_fake_speechbrain(monkeypatch):
    fake_classifier = object()

    class _FakeEncoderClassifier:
        @staticmethod
        def from_hparams(source, run_opts):
            return fake_classifier

    classifiers_module = types.ModuleType("speechbrain.inference.classifiers")
    classifiers_module.EncoderClassifier = _FakeEncoderClassifier
    inference_module = types.ModuleType("speechbrain.inference")
    inference_module.classifiers = classifiers_module
    speechbrain_module = types.ModuleType("speechbrain")
    speechbrain_module.inference = inference_module

    monkeypatch.setitem(sys.modules, "speechbrain", speechbrain_module)
    monkeypatch.setitem(sys.modules, "speechbrain.inference", inference_module)
    monkeypatch.setitem(
        sys.modules,
        "speechbrain.inference.classifiers",
        classifiers_module,
    )

    return fake_classifier


def test_resolve_reference_paths_collects_top_level_wavs_in_name_order(tmp_path):
    speaker_dir = tmp_path / "speaker_refs"
    speaker_dir.mkdir()
    (speaker_dir / "b.wav").write_bytes(b"b")
    (speaker_dir / "a.wav").write_bytes(b"a")
    (speaker_dir / "ignore.txt").write_text("x", encoding="utf-8")
    nested_dir = speaker_dir / "nested"
    nested_dir.mkdir()
    (nested_dir / "c.wav").write_bytes(b"c")

    resolved = enroll_speaker.resolve_reference_paths(
        refs=None,
        refs_dir=str(speaker_dir),
    )

    assert resolved == [
        speaker_dir / "a.wav",
        speaker_dir / "b.wav",
    ]


def test_main_does_not_save_when_dir_has_no_wavs(tmp_path, monkeypatch, capsys):
    speaker_dir = tmp_path / "empty_refs"
    speaker_dir.mkdir()
    save_calls = []
    monkeypatch.setattr(
        enroll_speaker.torch,
        "save",
        lambda *args, **kwargs: save_calls.append((args, kwargs)),
    )

    enroll_speaker.main(["--dir", str(speaker_dir)])

    captured = capsys.readouterr()
    assert save_calls == []
    assert "WAV" in captured.out


def test_main_does_not_save_when_dir_is_missing(tmp_path, monkeypatch, capsys):
    missing_dir = tmp_path / "missing_refs"
    save_calls = []
    monkeypatch.setattr(
        enroll_speaker.torch,
        "save",
        lambda *args, **kwargs: save_calls.append((args, kwargs)),
    )

    enroll_speaker.main(["--dir", str(missing_dir)])

    captured = capsys.readouterr()
    assert save_calls == []
    assert "見つかりません" in captured.out


def test_main_accepts_refs_and_saves_profile(tmp_path, monkeypatch):
    ref_a = tmp_path / "voice_a.wav"
    ref_b = tmp_path / "voice_b.wav"
    ref_a.write_bytes(b"a")
    ref_b.write_bytes(b"b")
    out_path = tmp_path / "speaker_profile.pt"

    fake_classifier = _install_fake_speechbrain(monkeypatch)
    load_calls = []
    embeddings = iter(
        [
            torch.tensor([[1.0, 0.0]], dtype=torch.float32),
            torch.tensor([[0.0, 1.0]], dtype=torch.float32),
        ]
    )
    save_calls = []

    monkeypatch.setattr(
        enroll_speaker,
        "load_wav",
        lambda path: load_calls.append(path) or torch.ones((1, 16), dtype=torch.float32),
    )
    monkeypatch.setattr(
        enroll_speaker,
        "extract_embedding",
        lambda classifier, wav: next(embeddings),
    )
    monkeypatch.setattr(
        enroll_speaker.torch,
        "save",
        lambda tensor, path: save_calls.append((tensor.clone(), Path(path))),
    )

    enroll_speaker.main(
        ["--refs", str(ref_a), str(ref_b), "--out", str(out_path), "--threshold", "0.4"]
    )

    assert load_calls == [ref_a, ref_b]
    assert len(save_calls) == 1
    assert save_calls[0][1] == out_path
    assert torch.allclose(
        save_calls[0][0],
        torch.tensor([[0.70710677, 0.70710677]], dtype=torch.float32),
        atol=1e-5,
    )
    assert fake_classifier is not None


def test_parse_args_rejects_refs_and_dir_together(tmp_path):
    with pytest.raises(SystemExit):
        enroll_speaker.parse_args(
            [
                "--refs",
                "voice_01.wav",
                "--dir",
                str(tmp_path),
            ]
        )
