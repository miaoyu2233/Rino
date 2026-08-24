"""Tests for the pinned MaaFramework facade and safe initialization defaults."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from threading import Event
from types import SimpleNamespace
from typing import Self
from uuid import UUID

import numpy as np
import pytest
from numpy.typing import NDArray

from rino_runtime.backends.base import (
    AutomationCallbackDiagnostic,
    AutomationCallbackDiagnosticCode,
    AutomationOperationCorrelation,
    AutomationOperationEvent,
    AutomationOperationKind,
)
from rino_runtime.backends.maa import (
    EXPECTED_MAA_AGENT_BINARY_VERSION,
    EXPECTED_MAA_FRAMEWORK_VERSION,
    EXPECTED_MAA_RUNTIME_VERSION,
    MaaAdbDeviceSpec,
    MaaApi,
    MaaBackendError,
    MaaBackendErrorCode,
    MaaRuntimeConfiguration,
    OfficialMaaBinding,
)


@dataclass
class _Job:
    succeeded: bool = True
    job_id: int = 1

    def wait(self) -> Self:
        return self

    def get(self, wait: bool = False) -> NDArray[np.uint8]:
        del wait
        return np.zeros((2, 3, 3), dtype=np.uint8)


class _Controller:
    def __init__(self) -> None:
        self.connected = False
        self.raw_size_enabled: bool | None = None
        self.inactive_calls = 0
        self.sinks: dict[int, _Sink] = {}
        self.removed_sink_ids: list[int] = []

    def post_connection(self) -> _Job:
        self.connected = True
        return _Job()

    def post_inactive(self) -> _Job:
        self.inactive_calls += 1
        self.connected = False
        return _Job()

    def post_screencap(self) -> _Job:
        return _Job()

    def set_screenshot_use_raw_size(self, enable: bool) -> bool:
        self.raw_size_enabled = enable
        return True

    def add_sink(self, sink: object) -> int:
        sink_id = len(self.sinks) + 1
        self.sinks[sink_id] = sink
        return sink_id

    def remove_sink(self, sink_id: int) -> None:
        self.removed_sink_ids.append(sink_id)
        self.sinks.pop(sink_id)


class _Sink:
    def __init__(self, receiver: Callable[[object, object], None]) -> None:
        self.receiver = receiver


class _Toolkit:
    def __init__(self, devices: list[object] | None = None) -> None:
        self.devices = devices or []
        self.initialization: tuple[Path | str, dict[str, object]] | None = None
        self.specified_adb: Path | str | None = None

    def init_option(
        self,
        user_path: Path | str,
        default_config: dict[str, object],
    ) -> bool:
        self.initialization = (user_path, default_config)
        return True

    def find_adb_devices(
        self,
        specified_adb: Path | str | None = None,
    ) -> list[object]:
        self.specified_adb = specified_adb
        return self.devices


class _Library:
    def __init__(self, runtime_version: str = EXPECTED_MAA_RUNTIME_VERSION) -> None:
        self.runtime_version = runtime_version

    def version(self) -> str:
        return self.runtime_version


class _Tasker:
    def __init__(self) -> None:
        self.debug_mode: bool | None = None
        self.save_draw: bool | None = None
        self.save_on_error: bool | None = None
        self.stdout_level: object | None = None

    def set_debug_mode(self, enabled: bool) -> None:
        self.debug_mode = enabled

    def set_save_draw(self, enabled: bool) -> None:
        self.save_draw = enabled

    def set_save_on_error(self, enabled: bool) -> None:
        self.save_on_error = enabled

    def set_stdout_level(self, level: object) -> None:
        self.stdout_level = level


class _Resource:
    def use_cpu(self) -> bool:
        return True

    def override_image(
        self,
        image_name: str,
        image: NDArray[np.uint8],
    ) -> bool:
        del image_name, image
        return True


class _ControllerFactory:
    def __init__(self) -> None:
        self.arguments: tuple[object, ...] | None = None
        self.controller = _Controller()

    def __call__(
        self,
        adb_path: Path | str,
        address: str,
        screencap_methods: int,
        input_methods: int,
        config: dict[str, object],
        agent_path: Path | str,
    ) -> _Controller:
        self.arguments = (
            adb_path,
            address,
            screencap_methods,
            input_methods,
            config,
            agent_path,
        )
        return self.controller


def _package_version(name: str) -> str:
    return {
        "MaaFw": EXPECTED_MAA_FRAMEWORK_VERSION,
        "MaaAgentBinary": EXPECTED_MAA_AGENT_BINARY_VERSION,
    }[name]


def _binding(
    tmp_path: Path,
    *,
    runtime_version: str = EXPECTED_MAA_RUNTIME_VERSION,
    devices: list[object] | None = None,
    with_callbacks: bool = False,
) -> tuple[OfficialMaaBinding, _Toolkit, _Tasker, _ControllerFactory, Path]:
    adb_path = tmp_path / "adb.exe"
    adb_path.write_bytes(b"test adb placeholder")
    agent_directory = tmp_path / "agent"
    agent_directory.mkdir()
    toolkit = _Toolkit(devices)
    tasker = _Tasker()
    factory = _ControllerFactory()
    api = MaaApi(
        toolkit=toolkit,
        library=_Library(runtime_version),
        tasker=tasker,
        logging_off=0,
        adb_controller_factory=factory,
        resource_factory=_Resource,
        tasker_factory=lambda: tasker,
        ocr_parameter_factory=lambda **parameters: parameters,
        event_sink_factory=(lambda receiver: _Sink(receiver))
        if with_callbacks
        else None,
    )
    binding = OfficialMaaBinding(
        MaaRuntimeConfiguration(
            user_data_directory=tmp_path / "user-data",
            adb_executable_path=adb_path,
            agent_binary_directory=agent_directory,
        ),
        api_loader=lambda: api,
        package_version_loader=_package_version,
    )
    return binding, toolkit, tasker, factory, agent_directory


def test_initialize_pins_versions_and_disables_private_diagnostics(
    tmp_path: Path,
) -> None:
    binding, toolkit, tasker, _, _ = _binding(tmp_path)

    runtime_info = binding.initialize()
    repeated = binding.initialize()

    assert repeated is runtime_info
    assert runtime_info.framework_package_version == EXPECTED_MAA_FRAMEWORK_VERSION
    assert runtime_info.framework_runtime_version == EXPECTED_MAA_RUNTIME_VERSION
    assert toolkit.initialization == (
        tmp_path / "user-data",
        {
            "logging": False,
            "save_draw": False,
            "save_on_error": False,
            "stdout_level": 0,
        },
    )
    assert tasker.debug_mode is False
    assert tasker.save_draw is False
    assert tasker.save_on_error is False
    assert tasker.stdout_level == 0


def test_controller_callback_registration_is_correlated_and_retired(
    tmp_path: Path,
) -> None:
    binding, _, _, factory, _ = _binding(tmp_path, with_callbacks=True)
    binding.initialize()
    delivered = Event()
    events: list[AutomationOperationEvent | AutomationCallbackDiagnostic] = []

    def receive(
        event: AutomationOperationEvent | AutomationCallbackDiagnostic,
    ) -> None:
        events.append(event)
        delivered.set()

    binding.set_callback_event_sink(receive)
    controller = binding.create_adb_controller(
        MaaAdbDeviceSpec(
            adb_path=tmp_path / "adb.exe",
            address="private-address",
            screencap_methods=1,
            input_methods=1,
            config={},
        )
    )
    sink = factory.controller.sinks[1]
    binding.bind_controller_operation(
        controller,
        51,
        AutomationOperationKind.CLICK,
        AutomationOperationCorrelation(request_id=UUID(int=1)),
    )

    sink.receiver(
        "Controller.Action.Succeeded",
        {
            "ctrl_id": 51,
            "uuid": "private-device-identity",
            "param": {"private": True},
        },
    )

    assert delivered.wait(timeout=1)
    assert isinstance(events[0], AutomationOperationEvent)
    assert events[0].operation_kind is AutomationOperationKind.CLICK
    assert "private-device-identity" not in repr(events[0])
    delivered.clear()

    binding.release_controller_callbacks(controller)
    assert factory.controller.removed_sink_ids == [1]
    sink.receiver(
        "Controller.Action.Succeeded",
        {"ctrl_id": 51, "uuid": "stale-private-identity"},
    )

    assert delivered.wait(timeout=1)
    assert isinstance(events[-1], AutomationCallbackDiagnostic)
    assert events[-1].code is AutomationCallbackDiagnosticCode.STALE_GENERATION
    binding.close_callback_events()


def test_version_mismatch_fails_before_toolkit_initialization(tmp_path: Path) -> None:
    binding, toolkit, _, _, _ = _binding(tmp_path, runtime_version="v0.0.0")

    with pytest.raises(MaaBackendError) as caught:
        binding.initialize()

    assert caught.value.code is MaaBackendErrorCode.VERSION_MISMATCH
    assert not caught.value.retryable
    assert toolkit.initialization is None


def test_discovery_uses_only_the_configured_adb_and_copies_private_fields(
    tmp_path: Path,
) -> None:
    raw_device = SimpleNamespace(
        adb_path=tmp_path / "adb.exe",
        address="private-device-address",
        screencap_methods=7,
        input_methods=9,
        config={"private": "value"},
    )
    binding, toolkit, _, factory, agent_directory = _binding(
        tmp_path,
        devices=[raw_device],
    )
    binding.initialize()

    devices = binding.discover_adb_devices()
    controller = binding.create_adb_controller(devices[0])

    assert toolkit.specified_adb == tmp_path / "adb.exe"
    assert len(devices) == 1
    assert devices[0].address == "private-device-address"
    assert factory.arguments == (
        (tmp_path / "adb.exe").resolve(),
        "private-device-address",
        7,
        9,
        {"private": "value"},
        agent_directory.resolve(),
    )
    assert controller is factory.controller
    assert factory.controller.raw_size_enabled is True


def test_missing_application_owned_adb_fails_without_path_fallback(
    tmp_path: Path,
) -> None:
    agent_directory = tmp_path / "agent"
    agent_directory.mkdir()
    api = MaaApi(
        toolkit=_Toolkit(),
        library=_Library(),
        tasker=_Tasker(),
        logging_off=0,
        adb_controller_factory=_ControllerFactory(),
        resource_factory=_Resource,
        tasker_factory=_Tasker,
        ocr_parameter_factory=lambda **parameters: parameters,
    )
    binding = OfficialMaaBinding(
        MaaRuntimeConfiguration(
            user_data_directory=tmp_path / "user-data",
            adb_executable_path=tmp_path / "missing-adb.exe",
            agent_binary_directory=agent_directory,
        ),
        api_loader=lambda: api,
        package_version_loader=_package_version,
    )

    with pytest.raises(MaaBackendError) as caught:
        binding.initialize()

    assert caught.value.code is MaaBackendErrorCode.INITIALIZATION_FAILED
    assert "missing-adb" not in caught.value.technical_detail
