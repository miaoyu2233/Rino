"""Direct OCR contract tests for the fixed MaaFramework capability."""

from __future__ import annotations

import asyncio
import hashlib
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType, SimpleNamespace
from typing import Self, cast

import numpy as np
import pytest
from numpy.typing import NDArray

from rino_runtime.backends.base import (
    AutomationOperationCorrelation,
    CaptureAndOcrBackend,
)
from rino_runtime.backends.maa import (
    EXPECTED_MAA_AGENT_BINARY_VERSION,
    EXPECTED_MAA_FRAMEWORK_VERSION,
    EXPECTED_MAA_RUNTIME_VERSION,
    PINNED_OCR_ASSET_COMMIT,
    PINNED_OCR_MODEL_FILES,
    MaaAdbDeviceSpec,
    MaaBackendError,
    MaaBackendErrorCode,
    MaaBinding,
    MaaDeviceService,
    MaaDeviceServiceHost,
    MaaOcrCandidateSnapshot,
    MaaOcrSnapshot,
    MaaRuntimeInfo,
)
from rino_runtime.backends.maa import binding as binding_module
from rino_runtime.backends.maa.binding import OfficialMaaOcrSession
from rino_runtime.execution_control import CancellationScope, NeverCancelled
from rino_runtime.execution_control.cancellation import RuntimeCancellationError
from rino_runtime.nodes import build_capture_and_ocr_backend_registry
from rino_runtime.nodes import builtins as builtins_module
from rino_runtime.nodes.execution import (
    NodeExecutionFailure,
    NodeExecutionFailureCode,
    RuntimeOcrCandidate,
    RuntimeRect,
)


@dataclass
class _Job:
    succeeded: bool = True
    detail: object | None = None

    def wait(self) -> Self:
        return self

    def get(self, wait: bool = False) -> object | None:
        del wait
        return self.detail


class _DirectTasker:
    def __init__(self, detail: object) -> None:
        self.detail = detail
        self.recognition_type: str | None = None
        self.parameter: object | None = None
        self.image: NDArray[np.uint8] | None = None
        self.stop_calls = 0

    def post_recognition(
        self,
        recognition_type: str,
        recognition_parameter: object,
        image: NDArray[np.uint8],
    ) -> _Job:
        self.recognition_type = recognition_type
        self.parameter = recognition_parameter
        self.image = image
        return _Job(detail=self.detail)

    def post_stop(self) -> _Job:
        self.stop_calls += 1
        return _Job()


def _recognition_detail(
    *,
    hit: bool = True,
    score: float = 0.91,
) -> object:
    candidate = SimpleNamespace(
        text="123.45",
        score=score,
        box=[10, 12, 40, 18],
    )
    recognition = SimpleNamespace(
        reco_id=47,
        algorithm="OCR",
        hit=hit,
        filtered_results=[candidate],
    )
    return SimpleNamespace(nodes=[SimpleNamespace(recognition=recognition)])


def test_direct_session_uses_only_fixed_ocr_and_snapshots_bounded_results() -> None:
    tasker = _DirectTasker(_recognition_detail())
    parameters: dict[str, object] = {}

    def create_parameters(**values: object) -> object:
        parameters.update(values)
        return values

    session = OfficialMaaOcrSession(tasker, create_parameters)
    image = np.zeros((100, 200, 3), dtype=np.uint8)

    snapshot = session.recognize(
        image,
        roi=(5, 6, 120, 60),
        confidence_threshold=0.55,
    )

    assert tasker.recognition_type == "OCR"
    assert tasker.image is image
    assert parameters == {
        "roi": (5, 6, 120, 60),
        "threshold": 0.55,
        "order_by": "Horizontal",
        "index": 0,
        "only_rec": False,
    }
    assert snapshot == MaaOcrSnapshot(
        operation_id=47,
        matched=True,
        candidates=(
            MaaOcrCandidateSnapshot(
                text="123.45",
                confidence=0.91,
                rect=(10, 12, 40, 18),
            ),
        ),
    )


def test_pinned_model_manifest_and_integrity_check_are_fail_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert PINNED_OCR_ASSET_COMMIT == "dabcd4681ac990dc4361de26416d986abd80e4aa"
    assert set(PINNED_OCR_MODEL_FILES) == {"det.onnx", "rec.onnx", "keys.txt"}
    payload = b"controlled OCR model fixture"
    expected_hash = hashlib.sha256(payload).hexdigest()
    monkeypatch.setattr(
        binding_module,
        "PINNED_OCR_MODEL_FILES",
        MappingProxyType({"det.onnx": (len(payload), expected_hash)}),
    )
    model_directory = tmp_path / "model"
    model_directory.mkdir()
    model_file = model_directory / "det.onnx"
    model_file.write_bytes(payload)

    assert (
        binding_module._validate_pinned_ocr_model_directory(model_directory)
        == model_directory.resolve()
    )

    model_file.write_bytes(b"tampered OCR model fixture")
    with pytest.raises(MaaBackendError) as caught:
        binding_module._validate_pinned_ocr_model_directory(model_directory)

    assert caught.value.code is MaaBackendErrorCode.OCR_MODEL_INVALID
    assert not caught.value.retryable


