from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

import yaml

_BASE_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _BASE_DIR.parent  # 自分育成アプリ/
_CONFIG_PATH = _BASE_DIR / "config.yaml"
_ENV_PATH = _PROJECT_ROOT / ".env"
SYS_DIR = _BASE_DIR / "sys"
DEFAULT_USER_BALLOON_DISPLAY_SECONDS = 8.0
DEFAULT_HEALTHPLANET_SYNC_INTERVAL_MINUTES = 15
DEFAULT_LEVEL_WATCH_INTERVAL_MINUTES = 10
DEFAULT_HTTP_BRIDGE_PORT = 18765
DEFAULT_ACTIVITY_CAPTURE_POLL_INTERVAL_SECONDS = 2
DEFAULT_ACTIVITY_CAPTURE_SYNC_INTERVAL_SECONDS = 600
DEFAULT_ACTIVITY_PROCESSING_MAX_COMPLETION_TOKENS = 1200
DEFAULT_CAMERA_SUMMARY_MAX_COMPLETION_TOKENS = 1600
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
DEFAULT_WEB_BASE_URL = "http://127.0.0.1:5173/#"
DEFAULT_MEMORY_DIRECTORY = r"D:\codes\mixi2-api\generated_text"
DEFAULT_AUTO_TALK_SKIP_AUDIBLE_DOMAINS = [
    "youtube.com",
    "netflix.com",
    "primevideo.com",
]


def _load_dotenv(path: Path | None = None) -> dict[str, str]:
    """シンプルな .env パーサー（KEY=VALUE 形式）"""
    if path is None:
        path = _ENV_PATH
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def normalize_user_balloon_display_seconds(value: object) -> float:
    """ユーザー吹き出し表示秒数を正の float に正規化する。"""
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return DEFAULT_USER_BALLOON_DISPLAY_SECONDS
    if seconds <= 0:
        return DEFAULT_USER_BALLOON_DISPLAY_SECONDS
    return seconds


def normalize_healthplanet_sync_interval_minutes(value: object) -> int:
    """Health Planet 同期間隔を正の分数に正規化する。"""
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        return DEFAULT_HEALTHPLANET_SYNC_INTERVAL_MINUTES
    if minutes <= 0:
        return DEFAULT_HEALTHPLANET_SYNC_INTERVAL_MINUTES
    return minutes


def normalize_level_watch_interval_minutes(value: object) -> int:
    """レベル監視間隔を正の分数に正規化する。"""
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        return DEFAULT_LEVEL_WATCH_INTERVAL_MINUTES
    if minutes <= 0:
        return DEFAULT_LEVEL_WATCH_INTERVAL_MINUTES
    return minutes


def normalize_http_bridge_port(value: object) -> int:
    """Local HTTP Bridge のポート番号を正規化する。"""
    try:
        port = int(value)
    except (TypeError, ValueError):
        return DEFAULT_HTTP_BRIDGE_PORT
    if port <= 0 or port > 65535:
        return DEFAULT_HTTP_BRIDGE_PORT
    return port


def normalize_activity_capture_state(value: object) -> str:
    if not isinstance(value, str):
        return "active"
    state = value.strip().lower()
    if state in {"active", "paused", "disabled"}:
        return state
    return "active"


def normalize_activity_capture_poll_interval_seconds(value: object) -> int:
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return DEFAULT_ACTIVITY_CAPTURE_POLL_INTERVAL_SECONDS
    if seconds <= 0:
        return DEFAULT_ACTIVITY_CAPTURE_POLL_INTERVAL_SECONDS
    return seconds


def normalize_activity_capture_sync_interval_seconds(value: object) -> int:
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return DEFAULT_ACTIVITY_CAPTURE_SYNC_INTERVAL_SECONDS
    if seconds <= 0:
        return DEFAULT_ACTIVITY_CAPTURE_SYNC_INTERVAL_SECONDS
    return seconds


