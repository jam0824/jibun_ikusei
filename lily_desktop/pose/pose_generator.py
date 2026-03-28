"""ポーズ生成 — gpt-image-1.5 でリリィの不足ポーズを生成する"""

from __future__ import annotations

import asyncio
import base64
import logging
from pathlib import Path

import httpx

from core.constants import LILY_CHARACTER_SHEET, LILY_IMAGES_DIR
from pose.pose_manager import ALL_LILY_CATEGORIES, PoseManager

logger = logging.getLogger(__name__)

# カテゴリごとの生成中ロック（同一カテゴリの並行生成を防ぐ）
_generating: set[str] = set()

# カテゴリ → 生成プロンプトの表情・ポーズ指示
_CATEGORY_PROMPTS: dict[str, str] = {
    "default": "穏やかで自然な笑顔、リラックスした立ちポーズ",
    "joy": "満面の笑み、嬉しそうに両手を合わせている、幸せな表情",
    "anger": "頬を膨らませて怒った表情、腕を組んでいる、ぷんぷんしている",
    "sad": "悲しそうな表情、目がうるうるしている、肩を落としている",
    "fun": "楽しそうに笑っている、口を大きく開けて笑顔、ウキウキしている",
    "shy": "頬を赤らめて恥ずかしそうにしている、目をそらしている、照れ笑い",
    "worried": "心配そうな表情、眉をひそめている、手を胸に当てている",
    "surprised": "目を大きく見開いて驚いている、口を開けている、びっくりした表情",
    "proud": "自信満々の表情、胸を張っている、ドヤ顔、得意げ",
    "caring": "優しく微笑んでいる、手を差し伸べている、気遣いの表情",
    "serious": "真剣な目つき、集中した表情、決意を込めた顔",
    "sleepy": "眠そうにしている、目が半分閉じている、あくびをしている",
    "playful": "いたずらっぽい表情、ウィンクしている、舌を出している",
}


async def generate_pose(
    *,
    api_key: str,
    model: str,
    category: str,
    variation_index: int,
) -> bytes | None:
    """gpt-image-1.5 でリリィのポーズ画像を生成する。

    Args:
        api_key: OpenAI APIキー
        model: 画像生成モデル名 (例: "gpt-image-1.5")
        category: ポーズカテゴリ名
        variation_index: バリエーション番号（0-4）

    Returns:
        PNG画像のバイト列。失敗時はNone。
    """
    expression = _CATEGORY_PROMPTS.get(category, _CATEGORY_PROMPTS["default"])

    use_character_sheet = LILY_CHARACTER_SHEET.exists()

    prompt = (
        f"添付のキャラクターシートを参考に、同じキャラクターの立ち絵を1枚だけ生成してください。"
        f"重要: キャラクターは必ず1人だけ描いてください。複数人を描かないでください。"
        f"衣装・髪型・色はキャラクターシートに正確に合わせてください。"
        f"ネイビーのコルセット風トップス、金の装飾ライン、白いフリルの袖、"
        f"茶色のベルトとポーチ、ネイビーと白のスカート、ピンクの花の髪飾り。"
        f"構図: 画像の中央に1人のキャラクターだけを配置。腰から上のバストアップ。"
        f"表情とポーズ: {expression}。"
        f"背景は完全に透明。美少女ゲームの立ち絵スタイル。"
        f"高品質、アニメ調イラスト。"
    ) if use_character_sheet else (
        f"アニメ風の美少女キャラクター「リリィ」の立ち絵。腰から上のバストアップ。"
        f"白い髪、青い目、花の髪飾り、ダークブルーの衣装。"
        f"表情とポーズ: {expression}。"
        f"バリエーション{variation_index + 1}。"
        f"背景は完全に透明。美少女ゲームの立ち絵スタイル。"
        f"高品質、アニメ調イラスト。"
    )

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            if use_character_sheet:
                # /v1/images/edits でキャラクターシートを参照画像として送る
                sheet_bytes = LILY_CHARACTER_SHEET.read_bytes()
                resp = await client.post(
                    "https://api.openai.com/v1/images/edits",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                    },
                    data={
                        "model": model,
                        "prompt": prompt,
                        "n": "1",
                        "size": "1024x1536",
                        "quality": "high",
                        "background": "transparent",
                    },
                    files={
                        "image[]": ("lily_character_sheet.png", sheet_bytes, "image/png"),
                    },
                )
            else:
                # キャラクターシートなし — /v1/images/generations
                resp = await client.post(
                    "https://api.openai.com/v1/images/generations",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                    },
                    json={
                        "model": model,
                        "prompt": prompt,
                        "n": 1,
                        "size": "1024x1536",
                        "quality": "high",
                        "output_format": "png",
                        "background": "transparent",
                    },
                )

        if not resp.is_success:
            detail = resp.text[:300]
            logger.error("画像生成失敗: %d %s", resp.status_code, detail)
            return None

        payload = resp.json()
        image_data = payload["data"][0]

        # b64_json または url からデータ取得
        if "b64_json" in image_data:
            return base64.b64decode(image_data["b64_json"])
        elif "url" in image_data:
            async with httpx.AsyncClient(timeout=60.0) as client:
                img_resp = await client.get(image_data["url"])
                if img_resp.is_success:
                    return img_resp.content
            logger.error("生成画像URLのダウンロードに失敗")
            return None
        else:
            logger.error("画像生成レスポンスにデータがありません")
            return None

    except Exception:
        logger.exception("ポーズ画像の生成に失敗: category=%s", category)
        return None


async def ensure_pose(
    *,
    api_key: str,
    model: str,
    category: str,
    pose_mgr: PoseManager,
) -> None:
    """指定カテゴリのポーズが不足している場合、1枚生成してマップに追記する。

    会話のたびに呼ばれ、足りなければ1枚ずつ生成する。
    """
    if not pose_mgr.needs_generation(category):
        return

    # 同一カテゴリの並行生成を防ぐ
    if category in _generating:
        logger.debug("ポーズ生成中のためスキップ: category=%s", category)
        return
    _generating.add(category)

    try:
        current_count = pose_mgr.get_lily_category_count(category)
        variation_index = current_count  # 0-indexed

        logger.info(
            "ポーズ生成開始: category=%s variation=%d/%d",
            category, variation_index + 1, 5,
        )

        image_bytes = await generate_pose(
            api_key=api_key,
            model=model,
            category=category,
            variation_index=variation_index,
        )

        if image_bytes is None:
            logger.warning("ポーズ生成に失敗: category=%s", category)
            return

        # ファイル名を決定して保存
        filename = f"lily_{category}_{variation_index + 1:02d}.png"
        save_path = LILY_IMAGES_DIR / filename
        save_path.write_bytes(image_bytes)
        logger.info("ポーズ画像保存: %s (%d bytes)", save_path, len(image_bytes))

        # ポーズマップに追記
        description = _CATEGORY_PROMPTS.get(category, category)
        pose_mgr.add_lily_pose(category, filename, f"{description}（バリエーション{variation_index + 1}）")
    finally:
        _generating.discard(category)
