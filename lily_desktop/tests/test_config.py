"""core.config のユニットテスト"""

from core.config import (
    DEFAULT_USER_BALLOON_DISPLAY_SECONDS,
    load_config,
)


def test_user_balloon_display_seconds_未設定時は既定値になる(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "display:\n"
        "  lily_scale: 0.4\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.display.lily_scale == 0.4
    assert (
        config.display.user_balloon_display_seconds
        == DEFAULT_USER_BALLOON_DISPLAY_SECONDS
    )


def test_user_balloon_display_seconds_設定値を読み込める(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "display:\n"
        "  user_balloon_display_seconds: 10\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.display.user_balloon_display_seconds == 10.0


def test_user_balloon_display_seconds_不正値は既定値に戻る(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "display:\n"
        "  user_balloon_display_seconds: invalid\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert (
        config.display.user_balloon_display_seconds
        == DEFAULT_USER_BALLOON_DISPLAY_SECONDS
    )
