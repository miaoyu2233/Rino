"""Run a sanitized Maa-backed Android acceptance probe.

The probe never writes captures, prints recognized text, or exposes device identifiers.
It is an explicit developer acceptance tool and is not part of the desktop executable.
"""

from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import os
import re
import subprocess
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from rino_runtime.backends.base import DeviceServiceError
from rino_runtime.backends.maa import (
    MaaAdbDeviceSpec,
    MaaBackendError,
    MaaController,
    MaaDeviceService,
    MaaDeviceServiceHost,
    MaaOcrSession,
    MaaRuntimeConfiguration,
    MaaRuntimeInfo,
    OfficialMaaBinding,
)
from rino_runtime.execution_control import (
    CancellationScope,
    NeverCancelled,
    RuntimeCancellationError,
)
from rino_runtime.ipc.stdio_boundary import reserve_protocol_stdout
from rino_runtime.nodes import RuntimeImageReference, RuntimeOcrResult, RuntimeRect


@dataclass(frozen=True, slots=True)
class ProbeOptions:
    adb_executable: Path
    mumu_cli_executable: Path | None
    model_directory: Path
    user_data_directory: Path
    click_rect: tuple[int, int, int, int] | None
    settle_milliseconds: int
    device_profile: str


class ExplicitDeviceBinding:
    """Keeps official Maa operations while replacing only Toolkit discovery."""

    def __init__(
        self,
        binding: OfficialMaaBinding,
        device: MaaAdbDeviceSpec,
    ) -> None:
        self._binding = binding
        self._device = device

    @property
    def runtime_info(self) -> MaaRuntimeInfo:
        return self._binding.runtime_info

    @property
    def ocr_available(self) -> bool:
        return self._binding.ocr_available

    def initialize(self) -> MaaRuntimeInfo:
        return self._binding.initialize()

    def discover_adb_devices(self) -> tuple[MaaAdbDeviceSpec, ...]:
        return (self._device,)

    def create_adb_controller(self, device: MaaAdbDeviceSpec) -> MaaController:
        return self._binding.create_adb_controller(device)

    def create_ocr_session(self, controller: MaaController) -> MaaOcrSession:
        return self._binding.create_ocr_session(controller)


def parse_arguments(arguments: Sequence[str] | None = None) -> ProbeOptions:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adb-executable", type=Path, required=True)
    parser.add_argument("--mumu-cli-executable", type=Path)
    parser.add_argument("--model-directory", type=Path, required=True)
    parser.add_argument("--user-data-directory", type=Path, required=True)
    parser.add_argument("--click-rect", type=int, nargs=4, metavar=("X", "Y", "W", "H"))
    parser.add_argument("--settle-milliseconds", type=int, default=750)
    parser.add_argument(
        "--device-profile",
        choices=(
            "toolkit",
            "toolkit-loopback",
            "toolkit-emulator",
            "mumu12",
        ),
        default="toolkit",
    )
    parsed = parser.parse_args(arguments)
    if parsed.device_profile == "mumu12" and parsed.mumu_cli_executable is None:
        parser.error("--mumu-cli-executable is required for the mumu12 profile")
    if parsed.settle_milliseconds < 0 or parsed.settle_milliseconds > 5_000:
        parser.error("--settle-milliseconds must be between 0 and 5000")
    click_rect = (
        (
            int(parsed.click_rect[0]),
            int(parsed.click_rect[1]),
            int(parsed.click_rect[2]),
            int(parsed.click_rect[3]),
        )
        if parsed.click_rect is not None
        else None
    )
    return ProbeOptions(
        adb_executable=parsed.adb_executable,
        mumu_cli_executable=parsed.mumu_cli_executable,
        model_directory=parsed.model_directory,
        user_data_directory=parsed.user_data_directory,
        click_rect=click_rect,
        settle_milliseconds=parsed.settle_milliseconds,
        device_profile=parsed.device_profile,
    )


