from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

_BASE_DIR = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _BASE_DIR.parent  # 自分育成アプリ/
_CONFIG_PATH = _BASE_DIR / "config.yaml"
_ENV_PATH = _PROJECT_ROOT / ".env"
SYS_DIR = _BASE_DIR / "sys"


def _load_dotenv(path: Path = _ENV_PATH) -> dict[str, str]:
    """シンプルな .env パーサー（KEY=VALUE 形式）"""
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


@dataclass
class OpenAIConfig:
    api_key: str = ""
    chat_model: str = "gpt-5.4"
    image_model: str = "gpt-image-1.5"
    screen_analysis_model: str = "gpt-5.4"


@dataclass
class CognitoConfig:
    email: str = ""
    password: str = ""


@dataclass
class AnnictConfig:
    access_token: str = ""


@dataclass
class ChatConfig:
    auto_talk_interval_minutes: int = 15
    auto_talk_min_turns: int = 3
    auto_talk_max_turns: int = 5
    follow_up_min_extra: int = 1
    follow_up_max_extra: int = 3


@dataclass
class VoiceConfig:
    enabled: bool = False
    vad_aggressiveness: int = 3       # 0-3, 3が最も厳格（ノイズに強い）
    vad_start_frames: int = 10        # 発話開始に必要な連続音声フレーム数（大きいほど誤検知しにくい）
    vad_end_frames: int = 30          # 発話終了と判定する連続無音フレーム数（大きいほど間を許容）
    language: str = "ja-JP"
    google_api_key: str = ""
    device_name: str = ""  # 選択されたマイクデバイス名（空=デフォルト）
    use_wake_words: bool = True  # ウェイクワードを使うかどうか（Falseなら全音声に応答）
    wake_words: list[str] = field(default_factory=lambda: ["リリィ", "リリー"])  # ウェイクワード
    wake_word_aliases: list[str] = field(default_factory=lambda: ["DD"])  # リリィに変換する誤認識パターン
    max_speech_seconds: float = 8.0  # 最大発話時間（秒）— これを超えると強制終了
    volume_threshold: int = 1500    # 音量閾値 — フレームのRMS振幅がこれ以下なら無視
    speaker_verification_enabled: bool = False  # 話者照合を使うかどうか
    speaker_profile_path: str = "speaker_profile.pt"  # 話者プロファイルのパス
    speaker_verification_threshold: float = 0.25  # 照合閾値（コサイン類似度）


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
    analysis_model: str = "gpt-5"  # カメラ画像分析AIモデル
    summary_model: str = "gpt-5.4"  # 30分要約AIモデル
    summary_interval_seconds: int = 1800  # サーバー要約間隔（秒）— デフォルト30分


@dataclass
class DisplayConfig:
    lily_scale: float = 0.3
    haruka_scale: float = 0.7
    window_x: int | None = None  # ウィンドウ位置X（Noneならデフォルト位置）
    window_y: int | None = None  # ウィンドウ位置Y


@dataclass
class TalkSeedsConfig:
    interest_topics: list[str] = field(default_factory=list)  # 豆知識で優先する興味ある分野


@dataclass
class AppConfig:
    openai: OpenAIConfig = field(default_factory=OpenAIConfig)
    cognito: CognitoConfig = field(default_factory=CognitoConfig)
    annict: AnnictConfig = field(default_factory=AnnictConfig)
    chat: ChatConfig = field(default_factory=ChatConfig)
    voice: VoiceConfig = field(default_factory=VoiceConfig)
    tts: TTSConfig = field(default_factory=TTSConfig)
    camera: CameraConfig = field(default_factory=CameraConfig)
    display: DisplayConfig = field(default_factory=DisplayConfig)
    talk_seeds: TalkSeedsConfig = field(default_factory=TalkSeedsConfig)


def load_config(path: Path = _CONFIG_PATH) -> AppConfig:
    # config.yaml からモデル名・表示設定を読み込み
    raw: dict = {}
    if path.exists():
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

    config = AppConfig(
        openai=OpenAIConfig(**raw.get("openai", {})),
        cognito=CognitoConfig(**raw.get("cognito", {})),
        annict=AnnictConfig(**raw.get("annict", {})),
        chat=ChatConfig(**raw.get("chat", {})),
        voice=VoiceConfig(**{k: v for k, v in raw.get("voice", {}).items() if k != "google_api_key"}),
        tts=TTSConfig(**{k: v for k, v in raw.get("tts", {}).items() if k != "gemini_api_key"}),
        camera=CameraConfig(**raw.get("camera", {})),
        display=DisplayConfig(**raw.get("display", {})),
        talk_seeds=TalkSeedsConfig(**raw.get("talk_seeds", {})),
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
    if env.get("GOOGLE_CLOUD_API_KEY"):
        config.voice.google_api_key = env["GOOGLE_CLOUD_API_KEY"]
    if env.get("GEMINI_API_KEY"):
        config.tts.gemini_api_key = env["GEMINI_API_KEY"]

    return config


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
