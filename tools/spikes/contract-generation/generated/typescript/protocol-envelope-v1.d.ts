/* Generated from schemas/protocol-envelope-v1.schema.json. Do not edit directly. */

/**
 * Version-one local runtime protocol envelope.
 */
export type RinoProtocolEnvelopeV1 =
  | RequestEnvelopeV1
  | SuccessResponseEnvelopeV1
  | ErrorResponseEnvelopeV1
  | EventEnvelopeV1;
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export interface RequestEnvelopeV1 {
  protocolVersion: 1;
  messageKind: "request";
  messageType: string;
  requestId: string;
  payload: JsonObject;
}
export interface JsonObject {
  [k: string]: JsonValue;
}
export interface SuccessResponseEnvelopeV1 {
  protocolVersion: 1;
  messageKind: "response";
  messageType: string;
  requestId: string;
  result: JsonObject;
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
