from pathlib import Path

from core.config import SYS_DIR

# アセットパス
LILY_IMAGES_DIR = SYS_DIR / "lily_images"
AIKATA_IMAGES_DIR = SYS_DIR / "aikata_images"
SYS_IMAGES_DIR = SYS_DIR / "sys_images"

LILY_DEFAULT_IMAGE = LILY_IMAGES_DIR / "lily_default.png"
HARUKA_DEFAULT_IMAGE = AIKATA_IMAGES_DIR / "05_saigusa_haruka01.png"
MESSAGE_WINDOW_IMAGE = SYS_IMAGES_DIR / "message_window.png"
LILY_CHARACTER_SHEET = LILY_IMAGES_DIR / "lily_character_sheet.png"

# API
API_BASE_URL = "https://kzt5678s5b.execute-api.ap-northeast-1.amazonaws.com"
COGNITO_USER_POOL_ID = "ap-northeast-1_sdcbFbWBY"
COGNITO_CLIENT_ID = "4vcj0n0b0b55354k29frt2q6ku"
COGNITO_REGION = "ap-northeast-1"

# 会話
MAX_HISTORY_MESSAGES = 30
BALLOON_DISPLAY_SECONDS = 8
