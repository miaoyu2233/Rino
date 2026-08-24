# Generated from contracts/ipc/rino-ipc-v1.schema.json. Do not edit directly.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, RootModel


class JsonValue1(RootModel[str]):
    root: Annotated[
        str,
        Field(
            description="Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.",
            max_length=65536,
            title="JsonValue",
        ),
    ]


class SemanticVersionV1(RootModel[str]):
    root: Annotated[
        str,
        Field(
            max_length=64,
            pattern="^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]{1,32})?$",
            title="SemanticVersionV1",
        ),
    ]


class ProtocolVersionRangeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    minimum: Annotated[int, Field(ge=1, le=1000)]
    maximum: Annotated[int, Field(ge=1, le=1000)]


class ErrorCauseEntryV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Annotated[str, Field(pattern="^[A-Z][A-Z0-9_]{2,63}$")]
    technical_detail: Annotated[
        str, Field(alias="technicalDetail", max_length=1024, min_length=1)
    ]


class Retryability(StrEnum):
    never = "never"
    safe = "safe"
    explicit_confirmation = "explicitConfirmation"


class EmptyPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )


class HandshakeRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    desktop_version: Annotated[SemanticVersionV1, Field(alias="desktopVersion")]
    protocol_version_range: Annotated[
        ProtocolVersionRangeV1, Field(alias="protocolVersionRange")
    ]
    maximum_frame_bytes: Annotated[
        int, Field(alias="maximumFrameBytes", ge=4096, le=16777216)
    ]


class State(StrEnum):
    available = "available"
    unavailable = "unavailable"


class MaaRuntimeStateV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    state: State
    binding_version: Annotated[
        SemanticVersionV1 | None, Field(alias="bindingVersion")
    ] = None
    native_version: Annotated[
        SemanticVersionV1 | None, Field(alias="nativeVersion")
    ] = None


class DeviceKeyV1(RootModel[str]):
    root: Annotated[
        str, Field(max_length=256, min_length=1, pattern=".*\\S.*", title="DeviceKeyV1")
    ]


class DeviceStateV1(StrEnum):
    available = "available"
    connected = "connected"
    connection_lost = "connectionLost"


class ControllerFamily(StrEnum):
    adb = "adb"


class DeviceDescriptorV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    device_key: Annotated[DeviceKeyV1, Field(alias="deviceKey")]
    display_name: Annotated[
        str, Field(alias="displayName", max_length=128, min_length=1)
    ]
    controller_family: Annotated[ControllerFamily, Field(alias="controllerFamily")]
    state: DeviceStateV1


class DeviceListResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    devices: Annotated[list[DeviceDescriptorV1], Field(max_length=64)]


class DeviceConnectRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    device_key: Annotated[DeviceKeyV1, Field(alias="deviceKey")]


class DeviceConnectResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    device: DeviceDescriptorV1


class DeviceDisconnectRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    device_key: Annotated[DeviceKeyV1, Field(alias="deviceKey")]


class DeviceDisconnectResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    device: DeviceDescriptorV1


class DeviceInteractionPointV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    x: Annotated[int, Field(ge=0, le=16383)]
    y: Annotated[int, Field(ge=0, le=16383)]
    coordinate_space_id: Annotated[
        str, Field(alias="coordinateSpaceId", max_length=128, min_length=1)
    ]
    source_generation: Annotated[
        int, Field(alias="sourceGeneration", ge=1, le=9007199254740991)
    ]


class DeviceClickInteractionV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["click"]
    point: DeviceInteractionPointV1


class DeviceLongPressInteractionV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["longPress"]
    point: DeviceInteractionPointV1
    duration_milliseconds: Annotated[
        int, Field(alias="durationMilliseconds", ge=500, le=5000)
    ]


class DeviceSwipeInteractionV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["swipe"]
    start: DeviceInteractionPointV1
    end: DeviceInteractionPointV1
    duration_milliseconds: Annotated[
        int, Field(alias="durationMilliseconds", ge=50, le=5000)
    ]


class DeviceKeyInteractionV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Literal["key"]
    key: Literal["back"]


class DeviceInteractionV1(
    RootModel[
        Union[
            DeviceClickInteractionV1,
            DeviceLongPressInteractionV1,
            DeviceSwipeInteractionV1,
            DeviceKeyInteractionV1,
        ]
    ]
):
    root: Annotated[
        DeviceClickInteractionV1
        | DeviceLongPressInteractionV1
        | DeviceSwipeInteractionV1
        | DeviceKeyInteractionV1,
        Field(title="DeviceInteractionV1"),
    ]


class DeviceInteractRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    device_key: Annotated[DeviceKeyV1, Field(alias="deviceKey")]
    interaction: DeviceInteractionV1


class Kind(StrEnum):
    click = "click"
    long_press = "longPress"
    swipe = "swipe"
    key = "key"


class DeviceInteractResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    completed: Literal[True]
    kind: Kind


class PreviewTokenV1(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-f0-9]{32}$", title="PreviewTokenV1")]


class PreviewCaptureRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    device_key: Annotated[DeviceKeyV1, Field(alias="deviceKey")]
    maximum_width: Annotated[int, Field(alias="maximumWidth", ge=160, le=1920)]
    maximum_height: Annotated[int, Field(alias="maximumHeight", ge=120, le=1920)]


class PreviewArtifactDescriptorV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    preview_token: Annotated[PreviewTokenV1, Field(alias="previewToken")]
    media_type: Annotated[Literal["image/png"], Field(alias="mediaType")]
    width: Annotated[int, Field(ge=1, le=1920)]
    height: Annotated[int, Field(ge=1, le=1080)]
    source_width: Annotated[int, Field(alias="sourceWidth", ge=1, le=16384)]
    source_height: Annotated[int, Field(alias="sourceHeight", ge=1, le=16384)]
    source_coordinate_space_id: Annotated[
        str, Field(alias="sourceCoordinateSpaceId", max_length=128, min_length=1)
    ]
    source_generation: Annotated[
        int, Field(alias="sourceGeneration", ge=1, le=9007199254740991)
    ]
    byte_length: Annotated[int, Field(alias="byteLength", ge=1, le=3145728)]
    expires_in_milliseconds: Annotated[
        int, Field(alias="expiresInMilliseconds", ge=1000, le=60000)
    ]


class PreviewCaptureResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    preview: PreviewArtifactDescriptorV1


class PreviewReleaseRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    preview_token: Annotated[PreviewTokenV1, Field(alias="previewToken")]


class PreviewReleaseResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    released: bool


class CaptureTokenV1(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-f0-9]{32}$", title="CaptureTokenV1")]


class CaptureRegionV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    x: Annotated[int, Field(ge=0, le=16383)]
    y: Annotated[int, Field(ge=0, le=16383)]
    width: Annotated[int, Field(ge=1, le=16384)]
    height: Annotated[int, Field(ge=1, le=16384)]
    coordinate_space_id: Annotated[
        str, Field(alias="coordinateSpaceId", max_length=128, min_length=1)
    ]
    source_generation: Annotated[
        int, Field(alias="sourceGeneration", ge=1, le=9007199254740991)
    ]


class CapturePrepareRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    preview_token: Annotated[PreviewTokenV1, Field(alias="previewToken")]
    region: CaptureRegionV1 | None = None


class SourceKind(StrEnum):
    device_capture = "deviceCapture"
    region_capture = "regionCapture"


class CaptureArtifactDescriptorV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    capture_token: Annotated[CaptureTokenV1, Field(alias="captureToken")]
    media_type: Annotated[Literal["image/png"], Field(alias="mediaType")]
    width: Annotated[int, Field(ge=1, le=16384)]
    height: Annotated[int, Field(ge=1, le=16384)]
    coordinate_space_id: Annotated[
        str, Field(alias="coordinateSpaceId", max_length=128, min_length=1)
    ]
    source_kind: Annotated[SourceKind, Field(alias="sourceKind")]
    byte_length: Annotated[int, Field(alias="byteLength", ge=1, le=67108864)]
    expires_in_milliseconds: Annotated[
        int, Field(alias="expiresInMilliseconds", ge=1000, le=120000)
    ]


class CapturePrepareResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    capture: CaptureArtifactDescriptorV1


class CaptureReleaseRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    capture_token: Annotated[CaptureTokenV1, Field(alias="captureToken")]


class CaptureReleaseResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    released: bool


class RuntimeMode(StrEnum):
    source = "source"
    frozen = "frozen"


class FeatureFlag(RootModel[str]):
    root: Annotated[str, Field(max_length=64)]


class HandshakeResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    runtime_version: Annotated[SemanticVersionV1, Field(alias="runtimeVersion")]
    protocol_version: Annotated[Literal[1], Field(alias="protocolVersion")]
    maximum_frame_bytes: Annotated[
        int, Field(alias="maximumFrameBytes", ge=4096, le=16777216)
    ]
    runtime_mode: Annotated[RuntimeMode, Field(alias="runtimeMode")]
    graph_schema_version_range: Annotated[
        ProtocolVersionRangeV1 | None, Field(alias="graphSchemaVersionRange")
    ] = None
    registry_version: Annotated[
        str | None, Field(alias="registryVersion", pattern="^[a-f0-9]{64}$")
    ] = None
    maa_runtime: Annotated[MaaRuntimeStateV1 | None, Field(alias="maaRuntime")] = None
    feature_flags: Annotated[
        list[FeatureFlag] | None, Field(alias="featureFlags", max_length=64)
    ] = None


