/* Generated from contracts/ipc/rino-ipc-v1.schema.json. Do not edit directly. */

export type CaptureTokenV1 = string;
export type PreviewTokenV1 = string;
export type DeviceKeyV1 = string;
export type DeviceStateV1 = "available" | "connected" | "connectionLost";
export type DeviceInteractionV1 =
  | DeviceClickInteractionV1
  | DeviceLongPressInteractionV1
  | DeviceSwipeInteractionV1
  | DeviceKeyInteractionV1;
/**
 * Any JSON value. Integer is listed ahead of number so generated models keep whole numbers integral instead of widening them to floating point.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type SemanticVersionV1 = string;
export type PersistentVariableValueV1 =
  | PersistentBoolVariableV1
  | PersistentNumberVariableV1
  | PersistentStringVariableV1
  | PersistentPointVariableV1
  | PersistentRectVariableV1;
export type RinoIpcMessageV1 =
  | RequestEnvelopeV1
  | SuccessResponseEnvelopeV1
  | ErrorResponseEnvelopeV1
  | EventEnvelopeV1;

/**
 * Generation-only catalog that makes every definition reachable.
 */
export interface RinoIpcArtifactCatalog {
  automationCallbackDiagnosticEventPayloadV1?: AutomationCallbackDiagnosticEventPayloadV1;
  automationOperationStateChangedEventPayloadV1?: AutomationOperationStateChangedEventPayloadV1;
  captureArtifactDescriptorV1?: CaptureArtifactDescriptorV1;
  capturePrepareRequestPayloadV1?: CapturePrepareRequestPayloadV1;
  capturePrepareResultV1?: CapturePrepareResultV1;
  captureRegionV1?: CaptureRegionV1;
  captureReleaseRequestPayloadV1?: CaptureReleaseRequestPayloadV1;
  captureReleaseResultV1?: CaptureReleaseResultV1;
  captureTokenV1?: CaptureTokenV1;
  deviceClickInteractionV1?: DeviceClickInteractionV1;
  deviceConnectRequestPayloadV1?: DeviceConnectRequestPayloadV1;
  deviceConnectResultV1?: DeviceConnectResultV1;
  deviceDescriptorV1?: DeviceDescriptorV1;
  deviceDisconnectRequestPayloadV1?: DeviceDisconnectRequestPayloadV1;
  deviceDisconnectResultV1?: DeviceDisconnectResultV1;
  deviceInteractRequestPayloadV1?: DeviceInteractRequestPayloadV1;
  deviceInteractResultV1?: DeviceInteractResultV1;
  deviceInteractionPointV1?: DeviceInteractionPointV1;
  deviceInteractionV1?: DeviceInteractionV1;
  deviceKeyInteractionV1?: DeviceKeyInteractionV1;
  deviceKeyV1?: DeviceKeyV1;
  deviceListResultV1?: DeviceListResultV1;
  deviceLongPressInteractionV1?: DeviceLongPressInteractionV1;
  deviceStateChangedEventPayloadV1?: DeviceStateChangedEventPayloadV1;
  deviceStateV1?: DeviceStateV1;
  deviceSwipeInteractionV1?: DeviceSwipeInteractionV1;
  edgeTraversedEventPayloadV1?: EdgeTraversedEventPayloadV1;
  emptyPayloadV1?: EmptyPayloadV1;
  errorCauseEntryV1?: ErrorCauseEntryV1;
  errorResponseEnvelopeV1?: ErrorResponseEnvelopeV1;
  eventEnvelopeV1?: EventEnvelopeV1;
  graphValidateRequestPayloadV1?: GraphValidateRequestPayloadV1;
  graphValidateResultV1?: GraphValidateResultV1;
  handshakeRequestPayloadV1?: HandshakeRequestPayloadV1;
  handshakeResultV1?: HandshakeResultV1;
  healthResultV1?: HealthResultV1;
  jsonObject?: JsonObject;
  jsonValue?: JsonValue;
  maaRuntimeStateV1?: MaaRuntimeStateV1;
  nodeStateChangedEventPayloadV1?: NodeStateChangedEventPayloadV1;
  persistentBoolVariableV1?: PersistentBoolVariableV1;
  persistentNumberVariableV1?: PersistentNumberVariableV1;
  persistentPointValueV1?: PersistentPointValueV1;
  persistentPointVariableV1?: PersistentPointVariableV1;
  persistentRectValueV1?: PersistentRectValueV1;
  persistentRectVariableV1?: PersistentRectVariableV1;
  persistentStringVariableV1?: PersistentStringVariableV1;
  persistentVariableValueV1?: PersistentVariableValueV1;
  previewArtifactDescriptorV1?: PreviewArtifactDescriptorV1;
  previewCaptureRequestPayloadV1?: PreviewCaptureRequestPayloadV1;
  previewCaptureResultV1?: PreviewCaptureResultV1;
  previewReleaseRequestPayloadV1?: PreviewReleaseRequestPayloadV1;
  previewReleaseResultV1?: PreviewReleaseResultV1;
  previewTokenV1?: PreviewTokenV1;
  protocolErrorV1?: ProtocolErrorV1;
  protocolVersionRangeV1?: ProtocolVersionRangeV1;
  registryGetResultV1?: RegistryGetResultV1;
  requestEnvelopeV1?: RequestEnvelopeV1;
  runCancelRequestPayloadV1?: RunCancelRequestPayloadV1;
  runCancelResultV1?: RunCancelResultV1;
  runProjectAssetBindingV1?: RunProjectAssetBindingV1;
  runStartRequestPayloadV1?: RunStartRequestPayloadV1;
  runStartResultV1?: RunStartResultV1;
  runStateChangedEventPayloadV1?: RunStateChangedEventPayloadV1;
  runtimeLogCreatedEventPayloadV1?: RuntimeLogCreatedEventPayloadV1;
  runtimeTerminalErrorV1?: RuntimeTerminalErrorV1;
  runtimeValueSummaryV1?: RuntimeValueSummaryV1;
  semanticVersionV1?: SemanticVersionV1;
  shutdownResultV1?: ShutdownResultV1;
  successResponseEnvelopeV1?: SuccessResponseEnvelopeV1;
  systemHealthChangedEventPayloadV1?: SystemHealthChangedEventPayloadV1;
  systemProtocolErrorEventPayloadV1?: SystemProtocolErrorEventPayloadV1;
  systemReadyEventPayloadV1?: SystemReadyEventPayloadV1;
  rinoIpcMessageV1?: RinoIpcMessageV1;
}
export interface AutomationCallbackDiagnosticEventPayloadV1 {
  code:
    | "AUTOMATION_CALLBACK_MALFORMED"
    | "AUTOMATION_CALLBACK_UNSUPPORTED"
    | "AUTOMATION_CALLBACK_QUEUE_OVERFLOW"
    | "AUTOMATION_CALLBACK_CORRELATION_OVERFLOW"
    | "AUTOMATION_CALLBACK_OPERATION_UNMATCHED"
    | "AUTOMATION_CALLBACK_GENERATION_STALE"
    | "AUTOMATION_CALLBACK_EVENT_SINK_FAILED";
  count: number;
  backendGeneration: number;
  latestCallbackSequence?: number;
}
export interface AutomationOperationStateChangedEventPayloadV1 {
  source: "controller" | "tasker";
  state: "starting" | "succeeded" | "failed";
  operationKind:
    | "deviceConnect"
    | "deviceDisconnect"
    | "screenCapture"
    | "ocr"
    | "ocrStop"
    | "click"
    | "keyPress"
    | "appStart";
  backendOperationId: string;
  backendGeneration: number;
  callbackSequence: number;
  observedAtMilliseconds: number;
  requestId?: string;
  activationId?: number;
}
/**
 * Safe metadata for one confirmed, short-lived full-resolution capture. It never includes image bytes or a local path.
 */
