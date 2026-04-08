"""core.config のユニットテスト"""

import core.config as config_mod

from core.config import (
    DEFAULT_HTTP_BRIDGE_PORT,
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


def test_http_bridge_defaults_to_enabled_with_default_port(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("", encoding="utf-8")

    config = load_config(config_path)

    assert config.http_bridge.enabled is True
    assert config.http_bridge.port == DEFAULT_HTTP_BRIDGE_PORT


def test_http_bridge_uses_config_values(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "http_bridge:\n"
        "  enabled: false\n"
        "  port: 19191\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.http_bridge.enabled is False
    assert config.http_bridge.port == 19191


def test_http_bridge_invalid_port_falls_back_to_default(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "http_bridge:\n"
        "  port: 70000\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.http_bridge.port == DEFAULT_HTTP_BRIDGE_PORT


def test_voice_pause_during_tts_defaults_to_true(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("", encoding="utf-8")

    config = load_config(config_path)

    assert config.voice.pause_during_tts is True


def test_voice_pause_during_tts_uses_config_value(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "voice:\n"
        "  pause_during_tts: false\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.voice.pause_during_tts is False


def test_rakuten_config_defaults_when_missing(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("", encoding="utf-8")
    monkeypatch.setattr(config_mod, "_ENV_PATH", tmp_path / ".env")

    config = load_config(config_path)

    assert config.rakuten.application_id == ""
    assert config.rakuten.access_key == ""
    assert config.rakuten.origin == ""


def test_rakuten_config_reads_credentials_from_env(tmp_path, monkeypatch):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("", encoding="utf-8")
    env_path = tmp_path / ".env"
    env_path.write_text(
        "RAKUTEN_APPLICATION_ID=app-123\n"
        "RAKUTEN_ACCESS_KEY=access-456\n"
        "RAKUTEN_ORIGIN=https://jam0824.github.io\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(config_mod, "_ENV_PATH", env_path)

    config = load_config(config_path)

    assert config.rakuten.application_id == "app-123"
    assert config.rakuten.access_key == "access-456"
    assert config.rakuten.origin == "https://jam0824.github.io"
