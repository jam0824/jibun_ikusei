"""Fitbit API レスポンスを日次サマリーに整形するユーティリティ"""

from __future__ import annotations


def summarize_heart(heart_json: dict) -> dict:
    """心拍 API レスポンスをサマリーに整形する。"""
    summary: dict = {
        "resting_heart_rate": None,
        "heart_zones": [],
        "intraday_points": 0,
    }

    activities_heart = heart_json.get("activities-heart", [])
    if activities_heart:
        value = activities_heart[0].get("value", {})
        summary["resting_heart_rate"] = value.get("restingHeartRate")

        for zone in value.get("heartRateZones", []):
            summary["heart_zones"].append({
                "name": zone.get("name"),
                "min": zone.get("min"),
                "max": zone.get("max"),
                "minutes": zone.get("minutes"),
                "calories_out": zone.get("caloriesOut"),
            })

    intraday = heart_json.get("activities-heart-intraday", {}).get("dataset", [])
    summary["intraday_points"] = len(intraday)

    return summary


def summarize_azm(azm_json: dict | list) -> dict:
    """Active Zone Minutes API レスポンスをサマリーに整形する。

    dict / list どちらのレスポンス形式にも対応する。
    0 と未取得（null）を明確に区別する。
    """
    out: dict = {
        "raw_type": type(azm_json).__name__,
        "intraday_points": 0,
        "minutes_total_estimate": None,
        "summary_rows": 0,
    }

    dataset: list = []

    if isinstance(azm_json, dict):
        intraday_block = azm_json.get("activities-active-zone-minutes-intraday", {})
        if isinstance(intraday_block, dict):
            dataset = intraday_block.get("dataset", [])

        summary_block = azm_json.get("activities-active-zone-minutes", [])
        if isinstance(summary_block, list):
            out["summary_rows"] = len(summary_block)

    elif isinstance(azm_json, list):
        out["summary_rows"] = len(azm_json)

    out["intraday_points"] = len(dataset)

    total = 0.0
    found = False
    for row in dataset:
        value = row.get("value")
        if isinstance(value, (int, float)):
            total += value
            found = True
        elif isinstance(value, str):
            try:
                total += float(value)
                found = True
            except ValueError:
                pass
        elif isinstance(value, dict):
            for key in ("activeZoneMinutes", "minutes", "value"):
                v = value.get(key)
                if isinstance(v, (int, float)):
                    total += v
                    found = True
                    break
                if isinstance(v, str):
                    try:
                        total += float(v)
                        found = True
                        break
                    except ValueError:
                        pass

    if found:
        out["minutes_total_estimate"] = total

    return out


def summarize_sleep(sleep_json: dict) -> dict:
    """睡眠 API レスポンスをサマリーに整形する。"""
    result: dict = {
        "main_sleep": None,
        "all_sleep_count": 0,
    }

    sleeps = sleep_json.get("sleep", [])
    result["all_sleep_count"] = len(sleeps)

    main_sleep = None
    for item in sleeps:
        if item.get("isMainSleep"):
            main_sleep = item
            break

    if main_sleep is None and sleeps:
        main_sleep = sleeps[0]

    if main_sleep:
        levels_summary = main_sleep.get("levels", {}).get("summary", {})
        result["main_sleep"] = {
            "date_of_sleep": main_sleep.get("dateOfSleep"),
            "start_time": main_sleep.get("startTime"),
            "end_time": main_sleep.get("endTime"),
            "duration_ms": main_sleep.get("duration"),
            "minutes_asleep": main_sleep.get("minutesAsleep"),
            "minutes_awake": main_sleep.get("minutesAwake"),
            "time_in_bed": main_sleep.get("timeInBed"),
            "deep_minutes": levels_summary.get("deep", {}).get("minutes"),
            "light_minutes": levels_summary.get("light", {}).get("minutes"),
            "rem_minutes": levels_summary.get("rem", {}).get("minutes"),
            "wake_minutes": levels_summary.get("wake", {}).get("minutes"),
        }

    return result


def summarize_activity(
    steps_json: dict,
    distance_json: dict,
    calories_json: dict,
    minutes_json: dict,
) -> dict:
    """活動系 API レスポンス群をサマリーに整形する。

    steps / calories は int、distance は float に変換する。
    値が取得できない場合は None を返す。
    """
    def _extract(data: dict, key: str) -> str | None:
        series = data.get(key, [])
        if series and isinstance(series, list):
            return series[0].get("value")
        return None

    def _to_int(v: str | None) -> int | None:
        if v is None:
            return None
        try:
            return int(v)
        except (ValueError, TypeError):
            return None

    def _to_float(v: str | None) -> float | None:
        if v is None:
            return None
        try:
            return float(v)
        except (ValueError, TypeError):
            return None

    return {
        "steps": _to_int(_extract(steps_json, "activities-steps")),
        "distance": _to_float(_extract(distance_json, "activities-distance")),
        "calories": _to_int(_extract(calories_json, "activities-calories")),
        "very_active_minutes": _to_int(
            _extract(minutes_json["very_active_minutes"], "activities-minutesVeryActive")
        ),
        "fairly_active_minutes": _to_int(
            _extract(minutes_json["fairly_active_minutes"], "activities-minutesFairlyActive")
        ),
        "lightly_active_minutes": _to_int(
            _extract(minutes_json["lightly_active_minutes"], "activities-minutesLightlyActive")
        ),
        "sedentary_minutes": _to_int(
            _extract(minutes_json["sedentary_minutes"], "activities-minutesSedentary")
        ),
    }
