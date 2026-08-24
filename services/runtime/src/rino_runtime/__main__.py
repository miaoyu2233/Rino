"""Runtime sidecar entry point.

The process is started by the desktop shell with fixed arguments. It speaks the framed
protocol on standard input and output, writes diagnostics to standard error, and exits
when the desktop requests shutdown, closes the input pipe, or terminates the process.
"""

from __future__ import annotations

import argparse
import signal
import sys
import time
from collections.abc import Sequence
from pathlib import Path
from types import FrameType
from typing import Final, cast

from rino_runtime.artifacts import (
    PROJECT_ASSET_DIRECTORY_NAME,
    CaptureArtifactScope,
    PreviewArtifactScope,
    ProjectAssetScope,
)
from rino_runtime.backends.base import (
    AutomationRuntimeEventSource,
    DeviceControlService,
    DeviceManagementService,
    DevicePreviewService,
    DeviceServiceError,
)
from rino_runtime.backends.maa import (
    MaaDeviceService,
    MaaDeviceServiceHost,
    MaaRuntimeConfiguration,
    OfficialMaaBinding,
)
from rino_runtime.diagnostics import DiagnosticLog, DiagnosticSeverity
from rino_runtime.ipc.stdio_boundary import reserve_protocol_stdout
from rino_runtime.ipc.transport import (
    EXIT_SUCCESS,
    ByteReader,
    ByteWriter,
    StdioTransport,
)
from rino_runtime.nodes import (
    NodeRegistry,
    build_maa_backend_registry,
    build_mvp_production_registry,
)
from rino_runtime.service import RuntimeMode, RuntimeService

EXIT_SIGNALLED: Final[int] = 3


def _resolve_runtime_mode() -> RuntimeMode:
    return RuntimeMode.FROZEN if getattr(sys, "frozen", False) else RuntimeMode.SOURCE


def _monotonic_milliseconds() -> int:
    return time.monotonic_ns() // 1_000_000


def _install_signal_handlers(diagnostics: DiagnosticLog) -> None:
    """Turns termination signals into an orderly exit.

    Standard output may be mid-frame when a signal arrives, so the process exits instead
    of trying to emit a final message the desktop could not correlate.
    """

    def handle(signal_number: int, _frame: FrameType | None) -> None:
        diagnostics.record(
            DiagnosticSeverity.INFO,
            "RUNTIME_SIGNAL_RECEIVED",
            detail=signal.Signals(signal_number).name,
        )
        raise SystemExit(EXIT_SIGNALLED)

    for signal_name in ("SIGTERM", "SIGINT", "SIGBREAK"):
        signal_number = getattr(signal, signal_name, None)
        if signal_number is not None:
            signal.signal(signal_number, handle)


def _parse_arguments(arguments: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="rino-runtime",
        description="Rino authoritative graph runtime sidecar.",
    )
    parser.add_argument(
        "--log-directory",
        type=Path,
        default=None,
        help="Application-owned directory for rotating local diagnostics.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Emit debug-severity local diagnostics.",
    )
    parser.add_argument(
        "--maa-user-data-directory",
        type=Path,
        default=None,
        help="Application-owned private MaaFramework state directory.",
    )
    parser.add_argument(
        "--adb-executable",
        type=Path,
        default=None,
        help="Explicit application-owned ADB executable.",
    )
    parser.add_argument(
        "--maa-agent-directory",
        type=Path,
        default=None,
        help="Optional explicit directory for the pinned Maa agent binaries.",
    )
    parser.add_argument(
        "--maa-ocr-model-directory",
        type=Path,
        default=None,
        help="Optional application-owned directory for the pinned OCR model.",
    )
    parser.add_argument(
        "--preview-cache-directory",
        type=Path,
        default=None,
        help="Application-owned private directory for short-lived previews.",
    )
    options = parser.parse_args(arguments)
    if (options.maa_user_data_directory is None) != (options.adb_executable is None):
        parser.error(
            "--maa-user-data-directory and --adb-executable must be provided together"
        )
    if options.maa_agent_directory is not None and options.adb_executable is None:
        parser.error("--maa-agent-directory requires --adb-executable")
    if options.maa_ocr_model_directory is not None and options.adb_executable is None:
        parser.error("--maa-ocr-model-directory requires --adb-executable")
    if options.adb_executable is not None and options.preview_cache_directory is None:
        parser.error("--preview-cache-directory is required with --adb-executable")
    return options


