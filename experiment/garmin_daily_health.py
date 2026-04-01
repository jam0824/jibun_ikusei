from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

JST = timezone(timedelta(hours=9))
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = PROJECT_ROOT / ".env"
TOKEN_DIR = Path(__file__).resolve().parent / ".garminconnect"
HOME_TOKEN_DIR = Path.home() / ".garminconnect"
RATE_LIMIT_FILE = TOKEN_DIR / "login_rate_limit_until.txt"


def load_dotenv(path: Path) -> dict[str, str]:
    """Load a simple KEY=VALUE .env file without extra dependencies."""
    env: dict[str, str] = {}
    if not path.exists():
        return env

    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, _, value = text.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Garmin Connect から指定日の健康データを取得します。",
    )
    parser.add_argument(
        "--date",
        help="対象日 (JST) を YYYY-MM-DD で指定します。未指定時は JST の今日です。",
    )
    parser.add_argument(
        "--json",
        dest="json_path",
        help="取得した生データを JSON で保存するパス。",
    )
    return parser.parse_args()


def load_env() -> dict[str, str]:
    return load_dotenv(ENV_PATH)


def get_target_date(date_text: str | None) -> str:
    if not date_text:
        return datetime.now(tz=JST).date().isoformat()

    try:
        return datetime.strptime(date_text, "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise SystemExit(f"--date は YYYY-MM-DD 形式で指定してください: {exc}") from exc


def get_env_credentials() -> tuple[str, str]:
    env = load_env()
    email = env.get("GARMIN_EMAIL") or env.get("GARMIN_USERNAME") or ""
    password = env.get("GARMIN_PASSWORD") or ""
    if email and password:
        return email, password

    message = (
        f"{ENV_PATH} に GARMIN_EMAIL と GARMIN_PASSWORD を設定してください。\n"
        "必要なら GARMIN_USERNAME でもログイン ID を指定できます。"
    )
    raise SystemExit(message)


def get_rate_limit_minutes() -> int:
    env = load_env()
    raw_value = env.get("GARMIN_RATE_LIMIT_MINUTES", "60")
    try:
        minutes = int(raw_value)
    except ValueError:
        return 60
    return max(minutes, 1)


def read_rate_limit_until() -> datetime | None:
    if not RATE_LIMIT_FILE.exists():
        return None

    text = RATE_LIMIT_FILE.read_text(encoding="utf-8").strip()
    if not text:
        return None

    try:
        blocked_until = datetime.fromisoformat(text)
    except ValueError:
        return None

    if blocked_until.tzinfo is None:
        blocked_until = blocked_until.replace(tzinfo=JST)
    return blocked_until.astimezone(JST)


def write_rate_limit_until(blocked_until: datetime) -> None:
    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    RATE_LIMIT_FILE.write_text(
        blocked_until.astimezone(JST).isoformat(),
        encoding="utf-8",
    )


def clear_rate_limit_marker() -> None:
    if RATE_LIMIT_FILE.exists():
        RATE_LIMIT_FILE.unlink()


def ensure_not_rate_limited() -> None:
    blocked_until = read_rate_limit_until()
    if blocked_until is None:
        return

    now = datetime.now(tz=JST)
    if now >= blocked_until:
        clear_rate_limit_marker()
        return

    raise SystemExit(
        "Garmin のログイン制限が継続中のため、再試行を止めています。\n"
        f"再試行目安 (JST): {blocked_until.strftime('%Y-%m-%d %H:%M:%S')}\n"
        "その時刻までは再実行せず待つのをおすすめします。"
    )


def handle_login_rate_limit(exc: Exception) -> None:
    message = str(exc)
    if "429" not in message and "Too Many Requests" not in message:
        raise SystemExit(message) from exc

    blocked_until = datetime.now(tz=JST) + timedelta(minutes=get_rate_limit_minutes())
    write_rate_limit_until(blocked_until)
    raise SystemExit(
        "Garmin のログイン制限 (HTTP 429) に到達しました。\n"
        f"再試行目安 (JST): {blocked_until.strftime('%Y-%m-%d %H:%M:%S')}\n"
        "少なくともこの時刻までは再実行せず待ってください。\n"
        "初回ログイン後は保存トークンを再利用するため、連続ログインは不要です。"
    ) from exc


def init_client(email: str, password: str):
    try:
        from garth.exc import GarthException, GarthHTTPError
        from garminconnect import (
            Garmin,
            GarminConnectAuthenticationError,
            GarminConnectConnectionError,
            GarminConnectTooManyRequestsError,
        )
    except ImportError as exc:
        raise SystemExit(
            "garminconnect が見つかりません。`uv run --with garminconnect --with curl_cffi "
            "python experiment/garmin_daily_health.py` で実行してください。"
        ) from exc

    TOKEN_DIR.mkdir(parents=True, exist_ok=True)

    for token_dir in (TOKEN_DIR, HOME_TOKEN_DIR):
        try:
            client = Garmin()
            client.login(str(token_dir))
            clear_rate_limit_marker()
            return client
        except (
            FileNotFoundError,
            GarminConnectAuthenticationError,
            GarminConnectConnectionError,
        ):
            pass
        except GarthHTTPError as exc:
            if "429" in str(exc) or "Too Many Requests" in str(exc):
                handle_login_rate_limit(exc)
            pass
        except GarminConnectTooManyRequestsError as exc:
            handle_login_rate_limit(exc)

    ensure_not_rate_limited()

    try:
        client = Garmin(
            email=email,
            password=password,
            is_cn=False,
            return_on_mfa=True,
        )
        result1, result2 = client.login()
        if result1 == "needs_mfa":
            mfa_code = input("Garmin の MFA コードを入力してください: ").strip()
            client.resume_login(result2, mfa_code)

        client.garth.dump(str(TOKEN_DIR))
        clear_rate_limit_marker()
        return client
    except GarminConnectTooManyRequestsError as exc:
        handle_login_rate_limit(exc)
    except GarminConnectAuthenticationError as exc:
        raise SystemExit(f"Garmin 認証に失敗しました: {exc}") from exc
    except GarminConnectConnectionError as exc:
        if "429" in str(exc) or "Too Many Requests" in str(exc):
            handle_login_rate_limit(exc)
        raise SystemExit(f"Garmin Connect へ接続できませんでした: {exc}") from exc
    except GarthException as exc:
        raise SystemExit(f"Garmin ログイン処理でエラーが発生しました: {exc}") from exc
    except GarthHTTPError as exc:
        if "429" in str(exc) or "Too Many Requests" in str(exc):
            handle_login_rate_limit(exc)
        raise SystemExit(f"Garmin HTTP エラーが発生しました: {exc}") from exc


def safe_api_call(client: Any, method_name: str, *args: Any) -> tuple[Any | None, str | None]:
    try:
        method = getattr(client, method_name)
        return method(*args), None
    except Exception as exc:  # pragma: no cover - external API wrapper
        return None, str(exc)


def build_report(client: Any, target_date: str) -> dict[str, Any]:
    methods = {
        "user_summary": "get_user_summary",
        "steps": "get_steps_data",
        "heart_rates": "get_heart_rates",
        "sleep": "get_sleep_data",
        "stress": "get_all_day_stress",
        "hrv": "get_hrv_data",
        "respiration": "get_respiration_data",
        "spo2": "get_spo2_data",
    }
    data: dict[str, Any] = {}
    errors: dict[str, str] = {}

    for key, method_name in methods.items():
        result, error = safe_api_call(client, method_name, target_date)
        if error:
            errors[key] = error
            continue
        data[key] = result

    return {
        "requested_date_jst": target_date,
        "fetched_at_jst": datetime.now(tz=JST).strftime("%Y-%m-%d %H:%M:%S"),
        "data": data,
        "errors": errors,
    }


def get_nested_value(source: dict[str, Any] | None, *keys: str) -> Any | None:
    current: Any = source
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def format_minutes(total_seconds: int | float | None) -> str:
    if total_seconds is None:
        return "-"
    minutes = int(total_seconds) // 60
    hours, remain_minutes = divmod(minutes, 60)
    return f"{hours}時間{remain_minutes}分"


def format_distance_km(meters: int | float | None) -> str:
    if meters is None:
        return "-"
    return f"{float(meters) / 1000:.2f} km"


def print_report(report: dict[str, Any]) -> None:
    target_date = report["requested_date_jst"]
    fetched_at = report["fetched_at_jst"]
    data = report["data"]
    errors = report["errors"]

    summary = data.get("user_summary") or {}
    heart_rates = data.get("heart_rates") or {}
    sleep = data.get("sleep") or {}
    stress = data.get("stress") or {}
    hrv = data.get("hrv") or {}
    respiration = data.get("respiration") or {}
    spo2 = data.get("spo2") or {}

    print(f"対象日 (JST): {target_date}")
    print(f"取得時刻 (JST): {fetched_at}")
    print("")
    print("[summary]")
    print(f"steps: {summary.get('totalSteps', '-')}")
    print(f"distance: {format_distance_km(summary.get('totalDistanceMeters'))}")
    print(f"calories: {summary.get('totalKilocalories', '-')}")
    print(f"floors: {summary.get('floorsClimbed', '-')}")
    print(f"resting_hr: {heart_rates.get('restingHeartRate', '-')}")
    print(f"max_hr: {heart_rates.get('maxHeartRate', '-')}")
    print(f"sleep: {format_minutes(get_nested_value(sleep, 'dailySleepDTO', 'sleepTimeSeconds'))}")
    print(f"stress_avg: {stress.get('overallStressLevel', '-')}")
    print(f"body_battery_recent: {get_nested_value(summary, 'bodyBatteryMostRecentValue', 'value') or '-'}")
    print(f"hrv_last_night_avg: {get_nested_value(hrv, 'hrvSummary', 'lastNightAvg') or '-'}")
    print(f"respiration_avg: {get_nested_value(respiration, 'respirationSummary', 'avgWakingRespirationValue') or '-'}")
    print(f"spo2_avg: {get_nested_value(spo2, 'averageSpO2') or '-'}")

    if errors:
        print("")
        print("[partial_errors]")
        for key, message in errors.items():
            print(f"{key}: {message}")


def write_json(path_text: str, payload: dict[str, Any]) -> None:
    output_path = Path(path_text)
    if not output_path.is_absolute():
        output_path = PROJECT_ROOT / output_path
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("")
    print(f"JSON saved: {output_path}")


def main() -> int:
    args = parse_args()
    target_date = get_target_date(args.date)
    email, password = get_env_credentials()
    client = init_client(email, password)
    report = build_report(client, target_date)
    print_report(report)

    if args.json_path:
        write_json(args.json_path, report)

    return 0


if __name__ == "__main__":
    sys.exit(main())
