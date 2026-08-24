from __future__ import annotations

import argparse
import dataclasses
import inspect
import json
import threading
import time
from collections.abc import Sequence
from importlib.metadata import PackageNotFoundError, distribution, version
from pathlib import Path
from typing import cast

import numpy
from maa.controller import Controller, ControllerEventSink, CustomController
from maa.define import LoggingLevelEnum, MaaControllerFeatureEnum, Rect
from maa.job import JobWithResult, TaskJob
from maa.library import Library
from maa.pipeline import JOCR, JClick, JDirectHit
from maa.resource import Resource
from maa.tasker import Tasker, TaskerEventSink
from maa.toolkit import Toolkit

EXPECTED_FRAMEWORK_VERSION = "5.10.5"
EXPECTED_RUNTIME_VERSION = f"v{EXPECTED_FRAMEWORK_VERSION}"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_USER_DATA = PROJECT_ROOT / ".ai-local" / "spikes" / "maa-python" / "user-data"
DEFAULT_PIPELINE = (
    Path(__file__).resolve().parent / "fixtures" / "cancellation-pipeline.json"
)


@dataclasses.dataclass(frozen=True)
class ProbeOptions:
    user_data: Path
    pipeline: Path
    skip_adb_discovery: bool


class SafeProbeController(CustomController):
    def __init__(self, frame: numpy.ndarray) -> None:
        self.frame = frame
        self.callback_thread_ids: set[int] = set()
        self.clicks: list[tuple[int, int]] = []
        super().__init__()

    def _record_callback_thread(self) -> None:
        self.callback_thread_ids.add(threading.get_ident())

    def connect(self) -> bool:
        self._record_callback_thread()
        return True

    def connected(self) -> bool:
        return True

    def request_uuid(self) -> str:
        return "rino-safe-probe-controller"

    def get_features(self) -> int:
        return int(MaaControllerFeatureEnum.Null)

    def start_app(self, intent: str) -> bool:
        return False

    def stop_app(self, intent: str) -> bool:
        return False

    def screencap(self) -> numpy.ndarray:
        self._record_callback_thread()
        return self.frame.copy()

    def click(self, x: int, y: int) -> bool:
        self._record_callback_thread()
        self.clicks.append((x, y))
        return True

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration: int) -> bool:
        return False

    def touch_down(self, contact: int, x: int, y: int, pressure: int) -> bool:
        return False

    def touch_move(self, contact: int, x: int, y: int, pressure: int) -> bool:
        return False

    def touch_up(self, contact: int) -> bool:
        return False

    def click_key(self, keycode: int) -> bool:
        return False

    def input_text(self, text: str) -> bool:
        return False

    def key_down(self, keycode: int) -> bool:
        return False

    def key_up(self, keycode: int) -> bool:
        return False


class RecordingControllerSink(ControllerEventSink):
    def __init__(self) -> None:
        self.thread_ids: set[int] = set()
        self.message_count = 0

    def on_raw_notification(
        self,
        controller: Controller,
        msg: str,
        details: dict[str, object],
    ) -> None:
        self.thread_ids.add(threading.get_ident())
        self.message_count += 1


class RecordingTaskerSink(TaskerEventSink):
    def __init__(self) -> None:
        self.thread_ids: set[int] = set()
        self.message_count = 0

    def on_raw_notification(
        self,
        tasker: Tasker,
        msg: str,
        details: dict[str, object],
    ) -> None:
        self.thread_ids.add(threading.get_ident())
        self.message_count += 1


def parse_arguments(arguments: Sequence[str] | None = None) -> ProbeOptions:
    parser = argparse.ArgumentParser(
        description="Run the isolated MaaFramework Python direct-operation probe."
    )
    parser.add_argument(
        "--user-data",
        type=Path,
        default=DEFAULT_USER_DATA,
        help="Private directory for MaaFramework local configuration.",
    )
    parser.add_argument(
        "--pipeline",
        type=Path,
        default=DEFAULT_PIPELINE,
        help="Test-only pipeline used solely for cancellation verification.",
    )
    parser.add_argument(
        "--skip-adb-discovery",
        action="store_true",
        help="Skip read-only ADB discovery when the host environment forbids it.",
    )
    namespace = parser.parse_args(arguments)
    return ProbeOptions(
        user_data=namespace.user_data,
        pipeline=namespace.pipeline,
        skip_adb_discovery=namespace.skip_adb_discovery,
    )


def verify_api_surface() -> dict[str, bool]:
    required_members = {
        "Toolkit.find_adb_devices": Toolkit.find_adb_devices,
        "Controller.post_connection": Controller.post_connection,
        "Controller.post_screencap": Controller.post_screencap,
        "Controller.post_click": Controller.post_click,
        "Tasker.bind": Tasker.bind,
        "Tasker.post_recognition": Tasker.post_recognition,
        "Tasker.post_action": Tasker.post_action,
        "Tasker.post_stop": Tasker.post_stop,
        "Tasker.get_recognition_detail": Tasker.get_recognition_detail,
        "Tasker.get_action_detail": Tasker.get_action_detail,
        "Tasker.add_sink": Tasker.add_sink,
        "TaskJob.wait": TaskJob.wait,
        "TaskJob.get": TaskJob.get,
        "JobWithResult.get": JobWithResult.get,
        "Resource.post_ocr_model": Resource.post_ocr_model,
    }
    return {
        member_name: callable(member) and bool(inspect.signature(member))
        for member_name, member in required_members.items()
    }