def test_direct_session_rejects_invalid_candidate_without_raw_detail() -> None:
    session = OfficialMaaOcrSession(
        _DirectTasker(_recognition_detail(score=float("nan"))),
        lambda **values: values,
    )

    with pytest.raises(MaaBackendError) as caught:
        session.recognize(
            np.zeros((100, 200, 3), dtype=np.uint8),
            roi=(0, 0, 0, 0),
            confidence_threshold=0.3,
        )

    assert caught.value.code is MaaBackendErrorCode.OCR_RESULT_INVALID
    assert "123.45" not in caught.value.technical_detail


class _Controller:
    def __init__(self, pixels: NDArray[np.uint8]) -> None:
        self.connected = False
        self._pixels = pixels

    def post_connection(self) -> _Job:
        self.connected = True
        return _Job()

    def post_inactive(self) -> _Job:
        self.connected = False
        return _Job()

    def post_screencap(self) -> _Job:
        return _ScreenshotJob(self._pixels)

    def set_screenshot_use_raw_size(self, enable: bool) -> bool:
        return enable


class _ScreenshotJob(_Job):
    def __init__(self, pixels: NDArray[np.uint8]) -> None:
        super().__init__()
        self._pixels = pixels

    def get(self, wait: bool = False) -> NDArray[np.uint8]:
        del wait
        return self._pixels


