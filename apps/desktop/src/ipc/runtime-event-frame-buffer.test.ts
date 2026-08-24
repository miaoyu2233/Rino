import { describe, expect, it, vi } from "vitest";

import type { RuntimeEvent } from "./runtime-contract";
import {
  RuntimeEventFrameBuffer,
  type RuntimeEventFrameScheduler,
} from "./runtime-event-frame-buffer";

function event(sequence: number): RuntimeEvent {
  return {
    generation: 1,
    messageType: "node.stateChanged",
    eventId: `90000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    sequence,
    runId: "90000000-0000-4000-8000-000000000006",
    nodeId: "90000000-0000-4000-8000-000000000010",
    payload: {
      state: "running",
      runSequence: sequence,
      tokenId: 1,
      activationId: sequence,
    },
  };
}

function controlledScheduler(): {
  scheduler: RuntimeEventFrameScheduler;
  runFrame: () => void;
  cancel: ReturnType<typeof vi.fn>;
} {
  let callback: (() => void) | undefined;
  const cancel = vi.fn();
  return {
    scheduler: {
      request: (next) => {
        callback = next;
        return 1;
      },
      cancel,
    },
    runFrame: () => {
      const pending = callback;
      callback = undefined;
      pending?.();
    },
    cancel,
  };
}

describe("runtime event frame buffer", () => {
  it("commits one ordered batch for all events received in a frame", () => {
    const frame = controlledScheduler();
    const commit = vi.fn();
    const buffer = new RuntimeEventFrameBuffer(commit, frame.scheduler);

    buffer.enqueue(event(1));
    buffer.enqueue(event(2));
    frame.runFrame();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith([event(1), event(2)]);
  });

  it("flushes a terminal event immediately with its pending predecessors", () => {
    const frame = controlledScheduler();
    const commit = vi.fn();
    const buffer = new RuntimeEventFrameBuffer(commit, frame.scheduler);

    buffer.enqueue(event(1));
    buffer.enqueue(event(2), true);

    expect(frame.cancel).toHaveBeenCalledWith(1);
    expect(commit).toHaveBeenCalledWith([event(1), event(2)]);
    frame.runFrame();
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("discards pending events when the generation changes or the owner disposes", () => {
    const frame = controlledScheduler();
    const commit = vi.fn();
    const buffer = new RuntimeEventFrameBuffer(commit, frame.scheduler);

    buffer.enqueue(event(1));
    buffer.clear();
    frame.runFrame();
    expect(commit).not.toHaveBeenCalled();

    buffer.dispose();
    buffer.enqueue(event(2), true);
    expect(commit).not.toHaveBeenCalled();
  });
});