export interface CaptureArtifactDescriptorV1 {
  captureToken: CaptureTokenV1;
  mediaType: "image/png";
  width: number;
  height: number;
  coordinateSpaceId: string;
  sourceKind: "deviceCapture" | "regionCapture";
  byteLength: number;
  expiresInMilliseconds: number;
}
export interface CapturePrepareRequestPayloadV1 {
  previewToken: PreviewTokenV1;
  region?: CaptureRegionV1;
}
export interface CaptureRegionV1 {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSpaceId: string;
  sourceGeneration: number;
}
export interface CapturePrepareResultV1 {
  capture: CaptureArtifactDescriptorV1;
}
export interface CaptureReleaseRequestPayloadV1 {
  captureToken: CaptureTokenV1;
}
export interface CaptureReleaseResultV1 {
  released: boolean;
}
export interface DeviceClickInteractionV1 {
  kind: "click";
  point: DeviceInteractionPointV1;
}
export interface DeviceInteractionPointV1 {
  x: number;
  y: number;
  coordinateSpaceId: string;
  sourceGeneration: number;
}
export interface DeviceConnectRequestPayloadV1 {
  deviceKey: DeviceKeyV1;
}
export interface DeviceConnectResultV1 {
  device: DeviceDescriptorV1;
}
/**
 * Safe display metadata for one sidecar-scoped opaque device key. Physical identifiers and local paths are never included.
 */
