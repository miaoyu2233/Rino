"""Request dispatch and lifecycle for the Rino runtime sidecar.

The service owns protocol state: it requires a successful handshake before any other
request, negotiates the protocol version and frame limit, answers health queries, and
stops on an explicit shutdown request or on end of input.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from threading import Lock
from typing import Any, Final, cast
from uuid import UUID, uuid4

from pydantic import ValidationError

from rino_runtime.application import (
    DEFAULT_SCHEDULER_LIMITS,
    RuntimeApplication,
    RuntimeApplicationEvent,
    RuntimeRequestFailure,
)
from rino_runtime.artifacts import CaptureRegion
from rino_runtime.backends.base import (
    AutomationDeviceDescriptor,
    AutomationOperationCorrelation,
    AutomationOperationEvent,
    AutomationRuntimeEvent,
    AutomationRuntimeEventSource,
    DeviceControlKey,
    DeviceControlService,
    DeviceManagementService,
    DevicePreviewService,
    DeviceServiceError,
    DeviceServiceErrorCode,
)
from rino_runtime.contracts import (
    DEFAULT_MAXIMUM_FRAME_BYTES,
    EVENT_FAMILIES,
    PROTOCOL_VERSION,
    REQUEST_FAMILIES,
    ErrorResponseEnvelopeV1,
    EventEnvelopeV1,
    IpcMessageV1,
    RequestEnvelopeV1,
    SuccessResponseEnvelopeV1,
    dump_model,
    is_valid_payload,
    parse_message,
    serialize_message,
)
from rino_runtime.errors import RuntimeErrorCode, build_protocol_error
from rino_runtime.nodes import NodeRegistry, RuntimeImageReference
from rino_runtime.nodes.execution import RuntimePoint
from rino_runtime.scheduler import SchedulerLimits

RUNTIME_VERSION: Final[str] = "0.1.0"
MINIMUM_FRAME_BYTES: Final[int] = 4096
MAXIMUM_SUPPORTED_FRAME_BYTES: Final[int] = 16 * 1024 * 1024


class RuntimeMode(StrEnum):
    SOURCE = "source"
    FROZEN = "frozen"


class HealthState(StrEnum):
    OK = "ok"
    DEGRADED = "degraded"


@dataclass
class OutgoingMessages:
    """Messages produced while handling one incoming frame, in emission order."""

    messages: list[IpcMessageV1] = field(default_factory=list[IpcMessageV1])
    stop_requested: bool = False
    after_messages_queued: tuple[Callable[[], None], ...] = ()
    _queue_notification_completed: bool = field(default=False, init=False)

    def notify_messages_queued(self) -> None:
        if self._queue_notification_completed:
            return
        self._queue_notification_completed = True
        for callback in self.after_messages_queued:
            callback()


class RuntimeService:
    """Protocol state machine for one desktop connection."""

    def __init__(
        self,
        *,
        runtime_mode: RuntimeMode,
        monotonic_milliseconds: Callable[[], int],
        runtime_version: str = RUNTIME_VERSION,
        event_id_factory: Callable[[], UUID] = uuid4,
        run_id_factory: Callable[[], UUID] = uuid4,
        registry: NodeRegistry | None = None,
        scheduler_limits: SchedulerLimits = DEFAULT_SCHEDULER_LIMITS,
        async_message_sink: Callable[[IpcMessageV1], None] | None = None,
        device_service: DeviceManagementService | None = None,
        device_control_service: DeviceControlService | None = None,
        preview_service: DevicePreviewService | None = None,
        operation_event_source: AutomationRuntimeEventSource | None = None,
    ) -> None:
        self._runtime_mode = runtime_mode
        self._monotonic_milliseconds = monotonic_milliseconds
        self._runtime_version = runtime_version
        self._event_id_factory = event_id_factory
        self._started_at_milliseconds = monotonic_milliseconds()
        self._event_sequence = 0
        self._event_lock = Lock()
        self._sink_lock = Lock()
        self._async_message_sink = async_message_sink
        self._pending_async_messages: list[IpcMessageV1] = []
        self._handshake_completed = False
        self._negotiated_frame_bytes = DEFAULT_MAXIMUM_FRAME_BYTES
        self._device_service = device_service
        self._device_control_service = device_control_service
        self._preview_service = preview_service
        self._operation_event_source = operation_event_source
        self._device_close_succeeded: bool | None = None
        self._application = RuntimeApplication(
            self._application_event,
            registry=registry,
            scheduler_limits=scheduler_limits,
            run_id_factory=run_id_factory,
        )
        if operation_event_source is not None:
            operation_event_source.set_operation_event_sink(
                self._automation_runtime_event
            )

    @property
    def negotiated_frame_bytes(self) -> int:
        return self._negotiated_frame_bytes

    @property
    def handshake_completed(self) -> bool:
        return self._handshake_completed

    def set_async_message_sink(
        self, sink: Callable[[IpcMessageV1], None] | None
    ) -> None:
        with self._sink_lock:
            self._async_message_sink = sink
            pending = tuple(self._pending_async_messages) if sink is not None else ()
            if sink is not None:
                self._pending_async_messages.clear()
        if sink is not None:
            for message in pending:
                sink(message)

    def drain_async_messages(self) -> tuple[IpcMessageV1, ...]:
        with self._sink_lock:
            messages = tuple(self._pending_async_messages)
            self._pending_async_messages.clear()
        return messages

    def close(self) -> bool:
        application_closed = self._application.close()
        if self._operation_event_source is not None:
            self._operation_event_source.set_operation_event_sink(None)
        if self._device_close_succeeded is None:
            self._device_close_succeeded = (
                True
                if self._device_service is None
                else not self._device_service.close()
            )
        return application_closed and self._device_close_succeeded

    def handle_frame_body(self, body: str) -> OutgoingMessages:
        """Handles one decoded frame body and returns the messages to emit."""
        try:
            message = parse_message(body)
        except ValidationError:
            return self._reject_unparsable_body(body)

        if not isinstance(message, RequestEnvelopeV1):
            return OutgoingMessages(
                messages=[
                    self._protocol_error_event(
                        RuntimeErrorCode.UNSUPPORTED_MESSAGE_KIND,
                        "The runtime accepts only request messages from the desktop.",
                    )
                ]
            )

        return self._dispatch_request(message)

    def build_protocol_error_event(
        self, code: RuntimeErrorCode, technical_detail: str
    ) -> EventEnvelopeV1:
        """Exposes protocol-error events to the transport layer for framing failures."""
        return self._protocol_error_event(code, technical_detail)

    def _dispatch_request(self, request: RequestEnvelopeV1) -> OutgoingMessages:
        message_type = request.message_type
        if message_type not in REQUEST_FAMILIES:
            return OutgoingMessages(
                messages=[
                    self._error_response(
                        request,
                        RuntimeErrorCode.UNKNOWN_MESSAGE_TYPE,
                        "The runtime does not implement this request type.",
                    )
                ]
            )

        family = REQUEST_FAMILIES[message_type]
        payload = dump_model(request.payload)
        if not is_valid_payload(family.request_payload, payload):
            return OutgoingMessages(
                messages=[
                    self._error_response(
                        request,
                        RuntimeErrorCode.INVALID_PAYLOAD,
                        "The request payload does not satisfy its canonical "
                        "definition.",
                        parameters={"messageType": message_type},
                    )
                ]
            )

        try:
            if message_type == "system.handshake":
                return self._handle_handshake(request, payload)
            if not self._handshake_completed:
                return OutgoingMessages(
                    messages=[
                        self._error_response(
                            request,
                            RuntimeErrorCode.HANDSHAKE_REQUIRED,
                            "A successful system.handshake must precede any other "
                            "request.",
                        )
                    ]
                )
            if message_type == "system.health":
                return self._handle_health(request)
            if message_type == "system.shutdown":
                return self._handle_shutdown(request)
            if message_type == "registry.get":
                return self._handle_registry_get(request)
            if message_type == "device.list":
                return self._handle_device_list(request)
            if message_type == "device.connect":
                return self._handle_device_connect(request, payload)
            if message_type == "device.disconnect":
                return self._handle_device_disconnect(request, payload)
            if message_type == "device.interact":
                return self._handle_device_interact(request, payload)
            if message_type == "capture.prepare":
                return self._handle_capture_prepare(request, payload)
            if message_type == "capture.release":
                return self._handle_capture_release(request, payload)
            if message_type == "preview.capture":
                return self._handle_preview_capture(request, payload)
            if message_type == "preview.release":
                return self._handle_preview_release(request, payload)
            if message_type == "graph.validate":
                return self._handle_graph_validate(request, payload)
            if message_type == "run.start":
                return self._handle_run_start(request, payload)
            if message_type == "run.cancel":
                return self._handle_run_cancel(request, payload)
            raise RuntimeError("A registered request family has no handler.")
        except DeviceServiceError as error:
            return OutgoingMessages(
                messages=[
                    self._error_response(
                        request,
                        RuntimeErrorCode(error.code.value),
                        error.technical_detail,
                    )
                ]
            )
        except RuntimeRequestFailure as error:
            return OutgoingMessages(
                messages=[
                    self._error_response(
                        request,
                        error.code,
                        error.technical_detail,
                        parameters=dict(error.parameters),
                    )
                ]
            )
        except Exception:
            return OutgoingMessages(
                messages=[
                    self._error_response(
                        request,
                        RuntimeErrorCode.INTERNAL_ERROR,
                        "The runtime request failed inside its trusted handler.",
                    )
                ]
            )

    def _handle_handshake(
        self, request: RequestEnvelopeV1, payload: dict[str, Any]
    ) -> OutgoingMessages:
        if self._handshake_completed:
            return OutgoingMessages(
                messages=[
                    self._error_response(
                        request,
                        RuntimeErrorCode.HANDSHAKE_ALREADY_COMPLETED,
                        "The connection already completed its handshake.",
                    )
                ]
            )

        version_range = payload["protocolVersionRange"]
        minimum = int(version_range["minimum"])
        maximum = int(version_range["maximum"])
        if minimum > maximum or not minimum <= PROTOCOL_VERSION <= maximum:
            return OutgoingMessages(
                messages=[
                    self._error_response(
                        request,
                        RuntimeErrorCode.PROTOCOL_INCOMPATIBLE,
                        "The requested protocol version range excludes the runtime "
                        "protocol version.",
                        parameters={
                            "requestedMinimum": minimum,
                            "requestedMaximum": maximum,
                            "runtimeProtocolVersion": PROTOCOL_VERSION,
                        },
                    )
                ]
            )

        requested_frame_bytes = int(payload["maximumFrameBytes"])
        self._negotiated_frame_bytes = max(
            MINIMUM_FRAME_BYTES,
            min(requested_frame_bytes, MAXIMUM_SUPPORTED_FRAME_BYTES),
        )
        self._handshake_completed = True

        maa_runtime: dict[str, str] = {"state": "unavailable"}
        feature_flags = ["runtime.graphExecution"]
        if self._device_service is not None:
            feature_flags.append("runtime.deviceManagement")
            backend_info = self._device_service.runtime_info
            if backend_info.backend_key == "maa":
                maa_runtime = {
                    "state": "available",
                    "bindingVersion": backend_info.binding_version,
                    "nativeVersion": backend_info.native_version,
                }
        if self._device_control_service is not None:
            feature_flags.append("runtime.deviceControl")
        if "automation.captureScreen" in self._application.registered_type_keys:
            feature_flags.append("runtime.screenCapture")
        if self._preview_service is not None:
            feature_flags.append("runtime.devicePreview")
            feature_flags.append("runtime.captureArtifacts")

        result: dict[str, Any] = {
            "runtimeVersion": self._runtime_version,
            "protocolVersion": PROTOCOL_VERSION,
            "maximumFrameBytes": self._negotiated_frame_bytes,
            "runtimeMode": self._runtime_mode.value,
            "graphSchemaVersionRange": {"minimum": 1, "maximum": 1},
            "registryVersion": self._application.registry_version,
            "maaRuntime": maa_runtime,
            "featureFlags": feature_flags,
        }
        return OutgoingMessages(
            messages=[
                self._success_response(request, result),
                self._event("system.ready", {"state": "ready"}),
            ]
        )

    def _handle_health(self, request: RequestEnvelopeV1) -> OutgoingMessages:
        uptime = max(0, self._monotonic_milliseconds() - self._started_at_milliseconds)
        return OutgoingMessages(
            messages=[
                self._success_response(
                    request,
                    {
                        "state": HealthState.OK.value,
                        "uptimeMilliseconds": uptime,
                    },
                )
            ]
        )

    def _handle_shutdown(self, request: RequestEnvelopeV1) -> OutgoingMessages:
        return OutgoingMessages(
            messages=[self._success_response(request, {"accepted": True})],
            stop_requested=True,
            after_messages_queued=(self._close_after_response,),
        )

    def _close_after_response(self) -> None:
        self.close()

    def _handle_registry_get(self, request: RequestEnvelopeV1) -> OutgoingMessages:
        return OutgoingMessages(
            messages=[
                self._success_response(
                    request,
                    self._application.registry_result(),
                )
            ]
        )

    def _handle_device_list(self, request: RequestEnvelopeV1) -> OutgoingMessages:
        service = self._require_device_service()
        devices = service.list_devices()
        return OutgoingMessages(
            messages=[
                self._success_response(
                    request,
                    {"devices": [_device_payload(device) for device in devices]},
                )
            ]
        )

    def _handle_device_connect(
        self,
        request: RequestEnvelopeV1,
        payload: dict[str, Any],
    ) -> OutgoingMessages:
        service = self._require_device_service()
        device = service.connect(
            str(payload["deviceKey"]),
            AutomationOperationCorrelation(request_id=request.request_id),
        )
        serialized = _device_payload(device)
        return OutgoingMessages(
            messages=[
                self._success_response(request, {"device": serialized}),
                self._event(
                    "device.stateChanged",
                    {"device": serialized, "reason": "connected"},
                ),
            ]
        )

    def _handle_device_disconnect(
        self,
        request: RequestEnvelopeV1,
        payload: dict[str, Any],
    ) -> OutgoingMessages:
        service = self._require_device_service()
        device = service.disconnect(
            str(payload["deviceKey"]),
            AutomationOperationCorrelation(request_id=request.request_id),
        )
        serialized = _device_payload(device)
        return OutgoingMessages(
            messages=[
                self._success_response(request, {"device": serialized}),
                self._event(
                    "device.stateChanged",
                    {"device": serialized, "reason": "disconnected"},
                ),
            ]
        )

    def _handle_device_interact(
        self,
        request: RequestEnvelopeV1,
        payload: dict[str, Any],
    ) -> OutgoingMessages:
        if self._application.is_run_active:
            raise RuntimeRequestFailure(
                RuntimeErrorCode.RUN_ALREADY_ACTIVE,
                "Direct device control is unavailable while a graph run is active.",
            )
        service = self._require_device_control_service()
        device_key = str(payload["deviceKey"])
        interaction = cast("dict[str, Any]", payload["interaction"])
        kind = str(interaction["kind"])
        correlation = AutomationOperationCorrelation(request_id=request.request_id)
        if kind == "click":
            service.control_click(
                device_key,
                _runtime_point(interaction["point"]),
                correlation,
            )
        elif kind == "longPress":
            service.control_long_press(
                device_key,
                _runtime_point(interaction["point"]),
                int(interaction["durationMilliseconds"]),
                correlation,
            )
        elif kind == "swipe":
            service.control_swipe(
                device_key,
                _runtime_point(interaction["start"]),
                _runtime_point(interaction["end"]),
                int(interaction["durationMilliseconds"]),
                correlation,
            )
        elif kind == "key":
            service.control_key(
                device_key,
                DeviceControlKey(str(interaction["key"])),
                correlation,
            )
        else:
            raise RuntimeError("A validated device interaction has no handler.")
        return OutgoingMessages(
            messages=[
                self._success_response(
                    request,
                    {"completed": True, "kind": kind},
                )
            ]
        )

    def _handle_preview_capture(
        self,
        request: RequestEnvelopeV1,
        payload: dict[str, Any],
    ) -> OutgoingMessages:
        service = self._require_preview_service()
        preview = service.capture_preview(
            str(payload["deviceKey"]),
            int(payload["maximumWidth"]),
            int(payload["maximumHeight"]),
            AutomationOperationCorrelation(request_id=request.request_id),
        )
        return OutgoingMessages(
            messages=[
                self._success_response(
                    request,
                    {
                        "preview": {
                            "previewToken": preview.preview_token,
                            "mediaType": preview.media_type,
                            "width": preview.width,
                            "height": preview.height,
                            "sourceWidth": preview.source_width,
                            "sourceHeight": preview.source_height,
                            "sourceCoordinateSpaceId": (
                                preview.source_coordinate_space_id
                            ),
                            "sourceGeneration": preview.source_generation,
                            "byteLength": preview.byte_length,
                            "expiresInMilliseconds": (preview.expires_in_milliseconds),
                        }
                    },
                )
            ]
        )

    def _handle_capture_prepare(
        self,
        request: RequestEnvelopeV1,
        payload: dict[str, Any],
    ) -> OutgoingMessages:
        service = self._require_preview_service()
        raw_region = payload.get("region")
        region = (
            CaptureRegion(
                x=int(raw_region["x"]),
                y=int(raw_region["y"]),
                width=int(raw_region["width"]),
                height=int(raw_region["height"]),
                coordinate_space_id=str(raw_region["coordinateSpaceId"]),
                source_generation=int(raw_region["sourceGeneration"]),
            )
            if raw_region is not None
            else None
        )
        capture = service.prepare_capture(str(payload["previewToken"]), region)
        return OutgoingMessages(
            messages=[
                self._success_response(
                    request,
                    {
                        "capture": {
                            "captureToken": capture.capture_token,
                            "mediaType": capture.media_type,
                            "width": capture.width,
                            "height": capture.height,
                            "coordinateSpaceId": capture.coordinate_space_id,
                            "sourceKind": capture.source_kind.value,
                            "byteLength": capture.byte_length,
                            "expiresInMilliseconds": (capture.expires_in_milliseconds),
                        }
                    },
                )
            ]
        )

    def _handle_capture_release(
        self,
        request: RequestEnvelopeV1,
        payload: dict[str, Any],
    ) -> OutgoingMessages:
        service = self._require_preview_service()
        released = service.release_capture(str(payload["captureToken"]))
        return OutgoingMessages(
            messages=[self._success_response(request, {"released": released})]
        )

    def _handle_preview_release(
        self,
        request: RequestEnvelopeV1,
        payload: dict[str, Any],
    ) -> OutgoingMessages:
        service = self._require_preview_service()
        released = service.release_preview(str(payload["previewToken"]))
        return OutgoingMessages(
            messages=[self._success_response(request, {"released": released})]
        )

    def _require_device_service(self) -> DeviceManagementService:
        if self._device_service is None:
            raise DeviceServiceError(
                code=DeviceServiceErrorCode.BACKEND_UNAVAILABLE,
                technical_detail=(
                    "Device management is unavailable in this Sidecar generation."
                ),
                retryable=False,
            )
        return self._device_service

    def _require_preview_service(self) -> DevicePreviewService:
        if self._preview_service is None:
            raise DeviceServiceError(
                DeviceServiceErrorCode.PREVIEW_UNAVAILABLE,
                "The device preview service is not available in this runtime.",
                retryable=False,
            )
        return self._preview_service

    def _require_device_control_service(self) -> DeviceControlService:
        if self._device_control_service is None:
            raise DeviceServiceError(
                DeviceServiceErrorCode.BACKEND_UNAVAILABLE,
                "Direct device control is unavailable in this Sidecar generation.",
                retryable=False,
            )
        return self._device_control_service

    def _handle_graph_validate(
        self,
        request: RequestEnvelopeV1,
        payload: dict[str, Any],
    ) -> OutgoingMessages:
        return OutgoingMessages(
            messages=[
                self._success_response(
                    request,
                    self._application.validate_document(payload["document"]),
                )
            ]
        )

    def _handle_run_start(
        self,
        request: RequestEnvelopeV1,
        payload: dict[str, Any],
    ) -> OutgoingMessages:
        device_key = payload.get("deviceKey")
        project_assets: dict[str, RuntimeImageReference] = {}
        bindings = payload.get("assetBindings", [])
        if bindings:
            service = self._require_preview_service()
            for binding in bindings:
                asset_id = str(binding["assetId"])
                if asset_id in project_assets:
                    raise RuntimeRequestFailure(
                        RuntimeErrorCode.GRAPH_DOCUMENT_INVALID,
                        "The run request contains a duplicate project asset binding.",
                    )
                project_assets[asset_id] = service.prepare_project_asset(
                    str(binding["assetToken"]),
                    str(binding["contentHash"]),
                    int(binding["byteLength"]),
                    int(binding["width"]),
                    int(binding["height"]),
                    str(binding["coordinateSpaceId"]),
                )
        prepared = self._application.prepare_run(
            payload["document"],
            UUID(str(payload["graphId"])),
            str(device_key) if device_key is not None else None,
            request.request_id,
            project_assets,
            initial_persistent_variables=payload.get("initialPersistentVariables"),
        )
        result = {
            "accepted": True,
            "runId": str(prepared.run_id),
            "graphId": str(prepared.graph_id),
            "registryVersion": prepared.registry_version,
        }
        running = self._event(
            "run.stateChanged",
            {"state": "running", "graphId": str(prepared.graph_id)},
            run_id=prepared.run_id,
        )
        return OutgoingMessages(
            messages=[self._success_response(request, result), running],
            after_messages_queued=(prepared.launch,),
        )

    def _handle_run_cancel(
        self,
        request: RequestEnvelopeV1,
        payload: dict[str, Any],
    ) -> OutgoingMessages:
        prepared = self._application.prepare_cancellation(UUID(str(payload["runId"])))
        result = {
            "accepted": True,
            "runId": str(prepared.run_id),
            "alreadyRequested": prepared.already_requested,
            "state": prepared.state,
        }
        messages: list[IpcMessageV1] = [self._success_response(request, result)]
        callbacks: tuple[Callable[[], None], ...] = ()
        if prepared.signal is not None:
            messages.append(
                self._event(
                    "run.stateChanged",
                    {
                        "state": "cancelling",
                        "graphId": str(prepared.graph_id),
                    },
                    run_id=prepared.run_id,
                )
            )
            callbacks = (prepared.signal,)
        return OutgoingMessages(
            messages=messages,
            after_messages_queued=callbacks,
        )

    def _reject_unparsable_body(self, body: str) -> OutgoingMessages:
        """Answers an unparsable frame, correlating it when a request id is recoverable.

        A malformed frame may still carry a usable request identifier. Correlating the
        failure lets the desktop fail one pending request instead of the connection.
        """
        request_id = _recover_request_id(body)
        if request_id is None:
            return OutgoingMessages(
                messages=[
                    self._protocol_error_event(
                        RuntimeErrorCode.INVALID_MESSAGE,
                        "The frame body is not a valid version-one protocol message.",
                    )
                ]
            )
        error = build_protocol_error(
            RuntimeErrorCode.INVALID_MESSAGE,
            "The frame body is not a valid version-one protocol message.",
            request_id=request_id,
        )
        return OutgoingMessages(
            messages=[
                ErrorResponseEnvelopeV1.model_validate(
                    {
                        "protocolVersion": PROTOCOL_VERSION,
                        "messageKind": "response",
                        "messageType": "system.protocolError",
                        "requestId": request_id,
                        "error": dump_model(error),
                    }
                )
            ]
        )

    def _success_response(
        self, request: RequestEnvelopeV1, result: dict[str, Any]
    ) -> SuccessResponseEnvelopeV1:
        family = REQUEST_FAMILIES[request.message_type]
        if not is_valid_payload(family.result, result):
            raise RuntimeError("Runtime response violates its canonical definition.")
        return SuccessResponseEnvelopeV1.model_validate(
            {
                "protocolVersion": PROTOCOL_VERSION,
                "messageKind": "response",
                "messageType": request.message_type,
                "requestId": str(request.request_id),
                "result": result,
            }
        )

    def _error_response(
        self,
        request: RequestEnvelopeV1,
        code: RuntimeErrorCode,
        technical_detail: str,
        *,
        parameters: dict[str, object] | None = None,
    ) -> ErrorResponseEnvelopeV1:
        error = build_protocol_error(
            code,
            technical_detail,
            parameters=parameters,
            request_id=str(request.request_id),
        )
        return ErrorResponseEnvelopeV1.model_validate(
            {
                "protocolVersion": PROTOCOL_VERSION,
                "messageKind": "response",
                "messageType": request.message_type,
                "requestId": str(request.request_id),
                "error": dump_model(error),
            }
        )

    def _protocol_error_event(
        self, code: RuntimeErrorCode, technical_detail: str
    ) -> EventEnvelopeV1:
        error = build_protocol_error(code, technical_detail)
        return self._event(
            "system.protocolError",
            {"error": dump_model(error)},
        )

    def _application_event(self, event: RuntimeApplicationEvent) -> None:
        message = self._event(
            event.message_type,
            dict(event.payload),
            run_id=event.run_id,
            node_id=event.node_id,
        )
        with self._sink_lock:
            sink = self._async_message_sink
            if sink is None:
                self._pending_async_messages.append(message)
                return
        sink(message)

    def _automation_runtime_event(self, event: AutomationRuntimeEvent) -> None:
        if isinstance(event, AutomationOperationEvent):
            correlation = event.correlation
            payload: dict[str, object] = {
                "source": event.source.value,
                "state": event.state.value,
                "operationKind": event.operation_kind.value,
                "backendOperationId": str(event.backend_operation_id),
                "backendGeneration": event.backend_generation,
                "callbackSequence": event.callback_sequence,
                "observedAtMilliseconds": event.observed_at_milliseconds,
            }
            if correlation.request_id is not None:
                payload["requestId"] = str(correlation.request_id)
            if correlation.activation_id is not None:
                payload["activationId"] = correlation.activation_id
            message = self._event(
                "automation.operationStateChanged",
                payload,
                run_id=correlation.run_id,
                node_id=correlation.node_id,
            )
        else:
            payload = {
                "code": event.code.value,
                "count": event.count,
                "backendGeneration": event.backend_generation,
            }
            if event.latest_callback_sequence is not None:
                payload["latestCallbackSequence"] = event.latest_callback_sequence
            message = self._event("automation.callbackDiagnostic", payload)
        with self._sink_lock:
            sink = self._async_message_sink
            if sink is None:
                self._pending_async_messages.append(message)
                return
        sink(message)

    def _event(
        self,
        message_type: str,
        payload: dict[str, Any],
        *,
        run_id: UUID | None = None,
        node_id: UUID | None = None,
    ) -> EventEnvelopeV1:
        definition = EVENT_FAMILIES.get(message_type)
        if definition is not None and not is_valid_payload(definition, payload):
            raise RuntimeError("Runtime event violates its canonical definition.")
        with self._event_lock:
            self._event_sequence += 1
            sequence = self._event_sequence
        return EventEnvelopeV1.model_validate(
            {
                "protocolVersion": PROTOCOL_VERSION,
                "messageKind": "event",
                "messageType": message_type,
                "eventId": str(self._event_id_factory()),
                "sequence": sequence,
                **({"runId": str(run_id)} if run_id is not None else {}),
                **({"nodeId": str(node_id)} if node_id is not None else {}),
                "payload": payload,
            }
        )


def _device_payload(device: AutomationDeviceDescriptor) -> dict[str, str]:
    return {
        "deviceKey": device.device_key,
        "displayName": device.display_name,
        "controllerFamily": device.controller_family,
        "state": device.state.value,
    }


def _runtime_point(value: object) -> RuntimePoint:
    point = cast("dict[str, Any]", value)
    return RuntimePoint(
        x=int(point["x"]),
        y=int(point["y"]),
        coordinate_space_id=str(point["coordinateSpaceId"]),
        source_generation=int(point["sourceGeneration"]),
    )


def _recover_request_id(body: str) -> str | None:
    """Extracts a well-formed request identifier from an otherwise invalid body."""
    try:
        decoded: object = json.loads(body)
    except ValueError:
        return None
    if not isinstance(decoded, dict):
        return None
    candidate = cast("dict[object, object]", decoded).get("requestId")
    if not isinstance(candidate, str):
        return None
    try:
        return str(UUID(candidate))
    except ValueError:
        return None


def encode_outgoing(message: IpcMessageV1) -> str:
    """Serializes one outgoing message to canonical wire text."""
    return serialize_message(message)
