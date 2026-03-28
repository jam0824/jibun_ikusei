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
class DisplayConfig:
    lily_scale: float = 0.3
    haruka_scale: float = 0.7


@dataclass
class AppConfig:
    openai: OpenAIConfig = field(default_factory=OpenAIConfig)
    cognito: CognitoConfig = field(default_factory=CognitoConfig)
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

    return config