export interface DeviceDescriptorV1 {
  deviceKey: DeviceKeyV1;
  displayName: string;
  controllerFamily: "adb";
  state: DeviceStateV1;
}
export interface DeviceDisconnectRequestPayloadV1 {
  deviceKey: DeviceKeyV1;
}
export interface DeviceDisconnectResultV1 {
  device: DeviceDescriptorV1;
}
/**
 * One bounded non-idempotent device interaction. Clients must never retry it automatically.
 */
export interface DeviceInteractRequestPayloadV1 {
  deviceKey: DeviceKeyV1;
  interaction: DeviceInteractionV1;
}
export interface DeviceLongPressInteractionV1 {
  kind: "longPress";
  point: DeviceInteractionPointV1;
  durationMilliseconds: number;
}
export interface DeviceSwipeInteractionV1 {
  kind: "swipe";
  start: DeviceInteractionPointV1;
  end: DeviceInteractionPointV1;
  durationMilliseconds: number;
}
/**
 * One allowlisted device navigation key. Raw key codes are never accepted.
 */
export interface DeviceKeyInteractionV1 {
  kind: "key";
  key: "back";
}
export interface DeviceInteractResultV1 {
  completed: true;
  kind: "click" | "longPress" | "swipe" | "key";
}
export interface DeviceListResultV1 {
  /**
   * @maxItems 64
   */
  devices: DeviceDescriptorV1[];
}
export interface DeviceStateChangedEventPayloadV1 {
  device: DeviceDescriptorV1;
  reason: "connected" | "disconnected" | "connectionLost";
}
export interface EdgeTraversedEventPayloadV1 {
  edgeId: string;
  runSequence: number;
  tokenId: number;
  outputPortId: string;
}
export interface EmptyPayloadV1 {}
export interface ErrorCauseEntryV1 {
  code: string;
  technicalDetail: string;
}
export interface ErrorResponseEnvelopeV1 {
  protocolVersion: 1;
  messageKind: "response";
  messageType: string;
  requestId: string;
  error: ProtocolErrorV1;
}
export interface ProtocolErrorV1 {
  code: string;
  messageKey: string;
  parameters: JsonObject;
  technicalDetail: string;
  retryability: "never" | "safe" | "explicitConfirmation";
  requestId?: string;
  runId?: string;
  nodeId?: string;
  backendOperationId?: string;
  /**
   * @maxItems 8
   */
  causes?:
    | []
    | [ErrorCauseEntryV1]
    | [ErrorCauseEntryV1, ErrorCauseEntryV1]
    | [ErrorCauseEntryV1, ErrorCauseEntryV1, ErrorCauseEntryV1]
    | [ErrorCauseEntryV1, ErrorCauseEntryV1, ErrorCauseEntryV1, ErrorCauseEntryV1]
    | [
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
      ]
    | [
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
      ]
    | [
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
      ]
    | [
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
        ErrorCauseEntryV1,
      ];
}
export interface JsonObject {
  [k: string]: JsonValue;
}
export interface EventEnvelopeV1 {
  protocolVersion: 1;
  messageKind: "event";
  messageType: string;
  eventId: string;
  sequence: number;
  runId?: string;
  nodeId?: string;
  payload: JsonObject;
}
export interface GraphValidateRequestPayloadV1 {
  document: JsonObject;
}
export interface GraphValidateResultV1 {
  executable: boolean;
  report: JsonObject;
}
export interface HandshakeRequestPayloadV1 {
  desktopVersion: SemanticVersionV1;
  protocolVersionRange: ProtocolVersionRangeV1;
  maximumFrameBytes: number;
}
export interface ProtocolVersionRangeV1 {
  minimum: number;
  maximum: number;
}
export interface HandshakeResultV1 {
  runtimeVersion: SemanticVersionV1;
  protocolVersion: 1;
  maximumFrameBytes: number;
  runtimeMode: "source" | "frozen";
  graphSchemaVersionRange?: ProtocolVersionRangeV1;
  registryVersion?: string;
  maaRuntime?: MaaRuntimeStateV1;
  /**
   * @maxItems 64
   */
  featureFlags?: string[];
}
export interface MaaRuntimeStateV1 {
  state: "available" | "unavailable";
  bindingVersion?: SemanticVersionV1;
  nativeVersion?: SemanticVersionV1;
}
export interface HealthResultV1 {
  state: "ok" | "degraded";
  uptimeMilliseconds: number;
  details?: JsonObject;
}
export interface NodeStateChangedEventPayloadV1 {
  state: "running" | "succeeded" | "failed";
  runSequence: number;
  tokenId: number;
  activationId: number;
  /**
   * @maxItems 64
   */
  outputPortIds?: string[];
  /**
   * @maxItems 64
   */
  valueSummaries?: RuntimeValueSummaryV1[];
  errorCode?: string;
}
/**
 * A bounded display summary. It never carries image bytes or collection contents.
 */