def collect_distribution_inventory() -> dict[str, object]:
    framework_distribution = distribution("MaaFw")
    agent_distribution = distribution("MaaAgentBinary")
    framework_native_files = sorted(
        file.name
        for file in framework_distribution.files or []
        if file.suffix.lower() in {".dll", ".pyd", ".so", ".dylib"}
    )
    agent_native_files = [
        file
        for file in agent_distribution.files or []
        if file.suffix.lower() in {".so", ".dll", ".dylib"}
    ]
    return {
        "framework_package_version": framework_distribution.version,
        "agent_package_version": agent_distribution.version,
        "framework_native_files": framework_native_files,
        "agent_native_file_count": len(agent_native_files),
        "framework_license": framework_distribution.metadata.get("License-Expression")
        or framework_distribution.metadata.get("License")
        or "unspecified",
        "agent_license": agent_distribution.metadata.get("License-Expression")
        or agent_distribution.metadata.get("License")
        or "unspecified",
    }


def configure_runtime(user_data: Path) -> None:
    user_data.mkdir(parents=True, exist_ok=True)
    initialized = Toolkit.init_option(
        user_data.resolve(),
        {
            "logging": False,
            "save_draw": False,
            "save_on_error": False,
            "stdout_level": int(LoggingLevelEnum.Off),
        },
    )
    if not initialized:
        raise RuntimeError("MaaFramework toolkit initialization failed.")
    Tasker.set_debug_mode(False)
    Tasker.set_save_draw(False)
    Tasker.set_save_on_error(False)
    Tasker.set_stdout_level(LoggingLevelEnum.Off)


def require_value[ValueType](
    value: ValueType | None,
    description: str,
) -> ValueType:
    if value is None:
        raise RuntimeError(f"Missing {description}.")
    return value


def run_direct_operation_probe(pipeline_path: Path) -> dict[str, object]:
    main_thread_id = threading.get_ident()
    synthetic_frame = numpy.zeros((32, 48, 3), dtype=numpy.uint8)
    controller = SafeProbeController(synthetic_frame)
    controller_sink = RecordingControllerSink()
    controller_sink_id = controller.add_sink(controller_sink)
    raw_size_enabled = controller.set_screenshot_use_raw_size(True)
    connection_job = controller.post_connection().wait()
    capture_job = controller.post_screencap().wait()
    captured_frame = require_value(capture_job.get(), "captured frame")

    resource = Resource()
    resource_job = resource.post_pipeline(pipeline_path.resolve()).wait()
    tasker = Tasker()
    tasker_sink = RecordingTaskerSink()
    tasker_sink_id = tasker.add_sink(tasker_sink)
    bound = tasker.bind(resource, controller)

    recognition_job = tasker.post_recognition(
        "DirectHit",
        JDirectHit(roi=(4, 5, 12, 13)),
        synthetic_frame,
    ).wait()
    recognition_succeeded_before_stop = recognition_job.succeeded
    recognition_task = require_value(
        recognition_job.get(), "direct recognition task detail"
    )
    recognition_nodes = recognition_task.nodes
    if len(recognition_nodes) != 1:
        raise RuntimeError("Unexpected direct recognition node count.")
    recognition_detail = require_value(
        recognition_nodes[0].recognition,
        "direct recognition detail",
    )
    recognition_lookup = tasker.get_recognition_detail(recognition_detail.reco_id)

    action_job = tasker.post_action(
        "Click",
        JClick(target=(7, 8, 2, 2)),
        Rect(0, 0, 0, 0),
    ).wait()
    action_succeeded_before_stop = action_job.succeeded
    action_task = require_value(action_job.get(), "direct action task detail")
    action_nodes = action_task.nodes
    if len(action_nodes) != 1:
        raise RuntimeError("Unexpected direct action node count.")
    action_detail = require_value(action_nodes[0].action, "direct action detail")
    action_lookup = tasker.get_action_detail(action_detail.action_id)

    cancellation_job = tasker.post_task("CancellationProbe")
    running_deadline = time.monotonic() + 2
    while not tasker.running and time.monotonic() < running_deadline:
        time.sleep(0.01)
    active_task_observed = tasker.running
    cancellation_started_at = time.perf_counter()
    stop_job = tasker.post_stop().wait()
    cancellation_job.wait()
    cancellation_elapsed_seconds = time.perf_counter() - cancellation_started_at

    controller_callback_off_main = bool(controller.callback_thread_ids) and all(
        thread_id != main_thread_id for thread_id in controller.callback_thread_ids
    )
    controller_event_off_main = bool(controller_sink.thread_ids) and all(
        thread_id != main_thread_id for thread_id in controller_sink.thread_ids
    )
    tasker_event_off_main = bool(tasker_sink.thread_ids) and all(
        thread_id != main_thread_id for thread_id in tasker_sink.thread_ids
    )
    previous_status_retained = recognition_job.succeeded and action_job.succeeded

    if controller_sink_id is not None:
        controller.remove_sink(controller_sink_id)
    if tasker_sink_id is not None:
        tasker.remove_sink(tasker_sink_id)

    checks = {
        "controller_sink_registered": controller_sink_id is not None,
        "tasker_sink_registered": tasker_sink_id is not None,
        "raw_capture_size_enabled": raw_size_enabled,
        "connection_succeeded": connection_job.succeeded,
        "capture_succeeded": capture_job.succeeded,
        "capture_preserved_shape": tuple(captured_frame.shape)
        == tuple(synthetic_frame.shape),
        "resource_loaded": resource_job.succeeded and resource.loaded,
        "tasker_bound": bound and tasker.inited,
        "direct_recognition_succeeded": recognition_succeeded_before_stop,
        "direct_recognition_lookup_succeeded": recognition_lookup is not None,
        "direct_action_succeeded": action_succeeded_before_stop,
        "direct_action_lookup_succeeded": action_lookup is not None,
        "safe_controller_received_click": len(controller.clicks) == 1,
        "active_task_observed": active_task_observed,
        "stop_succeeded": stop_job.succeeded,
        "cancellation_job_completed": cancellation_job.done,
        "cancellation_bounded": cancellation_elapsed_seconds < 5,
        "controller_callback_off_main": controller_callback_off_main,
        "controller_event_off_main": controller_event_off_main,
        "tasker_event_off_main": tasker_event_off_main,
    }
    return {
        "checks": checks,
        "capture_shape": list(captured_frame.shape),
        "recorded_clicks": [list(click) for click in controller.clicks],
        "cancellation_elapsed_seconds": round(cancellation_elapsed_seconds, 3),
        "controller_event_count": controller_sink.message_count,
        "tasker_event_count": tasker_sink.message_count,
        "previous_terminal_status_retained_after_stop": previous_status_retained,
    }


