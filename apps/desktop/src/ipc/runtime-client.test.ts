import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  RuntimeClient,
  RuntimeCommandError,
  type RuntimeClientObserver,
} from "./runtime-client";
import type {
  RuntimeDiagnostic,
  RuntimeEvent,
  RuntimeRequest,
  RuntimeStatus,
} from "./runtime-contract";
import type { RuntimeTransport } from "./runtime-transport";

function status(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    state: "ready",
    generation: 1,
    automaticRestarts: 0,
    protocolVersion: 1,
    maximumFrameBytes: 1_048_576,
    runtimeVersion: "0.1.0",
    runtimeMode: "source",
    ...overrides,
  };
}

function readyEvent(overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    generation: 1,
    messageType: "system.ready",
    eventId: "3c2b1a09-8f7e-4d6c-b5a4-938271605af0",
    sequence: 1,
    payload: { state: "ready" },
    ...overrides,
  };
}

/** A transport whose behavior each test arranges directly. */
class TransportDouble implements RuntimeTransport {
  statusCalls = 0;
  startCalls = 0;
  restartCalls = 0;
  shutdownCalls = 0;
  requestCalls: { request: RuntimeRequest; payload: unknown }[] = [];
  nextStatus: RuntimeStatus = status();
  startBehavior: () => Promise<RuntimeStatus> = () => Promise.resolve(status());
  requestBehavior: () => Promise<unknown> = () =>
    Promise.resolve({ state: "ok", uptimeMilliseconds: 1 });
  readPreviewBehavior: () => Promise<Uint8Array> = () =>
    Promise.resolve(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  readCaptureBehavior: () => Promise<Uint8Array> = () =>
    Promise.resolve(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  emitEvent: ((event: RuntimeEvent) => void) | undefined;
  emitDiagnostic: ((diagnostic: RuntimeDiagnostic) => void) | undefined;
  eventUnsubscribed = false;

  status(): Promise<RuntimeStatus> {
    this.statusCalls += 1;
    return Promise.resolve(this.nextStatus);
  }

  start(): Promise<RuntimeStatus> {
    this.startCalls += 1;
    return this.startBehavior();
  }

  restart(): Promise<RuntimeStatus> {
    this.restartCalls += 1;
    return Promise.resolve(status({ generation: 2 }));
  }

  shutdown(): Promise<RuntimeStatus> {
    this.shutdownCalls += 1;
    return Promise.resolve(status({ state: "stopped" }));
  }

  request(request: RuntimeRequest, payload: unknown): Promise<unknown> {
    this.requestCalls.push({ request, payload });
    return this.requestBehavior();
  }

  readPreview(): Promise<Uint8Array> {
    return this.readPreviewBehavior();
  }

  readCapture(): Promise<Uint8Array> {
    return this.readCaptureBehavior();
  }

  subscribeToEvents(
    handler: (event: RuntimeEvent) => void,
  ): Promise<() => void> {
    this.emitEvent = handler;
    return Promise.resolve(() => {
      this.eventUnsubscribed = true;
    });
  }

  subscribeToDiagnostics(
    handler: (diagnostic: RuntimeDiagnostic) => void,
  ): Promise<() => void> {
    this.emitDiagnostic = handler;
    return Promise.resolve(() => undefined);
  }
}

function buildObserver(): RuntimeClientObserver & {
  statuses: RuntimeStatus[];
  events: RuntimeEvent[];
  diagnostics: RuntimeDiagnostic[];
  rejections: string[];
} {
  const statuses: RuntimeStatus[] = [];
  const events: RuntimeEvent[] = [];
  const diagnostics: RuntimeDiagnostic[] = [];
  const rejections: string[] = [];

  return {
    statuses,
    events,
    diagnostics,
    rejections,
    onStatus: (value) => statuses.push(value),
    onEvent: (value) => events.push(value),
    onDiagnostic: (value) => diagnostics.push(value),
    onEventRejected: (_event, reason) => rejections.push(reason),
  };
}

describe("RuntimeClient lifecycle", () => {
  let transport: TransportDouble;

  beforeEach(() => {
    transport = new TransportDouble();
  });

  it("subscribes and reports the current status on connect", async () => {
    const observer = buildObserver();
    const client = new RuntimeClient(transport, observer);

    await client.connect();

    expect(transport.statusCalls).toBe(1);
    expect(observer.statuses).toHaveLength(1);
    expect(observer.statuses[0]?.state).toBe("ready");
  });

  it("joins a pending start instead of issuing a competing command", async () => {
    let release: ((value: RuntimeStatus) => void) | undefined;
    transport.startBehavior = () =>
      new Promise<RuntimeStatus>((resolve) => {
        release = resolve;
      });
    const client = new RuntimeClient(transport, buildObserver());

    const first = client.start();
    const second = client.start();
    release?.(status());

    await expect(first).resolves.toMatchObject({ state: "ready" });
    await expect(second).resolves.toMatchObject({ state: "ready" });
    expect(transport.startCalls).toBe(1);
  });

  it("allows a new start after the previous one settles", async () => {
    const client = new RuntimeClient(transport, buildObserver());

    await client.start();
    await client.start();

    expect(transport.startCalls).toBe(2);
  });

  it("normalizes an unstructured command rejection", async () => {
    transport.startBehavior = () => Promise.reject(new Error("opaque"));
    const client = new RuntimeClient(transport, buildObserver());

    await expect(client.start()).rejects.toMatchObject({
      error: { code: "DESKTOP_COMMAND_FAILED" },
    });
  });

  it("preserves a structured failure from the desktop shell", async () => {
    transport.startBehavior = () =>
      Promise.reject(
        new RuntimeCommandError({
          code: "PROTOCOL_INCOMPATIBLE",
          messageKey: "runtime.error.protocolIncompatible",
          parameters: {},
          technicalDetail: "The runtime protocol version is unsupported.",
          retryability: "never",
        }),
      );
    const client = new RuntimeClient(transport, buildObserver());

    await expect(client.start()).rejects.toMatchObject({
      error: { code: "PROTOCOL_INCOMPATIBLE" },
    });
  });

  it("releases subscriptions on dispose and ignores later callbacks", async () => {
    const observer = buildObserver();
    const client = new RuntimeClient(transport, observer);
    await client.connect();

    client.dispose();
    transport.emitDiagnostic?.({ generation: 1, line: "RUNTIME_STARTED" });

    expect(transport.eventUnsubscribed).toBe(true);
    expect(observer.diagnostics).toHaveLength(0);
  });
});

describe("RuntimeClient event acceptance", () => {
  let transport: TransportDouble;

  beforeEach(() => {
    transport = new TransportDouble();
  });

  it("applies an in-order event for the current generation", async () => {
    const observer = buildObserver();
    const client = new RuntimeClient(transport, observer);
    await client.connect();

    expect(client.applyEvent(readyEvent())).toEqual({ accepted: true });
    expect(observer.events).toHaveLength(1);
  });

  it("rejects an event from a previous runtime generation", async () => {
    const observer = buildObserver();
    transport.nextStatus = status({ generation: 3 });
    const client = new RuntimeClient(transport, observer);
    await client.connect();

    const outcome = client.applyEvent(readyEvent({ generation: 2 }));

    expect(outcome).toEqual({ accepted: false, reason: "staleGeneration" });
    expect(observer.events).toHaveLength(0);
    expect(observer.rejections).toEqual(["staleGeneration"]);
  });

  it("rejects a repeated or out-of-order sequence", async () => {
    const observer = buildObserver();
    const client = new RuntimeClient(transport, observer);
    await client.connect();
    client.applyEvent(readyEvent({ sequence: 5 }));

    expect(client.applyEvent(readyEvent({ sequence: 5 }))).toEqual({
      accepted: false,
      reason: "repeatedSequence",
    });
    expect(client.applyEvent(readyEvent({ sequence: 4 }))).toEqual({
      accepted: false,
      reason: "repeatedSequence",
    });
    expect(observer.events).toHaveLength(1);
  });

  it("restarts sequence tracking when a newer generation arrives", async () => {
    const observer = buildObserver();
    const client = new RuntimeClient(transport, observer);
    await client.connect();
    client.applyEvent(readyEvent({ sequence: 9 }));

    const outcome = client.applyEvent(
      readyEvent({ generation: 2, sequence: 1 }),
    );

    expect(outcome).toEqual({ accepted: true });
    expect(observer.events).toHaveLength(2);
  });

  it("rejects a known event whose payload violates its canonical definition", async () => {
    const observer = buildObserver();
    const client = new RuntimeClient(transport, observer);
    await client.connect();

    const outcome = client.applyEvent(
      readyEvent({ payload: { state: "starting" } }),
    );

    expect(outcome).toEqual({ accepted: false, reason: "invalidPayload" });
    expect(observer.events).toHaveLength(0);
  });

  it("rejects a runtime event whose payload violates its canonical definition", async () => {
    const observer = buildObserver();
    const client = new RuntimeClient(transport, observer);
    await client.connect();

    const outcome = client.applyEvent(
      readyEvent({
        messageType: "run.stateChanged",
        runId: "90000000-0000-4000-8000-000000000006",
        payload: {
          state: "complete",
          graphId: "90000000-0000-4000-8000-000000000004",
        },
      }),
    );

    expect(outcome).toEqual({ accepted: false, reason: "invalidPayload" });
    expect(observer.events).toHaveLength(0);
  });

  it("forwards an event family the interface does not know yet", async () => {
    const observer = buildObserver();
    const client = new RuntimeClient(transport, observer);
    await client.connect();

    const outcome = client.applyEvent(
      readyEvent({ messageType: "future.somethingHappened", payload: {} }),
    );

    expect(outcome).toEqual({ accepted: true });
    expect(observer.events).toHaveLength(1);
  });

  it("delivers events raised by the transport subscription", async () => {
    const observer = buildObserver();
    const client = new RuntimeClient(transport, observer);
    await client.connect();

    transport.emitEvent?.(readyEvent());

    expect(observer.events).toHaveLength(1);
  });
});

describe("RuntimeClient requests", () => {
  it("sends only allowlisted requests and normalizes failures", async () => {
    const transport = new TransportDouble();
    const client = new RuntimeClient(transport, buildObserver());

    await expect(client.request("health", {})).resolves.toMatchObject({
      state: "ok",
    });
    expect(transport.requestCalls).toEqual([
      { request: "health", payload: {} },
    ]);

    transport.requestBehavior = () => Promise.reject(new Error("no runtime"));
    await expect(client.request("health", {})).rejects.toMatchObject({
      error: { code: "DESKTOP_COMMAND_FAILED" },
    });
  });

  it("does not retry a failed request on its own", async () => {
    const transport = new TransportDouble();
    const failure = vi.fn(() => Promise.reject(new Error("no runtime")));
    transport.requestBehavior = failure;
    const client = new RuntimeClient(transport, buildObserver());

    await expect(client.request("health", {})).rejects.toBeDefined();

    expect(failure).toHaveBeenCalledTimes(1);
  });

  it("rejects an outgoing payload that violates the canonical request", async () => {
    const transport = new TransportDouble();
    const client = new RuntimeClient(transport, buildObserver());
    const invalidPayload = { unexpected: true } as unknown as Record<
      string,
      never
    >;

    await expect(
      client.request("health", invalidPayload),
    ).rejects.toMatchObject({
      error: { code: "DESKTOP_INVALID_RUNTIME_REQUEST" },
    });
    expect(transport.requestCalls).toHaveLength(0);
  });

  it("rejects a result that violates the canonical response", async () => {
    const transport = new TransportDouble();
    transport.requestBehavior = () => Promise.resolve({ state: "unknown" });
    const client = new RuntimeClient(transport, buildObserver());

    await expect(client.request("health", {})).rejects.toMatchObject({
      error: { code: "DESKTOP_INVALID_RUNTIME_RESULT" },
    });
  });
});

describe("RuntimeClient previews", () => {
  it("accepts only bounded PNG bytes for a canonical preview token", async () => {
    const transport = new TransportDouble();
    const client = new RuntimeClient(transport, buildObserver());
    const token = "0123456789abcdef0123456789abcdef";

    await expect(client.readPreview(token)).resolves.toHaveLength(8);

    transport.readPreviewBehavior = () =>
      Promise.resolve(new Uint8Array([1, 2, 3, 4]));
    await expect(client.readPreview(token)).rejects.toMatchObject({
      error: { code: "DESKTOP_INVALID_PREVIEW_BYTES" },
    });
  });

  it("rejects a forged token before reaching the native transport", async () => {
    const transport = new TransportDouble();
    const readPreview = vi.spyOn(transport, "readPreview");
    const client = new RuntimeClient(transport, buildObserver());

    await expect(client.readPreview("../private")).rejects.toMatchObject({
      error: { code: "DESKTOP_INVALID_PREVIEW_TOKEN" },
    });
    expect(readPreview).not.toHaveBeenCalled();
  });

  it("accepts only bounded PNG bytes for a canonical capture token", async () => {
    const transport = new TransportDouble();
    const client = new RuntimeClient(transport, buildObserver());
    const token = "abcdef0123456789abcdef0123456789";

    await expect(client.readCapture(token)).resolves.toHaveLength(8);

    transport.readCaptureBehavior = () =>
      Promise.resolve(new Uint8Array([1, 2, 3, 4]));
    await expect(client.readCapture(token)).rejects.toMatchObject({
      error: { code: "DESKTOP_INVALID_CAPTURE_BYTES" },
    });
  });

  it("rejects a forged capture token before reaching native transport", async () => {
    const transport = new TransportDouble();
    const readCapture = vi.spyOn(transport, "readCapture");
    const client = new RuntimeClient(transport, buildObserver());

    await expect(client.readCapture("../private")).rejects.toMatchObject({
      error: { code: "DESKTOP_INVALID_CAPTURE_TOKEN" },
    });
    expect(readCapture).not.toHaveBeenCalled();
  });
});
