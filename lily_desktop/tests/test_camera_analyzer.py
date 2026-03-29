"""カメラ分析のユニットテスト"""

import json

import pytest

from ai.camera_analyzer import CameraAnalysis, _parse_analysis


class TestParseAnalysis:
    def test_正常なJSONレスポンスをパースできる(self):
        raw = json.dumps({
            "summary": "外は晴れている",
            "tags": ["天気", "晴れ"],
            "scene_type": "weather",
            "detail": "青空が広がっている",
        })
        result = _parse_analysis(raw)

        assert result.summary == "外は晴れている"
        assert result.tags == ["天気", "晴れ"]
        assert result.scene_type == "weather"
        assert result.detail == "青空が広がっている"
        assert result.timestamp != ""

    def test_コードブロックで囲まれたJSONをパースできる(self):
        raw = '```json\n{"summary": "雨が降っている", "tags": ["天気"], "scene_type": "weather", "detail": "傘が必要"}\n```'
        result = _parse_analysis(raw)

        assert result.summary == "雨が降っている"
        assert result.scene_type == "weather"

    def test_不正なJSONでもフォールバックする(self):
        raw = "これはJSONではありません"
        result = _parse_analysis(raw)

        assert result.summary != ""
        assert result.timestamp != ""

    def test_空文字列でもフォールバックする(self):
        result = _parse_analysis("")

        assert result.summary == "分析失敗"
        assert result.timestamp != ""

    def test_部分的なJSONでもデフォルト値で補完する(self):
        raw = json.dumps({"summary": "猫がいる"})
        result = _parse_analysis(raw)

        assert result.summary == "猫がいる"
        assert result.tags == []
        assert result.scene_type == "other"
        assert result.detail == ""
