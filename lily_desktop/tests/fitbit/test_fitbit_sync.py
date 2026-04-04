"""fitbit.fitbit_sync のユニットテスト"""

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fitbit.fitbit_sync import FitbitSync


# ---------------------------------------------------------------------------
# フィクスチャ
# ---------------------------------------------------------------------------

def _make_client():
    client = MagicMock()
    client.get_heart_rate.return_value = {"activities-heart": [{"value": {"restingHeartRate": 62, "heartRateZones": []}}], "activities-heart-intraday": {"dataset": []}}
    client.get_active_zone_minutes.return_value = {"activities-active-zone-minutes-intraday": {"dataset": []}, "activities-active-zone-minutes": []}
    client.get_sleep.return_value = {"sleep": []}
    client.get_activity.return_value = {
        "steps": {"activities-steps": [{"value": "8234"}]},
        "distance": {"activities-distance": [{"value": "5.91"}]},
        "calories": {"activities-calories": [{"value": "2143"}]},
        "very_active_minutes": {"activities-minutesVeryActive": [{"value": "12"}]},
        "fairly_active_minutes": {"activities-minutesFairlyActive": [{"value": "18"}]},
        "lightly_active_minutes": {"activities-minutesLightlyActive": [{"value": "167"}]},
        "sedentary_minutes": {"activities-minutesSedentary": [{"value": "843"}]},
    }
    return client


def _make_api():
    api = AsyncMock()
    api.post_fitbit_data = AsyncMock(return_value={"saved": "2026-04-04"})
    return api


def _make_sync(client=None, api=None):
    return FitbitSync(
        client=client or _make_client(),
        api_client=api or _make_api(),
    )


# ---------------------------------------------------------------------------
# 3日分のループ
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_3日分のループが実行される():
    client = _make_client()
    api = _make_api()
    sync = FitbitSync(client=client, api_client=api)

    with patch("fitbit.fitbit_sync._today_jst", return_value="2026-04-04"):
        await sync.run()

    assert client.get_heart_rate.call_count == 3
    assert api.post_fitbit_data.call_count == 3


@pytest.mark.asyncio
async def test_対象日が当日_前日_前々日():
    client = _make_client()
    api = _make_api()
    sync = FitbitSync(client=client, api_client=api)

    with patch("fitbit.fitbit_sync._today_jst", return_value="2026-04-04"):
        await sync.run()

    saved_dates = [call.args[0]["date"] for call in api.post_fitbit_data.call_args_list]
    assert "2026-04-04" in saved_dates
    assert "2026-04-03" in saved_dates
    assert "2026-04-02" in saved_dates


# ---------------------------------------------------------------------------
# エラーハンドリング
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_1日分のAPI失敗時に他の日が継続される():
    client = _make_client()
    # 2回目の呼び出し（前日）だけ失敗させる
    client.get_heart_rate.side_effect = [
        {"activities-heart": [], "activities-heart-intraday": {"dataset": []}},
        Exception("API error"),
        {"activities-heart": [], "activities-heart-intraday": {"dataset": []}},
    ]
    api = _make_api()
    sync = FitbitSync(client=client, api_client=api)

    with patch("fitbit.fitbit_sync._today_jst", return_value="2026-04-04"):
        await sync.run()  # 例外が上がらないこと

    # 失敗した日を除く2日分だけ保存される
    assert api.post_fitbit_data.call_count == 2


@pytest.mark.asyncio
async def test_全件失敗でも例外が上がらない():
    client = _make_client()
    client.get_heart_rate.side_effect = Exception("network error")
    api = _make_api()
    sync = FitbitSync(client=client, api_client=api)

    with patch("fitbit.fitbit_sync._today_jst", return_value="2026-04-04"):
        await sync.run()  # 例外が上がらないこと

    assert api.post_fitbit_data.call_count == 0


@pytest.mark.asyncio
async def test_upsert失敗時に他の日が継続される():
    client = _make_client()
    api = _make_api()
    # 最初のupsertだけ失敗
    api.post_fitbit_data.side_effect = [
        Exception("DynamoDB error"),
        {"saved": "2026-04-03"},
        {"saved": "2026-04-02"},
    ]
    sync = FitbitSync(client=client, api_client=api)

    with patch("fitbit.fitbit_sync._today_jst", return_value="2026-04-04"):
        await sync.run()

    assert api.post_fitbit_data.call_count == 3


# ---------------------------------------------------------------------------
# raw JSON 保存
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_summary化失敗時にraw_jsonが保存される(tmp_path):
    client = _make_client()
    # get_sleep が壊れたレスポンスを返す → summary化失敗
    client.get_sleep.return_value = None  # NoneをsleepAPIレスポンスとして返す
    api = _make_api()
    sync = FitbitSync(client=client, api_client=api, raw_log_dir=tmp_path)

    with patch("fitbit.fitbit_sync._today_jst", return_value="2026-04-04"):
        await sync.run()

    # 失敗した日の raw ファイルが保存されていること
    raw_files = list(tmp_path.glob("fitbit_raw_*.json"))
    assert len(raw_files) > 0
