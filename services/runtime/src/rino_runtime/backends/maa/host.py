"""Synchronous request host for the asynchronous Maa device service."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable, Coroutine
from concurrent.futures import TimeoutError as FutureTimeoutError
from contextlib import suppress
from typing import Final, TypeVar

from rino_runtime.artifacts import (
    CaptureArtifactDescriptor,
    CaptureRegion,
    PreviewArtifactDescriptor,
)
from rino_runtime.backends.android_actions import AndroidKey
from rino_runtime.backends.base import (
    AutomationDeviceDescriptor,
    AutomationOperationCorrelation,
    AutomationRuntimeEventSink,
    AutomationRuntimeInfo,
    DeviceControlKey,
    DeviceServiceError,
    DeviceServiceErrorCode,
)
from rino_runtime.backends.maa.devices import MaaDeviceService
from rino_runtime.backends.maa.errors import MaaBackendError, MaaBackendErrorCode
from rino_runtime.execution_control import (
    CancellationProbe,
    CancellationSignal,
    NeverCancelled,
)
from rino_runtime.nodes.execution import (
    RuntimeImageReference,
    RuntimeMatchResult,
    RuntimeOcrResult,
    RuntimePoint,
    RuntimeRect,
)

INITIALIZATION_TIMEOUT_SECONDS: Final[float] = 15.0
DISCOVERY_TIMEOUT_SECONDS: Final[float] = 15.0
CONNECTION_TIMEOUT_SECONDS: Final[float] = 30.0
CAPTURE_TIMEOUT_SECONDS: Final[float] = 15.0
OCR_TIMEOUT_SECONDS: Final[float] = 30.0
RECOGNITION_TIMEOUT_SECONDS: Final[float] = 30.0
ACTION_TIMEOUT_SECONDS: Final[float] = 15.0
SHUTDOWN_TIMEOUT_SECONDS: Final[float] = 5.0

_Result = TypeVar("_Result")

_ERROR_CODES: Final[dict[MaaBackendErrorCode, DeviceServiceErrorCode]] = {
    MaaBackendErrorCode.BINDING_UNAVAILABLE: DeviceServiceErrorCode.BACKEND_UNAVAILABLE,
    MaaBackendErrorCode.VERSION_MISMATCH: DeviceServiceErrorCode.BACKEND_UNAVAILABLE,
    MaaBackendErrorCode.INITIALIZATION_FAILED: (
        DeviceServiceErrorCode.BACKEND_UNAVAILABLE
    ),
    MaaBackendErrorCode.NOT_INITIALIZED: DeviceServiceErrorCode.BACKEND_UNAVAILABLE,
    MaaBackendErrorCode.DEVICE_DISCOVERY_FAILED: (
        DeviceServiceErrorCode.DISCOVERY_FAILED
    ),
    MaaBackendErrorCode.DEVICE_NOT_FOUND: DeviceServiceErrorCode.NOT_FOUND,
    MaaBackendErrorCode.DEVICE_NOT_CONNECTED: DeviceServiceErrorCode.NOT_CONNECTED,
    MaaBackendErrorCode.DEVICE_CONNECTION_FAILED: (
        DeviceServiceErrorCode.CONNECTION_FAILED
    ),
    MaaBackendErrorCode.DEVICE_CONNECTION_LOST: (
        DeviceServiceErrorCode.CONNECTION_LOST
    ),
    MaaBackendErrorCode.DEVICE_DEACTIVATION_FAILED: (
        DeviceServiceErrorCode.DEACTIVATION_FAILED
    ),
    MaaBackendErrorCode.SCREEN_CAPTURE_FAILED: DeviceServiceErrorCode.CAPTURE_FAILED,
    MaaBackendErrorCode.SCREEN_CAPTURE_INVALID: DeviceServiceErrorCode.CAPTURE_INVALID,
    MaaBackendErrorCode.SCREEN_CAPTURE_TOO_LARGE: (
        DeviceServiceErrorCode.CAPTURE_TOO_LARGE
    ),
    MaaBackendErrorCode.OCR_UNAVAILABLE: DeviceServiceErrorCode.OCR_UNAVAILABLE,
    MaaBackendErrorCode.OCR_MODEL_INVALID: (DeviceServiceErrorCode.BACKEND_UNAVAILABLE),
    MaaBackendErrorCode.OCR_MODEL_LOAD_FAILED: (
        DeviceServiceErrorCode.BACKEND_UNAVAILABLE
    ),
    MaaBackendErrorCode.OCR_SESSION_FAILED: DeviceServiceErrorCode.OCR_UNAVAILABLE,
    MaaBackendErrorCode.OCR_RECOGNITION_FAILED: DeviceServiceErrorCode.OCR_FAILED,
    MaaBackendErrorCode.OCR_RESULT_INVALID: (DeviceServiceErrorCode.OCR_RESULT_INVALID),
    MaaBackendErrorCode.RECOGNITION_UNAVAILABLE: (
        DeviceServiceErrorCode.RECOGNITION_UNAVAILABLE
    ),
    MaaBackendErrorCode.RECOGNITION_SESSION_FAILED: (
        DeviceServiceErrorCode.RECOGNITION_UNAVAILABLE
    ),
    MaaBackendErrorCode.RECOGNITION_FAILED: DeviceServiceErrorCode.RECOGNITION_FAILED,
    MaaBackendErrorCode.RECOGNITION_RESULT_INVALID: (
        DeviceServiceErrorCode.RECOGNITION_RESULT_INVALID
    ),
    MaaBackendErrorCode.ACTION_REJECTED: DeviceServiceErrorCode.ACTION_REJECTED,
    MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN: (
        DeviceServiceErrorCode.ACTION_OUTCOME_UNKNOWN
    ),
    MaaBackendErrorCode.PREVIEW_UNAVAILABLE: (
        DeviceServiceErrorCode.PREVIEW_UNAVAILABLE
    ),
    MaaBackendErrorCode.PREVIEW_ENCODE_FAILED: (
        DeviceServiceErrorCode.PREVIEW_ENCODE_FAILED
    ),
    MaaBackendErrorCode.PREVIEW_TOO_LARGE: DeviceServiceErrorCode.PREVIEW_TOO_LARGE,
    MaaBackendErrorCode.PREVIEW_STORAGE_FAILED: (
        DeviceServiceErrorCode.PREVIEW_STORAGE_FAILED
    ),
    MaaBackendErrorCode.CAPTURE_ARTIFACT_UNAVAILABLE: (
        DeviceServiceErrorCode.CAPTURE_ARTIFACT_UNAVAILABLE
    ),
    MaaBackendErrorCode.CAPTURE_ARTIFACT_INVALID: (
        DeviceServiceErrorCode.CAPTURE_ARTIFACT_INVALID
    ),
    MaaBackendErrorCode.CAPTURE_ARTIFACT_ENCODE_FAILED: (
        DeviceServiceErrorCode.CAPTURE_ARTIFACT_ENCODE_FAILED
    ),
    MaaBackendErrorCode.CAPTURE_ARTIFACT_TOO_LARGE: (
        DeviceServiceErrorCode.CAPTURE_ARTIFACT_TOO_LARGE
    ),
    MaaBackendErrorCode.CAPTURE_ARTIFACT_STORAGE_FAILED: (
        DeviceServiceErrorCode.CAPTURE_ARTIFACT_STORAGE_FAILED
    ),
    MaaBackendErrorCode.SERVICE_CLOSED: DeviceServiceErrorCode.SERVICE_CLOSED,
    MaaBackendErrorCode.OPERATION_TIMEOUT: DeviceServiceErrorCode.OPERATION_TIMEOUT,
}


class MaaDeviceServiceHost:
    """Runs every Maa device coroutine on one dedicated event-loop thread."""

    def __init__(self, service: MaaDeviceService) -> None:
        self._service = service
        self._loop = asyncio.new_event_loop()
        self._started = threading.Event()
        self._state_lock = threading.Lock()
        self._closed = False
        self._thread = threading.Thread(
            target=self._run_loop,
            name="rino-maa-device-service",
            daemon=True,
        )
        self._thread.start()
        if not self._started.wait(timeout=INITIALIZATION_TIMEOUT_SECONDS):
            self._stop_loop()
            raise DeviceServiceError(
                DeviceServiceErrorCode.OPERATION_TIMEOUT,
                "The Maa device event loop did not start within the limit.",
                retryable=True,
            )
        try:
            runtime_info = self._execute(
                service.initialize(),
                timeout=INITIALIZATION_TIMEOUT_SECONDS,
            )
        except BaseException:
            self._stop_loop()
            raise
        self._runtime_info = AutomationRuntimeInfo(
            backend_key="maa",
            binding_version=runtime_info.framework_package_version,
            native_version=runtime_info.framework_runtime_version.removeprefix("v"),
        )

    @property
    def runtime_info(self) -> AutomationRuntimeInfo:
        return self._runtime_info

    @property
    def ocr_available(self) -> bool:
        return self._service.ocr_available

    @property
    def recognition_available(self) -> bool:
        return self._service.recognition_available

    def list_devices(self) -> tuple[AutomationDeviceDescriptor, ...]:
        return self._execute(
            self._service.discover(),
            timeout=DISCOVERY_TIMEOUT_SECONDS,
        )

    def connect(
        self,
        device_key: str,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> AutomationDeviceDescriptor:
        return self._execute(
            self._service.connect(device_key, correlation),
            timeout=CONNECTION_TIMEOUT_SECONDS,
        )

    def disconnect(
        self,
        device_key: str,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> AutomationDeviceDescriptor:
        return self._execute(
            self._service.disconnect(device_key, correlation),
            timeout=CONNECTION_TIMEOUT_SECONDS,
        )

    def control_click(
        self,
        device_key: str,
        point: RuntimePoint,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        self._click_point(device_key, point, correlation)

    def control_long_press(
        self,
        device_key: str,
        point: RuntimePoint,
        duration_milliseconds: int,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        self._long_press(
            device_key,
            point,
            duration_milliseconds,
            NeverCancelled(),
            correlation,
        )

    def control_swipe(
        self,
        device_key: str,
        start: RuntimePoint,
        end: RuntimePoint,
        duration_milliseconds: int,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        self._swipe(
            device_key,
            start,
            end,
            duration_milliseconds,
            NeverCancelled(),
            correlation,
        )

    def control_key(
        self,
        device_key: str,
        key: DeviceControlKey,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        if key is not DeviceControlKey.BACK:
            raise DeviceServiceError(
                DeviceServiceErrorCode.ACTION_REJECTED,
                "The requested device key is not allowlisted.",
                retryable=False,
            )
        self._press_back(device_key, correlation)

    def set_operation_event_sink(
        self,
        sink: AutomationRuntimeEventSink | None,
    ) -> None:
        self._service.set_operation_event_sink(sink)

    async def capture_screen(
        self,
        device_key: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeImageReference:
        cancellation.raise_if_cancelled()
        reference = await asyncio.to_thread(
            self._capture_screen,
            device_key,
            correlation,
        )
        cancellation.raise_if_cancelled()
        return reference

    async def recognize_ocr(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        confidence_threshold: float,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeOcrResult:
        cancellation.raise_if_cancelled()
        worker = asyncio.create_task(
            asyncio.to_thread(
                self._recognize_ocr,
                device_key,
                image,
                roi,
                confidence_threshold,
                correlation,
            )
        )
        return await self._await_recognition_worker(
            device_key,
            worker,
            cancellation,
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
        cancellation.raise_if_cancelled()
        worker = asyncio.create_task(
            asyncio.to_thread(
                self._recognize_template_match,
                device_key,
                image,
                template,
                roi,
                threshold,
                method,
                green_mask,
                correlation,
            )
        )
        return await self._await_recognition_worker(
            device_key,
            worker,
            cancellation,
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
        cancellation.raise_if_cancelled()
        worker = asyncio.create_task(
            asyncio.to_thread(
                self._recognize_feature_match,
                device_key,
                image,
                template,
                roi,
                detector,
                minimum_count,
                ratio,
                green_mask,
                correlation,
            )
        )
        return await self._await_recognition_worker(
            device_key,
            worker,
            cancellation,
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
        cancellation.raise_if_cancelled()
        worker = asyncio.create_task(
            asyncio.to_thread(
                self._recognize_color_match,
                device_key,
                image,
                roi,
                lower,
                upper,
                method,
                minimum_count,
                connected,
                correlation,
            )
        )
        return await self._await_recognition_worker(
            device_key,
            worker,
            cancellation,
        )

    async def _await_recognition_worker(
        self,
        device_key: str,
        worker: asyncio.Task[_Result],
        cancellation: CancellationProbe,
    ) -> _Result:
        if not isinstance(cancellation, CancellationSignal):
            try:
                result = await worker
            except asyncio.CancelledError:
                await asyncio.to_thread(self._stop_ocr, device_key)
                await asyncio.gather(worker, return_exceptions=True)
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
                await asyncio.to_thread(self._stop_ocr, device_key)
                await asyncio.gather(worker, return_exceptions=True)
                cancellation.raise_if_cancelled()
                raise RuntimeError("Cancellation completed without a cancelled state.")
            result = await worker
            cancellation.raise_if_cancelled()
            return result
        except asyncio.CancelledError:
            await asyncio.to_thread(self._stop_ocr, device_key)
            raise
        finally:
            if not cancellation_task.done():
                cancellation_task.cancel()
            with suppress(asyncio.CancelledError):
                await cancellation_task

    async def click_point(
        self,
        device_key: str,
        point: RuntimePoint,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        cancellation.raise_if_cancelled()
        worker = asyncio.create_task(
            asyncio.to_thread(self._click_point, device_key, point, correlation)
        )
        try:
            await asyncio.shield(worker)
        except asyncio.CancelledError:
            await asyncio.gather(worker, return_exceptions=True)
            raise

    async def click_rect_center(
        self,
        device_key: str,
        rect: RuntimeRect,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        cancellation.raise_if_cancelled()
        worker = asyncio.create_task(
            asyncio.to_thread(
                self._click_rect_center,
                device_key,
                rect,
                correlation,
            )
        )
        try:
            await asyncio.shield(worker)
        except asyncio.CancelledError:
            await asyncio.gather(worker, return_exceptions=True)
            raise

    async def launch_android_app(
        self,
        device_key: str,
        intent: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        await self._run_action_worker(
            cancellation,
            self._launch_android_app,
            device_key,
            intent,
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
        await self._run_action_worker(
            cancellation,
            self._press_android_key,
            device_key,
            key,
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
        await self._run_action_worker(
            cancellation,
            self._long_press,
            device_key,
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
        await self._run_action_worker(
            cancellation,
            self._swipe,
            device_key,
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
        await self._run_action_worker(
            cancellation,
            self._multi_swipe,
            device_key,
            primary_start,
            primary_end,
            secondary_start,
            secondary_end,
            duration_milliseconds,
            secondary_start_delay_milliseconds,
            cancellation,
            correlation,
        )

    async def _run_action_worker(
        self,
        cancellation: CancellationProbe,
        operation: Callable[..., None],
        *arguments: object,
    ) -> None:
        cancellation.raise_if_cancelled()
        worker = asyncio.create_task(asyncio.to_thread(operation, *arguments))
        try:
            await asyncio.shield(worker)
        except asyncio.CancelledError:
            await asyncio.gather(worker, return_exceptions=True)
            raise

    def release_image(self, handle_id: str) -> bool:
        return self._service.release_image(handle_id)

    def capture_preview(
        self,
        device_key: str,
        maximum_width: int,
        maximum_height: int,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> PreviewArtifactDescriptor:
        return self._execute(
            self._service.capture_preview(
                device_key,
                maximum_width,
                maximum_height,
                correlation,
            ),
            timeout=CAPTURE_TIMEOUT_SECONDS,
        )

    def prepare_capture(
        self,
        preview_token: str,
        region: CaptureRegion | None,
    ) -> CaptureArtifactDescriptor:
        return self._execute(
            self._service.prepare_capture(preview_token, region),
            timeout=CAPTURE_TIMEOUT_SECONDS,
        )

    def prepare_project_asset(
        self,
        asset_token: str,
        content_hash: str,
        byte_length: int,
        width: int,
        height: int,
        coordinate_space_id: str,
    ) -> RuntimeImageReference:
        return self._execute(
            self._service.prepare_project_asset(
                asset_token,
                content_hash,
                byte_length,
                width,
                height,
                coordinate_space_id,
            ),
            timeout=CAPTURE_TIMEOUT_SECONDS,
        )

    def release_capture(self, capture_token: str) -> bool:
        return self._service.release_capture(capture_token)

    def release_preview(self, preview_token: str) -> bool:
        return self._service.release_preview(preview_token)

    def close(self) -> tuple[DeviceServiceErrorCode, ...]:
        with self._state_lock:
            if self._closed:
                return ()
            self._closed = True
        try:
            failures = self._execute_unchecked(
                self._service.close(),
                timeout=SHUTDOWN_TIMEOUT_SECONDS,
            )
            normalized = tuple(_ERROR_CODES[code] for code in failures)
        except DeviceServiceError as error:
            normalized = (error.code,)
        if not self._stop_loop():
            normalized = (*normalized, DeviceServiceErrorCode.OPERATION_TIMEOUT)
        return normalized

    def _capture_screen(
        self,
        device_key: str,
        correlation: AutomationOperationCorrelation | None,
    ) -> RuntimeImageReference:
        return self._execute(
            self._service.capture_screen(
                device_key,
                cancellation=NeverCancelled(),
                correlation=correlation,
            ),
            timeout=CAPTURE_TIMEOUT_SECONDS,
        )

    def _recognize_ocr(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        confidence_threshold: float,
        correlation: AutomationOperationCorrelation | None,
    ) -> RuntimeOcrResult:
        try:
            return self._execute(
                self._service.recognize_ocr(
                    device_key,
                    image,
                    roi,
                    confidence_threshold,
                    NeverCancelled(),
                    correlation,
                ),
                timeout=OCR_TIMEOUT_SECONDS,
            )
        except DeviceServiceError as error:
            if error.code is DeviceServiceErrorCode.OPERATION_TIMEOUT:
                with suppress(DeviceServiceError):
                    self._stop_ocr(device_key)
            raise

    def _recognize_template_match(
        self,
        device_key: str,
        image: RuntimeImageReference,
        template: RuntimeImageReference,
        roi: RuntimeRect | None,
        threshold: float,
        method: int,
        green_mask: bool,
        correlation: AutomationOperationCorrelation | None,
    ) -> RuntimeMatchResult:
        return self._execute(
            self._service.recognize_template_match(
                device_key,
                image,
                template,
                roi,
                threshold,
                method,
                green_mask,
                NeverCancelled(),
                correlation,
            ),
            timeout=RECOGNITION_TIMEOUT_SECONDS,
        )

    def _recognize_feature_match(
        self,
        device_key: str,
        image: RuntimeImageReference,
        template: RuntimeImageReference,
        roi: RuntimeRect | None,
        detector: str,
        minimum_count: int,
        ratio: float,
        green_mask: bool,
        correlation: AutomationOperationCorrelation | None,
    ) -> RuntimeMatchResult:
        return self._execute(
            self._service.recognize_feature_match(
                device_key,
                image,
                template,
                roi,
                detector,
                minimum_count,
                ratio,
                green_mask,
                NeverCancelled(),
                correlation,
            ),
            timeout=RECOGNITION_TIMEOUT_SECONDS,
        )

    def _recognize_color_match(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        lower: tuple[int, ...],
        upper: tuple[int, ...],
        method: int,
        minimum_count: int,
        connected: bool,
        correlation: AutomationOperationCorrelation | None,
    ) -> RuntimeMatchResult:
        return self._execute(
            self._service.recognize_color_match(
                device_key,
                image,
                roi,
                lower,
                upper,
                method,
                minimum_count,
                connected,
                NeverCancelled(),
                correlation,
            ),
            timeout=RECOGNITION_TIMEOUT_SECONDS,
        )

    def _stop_ocr(self, device_key: str) -> bool:
        return self._execute(
            self._service.stop_ocr(device_key),
            timeout=SHUTDOWN_TIMEOUT_SECONDS,
        )

    def _click_point(
        self,
        device_key: str,
        point: RuntimePoint,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        self._execute_action(
            self._service.click_point(
                device_key,
                point,
                NeverCancelled(),
                correlation,
            )
        )

    def _click_rect_center(
        self,
        device_key: str,
        rect: RuntimeRect,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        self._execute_action(
            self._service.click_rect_center(
                device_key,
                rect,
                NeverCancelled(),
                correlation,
            )
        )

    def _press_back(
        self,
        device_key: str,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        self._execute_action(
            self._service.press_back(device_key, NeverCancelled(), correlation)
        )

    def _launch_android_app(
        self,
        device_key: str,
        intent: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        self._execute_action(
            self._service.launch_android_app(
                device_key,
                intent,
                cancellation,
                correlation,
            )
        )

    def _press_android_key(
        self,
        device_key: str,
        key: AndroidKey,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        self._execute_action(
            self._service.press_android_key(
                device_key,
                key,
                cancellation,
                correlation,
            )
        )

    def _long_press(
        self,
        device_key: str,
        point: RuntimePoint,
        duration_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        self._execute_action(
            self._service.long_press(
                device_key,
                point,
                duration_milliseconds,
                cancellation,
                correlation,
            )
        )

    def _swipe(
        self,
        device_key: str,
        start: RuntimePoint,
        end: RuntimePoint,
        duration_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        self._execute_action(
            self._service.swipe(
                device_key,
                start,
                end,
                duration_milliseconds,
                cancellation,
                correlation,
            )
        )

    def _multi_swipe(
        self,
        device_key: str,
        primary_start: RuntimePoint,
        primary_end: RuntimePoint,
        secondary_start: RuntimePoint,
        secondary_end: RuntimePoint,
        duration_milliseconds: int,
        secondary_start_delay_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        self._execute_action(
            self._service.multi_swipe(
                device_key,
                primary_start,
                primary_end,
                secondary_start,
                secondary_end,
                duration_milliseconds,
                secondary_start_delay_milliseconds,
                cancellation,
                correlation,
            )
        )

    def _execute_action(self, operation: Coroutine[object, object, None]) -> None:
        try:
            self._execute(operation, timeout=ACTION_TIMEOUT_SECONDS)
        except DeviceServiceError as error:
            if error.code is DeviceServiceErrorCode.OPERATION_TIMEOUT:
                raise DeviceServiceError(
                    DeviceServiceErrorCode.ACTION_OUTCOME_UNKNOWN,
                    "The device action exceeded its confirmation timeout.",
                    retryable=False,
                ) from error
            raise

    def _execute(
        self,
        operation: Coroutine[object, object, _Result],
        *,
        timeout: float,
    ) -> _Result:
        with self._state_lock:
            if self._closed:
                operation.close()
                raise DeviceServiceError(
                    DeviceServiceErrorCode.SERVICE_CLOSED,
                    "The device service host is closed.",
                    retryable=False,
                )
        return self._execute_unchecked(operation, timeout=timeout)

    def _execute_unchecked(
        self,
        operation: Coroutine[object, object, _Result],
        *,
        timeout: float,
    ) -> _Result:
        try:
            future = asyncio.run_coroutine_threadsafe(operation, self._loop)
        except RuntimeError as error:
            operation.close()
            raise DeviceServiceError(
                DeviceServiceErrorCode.SERVICE_CLOSED,
                "The device service event loop is unavailable.",
                retryable=False,
            ) from error
        try:
            return future.result(timeout=timeout)
        except FutureTimeoutError as error:
            future.cancel()
            raise DeviceServiceError(
                DeviceServiceErrorCode.OPERATION_TIMEOUT,
                "The device operation exceeded its bounded wait time.",
                retryable=True,
            ) from error
        except MaaBackendError as error:
            raise DeviceServiceError(
                _ERROR_CODES[error.code],
                error.technical_detail,
                retryable=error.retryable,
            ) from error

    def _run_loop(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._started.set()
        self._loop.run_forever()
        pending = asyncio.all_tasks(self._loop)
        for task in pending:
            task.cancel()
        if pending:
            self._loop.run_until_complete(
                asyncio.gather(*pending, return_exceptions=True)
            )
        asyncio.set_event_loop(None)
        self._loop.close()

    def _stop_loop(self) -> bool:
        if not self._loop.is_closed():
            with suppress(RuntimeError):
                self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread.is_alive() and self._thread is not threading.current_thread():
            self._thread.join(timeout=SHUTDOWN_TIMEOUT_SECONDS)
        return not self._thread.is_alive()
