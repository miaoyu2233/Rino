"""Rino-owned automation backend protocol used by production node executors."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Protocol
from uuid import UUID

from rino_runtime.backends.android_actions import AndroidKey

if TYPE_CHECKING:
    from rino_runtime.artifacts import (
        CaptureArtifactDescriptor,
        CaptureRegion,
        PreviewArtifactDescriptor,
    )
    from rino_runtime.execution_control import CancellationProbe
    from rino_runtime.nodes.execution import (
        RuntimeImageReference,
        RuntimeMatchResult,
        RuntimeOcrResult,
        RuntimePoint,
        RuntimeRect,
    )


class AutomationDeviceState(StrEnum):
    AVAILABLE = "available"
    CONNECTED = "connected"
    CONNECTION_LOST = "connectionLost"


class DeviceControlKey(StrEnum):
    BACK = "back"


@dataclass(frozen=True, slots=True)
class AutomationDeviceDescriptor:
    device_key: str
    display_name: str
    controller_family: str
    state: AutomationDeviceState


@dataclass(frozen=True, slots=True)
class AutomationRuntimeInfo:
    backend_key: str
    binding_version: str
    native_version: str


class AutomationOperationSource(StrEnum):
    CONTROLLER = "controller"
    TASKER = "tasker"


class AutomationOperationKind(StrEnum):
    DEVICE_CONNECT = "deviceConnect"
    DEVICE_DISCONNECT = "deviceDisconnect"
    SCREEN_CAPTURE = "screenCapture"
    OCR = "ocr"
    OCR_STOP = "ocrStop"
    TEMPLATE_MATCH = "templateMatch"
    FEATURE_MATCH = "featureMatch"
    COLOR_MATCH = "colorMatch"
    CLICK = "click"
    KEY_PRESS = "keyPress"
    APP_START = "appStart"


class AutomationOperationState(StrEnum):
    STARTING = "starting"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class AutomationOperationCorrelation:
    request_id: UUID | None = None
    run_id: UUID | None = None
    node_id: UUID | None = None
    activation_id: int | None = None

    def __post_init__(self) -> None:
        if self.activation_id is not None and self.activation_id < 1:
            raise ValueError("An automation activation identifier must be positive.")


@dataclass(frozen=True, slots=True)
class AutomationOperationEvent:
    source: AutomationOperationSource
    state: AutomationOperationState
    operation_kind: AutomationOperationKind
    backend_operation_id: int
    backend_generation: int
    callback_sequence: int
    observed_at_milliseconds: int
    correlation: AutomationOperationCorrelation


class AutomationCallbackDiagnosticCode(StrEnum):
    MALFORMED_CALLBACK = "AUTOMATION_CALLBACK_MALFORMED"
    UNSUPPORTED_CALLBACK = "AUTOMATION_CALLBACK_UNSUPPORTED"
    QUEUE_OVERFLOW = "AUTOMATION_CALLBACK_QUEUE_OVERFLOW"
    CORRELATION_OVERFLOW = "AUTOMATION_CALLBACK_CORRELATION_OVERFLOW"
    UNMATCHED_OPERATION = "AUTOMATION_CALLBACK_OPERATION_UNMATCHED"
    STALE_GENERATION = "AUTOMATION_CALLBACK_GENERATION_STALE"
    EVENT_SINK_FAILED = "AUTOMATION_CALLBACK_EVENT_SINK_FAILED"


@dataclass(frozen=True, slots=True)
class AutomationCallbackDiagnostic:
    code: AutomationCallbackDiagnosticCode
    count: int
    backend_generation: int
    latest_callback_sequence: int | None = None


type AutomationRuntimeEvent = AutomationOperationEvent | AutomationCallbackDiagnostic
type AutomationRuntimeEventSink = Callable[[AutomationRuntimeEvent], None]


class DeviceServiceErrorCode(StrEnum):
    BACKEND_UNAVAILABLE = "AUTOMATION_BACKEND_UNAVAILABLE"
    DISCOVERY_FAILED = "DEVICE_DISCOVERY_FAILED"
    NOT_FOUND = "DEVICE_NOT_FOUND"
    NOT_CONNECTED = "DEVICE_NOT_CONNECTED"
    CONNECTION_FAILED = "DEVICE_CONNECTION_FAILED"
    CONNECTION_LOST = "DEVICE_CONNECTION_LOST"
    DEACTIVATION_FAILED = "DEVICE_DEACTIVATION_FAILED"
    SERVICE_CLOSED = "DEVICE_SERVICE_CLOSED"
    OPERATION_TIMEOUT = "DEVICE_OPERATION_TIMEOUT"
    CAPTURE_FAILED = "SCREEN_CAPTURE_FAILED"
    CAPTURE_INVALID = "SCREEN_CAPTURE_INVALID"
    CAPTURE_TOO_LARGE = "SCREEN_CAPTURE_TOO_LARGE"
    PREVIEW_UNAVAILABLE = "DEVICE_PREVIEW_UNAVAILABLE"
    PREVIEW_ENCODE_FAILED = "DEVICE_PREVIEW_ENCODE_FAILED"
    PREVIEW_TOO_LARGE = "DEVICE_PREVIEW_TOO_LARGE"
    PREVIEW_STORAGE_FAILED = "DEVICE_PREVIEW_STORAGE_FAILED"
    CAPTURE_ARTIFACT_UNAVAILABLE = "CAPTURE_ARTIFACT_UNAVAILABLE"
    CAPTURE_ARTIFACT_INVALID = "CAPTURE_ARTIFACT_INVALID"
    CAPTURE_ARTIFACT_ENCODE_FAILED = "CAPTURE_ARTIFACT_ENCODE_FAILED"
    CAPTURE_ARTIFACT_TOO_LARGE = "CAPTURE_ARTIFACT_TOO_LARGE"
    CAPTURE_ARTIFACT_STORAGE_FAILED = "CAPTURE_ARTIFACT_STORAGE_FAILED"
    OCR_UNAVAILABLE = "OCR_UNAVAILABLE"
    OCR_FAILED = "OCR_RECOGNITION_FAILED"
    OCR_RESULT_INVALID = "OCR_RESULT_INVALID"
    RECOGNITION_UNAVAILABLE = "RECOGNITION_UNAVAILABLE"
    RECOGNITION_FAILED = "RECOGNITION_FAILED"
    RECOGNITION_RESULT_INVALID = "RECOGNITION_RESULT_INVALID"
    ACTION_REJECTED = "DEVICE_ACTION_REJECTED"
    ACTION_OUTCOME_UNKNOWN = "DEVICE_ACTION_OUTCOME_UNKNOWN"


class DeviceServiceError(RuntimeError):
    def __init__(
        self,
        code: DeviceServiceErrorCode,
        technical_detail: str,
        *,
        retryable: bool,
    ) -> None:
        super().__init__(code.value)
        self.code = code
        self.technical_detail = technical_detail
        self.retryable = retryable


class DeviceManagementService(Protocol):
    @property
    def runtime_info(self) -> AutomationRuntimeInfo: ...

    def list_devices(self) -> tuple[AutomationDeviceDescriptor, ...]: ...

    def connect(
        self,
        device_key: str,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> AutomationDeviceDescriptor: ...

    def disconnect(
        self,
        device_key: str,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> AutomationDeviceDescriptor: ...

    def close(self) -> tuple[DeviceServiceErrorCode, ...]: ...


class DeviceControlService(Protocol):
    def control_click(
        self,
        device_key: str,
        point: RuntimePoint,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None: ...

    def control_long_press(
        self,
        device_key: str,
        point: RuntimePoint,
        duration_milliseconds: int,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None: ...

    def control_swipe(
        self,
        device_key: str,
        start: RuntimePoint,
        end: RuntimePoint,
        duration_milliseconds: int,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None: ...

    def control_key(
        self,
        device_key: str,
        key: DeviceControlKey,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None: ...


class DevicePreviewService(Protocol):
    def capture_preview(
        self,
        device_key: str,
        maximum_width: int,
        maximum_height: int,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> PreviewArtifactDescriptor: ...

    def release_preview(self, preview_token: str) -> bool: ...

    def prepare_capture(
        self,
        preview_token: str,
        region: CaptureRegion | None,
    ) -> CaptureArtifactDescriptor: ...

    def release_capture(self, capture_token: str) -> bool: ...

    def prepare_project_asset(
        self,
        asset_token: str,
        content_hash: str,
        byte_length: int,
        width: int,
        height: int,
        coordinate_space_id: str,
    ) -> RuntimeImageReference: ...


class ScreenCaptureBackend(Protocol):
    async def capture_screen(
        self,
        device_key: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeImageReference: ...


class OcrRecognitionBackend(Protocol):
    async def recognize_ocr(
        self,
        device_key: str,
        image: RuntimeImageReference,
        roi: RuntimeRect | None,
        confidence_threshold: float,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> RuntimeOcrResult: ...


class TemplateMatchBackend(Protocol):
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
    ) -> RuntimeMatchResult: ...


class FeatureMatchBackend(Protocol):
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
    ) -> RuntimeMatchResult: ...


class ColorMatchBackend(Protocol):
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
    ) -> RuntimeMatchResult: ...


class PointClickBackend(Protocol):
    async def click_point(
        self,
        device_key: str,
        point: RuntimePoint,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None: ...


class ClickRectBackend(Protocol):
    async def click_rect_center(
        self,
        device_key: str,
        rect: RuntimeRect,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None: ...


class AndroidAppLaunchBackend(Protocol):
    async def launch_android_app(
        self,
        device_key: str,
        intent: str,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None: ...


class AndroidKeyBackend(Protocol):
    async def press_android_key(
        self,
        device_key: str,
        key: AndroidKey,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None: ...


class TouchActionBackend(Protocol):
    async def long_press(
        self,
        device_key: str,
        point: RuntimePoint,
        duration_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None: ...

    async def swipe(
        self,
        device_key: str,
        start: RuntimePoint,
        end: RuntimePoint,
        duration_milliseconds: int,
        cancellation: CancellationProbe,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None: ...

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
    ) -> None: ...


class AutomationRuntimeEventSource(Protocol):
    def set_operation_event_sink(
        self,
        sink: AutomationRuntimeEventSink | None,
    ) -> None: ...


class CaptureAndOcrBackend(ScreenCaptureBackend, OcrRecognitionBackend, Protocol):
    pass


class AutomationBackend(
    ScreenCaptureBackend,
    OcrRecognitionBackend,
    PointClickBackend,
    ClickRectBackend,
    AndroidAppLaunchBackend,
    AndroidKeyBackend,
    TouchActionBackend,
    Protocol,
):
    pass


class ClassicalRecognitionBackend(
    TemplateMatchBackend,
    FeatureMatchBackend,
    ColorMatchBackend,
    Protocol,
):
    pass


class MaaAutomationBackend(
    AutomationBackend,
    ClassicalRecognitionBackend,
    Protocol,
):
    pass