def explicit_mumu_device(
    adb_executable: Path,
    mumu_cli_executable: Path,
) -> MaaAdbDeviceSpec:
    try:
        completed = subprocess.run(
            [str(mumu_cli_executable), "info", "--vmindex", "all"],
            check=False,
            capture_output=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError("The emulator instance query failed.") from error
    if completed.returncode != 0 or len(completed.stdout) > 64 * 1024:
        raise RuntimeError("The emulator instance query was rejected.")
    try:
        payload = json.loads(completed.stdout.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("The emulator instance response was invalid.") from error
    instances = payload if isinstance(payload, list) else [payload]
    candidates = [
        instance for instance in instances if _is_usable_mumu_instance(instance)
    ]
    if len(candidates) != 1:
        raise RuntimeError("The probe requires exactly one running emulator instance.")
    instance = candidates[0]
    index_value = instance.get("index")
    if (
        not isinstance(index_value, str)
        or re.fullmatch(r"\d{1,6}", index_value) is None
    ):
        raise RuntimeError("The emulator instance index was invalid.")
    install_directory = mumu_cli_executable.resolve().parent.parent
    library_candidates = (
        install_directory / "nx_main" / "sdk" / "external_renderer_ipc.dll",
        install_directory / "shell" / "sdk" / "external_renderer_ipc.dll",
    )
    if not any(candidate.is_file() for candidate in library_candidates):
        raise RuntimeError("The emulator control library was unavailable.")
    host_value = instance.get("adb_host_ip")
    port_value = instance.get("adb_port")
    if not isinstance(host_value, str) or not _is_valid_port(port_value):
        raise RuntimeError("The emulator ADB endpoint was invalid.")
    try:
        host = ipaddress.ip_address(host_value)
    except ValueError as error:
        raise RuntimeError("The emulator ADB endpoint was invalid.") from error
    if not host.is_loopback:
        raise RuntimeError("The emulator ADB endpoint must be local.")
    address = _require_ready_mumu_adb_endpoint(
        adb_executable,
        f"{host.compressed}:{port_value}",
    )
    return MaaAdbDeviceSpec(
        adb_path=adb_executable.resolve(),
        address=address,
        screencap_methods=64,
        input_methods=8,
        config={
            "extras": {
                "mumu": {
                    "enable": True,
                    "path": str(install_directory),
                    "index": int(index_value),
                }
            }
        },
    )


def _is_usable_mumu_instance(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    return value.get("is_process_started") is True and value.get("error_code") == 0


def _is_valid_port(value: object) -> bool:
    return (
        isinstance(value, int) and not isinstance(value, bool) and 0 < value <= 65_535
    )


def _require_ready_mumu_adb_endpoint(
    adb_executable: Path,
    address: str,
) -> str:
    _run_adb_command(adb_executable, ("kill-server",))
    _run_adb_command(adb_executable, ("start-server",))
    for _ in range(3):
        _run_adb_command(adb_executable, ("connect", address))
        discovered = _run_adb_command(adb_executable, ("devices",))
        rows = discovered.stdout.decode("utf-8", errors="strict").splitlines()[1:]
        states = {
            columns[0]: columns[1]
            for row in rows
            if len(columns := row.split()) == 2
            and re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", columns[0]) is not None
        }
        if states.get(address) == "device":
            state = _run_adb_command(
                adb_executable,
                ("-s", address, "get-state"),
            )
            if state.stdout.strip() == b"device":
                return address
        _run_adb_command(adb_executable, ("reconnect", "offline"))
        time.sleep(1)
    raise RuntimeError("The emulator ADB endpoint did not become ready.")


def _run_adb_command(
    adb_executable: Path,
    arguments: tuple[str, ...],
) -> subprocess.CompletedProcess[bytes]:
    try:
        completed = subprocess.run(
            [str(adb_executable), *arguments],
            check=False,
            capture_output=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(
            f"The emulator ADB {arguments[0]} command failed."
        ) from error
    if (
        completed.returncode != 0
        or len(completed.stdout) > 64 * 1024
        or len(completed.stderr) > 64 * 1024
    ):
        raise RuntimeError(f"The emulator ADB {arguments[0]} command was rejected.")
    return completed


def summarize_device_specification(device: MaaAdbDeviceSpec) -> dict[str, object]:
    address_kind = classify_device_address(device.address)
    extras = device.config.get("extras")
    mumu = extras.get("mumu") if isinstance(extras, dict) else None
    return {
        "addressKind": address_kind,
        "screencapMethods": device.screencap_methods,
        "inputMethods": device.input_methods,
        "mumuExtrasConfigured": isinstance(mumu, dict) and mumu.get("enable") is True,
    }


def classify_device_address(address: str) -> str:
    address_kind = "other"
    if re.fullmatch(r"emulator-\d{1,12}", address) is not None:
        address_kind = "emulatorSerial"
    else:
        host_value, separator, port_value = address.rpartition(":")
        if separator and port_value.isdecimal():
            try:
                host = ipaddress.ip_address(host_value)
            except ValueError:
                pass
            else:
                address_kind = "loopbackTcp" if host.is_loopback else "networkTcp"
    return address_kind


async def capture(
    host: MaaDeviceServiceHost,
    device_key: str,
) -> RuntimeImageReference:
    return await host.capture_screen(device_key, NeverCancelled())


async def recognize(
    host: MaaDeviceServiceHost,
    device_key: str,
    image: RuntimeImageReference,
) -> RuntimeOcrResult:
    return await host.recognize_ocr(
        device_key,
        image,
        None,
        0.3,
        NeverCancelled(),
    )


async def click_rectangle(
    host: MaaDeviceServiceHost,
    device_key: str,
    rectangle: RuntimeRect,
) -> None:
    await host.click_rect_center(device_key, rectangle, NeverCancelled())


async def cancel_ocr(
    host: MaaDeviceServiceHost,
    device_key: str,
    image: RuntimeImageReference,
) -> str:
    cancellation = CancellationScope()
    operation = asyncio.create_task(
        host.recognize_ocr(device_key, image, None, 0.3, cancellation)
    )
    await asyncio.sleep(0.001)
    cancellation.cancel()
    try:
        await operation
    except RuntimeCancellationError:
        return "cancelled"
    return "completedBeforeCancellation"


def rectangles_are_bounded(
    result: RuntimeOcrResult,
    width: int,
    height: int,
) -> bool:
    return all(
        candidate.rect.x >= 0
        and candidate.rect.y >= 0
        and candidate.rect.width > 0
        and candidate.rect.height > 0
        and candidate.rect.x + candidate.rect.width <= width
        and candidate.rect.y + candidate.rect.height <= height
        for candidate in result.candidates
    )


def run_probe(options: ProbeOptions) -> dict[str, object]:
    official_binding = OfficialMaaBinding(
        MaaRuntimeConfiguration(
            user_data_directory=options.user_data_directory.resolve(),
            adb_executable_path=options.adb_executable.resolve(),
            ocr_model_directory=options.model_directory.resolve(),
        )
    )
    if options.device_profile == "mumu12":
        mumu_cli_executable = options.mumu_cli_executable
        if mumu_cli_executable is None:
            raise RuntimeError("The emulator manager executable is required.")
        binding: OfficialMaaBinding | ExplicitDeviceBinding = ExplicitDeviceBinding(
            official_binding,
            explicit_mumu_device(options.adb_executable, mumu_cli_executable),
        )
    elif options.device_profile in {"toolkit-loopback", "toolkit-emulator"}:
        official_binding.initialize()
        specifications = official_binding.discover_adb_devices()
        required_kind = (
            "loopbackTcp"
            if options.device_profile == "toolkit-loopback"
            else "emulatorSerial"
        )
        matches = tuple(
            device
            for device in specifications
            if classify_device_address(device.address) == required_kind
        )
        if len(matches) != 1:
            raise RuntimeError("The requested Toolkit device profile was ambiguous.")
        binding = ExplicitDeviceBinding(official_binding, matches[0])
    else:
        binding = official_binding
    service = MaaDeviceService(binding)
    host: MaaDeviceServiceHost | None = None
    connected_device_key: str | None = None
    image_handles: list[str] = []
    report: dict[str, object] = {
        "passed": False,
        "deviceMetadataRedacted": True,
        "recognizedTextRedacted": True,
        "capturesRetained": False,
    }
    stage = "initialization"
    try:
        host = MaaDeviceServiceHost(service)
        report["runtimeVersionVerified"] = True
        report["ocrModelVerified"] = host.ocr_available

        stage = "discovery"
        devices = host.list_devices()
        report["discoveredDeviceCount"] = len(devices)
        if len(devices) != 1:
            report["failureCode"] = "EXPECTED_ONE_DEVICE"
            if options.device_profile == "toolkit":
                report["discoveryProfiles"] = [
                    summarize_device_specification(device)
                    for device in official_binding.discover_adb_devices()
                ]
            return report

        connected_device_key = devices[0].device_key
        stage = "connection"
        connected = host.connect(connected_device_key)
        report["connected"] = connected.state.value == "connected"

        stage = "capture"
        image = asyncio.run(capture(host, connected_device_key))
        image_handles.append(image.handle_id)
        first_pixels = service.resolve_image(image).pixels.copy()
        report["capture"] = {
            "width": image.width,
            "height": image.height,
            "generationPositive": image.generation > 0,
            "coordinateSpacePresent": bool(image.coordinate_space_id),
        }

        stage = "ocr"
        ocr = asyncio.run(recognize(host, connected_device_key, image))
        report["ocr"] = {
            "operationIdPresent": ocr.operation_id > 0,
            "matched": ocr.matched,
            "candidateCount": len(ocr.candidates),
            "rectanglesBounded": rectangles_are_bounded(
                ocr,
                image.width,
                image.height,
            ),
        }
        stage = "ocrCancellation"
        report["ocrCancellation"] = asyncio.run(
            cancel_ocr(host, connected_device_key, image)
        )

        click_rect = options.click_rect
        if click_rect is not None:
            x, y, width, height = click_rect
            rectangle = RuntimeRect(
                x=x,
                y=y,
                width=width,
                height=height,
                coordinate_space_id=image.coordinate_space_id,
                source_generation=image.generation,
            )
            stage = "click"
            asyncio.run(click_rectangle(host, connected_device_key, rectangle))
            report["clickCompleted"] = True
            time.sleep(options.settle_milliseconds / 1_000)
            stage = "postClickCapture"
            after_click = asyncio.run(capture(host, connected_device_key))
            image_handles.append(after_click.handle_id)
            after_pixels = service.resolve_image(after_click).pixels
            report["frameChangedAfterClick"] = not np.array_equal(
                first_pixels,
                after_pixels,
            )
        else:
            report["clickCompleted"] = False
            report["frameChangedAfterClick"] = None

        stage = "disconnect"
        disconnected = host.disconnect(connected_device_key)
        connected_device_key = None
        report["disconnected"] = disconnected.state.value == "available"
        report["passed"] = all(
            (
                report["runtimeVersionVerified"],
                report["ocrModelVerified"],
                report["connected"],
                report["disconnected"],
                report["clickCompleted"] if click_rect is not None else True,
                isinstance(report["capture"], dict),
                isinstance(report["ocr"], dict),
            )
        )
        return report
    except (MaaBackendError, DeviceServiceError) as error:
        report["failureStage"] = stage
        report["failureCode"] = error.code.value
        report["retryable"] = error.retryable
        return report
    finally:
        if host is not None:
            for handle_id in image_handles:
                host.release_image(handle_id)
            if connected_device_key is not None:
                try:
                    host.disconnect(connected_device_key)
                except DeviceServiceError:
                    pass
            report["shutdownFailures"] = [failure.value for failure in host.close()]


def main(arguments: Sequence[str] | None = None) -> int:
    options = parse_arguments(arguments)
    protocol_target = reserve_protocol_stdout()
    try:
        report = run_probe(options)
    except (MaaBackendError, DeviceServiceError) as error:
        report = {
            "passed": False,
            "failureCode": error.code.value,
            "retryable": error.retryable,
            "deviceMetadataRedacted": True,
            "recognizedTextRedacted": True,
            "capturesRetained": False,
        }
    except RuntimeError as error:
        report = {
            "passed": False,
            "failureCode": "PROBE_SETUP_FAILED",
            "failureDetail": str(error),
            "deviceMetadataRedacted": True,
            "recognizedTextRedacted": True,
            "capturesRetained": False,
        }
    except (OSError, TypeError, ValueError) as error:
        report = {
            "passed": False,
            "failureCode": type(error).__name__,
            "deviceMetadataRedacted": True,
            "recognizedTextRedacted": True,
            "capturesRetained": False,
        }
    protocol_target.write(
        (
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
    )
    protocol_target.flush()
    exit_code = 0 if report.get("passed") is True else 1
    # A timed-out native operation can leave an executor worker blocked after the host's
    # bounded shutdown attempt. This probe is already isolated as its own process, so an
    # immediate exit mirrors the desktop supervisor's process-containment fallback.
    os._exit(exit_code)


if __name__ == "__main__":
    raise SystemExit(main())
