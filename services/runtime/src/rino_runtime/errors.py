"""Structured runtime errors.

Every error carries a stable code, a localization key with safe parameters for the user
interface, and an English technical detail for local diagnostics only. Technical details
never contain payload content, file paths, or peer-supplied text.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Final

from rino_runtime.contracts.generated.rino_ipc_v1 import (
    ErrorCauseEntryV1,
    ProtocolErrorV1,
    Retryability,
)

MAXIMUM_TECHNICAL_DETAIL_LENGTH: Final[int] = 4096


class RuntimeErrorCode(StrEnum):
    AUTOMATION_BACKEND_UNAVAILABLE = "AUTOMATION_BACKEND_UNAVAILABLE"
    DEVICE_CONNECTION_FAILED = "DEVICE_CONNECTION_FAILED"
    DEVICE_CONNECTION_LOST = "DEVICE_CONNECTION_LOST"
    DEVICE_DEACTIVATION_FAILED = "DEVICE_DEACTIVATION_FAILED"
    DEVICE_DISCOVERY_FAILED = "DEVICE_DISCOVERY_FAILED"
    DEVICE_NOT_CONNECTED = "DEVICE_NOT_CONNECTED"
    DEVICE_NOT_FOUND = "DEVICE_NOT_FOUND"
    DEVICE_OPERATION_TIMEOUT = "DEVICE_OPERATION_TIMEOUT"
    DEVICE_SERVICE_CLOSED = "DEVICE_SERVICE_CLOSED"
    SCREEN_CAPTURE_FAILED = "SCREEN_CAPTURE_FAILED"
    SCREEN_CAPTURE_INVALID = "SCREEN_CAPTURE_INVALID"
    SCREEN_CAPTURE_TOO_LARGE = "SCREEN_CAPTURE_TOO_LARGE"
    DEVICE_PREVIEW_UNAVAILABLE = "DEVICE_PREVIEW_UNAVAILABLE"
    DEVICE_PREVIEW_ENCODE_FAILED = "DEVICE_PREVIEW_ENCODE_FAILED"
    DEVICE_PREVIEW_TOO_LARGE = "DEVICE_PREVIEW_TOO_LARGE"
    DEVICE_PREVIEW_STORAGE_FAILED = "DEVICE_PREVIEW_STORAGE_FAILED"
    CAPTURE_ARTIFACT_UNAVAILABLE = "CAPTURE_ARTIFACT_UNAVAILABLE"
    CAPTURE_ARTIFACT_INVALID = "CAPTURE_ARTIFACT_INVALID"
    CAPTURE_ARTIFACT_ENCODE_FAILED = "CAPTURE_ARTIFACT_ENCODE_FAILED"
    CAPTURE_ARTIFACT_TOO_LARGE = "CAPTURE_ARTIFACT_TOO_LARGE"
    CAPTURE_ARTIFACT_STORAGE_FAILED = "CAPTURE_ARTIFACT_STORAGE_FAILED"
    GRAPH_DOCUMENT_INVALID = "GRAPH_DOCUMENT_INVALID"
    GRAPH_NOT_EXECUTABLE = "GRAPH_NOT_EXECUTABLE"
    GRAPH_NOT_FOUND = "GRAPH_NOT_FOUND"
    HANDSHAKE_REQUIRED = "HANDSHAKE_REQUIRED"
    HANDSHAKE_ALREADY_COMPLETED = "HANDSHAKE_ALREADY_COMPLETED"
    INVALID_MESSAGE = "INVALID_MESSAGE"
    INVALID_PAYLOAD = "INVALID_PAYLOAD"
    PROTOCOL_INCOMPATIBLE = "PROTOCOL_INCOMPATIBLE"
    RUN_ALREADY_ACTIVE = "RUN_ALREADY_ACTIVE"
    RUN_NOT_FOUND = "RUN_NOT_FOUND"
    RUNTIME_CLOSING = "RUNTIME_CLOSING"
    TRANSPORT_FAILURE = "TRANSPORT_FAILURE"
    UNKNOWN_MESSAGE_TYPE = "UNKNOWN_MESSAGE_TYPE"
    UNSUPPORTED_MESSAGE_KIND = "UNSUPPORTED_MESSAGE_KIND"
    INTERNAL_ERROR = "INTERNAL_ERROR"


_MESSAGE_KEYS: Final[dict[RuntimeErrorCode, str]] = {
    RuntimeErrorCode.AUTOMATION_BACKEND_UNAVAILABLE: (
        "runtime.error.automationBackendUnavailable"
    ),
    RuntimeErrorCode.DEVICE_CONNECTION_FAILED: "runtime.error.deviceConnectionFailed",
    RuntimeErrorCode.DEVICE_CONNECTION_LOST: "runtime.error.deviceConnectionLost",
    RuntimeErrorCode.DEVICE_DEACTIVATION_FAILED: (
        "runtime.error.deviceDeactivationFailed"
    ),
    RuntimeErrorCode.DEVICE_DISCOVERY_FAILED: "runtime.error.deviceDiscoveryFailed",
    RuntimeErrorCode.DEVICE_NOT_CONNECTED: "runtime.error.deviceNotConnected",
    RuntimeErrorCode.DEVICE_NOT_FOUND: "runtime.error.deviceNotFound",
    RuntimeErrorCode.DEVICE_OPERATION_TIMEOUT: "runtime.error.deviceOperationTimeout",
    RuntimeErrorCode.DEVICE_SERVICE_CLOSED: "runtime.error.deviceServiceClosed",
    RuntimeErrorCode.SCREEN_CAPTURE_FAILED: "runtime.error.screenCaptureFailed",
    RuntimeErrorCode.SCREEN_CAPTURE_INVALID: "runtime.error.screenCaptureInvalid",
    RuntimeErrorCode.SCREEN_CAPTURE_TOO_LARGE: "runtime.error.screenCaptureTooLarge",
    RuntimeErrorCode.DEVICE_PREVIEW_UNAVAILABLE: (
        "runtime.error.devicePreviewUnavailable"
    ),
    RuntimeErrorCode.DEVICE_PREVIEW_ENCODE_FAILED: (
        "runtime.error.devicePreviewEncodeFailed"
    ),
    RuntimeErrorCode.DEVICE_PREVIEW_TOO_LARGE: "runtime.error.devicePreviewTooLarge",
    RuntimeErrorCode.DEVICE_PREVIEW_STORAGE_FAILED: (
        "runtime.error.devicePreviewStorageFailed"
    ),
    RuntimeErrorCode.CAPTURE_ARTIFACT_UNAVAILABLE: (
        "runtime.error.captureArtifactUnavailable"
    ),
    RuntimeErrorCode.CAPTURE_ARTIFACT_INVALID: "runtime.error.captureArtifactInvalid",
    RuntimeErrorCode.CAPTURE_ARTIFACT_ENCODE_FAILED: (
        "runtime.error.captureArtifactEncodeFailed"
    ),
    RuntimeErrorCode.CAPTURE_ARTIFACT_TOO_LARGE: (
        "runtime.error.captureArtifactTooLarge"
    ),
    RuntimeErrorCode.CAPTURE_ARTIFACT_STORAGE_FAILED: (
        "runtime.error.captureArtifactStorageFailed"
    ),
    RuntimeErrorCode.GRAPH_DOCUMENT_INVALID: "runtime.error.graphDocumentInvalid",
    RuntimeErrorCode.GRAPH_NOT_EXECUTABLE: "runtime.error.graphNotExecutable",
    RuntimeErrorCode.GRAPH_NOT_FOUND: "runtime.error.graphNotFound",
    RuntimeErrorCode.HANDSHAKE_REQUIRED: "runtime.error.handshakeRequired",
    RuntimeErrorCode.HANDSHAKE_ALREADY_COMPLETED: (
        "runtime.error.handshakeAlreadyCompleted"
    ),
    RuntimeErrorCode.INVALID_MESSAGE: "runtime.error.invalidMessage",
    RuntimeErrorCode.INVALID_PAYLOAD: "runtime.error.invalidPayload",
    RuntimeErrorCode.PROTOCOL_INCOMPATIBLE: "runtime.error.protocolIncompatible",
    RuntimeErrorCode.RUN_ALREADY_ACTIVE: "runtime.error.runAlreadyActive",
    RuntimeErrorCode.RUN_NOT_FOUND: "runtime.error.runNotFound",
    RuntimeErrorCode.RUNTIME_CLOSING: "runtime.error.runtimeClosing",
    RuntimeErrorCode.TRANSPORT_FAILURE: "runtime.error.transportFailure",
    RuntimeErrorCode.UNKNOWN_MESSAGE_TYPE: "runtime.error.unknownMessageType",
    RuntimeErrorCode.UNSUPPORTED_MESSAGE_KIND: "runtime.error.unsupportedMessageKind",
    RuntimeErrorCode.INTERNAL_ERROR: "runtime.error.internalError",
}

_RETRYABILITY: Final[dict[RuntimeErrorCode, Retryability]] = {
    RuntimeErrorCode.AUTOMATION_BACKEND_UNAVAILABLE: Retryability.never,
    RuntimeErrorCode.DEVICE_CONNECTION_FAILED: Retryability.safe,
    RuntimeErrorCode.DEVICE_CONNECTION_LOST: Retryability.safe,
    RuntimeErrorCode.DEVICE_DEACTIVATION_FAILED: Retryability.safe,
    RuntimeErrorCode.DEVICE_DISCOVERY_FAILED: Retryability.safe,
    RuntimeErrorCode.DEVICE_NOT_CONNECTED: Retryability.safe,
    RuntimeErrorCode.DEVICE_NOT_FOUND: Retryability.safe,
    RuntimeErrorCode.DEVICE_OPERATION_TIMEOUT: Retryability.safe,
    RuntimeErrorCode.DEVICE_SERVICE_CLOSED: Retryability.never,
    RuntimeErrorCode.SCREEN_CAPTURE_FAILED: Retryability.safe,
    RuntimeErrorCode.SCREEN_CAPTURE_INVALID: Retryability.safe,
    RuntimeErrorCode.SCREEN_CAPTURE_TOO_LARGE: Retryability.never,
    RuntimeErrorCode.DEVICE_PREVIEW_UNAVAILABLE: Retryability.never,
    RuntimeErrorCode.DEVICE_PREVIEW_ENCODE_FAILED: Retryability.safe,
    RuntimeErrorCode.DEVICE_PREVIEW_TOO_LARGE: Retryability.never,
    RuntimeErrorCode.DEVICE_PREVIEW_STORAGE_FAILED: Retryability.safe,
    RuntimeErrorCode.CAPTURE_ARTIFACT_UNAVAILABLE: Retryability.never,
    RuntimeErrorCode.CAPTURE_ARTIFACT_INVALID: Retryability.never,
    RuntimeErrorCode.CAPTURE_ARTIFACT_ENCODE_FAILED: Retryability.safe,
    RuntimeErrorCode.CAPTURE_ARTIFACT_TOO_LARGE: Retryability.never,
    RuntimeErrorCode.CAPTURE_ARTIFACT_STORAGE_FAILED: Retryability.safe,
    RuntimeErrorCode.GRAPH_DOCUMENT_INVALID: Retryability.never,
    RuntimeErrorCode.GRAPH_NOT_EXECUTABLE: Retryability.never,
    RuntimeErrorCode.GRAPH_NOT_FOUND: Retryability.never,
    RuntimeErrorCode.HANDSHAKE_REQUIRED: Retryability.never,
    RuntimeErrorCode.HANDSHAKE_ALREADY_COMPLETED: Retryability.never,
    RuntimeErrorCode.INVALID_MESSAGE: Retryability.never,
    RuntimeErrorCode.INVALID_PAYLOAD: Retryability.never,
    RuntimeErrorCode.PROTOCOL_INCOMPATIBLE: Retryability.never,
    RuntimeErrorCode.RUN_ALREADY_ACTIVE: Retryability.safe,
    RuntimeErrorCode.RUN_NOT_FOUND: Retryability.never,
    RuntimeErrorCode.RUNTIME_CLOSING: Retryability.safe,
    RuntimeErrorCode.TRANSPORT_FAILURE: Retryability.never,
    RuntimeErrorCode.UNKNOWN_MESSAGE_TYPE: Retryability.never,
    RuntimeErrorCode.UNSUPPORTED_MESSAGE_KIND: Retryability.never,
    RuntimeErrorCode.INTERNAL_ERROR: Retryability.safe,
}


def build_protocol_error(
    code: RuntimeErrorCode,
    technical_detail: str,
    *,
    parameters: dict[str, object] | None = None,
    request_id: str | None = None,
    causes: tuple[tuple[str, str], ...] = (),
) -> ProtocolErrorV1:
    """Builds one structured error for a response or a protocol-error event."""
    cause_entries = [
        ErrorCauseEntryV1.model_validate(
            {
                "code": cause_code,
                "technicalDetail": cause_detail[:1024],
            }
        )
        for cause_code, cause_detail in causes[:8]
    ]
    return ProtocolErrorV1.model_validate(
        {
            "code": code.value,
            "messageKey": _MESSAGE_KEYS[code],
            "parameters": parameters or {},
            "technicalDetail": technical_detail[:MAXIMUM_TECHNICAL_DETAIL_LENGTH],
            "retryability": _RETRYABILITY[code].value,
            **({"requestId": request_id} if request_id is not None else {}),
            **({"causes": cause_entries} if cause_entries else {}),
        }
    )
