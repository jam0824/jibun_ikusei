from health.sync_policy import (
    WEIGHT_QUEST_CLEAR_MESSAGE,
    choose_healthplanet_sync_action,
    emit_weight_quest_clear_for_new_records,
    get_healthplanet_sync_interval_ms,
)


def test_emit_weight_quest_clear_for_new_records_uses_latest_record_only():
    emitted: list[str] = []
    latest = emit_weight_quest_clear_for_new_records(
        [
            {"date": "2026-04-02", "time": "07:00"},
            {"date": "2026-04-03", "time": "06:45"},
            {"date": "2026-04-03", "time": "08:10"},
        ],
        emitted.append,
    )

    assert latest == {"date": "2026-04-03", "time": "08:10"}
    assert emitted == [WEIGHT_QUEST_CLEAR_MESSAGE]


def test_emit_weight_quest_clear_for_new_records_does_not_emit_when_empty():
    emitted: list[str] = []

    latest = emit_weight_quest_clear_for_new_records([], emitted.append)

    assert latest is None
    assert emitted == []


def test_choose_healthplanet_sync_action_skips_periodic_sync_when_token_invalid():
    action = choose_healthplanet_sync_action(
        has_credentials=True,
        token_valid=False,
        interactive_auth=False,
        sync_in_progress=False,
    )

    assert action == "skip"


def test_choose_healthplanet_sync_action_requests_oauth_on_startup_when_token_invalid():
    action = choose_healthplanet_sync_action(
        has_credentials=True,
        token_valid=False,
        interactive_auth=True,
        sync_in_progress=False,
    )

    assert action == "oauth"


def test_choose_healthplanet_sync_action_skips_when_sync_already_running():
    action = choose_healthplanet_sync_action(
        has_credentials=True,
        token_valid=True,
        interactive_auth=True,
        sync_in_progress=True,
    )

    assert action == "skip"


def test_get_healthplanet_sync_interval_ms_uses_config_value():
    assert get_healthplanet_sync_interval_ms(15) == 15 * 60 * 1000