def normalize_activity_processing_max_completion_tokens(value: object) -> int:
    try:
        tokens = int(value)
    except (TypeError, ValueError):
        return DEFAULT_ACTIVITY_PROCESSING_MAX_COMPLETION_TOKENS
    if tokens <= 0:
        return DEFAULT_ACTIVITY_PROCESSING_MAX_COMPLETION_TOKENS
    return tokens


def normalize_camera_summary_max_completion_tokens(value: object) -> int:
    try:
        tokens = int(value)
    except (TypeError, ValueError):
        return DEFAULT_CAMERA_SUMMARY_MAX_COMPLETION_TOKENS
    if tokens <= 0:
        return DEFAULT_CAMERA_SUMMARY_MAX_COMPLETION_TOKENS
    return tokens


def normalize_activity_capture_privacy_rules(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    normalized: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        rule: dict[str, object] = {}
        for key in ("id", "type", "value", "mode", "updatedAt"):
            item_value = item.get(key)
            if isinstance(item_value, str) and item_value.strip():
                rule[key] = item_value.strip()
        enabled = item.get("enabled")
        rule["enabled"] = enabled if isinstance(enabled, bool) else True
        if {"type", "value", "mode"}.issubset(rule.keys()):
            normalized.append(rule)
    return normalized


def normalize_domain_list(value: object, *, default: list[str]) -> list[str]:
    if value is None:
        return list(default)
    if not isinstance(value, list):
        return list(default)
    normalized: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        domain = item.strip().lower()
        if not domain:
            continue
        normalized.append(domain)
    return normalized


def normalize_ai_provider(value: object) -> str:
    """Normalize AI provider names while keeping older configs on OpenAI."""
    if not isinstance(value, str):
        return "openai"
    provider = value.strip().lower()
    if provider in {"openai", "ollama"}:
        return provider
    return "openai"


def normalize_ai_base_url(value: object) -> str:
    """Normalize local AI base URLs to scheme://host[:port]."""
    if not isinstance(value, str):
        return DEFAULT_OLLAMA_BASE_URL
    raw = value.strip()
    if not raw:
        return DEFAULT_OLLAMA_BASE_URL
    parts = urlsplit(raw)
    if parts.scheme and parts.netloc:
        return f"{parts.scheme}://{parts.netloc}"
    return raw.rstrip("/")


def normalize_web_base_url(value: object) -> str:
    if not isinstance(value, str):
        return DEFAULT_WEB_BASE_URL
    raw = value.strip()
    if not raw:
        return DEFAULT_WEB_BASE_URL
    parts = urlsplit(raw)
    if parts.scheme and parts.netloc:
        normalized = f"{parts.scheme}://{parts.netloc}{parts.path.rstrip('/')}"
    else:
        normalized = raw.rstrip("/")
    if normalized.endswith("/#"):
        return normalized
    if normalized.endswith("#"):
        return normalized
    return f"{normalized}/#"


def normalize_memory_directory(
    value: object,
    *,
    base_dir: Path,
) -> str:
    """Normalize the optional memory seed directory.

    Empty string disables the category. Relative paths are resolved from
    the directory containing config.yaml.
    """
    if value is None:
        return DEFAULT_MEMORY_DIRECTORY
    if not isinstance(value, str):
        return DEFAULT_MEMORY_DIRECTORY
    raw = value.strip()
    if not raw:
        return ""
    memory_dir = Path(raw)
    if not memory_dir.is_absolute():
        memory_dir = (base_dir / memory_dir).resolve()
    return str(memory_dir)


@dataclass
class OpenAIConfig:
    api_key: str = ""
    chat_model: str = "gpt-5.4"
    image_model: str = "gpt-image-1.5"
    screen_analysis_model: str = "gpt-5.4"


@dataclass
class DesktopConfig:
    analysis_provider: str = "openai"
    analysis_base_url: str = DEFAULT_OLLAMA_BASE_URL
    analysis_model: str = "gpt-5.4"
    level_watch_interval_minutes: int = DEFAULT_LEVEL_WATCH_INTERVAL_MINUTES


@dataclass
class CognitoConfig:
    email: str = ""
    password: str = ""


@dataclass
class AnnictConfig:
    access_token: str = ""


@dataclass
class RakutenConfig:
    application_id: str = ""
    access_key: str = ""
    origin: str = ""


@dataclass
class ChatConfig:
    auto_talk_interval_minutes: int = 15
    auto_talk_min_turns: int = 3
    auto_talk_max_turns: int = 5
    follow_up_min_extra: int = 1
    follow_up_max_extra: int = 3
    auto_talk_skip_audible_domains: list[str] = field(
        default_factory=lambda: list(DEFAULT_AUTO_TALK_SKIP_AUDIBLE_DOMAINS)
    )


@dataclass
class VoiceConfig:
    enabled: bool = False
    pause_during_tts: bool = True  # TTS再生中にマイク入力を一時停止するか
    vad_aggressiveness: int = 3       # 0-3, 3が最も厳格（ノイズに強い）
    vad_start_frames: int = 10        # 発話開始に必要な連続音声フレーム数（大きいほど誤検知しにくい）
    vad_end_frames: int = 30          # 発話終了と判定する連続無音フレーム数（大きいほど間を許容）
    language: str = "ja-JP"
    google_api_key: str = ""
    device_name: str = ""  # 選択されたマイクデバイス名（空=デフォルト）
    use_wake_words: bool = True  # ウェイクワードを使うかどうか（Falseなら全音声に応答）
    wake_words: list[str] = field(default_factory=lambda: ["リリィ", "リリー"])  # ウェイクワード
    wake_word_aliases: list[str] = field(default_factory=lambda: ["DD"])  # リリィに変換する誤認識パターン
    ignore_words: list[str] = field(default_factory=list)  # このワードが含まれていたら返答生成に送らない
    max_speech_seconds: float = 8.0  # 最大発話時間（秒）— これを超えると強制終了
    volume_threshold: int = 1500    # 音量閾値 — フレームのRMS振幅がこれ以下なら無視
    volume_threshold_enabled: bool = True  # RMS音量閾値判定を使うかどうか（falseなら無効）
    speaker_verification_enabled: bool = False  # 話者照合を使うかどうか
    speaker_profile_path: str = "speaker_profile.pt"  # 話者プロファイルのパス
    speaker_verification_threshold: float = 0.25  # 照合閾値（コサイン類似度）
    speaker_verification_recording_enabled: bool = True  # 話者照合OKの音声を学習用に保存するかどうか
    speaker_verification_recording_threshold: float = 0.25  # 学習用録音を保存するスコア閾値


@dataclass
class TTSConfig:
    enabled: bool = False
    voicevox_url: str = "http://localhost:50021"
    lily_engine: str = "voicevox"          # "voicevox" or "gemini"
    lily_speaker_id: int = 20              # VOICEVOX speaker ID
    lily_gemini_voice: str = "Zephyr"      # Gemini TTS voice name
    haruka_engine: str = "voicevox"        # "voicevox" or "gemini"
    haruka_speaker_id: int = 8             # VOICEVOX speaker ID
    haruka_gemini_voice: str = "Kore"      # Gemini TTS voice name
    gemini_model: str = "gemini-2.5-flash-preview-tts"
    gemini_api_key: str = ""


@dataclass
class CameraConfig:
    enabled: bool = False
    device_name: str = ""  # 選択されたカメラデバイス名（空=デフォルト）
    interval_seconds: int = 180  # キャプチャ間隔（秒）— デフォルト3分
    analysis_model: str = "gpt-5.4"  # カメラ画像分析AIモデル
    summary_model: str = "gpt-5-nano"  # 30分要約AIモデル
    summary_interval_seconds: int = 1800  # サーバー要約間隔（秒）— デフォルト30分


@dataclass
class LegacyCameraConfig:
    enabled: bool = False
    device_name: str = ""
    interval_seconds: int = 180
    analysis_provider: str = "openai"
    analysis_base_url: str = DEFAULT_OLLAMA_BASE_URL
    analysis_model: str = "gpt-5.4"
    summary_provider: str = "openai"
    summary_base_url: str = DEFAULT_OLLAMA_BASE_URL
    summary_model: str = "gpt-5-nano"
    summary_max_completion_tokens: int = DEFAULT_CAMERA_SUMMARY_MAX_COMPLETION_TOKENS
    summary_interval_seconds: int = 1800


CameraConfig = LegacyCameraConfig


@dataclass
class DisplayConfig:
    lily_scale: float = 0.3
    haruka_scale: float = 0.7
    user_balloon_display_seconds: float = DEFAULT_USER_BALLOON_DISPLAY_SECONDS
    window_x: int | None = None  # ウィンドウ位置X（Noneならデフォルト位置）
    window_y: int | None = None  # ウィンドウ位置Y


@dataclass
class TalkSeedsConfig:
    interest_topics: list[str] = field(default_factory=list)  # 豆知識で優先する興味ある分野
    memory_directory: str = DEFAULT_MEMORY_DIRECTORY


@dataclass
class HealthPlanetConfig:
    client_id: str = ""
    client_secret: str = ""
    access_token: str = ""
    token_expires_at: int = 0  # Unix timestamp (JST)
    sync_interval_minutes: int = DEFAULT_HEALTHPLANET_SYNC_INTERVAL_MINUTES


@dataclass
class FitbitConfig:
    enabled: bool = False
    config_file: str = "fitbit_config.json"


@dataclass
class HttpBridgeConfig:
    enabled: bool = True
    port: int = DEFAULT_HTTP_BRIDGE_PORT


@dataclass
class WebConfig:
    base_url: str = DEFAULT_WEB_BASE_URL


@dataclass
class ActivityCaptureConfig:
    enabled: bool = True
    initial_state: str = "active"
    poll_interval_seconds: int = DEFAULT_ACTIVITY_CAPTURE_POLL_INTERVAL_SECONDS
    sync_interval_seconds: int = DEFAULT_ACTIVITY_CAPTURE_SYNC_INTERVAL_SECONDS
    privacy_rules: list[dict] = field(default_factory=list)


@dataclass
class ActivityProcessingConfig:
    enabled: bool = True
    provider: str = "openai"
    base_url: str = DEFAULT_OLLAMA_BASE_URL
    model: str = "gpt-5-nano"
    max_completion_tokens: int = DEFAULT_ACTIVITY_PROCESSING_MAX_COMPLETION_TOKENS


@dataclass
class AppConfig:
    openai: OpenAIConfig = field(default_factory=OpenAIConfig)
    desktop: DesktopConfig = field(default_factory=DesktopConfig)
    cognito: CognitoConfig = field(default_factory=CognitoConfig)
    annict: AnnictConfig = field(default_factory=AnnictConfig)
    rakuten: RakutenConfig = field(default_factory=RakutenConfig)
    chat: ChatConfig = field(default_factory=ChatConfig)
    voice: VoiceConfig = field(default_factory=VoiceConfig)
    tts: TTSConfig = field(default_factory=TTSConfig)
    camera: CameraConfig = field(default_factory=CameraConfig)
    display: DisplayConfig = field(default_factory=DisplayConfig)
    talk_seeds: TalkSeedsConfig = field(default_factory=TalkSeedsConfig)
    healthplanet: HealthPlanetConfig = field(default_factory=HealthPlanetConfig)
    fitbit: FitbitConfig = field(default_factory=FitbitConfig)
    http_bridge: HttpBridgeConfig = field(default_factory=HttpBridgeConfig)
    web: WebConfig = field(default_factory=WebConfig)
    activity_capture: ActivityCaptureConfig = field(default_factory=ActivityCaptureConfig)
    activity_processing: ActivityProcessingConfig = field(default_factory=ActivityProcessingConfig)


def load_config(path: Path = _CONFIG_PATH) -> AppConfig:
    # config.yaml からモデル名・表示設定を読み込み
    raw: dict = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

    openai_raw = raw.get("openai", {}) or {}
    if not isinstance(openai_raw, dict):
        openai_raw = {}
    else:
        openai_raw = dict(openai_raw)

    display_raw = raw.get("display", {}) or {}
    if not isinstance(display_raw, dict):
        display_raw = {}
    else:
        display_raw = dict(display_raw)
    display_raw["user_balloon_display_seconds"] = normalize_user_balloon_display_seconds(
        display_raw.get("user_balloon_display_seconds", DEFAULT_USER_BALLOON_DISPLAY_SECONDS)
    )
    healthplanet_raw = raw.get("healthplanet", {}) or {}
    if not isinstance(healthplanet_raw, dict):
        healthplanet_raw = {}
    else:
        healthplanet_raw = dict(healthplanet_raw)
    healthplanet_raw["sync_interval_minutes"] = normalize_healthplanet_sync_interval_minutes(
        healthplanet_raw.get(
            "sync_interval_minutes",
            DEFAULT_HEALTHPLANET_SYNC_INTERVAL_MINUTES,
        )
    )
    http_bridge_raw = raw.get("http_bridge", {}) or {}
    if not isinstance(http_bridge_raw, dict):
        http_bridge_raw = {}
    else:
        http_bridge_raw = dict(http_bridge_raw)
    http_bridge_raw["port"] = normalize_http_bridge_port(
        http_bridge_raw.get("port", DEFAULT_HTTP_BRIDGE_PORT)
    )
    web_raw = raw.get("web", {}) or {}
    if not isinstance(web_raw, dict):
        web_raw = {}
    else:
        web_raw = dict(web_raw)
    web_raw["base_url"] = normalize_web_base_url(
        web_raw.get("base_url", DEFAULT_WEB_BASE_URL)
    )
    activity_capture_raw = raw.get("activity_capture", {}) or {}
    if not isinstance(activity_capture_raw, dict):
        activity_capture_raw = {}
    else:
        activity_capture_raw = dict(activity_capture_raw)
    activity_capture_raw["initial_state"] = normalize_activity_capture_state(
        activity_capture_raw.get("initial_state", "active")
    )
    activity_capture_raw["poll_interval_seconds"] = normalize_activity_capture_poll_interval_seconds(
        activity_capture_raw.get(
            "poll_interval_seconds",
            DEFAULT_ACTIVITY_CAPTURE_POLL_INTERVAL_SECONDS,
        )
    )
    activity_capture_raw["sync_interval_seconds"] = normalize_activity_capture_sync_interval_seconds(
        activity_capture_raw.get(
            "sync_interval_seconds",
            DEFAULT_ACTIVITY_CAPTURE_SYNC_INTERVAL_SECONDS,
        )
    )
    activity_capture_raw["privacy_rules"] = normalize_activity_capture_privacy_rules(
        activity_capture_raw.get("privacy_rules", [])
    )
    activity_processing_raw = raw.get("activity_processing", {}) or {}
    if not isinstance(activity_processing_raw, dict):
        activity_processing_raw = {}
    else:
        activity_processing_raw = dict(activity_processing_raw)
    activity_processing_raw["provider"] = normalize_ai_provider(
        activity_processing_raw.get("provider", "openai")
    )
    activity_processing_raw["base_url"] = normalize_ai_base_url(
        activity_processing_raw.get("base_url", DEFAULT_OLLAMA_BASE_URL)
    )
    activity_processing_raw["max_completion_tokens"] = (
        normalize_activity_processing_max_completion_tokens(
            activity_processing_raw.get(
                "max_completion_tokens",
                DEFAULT_ACTIVITY_PROCESSING_MAX_COMPLETION_TOKENS,
            )
        )
    )
    camera_raw = raw.get("camera", {}) or {}
    if not isinstance(camera_raw, dict):
        camera_raw = {}
    else:
        camera_raw = dict(camera_raw)
    camera_raw["analysis_provider"] = normalize_ai_provider(
        camera_raw.get("analysis_provider", "openai")
    )
    camera_raw["analysis_base_url"] = normalize_ai_base_url(
        camera_raw.get("analysis_base_url", DEFAULT_OLLAMA_BASE_URL)
    )
    camera_raw["summary_provider"] = normalize_ai_provider(
        camera_raw.get("summary_provider", "openai")
    )
    camera_raw["summary_base_url"] = normalize_ai_base_url(
        camera_raw.get("summary_base_url", DEFAULT_OLLAMA_BASE_URL)
    )
    camera_raw["summary_max_completion_tokens"] = (
        normalize_camera_summary_max_completion_tokens(
            camera_raw.get(
                "summary_max_completion_tokens",
                DEFAULT_CAMERA_SUMMARY_MAX_COMPLETION_TOKENS,
            )
        )
    )
    desktop_raw = raw.get("desktop", {}) or {}
    if not isinstance(desktop_raw, dict):
        desktop_raw = {}
    else:
        desktop_raw = dict(desktop_raw)
    desktop_raw["analysis_provider"] = normalize_ai_provider(
        desktop_raw.get("analysis_provider", "openai")
    )
    desktop_raw["analysis_base_url"] = normalize_ai_base_url(
        desktop_raw.get("analysis_base_url", DEFAULT_OLLAMA_BASE_URL)
    )
    desktop_model = desktop_raw.get("analysis_model") or openai_raw.get(
        "screen_analysis_model",
        OpenAIConfig().screen_analysis_model,
    )
    desktop_raw["analysis_model"] = str(desktop_model)
    desktop_raw["level_watch_interval_minutes"] = (
        normalize_level_watch_interval_minutes(
            desktop_raw.get(
                "level_watch_interval_minutes",
                DEFAULT_LEVEL_WATCH_INTERVAL_MINUTES,
            )
        )
    )
    chat_raw = raw.get("chat", {}) or {}
    if not isinstance(chat_raw, dict):
        chat_raw = {}
    else:
        chat_raw = dict(chat_raw)
    chat_raw["auto_talk_skip_audible_domains"] = normalize_domain_list(
        chat_raw.get("auto_talk_skip_audible_domains"),
        default=DEFAULT_AUTO_TALK_SKIP_AUDIBLE_DOMAINS,
    )
    talk_seeds_raw = raw.get("talk_seeds", {}) or {}
    if not isinstance(talk_seeds_raw, dict):
        talk_seeds_raw = {}
    else:
        talk_seeds_raw = dict(talk_seeds_raw)
    talk_seeds_raw["memory_directory"] = normalize_memory_directory(
        talk_seeds_raw.get("memory_directory", DEFAULT_MEMORY_DIRECTORY),
        base_dir=path.parent,
    )

    config = AppConfig(
        openai=OpenAIConfig(**openai_raw),
        desktop=DesktopConfig(**desktop_raw),
        cognito=CognitoConfig(**raw.get("cognito", {})),
        annict=AnnictConfig(**raw.get("annict", {})),
        rakuten=RakutenConfig(**raw.get("rakuten", {})),
        chat=ChatConfig(**chat_raw),
        voice=VoiceConfig(**{k: v for k, v in raw.get("voice", {}).items() if k != "google_api_key"}),
        tts=TTSConfig(**{k: v for k, v in raw.get("tts", {}).items() if k != "gemini_api_key"}),
        camera=CameraConfig(**camera_raw),
        display=DisplayConfig(**display_raw),
        talk_seeds=TalkSeedsConfig(**talk_seeds_raw),
        healthplanet=HealthPlanetConfig(**healthplanet_raw),
        fitbit=FitbitConfig(**raw.get("fitbit", {})),
        http_bridge=HttpBridgeConfig(**http_bridge_raw),
        web=WebConfig(**web_raw),
        activity_capture=ActivityCaptureConfig(**activity_capture_raw),
        activity_processing=ActivityProcessingConfig(**activity_processing_raw),
    )

    # .env から秘密情報を上書き（.env の値を優先）
    env = _load_dotenv()
    if env.get("OPENAI_API_KEY"):
        config.openai.api_key = env["OPENAI_API_KEY"]
    if env.get("COGNITO_EMAIL"):
        config.cognito.email = env["COGNITO_EMAIL"]
    if env.get("COGNITO_PASSWORD"):
        config.cognito.password = env["COGNITO_PASSWORD"]
    if env.get("ANNICT_ACCESS_TOKEN"):
        config.annict.access_token = env["ANNICT_ACCESS_TOKEN"]
    if env.get("RAKUTEN_APPLICATION_ID"):
        config.rakuten.application_id = env["RAKUTEN_APPLICATION_ID"]
    if env.get("RAKUTEN_ACCESS_KEY"):
        config.rakuten.access_key = env["RAKUTEN_ACCESS_KEY"]
    if env.get("RAKUTEN_ORIGIN"):
        config.rakuten.origin = _normalize_origin(env["RAKUTEN_ORIGIN"])
    if env.get("GOOGLE_CLOUD_API_KEY"):
        config.voice.google_api_key = env["GOOGLE_CLOUD_API_KEY"]
    if env.get("GEMINI_API_KEY"):
        config.tts.gemini_api_key = env["GEMINI_API_KEY"]
    if env.get("HEALTHPLANET_CLIENT_ID"):
        config.healthplanet.client_id = env["HEALTHPLANET_CLIENT_ID"]
    if env.get("HEALTHPLANET_CLIENT_SECRET"):
        config.healthplanet.client_secret = env["HEALTHPLANET_CLIENT_SECRET"]
    if env.get("HEALTHPLANET_ACCESS_TOKEN"):
        config.healthplanet.access_token = env["HEALTHPLANET_ACCESS_TOKEN"]
    if env.get("HEALTHPLANET_TOKEN_EXPIRES_AT"):
        try:
            config.healthplanet.token_expires_at = int(env["HEALTHPLANET_TOKEN_EXPIRES_AT"])
        except ValueError:
            pass

    return config


def _normalize_origin(value: str) -> str:
    """Origin文字列を `scheme://host[:port]` に正規化する。"""
    raw = value.strip()
    if not raw:
        return ""
    parts = urlsplit(raw)
    if parts.scheme and parts.netloc:
        return f"{parts.scheme}://{parts.netloc}"
    return raw


def save_healthplanet_token(access_token: str, expires_at: int, path: Path = _ENV_PATH) -> None:
    """HEALTHPLANET_ACCESS_TOKEN / HEALTHPLANET_TOKEN_EXPIRES_AT を .env に書き込む（upsert）"""
    updates = {
        "HEALTHPLANET_ACCESS_TOKEN": access_token,
        "HEALTHPLANET_TOKEN_EXPIRES_AT": str(expires_at),
    }
    lines: list[str] = []
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines(keepends=True)

    written: set[str] = set()
    new_lines: list[str] = []
    for line in lines:
        key = line.partition("=")[0].strip()
        if key in updates:
            new_lines.append(f"{key}={updates[key]}\n")
            written.add(key)
        else:
            new_lines.append(line)

    for key, value in updates.items():
        if key not in written:
            new_lines.append(f"{key}={value}\n")

    path.write_text("".join(new_lines), encoding="utf-8")


def save_voice_device(device_name: str, path: Path = _CONFIG_PATH) -> None:
    """選択されたマイクデバイス名を config.yaml に保存する（コメント保持）"""
    if not path.exists():
        path.write_text(f"voice:\n  device_name: {device_name}\n", encoding="utf-8")
        return

    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    new_lines: list[str] = []
    in_voice = False
    device_written = False

    for line in lines:
        stripped = line.lstrip()
        indent = len(line) - len(stripped)

        # voice: セクションの検出
        if stripped.startswith("voice:") and indent == 0:
            in_voice = True
            new_lines.append(line)
            continue

        # voice セクション内
        if in_voice and indent > 0:
            if stripped.startswith("device_name:"):
                new_lines.append(f"  device_name: {device_name}\n")
                device_written = True
            else:
                new_lines.append(line)
            continue

        # voice セクション終了（次のトップレベルキーが来た）
        if in_voice and indent == 0 and not stripped.startswith("#"):
            if not device_written:
                new_lines.append(f"  device_name: {device_name}\n")
                device_written = True
            in_voice = False

        new_lines.append(line)

    # ファイル末尾まで voice セクションだった場合
    if in_voice and not device_written:
        new_lines.append(f"  device_name: {device_name}\n")

    path.write_text("".join(new_lines), encoding="utf-8")


def save_camera_device(device_name: str, path: Path = _CONFIG_PATH) -> None:
    """選択されたカメラデバイス名を config.yaml に保存する（コメント保持）"""
    if not path.exists():
        path.write_text(f"camera:\n  device_name: {device_name}\n", encoding="utf-8")
        return

    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    new_lines: list[str] = []
    in_camera = False
    device_written = False

    for line in lines:
        stripped = line.lstrip()
        indent = len(line) - len(stripped)

        if stripped.startswith("camera:") and indent == 0:
            in_camera = True
            new_lines.append(line)
            continue

        if in_camera and indent > 0:
            if stripped.startswith("device_name:"):
                new_lines.append(f"  device_name: {device_name}\n")
                device_written = True
            else:
                new_lines.append(line)
            continue

        if in_camera and indent == 0 and not stripped.startswith("#"):
            if not device_written:
                new_lines.append(f"  device_name: {device_name}\n")
                device_written = True
            in_camera = False

        new_lines.append(line)

    if in_camera and not device_written:
        new_lines.append(f"  device_name: {device_name}\n")

    path.write_text("".join(new_lines), encoding="utf-8")


def save_window_position(x: int, y: int, path: Path = _CONFIG_PATH) -> None:
    """ウィンドウ位置を config.yaml の display セクションに保存する（コメント保持）"""
    if not path.exists():
        path.write_text(
            f"display:\n  window_x: {x}\n  window_y: {y}\n", encoding="utf-8"
        )
        return

    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    new_lines: list[str] = []
    in_display = False
    x_written = False
    y_written = False

    for line in lines:
        stripped = line.lstrip()
        indent = len(line) - len(stripped)

        if stripped.startswith("display:") and indent == 0:
            in_display = True
            new_lines.append(line)
            continue

        if in_display and indent > 0:
            if stripped.startswith("window_x:"):
                new_lines.append(f"  window_x: {x}\n")
                x_written = True
            elif stripped.startswith("window_y:"):
                new_lines.append(f"  window_y: {y}\n")
                y_written = True
            else:
                new_lines.append(line)
            continue

        if in_display and indent == 0 and not stripped.startswith("#"):
            if not x_written:
                new_lines.append(f"  window_x: {x}\n")
            if not y_written:
                new_lines.append(f"  window_y: {y}\n")
            x_written = y_written = True
            in_display = False

        new_lines.append(line)

    if in_display and not (x_written and y_written):
        if not x_written:
            new_lines.append(f"  window_x: {x}\n")
        if not y_written:
            new_lines.append(f"  window_y: {y}\n")

    path.write_text("".join(new_lines), encoding="utf-8")
