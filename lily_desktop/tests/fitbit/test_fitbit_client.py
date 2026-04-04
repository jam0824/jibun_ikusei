"""fitbit.fitbit_client のユニットテスト"""

import base64
import json
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest
from fitbit.fitbit_client import FitbitClient


# ---------------------------------------------------------------------------
# フィクスチャ
# ---------------------------------------------------------------------------

def _make_config(tmp_path: Path) -> Path:
    config = {
        "client_id": "TEST_CLIENT_ID",
        "access_token": "ACCESS_TOKEN_INIT",
        "refresh_token": "REFRESH_TOKEN_INIT",
    }
    config_path = tmp_path / "fitbit_config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    return config_path


def _make_jwt_access_token(aud: str = "TEST_CLIENT_ID") -> str:
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "none"}).encode("utf-8")
    ).decode("ascii").rstrip("=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"aud": aud}).encode("utf-8")
    ).decode("ascii").rstrip("=")
    return f"{header}.{payload}.signature"


def _ok_response(body: dict) -> MagicMock:
    res = MagicMock()
    res.status_code = 200
    res.json.return_value = body
    res.text = json.dumps(body)
    return res


def _unauthorized_response() -> MagicMock:
    res = MagicMock()
    res.status_code = 401
    res.json.return_value = {"errors": [{"errorType": "expired_token"}]}
    res.text = '{"errors": [{"errorType": "expired_token"}]}'
    return res


def _refresh_response() -> MagicMock:
    res = MagicMock()
    res.status_code = 200
    res.json.return_value = {
        "access_token": "NEW_ACCESS_TOKEN",
        "refresh_token": "NEW_REFRESH_TOKEN",
    }
    return res


# ---------------------------------------------------------------------------
# 設定ファイルの読み書き
# ---------------------------------------------------------------------------

def test_設定ファイルを読み込める(tmp_path):
    config_path = _make_config(tmp_path)
    client = FitbitClient(config_path)

    assert client._config["access_token"] == "ACCESS_TOKEN_INIT"
    assert client._config["client_id"] == "TEST_CLIENT_ID"


def test_legacy_config_without_client_id_recovers_from_access_token(tmp_path):
    config = {
        "access_token": _make_jwt_access_token("RECOVERED_CLIENT_ID"),
        "refresh_token": "REFRESH_TOKEN_INIT",
    }
    config_path = tmp_path / "fitbit_config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")

    client = FitbitClient(config_path)

    assert client._config["client_id"] == "RECOVERED_CLIENT_ID"
    saved = json.loads(config_path.read_text(encoding="utf-8"))
    assert saved["client_id"] == "RECOVERED_CLIENT_ID"


def test_missing_client_id_and_unrecoverable_access_token_raises_value_error(tmp_path):
    config = {
        "access_token": "not-a-jwt",
        "refresh_token": "REFRESH_TOKEN_INIT",
    }
    config_path = tmp_path / "fitbit_config.json"
    config_path.write_text(json.dumps(config), encoding="utf-8")

    with pytest.raises(ValueError, match="client_id"):
        FitbitClient(config_path)


# ---------------------------------------------------------------------------
# token refresh
# ---------------------------------------------------------------------------

def test_401時にrefreshが実行される(tmp_path):
    config_path = _make_config(tmp_path)
    client = FitbitClient(config_path)

    with patch("fitbit.fitbit_client.requests") as mock_requests:
        mock_requests.get.side_effect = [
            _unauthorized_response(),
            _ok_response({"activities-heart": []}),
        ]
        mock_requests.post.return_value = _refresh_response()

        client._api_get("https://api.fitbit.com/1/user/-/activities/heart/date/2026-04-04/1d/1min.json")

        assert mock_requests.post.call_count == 1
        assert mock_requests.get.call_count == 2


def test_200時はrefreshが実行されない(tmp_path):
    config_path = _make_config(tmp_path)
    client = FitbitClient(config_path)

    with patch("fitbit.fitbit_client.requests") as mock_requests:
        mock_requests.get.return_value = _ok_response({"activities-heart": []})

        client._api_get("https://api.fitbit.com/1/user/-/activities/heart/date/2026-04-04/1d/1min.json")

        mock_requests.post.assert_not_called()
        assert mock_requests.get.call_count == 1


