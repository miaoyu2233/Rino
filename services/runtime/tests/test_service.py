from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any, Final, cast
from uuid import UUID, uuid4

import pytest

from rino_runtime.artifacts import (
    CaptureArtifactDescriptor,
    CaptureRegion,
    CaptureSourceKind,
    PreviewArtifactDescriptor,
)
from rino_runtime.backends.base import (
    AutomationDeviceDescriptor,
    AutomationDeviceState,
    AutomationOperationCorrelation,
    AutomationRuntimeInfo,
    DeviceControlKey,
    DeviceServiceError,
    DeviceServiceErrorCode,
)
from rino_runtime.backends.fake import FakeAutomationBackend, FakeAutomationScenario
from rino_runtime.contracts import (
    EVENT_FAMILIES,
    REQUEST_FAMILIES,
    is_valid_message,
    is_valid_payload,
)
from rino_runtime.errors import RuntimeErrorCode
from rino_runtime.nodes import (
    NodeRegistry,
    RuntimeImageReference,
    RuntimePoint,
    build_capture_backend_registry,
)
from rino_runtime.service import RuntimeMode, RuntimeService, encode_outgoing

DESKTOP_REQUEST_ID = "5f0c2e9a-1c2b-4f6e-9d3a-8b7c6d5e4f30"
RUNTIME_GRAPH_ID: Final[str] = "71000000-0000-4000-8000-000000000001"
RUNTIME_START_ID: Final[str] = "71000000-0000-4000-8000-000000000002"
RUNTIME_ACTION_ID: Final[str] = "71000000-0000-4000-8000-000000000003"
RUNTIME_STOP_ID: Final[str] = "71000000-0000-4000-8000-000000000006"
RUNTIME_PERSISTENT_NUMBER_ID: Final[str] = "71000000-0000-4000-8000-000000000007"


class StubClock:
    def __init__(self) -> None:
        self.milliseconds = 0

    def __call__(self) -> int:
        return self.milliseconds


