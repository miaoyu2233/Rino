import type { ProtocolErrorV1 } from "@rino/contracts";
import {
  eventFamilies,
  isValidPayload,
  requestFamilies,
} from "@rino/contracts";

import {
  isRuntimeState,
  runtimeRequestMessageTypes,
  type RuntimeCommandFailure,
  type RuntimeDiagnostic,
  type RuntimeEvent,
  type RuntimeRequest,
  type RuntimeRequestPayload,
  type RuntimeRequestResult,
  type RuntimeStatus,
} from "./runtime-contract";
import type { RuntimeTransport } from "./runtime-transport";

/** Why an event the desktop shell forwarded was not applied. */
export type EventRejectionReason =
  "staleGeneration" | "repeatedSequence" | "invalidPayload";

export interface EventOutcome {
  accepted: boolean;
  reason?: EventRejectionReason;
}

export interface RuntimeClientObserver {
  onStatus: (status: RuntimeStatus) => void;
  onEvent: (event: RuntimeEvent) => void;
  onDiagnostic: (diagnostic: RuntimeDiagnostic) => void;
  onEventRejected?: (event: RuntimeEvent, reason: EventRejectionReason) => void;
}

/** A runtime command failure carrying its structured error.
 *
 * The desktop shell rejects with a plain structured value; wrapping it in an error keeps
 * the stack trace and lets callers catch it like any other failure.
 */
export class RuntimeCommandError extends Error {
  readonly error: ProtocolErrorV1;

  constructor(error: ProtocolErrorV1) {
    super(error.code);
    this.name = "RuntimeCommandError";
    this.error = error;
  }
}

function isCommandFailure(value: unknown): value is RuntimeCommandFailure {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const candidate: unknown = value.error;
  return (
    typeof candidate === "object" && candidate !== null && "code" in candidate
  );
}

/** Normalizes any rejection into the structured failure the interface understands. */
function toCommandError(cause: unknown): RuntimeCommandError {
  if (cause instanceof RuntimeCommandError) {
    return cause;
  }
  if (isCommandFailure(cause)) {
    return new RuntimeCommandError(cause.error);
  }
  return new RuntimeCommandError({
    code: "DESKTOP_COMMAND_FAILED",
    messageKey: "runtime.error.desktopCommandFailed",
    parameters: {},
    technicalDetail:
      "The desktop shell rejected a runtime command without a structured error.",
    retryability: "safe",
  });
}

/** Drives the runtime lifecycle from the interface.
 *
 * The client owns two invariants the interface depends on. A lifecycle command never runs
 * concurrently with itself, so a repeated click cannot start two runtimes. Events are only
 * applied when they belong to the current runtime generation and advance its sequence, so
 * output from a previous runtime instance can never rewrite the visible state.
 */
export class RuntimeClient {
  private readonly transport: RuntimeTransport;
  private readonly observer: RuntimeClientObserver;
  private readonly inFlight = new Map<string, Promise<RuntimeStatus>>();
  private unsubscribers: (() => void)[] = [];
  private currentGeneration = 0;
  private highestAppliedSequence = 0;
  private disposed = false;

  constructor(transport: RuntimeTransport, observer: RuntimeClientObserver) {
    this.transport = transport;
    this.observer = observer;
  }

  /** Subscribes to runtime events and reports the current status once. */
  async connect(): Promise<void> {
    const eventUnsubscribe = await this.transport.subscribeToEvents((event) => {
      this.applyEvent(event);
    });
    const diagnosticUnsubscribe = await this.transport.subscribeToDiagnostics(
      (diagnostic) => {
        if (!this.disposed) {
          this.observer.onDiagnostic(diagnostic);
        }
      },
    );

    if (this.disposed) {
      eventUnsubscribe();
      diagnosticUnsubscribe();
      return;
    }
    this.unsubscribers = [eventUnsubscribe, diagnosticUnsubscribe];

    const status = await this.transport.status();
    this.acceptStatus(status);
  }

  /** Releases every subscription; further transport callbacks are ignored. */
  dispose(): void {
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers = [];
  }

  async start(): Promise<RuntimeStatus> {
    return this.runExclusive("start", () => this.transport.start());
  }

  async restart(): Promise<RuntimeStatus> {
    return this.runExclusive("restart", () => this.transport.restart());
  }

  async shutdown(): Promise<RuntimeStatus> {
    return this.runExclusive("shutdown", () => this.transport.shutdown());
  }

  async refreshStatus(): Promise<RuntimeStatus> {
    return this.runExclusive("status", () => this.transport.status());
  }

  /** Reads a short-lived preview through the native token boundary. */
  async readPreview(previewToken: string): Promise<Uint8Array> {
    return this.readPngArtifact("preview", previewToken);
  }

  /** Reads a confirmed full-resolution capture through the native token boundary. */
  async readCapture(captureToken: string): Promise<Uint8Array> {
    return this.readPngArtifact("capture", captureToken);
  }

