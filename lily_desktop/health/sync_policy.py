from __future__ import annotations

from typing import Callable, Literal

WEIGHT_QUEST_CLEAR_MESSAGE = "体重計測クエストクリア"
HealthPlanetSyncAction = Literal["skip", "oauth", "sync"]


def choose_healthplanet_sync_action(
    *,
    has_credentials: bool,
    token_valid: bool,
    interactive_auth: bool,
    sync_in_progress: bool,
) -> HealthPlanetSyncAction:
    if not has_credentials or sync_in_progress:
        return "skip"
    if not token_valid:
        return "oauth" if interactive_auth else "skip"
    return "sync"


def get_healthplanet_sync_interval_ms(sync_interval_minutes: int) -> int:
    return sync_interval_minutes * 60 * 1000


def emit_weight_quest_clear_for_new_records(
    new_records: list[dict],
    emit_user_message: Callable[[str], None],
) -> dict | None:
    if not new_records:
        return None

    latest_record = max(
        new_records,
        key=lambda record: (record.get("date", ""), record.get("time", "")),
    )
    emit_user_message(WEIGHT_QUEST_CLEAR_MESSAGE)
    return latest_record
