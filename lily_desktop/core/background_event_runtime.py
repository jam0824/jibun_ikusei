from __future__ import annotations

from core.domain_events import (
    ActionLogSyncRequested,
    AppStarted,
    CaptureSnapshotRequested,
    CaptureSummaryDue,
    ChatAutoTalkDue,
    ChatFollowUpRequested,
    DomainEventHub,
    FitbitSyncRequested,
    HealthPlanetSyncRequested,
    LevelWatchRequested,
)
from core.job_manager import JobManager


def register_background_event_handlers(
    app,
    event_hub: DomainEventHub,
    job_manager: JobManager,
) -> None:
    async def on_app_started(event: AppStarted) -> None:
        correlation_id = event.correlation_id or event.event_id
        if getattr(app.config.healthplanet, "client_id", ""):
            event_hub.publish(
                HealthPlanetSyncRequested(
                    source="app.started",
                    correlation_id=correlation_id,
                    interactive_auth=True,
                )
            )
        if getattr(app, "fitbit_sync", None) is not None:
            event_hub.publish(
                FitbitSyncRequested(
                    source="app.started",
                    correlation_id=correlation_id,
                )
            )
        event_hub.publish(
            LevelWatchRequested(
                source="app.started",
                correlation_id=correlation_id,
            )
        )
        if getattr(getattr(app.config, "activity_capture", None), "enabled", False):
            event_hub.publish(
                ActionLogSyncRequested(
                    source="app.started",
                    correlation_id=correlation_id,
                )
            )

    async def on_healthplanet_requested(event: HealthPlanetSyncRequested) -> None:
        await job_manager.submit(
            "healthplanet.sync",
            "single_flight_coalesce",
            lambda: app.handle_healthplanet_sync_request(
                interactive_auth=event.interactive_auth
            ),
        )

    async def on_fitbit_requested(_event: FitbitSyncRequested) -> None:
        await job_manager.submit(
            "fitbit.sync",
            "single_flight_coalesce",
            app.handle_fitbit_sync_request,
        )

    async def on_level_watch_requested(_event: LevelWatchRequested) -> None:
        await job_manager.submit(
            "desktop.level_watch",
            "single_flight_coalesce",
            app.run_level_watch_job,
        )

    async def on_action_log_sync_requested(_event: ActionLogSyncRequested) -> None:
        await job_manager.submit(
            "action_log.sync",
            "single_flight_coalesce",
            app.handle_action_log_sync_request,
        )

    async def on_chat_auto_talk_due(event: ChatAutoTalkDue) -> None:
        await app.handle_chat_auto_talk_due(event)

    async def on_chat_follow_up(event: ChatFollowUpRequested) -> None:
        await job_manager.submit(
            "chat.follow_up",
            "single_flight_drop",
            lambda: app.auto_conversation.run_follow_up_job(
                event.user_text,
                event.lily_text,
            ),
        )

    async def on_capture_snapshot(_event: CaptureSnapshotRequested) -> None:
        await job_manager.submit(
            "capture.snapshot",
            "latest_wins",
            app.run_capture_snapshot_job,
        )

    async def on_capture_summary(_event: CaptureSummaryDue) -> None:
        await job_manager.submit(
            "capture.summary",
            "serial",
            app.run_capture_summary_job,
        )

    event_hub.subscribe(AppStarted, on_app_started)
    event_hub.subscribe(HealthPlanetSyncRequested, on_healthplanet_requested)
    event_hub.subscribe(FitbitSyncRequested, on_fitbit_requested)
    event_hub.subscribe(LevelWatchRequested, on_level_watch_requested)
    event_hub.subscribe(ActionLogSyncRequested, on_action_log_sync_requested)
    event_hub.subscribe(ChatAutoTalkDue, on_chat_auto_talk_due)
    event_hub.subscribe(ChatFollowUpRequested, on_chat_follow_up)
    event_hub.subscribe(CaptureSnapshotRequested, on_capture_snapshot)
    event_hub.subscribe(CaptureSummaryDue, on_capture_summary)