class StubDeviceService:
    def __init__(self) -> None:
        self._device = AutomationDeviceDescriptor(
            device_key="device-opaque-1",
            display_name="Android device 1",
            controller_family="adb",
            state=AutomationDeviceState.AVAILABLE,
        )
        self.runtime_info = AutomationRuntimeInfo(
            backend_key="maa",
            binding_version="5.10.5",
            native_version="5.10.5",
        )
        self.closed = 0
        self.failure: DeviceServiceError | None = None

    def list_devices(self) -> tuple[AutomationDeviceDescriptor, ...]:
        self._raise_failure()
        return (self._device,)

    def connect(
        self,
        device_key: str,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> AutomationDeviceDescriptor:
        self._raise_failure()
        assert device_key == self._device.device_key
        assert correlation is not None
        assert correlation.request_id == UUID(DESKTOP_REQUEST_ID)
        self._device = AutomationDeviceDescriptor(
            device_key=self._device.device_key,
            display_name=self._device.display_name,
            controller_family=self._device.controller_family,
            state=AutomationDeviceState.CONNECTED,
        )
        return self._device

    def disconnect(
        self,
        device_key: str,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> AutomationDeviceDescriptor:
        self._raise_failure()
        assert device_key == self._device.device_key
        assert correlation is not None
        assert correlation.request_id == UUID(DESKTOP_REQUEST_ID)
        self._device = AutomationDeviceDescriptor(
            device_key=self._device.device_key,
            display_name=self._device.display_name,
            controller_family=self._device.controller_family,
            state=AutomationDeviceState.AVAILABLE,
        )
        return self._device

    def close(self) -> tuple[DeviceServiceErrorCode, ...]:
        self.closed += 1
        return ()

    def _raise_failure(self) -> None:
        if self.failure is not None:
            raise self.failure


class StubPreviewService:
    def __init__(self) -> None:
        self.released_tokens: list[str] = []
        self.released_capture_tokens: list[str] = []
        self.prepared_project_assets: list[tuple[str, str, int, int, int, str]] = []

    def capture_preview(
        self,
        device_key: str,
        maximum_width: int,
        maximum_height: int,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> PreviewArtifactDescriptor:
        assert device_key == "device-opaque-1"
        assert maximum_width == 960
        assert maximum_height == 540
        assert correlation is not None
        assert correlation.request_id == UUID(DESKTOP_REQUEST_ID)
        return PreviewArtifactDescriptor(
            preview_token="0123456789abcdef0123456789abcdef",
            media_type="image/png",
            width=960,
            height=540,
            source_width=1920,
            source_height=1080,
            source_coordinate_space_id="coordinate-space-opaque",
            source_generation=7,
            byte_length=582341,
            expires_in_milliseconds=30000,
        )

    def release_preview(self, preview_token: str) -> bool:
        self.released_tokens.append(preview_token)
        return preview_token == "0123456789abcdef0123456789abcdef"

    def prepare_capture(
        self,
        preview_token: str,
        region: CaptureRegion | None,
    ) -> CaptureArtifactDescriptor:
        assert preview_token == "0123456789abcdef0123456789abcdef"
        assert region == CaptureRegion(
            100,
            200,
            300,
            400,
            "coordinate-space-opaque",
            7,
        )
        return CaptureArtifactDescriptor(
            capture_token="abcdef0123456789abcdef0123456789",
            media_type="image/png",
            width=300,
            height=400,
            coordinate_space_id="capture-space-opaque",
            source_kind=CaptureSourceKind.REGION_CAPTURE,
            byte_length=785432,
            expires_in_milliseconds=60000,
        )

    def release_capture(self, capture_token: str) -> bool:
        self.released_capture_tokens.append(capture_token)
        return capture_token == "abcdef0123456789abcdef0123456789"

    def prepare_project_asset(
        self,
        asset_token: str,
        content_hash: str,
        byte_length: int,
        width: int,
        height: int,
        coordinate_space_id: str,
    ) -> RuntimeImageReference:
        self.prepared_project_assets.append(
            (
                asset_token,
                content_hash,
                byte_length,
                width,
                height,
                coordinate_space_id,
            )
        )
        return RuntimeImageReference(
            handle_id="project-image-1",
            width=width,
            height=height,
            coordinate_space_id=coordinate_space_id,
            generation=1,
            expires_at_monotonic=float("inf"),
        )


class StubDeviceControlService:
    def __init__(self) -> None:
        self.actions: list[tuple[object, ...]] = []

    def control_click(
        self,
        device_key: str,
        point: RuntimePoint,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        self.actions.append(("click", device_key, point, correlation))

    def control_long_press(
        self,
        device_key: str,
        point: RuntimePoint,
        duration_milliseconds: int,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        self.actions.append(
            ("longPress", device_key, point, duration_milliseconds, correlation)
        )

    def control_swipe(
        self,
        device_key: str,
        start: RuntimePoint,
        end: RuntimePoint,
        duration_milliseconds: int,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        self.actions.append(
            ("swipe", device_key, start, end, duration_milliseconds, correlation)
        )

    def control_key(
        self,
        device_key: str,
        key: DeviceControlKey,
        correlation: AutomationOperationCorrelation | None = None,
    ) -> None:
        self.actions.append(("key", device_key, key, correlation))


def build_service(
    clock: StubClock | None = None,
    *,
    device_service: StubDeviceService | None = None,
    registry: NodeRegistry | None = None,
    preview_service: StubPreviewService | None = None,
    device_control_service: StubDeviceControlService | None = None,
) -> RuntimeService:
    event_ids = iter(UUID(int=index) for index in range(1, 1000))
    return RuntimeService(
        runtime_mode=RuntimeMode.SOURCE,
        monotonic_milliseconds=clock or StubClock(),
        event_id_factory=lambda: next(event_ids),
        device_service=device_service,
        device_control_service=device_control_service,
        registry=registry,
        preview_service=preview_service,
    )


def request_body(
    message_type: str,
    payload: dict[str, Any],
    request_id: str = DESKTOP_REQUEST_ID,
) -> str:
    return json.dumps(
        {
            "protocolVersion": 1,
            "messageKind": "request",
            "messageType": message_type,
            "requestId": request_id,
            "payload": payload,
        },
        separators=(",", ":"),
    )


def handshake_payload(
    minimum: int = 1, maximum: int = 1, frame_bytes: int = 1_048_576
) -> dict[str, Any]:
    return {
        "desktopVersion": "0.1.0",
        "protocolVersionRange": {"minimum": minimum, "maximum": maximum},
        "maximumFrameBytes": frame_bytes,
    }


def runtime_document(
    action_type: str = "core.diagnostic.log",
    *,
    action_inputs: dict[str, object] | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "documentId": "71000000-0000-4000-8000-000000000004",
        "metadata": {
            "name": "Runtime service test",
            "createdAt": "2026-07-27T00:00:00Z",
            "updatedAt": "2026-07-27T00:00:00Z",
        },
        "entryGraphId": RUNTIME_GRAPH_ID,
        "graphs": [
            {
                "graphId": RUNTIME_GRAPH_ID,
                "name": "Main",
                "kind": "entry",
                "nodes": [
                    {
                        "nodeId": RUNTIME_START_ID,
                        "typeKey": "core.flow.start",
                        "typeVersion": 1,
                        "position": {"x": 0, "y": 0},
                        "properties": {},
                        "inputValues": {},
                    },
                    {
                        "nodeId": RUNTIME_ACTION_ID,
                        "typeKey": action_type,
                        "typeVersion": 1,
                        "position": {"x": 240, "y": 0},
                        "properties": {},
                        "inputValues": action_inputs
                        if action_inputs is not None
                        else {"message": "service message"},
                    },
                ],
                "edges": [
                    {
                        "edgeId": "71000000-0000-4000-8000-000000000005",
                        "edgeKind": "execution",
                        "sourceNodeId": RUNTIME_START_ID,
                        "sourcePortId": "next",
                        "targetNodeId": RUNTIME_ACTION_ID,
                        "targetPortId": "run",
                    }
                ],
            }
        ],
        "assets": [],
        "requiredCapabilities": [],
    }


def persistent_runtime_document() -> dict[str, Any]:
    document = runtime_document()
    graph = document["graphs"][0]
    graph["variables"] = [
        {
            "variableId": RUNTIME_PERSISTENT_NUMBER_ID,
            "name": "service-number",
            "valueKind": "number",
            "persistent": True,
        }
    ]
    graph["nodes"][1] = {
        "nodeId": RUNTIME_ACTION_ID,
        "typeKey": "core.variable.setNumber",
        "typeVersion": 1,
        "position": {"x": 240, "y": 0},
        "properties": {"variableId": RUNTIME_PERSISTENT_NUMBER_ID},
        "inputValues": {"value": 8.75},
    }
    graph["nodes"].append(
        {
            "nodeId": RUNTIME_STOP_ID,
            "typeKey": "core.flow.stop",
            "typeVersion": 1,
            "position": {"x": 480, "y": 0},
            "properties": {},
            "inputValues": {},
        }
    )
    graph["edges"] = [
        {
            "edgeId": "71000000-0000-4000-8000-000000000005",
            "edgeKind": "execution",
            "sourceNodeId": RUNTIME_START_ID,
            "sourcePortId": "next",
            "targetNodeId": RUNTIME_ACTION_ID,
            "targetPortId": "run",
        },
        {
            "edgeId": "71000000-0000-4000-8000-000000000008",
            "edgeKind": "execution",
            "sourceNodeId": RUNTIME_ACTION_ID,
            "sourcePortId": "next",
            "targetNodeId": RUNTIME_STOP_ID,
            "targetPortId": "run",
        },
    ]
    return document


def wait_for_async_messages(
    service: RuntimeService,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    timeout: float = 1.0,
) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout
    messages: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        messages.extend(decode(message) for message in service.drain_async_messages())
        if any(predicate(message) for message in messages):
            return messages
        time.sleep(0.005)
    raise AssertionError("Timed out waiting for an asynchronous runtime message.")


def decode(message: object) -> dict[str, Any]:
    encoded = encode_outgoing(cast("Any", message))
    decoded: Any = json.loads(encoded)
    assert is_valid_message(decoded)
    return cast("dict[str, Any]", decoded)


def test_handshake_returns_a_result_and_a_ready_event() -> None:
    service = build_service()

    outgoing = service.handle_frame_body(
        request_body("system.handshake", handshake_payload())
    )

    assert not outgoing.stop_requested
    response, event = (decode(message) for message in outgoing.messages)
    assert response["messageKind"] == "response"
    assert response["requestId"] == DESKTOP_REQUEST_ID
    assert response["result"]["protocolVersion"] == 1
    assert response["result"]["runtimeMode"] == "source"
    assert response["result"]["maaRuntime"]["state"] == "unavailable"
    assert event["messageType"] == "system.ready"
    assert event["sequence"] == 1
    assert service.handshake_completed


def test_handshake_advertises_only_an_initialized_device_service() -> None:
    device_service = StubDeviceService()
    service = build_service(device_service=device_service)

    outgoing = service.handle_frame_body(
        request_body("system.handshake", handshake_payload())
    )
    response = decode(outgoing.messages[0])

    assert response["result"]["maaRuntime"] == {
        "state": "available",
        "bindingVersion": "5.10.5",
        "nativeVersion": "5.10.5",
    }
    assert response["result"]["featureFlags"] == [
        "runtime.graphExecution",
        "runtime.deviceManagement",
    ]
    assert service.close()
    assert device_service.closed == 1


def test_device_requests_return_only_safe_metadata_and_ordered_events() -> None:
    device_service = StubDeviceService()
    service = build_service(device_service=device_service)
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    listed = service.handle_frame_body(request_body("device.list", {}))
    connected = service.handle_frame_body(
        request_body("device.connect", {"deviceKey": "device-opaque-1"})
    )
    disconnected = service.handle_frame_body(
        request_body("device.disconnect", {"deviceKey": "device-opaque-1"})
    )

    listed_result = decode(listed.messages[0])["result"]
    connect_response, connect_event = (
        decode(message) for message in connected.messages
    )
    disconnect_response, disconnect_event = (
        decode(message) for message in disconnected.messages
    )
    assert listed_result == {
        "devices": [
            {
                "deviceKey": "device-opaque-1",
                "displayName": "Android device 1",
                "controllerFamily": "adb",
                "state": "available",
            }
        ]
    }
    assert connect_response["result"]["device"]["state"] == "connected"
    assert connect_event["messageType"] == "device.stateChanged"
    assert connect_event["payload"]["reason"] == "connected"
    assert disconnect_response["result"]["device"]["state"] == "available"
    assert disconnect_event["payload"]["reason"] == "disconnected"
    assert connect_event["sequence"] < disconnect_event["sequence"]
    assert "address" not in repr(listed_result)
    assert "physicalId" not in repr(listed_result)
    assert service.close()


def test_device_interactions_are_bounded_correlated_and_never_expanded() -> None:
    device_service = StubDeviceService()
    control_service = StubDeviceControlService()
    service = build_service(
        device_service=device_service,
        device_control_service=control_service,
    )
    handshake = service.handle_frame_body(
        request_body("system.handshake", handshake_payload())
    )
    assert (
        "runtime.deviceControl"
        in decode(handshake.messages[0])["result"]["featureFlags"]
    )

    point = {
        "x": 120,
        "y": 240,
        "coordinateSpaceId": "coordinate-space-opaque",
        "sourceGeneration": 7,
    }
    click = service.handle_frame_body(
        request_body(
            "device.interact",
            {
                "deviceKey": "device-opaque-1",
                "interaction": {"kind": "click", "point": point},
            },
        )
    )
    long_press = service.handle_frame_body(
        request_body(
            "device.interact",
            {
                "deviceKey": "device-opaque-1",
                "interaction": {
                    "kind": "longPress",
                    "point": point,
                    "durationMilliseconds": 750,
                },
            },
        )
    )
    swipe = service.handle_frame_body(
        request_body(
            "device.interact",
            {
                "deviceKey": "device-opaque-1",
                "interaction": {
                    "kind": "swipe",
                    "start": point,
                    "end": {**point, "x": 600, "y": 700},
                    "durationMilliseconds": 300,
                },
            },
        )
    )
    back = service.handle_frame_body(
        request_body(
            "device.interact",
            {
                "deviceKey": "device-opaque-1",
                "interaction": {"kind": "key", "key": "back"},
            },
        )
    )

    assert decode(click.messages[0])["result"] == {
        "completed": True,
        "kind": "click",
    }
    assert decode(long_press.messages[0])["result"]["kind"] == "longPress"
    assert decode(swipe.messages[0])["result"]["kind"] == "swipe"
    assert decode(back.messages[0])["result"]["kind"] == "key"
    assert [action[0] for action in control_service.actions] == [
        "click",
        "longPress",
        "swipe",
        "key",
    ]
    for action in control_service.actions:
        correlation = cast("AutomationOperationCorrelation", action[-1])
        assert correlation.request_id == UUID(DESKTOP_REQUEST_ID)


def test_invalid_device_interaction_is_rejected_before_reaching_backend() -> None:
    control_service = StubDeviceControlService()
    service = build_service(device_control_service=control_service)
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(
        request_body(
            "device.interact",
            {
                "deviceKey": "device-opaque-1",
                "interaction": {
                    "kind": "longPress",
                    "point": {
                        "x": 1,
                        "y": 2,
                        "coordinateSpaceId": "coordinate-space-opaque",
                        "sourceGeneration": 7,
                    },
                    "durationMilliseconds": 100,
                },
            },
        )
    )
    raw_key = service.handle_frame_body(
        request_body(
            "device.interact",
            {
                "deviceKey": "device-opaque-1",
                "interaction": {"kind": "key", "key": "home"},
            },
        )
    )

    assert decode(outgoing.messages[0])["error"]["code"] == "INVALID_PAYLOAD"
    assert decode(raw_key.messages[0])["error"]["code"] == "INVALID_PAYLOAD"
    assert control_service.actions == []


def test_preview_requests_return_only_token_metadata_and_release_explicitly() -> None:
    preview_service = StubPreviewService()
    service = build_service(preview_service=preview_service)
    handshake = service.handle_frame_body(
        request_body("system.handshake", handshake_payload())
    )
    assert (
        "runtime.devicePreview"
        in decode(handshake.messages[0])["result"]["featureFlags"]
    )

    captured = service.handle_frame_body(
        request_body(
            "preview.capture",
            {
                "deviceKey": "device-opaque-1",
                "maximumWidth": 960,
                "maximumHeight": 540,
            },
        )
    )
    capture_result = decode(captured.messages[0])["result"]
    assert capture_result["preview"]["previewToken"] == (
        "0123456789abcdef0123456789abcdef"
    )
    assert capture_result["preview"]["byteLength"] == 582341
    assert "path" not in repr(capture_result).lower()
    assert "bytes" not in repr(capture_result).lower()

    released = service.handle_frame_body(
        request_body(
            "preview.release",
            {"previewToken": "0123456789abcdef0123456789abcdef"},
        )
    )
    assert decode(released.messages[0])["result"] == {"released": True}
    assert preview_service.released_tokens == ["0123456789abcdef0123456789abcdef"]
    assert service.close()


def test_capture_requests_bind_region_to_preview_and_release_explicitly() -> None:
    preview_service = StubPreviewService()
    service = build_service(preview_service=preview_service)
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    prepared = service.handle_frame_body(
        request_body(
            "capture.prepare",
            {
                "previewToken": "0123456789abcdef0123456789abcdef",
                "region": {
                    "x": 100,
                    "y": 200,
                    "width": 300,
                    "height": 400,
                    "coordinateSpaceId": "coordinate-space-opaque",
                    "sourceGeneration": 7,
                },
            },
        )
    )
    capture_result = decode(prepared.messages[0])["result"]
    assert capture_result == {
        "capture": {
            "captureToken": "abcdef0123456789abcdef0123456789",
            "mediaType": "image/png",
            "width": 300,
            "height": 400,
            "coordinateSpaceId": "capture-space-opaque",
            "sourceKind": "regionCapture",
            "byteLength": 785432,
            "expiresInMilliseconds": 60000,
        }
    }
    assert "path" not in repr(capture_result).lower()
    assert "bytes" not in repr(capture_result).lower()

    released = service.handle_frame_body(
        request_body(
            "capture.release",
            {"captureToken": "abcdef0123456789abcdef0123456789"},
        )
    )
    assert decode(released.messages[0])["result"] == {"released": True}
    assert preview_service.released_capture_tokens == [
        "abcdef0123456789abcdef0123456789"
    ]
    assert service.close()


def test_device_request_fails_safely_when_backend_is_unavailable() -> None:
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(request_body("device.list", {}))
    response = decode(outgoing.messages[0])

    assert response["error"]["code"] == "AUTOMATION_BACKEND_UNAVAILABLE"
    assert response["error"]["retryability"] == "never"


def test_device_service_error_is_normalized_without_device_metadata() -> None:
    device_service = StubDeviceService()
    device_service.failure = DeviceServiceError(
        DeviceServiceErrorCode.DISCOVERY_FAILED,
        "The controlled device discovery failed without identifiers.",
        retryable=True,
    )
    service = build_service(device_service=device_service)
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(request_body("device.list", {}))
    response = decode(outgoing.messages[0])

    assert response["error"]["code"] == "DEVICE_DISCOVERY_FAILED"
    assert response["error"]["retryability"] == "safe"
    assert "device-opaque-1" not in repr(response["error"])
    assert service.close()


def test_handshake_negotiates_the_smaller_frame_limit() -> None:
    service = build_service()

    service.handle_frame_body(
        request_body("system.handshake", handshake_payload(frame_bytes=65_536))
    )

    assert service.negotiated_frame_bytes == 65_536


def test_handshake_clamps_an_oversized_requested_frame_limit() -> None:
    service = build_service()

    service.handle_frame_body(
        request_body("system.handshake", handshake_payload(frame_bytes=16_777_216))
    )

    assert service.negotiated_frame_bytes == 16 * 1024 * 1024


def test_disjoint_protocol_version_range_is_rejected() -> None:
    service = build_service()

    outgoing = service.handle_frame_body(
        request_body("system.handshake", handshake_payload(minimum=2, maximum=3))
    )

    response = decode(outgoing.messages[0])
    assert response["error"]["code"] == RuntimeErrorCode.PROTOCOL_INCOMPATIBLE.value
    assert response["error"]["parameters"]["runtimeProtocolVersion"] == 1
    assert not service.handshake_completed


def test_a_second_handshake_is_rejected() -> None:
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(
        request_body("system.handshake", handshake_payload())
    )

    response = decode(outgoing.messages[0])
    assert (
        response["error"]["code"] == RuntimeErrorCode.HANDSHAKE_ALREADY_COMPLETED.value
    )


def test_requests_before_the_handshake_are_rejected() -> None:
    service = build_service()

    outgoing = service.handle_frame_body(request_body("system.health", {}))

    response = decode(outgoing.messages[0])
    assert response["error"]["code"] == RuntimeErrorCode.HANDSHAKE_REQUIRED.value


def test_health_reports_monotonic_uptime() -> None:
    clock = StubClock()
    service = build_service(clock)
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))
    clock.milliseconds = 4_200

    outgoing = service.handle_frame_body(request_body("system.health", {}))

    response = decode(outgoing.messages[0])
    assert response["result"]["state"] == "ok"
    assert response["result"]["uptimeMilliseconds"] == 4_200


def test_shutdown_is_acknowledged_and_stops_the_loop() -> None:
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(request_body("system.shutdown", {}))

    assert outgoing.stop_requested
    assert decode(outgoing.messages[0])["result"] == {"accepted": True}


def test_unknown_message_type_fails_with_a_correlated_response() -> None:
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(request_body("future.unknownOperation", {}))

    response = decode(outgoing.messages[0])
    assert response["error"]["code"] == RuntimeErrorCode.UNKNOWN_MESSAGE_TYPE.value
    assert response["error"]["requestId"] == DESKTOP_REQUEST_ID


def test_invalid_payload_for_a_known_request_is_rejected() -> None:
    service = build_service()

    outgoing = service.handle_frame_body(
        request_body("system.handshake", {"desktopVersion": "0.1.0"})
    )

    response = decode(outgoing.messages[0])
    assert response["error"]["code"] == RuntimeErrorCode.INVALID_PAYLOAD.value
    assert not service.handshake_completed


def test_unparsable_body_with_a_recoverable_request_id_is_correlated() -> None:
    service = build_service()
    body = json.dumps(
        {
            "protocolVersion": 1,
            "messageKind": "request",
            "messageType": "system.health",
            "requestId": DESKTOP_REQUEST_ID,
        },
        separators=(",", ":"),
    )

    outgoing = service.handle_frame_body(body)

    response = decode(outgoing.messages[0])
    assert response["messageKind"] == "response"
    assert response["requestId"] == DESKTOP_REQUEST_ID
    assert response["error"]["code"] == RuntimeErrorCode.INVALID_MESSAGE.value


def test_unparsable_body_without_a_request_id_emits_a_protocol_error_event() -> None:
    service = build_service()

    outgoing = service.handle_frame_body('{"messageKind":"request"}')

    event = decode(outgoing.messages[0])
    assert event["messageKind"] == "event"
    assert event["messageType"] == "system.protocolError"
    assert event["payload"]["error"]["code"] == RuntimeErrorCode.INVALID_MESSAGE.value


def test_response_messages_from_the_desktop_are_rejected() -> None:
    service = build_service()
    body = json.dumps(
        {
            "protocolVersion": 1,
            "messageKind": "response",
            "messageType": "system.health",
            "requestId": DESKTOP_REQUEST_ID,
            "result": {},
        },
        separators=(",", ":"),
    )

    outgoing = service.handle_frame_body(body)

    event = decode(outgoing.messages[0])
    assert (
        event["payload"]["error"]["code"]
        == RuntimeErrorCode.UNSUPPORTED_MESSAGE_KIND.value
    )


def test_event_sequence_increases_without_gaps() -> None:
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    first = service.handle_frame_body('{"messageKind":"request"}')
    second = service.handle_frame_body('{"messageKind":"request"}')

    assert decode(first.messages[0])["sequence"] == 2
    assert decode(second.messages[0])["sequence"] == 3


@pytest.mark.parametrize(
    "message_type",
    ["system.handshake", "system.health", "system.shutdown"],
)
def test_every_response_is_correlated_to_its_request(message_type: str) -> None:
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))
    request_id = str(uuid4())
    payload = handshake_payload() if message_type == "system.handshake" else {}

    outgoing = service.handle_frame_body(
        request_body(message_type, payload, request_id=request_id)
    )

    assert decode(outgoing.messages[0])["requestId"] == request_id


def assert_payload_matches_its_definition(message: dict[str, Any]) -> None:
    """Asserts an outgoing message body satisfies its bound canonical definition.

    The envelope schema types payloads and results as generic JSON objects, so an
    envelope can be valid while the body inside it is not.
    """
    message_type = message["messageType"]
    if message["messageKind"] == "event" and message_type in EVENT_FAMILIES:
        assert is_valid_payload(EVENT_FAMILIES[message_type], message["payload"])
    if (
        message["messageKind"] == "response"
        and "result" in message
        and message_type in REQUEST_FAMILIES
    ):
        assert is_valid_payload(
            REQUEST_FAMILIES[message_type].result, message["result"]
        )
    if message["messageKind"] == "response" and "error" in message:
        assert is_valid_payload("ProtocolErrorV1", message["error"])


def test_every_outgoing_message_body_matches_its_canonical_definition() -> None:
    service = build_service()
    bodies = [
        request_body("system.handshake", handshake_payload()),
        request_body("system.health", {}),
        request_body("future.unknownOperation", {}),
        '{"messageKind":"request"}',
        request_body("system.shutdown", {}),
    ]

    for body in bodies:
        for message in service.handle_frame_body(body).messages:
            assert_payload_matches_its_definition(decode(message))


def test_protocol_error_event_payload_omits_absent_optional_fields() -> None:
    service = build_service()

    outgoing = service.handle_frame_body('{"messageKind":"request"}')

    error = decode(outgoing.messages[0])["payload"]["error"]
    assert "requestId" not in error
    assert "runId" not in error
    assert "causes" not in error
    assert is_valid_payload("SystemProtocolErrorEventPayloadV1", {"error": error})


def test_error_details_never_echo_request_payload_content() -> None:
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(
        request_body("future.unknownOperation", {"secret": "do-not-log-this-value"})
    )

    encoded = encode_outgoing(cast("Any", outgoing.messages[0]))
    assert "do-not-log-this-value" not in encoded


def test_registry_get_and_graph_validate_return_authoritative_results() -> None:
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    registry_outgoing = service.handle_frame_body(request_body("registry.get", {}))
    validation_outgoing = service.handle_frame_body(
        request_body("graph.validate", {"document": runtime_document()})
    )

    registry_response = decode(registry_outgoing.messages[0])
    validation_response = decode(validation_outgoing.messages[0])
    assert registry_response["result"]["registry"]["definitions"]
    assert validation_response["result"]["executable"] is True
    assert validation_response["result"]["report"]["diagnostics"] == []
    assert_payload_matches_its_definition(registry_response)
    assert_payload_matches_its_definition(validation_response)
    assert service.close()


def test_capture_registry_advertises_and_executes_only_bounded_image_metadata() -> None:
    registry = build_capture_backend_registry(
        FakeAutomationBackend(FakeAutomationScenario(width=960, height=540))
    )
    service = build_service(registry=registry)
    handshake = service.handle_frame_body(
        request_body("system.handshake", handshake_payload())
    )

    handshake_response = decode(handshake.messages[0])
    assert handshake_response["result"]["featureFlags"] == [
        "runtime.graphExecution",
        "runtime.screenCapture",
    ]
    registry_response = decode(
        service.handle_frame_body(request_body("registry.get", {})).messages[0]
    )
    type_keys = {
        definition["typeKey"]
        for definition in registry_response["result"]["registry"]["definitions"]
    }
    assert "automation.captureScreen" in type_keys
    assert "vision.ocr" not in type_keys
    assert "automation.clickRectCenter" not in type_keys

    started = service.handle_frame_body(
        request_body(
            "run.start",
            {
                "document": runtime_document(
                    "automation.captureScreen",
                    action_inputs={},
                ),
                "graphId": RUNTIME_GRAPH_ID,
                "deviceKey": "device-opaque-1",
            },
        )
    )
    started.notify_messages_queued()
    asynchronous = wait_for_async_messages(
        service,
        lambda message: (
            message["messageType"] == "run.stateChanged"
            and message["payload"]["state"] == "succeeded"
        ),
    )
    capture_event = next(
        message
        for message in asynchronous
        if message["messageType"] == "node.stateChanged"
        and message.get("nodeId") == RUNTIME_ACTION_ID
        and message["payload"]["state"] == "succeeded"
    )
    image_summary = next(
        summary
        for summary in capture_event["payload"]["valueSummaries"]
        if summary["kind"] == "image"
    )
    assert image_summary["width"] == 960
    assert image_summary["height"] == 540
    assert "fake-image" not in repr(capture_event)
    assert "handle" not in repr(capture_event).lower()
    assert service.close()


def test_run_start_defers_execution_until_response_and_running_event_are_queued() -> (
    None
):
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(
        request_body(
            "run.start",
            {"document": runtime_document(), "graphId": RUNTIME_GRAPH_ID},
        )
    )

    response, running = (decode(message) for message in outgoing.messages)
    assert response["messageType"] == "run.start"
    assert running["messageType"] == "run.stateChanged"
    assert running["payload"]["state"] == "running"
    assert service.drain_async_messages() == ()

    outgoing.notify_messages_queued()
    outgoing.notify_messages_queued()
    asynchronous = wait_for_async_messages(
        service,
        lambda message: (
            message["messageType"] == "run.stateChanged"
            and message["payload"]["state"] == "succeeded"
        ),
    )

    assert any(message["messageType"] == "edge.traversed" for message in asynchronous)
    assert any(
        message["messageType"] == "runtime.logCreated" for message in asynchronous
    )
    for message in [response, running, *asynchronous]:
        assert_payload_matches_its_definition(message)
    assert service.close()


def test_run_start_accepts_initial_persistent_values_and_emits_terminal_updates() -> (
    None
):
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(
        request_body(
            "run.start",
            {
                "document": persistent_runtime_document(),
                "graphId": RUNTIME_GRAPH_ID,
                "initialPersistentVariables": [
                    {
                        "variableId": RUNTIME_PERSISTENT_NUMBER_ID,
                        "valueKind": "number",
                        "value": 1.25,
                    }
                ],
            },
        )
    )
    assert decode(outgoing.messages[0])["result"]["accepted"] is True
    outgoing.notify_messages_queued()
    terminal = wait_for_async_messages(
        service,
        lambda message: (
            message["messageType"] == "run.stateChanged"
            and message["payload"]["state"] == "succeeded"
        ),
    )[-1]

    assert terminal["payload"]["persistentVariableUpdates"] == [
        {
            "variableId": RUNTIME_PERSISTENT_NUMBER_ID,
            "valueKind": "number",
            "value": 8.75,
        }
    ]
    assert service.close()


def test_run_start_prepares_only_declared_project_asset_bindings() -> None:
    asset_id = "bfa1e0d4-f809-4415-8038-0213245f6071"
    asset_token = "0123456789abcdef0123456789abcdef"
    content_hash = "9f2c1a7be3d45608192a3b4c5d6e7f80910213245f60718293a4b5c6d7e8f900"
    document = runtime_document()
    document["assets"] = [
        {
            "assetId": asset_id,
            "displayName": "recognition-template",
            "contentHash": content_hash,
            "mediaType": "image/png",
            "byteLength": 240128,
            "coordinateSpace": {
                "spaceId": "capture-space-opaque",
                "width": 300,
                "height": 400,
            },
            "sourceKind": "regionCapture",
            "createdAt": "2026-07-27T00:00:00Z",
        }
    ]
    preview_service = StubPreviewService()
    service = build_service(preview_service=preview_service)
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(
        request_body(
            "run.start",
            {
                "document": document,
                "graphId": RUNTIME_GRAPH_ID,
                "assetBindings": [
                    {
                        "assetId": asset_id,
                        "assetToken": asset_token,
                        "contentHash": content_hash,
                        "byteLength": 240128,
                        "width": 300,
                        "height": 400,
                        "coordinateSpaceId": "capture-space-opaque",
                    }
                ],
            },
        )
    )

    assert decode(outgoing.messages[0])["result"]["accepted"] is True
    assert preview_service.prepared_project_assets == [
        (
            asset_token,
            content_hash,
            240128,
            300,
            400,
            "capture-space-opaque",
        )
    ]
    outgoing.notify_messages_queued()
    wait_for_async_messages(
        service,
        lambda message: (
            message["messageType"] == "run.stateChanged"
            and message["payload"]["state"] == "succeeded"
        ),
    )
    assert service.close()


@pytest.mark.parametrize(
    ("document", "graph_id", "expected_code"),
    [
        (
            {"schemaVersion": 1},
            RUNTIME_GRAPH_ID,
            RuntimeErrorCode.GRAPH_DOCUMENT_INVALID,
        ),
        (
            runtime_document(action_inputs={}),
            RUNTIME_GRAPH_ID,
            RuntimeErrorCode.GRAPH_NOT_EXECUTABLE,
        ),
        (
            runtime_document(),
            "71000000-0000-4000-8000-000000000099",
            RuntimeErrorCode.GRAPH_NOT_FOUND,
        ),
    ],
)
def test_run_start_returns_specific_graph_errors(
    document: dict[str, Any],
    graph_id: str,
    expected_code: RuntimeErrorCode,
) -> None:
    service = build_service()
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))

    outgoing = service.handle_frame_body(
        request_body("run.start", {"document": document, "graphId": graph_id})
    )

    assert decode(outgoing.messages[0])["error"]["code"] == expected_code.value
    assert service.close()