def run(
    source: ByteReader,
    target: ByteWriter,
    diagnostics: DiagnosticLog,
    device_service: DeviceManagementService | None = None,
    registry: NodeRegistry | None = None,
    preview_service: DevicePreviewService | None = None,
    device_control_service: DeviceControlService | None = None,
    operation_event_source: AutomationRuntimeEventSource | None = None,
) -> int:
    service = RuntimeService(
        runtime_mode=_resolve_runtime_mode(),
        monotonic_milliseconds=_monotonic_milliseconds,
        device_service=device_service,
        device_control_service=device_control_service,
        registry=registry,
        preview_service=preview_service,
        operation_event_source=operation_event_source,
    )
    transport = StdioTransport(service, diagnostics)
    return transport.serve(source, target)


def main(arguments: Sequence[str] | None = None) -> int:
    options = _parse_arguments(arguments)
    try:
        protocol_target = reserve_protocol_stdout()
    except OSError:
        return EXIT_SIGNALLED
    log_directory: Path | None = options.log_directory
    diagnostics = DiagnosticLog(
        log_directory=log_directory,
        minimum_severity=(
            DiagnosticSeverity.DEBUG if options.verbose else DiagnosticSeverity.INFO
        ),
    )
    _install_signal_handlers(diagnostics)

    device_service: DeviceManagementService | None = None
    registry: NodeRegistry | None = build_mvp_production_registry()
    preview_service: DevicePreviewService | None = None
    device_control_service: DeviceControlService | None = None
    operation_event_source: AutomationRuntimeEventSource | None = None
    if options.adb_executable is not None:
        try:
            maa_host = MaaDeviceServiceHost(
                MaaDeviceService(
                    OfficialMaaBinding(
                        MaaRuntimeConfiguration(
                            user_data_directory=(
                                options.maa_user_data_directory.resolve()
                            ),
                            adb_executable_path=options.adb_executable.resolve(),
                            agent_binary_directory=(
                                options.maa_agent_directory.resolve()
                                if options.maa_agent_directory is not None
                                else None
                            ),
                            ocr_model_directory=(
                                options.maa_ocr_model_directory.resolve()
                                if options.maa_ocr_model_directory is not None
                                else None
                            ),
                        )
                    ),
                    preview_artifacts=PreviewArtifactScope(
                        options.preview_cache_directory.resolve()
                    ),
                    capture_artifacts=CaptureArtifactScope(
                        options.preview_cache_directory.resolve() / "captures"
                    ),
                    project_assets=ProjectAssetScope(
                        options.preview_cache_directory.resolve()
                        / PROJECT_ASSET_DIRECTORY_NAME
                    ),
                )
            )
            device_service = maa_host
            registry = build_maa_backend_registry(
                maa_host,
                include_ocr=maa_host.ocr_available,
            )
            preview_service = maa_host
            device_control_service = maa_host
            operation_event_source = maa_host
        except DeviceServiceError as error:
            diagnostics.record(
                DiagnosticSeverity.WARNING,
                "MAA_DEVICE_SERVICE_UNAVAILABLE",
                detail=error.code.value,
            )

    # The standard streams are buffered binary streams, which satisfy the partial-read
    # and write contracts the transport needs; the BinaryIO alias does not declare them.
    source = cast("ByteReader", sys.stdin.buffer)
    target = cast("ByteWriter", protocol_target)

    try:
        return run(
            source,
            target,
            diagnostics,
            device_service=device_service,
            registry=registry,
            preview_service=preview_service,
            device_control_service=device_control_service,
            operation_event_source=operation_event_source,
        )
    except SystemExit as exit_request:
        return exit_request.code if isinstance(exit_request.code, int) else EXIT_SUCCESS
    except OSError as error:
        diagnostics.record(
            DiagnosticSeverity.ERROR,
            "RUNTIME_STREAM_FAILURE",
            detail=type(error).__name__,
        )
        return EXIT_SIGNALLED
    finally:
        diagnostics.close()
        protocol_target.close()


if __name__ == "__main__":
    raise SystemExit(main())