class State1(StrEnum):
    ok = "ok"
    degraded = "degraded"


class ShutdownResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    accepted: Literal[True]


class RunProjectAssetBindingV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    asset_id: Annotated[UUID, Field(alias="assetId")]
    asset_token: Annotated[str, Field(alias="assetToken", pattern="^[a-f0-9]{32}$")]
    content_hash: Annotated[str, Field(alias="contentHash", pattern="^[a-f0-9]{64}$")]
    byte_length: Annotated[int, Field(alias="byteLength", ge=1, le=67108864)]
    width: Annotated[int, Field(ge=1, le=16384)]
    height: Annotated[int, Field(ge=1, le=16384)]
    coordinate_space_id: Annotated[
        str, Field(alias="coordinateSpaceId", max_length=128, min_length=1)
    ]


class PersistentBoolVariableV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    variable_id: Annotated[UUID, Field(alias="variableId")]
    value_kind: Annotated[Literal["bool"], Field(alias="valueKind")]
    value: bool


class PersistentNumberVariableV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    variable_id: Annotated[UUID, Field(alias="variableId")]
    value_kind: Annotated[Literal["number"], Field(alias="valueKind")]
    value: Annotated[float, Field(ge=-1e308, le=1e308)]


class PersistentStringVariableV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    variable_id: Annotated[UUID, Field(alias="variableId")]
    value_kind: Annotated[Literal["string"], Field(alias="valueKind")]
    value: Annotated[str, Field(max_length=4096)]


class PersistentPointValueV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    x: Annotated[int, Field(ge=-2147483648, le=2147483647)]
    y: Annotated[int, Field(ge=-2147483648, le=2147483647)]


class PersistentRectValueV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    x: Annotated[int, Field(ge=-2147483648, le=2147483647)]
    y: Annotated[int, Field(ge=-2147483648, le=2147483647)]
    width: Annotated[int, Field(ge=1, le=2147483647)]
    height: Annotated[int, Field(ge=1, le=2147483647)]


class PersistentPointVariableV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    variable_id: Annotated[UUID, Field(alias="variableId")]
    value_kind: Annotated[Literal["point"], Field(alias="valueKind")]
    value: PersistentPointValueV1


class PersistentRectVariableV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    variable_id: Annotated[UUID, Field(alias="variableId")]
    value_kind: Annotated[Literal["rect"], Field(alias="valueKind")]
    value: PersistentRectValueV1


class PersistentVariableValueV1(
    RootModel[
        Union[
            PersistentBoolVariableV1,
            PersistentNumberVariableV1,
            PersistentStringVariableV1,
            PersistentPointVariableV1,
            PersistentRectVariableV1,
        ]
    ]
):
    root: Annotated[
        PersistentBoolVariableV1
        | PersistentNumberVariableV1
        | PersistentStringVariableV1
        | PersistentPointVariableV1
        | PersistentRectVariableV1,
        Field(title="PersistentVariableValueV1"),
    ]


class RunStartResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    accepted: Literal[True]
    run_id: Annotated[UUID, Field(alias="runId")]
    graph_id: Annotated[UUID, Field(alias="graphId")]
    registry_version: Annotated[
        str, Field(alias="registryVersion", pattern="^[a-f0-9]{64}$")
    ]


class RunCancelRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    run_id: Annotated[UUID, Field(alias="runId")]


class State2(StrEnum):
    cancelling = "cancelling"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class RunCancelResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    accepted: Literal[True]
    run_id: Annotated[UUID, Field(alias="runId")]
    already_requested: Annotated[bool, Field(alias="alreadyRequested")]
    state: State2


class Kind1(StrEnum):
    null = "null"
    bool = "bool"
    number = "number"
    string = "string"
    point = "point"
    rect = "rect"
    image = "image"
    ocr_candidate = "ocrCandidate"
    ocr_result = "ocrResult"
    collection = "collection"