export interface RuntimeValueSummaryV1 {
  portId: string;
  generation: number;
  kind:
    | "null"
    | "bool"
    | "number"
    | "string"
    | "point"
    | "rect"
    | "image"
    | "ocrCandidate"
    | "ocrResult"
    | "collection";
  preview: string;
  truncated: boolean;
  itemCount?: number;
  width?: number;
  height?: number;
}
export interface PersistentBoolVariableV1 {
  variableId: string;
  valueKind: "bool";
  value: boolean;
}
export interface PersistentNumberVariableV1 {
  variableId: string;
  valueKind: "number";
  value: number;
}
export interface PersistentPointValueV1 {
  x: number;
  y: number;
}
export interface PersistentPointVariableV1 {
  variableId: string;
  valueKind: "point";
  value: PersistentPointValueV1;
}
export interface PersistentRectValueV1 {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PersistentRectVariableV1 {
  variableId: string;
  valueKind: "rect";
  value: PersistentRectValueV1;
}
export interface PersistentStringVariableV1 {
  variableId: string;
  valueKind: "string";
  value: string;
}
/**
 * Safe metadata for a short-lived preview artifact. It never includes image bytes or a local path.
 */
export interface PreviewArtifactDescriptorV1 {
  previewToken: PreviewTokenV1;
  mediaType: "image/png";
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceCoordinateSpaceId: string;
  sourceGeneration: number;
  byteLength: number;
  expiresInMilliseconds: number;
}
export interface PreviewCaptureRequestPayloadV1 {
  deviceKey: DeviceKeyV1;
  maximumWidth: number;
  maximumHeight: number;
}
export interface PreviewCaptureResultV1 {
  preview: PreviewArtifactDescriptorV1;
}
export interface PreviewReleaseRequestPayloadV1 {
  previewToken: PreviewTokenV1;
}
export interface PreviewReleaseResultV1 {
  released: boolean;
}
export interface RegistryGetResultV1 {
  registry: JsonObject;
}
export interface RequestEnvelopeV1 {
  protocolVersion: 1;
  messageKind: "request";
  messageType: string;
  requestId: string;
  payload: JsonObject;
}
export interface RunCancelRequestPayloadV1 {
  runId: string;
}
export interface RunCancelResultV1 {
  accepted: true;
  runId: string;
  alreadyRequested: boolean;
  state: "cancelling" | "succeeded" | "failed" | "cancelled";
}
/**
 * One desktop-prepared, token-addressed project image. The token is private to the application cache and never persists in a graph.
 */
export interface RunProjectAssetBindingV1 {
  assetId: string;
  assetToken: string;
  contentHash: string;
  byteLength: number;
  width: number;
  height: number;
  coordinateSpaceId: string;
}
export interface RunStartRequestPayloadV1 {
  document: JsonObject;
  graphId: string;
  /**
   * Injected by the trusted desktop boundary after resolving project asset identifiers. Frontend-supplied values are discarded.
   *
   * @maxItems 32
   */
  assetBindings?: RunProjectAssetBindingV1[];
  deviceKey?: string;
  /**
   * @maxItems 128
   */
  initialPersistentVariables?: PersistentVariableValueV1[];
}
export interface RunStartResultV1 {
  accepted: true;
  runId: string;
  graphId: string;
  registryVersion: string;
}
export interface RunStateChangedEventPayloadV1 {
  state: "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
  graphId: string;
  runSequence?: number;
  stepCount?: number;
  tokensCreated?: number;
  pureCacheHits?: number;
  terminalError?: RuntimeTerminalErrorV1;
  /**
   * @maxItems 128
   */
  persistentVariableUpdates?: PersistentVariableValueV1[];
}
export interface RuntimeTerminalErrorV1 {
  code: string;
  messageKey: string;
  nodeId?: string;
  portId?: string;
}
export interface RuntimeLogCreatedEventPayloadV1 {
  logSequence: number;
  activationId: number;
  level: "debug" | "info" | "warning" | "error";
  message: string;
}
export interface ShutdownResultV1 {
  accepted: true;
}
export interface SuccessResponseEnvelopeV1 {
  protocolVersion: 1;
  messageKind: "response";
  messageType: string;
  requestId: string;
  result: JsonObject;
}
export interface SystemHealthChangedEventPayloadV1 {
  state: "ok" | "degraded";
}
export interface SystemProtocolErrorEventPayloadV1 {
  error: ProtocolErrorV1;
}
export interface SystemReadyEventPayloadV1 {
  state: "ready";
}
