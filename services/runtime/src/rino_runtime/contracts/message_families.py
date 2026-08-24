"""Version-one system message families and their canonical payload definitions.

The definition names refer to entries under ``$defs`` in the canonical IPC schema. Both
the TypeScript and Python boundaries bind the same names so payload validation stays
identical across languages.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

PROTOCOL_VERSION: Final[int] = 1
DEFAULT_MAXIMUM_FRAME_BYTES: Final[int] = 1_048_576


@dataclass(frozen=True)
class RequestFamily:
    request_payload: str
    result: str


SYSTEM_REQUEST_FAMILIES: Final[dict[str, RequestFamily]] = {
    "system.handshake": RequestFamily(
        request_payload="HandshakeRequestPayloadV1",
        result="HandshakeResultV1",
    ),
    "system.health": RequestFamily(
        request_payload="EmptyPayloadV1",
        result="HealthResultV1",
    ),
    "system.shutdown": RequestFamily(
        request_payload="EmptyPayloadV1",
        result="ShutdownResultV1",
    ),
}

RUNTIME_REQUEST_FAMILIES: Final[dict[str, RequestFamily]] = {
    "capture.prepare": RequestFamily(
        request_payload="CapturePrepareRequestPayloadV1",
        result="CapturePrepareResultV1",
    ),
    "capture.release": RequestFamily(
        request_payload="CaptureReleaseRequestPayloadV1",
        result="CaptureReleaseResultV1",
    ),
    "device.list": RequestFamily(
        request_payload="EmptyPayloadV1",
        result="DeviceListResultV1",
    ),
    "device.connect": RequestFamily(
        request_payload="DeviceConnectRequestPayloadV1",
        result="DeviceConnectResultV1",
    ),
    "device.disconnect": RequestFamily(
        request_payload="DeviceDisconnectRequestPayloadV1",
        result="DeviceDisconnectResultV1",
    ),
    "device.interact": RequestFamily(
        request_payload="DeviceInteractRequestPayloadV1",
        result="DeviceInteractResultV1",
    ),
    "preview.capture": RequestFamily(
        request_payload="PreviewCaptureRequestPayloadV1",
        result="PreviewCaptureResultV1",
    ),
    "preview.release": RequestFamily(
        request_payload="PreviewReleaseRequestPayloadV1",
        result="PreviewReleaseResultV1",
    ),
    "registry.get": RequestFamily(
        request_payload="EmptyPayloadV1",
        result="RegistryGetResultV1",
    ),
    "graph.validate": RequestFamily(
        request_payload="GraphValidateRequestPayloadV1",
        result="GraphValidateResultV1",
    ),
    "run.start": RequestFamily(
        request_payload="RunStartRequestPayloadV1",
        result="RunStartResultV1",
    ),
    "run.cancel": RequestFamily(
        request_payload="RunCancelRequestPayloadV1",
        result="RunCancelResultV1",
    ),
}

REQUEST_FAMILIES: Final[dict[str, RequestFamily]] = {
    **SYSTEM_REQUEST_FAMILIES,
    **RUNTIME_REQUEST_FAMILIES,
}

SYSTEM_EVENT_FAMILIES: Final[dict[str, str]] = {
    "system.ready": "SystemReadyEventPayloadV1",
    "system.healthChanged": "SystemHealthChangedEventPayloadV1",
    "system.protocolError": "SystemProtocolErrorEventPayloadV1",
}

RUNTIME_EVENT_FAMILIES: Final[dict[str, str]] = {
    "automation.operationStateChanged": (
        "AutomationOperationStateChangedEventPayloadV1"
    ),
    "automation.callbackDiagnostic": ("AutomationCallbackDiagnosticEventPayloadV1"),
    "device.stateChanged": "DeviceStateChangedEventPayloadV1",
    "run.stateChanged": "RunStateChangedEventPayloadV1",
    "node.stateChanged": "NodeStateChangedEventPayloadV1",
    "edge.traversed": "EdgeTraversedEventPayloadV1",
    "runtime.logCreated": "RuntimeLogCreatedEventPayloadV1",
}

EVENT_FAMILIES: Final[dict[str, str]] = {
    **SYSTEM_EVENT_FAMILIES,
    **RUNTIME_EVENT_FAMILIES,
}
