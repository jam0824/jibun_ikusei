"""Shared camera/desktop capture coordination for situation features."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from ai.camera_analyzer import CameraAnalysis, analyze_camera_frame
from core.camera import capture_camera_frame
from core.desktop_context import DesktopContext, fetch_desktop_context

logger = logging.getLogger(__name__)

_SITUATION_CAPTURE_SKIP_REASON = "状況取得はすでに実行中です"
_CAMERA_CAPTURE_SKIP_REASON = "カメラ状況取得はすでに実行中です"
_DESKTOP_CAPTURE_SKIP_REASON = "デスクトップ状況取得はすでに実行中です"


@dataclass
class CameraCaptureAttempt:
    analysis: CameraAnalysis | None = None
    skipped: bool = False
    skip_reason: str = ""
    error: str = ""


@dataclass
class DesktopCaptureAttempt:
    context: DesktopContext | None = None
    skipped: bool = False
    skip_reason: str = ""
    error: str = ""


@dataclass
class SituationCaptureResult:
    camera: CameraCaptureAttempt = field(default_factory=CameraCaptureAttempt)
    desktop: DesktopCaptureAttempt = field(default_factory=DesktopCaptureAttempt)
    skipped: bool = False
    skip_reason: str = ""


class SituationCaptureCoordinator:
    """Coordinate camera and desktop capture so overlapping requests skip immediately."""

    def __init__(self) -> None:
        self._camera_lock = asyncio.Lock()
        self._desktop_lock = asyncio.Lock()

    async def capture_for_record(
        self,
        *,
        api_key: str,
        camera_model: str,
        screen_model: str,
        camera_device_index: int,
    ) -> SituationCaptureResult:
        """Capture camera and desktop together for situation logging."""

        if self._camera_lock.locked() or self._desktop_lock.locked():
            result = SituationCaptureResult(
                skipped=True,
                skip_reason=_SITUATION_CAPTURE_SKIP_REASON,
            )
            result.camera.skipped = True
            result.camera.skip_reason = _SITUATION_CAPTURE_SKIP_REASON
            result.desktop.skipped = True
            result.desktop.skip_reason = _SITUATION_CAPTURE_SKIP_REASON
            return result

        await self._camera_lock.acquire()
        await self._desktop_lock.acquire()
        try:
            camera = await self._capture_camera_locked(
                api_key=api_key,
                model=camera_model,
                device_index=camera_device_index,
            )
            desktop = await self._capture_desktop_locked(
                api_key=api_key,
                model=screen_model,
            )
            return SituationCaptureResult(camera=camera, desktop=desktop)
        finally:
            self._desktop_lock.release()
            self._camera_lock.release()

    async def capture_camera(
        self,
        *,
        api_key: str,
        model: str,
        device_index: int,
    ) -> CameraCaptureAttempt:
        """Capture camera analysis only, skipping if another camera capture is active."""

        if self._camera_lock.locked():
            return CameraCaptureAttempt(
                skipped=True,
                skip_reason=_CAMERA_CAPTURE_SKIP_REASON,
            )

        await self._camera_lock.acquire()
        try:
            return await self._capture_camera_locked(
                api_key=api_key,
                model=model,
                device_index=device_index,
            )
        finally:
            self._camera_lock.release()

    async def capture_desktop(
        self,
        *,
        api_key: str,
        model: str,
    ) -> DesktopCaptureAttempt:
        """Capture desktop analysis only, skipping if another desktop capture is active."""

        if self._desktop_lock.locked():
            return DesktopCaptureAttempt(
                skipped=True,
                skip_reason=_DESKTOP_CAPTURE_SKIP_REASON,
            )

        await self._desktop_lock.acquire()
        try:
            return await self._capture_desktop_locked(api_key=api_key, model=model)
        finally:
            self._desktop_lock.release()

    async def _capture_camera_locked(
        self,
        *,
        api_key: str,
        model: str,
        device_index: int,
    ) -> CameraCaptureAttempt:
        try:
            frame_png = capture_camera_frame(device_index)
            if frame_png is None:
                return CameraCaptureAttempt(error="カメラフレームを取得できませんでした")

            analysis = await analyze_camera_frame(
                api_key=api_key,
                model=model,
                frame_png=frame_png,
            )
            return CameraCaptureAttempt(analysis=analysis)
        except Exception as exc:
            logger.exception("カメラ状況取得に失敗")
            return CameraCaptureAttempt(error=str(exc))

    async def _capture_desktop_locked(
        self,
        *,
        api_key: str,
        model: str,
    ) -> DesktopCaptureAttempt:
        try:
            ctx = await fetch_desktop_context(api_key=api_key, model=model)
            return DesktopCaptureAttempt(context=ctx)
        except Exception as exc:
            logger.exception("デスクトップ状況取得に失敗")
            return DesktopCaptureAttempt(error=str(exc))
