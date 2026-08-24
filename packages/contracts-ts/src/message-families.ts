export const PROTOCOL_VERSION = 1;
export const DEFAULT_MAXIMUM_FRAME_BYTES = 1_048_576;

export type PayloadDefinitionName =
  | "AutomationCallbackDiagnosticEventPayloadV1"
  | "AutomationOperationStateChangedEventPayloadV1"
  | "CapturePrepareRequestPayloadV1"
  | "CapturePrepareResultV1"
  | "CaptureReleaseRequestPayloadV1"
  | "CaptureReleaseResultV1"
  | "DeviceConnectRequestPayloadV1"
  | "DeviceConnectResultV1"
  | "DeviceDisconnectRequestPayloadV1"
  | "DeviceDisconnectResultV1"
  | "DeviceInteractRequestPayloadV1"
  | "DeviceInteractResultV1"
  | "DeviceListResultV1"
  | "DeviceStateChangedEventPayloadV1"
  | "EdgeTraversedEventPayloadV1"
  | "EmptyPayloadV1"
  | "GraphValidateRequestPayloadV1"
  | "GraphValidateResultV1"
  | "HandshakeRequestPayloadV1"
  | "HandshakeResultV1"
  | "HealthResultV1"
  | "NodeStateChangedEventPayloadV1"
  | "PreviewCaptureRequestPayloadV1"
  | "PreviewCaptureResultV1"
  | "PreviewReleaseRequestPayloadV1"
  | "PreviewReleaseResultV1"
  | "RegistryGetResultV1"
  | "RunCancelRequestPayloadV1"
  | "RunCancelResultV1"
  | "RunStartRequestPayloadV1"
  | "RunStartResultV1"
  | "RunStateChangedEventPayloadV1"
  | "ShutdownResultV1"
  | "RuntimeLogCreatedEventPayloadV1"
  | "SystemReadyEventPayloadV1"
  | "SystemHealthChangedEventPayloadV1"
  | "SystemProtocolErrorEventPayloadV1";

export interface SystemRequestFamily {
  readonly requestPayload: PayloadDefinitionName;
  readonly result: PayloadDefinitionName;
}

export const systemRequestFamilies = {
  "system.handshake": {
    requestPayload: "HandshakeRequestPayloadV1",
    result: "HandshakeResultV1",
  },
  "system.health": {
    requestPayload: "EmptyPayloadV1",
    result: "HealthResultV1",
  },
  "system.shutdown": {
    requestPayload: "EmptyPayloadV1",
    result: "ShutdownResultV1",
  },
} as const satisfies Record<string, SystemRequestFamily>;

export const runtimeRequestFamilies = {
  "capture.prepare": {
    requestPayload: "CapturePrepareRequestPayloadV1",
    result: "CapturePrepareResultV1",
  },
  "capture.release": {
    requestPayload: "CaptureReleaseRequestPayloadV1",
    result: "CaptureReleaseResultV1",
  },
  "device.list": {
    requestPayload: "EmptyPayloadV1",
    result: "DeviceListResultV1",
  },
  "device.connect": {
    requestPayload: "DeviceConnectRequestPayloadV1",
    result: "DeviceConnectResultV1",
  },
  "device.disconnect": {
    requestPayload: "DeviceDisconnectRequestPayloadV1",
    result: "DeviceDisconnectResultV1",
  },
  "device.interact": {
    requestPayload: "DeviceInteractRequestPayloadV1",
    result: "DeviceInteractResultV1",
  },
  "preview.capture": {
    requestPayload: "PreviewCaptureRequestPayloadV1",
    result: "PreviewCaptureResultV1",
  },
  "preview.release": {
    requestPayload: "PreviewReleaseRequestPayloadV1",
    result: "PreviewReleaseResultV1",
  },
  "registry.get": {
    requestPayload: "EmptyPayloadV1",
    result: "RegistryGetResultV1",
  },
  "graph.validate": {
    requestPayload: "GraphValidateRequestPayloadV1",
    result: "GraphValidateResultV1",
  },
  "run.start": {
    requestPayload: "RunStartRequestPayloadV1",
    result: "RunStartResultV1",
  },
  "run.cancel": {
    requestPayload: "RunCancelRequestPayloadV1",
    result: "RunCancelResultV1",
  },
} as const satisfies Record<string, SystemRequestFamily>;

export const requestFamilies = {
  ...systemRequestFamilies,
  ...runtimeRequestFamilies,
} as const satisfies Record<string, SystemRequestFamily>;

export const systemEventFamilies = {
  "system.ready": "SystemReadyEventPayloadV1",
  "system.healthChanged": "SystemHealthChangedEventPayloadV1",
  "system.protocolError": "SystemProtocolErrorEventPayloadV1",
} as const satisfies Record<string, PayloadDefinitionName>;

export const runtimeEventFamilies = {
  "automation.operationStateChanged":
    "AutomationOperationStateChangedEventPayloadV1",
  "automation.callbackDiagnostic": "AutomationCallbackDiagnosticEventPayloadV1",
  "device.stateChanged": "DeviceStateChangedEventPayloadV1",
  "run.stateChanged": "RunStateChangedEventPayloadV1",
  "node.stateChanged": "NodeStateChangedEventPayloadV1",
  "edge.traversed": "EdgeTraversedEventPayloadV1",
  "runtime.logCreated": "RuntimeLogCreatedEventPayloadV1",
} as const satisfies Record<string, PayloadDefinitionName>;

export const eventFamilies = {
  ...systemEventFamilies,
  ...runtimeEventFamilies,
} as const satisfies Record<string, PayloadDefinitionName>;

export type SystemRequestType = keyof typeof systemRequestFamilies;
export type SystemEventType = keyof typeof systemEventFamilies;
export type RuntimeRequestType = keyof typeof runtimeRequestFamilies;
export type RuntimeEventType = keyof typeof runtimeEventFamilies;
export type RequestType = keyof typeof requestFamilies;
export type EventType = keyof typeof eventFamilies;

export function isSystemRequestType(value: string): value is SystemRequestType {
  return Object.hasOwn(systemRequestFamilies, value);
}

export function isSystemEventType(value: string): value is SystemEventType {
  return Object.hasOwn(systemEventFamilies, value);
}

export function isRequestType(value: string): value is RequestType {
  return Object.hasOwn(requestFamilies, value);
}

export function isEventType(value: string): value is EventType {
  return Object.hasOwn(eventFamilies, value);
}
