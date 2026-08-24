"""Run sanitized direct click acceptance against an in-memory Maa controller."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import numpy as np
from rino_runtime.backends.maa import (
    EXPECTED_MAA_AGENT_BINARY_VERSION,
    EXPECTED_MAA_FRAMEWORK_VERSION,
    EXPECTED_MAA_RUNTIME_VERSION,
    MaaAdbDeviceSpec,
    MaaDeviceService,
    MaaRuntimeInfo,
)
from rino_runtime.execution_control import NeverCancelled
from rino_runtime.nodes import RuntimePoint, RuntimeRect

from probe import SafeProbeController, configure_runtime

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class ProbeBinding:
    ocr_available = False

    def __init__(self, controller: SafeProbeController) -> None:
        self._controller = controller
        self._runtime_info = MaaRuntimeInfo(
            framework_package_version=EXPECTED_MAA_FRAMEWORK_VERSION,
            framework_runtime_version=EXPECTED_MAA_RUNTIME_VERSION,
            agent_binary_package_version=EXPECTED_MAA_AGENT_BINARY_VERSION,
        )
        self._specification = MaaAdbDeviceSpec(
            adb_path=Path(__file__).resolve(),
            address="redacted-probe-address",
            screencap_methods=0,
            input_methods=0,
            config={},
        )

    @property
    def runtime_info(self) -> MaaRuntimeInfo:
        return self._runtime_info

    def initialize(self) -> MaaRuntimeInfo:
        return self._runtime_info

    def discover_adb_devices(self) -> tuple[MaaAdbDeviceSpec, ...]:
        return (self._specification,)

    def create_adb_controller(
        self,
        device: MaaAdbDeviceSpec,
    ) -> SafeProbeController:
        if device is not self._specification:
            raise RuntimeError("The probe received an unexpected device specification.")
        if not self._controller.set_screenshot_use_raw_size(True):
            raise RuntimeError(
                "The probe controller rejected raw screenshot coordinates."
            )
        return self._controller


async def run_probe() -> dict[str, object]:
    configure_runtime(
        PROJECT_ROOT / ".ai-local" / "spikes" / "maa-python" / "click-user-data"
    )
    frame = np.zeros((100, 200, 3), dtype=np.uint8)
    controller = SafeProbeController(frame)
    service = MaaDeviceService(
        ProbeBinding(controller),
        device_key_factory=lambda: "redacted-device-key",
        coordinate_space_factory=lambda: "redacted-coordinate-space",
    )
    device_key = (await service.discover())[0].device_key
    await service.connect(device_key)
    image = await service.capture_screen(device_key, NeverCancelled())
    await service.click_point(
        device_key,
        RuntimePoint(
            10,
            20,
            image.coordinate_space_id,
            image.generation,
        ),
        NeverCancelled(),
    )
    await service.click_rect_center(
        device_key,
        RuntimeRect(
            40,
            30,
            20,
            10,
            image.coordinate_space_id,
            image.generation,
        ),
        NeverCancelled(),
    )
    failures = await service.close()
    passed = controller.clicks == [(10, 20), (50, 35)] and not failures
    return {
        "passed": passed,
        "click_count": len(controller.clicks),
        "point_click_verified": controller.clicks[:1] == [(10, 20)],
        "rectangle_center_verified": controller.clicks[1:] == [(50, 35)],
        "shutdown_clean": not failures,
        "device_metadata_redacted": True,
    }


def main() -> int:
    try:
        report = asyncio.run(run_probe())
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        report = {"passed": False, "error_type": type(error).__name__}
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report.get("passed") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
