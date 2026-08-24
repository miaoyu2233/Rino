import type {
  CapturePrepareRequestPayloadV1,
  CapturePrepareResultV1,
  CaptureReleaseRequestPayloadV1,
  CaptureReleaseResultV1,
  DeviceConnectRequestPayloadV1,
  DeviceConnectResultV1,
  DeviceDisconnectRequestPayloadV1,
  DeviceDisconnectResultV1,
  DeviceInteractRequestPayloadV1,
  DeviceInteractResultV1,
  DeviceListResultV1,
  GraphValidateResultV1,
  HealthResultV1,
  MaaRuntimeStateV1,
  PreviewCaptureRequestPayloadV1,
  PreviewCaptureResultV1,
  PreviewReleaseRequestPayloadV1,
  PreviewReleaseResultV1,
  PersistentVariableValueV1,
  ProtocolErrorV1,
  RegistryGetResultV1,
  RinoProjectDocumentV1,
  RunCancelRequestPayloadV1,
  RunCancelResultV1,
  RunStartResultV1,
} from "@rino/contracts";

/** The runtime lifecycle states reported by the desktop shell. */
export const RUNTIME_STATES = [
  "stopped",
  "starting",
  "handshaking",
  "ready",
  "degraded",
  "restarting",
  "stopping",
  "failed",
] as const;

export type RuntimeState = (typeof RUNTIME_STATES)[number];

/** The runtime status snapshot the desktop shell exposes. */
export interface RuntimeStatus {
  state: RuntimeState;
  generation: number;
  automaticRestarts: number;
  protocolVersion: number;
  maximumFrameBytes: number;
  runtimeVersion?: string;
  runtimeMode?: string;
  maaRuntime?: MaaRuntimeStateV1;
  featureFlags?: string[];
  lastError?: ProtocolErrorV1;
}

/** One runtime event forwarded by the desktop shell, tagged with its generation. */
export interface RuntimeEvent {
  generation: number;
  messageType: string;
  eventId: string;
  sequence: number;
  runId?: string;
  nodeId?: string;
  payload: Record<string, unknown>;
}

/** One bounded, redacted diagnostic line produced by the runtime. */
export interface RuntimeDiagnostic {
  generation: number;
  line: string;
}

/** The failure shape a runtime command rejects with. */
export interface RuntimeCommandFailure {
  error: ProtocolErrorV1;
}

/** The requests the frontend may send, matching the desktop shell's allowlist. */
export const RUNTIME_REQUESTS = [
  "capturePrepare",
  "captureRelease",
  "deviceList",
  "deviceConnect",
  "deviceDisconnect",
  "deviceInteract",
  "health",
  "previewCapture",
  "previewRelease",
  "registryGet",
  "graphValidate",
  "runStart",
  "runCancel",
] as const;

export type RuntimeRequest = (typeof RUNTIME_REQUESTS)[number];

export const runtimeRequestMessageTypes = {
  capturePrepare: "capture.prepare",
  captureRelease: "capture.release",
  deviceList: "device.list",
  deviceConnect: "device.connect",
  deviceDisconnect: "device.disconnect",
  deviceInteract: "device.interact",
  health: "system.health",
  previewCapture: "preview.capture",
  previewRelease: "preview.release",
  registryGet: "registry.get",
  graphValidate: "graph.validate",
  runStart: "run.start",
  runCancel: "run.cancel",
} as const satisfies Record<RuntimeRequest, string>;

export interface RuntimeRequestPayloads {
  capturePrepare: CapturePrepareRequestPayloadV1;
  captureRelease: CaptureReleaseRequestPayloadV1;
  deviceList: Record<string, never>;
  deviceConnect: DeviceConnectRequestPayloadV1;
  deviceDisconnect: DeviceDisconnectRequestPayloadV1;
  deviceInteract: DeviceInteractRequestPayloadV1;
  health: Record<string, never>;
  previewCapture: PreviewCaptureRequestPayloadV1;
  previewRelease: PreviewReleaseRequestPayloadV1;
  registryGet: Record<string, never>;
  graphValidate: { document: RinoProjectDocumentV1 };
  runStart: {
    document: RinoProjectDocumentV1;
    graphId: string;
    deviceKey?: string;
    initialPersistentVariables?: PersistentVariableValueV1[];
  };
  runCancel: RunCancelRequestPayloadV1;
}

export interface RuntimeRequestResults {
  capturePrepare: CapturePrepareResultV1;
  captureRelease: CaptureReleaseResultV1;
  deviceList: DeviceListResultV1;
  deviceConnect: DeviceConnectResultV1;
  deviceDisconnect: DeviceDisconnectResultV1;
  deviceInteract: DeviceInteractResultV1;
  health: HealthResultV1;
  previewCapture: PreviewCaptureResultV1;
  previewRelease: PreviewReleaseResultV1;
  registryGet: RegistryGetResultV1;
  graphValidate: GraphValidateResultV1;
  runStart: RunStartResultV1;
  runCancel: RunCancelResultV1;
}

export type RuntimeRequestPayload<Request extends RuntimeRequest> =
  RuntimeRequestPayloads[Request];

export type RuntimeRequestResult<Request extends RuntimeRequest> =
  RuntimeRequestResults[Request];

export const RUNTIME_EVENT_NAME = "rino://runtime-event";
export const RUNTIME_DIAGNOSTIC_EVENT_NAME = "rino://runtime-diagnostic";

/** States in which the runtime can accept requests. */
export function acceptsRequests(state: RuntimeState): boolean {
  return state === "ready" || state === "degraded";
}

/** States that describe a failure the user can act on. */
export function isFailureState(state: RuntimeState): boolean {
  return state === "failed";
}

export function isRuntimeState(value: unknown): value is RuntimeState {
  return RUNTIME_STATES.some((state) => state === value);
}
