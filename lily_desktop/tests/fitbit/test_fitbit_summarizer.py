"""fitbit.fitbit_summarizer のユニットテスト"""

import pytest
from fitbit.fitbit_summarizer import (
    summarize_activity,
    summarize_azm,
    summarize_heart,
    summarize_sleep,
)


# ---------------------------------------------------------------------------
# summarize_heart
# ---------------------------------------------------------------------------

def _heart_json(resting=62, zones=None, intraday_count=3):
    zones = zones if zones is not None else [
        {"name": "Out of Range", "min": 30, "max": 91, "minutes": 1200, "caloriesOut": 1300.5},
        {"name": "Fat Burn", "min": 91, "max": 127, "minutes": 100, "caloriesOut": 400.0},
    ]
    return {
        "activities-heart": [{"value": {"restingHeartRate": resting, "heartRateZones": zones}}],
        "activities-heart-intraday": {"dataset": [{"time": "00:00:00", "value": 60}] * intraday_count},
    }


def test_summarize_heart_正常系():
    result = summarize_heart(_heart_json())

    assert result["resting_heart_rate"] == 62
    assert len(result["heart_zones"]) == 2
    assert result["heart_zones"][0]["name"] == "Out of Range"
    assert result["heart_zones"][0]["calories_out"] == 1300.5
    assert result["intraday_points"] == 3


def test_summarize_heart_安静時心拍がない場合はNone():
    json = _heart_json()
    json["activities-heart"][0]["value"].pop("restingHeartRate")

    result = summarize_heart(json)

    assert result["resting_heart_rate"] is None


def test_summarize_heart_zones空():
    result = summarize_heart(_heart_json(zones=[]))

    assert result["heart_zones"] == []


def test_summarize_heart_intraday空():
    json = _heart_json()
    json["activities-heart-intraday"]["dataset"] = []

    result = summarize_heart(json)

    assert result["intraday_points"] == 0


def test_summarize_heart_activities_heart空():
    result = summarize_heart({"activities-heart": [], "activities-heart-intraday": {"dataset": []}})

    assert result["resting_heart_rate"] is None
    assert result["heart_zones"] == []
    assert result["intraday_points"] == 0


# ---------------------------------------------------------------------------
# summarize_azm
# ---------------------------------------------------------------------------

def _azm_json_dict(dataset=None, summary_count=1):
    dataset = dataset if dataset is not None else [{"time": "00:01:00", "value": 2}]
    return {
        "activities-active-zone-minutes-intraday": {"dataset": dataset},
        "activities-active-zone-minutes": [{"dateTime": "2026-04-04", "value": {}}] * summary_count,
    }


def test_summarize_azm_dict型_正常系():
    result = summarize_azm(_azm_json_dict(dataset=[{"value": 2}, {"value": 3}]))

    assert result["raw_type"] == "dict"
    assert result["intraday_points"] == 2
    assert result["minutes_total_estimate"] == 5.0
    assert result["summary_rows"] == 1


def test_summarize_azm_dict型_dataset空():
    result = summarize_azm(_azm_json_dict(dataset=[]))

    assert result["intraday_points"] == 0
    assert result["minutes_total_estimate"] is None


def test_summarize_azm_list型():
    result = summarize_azm([{"dateTime": "2026-04-04"}, {"dateTime": "2026-04-03"}])

    assert result["raw_type"] == "list"
    assert result["summary_rows"] == 2
    assert result["intraday_points"] == 0


def test_summarize_azm_空dict():
    result = summarize_azm({})

    assert result["intraday_points"] == 0
    assert result["minutes_total_estimate"] is None
    assert result["summary_rows"] == 0


# ---------------------------------------------------------------------------
# summarize_sleep
# ---------------------------------------------------------------------------

def _main_sleep(is_main=True, date="2026-04-04"):
    return {
        "isMainSleep": is_main,
        "dateOfSleep": date,
        "startTime": "2026-04-03T23:41:00.000",
        "endTime": "2026-04-04T06:58:00.000",
        "duration": 26220000,
        "minutesAsleep": 397,
        "minutesAwake": 40,
        "timeInBed": 437,
        "levels": {
            "summary": {
                "deep": {"minutes": 72},
                "light": {"minutes": 220},
                "rem": {"minutes": 105},
                "wake": {"minutes": 40},
            }
        },
    }


