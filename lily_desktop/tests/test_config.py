"""core.config のユニットテスト"""

from core.config import (
    DEFAULT_HEALTHPLANET_SYNC_INTERVAL_MINUTES,
    DEFAULT_USER_BALLOON_DISPLAY_SECONDS,
    load_config,
)


def test_user_balloon_display_seconds_defaults_when_missing(tmp_path):
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


def test_user_balloon_display_seconds_uses_config_value(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "display:\n"
        "  user_balloon_display_seconds: 10\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.display.user_balloon_display_seconds == 10.0


def test_user_balloon_display_seconds_invalid_value_falls_back(tmp_path):
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


def test_healthplanet_sync_interval_minutes_defaults_to_15(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "display:\n"
        "  lily_scale: 0.4\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert (
        config.healthplanet.sync_interval_minutes
        == DEFAULT_HEALTHPLANET_SYNC_INTERVAL_MINUTES
    )


def test_healthplanet_sync_interval_minutes_uses_config_value(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "healthplanet:\n"
        "  sync_interval_minutes: 25\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.healthplanet.sync_interval_minutes == 25


def test_healthplanet_sync_interval_minutes_invalid_value_falls_back(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "healthplanet:\n"
        "  sync_interval_minutes: 0\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert (
        config.healthplanet.sync_interval_minutes
        == DEFAULT_HEALTHPLANET_SYNC_INTERVAL_MINUTES
    )


def test_fitbit_enabled_defaults_to_false(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("display:\n  lily_scale: 0.4\n", encoding="utf-8")

    config = load_config(config_path)

    assert config.fitbit.enabled is False


def test_fitbit_enabled_uses_config_value(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "fitbit:\n"
        "  enabled: true\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.fitbit.enabled is True


def test_fitbit_config_file_defaults(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("", encoding="utf-8")

    config = load_config(config_path)

    assert config.fitbit.config_file == "fitbit_config.json"


def test_fitbit_config_file_uses_config_value(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "fitbit:\n"
        "  config_file: custom_fitbit.json\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.fitbit.config_file == "custom_fitbit.json"
