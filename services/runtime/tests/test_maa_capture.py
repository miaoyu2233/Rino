"""Direct Maa screen capture and runtime image-handle integration tests."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Self, cast

import numpy as np
import pytest
from numpy.typing import NDArray

from rino_runtime.artifacts import (
    CaptureArtifactScope,
    CaptureRegion,
    CaptureSourceKind,
    PreviewArtifactScope,
)
from rino_runtime.backends.maa import (
    EXPECTED_MAA_AGENT_BINARY_VERSION,
    EXPECTED_MAA_FRAMEWORK_VERSION,
    EXPECTED_MAA_RUNTIME_VERSION,
    MaaAdbDeviceSpec,
    MaaBackendError,
    MaaBackendErrorCode,
    MaaBinding,
    MaaDeviceService,
    MaaDeviceServiceHost,
    MaaRuntimeInfo,
)
from rino_runtime.execution_control import CancellationScope, NeverCancelled
from rino_runtime.nodes import build_capture_backend_registry


@dataclass
class _Job:
    pixels: object
    succeeded: bool = True

    def wait(self) -> Self:
        return self

    def get(self, wait: bool = False) -> object:
        del wait
        return self.pixels


class _Controller:
    def __init__(self, pixels: object, *, capture_succeeds: bool = True) -> None:
        self.connected = False
        self._pixels = pixels
        self._capture_succeeds = capture_succeeds
        self.capture_calls = 0

    def post_connection(self) -> _Job:
        self.connected = True
        return _Job(np.zeros((1, 1), dtype=np.uint8))

    def post_inactive(self) -> _Job:
        self.connected = False
        return _Job(np.zeros((1, 1), dtype=np.uint8))

    def post_screencap(self) -> _Job:
        self.capture_calls += 1
        return _Job(self._pixels, self._capture_succeeds)

    def set_screenshot_use_raw_size(self, enable: bool) -> bool:
        return enable


class _Binding:
    def __init__(
        self, specification: MaaAdbDeviceSpec, controller: _Controller
    ) -> None:
        self.specification = specification
        self.controller = controller
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


def _service(
    tmp_path: Path,
    pixels: object,
    *,
    capture_succeeds: bool = True,
    with_file_artifacts: bool = False,
) -> tuple[MaaDeviceService, _Controller]:
    specification = MaaAdbDeviceSpec(
        adb_path=(tmp_path / "adb.exe").resolve(),
        address="private-device-address",
        screencap_methods=1,
        input_methods=2,
        config={},
    )
    controller = _Controller(pixels, capture_succeeds=capture_succeeds)
    binding = cast(MaaBinding, _Binding(specification, controller))
    service = MaaDeviceService(
        binding,
        device_key_factory=lambda: "device-opaque",
        coordinate_space_factory=lambda: "coordinate-space-opaque",
        preview_artifacts=(
            PreviewArtifactScope((tmp_path / "preview").resolve())
            if with_file_artifacts
            else None
        ),
        capture_artifacts=(
            CaptureArtifactScope(
                (tmp_path / "preview" / "captures").resolve(),
                coordinate_space_factory=lambda: "capture-space-opaque",
            )
            if with_file_artifacts
            else None
        ),
    )
    return service, controller


@pytest.mark.asyncio
async def test_capture_stores_owned_frame_without_exposing_device_metadata(
    tmp_path: Path,
) -> None:
    source: NDArray[np.uint8] = np.arange(36, dtype=np.uint8).reshape((3, 4, 3))
    service, controller = _service(tmp_path, source)
    await service.discover()
    await service.connect("device-opaque")

    reference = await service.capture_screen("device-opaque", NeverCancelled())
    source.fill(0)
    artifact = service.resolve_image(reference)

    assert controller.capture_calls == 1
    assert reference.width == 4
    assert reference.height == 3
    assert reference.coordinate_space_id == "coordinate-space-opaque"
    assert reference.generation == 1
    assert reference.expires_at_monotonic > 0
    assert int(artifact.pixels.sum()) == sum(range(36))
    assert "private-device-address" not in repr(reference)
    assert str(tmp_path) not in repr(reference)
    assert service.release_image(reference.handle_id)
    assert await service.close() == ()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("pixels", "capture_succeeds", "expected_code"),
    [
        (
            np.zeros((2, 2, 3), dtype=np.float32),
            True,
            MaaBackendErrorCode.SCREEN_CAPTURE_INVALID,
        ),
        (
            np.zeros((2, 2, 3), dtype=np.uint8),
            False,
            MaaBackendErrorCode.SCREEN_CAPTURE_FAILED,
        ),
    ],
)
async def test_capture_rejects_failed_or_invalid_results(
    tmp_path: Path,
    pixels: object,
    capture_succeeds: bool,
    expected_code: MaaBackendErrorCode,
) -> None:
    service, _ = _service(
        tmp_path,
        pixels,
        capture_succeeds=capture_succeeds,
    )
    await service.discover()
    await service.connect("device-opaque")

    with pytest.raises(MaaBackendError) as caught:
        await service.capture_screen("device-opaque", NeverCancelled())

    assert caught.value.code is expected_code
    assert "private-device-address" not in caught.value.technical_detail
    assert await service.close() == ()


@pytest.mark.asyncio
async def test_host_exposes_capture_as_async_backend_and_honors_pre_dispatch_cancel(
    tmp_path: Path,
) -> None:
    service, controller = _service(
        tmp_path,
        np.zeros((3, 4, 3), dtype=np.uint8),
    )
    host = MaaDeviceServiceHost(service)
    device = host.list_devices()[0]
    host.connect(device.device_key)

    reference = await host.capture_screen(device.device_key, NeverCancelled())
    cancellation = CancellationScope()
    cancellation.cancel()
    with pytest.raises(RuntimeError, match="NODE_CANCELLED"):
        await host.capture_screen(device.device_key, cancellation)

    registry = build_capture_backend_registry(host)
    assert "automation.captureScreen" in registry.type_keys
    assert "vision.ocr" not in registry.type_keys
    assert "automation.clickRectCenter" not in registry.type_keys
    assert reference.width == 4
    assert controller.capture_calls == 1
    assert host.release_image(reference.handle_id)
    assert host.close() == ()


@pytest.mark.asyncio
async def test_preview_binds_exact_source_for_full_and_region_capture_artifacts(
    tmp_path: Path,
) -> None:
    source: NDArray[np.uint8] = np.arange(36, dtype=np.uint8).reshape((3, 4, 3))
    service, _ = _service(tmp_path, source, with_file_artifacts=True)
    await service.discover()
    await service.connect("device-opaque")

    preview = await service.capture_preview("device-opaque", 160, 120)
    assert preview.source_coordinate_space_id == "coordinate-space-opaque"
    full = await service.prepare_capture(preview.preview_token, None)
    region = await service.prepare_capture(
        preview.preview_token,
        CaptureRegion(
            1,
            1,
            2,
            2,
            preview.source_coordinate_space_id,
            preview.source_generation,
        ),
    )

    assert (full.width, full.height) == (4, 3)
    assert full.source_kind is CaptureSourceKind.DEVICE_CAPTURE
    assert (region.width, region.height) == (2, 2)
    assert region.source_kind is CaptureSourceKind.REGION_CAPTURE
    assert service.release_capture(full.capture_token)
    assert service.release_capture(region.capture_token)
    assert service.release_preview(preview.preview_token)
    assert await service.close() == ()