def test_active_run_rejection_and_cancellation_are_structured_and_idempotent() -> None:
    control_service = StubDeviceControlService()
    service = build_service(device_control_service=control_service)
    service.handle_frame_body(request_body("system.handshake", handshake_payload()))
    payload = {
        "document": runtime_document(
            "core.time.delay",
            action_inputs={"durationMilliseconds": 60_000},
        ),
        "graphId": RUNTIME_GRAPH_ID,
        "deviceKey": "session-device",
    }
    started = service.handle_frame_body(request_body("run.start", payload))
    run_id = decode(started.messages[0])["result"]["runId"]
    started.notify_messages_queued()
    wait_for_async_messages(
        service,
        lambda message: (
            message["messageType"] == "node.stateChanged"
            and message.get("nodeId") == RUNTIME_ACTION_ID
            and message["payload"]["state"] == "running"
        ),
    )

    duplicate = service.handle_frame_body(request_body("run.start", payload))
    assert (
        decode(duplicate.messages[0])["error"]["code"]
        == RuntimeErrorCode.RUN_ALREADY_ACTIVE.value
    )

    interaction = service.handle_frame_body(
        request_body(
            "device.interact",
            {
                "deviceKey": "device-opaque-1",
                "interaction": {
                    "kind": "click",
                    "point": {
                        "x": 1,
                        "y": 2,
                        "coordinateSpaceId": "coordinate-space-opaque",
                        "sourceGeneration": 7,
                    },
                },
            },
        )
    )
    assert (
        decode(interaction.messages[0])["error"]["code"]
        == RuntimeErrorCode.RUN_ALREADY_ACTIVE.value
    )
    assert control_service.actions == []

    cancellation = service.handle_frame_body(
        request_body("run.cancel", {"runId": run_id})
    )
    cancel_response, cancelling = (decode(message) for message in cancellation.messages)
    assert cancel_response["result"]["alreadyRequested"] is False
    assert cancelling["payload"]["state"] == "cancelling"
    cancellation.notify_messages_queued()
    wait_for_async_messages(
        service,
        lambda message: (
            message["messageType"] == "run.stateChanged"
            and message["payload"]["state"] == "cancelled"
        ),
    )

    repeated = service.handle_frame_body(request_body("run.cancel", {"runId": run_id}))
    repeated_response = decode(repeated.messages[0])
    assert len(repeated.messages) == 1
    assert repeated_response["result"]["alreadyRequested"] is True
    assert repeated_response["result"]["state"] == "cancelled"
    assert service.close()
