import type {
  CaptureArtifactDescriptorV1,
  CapturePrepareRequestPayloadV1,
} from "@rino/contracts";

import type { RuntimeClient } from "../ipc/runtime-client";
import type {
  ProjectTransport,
  StoredImageObject,
} from "../graph/project/project-transport";

export interface CaptureRuntimePort {
  prepareCapture: (
    payload: CapturePrepareRequestPayloadV1,
  ) => Promise<CaptureArtifactDescriptorV1>;
  readCapture: (captureToken: string) => Promise<Uint8Array>;
  releaseCapture: (captureToken: string) => Promise<boolean>;
}

export interface CaptureProjectPort {
  storeCapture: (captureToken: string) => Promise<StoredImageObject>;
}

export type CaptureSessionState = "active" | "committed" | "released";

export type CaptureSessionPreparationStage = "runtimePrepare" | "captureRead";

/** Preserves the failed boundary without exposing private runtime details to the UI. */
export class CaptureSessionPreparationError extends Error {
  readonly stage: CaptureSessionPreparationStage;
  readonly originalCause: unknown;

  constructor(stage: CaptureSessionPreparationStage, originalCause: unknown) {
    super(
      stage === "runtimePrepare"
        ? "The runtime could not prepare the capture artifact."
        : "The desktop could not read the prepared capture artifact.",
    );
    this.name = "CaptureSessionPreparationError";
    this.stage = stage;
    this.originalCause = originalCause;
  }
}

/** Owns one prepared capture until the user commits or discards it. */
export class PreparedCaptureSession {
  readonly descriptor: CaptureArtifactDescriptorV1;
  private imageBytes: Uint8Array | undefined;
  private sessionState: CaptureSessionState = "active";
  private operation: "commit" | "discard" | undefined;

  constructor(
    descriptor: CaptureArtifactDescriptorV1,
    imageBytes: Uint8Array,
    private readonly runtime: CaptureRuntimePort,
    private readonly project: CaptureProjectPort,
  ) {
    if (imageBytes.byteLength !== descriptor.byteLength) {
      throw new RangeError(
        "Capture bytes must match the registered byte length.",
      );
    }
    this.descriptor = descriptor;
    this.imageBytes = imageBytes;
  }

  get state(): CaptureSessionState {
    return this.sessionState;
  }

  get bytes(): Uint8Array {
    if (this.imageBytes === undefined) {
      throw new Error("This capture session no longer owns image bytes.");
    }
    return this.imageBytes;
  }

  async commit(): Promise<StoredImageObject> {
    this.requireActive();
    this.requireIdleOperation();
    this.operation = "commit";
    try {
      const stored = await this.project.storeCapture(
        this.descriptor.captureToken,
      );
      this.imageBytes = undefined;
      this.sessionState = "committed";
      return stored;
    } finally {
      this.operation = undefined;
    }
  }

  async discard(): Promise<boolean> {
    this.requireActive();
    this.requireIdleOperation();
    this.operation = "discard";
    try {
      return await this.runtime.releaseCapture(this.descriptor.captureToken);
    } finally {
      this.imageBytes = undefined;
      this.sessionState = "released";
      this.operation = undefined;
    }
  }

  private requireActive(): void {
    if (this.sessionState !== "active") {
      throw new Error("This capture session is no longer active.");
    }
  }

  private requireIdleOperation(): void {
    if (this.operation !== undefined) {
      throw new Error(
        "This capture session already has an operation in progress.",
      );
    }
  }
}

export function createCaptureRuntimePort(
  client: RuntimeClient,
): CaptureRuntimePort {
  return {
    prepareCapture: async (payload) =>
      (await client.request("capturePrepare", payload)).capture,
    readCapture: (captureToken) => client.readCapture(captureToken),
    releaseCapture: async (captureToken) =>
      (await client.request("captureRelease", { captureToken })).released,
  };
}

export function createCaptureProjectPort(
  transport: ProjectTransport,
): CaptureProjectPort {
  return {
    storeCapture: (captureToken) => transport.storeCapture(captureToken),
  };
}

/** Prepares bytes for explicit user confirmation without adding them to the project. */
export async function prepareCaptureSession(
  runtime: CaptureRuntimePort,
  project: CaptureProjectPort,
  payload: CapturePrepareRequestPayloadV1,
): Promise<PreparedCaptureSession> {
  let descriptor: CaptureArtifactDescriptorV1;
  try {
    descriptor = await runtime.prepareCapture(payload);
  } catch (cause: unknown) {
    throw new CaptureSessionPreparationError("runtimePrepare", cause);
  }
  try {
    const bytes = await runtime.readCapture(descriptor.captureToken);
    if (bytes.byteLength !== descriptor.byteLength) {
      throw new RangeError("Capture bytes disagree with runtime metadata.");
    }
    return new PreparedCaptureSession(descriptor, bytes, runtime, project);
  } catch (cause: unknown) {
    await runtime.releaseCapture(descriptor.captureToken).catch(() => false);
    throw new CaptureSessionPreparationError("captureRead", cause);
  }
}
