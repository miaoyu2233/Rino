"""Typed facade over the pinned, untyped MaaFramework Python binding."""

from __future__ import annotations

import ctypes
import json
import math
from collections.abc import Callable, Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from hashlib import file_digest
from importlib import import_module
from importlib.metadata import PackageNotFoundError, distribution, version
from pathlib import Path
from types import MappingProxyType
from typing import (
    Protocol,
    SupportsFloat,
    SupportsInt,
    TypeGuard,
    cast,
    runtime_checkable,
)

import numpy as np
from numpy.typing import NDArray

from rino_runtime.backends.base import (
    AutomationOperationCorrelation,
    AutomationOperationKind,
    AutomationOperationSource,
    AutomationRuntimeEventSink,
)
from rino_runtime.backends.maa.callbacks import MaaCallbackHub
from rino_runtime.backends.maa.errors import MaaBackendError, MaaBackendErrorCode

EXPECTED_MAA_FRAMEWORK_VERSION = "5.12.3"
EXPECTED_MAA_RUNTIME_VERSION = f"v{EXPECTED_MAA_FRAMEWORK_VERSION}"
EXPECTED_MAA_AGENT_BINARY_VERSION = "1.0.1"
PINNED_OCR_ASSET_COMMIT = "dabcd4681ac990dc4361de26416d986abd80e4aa"
PINNED_OCR_MODEL_KEY = "ppocr-v5-zh-cn"
PINNED_OCR_MODEL_FILES: Mapping[str, tuple[int, str]] = MappingProxyType(
    {
        "det.onnx": (
            4_748_769,
            "8c3b7ee97913a7942b8565669dc9acbe8846fbbaf4b63e1d7fdb339005574a33",
        ),
        "rec.onnx": (
            16_517_247,
            "31fb844ce3a4aaf13e4bea62ae35f43bd9a509966061980c30db9b248c542a6b",
        ),
        "keys.txt": (
            92_395,
            "1ea29636956177e400af712d9782e7693f3fb25f98617bed10479d2965a836fd",
        ),
    }
)
MAXIMUM_OCR_CANDIDATES = 256
MAXIMUM_OCR_TEXT_LENGTH = 4_096
MAXIMUM_MATCH_CANDIDATES = 256
MAXIMUM_CALLBACK_MESSAGE_BYTES = 128
MAXIMUM_CALLBACK_DETAILS_BYTES = 64 * 1024


class MaaJob(Protocol):
    @property
    def job_id(self) -> int: ...

    @property
    def succeeded(self) -> bool: ...

    def wait(self) -> MaaJob: ...


class MaaScreenshotJob(MaaJob, Protocol):
    def wait(self) -> MaaScreenshotJob: ...

    def get(self, wait: bool = False) -> NDArray[np.uint8]: ...


class MaaTaskJob(MaaJob, Protocol):
    def wait(self) -> MaaTaskJob: ...

    def get(self, wait: bool = False) -> object | None: ...


class MaaController(Protocol):
    @property
    def connected(self) -> bool: ...

    def post_connection(self) -> MaaJob: ...

    def post_inactive(self) -> MaaJob: ...

    def post_screencap(self) -> MaaScreenshotJob: ...

    def post_click(
        self,
        x: int,
        y: int,
        contact: int = 0,
        pressure: int = 1,
    ) -> MaaJob: ...

    def post_start_app(self, intent: str) -> MaaJob: ...

    def post_swipe(
        self,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        duration: int,
        contact: int = 0,
        pressure: int = 1,
    ) -> MaaJob: ...

    def post_touch_down(
        self,
        x: int,
        y: int,
        contact: int = 0,
        pressure: int = 1,
    ) -> MaaJob: ...

    def post_touch_move(
        self,
        x: int,
        y: int,
        contact: int = 0,
        pressure: int = 1,
    ) -> MaaJob: ...

    def post_touch_up(self, contact: int = 0) -> MaaJob: ...

    def set_screenshot_use_raw_size(self, enable: bool) -> bool: ...

    def add_sink(self, sink: object) -> int | None: ...

    def remove_sink(self, sink_id: int) -> None: ...


class MaaKeyController(Protocol):
    def post_click_key(self, key: int) -> MaaJob: ...


class MaaResource(Protocol):
    @property
    def loaded(self) -> bool: ...

    def use_cpu(self) -> bool: ...

    def post_ocr_model(self, path: Path | str) -> MaaJob: ...

    def override_image(self, image_name: str, image: NDArray[np.uint8]) -> bool: ...


class MaaTaskerInstance(Protocol):
    def bind(self, resource: MaaResource, controller: MaaController) -> bool: ...

    def post_recognition(
        self,
        recognition_type: str,
        recognition_parameter: object,
        image: NDArray[np.uint8],
    ) -> MaaTaskJob: ...

    def post_stop(self) -> MaaJob: ...

    def add_sink(self, sink: object) -> int | None: ...

    def remove_sink(self, sink_id: int) -> None: ...


class MaaDirectRecognitionTasker(Protocol):
    def post_recognition(
        self,
        recognition_type: str,
        recognition_parameter: object,
        image: NDArray[np.uint8],
    ) -> MaaTaskJob: ...

    def post_stop(self) -> MaaJob: ...


class MaaImageResource(Protocol):
    def override_image(self, image_name: str, image: NDArray[np.uint8]) -> bool: ...


@dataclass(frozen=True, slots=True)
class MaaOcrCandidateSnapshot:
    text: str
    confidence: float
    rect: tuple[int, int, int, int]


@dataclass(frozen=True, slots=True)
class MaaOcrSnapshot:
    operation_id: int
    matched: bool
    candidates: tuple[MaaOcrCandidateSnapshot, ...]


