"""core.config のユニットテスト"""

import core.config as config_mod

from core.config import (
    DEFAULT_HTTP_BRIDGE_PORT,
    DEFAULT_HEALTHPLANET_SYNC_INTERVAL_MINUTES,
    DEFAULT_MEMORY_DIRECTORY,
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


def test_speaker_verification_recording_enabled_defaults_to_true(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("", encoding="utf-8")

    config = load_config(config_path)

    assert config.voice.speaker_verification_recording_enabled is True


def test_speaker_verification_recording_enabled_uses_config_value(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "voice:\n"
        "  speaker_verification_recording_enabled: false\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.voice.speaker_verification_recording_enabled is False


def test_speaker_verification_recording_threshold_uses_config_value(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "voice:\n"
        "  speaker_verification_recording_threshold: 0.28\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.voice.speaker_verification_recording_threshold == 0.28


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


def test_camera_provider_defaults_to_openai_with_local_ollama_base_urls(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("", encoding="utf-8")

    config = load_config(config_path)

    assert config.camera.analysis_provider == "openai"
    assert config.camera.analysis_base_url == "http://127.0.0.1:11434"
    assert config.camera.summary_provider == "openai"
    assert config.camera.summary_base_url == "http://127.0.0.1:11434"


def test_camera_provider_settings_are_loaded_from_config(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "camera:\n"
        "  analysis_provider: ollama\n"
        "  analysis_base_url: http://localhost:11434/\n"
        "  analysis_model: gemma4:e4b\n"
        "  summary_provider: ollama\n"
        "  summary_base_url: http://127.0.0.1:11434\n"
        "  summary_model: gemma4:e4b\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.camera.analysis_provider == "ollama"
    assert config.camera.analysis_base_url == "http://localhost:11434"
    assert config.camera.analysis_model == "gemma4:e4b"
    assert config.camera.summary_provider == "ollama"
    assert config.camera.summary_base_url == "http://127.0.0.1:11434"
    assert config.camera.summary_model == "gemma4:e4b"


def test_desktop_provider_settings_are_loaded_from_config(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "desktop:\n"
        "  analysis_provider: ollama\n"
        "  analysis_base_url: http://localhost:11434/\n"
        "  analysis_model: gemma4:e4b\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.desktop.analysis_provider == "ollama"
    assert config.desktop.analysis_base_url == "http://localhost:11434"
    assert config.desktop.analysis_model == "gemma4:e4b"


def test_desktop_provider_defaults_to_legacy_openai_screen_model(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "openai:\n"
        "  screen_analysis_model: gpt-5.4-mini\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.desktop.analysis_provider == "openai"
    assert config.desktop.analysis_base_url == "http://127.0.0.1:11434"
    assert config.desktop.analysis_model == "gpt-5.4-mini"


def test_chat_auto_talk_skip_audible_domains_defaults(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("", encoding="utf-8")

    config = load_config(config_path)

    assert config.chat.auto_talk_skip_audible_domains == [
        "youtube.com",
        "netflix.com",
        "primevideo.com",
    ]


def test_chat_auto_talk_skip_audible_domains_uses_config_value(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "chat:\n"
        "  auto_talk_skip_audible_domains:\n"
        "    - music.youtube.com\n"
        "    - tv.netflix.com\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.chat.auto_talk_skip_audible_domains == [
        "music.youtube.com",
        "tv.netflix.com",
    ]


def test_chat_auto_talk_skip_audible_domains_can_be_disabled_with_empty_list(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "chat:\n"
        "  auto_talk_skip_audible_domains: []\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.chat.auto_talk_skip_audible_domains == []


def test_memory_directory_defaults_when_missing(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text("", encoding="utf-8")

    config = load_config(config_path)

    assert config.talk_seeds.memory_directory == DEFAULT_MEMORY_DIRECTORY


def test_memory_directory_uses_config_value(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "talk_seeds:\n"
        "  memory_directory: D:\\custom\\memories\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.talk_seeds.memory_directory == "D:\\custom\\memories"


def test_memory_directory_empty_string_disables_memory_category(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "talk_seeds:\n"
        "  memory_directory: \"\"\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.talk_seeds.memory_directory == ""


def test_memory_directory_resolves_relative_path_from_config_directory(tmp_path):
    config_path = tmp_path / "config.yaml"
    config_path.write_text(
        "talk_seeds:\n"
        "  memory_directory: generated_text\n",
        encoding="utf-8",
    )

    config = load_config(config_path)

    assert config.talk_seeds.memory_directory == str((tmp_path / "generated_text").resolve())