def test_refresh後にconfig_fileが上書き保存される(tmp_path):
    config_path = _make_config(tmp_path)
    client = FitbitClient(config_path)

    with patch("fitbit.fitbit_client.requests") as mock_requests:
        mock_requests.get.side_effect = [
            _unauthorized_response(),
            _ok_response({}),
        ]
        mock_requests.post.return_value = _refresh_response()

        client._api_get("https://api.fitbit.com/dummy")

        saved = json.loads(config_path.read_text(encoding="utf-8"))
        assert saved["access_token"] == "NEW_ACCESS_TOKEN"
        assert saved["refresh_token"] == "NEW_REFRESH_TOKEN"


def test_refresh失敗時にExceptionが送出される(tmp_path):
    config_path = _make_config(tmp_path)
    client = FitbitClient(config_path)

    fail_res = MagicMock()
    fail_res.status_code = 400
    fail_res.json.return_value = {"error": "invalid_grant"}

    with patch("fitbit.fitbit_client.requests") as mock_requests:
        mock_requests.get.return_value = _unauthorized_response()
        mock_requests.post.return_value = fail_res

        with pytest.raises(Exception, match="Refresh failed"):
            client._api_get("https://api.fitbit.com/dummy")


# ---------------------------------------------------------------------------
# 各エンドポイント URL
# ---------------------------------------------------------------------------

def _assert_url_called(mock_get, expected_fragment: str):
    """mock_requests.get が期待する URL フラグメントを含むURLで呼ばれたことを検証する。"""
    called_url = mock_get.call_args_list[0][0][0]
    assert expected_fragment in called_url, f"{expected_fragment!r} not in {called_url!r}"


def test_get_heart_rate_正しいURLを呼ぶ(tmp_path):
    config_path = _make_config(tmp_path)
    client = FitbitClient(config_path)

    with patch("fitbit.fitbit_client.requests") as mock_requests:
        mock_requests.get.return_value = _ok_response({"activities-heart": []})
        client.get_heart_rate("2026-04-04")

    _assert_url_called(mock_requests.get, "/activities/heart/date/2026-04-04/")


def test_get_active_zone_minutes_正しいURLを呼ぶ(tmp_path):
    config_path = _make_config(tmp_path)
    client = FitbitClient(config_path)

    with patch("fitbit.fitbit_client.requests") as mock_requests:
        mock_requests.get.return_value = _ok_response({})
        client.get_active_zone_minutes("2026-04-04")

    _assert_url_called(mock_requests.get, "/activities/active-zone-minutes/date/2026-04-04/")


def test_get_sleep_正しいURLを呼ぶ(tmp_path):
    config_path = _make_config(tmp_path)
    client = FitbitClient(config_path)

    with patch("fitbit.fitbit_client.requests") as mock_requests:
        mock_requests.get.return_value = _ok_response({"sleep": []})
        client.get_sleep("2026-04-04")

    _assert_url_called(mock_requests.get, "/sleep/date/2026-04-04")


def test_get_activity_steps_正しいURLを呼ぶ(tmp_path):
    config_path = _make_config(tmp_path)
    client = FitbitClient(config_path)

    with patch("fitbit.fitbit_client.requests") as mock_requests:
        mock_requests.get.return_value = _ok_response({"activities-steps": []})
        client.get_activity("2026-04-04")

    urls = [c[0][0] for c in mock_requests.get.call_args_list]
    assert any("/activities/steps/date/2026-04-04/" in u for u in urls)


def test_get_activity_日付がURLに埋め込まれる(tmp_path):
    config_path = _make_config(tmp_path)
    client = FitbitClient(config_path)

    with patch("fitbit.fitbit_client.requests") as mock_requests:
        mock_requests.get.return_value = _ok_response({"activities-steps": []})
        client.get_activity("2026-01-15")

    urls = [c[0][0] for c in mock_requests.get.call_args_list]
    assert all("2026-01-15" in u for u in urls)
