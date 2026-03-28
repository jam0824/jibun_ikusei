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


@dataclass
class DisplayConfig:
    lily_scale: float = 0.3
    haruka_scale: float = 0.7


@dataclass
class AppConfig:
    openai: OpenAIConfig = field(default_factory=OpenAIConfig)
    cognito: CognitoConfig = field(default_factory=CognitoConfig)
    annict: AnnictConfig = field(default_factory=AnnictConfig)
    chat: ChatConfig = field(default_factory=ChatConfig)
    voice: VoiceConfig = field(default_factory=VoiceConfig)
    display: DisplayConfig = field(default_factory=DisplayConfig)


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
        display=DisplayConfig(**raw.get("display", {})),
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