@dataclass(frozen=True, slots=True)
class MaaMatchCandidateSnapshot:
    metric: float
    rect: tuple[int, int, int, int]


@dataclass(frozen=True, slots=True)
class MaaMatchSnapshot:
    operation_id: int
    matched: bool
    candidates: tuple[MaaMatchCandidateSnapshot, ...]


class MaaOcrSession(Protocol):
    def recognize(
        self,
        image: NDArray[np.uint8],
        *,
        roi: tuple[int, int, int, int],
        confidence_threshold: float,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> MaaOcrSnapshot: ...

    def stop(self) -> bool: ...


class MaaRecognitionSession(MaaOcrSession, Protocol):
    def recognize_template_match(
        self,
        image: NDArray[np.uint8],
        template: NDArray[np.uint8],
        *,
        roi: tuple[int, int, int, int],
        threshold: float,
        method: int,
        green_mask: bool,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> MaaMatchSnapshot: ...

    def recognize_feature_match(
        self,
        image: NDArray[np.uint8],
        template: NDArray[np.uint8],
        *,
        roi: tuple[int, int, int, int],
        detector: str,
        minimum_count: int,
        ratio: float,
        green_mask: bool,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> MaaMatchSnapshot: ...

    def recognize_color_match(
        self,
        image: NDArray[np.uint8],
        *,
        roi: tuple[int, int, int, int],
        lower: tuple[int, ...],
        upper: tuple[int, ...],
        method: int,
        minimum_count: int,
        connected: bool,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> MaaMatchSnapshot: ...


class _ToolkitApi(Protocol):
    def init_option(
        self,
        user_path: Path | str,
        default_config: dict[str, object],
    ) -> bool: ...

    def find_adb_devices(
        self,
        specified_adb: Path | str | None = None,
    ) -> list[object]: ...


class _LibraryApi(Protocol):
    def version(self) -> str: ...


class _TaskerApi(Protocol):
    def set_debug_mode(self, enabled: bool) -> None: ...

    def set_save_draw(self, enabled: bool) -> None: ...

    def set_save_on_error(self, enabled: bool) -> None: ...

    def set_stdout_level(self, level: object) -> None: ...


class _AdbControllerFactory(Protocol):
    def __call__(
        self,
        adb_path: Path | str,
        address: str,
        screencap_methods: int,
        input_methods: int,
        config: dict[str, object],
        agent_path: Path | str,
    ) -> MaaController: ...


class _ResourceFactory(Protocol):
    def __call__(self) -> MaaResource: ...


class _TaskerFactory(Protocol):
    def __call__(self) -> MaaTaskerInstance: ...


class _AdbDeviceApi(Protocol):
    adb_path: str | Path
    address: str
    screencap_methods: int
    input_methods: int
    config: Mapping[str, object]


class _MaaEventSink(Protocol):
    @property
    def c_callback(self) -> object: ...

    @property
    def c_callback_arg(self) -> ctypes.c_void_p: ...


class _MaaEventSinkFactory(Protocol):
    def __call__(
        self,
        receiver: Callable[[object, object], None],
    ) -> _MaaEventSink: ...


@dataclass(frozen=True, slots=True)
class MaaApi:
    toolkit: _ToolkitApi
    library: _LibraryApi
    tasker: _TaskerApi
    logging_off: object
    adb_controller_factory: _AdbControllerFactory
    resource_factory: _ResourceFactory
    tasker_factory: _TaskerFactory
    ocr_parameter_factory: Callable[..., object]
    template_match_parameter_factory: Callable[..., object] | None = None
    feature_match_parameter_factory: Callable[..., object] | None = None
    color_match_parameter_factory: Callable[..., object] | None = None
    event_sink_factory: _MaaEventSinkFactory | None = None


@dataclass(frozen=True, slots=True)
class MaaRuntimeConfiguration:
    user_data_directory: Path
    adb_executable_path: Path
    agent_binary_directory: Path | None = None
    ocr_model_directory: Path | None = None

    def __post_init__(self) -> None:
        if not self.user_data_directory.is_absolute():
            raise ValueError("MaaFramework user data directory must be absolute.")
        if not self.adb_executable_path.is_absolute():
            raise ValueError("The ADB executable path must be absolute.")
        if self.agent_binary_directory is not None and not (
            self.agent_binary_directory.is_absolute()
        ):
            raise ValueError("The Maa agent binary directory must be absolute.")
        if self.ocr_model_directory is not None and not (
            self.ocr_model_directory.is_absolute()
        ):
            raise ValueError("The Maa OCR model directory must be absolute.")


@dataclass(frozen=True, slots=True)
class MaaRuntimeInfo:
    framework_package_version: str
    framework_runtime_version: str
    agent_binary_package_version: str


@dataclass(frozen=True, slots=True)
class MaaAdbDeviceSpec:
    adb_path: Path = field(repr=False)
    address: str = field(repr=False)
    screencap_methods: int
    input_methods: int
    config: Mapping[str, object] = field(repr=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "config", MappingProxyType(dict(self.config)))

    @property
    def internal_identity(self) -> tuple[str, str]:
        return (str(self.adb_path), self.address)


class MaaBinding(Protocol):
    @property
    def runtime_info(self) -> MaaRuntimeInfo: ...

    @property
    def ocr_available(self) -> bool: ...

    def initialize(self) -> MaaRuntimeInfo: ...

    def discover_adb_devices(self) -> tuple[MaaAdbDeviceSpec, ...]: ...

    def create_adb_controller(self, device: MaaAdbDeviceSpec) -> MaaController: ...

    def create_ocr_session(self, controller: MaaController) -> MaaOcrSession: ...


@runtime_checkable
class MaaClassicalRecognitionBinding(Protocol):
    @property
    def recognition_available(self) -> bool: ...

    def create_recognition_session(
        self, controller: MaaController
    ) -> MaaRecognitionSession: ...


@runtime_checkable
class MaaCallbackBinding(Protocol):
    def bind_controller_operation(
        self,
        controller: MaaController,
        operation_id: int,
        operation_kind: AutomationOperationKind,
        correlation: AutomationOperationCorrelation | None,
    ) -> None: ...

    def release_controller_callbacks(self, controller: MaaController) -> None: ...

    def set_callback_event_sink(
        self,
        sink: AutomationRuntimeEventSink | None,
    ) -> None: ...

    def close_callback_events(self) -> None: ...


class _MaaRectValue(Protocol):
    x: object
    y: object
    w: object
    h: object


class _MaaOcrResultValue(Protocol):
    text: object
    score: object
    box: object


class _MaaMatchResultValue(Protocol):
    score: object
    box: object


class _MaaCountResultValue(Protocol):
    count: object
    box: object


class _MaaRecognitionDetailValue(Protocol):
    reco_id: int
    algorithm: object
    hit: bool
    filtered_results: Sequence[object]


class _MaaNodeDetailValue(Protocol):
    recognition: object | None


class _MaaTaskDetailValue(Protocol):
    nodes: Sequence[object]


@dataclass(slots=True)
class _CallbackRegistration:
    backend_generation: int
    controller: MaaController
    controller_sink_id: int
    tasker_sinks: list[tuple[MaaTaskerInstance, int]] = field(default_factory=list)


class OfficialMaaOcrSession:
    """Owns one bound Tasker and exposes only reviewed direct recognizers."""

    def __init__(
        self,
        tasker: MaaDirectRecognitionTasker,
        ocr_parameter_factory: Callable[..., object],
        callback_hub: MaaCallbackHub | None = None,
        backend_generation: int | None = None,
        *,
        resource: MaaImageResource | None = None,
        template_match_parameter_factory: Callable[..., object] | None = None,
        feature_match_parameter_factory: Callable[..., object] | None = None,
        color_match_parameter_factory: Callable[..., object] | None = None,
    ) -> None:
        self._tasker = tasker
        self._ocr_parameter_factory = ocr_parameter_factory
        self._callback_hub = callback_hub
        self._backend_generation = backend_generation
        self._resource = resource
        self._template_match_parameter_factory = template_match_parameter_factory
        self._feature_match_parameter_factory = feature_match_parameter_factory
        self._color_match_parameter_factory = color_match_parameter_factory
        self._template_name = f"rino-template-{id(self):x}.png"

    def recognize(
        self,
        image: NDArray[np.uint8],
        *,
        roi: tuple[int, int, int, int],
        confidence_threshold: float,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> MaaOcrSnapshot:
        try:
            parameter = self._ocr_parameter_factory(
                roi=roi,
                threshold=confidence_threshold,
                order_by="Horizontal",
                index=0,
                only_rec=False,
            )
            job = self._tasker.post_recognition("OCR", parameter, image)
            self._bind_operation(job, AutomationOperationKind.OCR, correlation)
            job.wait()
            succeeded = job.succeeded
            task_detail = job.get()
        except (AttributeError, OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.OCR_RECOGNITION_FAILED,
                "MaaFramework failed while executing the fixed OCR recognizer.",
                retryable=True,
            ) from error
        if not succeeded or task_detail is None:
            raise MaaBackendError(
                MaaBackendErrorCode.OCR_RECOGNITION_FAILED,
                "MaaFramework did not complete the OCR recognition task.",
                retryable=True,
            )
        return _snapshot_ocr_task(task_detail, image)

    def recognize_template_match(
        self,
        image: NDArray[np.uint8],
        template: NDArray[np.uint8],
        *,
        roi: tuple[int, int, int, int],
        threshold: float,
        method: int,
        green_mask: bool,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> MaaMatchSnapshot:
        parameter_factory = self._require_match_factory(
            self._template_match_parameter_factory
        )
        self._override_template(template)
        parameter = parameter_factory(
            template=[self._template_name],
            roi=roi,
            threshold=[threshold],
            order_by="Score",
            index=0,
            method=method,
            green_mask=green_mask,
        )
        return self._recognize_match(
            "TemplateMatch",
            parameter,
            image,
            AutomationOperationKind.TEMPLATE_MATCH,
            correlation,
        )

    def recognize_feature_match(
        self,
        image: NDArray[np.uint8],
        template: NDArray[np.uint8],
        *,
        roi: tuple[int, int, int, int],
        detector: str,
        minimum_count: int,
        ratio: float,
        green_mask: bool,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> MaaMatchSnapshot:
        parameter_factory = self._require_match_factory(
            self._feature_match_parameter_factory
        )
        self._override_template(template)
        parameter = parameter_factory(
            template=[self._template_name],
            roi=roi,
            detector=detector,
            order_by="Score",
            count=minimum_count,
            index=0,
            green_mask=green_mask,
            ratio=ratio,
        )
        return self._recognize_match(
            "FeatureMatch",
            parameter,
            image,
            AutomationOperationKind.FEATURE_MATCH,
            correlation,
        )

    def recognize_color_match(
        self,
        image: NDArray[np.uint8],
        *,
        roi: tuple[int, int, int, int],
        lower: tuple[int, ...],
        upper: tuple[int, ...],
        method: int,
        minimum_count: int,
        connected: bool,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> MaaMatchSnapshot:
        parameter_factory = self._require_match_factory(
            self._color_match_parameter_factory
        )
        parameter = parameter_factory(
            lower=[list(lower)],
            upper=[list(upper)],
            roi=roi,
            order_by="Score",
            method=method,
            count=minimum_count,
            index=0,
            connected=connected,
        )
        return self._recognize_match(
            "ColorMatch",
            parameter,
            image,
            AutomationOperationKind.COLOR_MATCH,
            correlation,
        )

    def _override_template(self, template: NDArray[np.uint8]) -> None:
        resource = self._resource
        if resource is None:
            raise MaaBackendError(
                MaaBackendErrorCode.RECOGNITION_UNAVAILABLE,
                "The fixed image recognition resource is unavailable.",
                retryable=False,
            )
        try:
            accepted = resource.override_image(self._template_name, template)
        except (AttributeError, OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.RECOGNITION_FAILED,
                "MaaFramework rejected the in-memory template image.",
                retryable=False,
            ) from error
        if not accepted:
            raise MaaBackendError(
                MaaBackendErrorCode.RECOGNITION_FAILED,
                "MaaFramework rejected the in-memory template image.",
                retryable=False,
            )

    @staticmethod
    def _require_match_factory(
        factory: Callable[..., object] | None,
    ) -> Callable[..., object]:
        if factory is None:
            raise MaaBackendError(
                MaaBackendErrorCode.RECOGNITION_UNAVAILABLE,
                "The fixed image recognition parameter factory is unavailable.",
                retryable=False,
            )
        return factory

    def _recognize_match(
        self,
        recognition_type: str,
        parameter: object,
        image: NDArray[np.uint8],
        operation_kind: AutomationOperationKind,
        correlation: AutomationOperationCorrelation | None,
    ) -> MaaMatchSnapshot:
        try:
            job = self._tasker.post_recognition(recognition_type, parameter, image)
            self._bind_operation(job, operation_kind, correlation)
            job.wait()
            succeeded = job.succeeded
            task_detail = job.get()
        except (AttributeError, OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.RECOGNITION_FAILED,
                "MaaFramework failed while executing a fixed image recognizer.",
                retryable=True,
            ) from error
        if not succeeded or task_detail is None:
            raise MaaBackendError(
                MaaBackendErrorCode.RECOGNITION_FAILED,
                "MaaFramework did not complete the image recognition task.",
                retryable=True,
            )
        return _snapshot_match_task(task_detail, image, recognition_type)

    def stop(self) -> bool:
        try:
            job = self._tasker.post_stop()
            self._bind_operation(job, AutomationOperationKind.OCR_STOP, None)
            job.wait()
            return job.succeeded
        except (OSError, RuntimeError, TypeError, ValueError):
            return False

    def _bind_operation(
        self,
        job: MaaJob,
        operation_kind: AutomationOperationKind,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        if self._callback_hub is None or self._backend_generation is None:
            return
        self._callback_hub.bind_operation(
            self._backend_generation,
            AutomationOperationSource.TASKER,
            job.job_id,
            operation_kind,
            correlation,
        )


class OfficialMaaBinding:
    """Loads only the reviewed Maa API surface and applies safe process options."""

    def __init__(
        self,
        configuration: MaaRuntimeConfiguration,
        *,
        api_loader: Callable[[], MaaApi] = lambda: load_maa_api(),
        package_version_loader: Callable[[str], str] = version,
        agent_directory_loader: Callable[[], Path] = lambda: (
            resolve_agent_binary_directory()
        ),
        callback_hub: MaaCallbackHub | None = None,
    ) -> None:
        self._configuration = configuration
        self._api_loader = api_loader
        self._package_version_loader = package_version_loader
        self._agent_directory_loader = agent_directory_loader
        self._api: MaaApi | None = None
        self._runtime_info: MaaRuntimeInfo | None = None
        self._agent_directory: Path | None = None
        self._recognition_resource: MaaResource | None = None
        self._ocr_available = False
        self._callback_hub = callback_hub
        self._callback_registrations: dict[int, _CallbackRegistration] = {}

    @property
    def runtime_info(self) -> MaaRuntimeInfo:
        if self._runtime_info is None:
            raise MaaBackendError(
                MaaBackendErrorCode.NOT_INITIALIZED,
                "The MaaFramework facade has not been initialized.",
                retryable=False,
            )
        return self._runtime_info

    @property
    def ocr_available(self) -> bool:
        return self._recognition_resource is not None and self._ocr_available

    @property
    def recognition_available(self) -> bool:
        return self._recognition_resource is not None

    def initialize(self) -> MaaRuntimeInfo:
        if self._runtime_info is not None:
            return self._runtime_info
        try:
            framework_package_version = self._package_version_loader("MaaFw")
            agent_package_version = self._package_version_loader("MaaAgentBinary")
            api = self._api_loader()
        except (ImportError, OSError, PackageNotFoundError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.BINDING_UNAVAILABLE,
                "The pinned MaaFramework Python package could not be loaded.",
                retryable=False,
            ) from error

        runtime_version = api.library.version()
        if (
            framework_package_version != EXPECTED_MAA_FRAMEWORK_VERSION
            or runtime_version != EXPECTED_MAA_RUNTIME_VERSION
            or agent_package_version != EXPECTED_MAA_AGENT_BINARY_VERSION
        ):
            raise MaaBackendError(
                MaaBackendErrorCode.VERSION_MISMATCH,
                "The MaaFramework binding, native runtime, and agent package do not "
                "match the pinned compatibility unit.",
                retryable=False,
            )

        configuration = self._configuration
        if not configuration.adb_executable_path.is_file():
            raise MaaBackendError(
                MaaBackendErrorCode.INITIALIZATION_FAILED,
                "The application-owned ADB executable is unavailable.",
                retryable=False,
            )
        agent_directory = configuration.agent_binary_directory
        if agent_directory is None:
            try:
                agent_directory = self._agent_directory_loader()
            except (OSError, PackageNotFoundError) as error:
                raise MaaBackendError(
                    MaaBackendErrorCode.BINDING_UNAVAILABLE,
                    "The pinned Maa agent binary package could not be resolved.",
                    retryable=False,
                ) from error
        if not agent_directory.is_dir():
            raise MaaBackendError(
                MaaBackendErrorCode.INITIALIZATION_FAILED,
                "The Maa agent binary directory is unavailable.",
                retryable=False,
            )

        try:
            configuration.user_data_directory.mkdir(parents=True, exist_ok=True)
            initialized = api.toolkit.init_option(
                configuration.user_data_directory,
                {
                    "logging": False,
                    "save_draw": False,
                    "save_on_error": False,
                    "stdout_level": int(cast(SupportsInt, api.logging_off)),
                },
            )
            api.tasker.set_debug_mode(False)
            api.tasker.set_save_draw(False)
            api.tasker.set_save_on_error(False)
            api.tasker.set_stdout_level(api.logging_off)
        except (OSError, RuntimeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.INITIALIZATION_FAILED,
                "MaaFramework rejected the safe runtime configuration.",
                retryable=False,
            ) from error
        if not initialized:
            raise MaaBackendError(
                MaaBackendErrorCode.INITIALIZATION_FAILED,
                "MaaFramework rejected the safe runtime configuration.",
                retryable=False,
            )

        try:
            resource = api.resource_factory()
            if not resource.use_cpu():
                raise RuntimeError("CPU inference selection was rejected.")
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.INITIALIZATION_FAILED,
                "MaaFramework could not initialize the fixed recognition resource.",
                retryable=False,
            ) from error

        if configuration.ocr_model_directory is not None:
            model_directory = _validate_pinned_ocr_model_directory(
                configuration.ocr_model_directory
            )
            try:
                load_job = resource.post_ocr_model(model_directory).wait()
                loaded = load_job.succeeded and resource.loaded
            except (OSError, RuntimeError, TypeError, ValueError) as error:
                raise MaaBackendError(
                    MaaBackendErrorCode.OCR_MODEL_LOAD_FAILED,
                    "MaaFramework could not load the pinned OCR model.",
                    retryable=False,
                ) from error
            if not loaded:
                raise MaaBackendError(
                    MaaBackendErrorCode.OCR_MODEL_LOAD_FAILED,
                    "MaaFramework rejected the pinned OCR model.",
                    retryable=False,
                )
            self._ocr_available = True

        self._recognition_resource = resource

        if api.event_sink_factory is not None and self._callback_hub is None:
            self._callback_hub = MaaCallbackHub()
        self._api = api
        self._agent_directory = agent_directory.resolve()
        self._runtime_info = MaaRuntimeInfo(
            framework_package_version=framework_package_version,
            framework_runtime_version=runtime_version,
            agent_binary_package_version=agent_package_version,
        )
        return self._runtime_info

    def discover_adb_devices(self) -> tuple[MaaAdbDeviceSpec, ...]:
        api = self._require_api()
        try:
            raw_devices = api.toolkit.find_adb_devices(
                self._configuration.adb_executable_path
            )
            return tuple(_copy_device_spec(device) for device in raw_devices)
        except (AttributeError, OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.DEVICE_DISCOVERY_FAILED,
                "MaaFramework could not enumerate ADB devices.",
                retryable=True,
            ) from error

    def create_adb_controller(self, device: MaaAdbDeviceSpec) -> MaaController:
        api = self._require_api()
        agent_directory = self._agent_directory
        if agent_directory is None:
            raise MaaBackendError(
                MaaBackendErrorCode.NOT_INITIALIZED,
                "The MaaFramework facade has not been initialized.",
                retryable=False,
            )
        try:
            controller = api.adb_controller_factory(
                device.adb_path,
                device.address,
                device.screencap_methods,
                device.input_methods,
                dict(device.config),
                agent_directory,
            )
            if not controller.set_screenshot_use_raw_size(True):
                raise RuntimeError("Raw screenshot coordinates were rejected.")
            self._attach_controller_callbacks(controller, api)
            return controller
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.DEVICE_CONNECTION_FAILED,
                "MaaFramework could not create the ADB controller.",
                retryable=True,
            ) from error

    def create_ocr_session(self, controller: MaaController) -> MaaOcrSession:
        if not self.ocr_available:
            raise MaaBackendError(
                MaaBackendErrorCode.OCR_UNAVAILABLE,
                "The fixed OCR model is not configured for this runtime.",
                retryable=False,
            )
        return self._create_recognition_session(controller)

    def create_recognition_session(
        self, controller: MaaController
    ) -> MaaRecognitionSession:
        if not self.recognition_available:
            raise MaaBackendError(
                MaaBackendErrorCode.RECOGNITION_UNAVAILABLE,
                "The fixed image recognition resource is unavailable.",
                retryable=False,
            )
        return self._create_recognition_session(controller)

    def _create_recognition_session(
        self, controller: MaaController
    ) -> OfficialMaaOcrSession:
        api = self._require_api()
        resource = self._recognition_resource
        if resource is None:
            raise MaaBackendError(
                MaaBackendErrorCode.RECOGNITION_UNAVAILABLE,
                "The fixed image recognition resource is unavailable.",
                retryable=False,
            )
        try:
            tasker = api.tasker_factory()
            if not tasker.bind(resource, controller):
                raise RuntimeError("The OCR Tasker binding was rejected.")
            registration = self._callback_registrations.get(id(controller))
            if registration is not None and api.event_sink_factory is not None:
                callback_hub = self._callback_hub
                if callback_hub is None:
                    raise RuntimeError("The Maa callback hub is unavailable.")
                sink = api.event_sink_factory(
                    lambda message, details: callback_hub.receive(
                        registration.backend_generation,
                        AutomationOperationSource.TASKER,
                        message,
                        details,
                    )
                )
                sink_id = tasker.add_sink(sink)
                if sink_id is None:
                    raise RuntimeError("The Maa Tasker callback sink was rejected.")
                registration.tasker_sinks.append((tasker, sink_id))
                return OfficialMaaOcrSession(
                    tasker,
                    api.ocr_parameter_factory,
                    callback_hub,
                    registration.backend_generation,
                    resource=resource,
                    template_match_parameter_factory=(
                        api.template_match_parameter_factory
                    ),
                    feature_match_parameter_factory=(
                        api.feature_match_parameter_factory
                    ),
                    color_match_parameter_factory=api.color_match_parameter_factory,
                )
            return OfficialMaaOcrSession(
                tasker,
                api.ocr_parameter_factory,
                resource=resource,
                template_match_parameter_factory=(api.template_match_parameter_factory),
                feature_match_parameter_factory=api.feature_match_parameter_factory,
                color_match_parameter_factory=api.color_match_parameter_factory,
            )
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            raise MaaBackendError(
                MaaBackendErrorCode.RECOGNITION_SESSION_FAILED,
                "MaaFramework could not initialize the fixed recognition session.",
                retryable=True,
            ) from error

    def bind_controller_operation(
        self,
        controller: MaaController,
        operation_id: int,
        operation_kind: AutomationOperationKind,
        correlation: AutomationOperationCorrelation | None,
    ) -> None:
        registration = self._callback_registrations.get(id(controller))
        callback_hub = self._callback_hub
        if registration is None or callback_hub is None:
            return
        callback_hub.bind_operation(
            registration.backend_generation,
            AutomationOperationSource.CONTROLLER,
            operation_id,
            operation_kind,
            correlation,
        )

    def release_controller_callbacks(self, controller: MaaController) -> None:
        registration = self._callback_registrations.pop(id(controller), None)
        if registration is None:
            return
        for tasker, sink_id in reversed(registration.tasker_sinks):
            with suppress(OSError, RuntimeError, ValueError):
                tasker.remove_sink(sink_id)
        with suppress(OSError, RuntimeError, ValueError):
            registration.controller.remove_sink(registration.controller_sink_id)
        if self._callback_hub is not None:
            self._callback_hub.retire_generation(registration.backend_generation)

    def set_callback_event_sink(
        self,
        sink: AutomationRuntimeEventSink | None,
    ) -> None:
        if self._callback_hub is not None:
            self._callback_hub.set_event_sink(sink)

    def close_callback_events(self) -> None:
        registrations = tuple(
            registration.controller
            for registration in self._callback_registrations.values()
        )
        for controller in registrations:
            self.release_controller_callbacks(controller)
        if self._callback_hub is not None:
            self._callback_hub.close()

    def _attach_controller_callbacks(
        self,
        controller: MaaController,
        api: MaaApi,
    ) -> None:
        callback_hub = self._callback_hub
        factory = api.event_sink_factory
        if callback_hub is None or factory is None:
            return
        generation = callback_hub.register_generation()
        try:
            sink = factory(
                lambda message, details: callback_hub.receive(
                    generation,
                    AutomationOperationSource.CONTROLLER,
                    message,
                    details,
                )
            )
            sink_id = controller.add_sink(sink)
            if sink_id is None:
                raise RuntimeError("The Maa controller callback sink was rejected.")
        except BaseException:
            callback_hub.retire_generation(generation)
            raise
        self._callback_registrations[id(controller)] = _CallbackRegistration(
            generation,
            controller,
            sink_id,
        )

    def _require_api(self) -> MaaApi:
        if self._api is None:
            raise MaaBackendError(
                MaaBackendErrorCode.NOT_INITIALIZED,
                "The MaaFramework facade has not been initialized.",
                retryable=False,
            )
        return self._api


class _OfficialMaaEventSink:
    def __init__(
        self,
        callback_type: Callable[[Callable[..., None]], object],
        receiver: Callable[[object, object], None],
    ) -> None:
        self._callback_arg = ctypes.c_void_p(1)

        def native_callback(
            _handle: object,
            message: bytes | None,
            details_json: bytes | None,
            _callback_arg: object,
        ) -> None:
            try:
                if message is None or details_json is None:
                    raise ValueError("A Maa callback field is absent.")
                if len(message) > MAXIMUM_CALLBACK_MESSAGE_BYTES or (
                    len(details_json) > MAXIMUM_CALLBACK_DETAILS_BYTES
                ):
                    raise ValueError("A Maa callback field exceeds its bound.")
                decoded_message = message.decode("utf-8", errors="strict")
                decoded_details = json.loads(
                    details_json.decode("utf-8", errors="strict")
                )
            except (UnicodeError, ValueError, TypeError):
                _receive_without_raising(receiver, None, None)
                return
            _receive_without_raising(receiver, decoded_message, decoded_details)

        self._c_callback = callback_type(native_callback)

    @property
    def c_callback(self) -> object:
        return self._c_callback

    @property
    def c_callback_arg(self) -> ctypes.c_void_p:
        return self._callback_arg


def load_maa_api() -> MaaApi:
    toolkit_module = import_module("maa.toolkit")
    library_module = import_module("maa.library")
    tasker_module = import_module("maa.tasker")
    define_module = import_module("maa.define")
    controller_module = import_module("maa.controller")
    resource_module = import_module("maa.resource")
    pipeline_module = import_module("maa.pipeline")
    logging_enum = define_module.LoggingLevelEnum
    return MaaApi(
        toolkit=cast(_ToolkitApi, toolkit_module.Toolkit),
        library=cast(_LibraryApi, library_module.Library),
        tasker=cast(_TaskerApi, tasker_module.Tasker),
        logging_off=logging_enum.Off,
        adb_controller_factory=cast(
            _AdbControllerFactory,
            controller_module.AdbController,
        ),
        resource_factory=cast(_ResourceFactory, resource_module.Resource),
        tasker_factory=cast(_TaskerFactory, tasker_module.Tasker),
        ocr_parameter_factory=cast(
            Callable[..., object],
            pipeline_module.JOCR,
        ),
        template_match_parameter_factory=cast(
            Callable[..., object],
            pipeline_module.JTemplateMatch,
        ),
        feature_match_parameter_factory=cast(
            Callable[..., object],
            pipeline_module.JFeatureMatch,
        ),
        color_match_parameter_factory=cast(
            Callable[..., object],
            pipeline_module.JColorMatch,
        ),
        event_sink_factory=lambda receiver: _OfficialMaaEventSink(
            cast(
                Callable[[Callable[..., None]], object],
                define_module.MaaEventCallback,
            ),
            receiver,
        ),
    )


def _receive_without_raising(
    receiver: Callable[[object, object], None],
    message: object,
    details: object,
) -> None:
    try:
        receiver(message, details)
    except BaseException:
        return


def resolve_agent_binary_directory() -> Path:
    location = distribution("MaaAgentBinary").locate_file("MaaAgentBinary")
    return Path(str(location)).resolve()


def _copy_device_spec(device: object) -> MaaAdbDeviceSpec:
    source = cast(_AdbDeviceApi, device)
    return MaaAdbDeviceSpec(
        adb_path=Path(source.adb_path).resolve(),
        address=source.address,
        screencap_methods=source.screencap_methods,
        input_methods=source.input_methods,
        config=source.config,
    )


def _validate_pinned_ocr_model_directory(directory: Path) -> Path:
    try:
        resolved = directory.resolve(strict=True)
    except OSError as error:
        raise MaaBackendError(
            MaaBackendErrorCode.OCR_MODEL_INVALID,
            "The pinned OCR model directory is unavailable.",
            retryable=False,
        ) from error
    if not resolved.is_dir() or directory.is_symlink():
        raise MaaBackendError(
            MaaBackendErrorCode.OCR_MODEL_INVALID,
            "The pinned OCR model path is not a trusted directory.",
            retryable=False,
        )
    for file_name, (expected_size, expected_hash) in PINNED_OCR_MODEL_FILES.items():
        candidate = resolved / file_name
        try:
            if candidate.is_symlink() or not candidate.is_file():
                raise OSError("The OCR model file is unavailable.")
            if candidate.stat().st_size != expected_size:
                raise OSError("The OCR model file size is unexpected.")
            with candidate.open("rb") as source:
                actual_hash = file_digest(source, "sha256").hexdigest()
        except OSError as error:
            raise MaaBackendError(
                MaaBackendErrorCode.OCR_MODEL_INVALID,
                "A pinned OCR model file failed validation.",
                retryable=False,
            ) from error
        if actual_hash != expected_hash:
            raise MaaBackendError(
                MaaBackendErrorCode.OCR_MODEL_INVALID,
                "A pinned OCR model file failed integrity verification.",
                retryable=False,
            )
    return resolved


def _snapshot_ocr_task(
    task_detail: object,
    image: NDArray[np.uint8],
) -> MaaOcrSnapshot:
    try:
        detail = cast(_MaaTaskDetailValue, task_detail)
        recognitions = [
            cast(_MaaNodeDetailValue, node).recognition
            for node in detail.nodes
            if cast(_MaaNodeDetailValue, node).recognition is not None
        ]
    except (AttributeError, TypeError) as error:
        raise _invalid_ocr_result("task detail shape") from error
    if len(recognitions) != 1:
        raise _invalid_ocr_result("recognition detail count")
    recognition = cast(_MaaRecognitionDetailValue, recognitions[0])
    algorithm = getattr(recognition.algorithm, "value", recognition.algorithm)
    if algorithm != "OCR" or recognition.reco_id <= 0:
        raise _invalid_ocr_result("recognition identity")
    raw_candidates = recognition.filtered_results
    if len(raw_candidates) > MAXIMUM_OCR_CANDIDATES:
        raise _invalid_ocr_result("candidate count")
    height = int(image.shape[0])
    width = int(image.shape[1])
    candidates = tuple(
        _snapshot_ocr_candidate(candidate, width=width, height=height)
        for candidate in raw_candidates
    )
    matched = bool(recognition.hit)
    if matched and not candidates:
        raise _invalid_ocr_result("matched result without candidates")
    return MaaOcrSnapshot(
        operation_id=recognition.reco_id,
        matched=matched,
        candidates=candidates,
    )


def _snapshot_ocr_candidate(
    candidate: object,
    *,
    width: int,
    height: int,
) -> MaaOcrCandidateSnapshot:
    try:
        value = cast(_MaaOcrResultValue, candidate)
        text = value.text
        confidence = float(cast(SupportsFloat | str, value.score))
        coordinates = _ocr_box_coordinates(value.box)
    except (AttributeError, OverflowError, TypeError, ValueError) as error:
        raise _invalid_ocr_result("candidate shape") from error
    if not isinstance(text, str) or len(text) > MAXIMUM_OCR_TEXT_LENGTH:
        raise _invalid_ocr_result("candidate text")
    if not math.isfinite(confidence) or not 0 <= confidence <= 1:
        raise _invalid_ocr_result("candidate confidence")
    raw_x, raw_y, raw_width, raw_height = coordinates
    if not (
        _is_integer_coordinate(raw_x)
        and _is_integer_coordinate(raw_y)
        and _is_integer_coordinate(raw_width)
        and _is_integer_coordinate(raw_height)
    ):
        raise _invalid_ocr_result("candidate coordinate type")
    x, y, rect_width, rect_height = raw_x, raw_y, raw_width, raw_height
    if (
        x < 0
        or y < 0
        or rect_width <= 0
        or rect_height <= 0
        or x + rect_width > width
        or y + rect_height > height
    ):
        raise _invalid_ocr_result("candidate rectangle")
    return MaaOcrCandidateSnapshot(
        text=text,
        confidence=confidence,
        rect=(x, y, rect_width, rect_height),
    )


def _snapshot_match_task(
    task_detail: object,
    image: NDArray[np.uint8],
    expected_algorithm: str,
) -> MaaMatchSnapshot:
    try:
        detail = cast(_MaaTaskDetailValue, task_detail)
        recognitions = [
            cast(_MaaNodeDetailValue, node).recognition
            for node in detail.nodes
            if cast(_MaaNodeDetailValue, node).recognition is not None
        ]
    except (AttributeError, TypeError) as error:
        raise _invalid_match_result("task detail shape") from error
    if len(recognitions) != 1:
        raise _invalid_match_result("recognition detail count")
    recognition = cast(_MaaRecognitionDetailValue, recognitions[0])
    algorithm = getattr(recognition.algorithm, "value", recognition.algorithm)
    if algorithm != expected_algorithm or recognition.reco_id <= 0:
        raise _invalid_match_result("recognition identity")
    raw_candidates = recognition.filtered_results
    if len(raw_candidates) > MAXIMUM_MATCH_CANDIDATES:
        raise _invalid_match_result("candidate count")
    height = int(image.shape[0])
    width = int(image.shape[1])
    candidates = tuple(
        _snapshot_match_candidate(
            candidate,
            width=width,
            height=height,
            algorithm=expected_algorithm,
        )
        for candidate in raw_candidates
    )
    matched = bool(recognition.hit)
    if matched and not candidates:
        raise _invalid_match_result("matched result without candidates")
    return MaaMatchSnapshot(
        operation_id=recognition.reco_id,
        matched=matched,
        candidates=candidates,
    )


def _snapshot_match_candidate(
    candidate: object,
    *,
    width: int,
    height: int,
    algorithm: str,
) -> MaaMatchCandidateSnapshot:
    try:
        if algorithm == "TemplateMatch":
            score_value = cast(_MaaMatchResultValue, candidate)
            metric = float(cast(SupportsFloat | str, score_value.score))
            coordinates = _ocr_box_coordinates(score_value.box)
        else:
            count_value = cast(_MaaCountResultValue, candidate)
            raw_count = count_value.count
            if not _is_integer_coordinate(raw_count):
                raise TypeError("Match count must be an integer.")
            metric = float(raw_count)
            coordinates = _ocr_box_coordinates(count_value.box)
    except (AttributeError, OverflowError, TypeError, ValueError) as error:
        raise _invalid_match_result("candidate shape") from error
    if not math.isfinite(metric) or metric < 0:
        raise _invalid_match_result("candidate metric")
    if algorithm == "TemplateMatch" and metric > 1:
        raise _invalid_match_result("candidate score")
    raw_x, raw_y, raw_width, raw_height = coordinates
    if not (
        _is_integer_coordinate(raw_x)
        and _is_integer_coordinate(raw_y)
        and _is_integer_coordinate(raw_width)
        and _is_integer_coordinate(raw_height)
    ):
        raise _invalid_match_result("candidate coordinate type")
    x, y, rect_width, rect_height = raw_x, raw_y, raw_width, raw_height
    if (
        x < 0
        or y < 0
        or rect_width <= 0
        or rect_height <= 0
        or x + rect_width > width
        or y + rect_height > height
    ):
        raise _invalid_match_result("candidate rectangle")
    return MaaMatchCandidateSnapshot(
        metric=metric,
        rect=(x, y, rect_width, rect_height),
    )


def _ocr_box_coordinates(box: object) -> tuple[object, object, object, object]:
    if all(hasattr(box, attribute) for attribute in ("x", "y", "w", "h")):
        rect = cast(_MaaRectValue, box)
        return (rect.x, rect.y, rect.w, rect.h)
    if isinstance(box, Sequence) and not isinstance(box, str | bytes):
        values = tuple(cast(Sequence[object], box))
        if len(values) == 4:
            return (values[0], values[1], values[2], values[3])
    raise AttributeError("OCR candidate boxes must contain four coordinates.")


def _is_integer_coordinate(value: object) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)


def _invalid_ocr_result(reason: str) -> MaaBackendError:
    return MaaBackendError(
        MaaBackendErrorCode.OCR_RESULT_INVALID,
        f"MaaFramework returned an invalid OCR {reason}.",
        retryable=True,
    )


def _invalid_match_result(reason: str) -> MaaBackendError:
    return MaaBackendError(
        MaaBackendErrorCode.RECOGNITION_RESULT_INVALID,
        f"MaaFramework returned an invalid image recognition {reason}.",
        retryable=True,
    )
