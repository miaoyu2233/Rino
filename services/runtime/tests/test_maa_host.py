"""Thread ownership and error normalization tests for the Maa device host."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Self

import numpy as np
import pytest
from numpy.typing import NDArray

from rino_runtime.backends.android_actions import AndroidKey
from rino_runtime.backends.base import (
    AutomationDeviceState,
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
    MaaDeviceService,
    MaaDeviceServiceHost,
    MaaRuntimeInfo,
)
from rino_runtime.execution_control import NeverCancelled


class _Job:
    succeeded = True

    def wait(self) -> Self:
        return self

    def get(self, wait: bool = False) -> NDArray[np.uint8]:
        del wait
        return np.zeros((2, 3, 3), dtype=np.uint8)


class _Controller:
    def __init__(self) -> None:
        self.connected = False
        self.app_starts: list[str] = []
        self.keys: list[int] = []

    def post_connection(self) -> _Job:
        self.connected = True
        return _Job()

    def post_inactive(self) -> _Job:
        self.connected = False
        return _Job()

    def post_screencap(self) -> _Job:
        return _Job()

    def post_start_app(self, intent: str) -> _Job:
        self.app_starts.append(intent)
        return _Job()

    def post_click_key(self, key: int) -> _Job:
        self.keys.append(key)
        return _Job()

    def set_screenshot_use_raw_size(self, enable: bool) -> bool:
        return enable


class _Binding:
    def __init__(self, specification: MaaAdbDeviceSpec) -> None:
        self.specification = specification
        self.controller = _Controller()
        self.thread_ids: set[int] = set()
        self._runtime_info = MaaRuntimeInfo(
            framework_package_version=EXPECTED_MAA_FRAMEWORK_VERSION,
            framework_runtime_version=EXPECTED_MAA_RUNTIME_VERSION,
            agent_binary_package_version=EXPECTED_MAA_AGENT_BINARY_VERSION,
        )

    @property
    def runtime_info(self) -> MaaRuntimeInfo:
        return self._runtime_info

    def initialize(self) -> MaaRuntimeInfo:
        self.thread_ids.add(threading.get_ident())
        return self._runtime_info

    def discover_adb_devices(self) -> tuple[MaaAdbDeviceSpec, ...]:
        self.thread_ids.add(threading.get_ident())
        return (self.specification,)

    def create_adb_controller(self, device: MaaAdbDeviceSpec) -> _Controller:
        self.thread_ids.add(threading.get_ident())
        assert device is self.specification
        return self.controller


def _host(tmp_path: Path) -> tuple[MaaDeviceServiceHost, _Binding]:
    specification = MaaAdbDeviceSpec(
        adb_path=(tmp_path / "adb.exe").resolve(),
        address="private-device-address",
        screencap_methods=1,
        input_methods=2,
        config={},
    )
    binding = _Binding(specification)
    host = MaaDeviceServiceHost(
        MaaDeviceService(binding, device_key_factory=lambda: "device-opaque")
    )
    return host, binding


def test_host_keeps_blocking_binding_calls_off_caller_and_normalizes_metadata(
    tmp_path: Path,
) -> None:
    caller_thread = threading.get_ident()
    host, binding = _host(tmp_path)

    devices = host.list_devices()
    connected = host.connect(devices[0].device_key)
    disconnected = host.disconnect(devices[0].device_key)
    failures = host.close()

    assert host.runtime_info.backend_key == "maa"
    assert host.runtime_info.binding_version == EXPECTED_MAA_FRAMEWORK_VERSION
    assert host.runtime_info.native_version == EXPECTED_MAA_FRAMEWORK_VERSION
    assert connected.state is AutomationDeviceState.CONNECTED
    assert disconnected.state is AutomationDeviceState.AVAILABLE
    assert failures == ()
    assert binding.thread_ids
    assert caller_thread not in binding.thread_ids


def test_host_rejects_requests_after_close_without_leaking_coroutines(
    tmp_path: Path,
) -> None:
    host, _ = _host(tmp_path)
    assert host.close() == ()

    with pytest.raises(DeviceServiceError) as caught:
        host.list_devices()

    assert caught.value.code is DeviceServiceErrorCode.SERVICE_CLOSED


@pytest.mark.asyncio
async def test_host_dispatches_explicit_android_actions_on_binding_thread(
    tmp_path: Path,
) -> None:
    host, binding = _host(tmp_path)
    caller_thread = threading.get_ident()
    device_key = host.list_devices()[0].device_key
    host.connect(device_key)

    await host.launch_android_app(
        device_key,
        "com.example.game/.MainActivity",
        NeverCancelled(),
    )
    await host.press_android_key(device_key, AndroidKey.ESCAPE, NeverCancelled())

    assert binding.controller.app_starts == ["com.example.game/.MainActivity"]
    assert binding.controller.keys == [111]
    assert caller_thread not in binding.thread_ids
    assert host.close() == ()


class _FailingBinding(_Binding):
    def discover_adb_devices(self) -> tuple[MaaAdbDeviceSpec, ...]:
        raise MaaBackendError(
            MaaBackendErrorCode.DEVICE_DISCOVERY_FAILED,
            "The controlled discovery failed.",
            retryable=True,
        )


def test_host_maps_backend_errors_to_rino_owned_codes(tmp_path: Path) -> None:
    specification = MaaAdbDeviceSpec(
        adb_path=(tmp_path / "adb.exe").resolve(),
        address="private-device-address",
        screencap_methods=1,
        input_methods=2,
        config={},
    )
    host = MaaDeviceServiceHost(MaaDeviceService(_FailingBinding(specification)))

    with pytest.raises(DeviceServiceError) as caught:
        host.list_devices()

    assert caught.value.code is DeviceServiceErrorCode.DISCOVERY_FAILED
    assert caught.value.retryable
    assert host.close() == ()
