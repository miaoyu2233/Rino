"""Opaque ADB discovery keys and serialized Maa controller sessions."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager, suppress
from dataclasses import dataclass
from typing import TypeGuard, cast
from uuid import uuid4

import numpy as np
from numpy.typing import NDArray

from rino_runtime.artifacts import (
    CaptureArtifactDescriptor,
    CaptureArtifactError,
    CaptureArtifactErrorCode,
    CaptureArtifactScope,
    CaptureRegion,
    ImageArtifact,
    ImageArtifactError,
    ImageArtifactErrorCode,
    ImageArtifactScope,
    PreviewArtifactDescriptor,
    PreviewArtifactError,
    PreviewArtifactErrorCode,
    PreviewArtifactScope,
    ProjectAssetDescriptor,
    ProjectAssetError,
    ProjectAssetScope,
)
from rino_runtime.backends.android_actions import (
    AndroidKey,
    android_key_code,
    validate_android_intent,
)
from rino_runtime.backends.base import (
    AutomationDeviceDescriptor,
    AutomationDeviceState,
    AutomationOperationCorrelation,
    AutomationOperationKind,
    AutomationRuntimeEventSink,
)
from rino_runtime.backends.maa.binding import (
    MaaAdbDeviceSpec,
    MaaBinding,
    MaaCallbackBinding,
    MaaClassicalRecognitionBinding,
    MaaController,
    MaaJob,
    MaaKeyController,
    MaaMatchSnapshot,
    MaaOcrSession,
    MaaOcrSnapshot,
    MaaRecognitionSession,
    MaaRuntimeInfo,
)
from rino_runtime.backends.maa.errors import MaaBackendError, MaaBackendErrorCode
from rino_runtime.execution_control import (
    CancellationProbe,
    CancellationSignal,
    DeviceLeaseManager,
    NeverCancelled,
)
from rino_runtime.nodes.execution import (
    RuntimeImageReference,
    RuntimeMatchCandidate,
    RuntimeMatchResult,
    RuntimeOcrCandidate,
    RuntimeOcrResult,
    RuntimePoint,
    RuntimeRect,
)

MAXIMUM_TOUCH_DURATION_MILLISECONDS = 60_000
MAXIMUM_MULTI_SWIPE_STEPS = 30
TOUCH_PRESSURE = 1
ANDROID_BACK_KEY_CODE = 4


@dataclass(slots=True)
class _DeviceRecord:
    device_key: str
    coordinate_space_id: str
    display_name: str
    specification: MaaAdbDeviceSpec
    present: bool = True
    controller: MaaController | None = None
    ocr_session: MaaOcrSession | None = None
    state: AutomationDeviceState = AutomationDeviceState.AVAILABLE
    connection_generation: int = 0
    coordinate_width: int | None = None
    coordinate_height: int | None = None

    def descriptor(self) -> AutomationDeviceDescriptor:
        return AutomationDeviceDescriptor(
            device_key=self.device_key,
            display_name=self.display_name,
            controller_family="adb",
            state=self.state,
        )


class MaaDeviceService:
    """Owns ephemeral device identities and controller lifetimes for one sidecar."""

    def __init__(
        self,
        binding: MaaBinding,
        *,
        device_key_factory: Callable[[], str] = lambda: f"device-{uuid4()}",
        coordinate_space_factory: Callable[[], str] = (
            lambda: f"coordinate-space-{uuid4()}"
        ),
        image_artifacts: ImageArtifactScope | None = None,
        preview_artifacts: PreviewArtifactScope | None = None,
        capture_artifacts: CaptureArtifactScope | None = None,
        project_assets: ProjectAssetScope | None = None,
    ) -> None:
        self._binding = binding
        self._callback_binding = (
            binding if isinstance(binding, MaaCallbackBinding) else None
        )
        self._recognition_binding = (
            binding if isinstance(binding, MaaClassicalRecognitionBinding) else None
        )
        self._device_key_factory = device_key_factory
        self._coordinate_space_factory = coordinate_space_factory
        self._image_artifacts = image_artifacts or ImageArtifactScope()
        self._preview_artifacts = preview_artifacts
        self._capture_artifacts = capture_artifacts
        self._project_assets = project_assets
        self._records: dict[str, _DeviceRecord] = {}
        self._state_lock = asyncio.Lock()
        self._leases = DeviceLeaseManager()
        self._runtime_info: MaaRuntimeInfo | None = None
        self._closed = False

    def set_operation_event_sink(
        self,
        sink: AutomationRuntimeEventSink | None,
    ) -> None:
        if self._callback_binding is not None:
            self._callback_binding.set_callback_event_sink(sink)

    @property
    def runtime_info(self) -> MaaRuntimeInfo:
        if self._runtime_info is None:
            raise MaaBackendError(
                MaaBackendErrorCode.NOT_INITIALIZED,
                "The Maa device service has not been initialized.",
                retryable=False,
            )
        return self._runtime_info

    @property
    def ocr_available(self) -> bool:
        return self._runtime_info is not None and self._binding.ocr_available

    @property
    def recognition_available(self) -> bool:
        return self._runtime_info is not None and bool(
            self._recognition_binding is not None
            and self._recognition_binding.recognition_available
        )

    async def initialize(self) -> MaaRuntimeInfo:
        async with self._state_lock:
            self._ensure_open()
            if self._runtime_info is None:
                self._runtime_info = await asyncio.to_thread(self._binding.initialize)
            return self._runtime_info

    async def discover(self) -> tuple[AutomationDeviceDescriptor, ...]:
        await self.initialize()
        async with self._state_lock:
            self._ensure_open()
            specifications = await asyncio.to_thread(self._binding.discover_adb_devices)
            for record in self._records.values():
                record.present = False
            by_identity = {
                record.specification.internal_identity: record
                for record in self._records.values()
            }
            for index, specification in enumerate(specifications, start=1):
                record = by_identity.get(specification.internal_identity)
                if record is None:
                    device_key = self._new_device_key()
                    record = _DeviceRecord(
                        device_key=device_key,
                        coordinate_space_id=self._new_coordinate_space_id(),
                        display_name=f"Android device {index}",
                        specification=specification,
                    )
                    self._records[device_key] = record
                    by_identity[specification.internal_identity] = record
                else:
                    record.specification = specification
                record.present = True
            self._remove_absent_available_records()
            return tuple(
                record.descriptor()
                for record in self._records.values()
                if record.present or record.controller is not None
            )

    async def connect(
        self,
        device_key: str,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> AutomationDeviceDescriptor:
        await self.initialize()
        async with (
            self._leases.lease(device_key, NeverCancelled()),
            self._state_lock,
        ):
            self._ensure_open()
            record = self._require_record(device_key)
            if record.controller is not None and await asyncio.to_thread(
                lambda: record.controller is not None and record.controller.connected
            ):
                record.state = AutomationDeviceState.CONNECTED
                return record.descriptor()
            previous_controller = record.controller
            previous_ocr_session = record.ocr_session
            record.controller = None
            record.ocr_session = None
            record.state = AutomationDeviceState.AVAILABLE
            specification = record.specification
            if previous_controller is not None:
                try:
                    if previous_ocr_session is not None:
                        await self._stop_ocr_session(previous_ocr_session)
                    await self._deactivate_controller(previous_controller)
                finally:
                    if self._callback_binding is not None:
                        self._callback_binding.release_controller_callbacks(
                            previous_controller
                        )
            controller = await asyncio.to_thread(
                self._binding.create_adb_controller,
                specification,
            )
            try:
                connection_job = await asyncio.to_thread(controller.post_connection)
                self._bind_controller_job(
                    controller,
                    connection_job,
                    AutomationOperationKind.DEVICE_CONNECT,
                    correlation,
                )
                await asyncio.to_thread(connection_job.wait)
                connection_succeeded = connection_job.succeeded
                connected = await asyncio.to_thread(lambda: controller.connected)
            except (OSError, RuntimeError, ValueError) as error:
                await self._deactivate_after_failed_connection(controller)
                raise MaaBackendError(
                    MaaBackendErrorCode.DEVICE_CONNECTION_FAILED,
                    "The Maa ADB controller failed while connecting.",
                    retryable=True,
                ) from error
            if not connection_succeeded or not connected:
                await self._deactivate_after_failed_connection(controller)
                raise MaaBackendError(
                    MaaBackendErrorCode.DEVICE_CONNECTION_FAILED,
                    "The Maa ADB controller did not reach the connected state.",
                    retryable=True,
                )
            try:
                if self._recognition_binding is not None and (
                    self._recognition_binding.recognition_available
                ):
                    create_session = (
                        self._recognition_binding.create_recognition_session
                    )
                elif getattr(self._binding, "ocr_available", False):
                    create_session = self._binding.create_ocr_session
                else:
                    create_session = None
                ocr_session = (
                    await asyncio.to_thread(create_session, controller)
                    if create_session is not None
                    else None
                )
            except MaaBackendError:
                await self._deactivate_after_failed_connection(controller)
                raise
            if record.connection_generation > 0:
                record.coordinate_space_id = self._new_coordinate_space_id()
            record.connection_generation += 1
            record.coordinate_width = None
            record.coordinate_height = None
            record.controller = controller
            record.ocr_session = ocr_session
            record.state = AutomationDeviceState.CONNECTED
            return record.descriptor()

    async def check_health(self, device_key: str) -> AutomationDeviceDescriptor:
        async with (
            self.connected_controller(device_key, NeverCancelled()),
            self._state_lock,
        ):
            return self._require_record(device_key).descriptor()

    async def capture_screen(
        self,
        device_key: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeImageReference:
        async with self.connected_controller(device_key, cancellation) as controller:
            cancellation.raise_if_cancelled()
            try:
                screenshot_job = await asyncio.to_thread(controller.post_screencap)
                self._bind_controller_job(
                    controller,
                    screenshot_job,
                    AutomationOperationKind.SCREEN_CAPTURE,
                    correlation,
                )
                await asyncio.to_thread(screenshot_job.wait)
                succeeded = screenshot_job.succeeded
            except (OSError, RuntimeError, TypeError, ValueError) as error:
                raise MaaBackendError(
                    MaaBackendErrorCode.SCREEN_CAPTURE_FAILED,
                    "The Maa controller failed while capturing the device screen.",
                    retryable=True,
                ) from error
            if not succeeded:
                raise MaaBackendError(
                    MaaBackendErrorCode.SCREEN_CAPTURE_FAILED,
                    "The Maa controller did not complete the screen capture.",
                    retryable=True,
                )
            try:
                pixels = await asyncio.to_thread(screenshot_job.get)
            except (OSError, RuntimeError, TypeError, ValueError) as error:
                raise MaaBackendError(
                    MaaBackendErrorCode.SCREEN_CAPTURE_FAILED,
                    "The Maa controller could not return the captured frame.",
                    retryable=True,
                ) from error
            cancellation.raise_if_cancelled()
            if _is_supported_capture_array(pixels):
                height = int(pixels.shape[0])
                width = int(pixels.shape[1])
                async with self._state_lock:
                    record = self._require_record(device_key)
                    dimensions_changed = (
                        record.coordinate_width is not None
                        and record.coordinate_height is not None
                        and (
                            record.coordinate_width != width
                            or record.coordinate_height != height
                        )
                    )
                    if dimensions_changed:
                        record.coordinate_space_id = self._new_coordinate_space_id()
                    record.coordinate_width = width
                    record.coordinate_height = height
            async with self._state_lock:
                coordinate_space_id = self._require_record(
                    device_key
                ).coordinate_space_id
            try:
                return self._image_artifacts.store(
                    pixels,
                    coordinate_space_id=coordinate_space_id,
                )
            except ImageArtifactError as error:
                code = (
                    MaaBackendErrorCode.SCREEN_CAPTURE_TOO_LARGE
                    if error.code is ImageArtifactErrorCode.IMAGE_TOO_LARGE
                    else MaaBackendErrorCode.SCREEN_CAPTURE_INVALID
                )
                raise MaaBackendError(
                    code,
                    "The captured frame did not satisfy the runtime image limits.",
                    retryable=code is MaaBackendErrorCode.SCREEN_CAPTURE_INVALID,
                ) from error

    def resolve_image(self, reference: RuntimeImageReference) -> ImageArtifact:
        return self._image_artifacts.resolve(reference)

    async def prepare_project_asset(
        self,
        asset_token: str,
        content_hash: str,
        byte_length: int,
        width: int,
        height: int,
        coordinate_space_id: str,
    ) -> RuntimeImageReference:
        scope = self._project_assets
        if scope is None:
            raise MaaBackendError(
                MaaBackendErrorCode.CAPTURE_ARTIFACT_UNAVAILABLE,
                "The project asset handoff cache is not configured.",
                retryable=False,
            )
        try:
            pixels = await asyncio.to_thread(
                scope.consume,
                ProjectAssetDescriptor(
                    asset_token=asset_token,
                    content_hash=content_hash,
                    byte_length=byte_length,
                    width=width,
                    height=height,
                    coordinate_space_id=coordinate_space_id,
                ),
            )
            return self._image_artifacts.store(
                pixels,
                coordinate_space_id=coordinate_space_id,
            )
        except ProjectAssetError as error:
            raise MaaBackendError(
                MaaBackendErrorCode.CAPTURE_ARTIFACT_INVALID,
                "The project template image failed bounded validation.",
                retryable=False,
            ) from error
        except ImageArtifactError as error:
            code = (
                MaaBackendErrorCode.CAPTURE_ARTIFACT_TOO_LARGE
                if error.code is ImageArtifactErrorCode.IMAGE_TOO_LARGE
                else MaaBackendErrorCode.CAPTURE_ARTIFACT_INVALID
            )
            raise MaaBackendError(
                code,
                "The project template image exceeds runtime image limits.",
                retryable=False,
            ) from error

    async def recognize_ocr(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        confidence_threshold: float,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeOcrResult:
        if not 0 <= confidence_threshold <= 1:
            raise MaaBackendError(
                MaaBackendErrorCode.OCR_RESULT_INVALID,
                "The OCR confidence threshold is outside the supported range.",
                retryable=False,
            )
        artifact = self._resolve_ocr_image(image)
        roi_tuple = _validate_ocr_region(roi, image.width, image.height)
        async with self._leases.lease(device_key, cancellation):
            cancellation.raise_if_cancelled()
            async with self._state_lock:
                self._ensure_open()
                record = self._require_record(device_key)
                controller = record.controller
                session = record.ocr_session
                coordinate_space_id = record.coordinate_space_id
            if controller is None:
                raise MaaBackendError(
                    MaaBackendErrorCode.DEVICE_NOT_CONNECTED,
                    "The selected device does not have an active Maa session.",
                    retryable=True,
                )
            if session is None:
                raise MaaBackendError(
                    MaaBackendErrorCode.OCR_UNAVAILABLE,
                    "The fixed OCR capability is unavailable in this runtime.",
                    retryable=False,
                )
            if image.coordinate_space_id != coordinate_space_id:
                raise MaaBackendError(
                    MaaBackendErrorCode.OCR_RESULT_INVALID,
                    "The OCR image does not belong to the selected device session.",
                    retryable=False,
                )
            connected = await asyncio.to_thread(lambda: controller.connected)
            if not connected:
                async with self._state_lock:
                    current = self._records.get(device_key)
                    if current is not None and current.controller is controller:
                        current.state = AutomationDeviceState.CONNECTION_LOST
                raise MaaBackendError(
                    MaaBackendErrorCode.DEVICE_CONNECTION_LOST,
                    "The selected Maa device session is no longer connected.",
                    retryable=True,
                )
            snapshot = await _recognize_with_cancellation(
                session,
                artifact.pixels,
                roi_tuple,
                confidence_threshold,
                cancellation,
                correlation,
            )
        cancellation.raise_if_cancelled()
        return RuntimeOcrResult(
            candidates=tuple(
                RuntimeOcrCandidate(
                    text=candidate.text,
                    confidence=candidate.confidence,
                    rect=RuntimeRect(
                        *candidate.rect,
                        coordinate_space_id=image.coordinate_space_id,
                        source_generation=image.generation,
                    ),
                )
                for candidate in snapshot.candidates
            ),
            matched=snapshot.matched,
            source_generation=image.generation,
            source_coordinate_space_id=image.coordinate_space_id,
            operation_id=snapshot.operation_id,
        )

    async def recognize_template_match(
        self,
        device_key: str,
        image: RuntimeImageReference,
        template: RuntimeImageReference,
        roi: RuntimeRect | None,
        threshold: float,
        method: int,
        green_mask: bool,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeMatchResult:
        template_artifact = self._resolve_match_image(template)
        return await self._recognize_match(
            device_key,
            image,
            roi,
            cancellation,
            correlation,
            lambda session, pixels, region: session.recognize_template_match(
                pixels,
                template_artifact.pixels,
                roi=region,
                threshold=threshold,
                method=method,
                green_mask=green_mask,
                correlation=correlation,
            ),
        )

    async def recognize_feature_match(
        self,
        device_key: str,
        image: RuntimeImageReference,
        template: RuntimeImageReference,
        roi: RuntimeRect | None,
        detector: str,
        minimum_count: int,
        ratio: float,
        green_mask: bool,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeMatchResult:
        template_artifact = self._resolve_match_image(template)
        return await self._recognize_match(
            device_key,
            image,
            roi,
            cancellation,
            correlation,
            lambda session, pixels, region: session.recognize_feature_match(
                pixels,
                template_artifact.pixels,
                roi=region,
                detector=detector,
                minimum_count=minimum_count,
                ratio=ratio,
                green_mask=green_mask,
                correlation=correlation,
            ),
        )

    async def recognize_color_match(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        lower: tuple[int, ...],
        upper: tuple[int, ...],
        method: int,
        minimum_count: int,
        connected: bool,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeMatchResult:
        return await self._recognize_match(
            device_key,
            image,
            roi,
            cancellation,
            correlation,
            lambda session, pixels, region: session.recognize_color_match(
                pixels,
                roi=region,
                lower=lower,
                upper=upper,
                method=method,
                minimum_count=minimum_count,
                connected=connected,
                correlation=correlation,
            ),
        )

    async def _recognize_match(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
        operation: Callable[
            [
                MaaRecognitionSession,
                NDArray[np.uint8],
                tuple[int, int, int, int],
            ],
            MaaMatchSnapshot,
        ],
    ) -> RuntimeMatchResult:
        artifact = self._resolve_match_image(image)
        roi_tuple = _validate_match_region(roi, image.width, image.height)
        async with self._leases.lease(device_key, cancellation):
            cancellation.raise_if_cancelled()
            async with self._state_lock:
                self._ensure_open()
                record = self._require_record(device_key)
                controller = record.controller
                session = record.ocr_session
                coordinate_space_id = record.coordinate_space_id
            if controller is None:
                raise MaaBackendError(
                    MaaBackendErrorCode.DEVICE_NOT_CONNECTED,
                    "The selected device does not have an active Maa session.",
                    retryable=True,
                )
            if session is None or not self.recognition_available:
                raise MaaBackendError(
                    MaaBackendErrorCode.RECOGNITION_UNAVAILABLE,
                    "The fixed image recognition capability is unavailable.",
                    retryable=False,
                )
            if image.coordinate_space_id != coordinate_space_id:
                raise MaaBackendError(
                    MaaBackendErrorCode.RECOGNITION_RESULT_INVALID,
                    "The recognition image does not belong to the selected "
                    "device session.",
                    retryable=False,
                )
            connected = await asyncio.to_thread(lambda: controller.connected)
            if not connected:
                async with self._state_lock:
                    current = self._records.get(device_key)
                    if current is not None and current.controller is controller:
                        current.state = AutomationDeviceState.CONNECTION_LOST
                raise MaaBackendError(
                    MaaBackendErrorCode.DEVICE_CONNECTION_LOST,
                    "The selected Maa device session is no longer connected.",
                    retryable=True,
                )
            recognition_session = cast(MaaRecognitionSession, session)
            snapshot = await _match_with_cancellation(
                recognition_session,
                lambda: operation(
                    recognition_session,
                    artifact.pixels,
                    roi_tuple,
                ),
                cancellation,
            )
        cancellation.raise_if_cancelled()
        return RuntimeMatchResult(
            candidates=tuple(
                RuntimeMatchCandidate(
                    metric=candidate.metric,
                    rect=RuntimeRect(
                        *candidate.rect,
                        coordinate_space_id=image.coordinate_space_id,
                        source_generation=image.generation,
                    ),
                )
                for candidate in snapshot.candidates
            ),
            matched=snapshot.matched,
            source_generation=image.generation,
            source_coordinate_space_id=image.coordinate_space_id,
            operation_id=snapshot.operation_id,
        )

    async def stop_ocr(self, device_key: str) -> bool:
        async with self._state_lock:
            record = self._records.get(device_key)
            session = record.ocr_session if record is not None else None
        if session is None:
            return False
        return await asyncio.to_thread(session.stop)

    async def click_point(
        self,
        device_key: str,
        point: RuntimePoint,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        async with self.connected_controller(device_key, cancellation) as controller:
            async with self._state_lock:
                record = self._require_record(device_key)
                _validate_action_point(point, record)
            await self._dispatch_click(controller, point, cancellation, correlation)

    async def click_rect_center(
        self,
        device_key: str,
        rect: RuntimeRect,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        async with self.connected_controller(device_key, cancellation) as controller:
            async with self._state_lock:
                record = self._require_record(device_key)
                _validate_action_rect(rect, record)
            point = RuntimePoint(
                x=rect.x + rect.width // 2,
                y=rect.y + rect.height // 2,
                coordinate_space_id=rect.coordinate_space_id,
                source_generation=rect.source_generation,
            )
            await self._dispatch_click(controller, point, cancellation, correlation)

    async def launch_android_app(
        self,
        device_key: str,
        intent: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        try:
            validated_intent = validate_android_intent(intent)
        except ValueError as error:
            raise _rejected_action(
                "The Android application intent is not allowlisted."
            ) from error
        async with self.connected_controller(device_key, cancellation) as controller:
            await self._dispatch_start_app(
                controller,
                validated_intent,
                cancellation,
                correlation,
            )

    async def press_android_key(
        self,
        device_key: str,
        key: AndroidKey,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        try:
            key_code = android_key_code(AndroidKey(key))
        except (TypeError, ValueError) as error:
            raise _rejected_action("The Android key is not allowlisted.") from error
        async with self.connected_controller(device_key, cancellation) as controller:
            await self._dispatch_key(controller, key_code, cancellation, correlation)

    async def press_back(
        self,
        device_key: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        async with self.connected_controller(device_key, cancellation) as controller:
            await self._dispatch_key(
                controller,
                ANDROID_BACK_KEY_CODE,
                cancellation,
                correlation,
            )

    async def long_press(
        self,
        device_key: str,
        point: RuntimePoint,
        duration_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        _validate_touch_duration(duration_milliseconds)
        async with self.connected_controller(device_key, cancellation) as controller:
            async with self._state_lock:
                _validate_action_point(point, self._require_record(device_key))
            await self._dispatch_long_press(
                controller,
                point,
                duration_milliseconds,
                cancellation,
                correlation,
            )

    async def swipe(
        self,
        device_key: str,
        start: RuntimePoint,
        end: RuntimePoint,
        duration_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        _validate_touch_duration(duration_milliseconds)
        async with self.connected_controller(device_key, cancellation) as controller:
            async with self._state_lock:
                record = self._require_record(device_key)
                _validate_action_point(start, record)
                _validate_action_point(end, record)
            await self._dispatch_swipe(
                controller,
                start,
                end,
                duration_milliseconds,
                cancellation,
                correlation,
            )

    async def multi_swipe(
        self,
        device_key: str,
        primary_start: RuntimePoint,
        primary_end: RuntimePoint,
        secondary_start: RuntimePoint,
        secondary_end: RuntimePoint,
        duration_milliseconds: int,
        secondary_start_delay_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        _validate_touch_duration(duration_milliseconds)
        if (
            secondary_start_delay_milliseconds < 0
            or secondary_start_delay_milliseconds > duration_milliseconds
        ):
            raise _rejected_action(
                "The secondary contact delay must be within the swipe duration."
            )
        async with self.connected_controller(device_key, cancellation) as controller:
            async with self._state_lock:
                record = self._require_record(device_key)
                for point in (
                    primary_start,
                    primary_end,
                    secondary_start,
                    secondary_end,
                ):
                    _validate_action_point(point, record)
            await self._dispatch_multi_swipe(
                controller,
                primary_start,
                primary_end,
                secondary_start,
                secondary_end,
                duration_milliseconds,
                secondary_start_delay_milliseconds,
                cancellation,
                correlation,
            )

    def release_image(self, handle_id: str) -> bool:
        return self._image_artifacts.release(handle_id)

    async def capture_preview(
        self,
        device_key: str,
        maximum_width: int,
        maximum_height: int,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> PreviewArtifactDescriptor:
        preview_artifacts = self._preview_artifacts
        if preview_artifacts is None:
            raise MaaBackendError(
                MaaBackendErrorCode.PREVIEW_UNAVAILABLE,
                "The runtime preview cache is not configured.",
                retryable=False,
            )
        reference = await self.capture_screen(
            device_key,
            NeverCancelled(),
            correlation,
        )
        source = self._image_artifacts.resolve(reference)
        try:
            return preview_artifacts.create(
                source,
                maximum_width=maximum_width,
                maximum_height=maximum_height,
            )
        except PreviewArtifactError as error:
            code_by_artifact_error = {
                PreviewArtifactErrorCode.INVALID_REQUEST: (
                    MaaBackendErrorCode.PREVIEW_ENCODE_FAILED
                ),
                PreviewArtifactErrorCode.ENCODE_FAILED: (
                    MaaBackendErrorCode.PREVIEW_ENCODE_FAILED
                ),
                PreviewArtifactErrorCode.TOO_LARGE: (
                    MaaBackendErrorCode.PREVIEW_TOO_LARGE
                ),
                PreviewArtifactErrorCode.STORAGE_FAILED: (
                    MaaBackendErrorCode.PREVIEW_STORAGE_FAILED
                ),
                PreviewArtifactErrorCode.SCOPE_CLOSED: (
                    MaaBackendErrorCode.PREVIEW_UNAVAILABLE
                ),
                PreviewArtifactErrorCode.NOT_FOUND: (
                    MaaBackendErrorCode.PREVIEW_UNAVAILABLE
                ),
                PreviewArtifactErrorCode.EXPIRED: (
                    MaaBackendErrorCode.PREVIEW_UNAVAILABLE
                ),
            }
            code = code_by_artifact_error[error.code]
            raise MaaBackendError(
                code,
                "The runtime could not create the bounded device preview.",
                retryable=code
                in {
                    MaaBackendErrorCode.PREVIEW_ENCODE_FAILED,
                    MaaBackendErrorCode.PREVIEW_STORAGE_FAILED,
                },
            ) from error

    def release_preview(self, preview_token: str) -> bool:
        preview_artifacts = self._preview_artifacts
        if preview_artifacts is None:
            return False
        return preview_artifacts.release(preview_token)

    async def prepare_capture(
        self,
        preview_token: str,
        region: CaptureRegion | None,
    ) -> CaptureArtifactDescriptor:
        preview_artifacts = self._preview_artifacts
        capture_artifacts = self._capture_artifacts
        if preview_artifacts is None or capture_artifacts is None:
            raise MaaBackendError(
                MaaBackendErrorCode.CAPTURE_ARTIFACT_UNAVAILABLE,
                "The runtime capture artifact cache is not configured.",
                retryable=False,
            )
        try:
            reference = preview_artifacts.resolve_source(preview_token)
            source = self._image_artifacts.resolve(reference)
            return capture_artifacts.create(source, region=region)
        except PreviewArtifactError as error:
            raise MaaBackendError(
                MaaBackendErrorCode.CAPTURE_ARTIFACT_UNAVAILABLE,
                "The source preview is unavailable or expired.",
                retryable=False,
            ) from error
        except ImageArtifactError as error:
            raise MaaBackendError(
                MaaBackendErrorCode.CAPTURE_ARTIFACT_UNAVAILABLE,
                "The full-resolution source frame is unavailable or expired.",
                retryable=False,
            ) from error
        except CaptureArtifactError as error:
            code_by_artifact_error = {
                CaptureArtifactErrorCode.INVALID_REQUEST: (
                    MaaBackendErrorCode.CAPTURE_ARTIFACT_INVALID
                ),
                CaptureArtifactErrorCode.ENCODE_FAILED: (
                    MaaBackendErrorCode.CAPTURE_ARTIFACT_ENCODE_FAILED
                ),
                CaptureArtifactErrorCode.TOO_LARGE: (
                    MaaBackendErrorCode.CAPTURE_ARTIFACT_TOO_LARGE
                ),
                CaptureArtifactErrorCode.STORAGE_FAILED: (
                    MaaBackendErrorCode.CAPTURE_ARTIFACT_STORAGE_FAILED
                ),
                CaptureArtifactErrorCode.SCOPE_CLOSED: (
                    MaaBackendErrorCode.CAPTURE_ARTIFACT_UNAVAILABLE
                ),
            }
            code = code_by_artifact_error[error.code]
            raise MaaBackendError(
                code,
                "The runtime could not prepare the confirmed capture artifact.",
                retryable=code
                in {
                    MaaBackendErrorCode.CAPTURE_ARTIFACT_ENCODE_FAILED,
                    MaaBackendErrorCode.CAPTURE_ARTIFACT_STORAGE_FAILED,
                },
            ) from error

    def release_capture(self, capture_token: str) -> bool:
        capture_artifacts = self._capture_artifacts
        if capture_artifacts is None:
            return False
        return capture_artifacts.release(capture_token)

    async def disconnect(
        self,
        device_key: str,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> AutomationDeviceDescriptor:
        return await self._disconnect(
            device_key,
            allow_closed=False,
            correlation=correlation,
        )

    def connected_controller(
        self,
        device_key: str,
        cancellation: CancellationProbe,
    ) -> AbstractAsyncContextManager[MaaController]:
        return self._connected_controller(device_key, cancellation)

    @asynccontextmanager
    async def _connected_controller(
        self,
        device_key: str,
        cancellation: CancellationProbe,
    ) -> AsyncGenerator[MaaController]:
        async with self._leases.lease(device_key, cancellation):
            cancellation.raise_if_cancelled()
            async with self._state_lock:
                self._ensure_open()
                record = self._require_record(device_key)
                controller = record.controller
            if controller is None:
                raise MaaBackendError(
                    MaaBackendErrorCode.DEVICE_NOT_CONNECTED,
                    "The selected device does not have an active Maa session.",
                    retryable=True,
                )
            connected = await asyncio.to_thread(lambda: controller.connected)
            if not connected:
                async with self._state_lock:
                    current = self._records.get(device_key)
                    if current is not None and current.controller is controller:
                        current.state = AutomationDeviceState.CONNECTION_LOST
                raise MaaBackendError(
                    MaaBackendErrorCode.DEVICE_CONNECTION_LOST,
                    "The selected Maa device session is no longer connected.",
                    retryable=True,
                )
            cancellation.raise_if_cancelled()
            yield controller

    async def close(self) -> tuple[MaaBackendErrorCode, ...]:
        async with self._state_lock:
            if self._closed:
                return ()
            self._closed = True
            device_keys = tuple(
                key
                for key, record in self._records.items()
                if record.controller is not None
            )
        failures: list[MaaBackendErrorCode] = []
        for device_key in device_keys:
            try:
                await self._disconnect(
                    device_key,
                    allow_closed=True,
                    correlation=None,
                )
            except MaaBackendError as error:
                failures.append(error.code)
        async with self._state_lock:
            self._records.clear()
        self._image_artifacts.close()
        if self._preview_artifacts is not None:
            self._preview_artifacts.close()
        if self._capture_artifacts is not None:
            self._capture_artifacts.close()
        if self._project_assets is not None:
            self._project_assets.close()
        if self._callback_binding is not None:
            self._callback_binding.close_callback_events()
        return tuple(failures)

    async def _disconnect(
        self,
        device_key: str,
        *,
        allow_closed: bool,
        correlation: AutomationOperationCorrelation | None,
    ) -> AutomationDeviceDescriptor:
        async with (
            self._leases.lease(device_key, NeverCancelled()),
            self._state_lock,
        ):
            if not allow_closed:
                self._ensure_open()
            record = self._require_record(device_key)
            controller = record.controller
            ocr_session = record.ocr_session
            record.controller = None
            record.ocr_session = None
            record.state = AutomationDeviceState.AVAILABLE
            descriptor = record.descriptor()
            if controller is not None:
                try:
                    if ocr_session is not None:
                        await self._stop_ocr_session(ocr_session)
                    await self._deactivate_controller(controller, correlation)
                finally:
                    if self._callback_binding is not None:
                        self._callback_binding.release_controller_callbacks(controller)
            return descriptor

    async def _deactivate_controller(
        self,
        controller: MaaController,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        try:
            inactive_job = await asyncio.to_thread(controller.post_inactive)
            self._bind_controller_job(
                controller,
                inactive_job,
                AutomationOperationKind.DEVICE_DISCONNECT,
                correlation,
            )
            await asyncio.to_thread(inactive_job.wait)
            inactive_succeeded = inactive_job.succeeded
        except (OSError, RuntimeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.DEVICE_DEACTIVATION_FAILED,
                "The Maa controller failed while releasing the device session.",
                retryable=True,
            ) from error
        if not inactive_succeeded:
            raise MaaBackendError(
                MaaBackendErrorCode.DEVICE_DEACTIVATION_FAILED,
                "The Maa controller did not confirm session deactivation.",
                retryable=True,
            )

    async def _stop_ocr_session(self, session: MaaOcrSession) -> None:
        await asyncio.to_thread(session.stop)

    async def _dispatch_click(
        self,
        controller: MaaController,
        point: RuntimePoint,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        cancellation.raise_if_cancelled()
        try:
            job = await asyncio.to_thread(controller.post_click, point.x, point.y)
            self._bind_controller_job(
                controller,
                job,
                AutomationOperationKind.CLICK,
                correlation,
            )
            completed = await asyncio.to_thread(job.wait)
            succeeded = completed.succeeded
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN,
                "The Maa click action outcome could not be confirmed.",
                retryable=False,
            ) from error
        if not succeeded:
            raise MaaBackendError(
                MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN,
                "The Maa click action outcome could not be confirmed.",
                retryable=False,
            )

    async def _dispatch_key(
        self,
        controller: MaaController,
        key_code: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        cancellation.raise_if_cancelled()
        try:
            key_controller = cast(MaaKeyController, controller)
            job = await asyncio.to_thread(key_controller.post_click_key, key_code)
            self._bind_controller_job(
                controller,
                job,
                AutomationOperationKind.KEY_PRESS,
                correlation,
            )
            completed = await asyncio.to_thread(job.wait)
            succeeded = completed.succeeded
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN,
                "The Maa key action outcome could not be confirmed.",
                retryable=False,
            ) from error
        if not succeeded:
            raise MaaBackendError(
                MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN,
                "The Maa key action outcome could not be confirmed.",
                retryable=False,
            )

    async def _dispatch_start_app(
        self,
        controller: MaaController,
        intent: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        cancellation.raise_if_cancelled()
        try:
            job = await asyncio.to_thread(controller.post_start_app, intent)
            self._bind_controller_job(
                controller,
                job,
                AutomationOperationKind.APP_START,
                correlation,
            )
            completed = await asyncio.to_thread(job.wait)
            succeeded = completed.succeeded
        except (AttributeError, OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN,
                "The Maa application launch outcome could not be confirmed.",
                retryable=False,
            ) from error
        cancellation.raise_if_cancelled()
        if not succeeded:
            raise MaaBackendError(
                MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN,
                "The Maa application launch outcome could not be confirmed.",
                retryable=False,
            )

    async def _dispatch_long_press(
        self,
        controller: MaaController,
        point: RuntimePoint,
        duration_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        contact_active = False
        try:
            contact_active = True
            await self._dispatch_touch_job(
                controller,
                lambda: controller.post_touch_down(
                    point.x,
                    point.y,
                    contact=0,
                    pressure=TOUCH_PRESSURE,
                ),
                AutomationOperationKind.CLICK,
                correlation,
            )
            await _sleep_with_cancellation(duration_milliseconds, cancellation)
        finally:
            if contact_active:
                await self._dispatch_touch_job(
                    controller,
                    lambda: controller.post_touch_up(contact=0),
                    AutomationOperationKind.CLICK,
                    correlation,
                )
        cancellation.raise_if_cancelled()

    async def _dispatch_swipe(
        self,
        controller: MaaController,
        start: RuntimePoint,
        end: RuntimePoint,
        duration_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        cancellation.raise_if_cancelled()
        await self._dispatch_touch_job(
            controller,
            lambda: controller.post_swipe(
                start.x,
                start.y,
                end.x,
                end.y,
                duration_milliseconds,
                contact=0,
                pressure=TOUCH_PRESSURE,
            ),
            AutomationOperationKind.CLICK,
            correlation,
        )
        cancellation.raise_if_cancelled()

    async def _dispatch_multi_swipe(
        self,
        controller: MaaController,
        primary_start: RuntimePoint,
        primary_end: RuntimePoint,
        secondary_start: RuntimePoint,
        secondary_end: RuntimePoint,
        duration_milliseconds: int,
        secondary_start_delay_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        active_contacts: set[int] = set()
        gesture_completed = False
        try:
            active_contacts.add(0)
            await self._dispatch_touch_down(
                controller,
                primary_start,
                0,
                correlation,
            )
            if secondary_start_delay_milliseconds:
                await _sleep_with_cancellation(
                    secondary_start_delay_milliseconds,
                    cancellation,
                )
            active_contacts.add(1)
            await self._dispatch_touch_down(
                controller,
                secondary_start,
                1,
                correlation,
            )
            remaining_duration = max(
                1,
                duration_milliseconds - secondary_start_delay_milliseconds,
            )
            steps = min(
                MAXIMUM_MULTI_SWIPE_STEPS,
                max(1, remaining_duration // 16),
            )
            step_duration = remaining_duration / steps
            for step in range(1, steps + 1):
                cancellation.raise_if_cancelled()
                progress = step / steps
                await self._dispatch_touch_move(
                    controller,
                    _interpolate_point(primary_start, primary_end, progress),
                    0,
                    correlation,
                )
                await self._dispatch_touch_move(
                    controller,
                    _interpolate_point(secondary_start, secondary_end, progress),
                    1,
                    correlation,
                )
                if step < steps:
                    await _sleep_with_cancellation(
                        max(1, round(step_duration)),
                        cancellation,
                    )
            gesture_completed = True
        finally:
            for contact in sorted(active_contacts, reverse=True):
                if not gesture_completed:
                    with suppress(MaaBackendError):
                        await self._dispatch_touch_up(
                            controller,
                            contact,
                            correlation,
                        )
                else:
                    await self._dispatch_touch_up(
                        controller,
                        contact,
                        correlation,
                    )
        cancellation.raise_if_cancelled()

    async def _dispatch_touch_down(
        self,
        controller: MaaController,
        point: RuntimePoint,
        contact: int,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        await self._dispatch_touch_job(
            controller,
            lambda: controller.post_touch_down(
                point.x,
                point.y,
                contact=contact,
                pressure=TOUCH_PRESSURE,
            ),
            AutomationOperationKind.CLICK,
            correlation,
        )

    async def _dispatch_touch_move(
        self,
        controller: MaaController,
        point: RuntimePoint,
        contact: int,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        await self._dispatch_touch_job(
            controller,
            lambda: controller.post_touch_move(
                point.x,
                point.y,
                contact=contact,
                pressure=TOUCH_PRESSURE,
            ),
            AutomationOperationKind.CLICK,
            correlation,
        )

    async def _dispatch_touch_up(
        self,
        controller: MaaController,
        contact: int,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        await self._dispatch_touch_job(
            controller,
            lambda: controller.post_touch_up(contact=contact),
            AutomationOperationKind.CLICK,
            correlation,
        )

    async def _dispatch_touch_job(
        self,
        controller: MaaController,
        create_job: Callable[[], MaaJob],
        operation_kind: AutomationOperationKind,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        try:
            job = await asyncio.to_thread(create_job)
            self._bind_controller_job(
                controller,
                job,
                operation_kind,
                correlation,
            )
            completed = await asyncio.to_thread(job.wait)
            succeeded = completed.succeeded
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN,
                "The Maa touch action outcome could not be confirmed.",
                retryable=False,
            ) from error
        if not succeeded:
            raise MaaBackendError(
                MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN,
                "The Maa touch action outcome could not be confirmed.",
                retryable=False,
            )

    def _resolve_ocr_image(self, reference: RuntimeImageReference) -> ImageArtifact:
        try:
            return self._image_artifacts.resolve(reference)
        except ImageArtifactError as error:
            raise MaaBackendError(
                MaaBackendErrorCode.OCR_RESULT_INVALID,
                "The OCR image reference is unavailable or invalid.",
                retryable=False,
            ) from error

    def _resolve_match_image(self, reference: RuntimeImageReference) -> ImageArtifact:
        try:
            return self._image_artifacts.resolve(reference)
        except ImageArtifactError as error:
            raise MaaBackendError(
                MaaBackendErrorCode.RECOGNITION_RESULT_INVALID,
                "The image recognition reference is unavailable or invalid.",
                retryable=False,
            ) from error

    async def _deactivate_after_failed_connection(
        self,
        controller: MaaController,
    ) -> None:
        try:
            await self._deactivate_controller(controller)
        except MaaBackendError:
            pass
        finally:
            if self._callback_binding is not None:
                self._callback_binding.release_controller_callbacks(controller)

    def _bind_controller_job(
        self,
        controller: MaaController,
        job: MaaJob,
        operation_kind: AutomationOperationKind,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        if self._callback_binding is not None:
            self._callback_binding.bind_controller_operation(
                controller,
                job.job_id,
                operation_kind,
                correlation,
            )

    def _new_device_key(self) -> str:
        device_key = self._device_key_factory()
        if not device_key.strip() or len(device_key) > 256:
            raise ValueError("Device key factories must return a bounded opaque key.")
        if device_key in self._records:
            raise ValueError("Device key factories must return unique keys.")
        return device_key

    def _new_coordinate_space_id(self) -> str:
        coordinate_space_id = self._coordinate_space_factory()
        if not coordinate_space_id.strip() or len(coordinate_space_id) > 256:
            raise ValueError(
                "Coordinate-space factories must return bounded opaque keys."
            )
        if any(
            record.coordinate_space_id == coordinate_space_id
            for record in self._records.values()
        ):
            raise ValueError("Coordinate-space factories must return unique keys.")
        return coordinate_space_id

    def _require_record(self, device_key: str) -> _DeviceRecord:
        record = self._records.get(device_key)
        if record is None:
            raise MaaBackendError(
                MaaBackendErrorCode.DEVICE_NOT_FOUND,
                "The opaque device key is not valid for this sidecar generation.",
                retryable=True,
            )
        return record

    def _remove_absent_available_records(self) -> None:
        absent = [
            key
            for key, record in self._records.items()
            if not record.present and record.controller is None
        ]
        for key in absent:
            del self._records[key]

    def _ensure_open(self) -> None:
        if self._closed:
            raise MaaBackendError(
                MaaBackendErrorCode.SERVICE_CLOSED,
                "The Maa device service is closed.",
                retryable=False,
            )


def _validate_ocr_region(
    roi: RuntimeRect | None,
    image_width: int,
    image_height: int,
) -> tuple[int, int, int, int]:
    if roi is None:
        return (0, 0, 0, 0)
    if (
        roi.x < 0
        or roi.y < 0
        or roi.width <= 0
        or roi.height <= 0
        or roi.x + roi.width > image_width
        or roi.y + roi.height > image_height
    ):
        raise MaaBackendError(
            MaaBackendErrorCode.OCR_RESULT_INVALID,
            "The OCR region is outside the source image.",
            retryable=False,
        )
    return (roi.x, roi.y, roi.width, roi.height)


def _validate_match_region(
    roi: RuntimeRect | None,
    image_width: int,
    image_height: int,
) -> tuple[int, int, int, int]:
    if roi is None:
        return (0, 0, 0, 0)
    if (
        roi.x < 0
        or roi.y < 0
        or roi.width <= 0
        or roi.height <= 0
        or roi.x + roi.width > image_width
        or roi.y + roi.height > image_height
    ):
        raise MaaBackendError(
            MaaBackendErrorCode.RECOGNITION_RESULT_INVALID,
            "The image recognition region is outside the source image.",
            retryable=False,
        )
    return (roi.x, roi.y, roi.width, roi.height)


def _is_supported_capture_array(pixels: object) -> TypeGuard[NDArray[np.uint8]]:
    if not isinstance(pixels, np.ndarray):
        return False
    array = cast(NDArray[np.generic], pixels)
    if array.dtype != np.dtype(np.uint8):
        return False
    if array.ndim not in {2, 3} or int(array.shape[0]) <= 0:
        return False
    if int(array.shape[1]) <= 0:
        return False
    return array.ndim == 2 or int(array.shape[2]) in {1, 3, 4}


def _validate_touch_duration(duration_milliseconds: int) -> None:
    if (
        not _is_runtime_integer(duration_milliseconds)
        or duration_milliseconds < 1
        or duration_milliseconds > MAXIMUM_TOUCH_DURATION_MILLISECONDS
    ):
        raise _rejected_action("The touch duration is outside the supported range.")


def _interpolate_point(
    start: RuntimePoint,
    end: RuntimePoint,
    progress: float,
) -> RuntimePoint:
    return RuntimePoint(
        x=round(start.x + (end.x - start.x) * progress),
        y=round(start.y + (end.y - start.y) * progress),
        coordinate_space_id=start.coordinate_space_id,
        source_generation=start.source_generation,
    )


async def _sleep_with_cancellation(
    duration_milliseconds: int,
    cancellation: CancellationProbe,
) -> None:
    deadline = asyncio.get_running_loop().time() + duration_milliseconds / 1000
    while True:
        cancellation.raise_if_cancelled()
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            return
        await asyncio.sleep(min(remaining, 0.016))


def _validate_action_point(point: RuntimePoint, record: _DeviceRecord) -> None:
    _validate_action_coordinate_space(
        point.coordinate_space_id,
        point.source_generation,
        record,
    )
    width, height = _require_coordinate_dimensions(record)
    if (
        not _is_runtime_integer(point.x)
        or not _is_runtime_integer(point.y)
        or point.x < 0
        or point.y < 0
        or point.x >= width
        or point.y >= height
    ):
        raise _rejected_action("The click point is outside the current device frame.")


def _validate_action_rect(rect: RuntimeRect, record: _DeviceRecord) -> None:
    _validate_action_coordinate_space(
        rect.coordinate_space_id,
        rect.source_generation,
        record,
    )
    width, height = _require_coordinate_dimensions(record)
    values = (rect.x, rect.y, rect.width, rect.height)
    if any(not _is_runtime_integer(value) for value in values):
        raise _rejected_action("The click rectangle contains invalid coordinates.")
    if (
        rect.x < 0
        or rect.y < 0
        or rect.width <= 0
        or rect.height <= 0
        or rect.x + rect.width > width
        or rect.y + rect.height > height
    ):
        raise _rejected_action(
            "The click rectangle is outside the current device frame."
        )


def _validate_action_coordinate_space(
    coordinate_space_id: str | None,
    source_generation: int | None,
    record: _DeviceRecord,
) -> None:
    if coordinate_space_id is None or coordinate_space_id != record.coordinate_space_id:
        raise _rejected_action("The click coordinates are stale or unbound.")
    generation: object = source_generation
    if (
        not isinstance(generation, int)
        or isinstance(generation, bool)
        or generation <= 0
    ):
        raise _rejected_action("The click coordinates lack a valid source generation.")


def _is_runtime_integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _require_coordinate_dimensions(record: _DeviceRecord) -> tuple[int, int]:
    if record.coordinate_width is None or record.coordinate_height is None:
        raise _rejected_action("The device frame dimensions are not established.")
    return (record.coordinate_width, record.coordinate_height)


def _rejected_action(detail: str) -> MaaBackendError:
    return MaaBackendError(
        MaaBackendErrorCode.ACTION_REJECTED,
        detail,
        retryable=False,
    )


async def _recognize_with_cancellation(
    session: MaaOcrSession,
    pixels: NDArray[np.uint8],
    roi: tuple[int, int, int, int],
    confidence_threshold: float,
    cancellation: CancellationProbe,
    correlation: AutomationOperationCorrelation | None,
) -> MaaOcrSnapshot:
    cancellation.raise_if_cancelled()
    worker = asyncio.create_task(
        asyncio.to_thread(
            session.recognize,
            pixels,
            roi=roi,
            confidence_threshold=confidence_threshold,
            correlation=correlation,
        )
    )
    if not isinstance(cancellation, CancellationSignal):
        try:
            result = await worker
        except asyncio.CancelledError:
            await asyncio.to_thread(session.stop)
            raise
        cancellation.raise_if_cancelled()
        return result

    cancellation_task = asyncio.create_task(cancellation.wait_cancelled())
    try:
        completed, _ = await asyncio.wait(
            (worker, cancellation_task),
            return_when=asyncio.FIRST_COMPLETED,
        )
        if cancellation_task in completed:
            await asyncio.to_thread(session.stop)
            await asyncio.gather(worker, return_exceptions=True)
            cancellation.raise_if_cancelled()
            raise RuntimeError("Cancellation completed without a cancelled state.")
        result = await worker
        cancellation.raise_if_cancelled()
        return result
    except asyncio.CancelledError:
        await asyncio.to_thread(session.stop)
        raise
    finally:
        if not cancellation_task.done():
            cancellation_task.cancel()
        with suppress(asyncio.CancelledError):
            await cancellation_task


async def _match_with_cancellation(
    session: MaaRecognitionSession,
    operation: Callable[[], MaaMatchSnapshot],
    cancellation: CancellationProbe,
) -> MaaMatchSnapshot:
    cancellation.raise_if_cancelled()
    worker = asyncio.create_task(asyncio.to_thread(operation))
    if not isinstance(cancellation, CancellationSignal):
        try:
            result = await worker
        except asyncio.CancelledError:
            await asyncio.to_thread(session.stop)
            raise
        cancellation.raise_if_cancelled()
        return result

    cancellation_task = asyncio.create_task(cancellation.wait_cancelled())
    try:
        completed, _ = await asyncio.wait(
            (worker, cancellation_task),
            return_when=asyncio.FIRST_COMPLETED,
        )
        if cancellation_task in completed:
            await asyncio.to_thread(session.stop)
            await asyncio.gather(worker, return_exceptions=True)
            cancellation.raise_if_cancelled()
            raise RuntimeError("Cancellation completed without a cancelled state.")
        result = await worker
        cancellation.raise_if_cancelled()
        return result
    except asyncio.CancelledError:
        await asyncio.to_thread(session.stop)
        raise
    finally:
        if not cancellation_task.done():
            cancellation_task.cancel()
        with suppress(asyncio.CancelledError):
            await cancellation_task