class _Session:
    def __init__(self) -> None:
        self.calls: list[tuple[tuple[int, int, int, int], float]] = []
        self.stop_calls = 0

    def recognize(
        self,
        image: NDArray[np.uint8],
        *,
        roi: tuple[int, int, int, int],
        confidence_threshold: float,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> MaaOcrSnapshot:
        del correlation
        assert image.flags.writeable is False
        self.calls.append((roi, confidence_threshold))
        return MaaOcrSnapshot(
            operation_id=81,
            matched=True,
            candidates=(MaaOcrCandidateSnapshot("88", 0.87, (20, 30, 50, 16)),),
        )

    def stop(self) -> bool:
        self.stop_calls += 1
        return True


class _Binding:
    ocr_available = True

    def __init__(
        self,
        specification: MaaAdbDeviceSpec,
        controller: _Controller,
        session: _Session,
    ) -> None:
        self.specification = specification
        self.controller = controller
        self.session = session
        self._runtime_info = MaaRuntimeInfo(
            framework_package_version=EXPECTED_MAA_FRAMEWORK_VERSION,
            framework_runtime_version=EXPECTED_MAA_RUNTIME_VERSION,
            agent_binary_package_version=EXPECTED_MAA_AGENT_BINARY_VERSION,
        )

    @property
    def runtime_info(self) -> MaaRuntimeInfo:
        return self._runtime_info

    def initialize(self) -> MaaRuntimeInfo:
        return self._runtime_info

    def discover_adb_devices(self) -> tuple[MaaAdbDeviceSpec, ...]:
        return (self.specification,)

    def create_adb_controller(self, device: MaaAdbDeviceSpec) -> _Controller:
        assert device is self.specification
        return self.controller

    def create_ocr_session(self, controller: _Controller) -> _Session:
        assert controller is self.controller
        return self.session


def _service(
    tmp_path: Path,
    session: _Session,
) -> tuple[MaaDeviceService, _Controller]:
    specification = MaaAdbDeviceSpec(
        adb_path=(tmp_path / "adb.exe").resolve(),
        address="private-device-address",
        screencap_methods=1,
        input_methods=2,
        config={},
    )
    controller = _Controller(np.zeros((120, 240, 3), dtype=np.uint8))
    binding = cast(MaaBinding, _Binding(specification, controller, session))
    return (
        MaaDeviceService(
            binding,
            device_key_factory=lambda: "device-opaque",
            coordinate_space_factory=lambda: "coordinate-space-opaque",
        ),
        controller,
    )


@pytest.mark.asyncio
async def test_device_service_preserves_ocr_metadata_and_coordinate_space(
    tmp_path: Path,
) -> None:
    session = _Session()
    service, _ = _service(tmp_path, session)
    await service.discover()
    await service.connect("device-opaque")
    image = await service.capture_screen("device-opaque", NeverCancelled())

    result = await service.recognize_ocr(
        "device-opaque",
        image,
        RuntimeRect(10, 20, 100, 50),
        0.6,
        NeverCancelled(),
    )

    assert session.calls == [((10, 20, 100, 50), 0.6)]
    assert result.operation_id == 81
    assert result.matched
    assert result.source_generation == image.generation
    assert result.source_coordinate_space_id == image.coordinate_space_id
    assert result.candidates[0].rect == RuntimeRect(
        20,
        30,
        50,
        16,
        coordinate_space_id=image.coordinate_space_id,
        source_generation=image.generation,
    )
    assert await service.close() == ()
    assert session.stop_calls == 1


class _BlockingSession(_Session):
    def __init__(self) -> None:
        super().__init__()
        self.started = threading.Event()
        self.stopped = threading.Event()

    def recognize(
        self,
        image: NDArray[np.uint8],
        *,
        roi: tuple[int, int, int, int],
        confidence_threshold: float,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> MaaOcrSnapshot:
        del image, roi, confidence_threshold, correlation
        self.started.set()
        if not self.stopped.wait(timeout=2):
            raise RuntimeError("The cancellation test timed out.")
        raise MaaBackendError(
            MaaBackendErrorCode.OCR_RECOGNITION_FAILED,
            "The controlled OCR task was stopped.",
            retryable=True,
        )

    def stop(self) -> bool:
        self.stop_calls += 1
        self.stopped.set()
        return True


@pytest.mark.asyncio
async def test_device_service_stops_inflight_ocr_on_cancellation(
    tmp_path: Path,
) -> None:
    session = _BlockingSession()
    service, _ = _service(tmp_path, session)
    await service.discover()
    await service.connect("device-opaque")
    image = await service.capture_screen("device-opaque", NeverCancelled())
    cancellation = CancellationScope()

    operation = asyncio.create_task(
        service.recognize_ocr(
            "device-opaque",
            image,
            None,
            0.3,
            cancellation,
        )
    )
    assert await asyncio.to_thread(session.started.wait, 1)
    cancellation.cancel()

    with pytest.raises(RuntimeCancellationError):
        await operation

    assert session.stop_calls == 1
    await service.close()


@pytest.mark.asyncio
async def test_host_bridges_cancellation_to_the_maa_event_loop(tmp_path: Path) -> None:
    session = _BlockingSession()
    service, _ = _service(tmp_path, session)
    host = MaaDeviceServiceHost(service)
    device = host.list_devices()[0]
    host.connect(device.device_key)
    image = await host.capture_screen(device.device_key, NeverCancelled())
    cancellation = CancellationScope()
    operation = asyncio.create_task(
        host.recognize_ocr(
            device.device_key,
            image,
            None,
            0.3,
            cancellation,
        )
    )
    assert await asyncio.to_thread(session.started.wait, 1)
    cancellation.cancel()

    with pytest.raises(RuntimeCancellationError):
        await operation

    assert session.stop_calls == 1
    host.close()


def test_real_registry_exposes_fixed_ocr_without_click_or_other_recognizers() -> None:
    backend = cast(CaptureAndOcrBackend, SimpleNamespace())
    registry = build_capture_and_ocr_backend_registry(backend)

    assert "automation.captureScreen" in registry.type_keys
    assert "vision.ocr" in registry.type_keys
    assert "automation.clickRectCenter" not in registry.type_keys
    assert all("neural" not in type_key.lower() for type_key in registry.type_keys)
    definition = registry.definition("vision.ocr")
    assert definition is not None
    serialized = definition.model_dump(mode="json", by_alias=True)
    assert serialized["propertyDefaults"] == {
        "confidenceThreshold": 0.3,
        "expected": [],
    }


def test_ocr_expected_patterns_prioritize_the_first_matching_regex() -> None:
    rectangle = RuntimeRect(
        0,
        0,
        100,
        20,
        coordinate_space_id="space",
        source_generation=1,
    )
    candidates = (
        RuntimeOcrCandidate("立即加速", 0.99, rectangle),
        RuntimeOcrCandidate("开始加速", 0.55, rectangle),
    )

    selected = builtins_module._best_ocr_candidate(
        candidates,
        expected_patterns=(re.compile("开始加速"), re.compile("立即加速")),
    )

    assert selected is not None
    assert selected.text == "开始加速"


def test_ocr_expected_patterns_reject_invalid_runtime_pattern() -> None:
    with pytest.raises(NodeExecutionFailure) as failure:
        builtins_module._compile_ocr_expected_patterns(("[",))

    assert failure.value.code is NodeExecutionFailureCode.PROPERTY_INVALID
    assert failure.value.parameters["parameterName"] == "expected"