  private async readPngArtifact(
    kind: "preview" | "capture",
    token: string,
  ): Promise<Uint8Array> {
    const isPreview = kind === "preview";
    if (!/^[0-9a-f]{32}$/.test(token)) {
      throw new RuntimeCommandError({
        code: isPreview
          ? "DESKTOP_INVALID_PREVIEW_TOKEN"
          : "DESKTOP_INVALID_CAPTURE_TOKEN",
        messageKey: isPreview
          ? "runtime.error.previewUnavailable"
          : "runtime.error.captureUnavailable",
        parameters: {},
        technicalDetail: `The interface rejected an invalid ${kind} token.`,
        retryability: "never",
      });
    }
    try {
      const bytes = isPreview
        ? await this.transport.readPreview(token)
        : await this.transport.readCapture(token);
      const maximumBytes = isPreview ? 3 * 1024 * 1024 : 64 * 1024 * 1024;
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > maximumBytes ||
        bytes[0] !== 0x89 ||
        bytes[1] !== 0x50 ||
        bytes[2] !== 0x4e ||
        bytes[3] !== 0x47
      ) {
        throw new RuntimeCommandError({
          code: isPreview
            ? "DESKTOP_INVALID_PREVIEW_BYTES"
            : "DESKTOP_INVALID_CAPTURE_BYTES",
          messageKey: isPreview
            ? "runtime.error.previewUnavailable"
            : "runtime.error.captureUnavailable",
          parameters: {},
          technicalDetail: `The native ${kind} response was not a bounded PNG image.`,
          retryability: "safe",
        });
      }
      return bytes;
    } catch (cause: unknown) {
      throw toCommandError(cause);
    }
  }

  /** Sends one allowlisted, canonically validated request and validates its result. */
  async request<Request extends RuntimeRequest>(
    request: Request,
    payload: RuntimeRequestPayload<Request>,
  ): Promise<RuntimeRequestResult<Request>> {
    const messageType = runtimeRequestMessageTypes[request];
    const family = requestFamilies[messageType];
    if (!isValidPayload(family.requestPayload, payload)) {
      throw new RuntimeCommandError({
        code: "DESKTOP_INVALID_RUNTIME_REQUEST",
        messageKey: "runtime.error.invalidDesktopRequest",
        parameters: { messageType },
        technicalDetail:
          "The interface produced a runtime request that violates its canonical payload definition.",
        retryability: "never",
      });
    }
    try {
      const result = await this.transport.request(request, payload);
      if (!isValidPayload(family.result, result)) {
        throw new RuntimeCommandError({
          code: "DESKTOP_INVALID_RUNTIME_RESULT",
          messageKey: "runtime.error.invalidRuntimeResult",
          parameters: { messageType },
          technicalDetail:
            "The runtime returned a result that violates its canonical definition.",
          retryability: "safe",
        });
      }
      return result as RuntimeRequestResult<Request>;
    } catch (cause: unknown) {
      throw toCommandError(cause);
    }
  }

  /** Applies one forwarded event after generation and sequence checks. */
  applyEvent(event: RuntimeEvent): EventOutcome {
    if (this.disposed) {
      return { accepted: false, reason: "staleGeneration" };
    }
    if (event.generation < this.currentGeneration) {
      return this.reject(event, "staleGeneration");
    }
    if (
      event.generation === this.currentGeneration &&
      event.sequence <= this.highestAppliedSequence
    ) {
      return this.reject(event, "repeatedSequence");
    }
    if (!this.hasValidPayload(event)) {
      return this.reject(event, "invalidPayload");
    }

    if (event.generation > this.currentGeneration) {
      this.currentGeneration = event.generation;
      this.highestAppliedSequence = 0;
    }
    this.highestAppliedSequence = event.sequence;
    this.observer.onEvent(event);
    return { accepted: true };
  }

  /** Validates a known event payload against its canonical definition.
   *
   * An event family the interface does not know yet is forwarded unchanged, because a
   * newer runtime may legitimately emit one and the desktop shell already validated its
   * envelope.
   */
  private hasValidPayload(event: RuntimeEvent): boolean {
    if (!Object.hasOwn(eventFamilies, event.messageType)) {
      return true;
    }
    const definition =
      eventFamilies[event.messageType as keyof typeof eventFamilies];
    return isValidPayload(definition, event.payload);
  }

  private reject(
    event: RuntimeEvent,
    reason: EventRejectionReason,
  ): EventOutcome {
    this.observer.onEventRejected?.(event, reason);
    return { accepted: false, reason };
  }

  private acceptStatus(status: RuntimeStatus): void {
    if (this.disposed || !isRuntimeState(status.state)) {
      return;
    }
    if (status.generation > this.currentGeneration) {
      this.currentGeneration = status.generation;
      this.highestAppliedSequence = 0;
    }
    this.observer.onStatus(status);
  }

  /** Runs one lifecycle command at a time per key.
   *
   * A second call while the first is still running joins the pending operation instead of
   * issuing a competing command, which is what keeps a repeated click from starting two
   * runtime processes.
   */
  private async runExclusive(
    key: string,
    operation: () => Promise<RuntimeStatus>,
  ): Promise<RuntimeStatus> {
    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }

    const execution = operation()
      .then((status) => {
        this.acceptStatus(status);
        return status;
      })
      .catch((cause: unknown) => {
        throw toCommandError(cause);
      })
      .finally(() => {
        this.inFlight.delete(key);
      });

    this.inFlight.set(key, execution);
    return execution;
  }
}