def run_probe(arguments: ProbeOptions) -> dict[str, object]:
    configure_runtime(arguments.user_data)
    api_surface = verify_api_surface()
    inventory = collect_distribution_inventory()
    adb_device_count: int | None = None
    adb_discovery_completed = False
    if not arguments.skip_adb_discovery:
        adb_devices = Toolkit.find_adb_devices()
        adb_device_count = len(adb_devices)
        adb_discovery_completed = True

    runtime = run_direct_operation_probe(arguments.pipeline)
    runtime_checks = cast(dict[str, bool], runtime["checks"])

    package_versions = {
        "MaaFw": version("MaaFw"),
        "MaaAgentBinary": version("MaaAgentBinary"),
        "numpy": version("numpy"),
        "strenum": version("strenum"),
    }
    expected_native_files = {
        "MaaFramework.dll",
        "MaaToolkit.dll",
        "MaaCustomControlUnit.dll",
    }
    framework_native_files = set(cast(list[str], inventory["framework_native_files"]))
    top_level_checks = {
        "runtime_version_matches": Library.version() == EXPECTED_RUNTIME_VERSION,
        "package_version_matches": package_versions["MaaFw"]
        == EXPECTED_FRAMEWORK_VERSION,
        "api_surface_complete": all(api_surface.values()),
        "adb_discovery_completed": adb_discovery_completed
        or arguments.skip_adb_discovery,
        "expected_native_files_present": expected_native_files.issubset(
            framework_native_files
        ),
        "agent_native_files_present": cast(int, inventory["agent_native_file_count"])
        > 0,
        "ocr_parameter_type_available": inspect.isclass(JOCR),
        "unsafe_real_device_action_executed": False,
    }
    passed = (
        all(
            value
            for key, value in top_level_checks.items()
            if key != "unsafe_real_device_action_executed"
        )
        and not top_level_checks["unsafe_real_device_action_executed"]
        and all(bool(value) for value in runtime_checks.values())
    )
    return {
        "passed": passed,
        "framework_runtime_version": Library.version(),
        "python_version_supported": True,
        "package_versions": package_versions,
        "top_level_checks": top_level_checks,
        "api_surface": api_surface,
        "adb_device_count": adb_device_count,
        "adb_identifiers_redacted": True,
        "runtime": runtime,
        "distribution_inventory": inventory,
    }


def main(arguments: Sequence[str] | None = None) -> int:
    try:
        report = run_probe(parse_arguments(arguments))
    except (PackageNotFoundError, RuntimeError, OSError, ValueError) as error:
        report = {
            "passed": False,
            "error_type": type(error).__name__,
        }
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report.get("passed") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
