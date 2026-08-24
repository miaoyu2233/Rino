"""Coordinate and outcome-safety tests for direct Maa click actions."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Self, cast
from uuid import uuid4

import numpy as np
import pytest
from numpy.typing import NDArray

from rino_runtime.backends.android_actions import AndroidKey
from rino_runtime.backends.base import (
    AutomationBackend,
    AutomationOperationCorrelation,
    DeviceServiceError,
    DeviceServiceErrorCode,
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
from rino_runtime.execution_control.cancellation import RuntimeCancellationError
from rino_runtime.nodes import (
    NodeExecutionContext,
    NodeExecutionFailure,
    NodeExecutionFailureCode,
    RuntimeImageReference,
    RuntimePoint,
    RuntimeRect,
    build_maa_backend_registry,
)


@dataclass
class _Job:
    succeeded: bool = True

    def wait(self) -> Self:
        return self


class _ScreenshotJob(_Job):
    def __init__(self, pixels: NDArray[np.uint8]) -> None:
        super().__init__()
        self._pixels = pixels

    def get(self, wait: bool = False) -> NDArray[np.uint8]:
        del wait
        return self._pixels


class _Controller:
    def __init__(
        self,
        pixels: NDArray[np.uint8],
        *,
        click_succeeds: bool = True,
        post_click_raises: bool = False,
        touch_move_succeeds: bool = True,
        start_app_succeeds: bool = True,
        post_start_app_raises: bool = False,
    ) -> None:
        self.connected = False
        self.pixels = pixels
        self.click_succeeds = click_succeeds
        self.post_click_raises = post_click_raises
        self.touch_move_succeeds = touch_move_succeeds
        self.start_app_succeeds = start_app_succeeds
        self.post_start_app_raises = post_start_app_raises
        self.clicks: list[tuple[int, int]] = []
        self.keys: list[int] = []
        self.app_starts: list[str] = []
        self.swipes: list[tuple[int, int, int, int, int, int, int]] = []
        self.touch_events: list[tuple[str, int, int | None, int | None]] = []

    def post_connection(self) -> _Job:
        self.connected = True
        return _Job()

    def post_inactive(self) -> _Job:
        self.connected = False
        return _Job()

    def post_screencap(self) -> _ScreenshotJob:
        return _ScreenshotJob(self.pixels)

    def post_click(
        self,
        x: int,
        y: int,
        contact: int = 0,
        pressure: int = 1,
    ) -> _Job:
        del contact, pressure
        if self.post_click_raises:
            raise RuntimeError("Controlled click dispatch failure.")
        self.clicks.append((x, y))
        return _Job(self.click_succeeds)

    def post_click_key(self, key: int) -> _Job:
        self.keys.append(key)
        return _Job()

    def post_start_app(self, intent: str) -> _Job:
        if self.post_start_app_raises:
            raise RuntimeError("Controlled application launch dispatch failure.")
        self.app_starts.append(intent)
        return _Job(self.start_app_succeeds)

    def post_swipe(
        self,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        duration: int,
        contact: int = 0,
        pressure: int = 1,
    ) -> _Job:
        self.swipes.append((x1, y1, x2, y2, duration, contact, pressure))
        return _Job()

    def post_touch_down(
        self,
        x: int,
        y: int,
        contact: int = 0,
        pressure: int = 1,
    ) -> _Job:
        del pressure
        self.touch_events.append(("down", contact, x, y))
        return _Job()

    def post_touch_move(
        self,
        x: int,
        y: int,
        contact: int = 0,
        pressure: int = 1,
    ) -> _Job:
        del pressure
        self.touch_events.append(("move", contact, x, y))
        return _Job(self.touch_move_succeeds)

    def post_touch_up(self, contact: int = 0) -> _Job:
        self.touch_events.append(("up", contact, None, None))
        return _Job()

    def set_screenshot_use_raw_size(self, enable: bool) -> bool:
        return enable


class _Binding:
    ocr_available = False

    def __init__(
        self,
        specification: MaaAdbDeviceSpec,
        controllers: list[_Controller],
    ) -> None:
        self.specification = specification
        self.controllers = controllers
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
        return self.controllers.pop(0)

    def create_ocr_session(self, controller: _Controller) -> object:
        del controller
        raise AssertionError("OCR must not initialize in click-only tests.")


def _service(
    tmp_path: Path,
    controllers: list[_Controller],
    *,
    coordinate_spaces: tuple[str, ...] = ("coordinate-space-1",),
) -> MaaDeviceService:
    specification = MaaAdbDeviceSpec(
        adb_path=(tmp_path / "adb.exe").resolve(),
        address="private-device-address",
        screencap_methods=1,
        input_methods=2,
        config={},
    )
    coordinate_iterator = iter(coordinate_spaces)
    binding = cast(MaaBinding, _Binding(specification, controllers))
    return MaaDeviceService(
        binding,
        device_key_factory=lambda: "device-opaque",
        coordinate_space_factory=lambda: next(coordinate_iterator),
    )


async def _connected_frame(
    service: MaaDeviceService,
) -> tuple[str, RuntimeImageReference]:
    device_key = (await service.discover())[0].device_key
    await service.connect(device_key)
    image = await service.capture_screen(device_key, NeverCancelled())
    return device_key, image


@pytest.mark.asyncio
async def test_point_and_rectangle_center_dispatch_exact_validated_coordinates(
    tmp_path: Path,
) -> None:
    controller = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    service = _service(tmp_path, [controller])
    device_key, image = await _connected_frame(service)

    await service.click_point(
        device_key,
        RuntimePoint(
            12,
            18,
            coordinate_space_id=image.coordinate_space_id,
            source_generation=image.generation,
        ),
        NeverCancelled(),
    )
    await service.click_rect_center(
        device_key,
        RuntimeRect(
            20,
            30,
            40,
            20,
            coordinate_space_id=image.coordinate_space_id,
            source_generation=image.generation,
        ),
        NeverCancelled(),
    )

    assert controller.clicks == [(12, 18), (40, 40)]
    assert await service.close() == ()


@pytest.mark.asyncio
async def test_back_dispatches_only_the_allowlisted_android_key(tmp_path: Path) -> None:
    controller = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    service = _service(tmp_path, [controller])
    device_key = (await service.discover())[0].device_key
    await service.connect(device_key)

    await service.press_back(device_key, NeverCancelled())

    assert controller.keys == [4]
    assert await service.close() == ()


@pytest.mark.asyncio
async def test_explicit_android_actions_dispatch_allowlisted_values_only(
    tmp_path: Path,
) -> None:
    controller = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    service = _service(tmp_path, [controller])
    device_key = (await service.discover())[0].device_key
    await service.connect(device_key)

    await service.launch_android_app(
        device_key,
        "com.example.game/.MainActivity",
        NeverCancelled(),
    )
    await service.press_android_key(device_key, AndroidKey.ESCAPE, NeverCancelled())

    assert controller.app_starts == ["com.example.game/.MainActivity"]
    assert controller.keys == [111]
    await service.close()


@pytest.mark.asyncio
async def test_android_launch_rejects_ambiguous_intent_before_controller_access(
    tmp_path: Path,
) -> None:
    controller = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    service = _service(tmp_path, [controller])
    device_key = (await service.discover())[0].device_key
    await service.connect(device_key)

    with pytest.raises(MaaBackendError) as caught:
        await service.launch_android_app(
            device_key,
            "com.example.game;input keyevent 111",
            NeverCancelled(),
        )

    assert caught.value.code is MaaBackendErrorCode.ACTION_REJECTED
    assert not caught.value.retryable
    assert controller.app_starts == []
    await service.close()


@pytest.mark.asyncio
async def test_android_launch_never_retries_an_unknown_controller_outcome(
    tmp_path: Path,
) -> None:
    controller = _Controller(
        np.zeros((100, 200, 3), dtype=np.uint8),
        start_app_succeeds=False,
    )
    service = _service(tmp_path, [controller])
    device_key = (await service.discover())[0].device_key
    await service.connect(device_key)

    with pytest.raises(MaaBackendError) as caught:
        await service.launch_android_app(
            device_key,
            "com.example.game/.MainActivity",
            NeverCancelled(),
        )

    assert caught.value.code is MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN
    assert not caught.value.retryable
    assert controller.app_starts == ["com.example.game/.MainActivity"]
    await service.close()


@pytest.mark.asyncio
async def test_direct_touch_actions_use_validated_controller_operations(
    tmp_path: Path,
) -> None:
    controller = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    service = _service(tmp_path, [controller])
    device_key, image = await _connected_frame(service)

    def point(x: int, y: int) -> RuntimePoint:
        return RuntimePoint(
            x,
            y,
            coordinate_space_id=image.coordinate_space_id,
            source_generation=image.generation,
        )

    await service.long_press(device_key, point(10, 20), 1, NeverCancelled())
    await service.swipe(
        device_key,
        point(20, 30),
        point(80, 60),
        200,
        NeverCancelled(),
    )
    await service.multi_swipe(
        device_key,
        point(30, 40),
        point(60, 40),
        point(90, 40),
        point(120, 40),
        1,
        0,
        NeverCancelled(),
    )

    assert controller.swipes == [(20, 30, 80, 60, 200, 0, 1)]
    assert controller.touch_events[:2] == [
        ("down", 0, 10, 20),
        ("up", 0, None, None),
    ]
    assert controller.touch_events[-2:] == [
        ("up", 1, None, None),
        ("up", 0, None, None),
    ]
    assert ("move", 0, 60, 40) in controller.touch_events
    assert ("move", 1, 120, 40) in controller.touch_events
    assert await service.close() == ()


@pytest.mark.asyncio
async def test_failed_multi_swipe_releases_both_contacts(tmp_path: Path) -> None:
    controller = _Controller(
        np.zeros((100, 200, 3), dtype=np.uint8),
        touch_move_succeeds=False,
    )
    service = _service(tmp_path, [controller])
    device_key, image = await _connected_frame(service)

    def point(x: int) -> RuntimePoint:
        return RuntimePoint(
            x,
            20,
            coordinate_space_id=image.coordinate_space_id,
            source_generation=image.generation,
        )

    with pytest.raises(MaaBackendError) as caught:
        await service.multi_swipe(
            device_key,
            point(10),
            point(30),
            point(50),
            point(70),
            1,
            0,
            NeverCancelled(),
        )

    assert caught.value.code is MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN
    assert controller.touch_events[-2:] == [
        ("up", 1, None, None),
        ("up", 0, None, None),
    ]
    await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "point",
    [
        RuntimePoint(-1, 1, "coordinate-space-1", 1),
        RuntimePoint(200, 1, "coordinate-space-1", 1),
        RuntimePoint(1, 100, "coordinate-space-1", 1),
        RuntimePoint(1, 1),
        RuntimePoint(1, 1, "stale-coordinate-space", 1),
    ],
)
async def test_invalid_or_stale_point_is_rejected_before_dispatch(
    tmp_path: Path,
    point: RuntimePoint,
) -> None:
    controller = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    service = _service(tmp_path, [controller])
    device_key, _ = await _connected_frame(service)

    with pytest.raises(MaaBackendError) as caught:
        await service.click_point(device_key, point, NeverCancelled())

    assert caught.value.code is MaaBackendErrorCode.ACTION_REJECTED
    assert not caught.value.retryable
    assert controller.clicks == []
    await service.close()


@pytest.mark.asyncio
async def test_dimension_change_invalidates_previous_coordinate_space(
    tmp_path: Path,
) -> None:
    controller = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    service = _service(
        tmp_path,
        [controller],
        coordinate_spaces=("coordinate-space-1", "coordinate-space-2"),
    )
    device_key, first_image = await _connected_frame(service)
    controller.pixels = np.zeros((200, 100, 3), dtype=np.uint8)
    second_image = await service.capture_screen(device_key, NeverCancelled())

    assert first_image.coordinate_space_id != second_image.coordinate_space_id
    with pytest.raises(MaaBackendError) as caught:
        await service.click_point(
            device_key,
            RuntimePoint(
                10,
                10,
                first_image.coordinate_space_id,
                first_image.generation,
            ),
            NeverCancelled(),
        )

    assert caught.value.code is MaaBackendErrorCode.ACTION_REJECTED
    assert controller.clicks == []
    await service.close()


@pytest.mark.asyncio
async def test_reconnect_invalidates_previous_coordinate_space(tmp_path: Path) -> None:
    first = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    second = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    service = _service(
        tmp_path,
        [first, second],
        coordinate_spaces=("coordinate-space-1", "coordinate-space-2"),
    )
    device_key, old_image = await _connected_frame(service)
    await service.disconnect(device_key)
    await service.connect(device_key)
    await service.capture_screen(device_key, NeverCancelled())

    with pytest.raises(MaaBackendError) as caught:
        await service.click_point(
            device_key,
            RuntimePoint(
                10,
                10,
                old_image.coordinate_space_id,
                old_image.generation,
            ),
            NeverCancelled(),
        )

    assert caught.value.code is MaaBackendErrorCode.ACTION_REJECTED
    assert second.clicks == []
    await service.close()


@pytest.mark.asyncio
async def test_cancelled_action_never_dispatches(tmp_path: Path) -> None:
    controller = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    service = _service(tmp_path, [controller])
    device_key, image = await _connected_frame(service)
    cancellation = CancellationScope()
    cancellation.cancel()

    with pytest.raises(RuntimeCancellationError):
        await service.click_point(
            device_key,
            RuntimePoint(
                10,
                10,
                image.coordinate_space_id,
                image.generation,
            ),
            cancellation,
        )

    assert controller.clicks == []
    await service.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("click_succeeds", "post_click_raises"),
    [(False, False), (True, True)],
)
async def test_unconfirmed_dispatch_is_non_retryable_unknown_outcome(
    tmp_path: Path,
    click_succeeds: bool,
    post_click_raises: bool,
) -> None:
    controller = _Controller(
        np.zeros((100, 200, 3), dtype=np.uint8),
        click_succeeds=click_succeeds,
        post_click_raises=post_click_raises,
    )
    service = _service(tmp_path, [controller])
    device_key, image = await _connected_frame(service)

    with pytest.raises(MaaBackendError) as caught:
        await service.click_point(
            device_key,
            RuntimePoint(
                10,
                10,
                image.coordinate_space_id,
                image.generation,
            ),
            NeverCancelled(),
        )

    assert caught.value.code is MaaBackendErrorCode.ACTION_OUTCOME_UNKNOWN
    assert not caught.value.retryable
    await service.close()


@pytest.mark.asyncio
async def test_host_normalizes_unknown_outcome_without_retrying(tmp_path: Path) -> None:
    controller = _Controller(
        np.zeros((100, 200, 3), dtype=np.uint8),
        click_succeeds=False,
    )
    host = MaaDeviceServiceHost(_service(tmp_path, [controller]))
    device = host.list_devices()[0]
    host.connect(device.device_key)
    image = await host.capture_screen(device.device_key, NeverCancelled())

    with pytest.raises(DeviceServiceError) as caught:
        await host.click_point(
            device.device_key,
            RuntimePoint(
                10,
                10,
                image.coordinate_space_id,
                image.generation,
            ),
            NeverCancelled(),
        )

    assert caught.value.code is DeviceServiceErrorCode.ACTION_OUTCOME_UNKNOWN
    assert not caught.value.retryable
    assert controller.clicks == [(10, 10)]
    host.close()


@pytest.mark.asyncio
async def test_touch_action_node_dispatches_selected_swipe(tmp_path: Path) -> None:
    controller = _Controller(np.zeros((100, 200, 3), dtype=np.uint8))
    host = MaaDeviceServiceHost(_service(tmp_path, [controller]))
    device = host.list_devices()[0]
    host.connect(device.device_key)
    image = await host.capture_screen(device.device_key, NeverCancelled())
    registry = build_maa_backend_registry(host, include_ocr=False)

    await registry.execute(
        "automation.touchAction",
        NodeExecutionContext(
            node_id=uuid4(),
            type_key="automation.touchAction",
            device_key=device.device_key,
            inputs={
                "start": RuntimePoint(
                    10,
                    20,
                    image.coordinate_space_id,
                    image.generation,
                ),
                "end": RuntimePoint(
                    40,
                    50,
                    image.coordinate_space_id,
                    image.generation,
                ),
            },
            properties={
                "actionType": "swipe",
                "longPressDurationMilliseconds": 1_000,
                "swipeDurationMilliseconds": 240,
                "secondaryStartDelayMilliseconds": 0,
            },
        ),
    )

    assert controller.swipes == [(10, 20, 40, 50, 240, 0, 1)]
    host.close()


class _FailingActionBackend:
    def __init__(self, code: DeviceServiceErrorCode) -> None:
        self.code = code

    async def click_point(
        self,
        device_key: str,
        point: RuntimePoint,
        cancellation: object,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        del device_key, point, cancellation, correlation
        raise DeviceServiceError(
            self.code,
            "Controlled action failure.",
            retryable=False,
        )


class _RecordingPointBackend:
    def __init__(self) -> None:
        self.points: list[RuntimePoint] = []

    async def click_point(
        self,
        device_key: str,
        point: RuntimePoint,
        cancellation: object,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        del device_key, cancellation, correlation
        self.points.append(point)


class _RecordingRectBackend:
    def __init__(self) -> None:
        self.rectangles: list[RuntimeRect] = []

    async def click_rect_center(
        self,
        device_key: str,
        rect: RuntimeRect,
        cancellation: object,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        del device_key, cancellation, correlation
        self.rectangles.append(rect)


@pytest.mark.asyncio
async def test_click_rectangle_offset_is_applied_before_device_dispatch() -> None:
    backend = _RecordingRectBackend()
    registry = build_maa_backend_registry(
        cast(AutomationBackend, backend),
        include_ocr=False,
    )
    source_rect = RuntimeRect(200, 120, 80, 60, "coordinate-space", 7)

    await registry.execute(
        "automation.clickRectCenter",
        NodeExecutionContext(
            node_id=uuid4(),
            type_key="automation.clickRectCenter",
            device_key="device-opaque",
            inputs={"rect": source_rect},
        ),
    )
    await registry.execute(
        "automation.clickRectCenter",
        NodeExecutionContext(
            node_id=uuid4(),
            type_key="automation.clickRectCenter",
            device_key="device-opaque",
            inputs={"rect": source_rect},
            properties={
                "offsetX": -40,
                "offsetY": 30,
                "offsetWidth": 20,
                "offsetHeight": -10,
            },
        ),
    )

    assert backend.rectangles == [
        source_rect,
        RuntimeRect(160, 150, 100, 50, "coordinate-space", 7),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "properties",
    (
        {"offsetX": -201},
        {"offsetY": -121},
        {"offsetWidth": -80},
        {"offsetHeight": -60},
    ),
)
async def test_click_rectangle_rejects_invalid_offset_geometry(
    properties: dict[str, int],
) -> None:
    backend = _RecordingRectBackend()
    registry = build_maa_backend_registry(
        cast(AutomationBackend, backend),
        include_ocr=False,
    )

    with pytest.raises(NodeExecutionFailure) as caught:
        await registry.execute(
            "automation.clickRectCenter",
            NodeExecutionContext(
                node_id=uuid4(),
                type_key="automation.clickRectCenter",
                device_key="device-opaque",
                inputs={
                    "rect": RuntimeRect(
                        200,
                        120,
                        80,
                        60,
                        "coordinate-space",
                        7,
                    )
                },
                properties=properties,
            ),
        )

    assert caught.value.code is NodeExecutionFailureCode.COORDINATE_OUT_OF_BOUNDS
    assert backend.rectangles == []


@pytest.mark.asyncio
async def test_click_node_binds_direct_coordinates_to_the_input_image() -> None:
    backend = _RecordingPointBackend()
    registry = build_maa_backend_registry(
        cast(AutomationBackend, backend),
        include_ocr=False,
    )
    image = RuntimeImageReference(
        handle_id="image-1",
        width=1080,
        height=1920,
        coordinate_space_id="coordinate-space",
        generation=7,
        expires_at_monotonic=float("inf"),
    )

    result = await registry.execute(
        "automation.clickPoint",
        NodeExecutionContext(
            node_id=uuid4(),
            type_key="automation.clickPoint",
            device_key="device-opaque",
            properties={"inputMode": "coordinates"},
            inputs={
                "image": image,
                "x": 120,
                "y": 340,
                "referenceWidth": 1080,
                "referenceHeight": 1920,
            },
        ),
    )

    assert result.outputs == {
        "clicked": True,
        "clickedCount": 1,
        "selectedIndex": 1,
    }
    assert backend.points == [RuntimePoint(120, 340, "coordinate-space", 7)]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("service_code", "node_code", "can_follow_failure_output"),
    [
        (
            DeviceServiceErrorCode.ACTION_OUTCOME_UNKNOWN,
            NodeExecutionFailureCode.ACTION_OUTCOME_UNKNOWN,
            False,
        ),
        (
            DeviceServiceErrorCode.ACTION_REJECTED,
            NodeExecutionFailureCode.ACTION_FAILED,
            True,
        ),
        (
            DeviceServiceErrorCode.CONNECTION_LOST,
            NodeExecutionFailureCode.ACTION_FAILED,
            False,
        ),
    ],
)
async def test_node_executor_preserves_unknown_outcome_distinction(
    service_code: DeviceServiceErrorCode,
    node_code: NodeExecutionFailureCode,
    can_follow_failure_output: bool,
) -> None:
    backend = cast(AutomationBackend, _FailingActionBackend(service_code))
    registry = build_maa_backend_registry(backend, include_ocr=False)

    with pytest.raises(NodeExecutionFailure) as caught:
        await registry.execute(
            "automation.clickPoint",
            NodeExecutionContext(
                node_id=uuid4(),
                type_key="automation.clickPoint",
                device_key="device-opaque",
                inputs={"point": RuntimePoint(1, 2, "coordinate-space", 1)},
            ),
        )

    assert caught.value.code is node_code
    assert caught.value.can_follow_failure_output is can_follow_failure_output


def test_production_registry_exposes_only_reviewed_click_actions() -> None:
    backend = cast(AutomationBackend, object())
    registry = build_maa_backend_registry(backend, include_ocr=False)

    assert "automation.clickPoint" in registry.type_keys
    assert "automation.clickRectCenter" in registry.type_keys
    assert all("shell" not in type_key.lower() for type_key in registry.type_keys)
    assert all("command" not in type_key.lower() for type_key in registry.type_keys)
    assert all("custom" not in type_key.lower() for type_key in registry.type_keys)
