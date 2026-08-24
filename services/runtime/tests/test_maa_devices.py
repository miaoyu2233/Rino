"""Lifecycle and privacy tests for opaque Maa ADB device sessions."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Self

import numpy as np
import pytest
from numpy.typing import NDArray

from rino_runtime.backends.base import AutomationDeviceState
from rino_runtime.backends.maa import (
    EXPECTED_MAA_AGENT_BINARY_VERSION,
    EXPECTED_MAA_FRAMEWORK_VERSION,
    EXPECTED_MAA_RUNTIME_VERSION,
    MaaAdbDeviceSpec,
    MaaBackendError,
    MaaBackendErrorCode,
    MaaDeviceService,
    MaaRuntimeInfo,
)
from rino_runtime.execution_control import NeverCancelled


@dataclass
class _Job:
    succeeded: bool = True

    def wait(self) -> Self:
        return self

    def get(self, wait: bool = False) -> NDArray[np.uint8]:
        del wait
        return np.zeros((2, 3, 3), dtype=np.uint8)


class _Controller:
    def __init__(
        self,
        *,
        connection_succeeds: bool = True,
        inactive_succeeds: bool = True,
    ) -> None:
        self.connected = False
        self.connection_succeeds = connection_succeeds
        self.inactive_succeeds = inactive_succeeds
        self.inactive_calls = 0

    def post_connection(self) -> _Job:
        self.connected = self.connection_succeeds
        return _Job(self.connection_succeeds)

    def post_inactive(self) -> _Job:
        self.inactive_calls += 1
        self.connected = False
        return _Job(self.inactive_succeeds)

    def post_screencap(self) -> _Job:
        return _Job()

    def set_screenshot_use_raw_size(self, enable: bool) -> bool:
        return enable


class _Binding:
    def __init__(
        self,
        specifications: tuple[MaaAdbDeviceSpec, ...],
        controllers: list[_Controller] | None = None,
    ) -> None:
        self.specifications = specifications
        self.controllers = controllers or [_Controller()]
        self.initialize_calls = 0
        self.created_controllers: list[_Controller] = []
        self._runtime_info = MaaRuntimeInfo(
            framework_package_version=EXPECTED_MAA_FRAMEWORK_VERSION,
            framework_runtime_version=EXPECTED_MAA_RUNTIME_VERSION,
            agent_binary_package_version=EXPECTED_MAA_AGENT_BINARY_VERSION,
        )

    @property
    def runtime_info(self) -> MaaRuntimeInfo:
        return self._runtime_info

    def initialize(self) -> MaaRuntimeInfo:
        self.initialize_calls += 1
        return self._runtime_info

    def discover_adb_devices(self) -> tuple[MaaAdbDeviceSpec, ...]:
        return self.specifications

    def create_adb_controller(self, device: MaaAdbDeviceSpec) -> _Controller:
        del device
        controller = self.controllers.pop(0)
        self.created_controllers.append(controller)
        return controller


def _specification(
    tmp_path: Path,
    address: str = "private-device-address",
) -> MaaAdbDeviceSpec:
    return MaaAdbDeviceSpec(
        adb_path=(tmp_path / "adb.exe").resolve(),
        address=address,
        screencap_methods=1,
        input_methods=2,
        config={},
    )


@pytest.mark.asyncio
async def test_discovery_returns_stable_opaque_keys_without_private_metadata(
    tmp_path: Path,
) -> None:
    binding = _Binding((_specification(tmp_path),))
    service = MaaDeviceService(binding, device_key_factory=lambda: "device-opaque")

    first = await service.discover()
    second = await service.discover()

    assert first == second
    assert first[0].device_key == "device-opaque"
    assert first[0].display_name == "Android device 1"
    assert first[0].state is AutomationDeviceState.AVAILABLE
    assert "private-device-address" not in repr(first[0])
    assert str(tmp_path) not in repr(first[0])
    assert binding.initialize_calls == 1
    assert await service.close() == ()


@pytest.mark.asyncio
async def test_controller_access_requires_an_active_connection(tmp_path: Path) -> None:
    service = MaaDeviceService(
        _Binding((_specification(tmp_path),)),
        device_key_factory=lambda: "device-opaque",
    )
    await service.discover()

    with pytest.raises(MaaBackendError) as caught:
        async with service.connected_controller(
            "device-opaque",
            NeverCancelled(),
        ):
            raise AssertionError("An unconnected controller was exposed.")

    assert caught.value.code is MaaBackendErrorCode.DEVICE_NOT_CONNECTED
    assert caught.value.retryable
    assert await service.close() == ()


@pytest.mark.asyncio
async def test_connect_health_disconnect_and_reconnect(tmp_path: Path) -> None:
    first_controller = _Controller()
    second_controller = _Controller()
    binding = _Binding(
        (_specification(tmp_path),),
        [first_controller, second_controller],
    )
    service = MaaDeviceService(binding, device_key_factory=lambda: "device-opaque")
    await service.discover()

    connected = await service.connect("device-opaque")
    healthy = await service.check_health("device-opaque")
    disconnected = await service.disconnect("device-opaque")
    reconnected = await service.connect("device-opaque")

    assert connected.state is AutomationDeviceState.CONNECTED
    assert healthy.state is AutomationDeviceState.CONNECTED
    assert disconnected.state is AutomationDeviceState.AVAILABLE
    assert reconnected.state is AutomationDeviceState.CONNECTED
    assert first_controller.inactive_calls == 1
    assert binding.created_controllers == [first_controller, second_controller]
    assert await service.close() == ()
    assert second_controller.inactive_calls == 1


@pytest.mark.asyncio
async def test_connection_failure_never_publishes_a_session(tmp_path: Path) -> None:
    controller = _Controller(connection_succeeds=False)
    service = MaaDeviceService(
        _Binding((_specification(tmp_path),), [controller]),
        device_key_factory=lambda: "device-opaque",
    )
    await service.discover()

    with pytest.raises(MaaBackendError) as caught:
        await service.connect("device-opaque")

    assert caught.value.code is MaaBackendErrorCode.DEVICE_CONNECTION_FAILED
    assert controller.inactive_calls == 1
    with pytest.raises(MaaBackendError) as unconnected:
        async with service.connected_controller(
            "device-opaque",
            NeverCancelled(),
        ):
            raise AssertionError("A failed controller was exposed.")
    assert unconnected.value.code is MaaBackendErrorCode.DEVICE_NOT_CONNECTED
    assert await service.close() == ()


@pytest.mark.asyncio
async def test_connection_loss_is_detected_before_device_access(tmp_path: Path) -> None:
    controller = _Controller()
    replacement = _Controller()
    service = MaaDeviceService(
        _Binding((_specification(tmp_path),), [controller, replacement]),
        device_key_factory=lambda: "device-opaque",
    )
    await service.discover()
    await service.connect("device-opaque")
    controller.connected = False

    with pytest.raises(MaaBackendError) as caught:
        await service.check_health("device-opaque")

    assert caught.value.code is MaaBackendErrorCode.DEVICE_CONNECTION_LOST
    reconnected = await service.connect("device-opaque")
    assert reconnected.state is AutomationDeviceState.CONNECTED
    assert controller.inactive_calls == 1
    assert await service.close() == ()


@pytest.mark.asyncio
async def test_same_device_controller_access_is_serialized(tmp_path: Path) -> None:
    service = MaaDeviceService(
        _Binding((_specification(tmp_path),), [_Controller()]),
        device_key_factory=lambda: "device-opaque",
    )
    await service.discover()
    await service.connect("device-opaque")
    second_entered = asyncio.Event()

    async def second_user() -> None:
        async with service.connected_controller(
            "device-opaque",
            NeverCancelled(),
        ):
            second_entered.set()

    async with service.connected_controller("device-opaque", NeverCancelled()):
        task = asyncio.create_task(second_user())
        await asyncio.sleep(0)
        assert not second_entered.is_set()
    await asyncio.wait_for(second_entered.wait(), timeout=1)
    await task
    assert await service.close() == ()


@pytest.mark.asyncio
async def test_shutdown_releases_sessions_and_reports_deactivation_failure(
    tmp_path: Path,
) -> None:
    controller = _Controller(inactive_succeeds=False)
    service = MaaDeviceService(
        _Binding((_specification(tmp_path),), [controller]),
        device_key_factory=lambda: "device-opaque",
    )
    await service.discover()
    await service.connect("device-opaque")

    failures = await service.close()

    assert failures == (MaaBackendErrorCode.DEVICE_DEACTIVATION_FAILED,)
    assert controller.inactive_calls == 1
    assert await service.close() == ()
    with pytest.raises(MaaBackendError) as caught:
        await service.discover()
    assert caught.value.code is MaaBackendErrorCode.SERVICE_CLOSED