def test_summarize_sleep_isMainSleepあり():
    result = summarize_sleep({"sleep": [_main_sleep()]})

    ms = result["main_sleep"]
    assert ms["date_of_sleep"] == "2026-04-04"
    assert ms["minutes_asleep"] == 397
    assert ms["deep_minutes"] == 72
    assert ms["rem_minutes"] == 105
    assert result["all_sleep_count"] == 1


def test_summarize_sleep_isMainSleepなし_最初のレコードを使う():
    sleep1 = _main_sleep(is_main=False, date="2026-04-03")
    sleep2 = _main_sleep(is_main=False, date="2026-04-04")

    result = summarize_sleep({"sleep": [sleep1, sleep2]})

    assert result["main_sleep"]["date_of_sleep"] == "2026-04-03"
    assert result["all_sleep_count"] == 2


def test_summarize_sleep_複数レコードでisMainSleepを優先():
    non_main = _main_sleep(is_main=False, date="2026-04-03")
    main = _main_sleep(is_main=True, date="2026-04-04")

    result = summarize_sleep({"sleep": [non_main, main]})

    assert result["main_sleep"]["date_of_sleep"] == "2026-04-04"


def test_summarize_sleep_空():
    result = summarize_sleep({"sleep": []})

    assert result["main_sleep"] is None
    assert result["all_sleep_count"] == 0


# ---------------------------------------------------------------------------
# summarize_activity
# ---------------------------------------------------------------------------

def _ts(key, value):
    """time series 形式のレスポンスを生成する"""
    return {key: [{"dateTime": "2026-04-04", "value": value}]}


def test_summarize_activity_正常系():
    result = summarize_activity(
        steps_json=_ts("activities-steps", "8234"),
        distance_json=_ts("activities-distance", "5.91"),
        calories_json=_ts("activities-calories", "2143"),
        minutes_json={
            "very_active_minutes": _ts("activities-minutesVeryActive", "12"),
            "fairly_active_minutes": _ts("activities-minutesFairlyActive", "18"),
            "lightly_active_minutes": _ts("activities-minutesLightlyActive", "167"),
            "sedentary_minutes": _ts("activities-minutesSedentary", "843"),
        },
    )

    assert result["steps"] == 8234
    assert result["distance"] == 5.91
    assert result["calories"] == 2143
    assert result["very_active_minutes"] == 12
    assert result["fairly_active_minutes"] == 18
    assert result["lightly_active_minutes"] == 167
    assert result["sedentary_minutes"] == 843


def test_summarize_activity_stepsとcaloriesはint型():
    result = summarize_activity(
        steps_json=_ts("activities-steps", "8234"),
        distance_json=_ts("activities-distance", "5.91"),
        calories_json=_ts("activities-calories", "2143"),
        minutes_json={
            "very_active_minutes": _ts("activities-minutesVeryActive", "12"),
            "fairly_active_minutes": _ts("activities-minutesFairlyActive", "18"),
            "lightly_active_minutes": _ts("activities-minutesLightlyActive", "167"),
            "sedentary_minutes": _ts("activities-minutesSedentary", "843"),
        },
    )

    assert isinstance(result["steps"], int)
    assert isinstance(result["calories"], int)
    assert isinstance(result["distance"], float)
    assert isinstance(result["very_active_minutes"], int)


def test_summarize_activity_値なし():
    result = summarize_activity(
        steps_json={"activities-steps": []},
        distance_json={"activities-distance": []},
        calories_json={"activities-calories": []},
        minutes_json={
            "very_active_minutes": {"activities-minutesVeryActive": []},
            "fairly_active_minutes": {"activities-minutesFairlyActive": []},
            "lightly_active_minutes": {"activities-minutesLightlyActive": []},
            "sedentary_minutes": {"activities-minutesSedentary": []},
        },
    )

    assert result["steps"] is None
    assert result["distance"] is None
    assert result["calories"] is None
