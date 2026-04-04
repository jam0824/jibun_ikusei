"""tool_executor の get_fitbit_data ツールのユニットテスト"""

import pytest
from unittest.mock import AsyncMock
from ai.tool_executor import ToolExecutor


# ---------------------------------------------------------------------------
# フィクスチャ
# ---------------------------------------------------------------------------

def _make_executor(fitbit_records=None):
    api = AsyncMock()
    api.get_fitbit_data = AsyncMock(return_value=fitbit_records or [])
    return ToolExecutor(api)


SAMPLE_RECORD = {
    "date": "2026-04-04",
    "heart": {
        "resting_heart_rate": 62,
        "intraday_points": 1440,
        "heart_zones": [],
    },
    "active_zone_minutes": {
        "intraday_points": 60,
        "minutes_total_estimate": 45.0,
        "summary_rows": 1,
    },
    "sleep": {
        "main_sleep": {
            "start_time": "2026-04-03T23:41:00.000",
            "end_time": "2026-04-04T06:58:00.000",
            "minutes_asleep": 397,
            "deep_minutes": 72,
            "light_minutes": 220,
            "rem_minutes": 105,
            "wake_minutes": 40,
        },
        "all_sleep_count": 1,
    },
    "activity": {
        "steps": 8234,
        "distance": 5.91,
        "calories": 2143,
        "very_active_minutes": 12,
        "fairly_active_minutes": 18,
        "lightly_active_minutes": 167,
        "sedentary_minutes": 843,
    },
}


# ---------------------------------------------------------------------------
# データなし
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_データなし時に適切なメッセージが返る():
    executor = _make_executor(fitbit_records=[])
    result = await executor.execute("get_fitbit_data", {"period": "week"})
    assert "ありません" in result


# ---------------------------------------------------------------------------
# data_type 別テキスト整形
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_data_type_sleep_で睡眠情報が含まれる():
    executor = _make_executor([SAMPLE_RECORD])
    result = await executor.execute("get_fitbit_data", {"period": "week", "data_type": "sleep"})
    assert "睡眠" in result
    assert "397" in result  # minutes_asleep


@pytest.mark.asyncio
async def test_data_type_sleep_で心拍情報は含まれない():
    executor = _make_executor([SAMPLE_RECORD])
    result = await executor.execute("get_fitbit_data", {"period": "week", "data_type": "sleep"})
    assert "安静時心拍" not in result


@pytest.mark.asyncio
async def test_data_type_activity_で活動情報が含まれる():
    executor = _make_executor([SAMPLE_RECORD])
    result = await executor.execute("get_fitbit_data", {"period": "week", "data_type": "activity"})
    assert "8234" in result  # steps
    assert "2143" in result  # calories


@pytest.mark.asyncio
async def test_data_type_heart_で心拍情報が含まれる():
    executor = _make_executor([SAMPLE_RECORD])
    result = await executor.execute("get_fitbit_data", {"period": "week", "data_type": "heart"})
    assert "62" in result  # resting_heart_rate
    assert "1440" in result  # intraday_points


@pytest.mark.asyncio
async def test_data_type_azm_でAZM情報が含まれる():
    executor = _make_executor([SAMPLE_RECORD])
    result = await executor.execute("get_fitbit_data", {"period": "week", "data_type": "azm"})
    assert "45" in result  # minutes_total_estimate


@pytest.mark.asyncio
async def test_data_type_all_で全項目が含まれる():
    executor = _make_executor([SAMPLE_RECORD])
    result = await executor.execute("get_fitbit_data", {"period": "week", "data_type": "all"})
    assert "62" in result       # heart
    assert "397" in result      # sleep
    assert "8234" in result     # activity
    assert "45" in result       # azm


@pytest.mark.asyncio
async def test_data_type省略時はallと同じ():
    executor = _make_executor([SAMPLE_RECORD])
    result = await executor.execute("get_fitbit_data", {"period": "week"})
    assert "62" in result
    assert "397" in result
    assert "8234" in result


# ---------------------------------------------------------------------------
# 日付フィルタ
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_periodが正しくAPIに渡される():
    api = AsyncMock()
    api.get_fitbit_data = AsyncMock(return_value=[])
    executor = ToolExecutor(api)

    await executor.execute("get_fitbit_data", {"date": "2026-04-04"})

    api.get_fitbit_data.assert_awaited_once_with("2026-04-04", "2026-04-04")


@pytest.mark.asyncio
async def test_不正な日付でエラーメッセージが返る():
    executor = _make_executor()
    result = await executor.execute("get_fitbit_data", {"fromDate": "2026-04-10", "toDate": "2026-04-01"})
    # エラーメッセージが文字列で返る（例外は上がらない）
    assert isinstance(result, str)