class RuntimeValueSummaryV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    port_id: Annotated[str, Field(alias="portId", max_length=64, min_length=1)]
    generation: Annotated[int, Field(ge=1, le=9007199254740991)]
    kind: Kind1
    preview: Annotated[str, Field(max_length=256)]
    truncated: bool
    item_count: Annotated[int | None, Field(alias="itemCount", ge=0, le=1000000)] = None
    width: Annotated[int | None, Field(ge=0, le=1000000)] = None
    height: Annotated[int | None, Field(ge=0, le=1000000)] = None


class RuntimeTerminalErrorV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Annotated[str, Field(pattern="^[A-Z][A-Z0-9_]{2,63}$")]
    message_key: Annotated[
        str,
        Field(
            alias="messageKey",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    node_id: Annotated[UUID | None, Field(alias="nodeId")] = None
    port_id: Annotated[
        str | None, Field(alias="portId", max_length=64, min_length=1)
    ] = None


class State3(StrEnum):
    running = "running"
    cancelling = "cancelling"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class RunStateChangedEventPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    state: State3
    graph_id: Annotated[UUID, Field(alias="graphId")]
    run_sequence: Annotated[
        int | None, Field(alias="runSequence", ge=1, le=9007199254740991)
    ] = None
    step_count: Annotated[
        int | None, Field(alias="stepCount", ge=0, le=9007199254740991)
    ] = None
    tokens_created: Annotated[
        int | None, Field(alias="tokensCreated", ge=0, le=9007199254740991)
    ] = None
    pure_cache_hits: Annotated[
        int | None, Field(alias="pureCacheHits", ge=0, le=9007199254740991)
    ] = None
    terminal_error: Annotated[
        RuntimeTerminalErrorV1 | None, Field(alias="terminalError")
    ] = None
    persistent_variable_updates: Annotated[
        list[PersistentVariableValueV1] | None,
        Field(alias="persistentVariableUpdates", max_length=128),
    ] = None


class State4(StrEnum):
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class OutputPortId(RootModel[str]):
    root: Annotated[str, Field(max_length=64, min_length=1)]


class NodeStateChangedEventPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    state: State4
    run_sequence: Annotated[int, Field(alias="runSequence", ge=1, le=9007199254740991)]
    token_id: Annotated[int, Field(alias="tokenId", ge=1, le=9007199254740991)]
    activation_id: Annotated[
        int, Field(alias="activationId", ge=1, le=9007199254740991)
    ]
    output_port_ids: Annotated[
        list[OutputPortId] | None, Field(alias="outputPortIds", max_length=64)
    ] = None
    value_summaries: Annotated[
        list[RuntimeValueSummaryV1] | None, Field(alias="valueSummaries", max_length=64)
    ] = None
    error_code: Annotated[
        str | None, Field(alias="errorCode", pattern="^[A-Z][A-Z0-9_]{2,63}$")
    ] = None


class EdgeTraversedEventPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    edge_id: Annotated[UUID, Field(alias="edgeId")]
    run_sequence: Annotated[int, Field(alias="runSequence", ge=1, le=9007199254740991)]
    token_id: Annotated[int, Field(alias="tokenId", ge=1, le=9007199254740991)]
    output_port_id: Annotated[
        str, Field(alias="outputPortId", max_length=64, min_length=1)
    ]


class Level(StrEnum):
    debug = "debug"
    info = "info"
    warning = "warning"
    error = "error"


class RuntimeLogCreatedEventPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    log_sequence: Annotated[int, Field(alias="logSequence", ge=1, le=9007199254740991)]
    activation_id: Annotated[
        int, Field(alias="activationId", ge=1, le=9007199254740991)
    ]
    level: Level
    message: Annotated[str, Field(max_length=4096)]


class Source(StrEnum):
    controller = "controller"
    tasker = "tasker"


class State5(StrEnum):
    starting = "starting"
    succeeded = "succeeded"
    failed = "failed"


class OperationKind(StrEnum):
    device_connect = "deviceConnect"
    device_disconnect = "deviceDisconnect"
    screen_capture = "screenCapture"
    ocr = "ocr"
    ocr_stop = "ocrStop"
    click = "click"
    key_press = "keyPress"
    app_start = "appStart"


class AutomationOperationStateChangedEventPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    source: Source
    state: State5
    operation_kind: Annotated[OperationKind, Field(alias="operationKind")]
    backend_operation_id: Annotated[
        str, Field(alias="backendOperationId", pattern="^[1-9][0-9]{0,18}$")
    ]
    backend_generation: Annotated[
        int, Field(alias="backendGeneration", ge=1, le=9007199254740991)
    ]
    callback_sequence: Annotated[
        int, Field(alias="callbackSequence", ge=1, le=9007199254740991)
    ]
    observed_at_milliseconds: Annotated[
        int, Field(alias="observedAtMilliseconds", ge=0, le=9007199254740991)
    ]
    request_id: Annotated[UUID | None, Field(alias="requestId")] = None
    activation_id: Annotated[
        int | None, Field(alias="activationId", ge=1, le=9007199254740991)
    ] = None


class Code(StrEnum):
    automation_callback_malformed = "AUTOMATION_CALLBACK_MALFORMED"
    automation_callback_unsupported = "AUTOMATION_CALLBACK_UNSUPPORTED"
    automation_callback_queue_overflow = "AUTOMATION_CALLBACK_QUEUE_OVERFLOW"
    automation_callback_correlation_overflow = (
        "AUTOMATION_CALLBACK_CORRELATION_OVERFLOW"
    )
    automation_callback_operation_unmatched = "AUTOMATION_CALLBACK_OPERATION_UNMATCHED"
    automation_callback_generation_stale = "AUTOMATION_CALLBACK_GENERATION_STALE"
    automation_callback_event_sink_failed = "AUTOMATION_CALLBACK_EVENT_SINK_FAILED"


class AutomationCallbackDiagnosticEventPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Code
    count: Annotated[int, Field(ge=1, le=9007199254740991)]
    backend_generation: Annotated[
        int, Field(alias="backendGeneration", ge=0, le=9007199254740991)
    ]
    latest_callback_sequence: Annotated[
        int | None, Field(alias="latestCallbackSequence", ge=1, le=9007199254740991)
    ] = None


class Reason(StrEnum):
    connected = "connected"
    disconnected = "disconnected"
    connection_lost = "connectionLost"


class DeviceStateChangedEventPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    device: DeviceDescriptorV1
    reason: Reason


class SystemReadyEventPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    state: Literal["ready"]


class State6(StrEnum):
    ok = "ok"
    degraded = "degraded"


class SystemHealthChangedEventPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    state: State6


class RinoIpcArtifactCatalog(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    automation_callback_diagnostic_event_payload_v1: Annotated[
        AutomationCallbackDiagnosticEventPayloadV1 | None,
        Field(alias="automationCallbackDiagnosticEventPayloadV1"),
    ] = None
    automation_operation_state_changed_event_payload_v1: Annotated[
        AutomationOperationStateChangedEventPayloadV1 | None,
        Field(alias="automationOperationStateChangedEventPayloadV1"),
    ] = None
    capture_artifact_descriptor_v1: Annotated[
        CaptureArtifactDescriptorV1 | None, Field(alias="captureArtifactDescriptorV1")
    ] = None
    capture_prepare_request_payload_v1: Annotated[
        CapturePrepareRequestPayloadV1 | None,
        Field(alias="capturePrepareRequestPayloadV1"),
    ] = None
    capture_prepare_result_v1: Annotated[
        CapturePrepareResultV1 | None, Field(alias="capturePrepareResultV1")
    ] = None
    capture_region_v1: Annotated[
        CaptureRegionV1 | None, Field(alias="captureRegionV1")
    ] = None
    capture_release_request_payload_v1: Annotated[
        CaptureReleaseRequestPayloadV1 | None,
        Field(alias="captureReleaseRequestPayloadV1"),
    ] = None
    capture_release_result_v1: Annotated[
        CaptureReleaseResultV1 | None, Field(alias="captureReleaseResultV1")
    ] = None
    capture_token_v1: Annotated[
        CaptureTokenV1 | None, Field(alias="captureTokenV1")
    ] = None
    device_click_interaction_v1: Annotated[
        DeviceClickInteractionV1 | None, Field(alias="deviceClickInteractionV1")
    ] = None
    device_connect_request_payload_v1: Annotated[
        DeviceConnectRequestPayloadV1 | None,
        Field(alias="deviceConnectRequestPayloadV1"),
    ] = None
    device_connect_result_v1: Annotated[
        DeviceConnectResultV1 | None, Field(alias="deviceConnectResultV1")
    ] = None
    device_descriptor_v1: Annotated[
        DeviceDescriptorV1 | None, Field(alias="deviceDescriptorV1")
    ] = None
    device_disconnect_request_payload_v1: Annotated[
        DeviceDisconnectRequestPayloadV1 | None,
        Field(alias="deviceDisconnectRequestPayloadV1"),
    ] = None
    device_disconnect_result_v1: Annotated[
        DeviceDisconnectResultV1 | None, Field(alias="deviceDisconnectResultV1")
    ] = None
    device_interact_request_payload_v1: Annotated[
        DeviceInteractRequestPayloadV1 | None,
        Field(alias="deviceInteractRequestPayloadV1"),
    ] = None
    device_interact_result_v1: Annotated[
        DeviceInteractResultV1 | None, Field(alias="deviceInteractResultV1")
    ] = None
    device_interaction_point_v1: Annotated[
        DeviceInteractionPointV1 | None, Field(alias="deviceInteractionPointV1")
    ] = None
    device_interaction_v1: Annotated[
        DeviceInteractionV1 | None, Field(alias="deviceInteractionV1")
    ] = None
    device_key_interaction_v1: Annotated[
        DeviceKeyInteractionV1 | None, Field(alias="deviceKeyInteractionV1")
    ] = None
    device_key_v1: Annotated[DeviceKeyV1 | None, Field(alias="deviceKeyV1")] = None
    device_list_result_v1: Annotated[
        DeviceListResultV1 | None, Field(alias="deviceListResultV1")
    ] = None
    device_long_press_interaction_v1: Annotated[
        DeviceLongPressInteractionV1 | None, Field(alias="deviceLongPressInteractionV1")
    ] = None
    device_state_changed_event_payload_v1: Annotated[
        DeviceStateChangedEventPayloadV1 | None,
        Field(alias="deviceStateChangedEventPayloadV1"),
    ] = None
    device_state_v1: Annotated[DeviceStateV1 | None, Field(alias="deviceStateV1")] = (
        None
    )
    device_swipe_interaction_v1: Annotated[
        DeviceSwipeInteractionV1 | None, Field(alias="deviceSwipeInteractionV1")
    ] = None
    edge_traversed_event_payload_v1: Annotated[
        EdgeTraversedEventPayloadV1 | None, Field(alias="edgeTraversedEventPayloadV1")
    ] = None
    empty_payload_v1: Annotated[
        EmptyPayloadV1 | None, Field(alias="emptyPayloadV1")
    ] = None
    error_cause_entry_v1: Annotated[
        ErrorCauseEntryV1 | None, Field(alias="errorCauseEntryV1")
    ] = None
    error_response_envelope_v1: Annotated[
        ErrorResponseEnvelopeV1 | None, Field(alias="errorResponseEnvelopeV1")
    ] = None
    event_envelope_v1: Annotated[
        EventEnvelopeV1 | None, Field(alias="eventEnvelopeV1")
    ] = None
    graph_validate_request_payload_v1: Annotated[
        GraphValidateRequestPayloadV1 | None,
        Field(alias="graphValidateRequestPayloadV1"),
    ] = None
    graph_validate_result_v1: Annotated[
        GraphValidateResultV1 | None, Field(alias="graphValidateResultV1")
    ] = None
    handshake_request_payload_v1: Annotated[
        HandshakeRequestPayloadV1 | None, Field(alias="handshakeRequestPayloadV1")
    ] = None
    handshake_result_v1: Annotated[
        HandshakeResultV1 | None, Field(alias="handshakeResultV1")
    ] = None
    health_result_v1: Annotated[
        HealthResultV1 | None, Field(alias="healthResultV1")
    ] = None
    json_object: Annotated[JsonObject | None, Field(alias="jsonObject")] = None
    json_value: Annotated[JsonValue | None, Field(alias="jsonValue")] = None
    maa_runtime_state_v1: Annotated[
        MaaRuntimeStateV1 | None, Field(alias="maaRuntimeStateV1")
    ] = None
    node_state_changed_event_payload_v1: Annotated[
        NodeStateChangedEventPayloadV1 | None,
        Field(alias="nodeStateChangedEventPayloadV1"),
    ] = None
    persistent_bool_variable_v1: Annotated[
        PersistentBoolVariableV1 | None, Field(alias="persistentBoolVariableV1")
    ] = None
    persistent_number_variable_v1: Annotated[
        PersistentNumberVariableV1 | None, Field(alias="persistentNumberVariableV1")
    ] = None
    persistent_point_value_v1: Annotated[
        PersistentPointValueV1 | None, Field(alias="persistentPointValueV1")
    ] = None
    persistent_point_variable_v1: Annotated[
        PersistentPointVariableV1 | None, Field(alias="persistentPointVariableV1")
    ] = None
    persistent_rect_value_v1: Annotated[
        PersistentRectValueV1 | None, Field(alias="persistentRectValueV1")
    ] = None
    persistent_rect_variable_v1: Annotated[
        PersistentRectVariableV1 | None, Field(alias="persistentRectVariableV1")
    ] = None
    persistent_string_variable_v1: Annotated[
        PersistentStringVariableV1 | None, Field(alias="persistentStringVariableV1")
    ] = None
    persistent_variable_value_v1: Annotated[
        PersistentVariableValueV1 | None, Field(alias="persistentVariableValueV1")
    ] = None
    preview_artifact_descriptor_v1: Annotated[
        PreviewArtifactDescriptorV1 | None, Field(alias="previewArtifactDescriptorV1")
    ] = None
    preview_capture_request_payload_v1: Annotated[
        PreviewCaptureRequestPayloadV1 | None,
        Field(alias="previewCaptureRequestPayloadV1"),
    ] = None
    preview_capture_result_v1: Annotated[
        PreviewCaptureResultV1 | None, Field(alias="previewCaptureResultV1")
    ] = None
    preview_release_request_payload_v1: Annotated[
        PreviewReleaseRequestPayloadV1 | None,
        Field(alias="previewReleaseRequestPayloadV1"),
    ] = None
    preview_release_result_v1: Annotated[
        PreviewReleaseResultV1 | None, Field(alias="previewReleaseResultV1")
    ] = None
    preview_token_v1: Annotated[
        PreviewTokenV1 | None, Field(alias="previewTokenV1")
    ] = None
    protocol_error_v1: Annotated[
        ProtocolErrorV1 | None, Field(alias="protocolErrorV1")
    ] = None
    protocol_version_range_v1: Annotated[
        ProtocolVersionRangeV1 | None, Field(alias="protocolVersionRangeV1")
    ] = None
    registry_get_result_v1: Annotated[
        RegistryGetResultV1 | None, Field(alias="registryGetResultV1")
    ] = None
    request_envelope_v1: Annotated[
        RequestEnvelopeV1 | None, Field(alias="requestEnvelopeV1")
    ] = None
    run_cancel_request_payload_v1: Annotated[
        RunCancelRequestPayloadV1 | None, Field(alias="runCancelRequestPayloadV1")
    ] = None
    run_cancel_result_v1: Annotated[
        RunCancelResultV1 | None, Field(alias="runCancelResultV1")
    ] = None
    run_project_asset_binding_v1: Annotated[
        RunProjectAssetBindingV1 | None, Field(alias="runProjectAssetBindingV1")
    ] = None
    run_start_request_payload_v1: Annotated[
        RunStartRequestPayloadV1 | None, Field(alias="runStartRequestPayloadV1")
    ] = None
    run_start_result_v1: Annotated[
        RunStartResultV1 | None, Field(alias="runStartResultV1")
    ] = None
    run_state_changed_event_payload_v1: Annotated[
        RunStateChangedEventPayloadV1 | None,
        Field(alias="runStateChangedEventPayloadV1"),
    ] = None
    runtime_log_created_event_payload_v1: Annotated[
        RuntimeLogCreatedEventPayloadV1 | None,
        Field(alias="runtimeLogCreatedEventPayloadV1"),
    ] = None
    runtime_terminal_error_v1: Annotated[
        RuntimeTerminalErrorV1 | None, Field(alias="runtimeTerminalErrorV1")
    ] = None
    runtime_value_summary_v1: Annotated[
        RuntimeValueSummaryV1 | None, Field(alias="runtimeValueSummaryV1")
    ] = None
    semantic_version_v1: Annotated[
        SemanticVersionV1 | None, Field(alias="semanticVersionV1")
    ] = None
    shutdown_result_v1: Annotated[
        ShutdownResultV1 | None, Field(alias="shutdownResultV1")
    ] = None
    success_response_envelope_v1: Annotated[
        SuccessResponseEnvelopeV1 | None, Field(alias="successResponseEnvelopeV1")
    ] = None
    system_health_changed_event_payload_v1: Annotated[
        SystemHealthChangedEventPayloadV1 | None,
        Field(alias="systemHealthChangedEventPayloadV1"),
    ] = None
    system_protocol_error_event_payload_v1: Annotated[
        SystemProtocolErrorEventPayloadV1 | None,
        Field(alias="systemProtocolErrorEventPayloadV1"),
    ] = None
    system_ready_event_payload_v1: Annotated[
        SystemReadyEventPayloadV1 | None, Field(alias="systemReadyEventPayloadV1")
    ] = None
    rino_ipc_message_v1: Annotated[
        RequestEnvelopeV1
        | SuccessResponseEnvelopeV1
        | ErrorResponseEnvelopeV1
        | EventEnvelopeV1
        | None,
        Field(alias="rinoIpcMessageV1", title="RinoIpcMessageV1"),
    ] = None


class ErrorResponseEnvelopeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    protocol_version: Annotated[Literal[1], Field(alias="protocolVersion")]
    message_kind: Annotated[Literal["response"], Field(alias="messageKind")]
    message_type: Annotated[
        str,
        Field(
            alias="messageType",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    request_id: Annotated[UUID, Field(alias="requestId")]
    error: ProtocolErrorV1


class EventEnvelopeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    protocol_version: Annotated[Literal[1], Field(alias="protocolVersion")]
    message_kind: Annotated[Literal["event"], Field(alias="messageKind")]
    message_type: Annotated[
        str,
        Field(
            alias="messageType",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    event_id: Annotated[UUID, Field(alias="eventId")]
    sequence: Annotated[int, Field(ge=0, le=9007199254740991)]
    run_id: Annotated[UUID | None, Field(alias="runId")] = None
    node_id: Annotated[UUID | None, Field(alias="nodeId")] = None
    payload: JsonObject


class GraphValidateRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    document: JsonObject


class GraphValidateResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    executable: bool
    report: JsonObject


class HealthResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    state: State1
    uptime_milliseconds: Annotated[
        int, Field(alias="uptimeMilliseconds", ge=0, le=9007199254740991)
    ]
    details: JsonObject | None = None


class JsonObject(RootModel[dict[str, Optional["JsonValue"]]]):
    root: Annotated[dict[str, JsonValue | None], Field(max_length=256)]


class JsonValue(
    RootModel[Optional[Union[bool, int, float, JsonValue1, "JsonValue2", JsonObject]]]
):
    root: Annotated[
        bool | int | float | JsonValue1 | JsonValue2 | JsonObject | None,
        Field(
            description="Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.",
            title="JsonValue",
        ),
    ]


class JsonValue2(RootModel[list[JsonValue | None]]):
    root: Annotated[
        list[JsonValue | None],
        Field(
            description="Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.",
            max_length=1024,
            title="JsonValue",
        ),
    ]


class ProtocolErrorV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Annotated[str, Field(pattern="^[A-Z][A-Z0-9_]{2,63}$")]
    message_key: Annotated[
        str,
        Field(
            alias="messageKey",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    parameters: JsonObject
    technical_detail: Annotated[
        str, Field(alias="technicalDetail", max_length=4096, min_length=1)
    ]
    retryability: Retryability
    request_id: Annotated[UUID | None, Field(alias="requestId")] = None
    run_id: Annotated[UUID | None, Field(alias="runId")] = None
    node_id: Annotated[UUID | None, Field(alias="nodeId")] = None
    backend_operation_id: Annotated[
        str | None, Field(alias="backendOperationId", max_length=128)
    ] = None
    causes: Annotated[list[ErrorCauseEntryV1] | None, Field(max_length=8)] = None


class RegistryGetResultV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    registry: JsonObject


class RequestEnvelopeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    protocol_version: Annotated[Literal[1], Field(alias="protocolVersion")]
    message_kind: Annotated[Literal["request"], Field(alias="messageKind")]
    message_type: Annotated[
        str,
        Field(
            alias="messageType",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    request_id: Annotated[UUID, Field(alias="requestId")]
    payload: JsonObject


class RunStartRequestPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    document: JsonObject
    graph_id: Annotated[UUID, Field(alias="graphId")]
    asset_bindings: Annotated[
        list[RunProjectAssetBindingV1] | None,
        Field(
            alias="assetBindings",
            description="Injected by the trusted desktop boundary after resolving project asset identifiers. Frontend-supplied values are discarded.",
            max_length=32,
        ),
    ] = None
    device_key: Annotated[
        str | None,
        Field(alias="deviceKey", max_length=256, min_length=1, pattern=".*\\S.*"),
    ] = None
    initial_persistent_variables: Annotated[
        list[PersistentVariableValueV1] | None,
        Field(alias="initialPersistentVariables", max_length=128),
    ] = None


class SuccessResponseEnvelopeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    protocol_version: Annotated[Literal[1], Field(alias="protocolVersion")]
    message_kind: Annotated[Literal["response"], Field(alias="messageKind")]
    message_type: Annotated[
        str,
        Field(
            alias="messageType",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    request_id: Annotated[UUID, Field(alias="requestId")]
    result: JsonObject


class SystemProtocolErrorEventPayloadV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    error: ProtocolErrorV1


RinoIpcArtifactCatalog.model_rebuild()
ErrorResponseEnvelopeV1.model_rebuild()
EventEnvelopeV1.model_rebuild()
GraphValidateRequestPayloadV1.model_rebuild()
GraphValidateResultV1.model_rebuild()
HealthResultV1.model_rebuild()
JsonObject.model_rebuild()
JsonValue.model_rebuild()
