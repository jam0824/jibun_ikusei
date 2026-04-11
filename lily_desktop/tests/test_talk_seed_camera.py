from __future__ import annotations

from ai.camera_analyzer import CameraAnalysis
from ai.talk_seed import _camera_haruka_perspective, _camera_lily_perspective


def test_camera_perspectives_avoid_meta_camera_wording():
    lily_perspective = _camera_lily_perspective(CameraAnalysis(scene_type="other"))
    haruka_perspective = _camera_haruka_perspective(CameraAnalysis(scene_type="indoor"))

    assert "カメラ" not in lily_perspective
    assert "映ってる" not in haruka_perspective
