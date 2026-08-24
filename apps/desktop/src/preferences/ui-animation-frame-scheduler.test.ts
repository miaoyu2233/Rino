import { beforeEach, describe, expect, it } from "vitest";

import { useLayoutPreferenceStore } from "./layout-preference-store";
import {
  createUiAnimationFrameScheduler,
  type FrameSource,
  type UiAnimationFrameCallback,
} from "./ui-animation-frame-scheduler";
import { defaultLayoutPreferences } from "./layout-preferences";

class FakeFrameSource implements FrameSource {
  private nextRequestId = 1;

  readonly callbacks = new Map<number, UiAnimationFrameCallback>();

  readonly cancelled: number[] = [];

  request(callback: UiAnimationFrameCallback): number {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    this.callbacks.set(requestId, callback);
    return requestId;
  }

  cancel(requestId: number): void {
    this.callbacks.delete(requestId);
    this.cancelled.push(requestId);
  }

  emit(timestamp: number): void {
    const callbacks = Array.from(this.callbacks.values());
    this.callbacks.clear();
    for (const callback of callbacks) {
      callback(timestamp);
    }
  }
}

function createTestScheduler(source: FakeFrameSource) {
  let rate = defaultLayoutPreferences.uiRefreshRate;
  const scheduler = createUiAnimationFrameScheduler({
    frameSource: source,
    getRefreshRate: () => rate,
  });
  return {
    scheduler,
    setRate: (nextRate: typeof rate) => {
      rate = nextRate;
    },
  };
}

describe("UI animation frame scheduler", () => {
  beforeEach(() => {
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences },
    });
  });

  it("presents once for every native frame when following the display", () => {
    const source = new FakeFrameSource();
    const { scheduler } = createTestScheduler(source);
    const timestamps: number[] = [];
    scheduler.request(function present(timestamp) {
      timestamps.push(timestamp);
      scheduler.request(present);
    });

    source.emit(0);
    source.emit(6.9);
    source.emit(13.8);

    expect(timestamps).toEqual([0, 6.9, 13.8]);
  });

  it.each([
    [60, 58, 62],
    [120, 116, 124],
  ] as const)(
    "tracks a %d Hz average on a 144 Hz source",
    (rate, minimum, maximum) => {
      const source = new FakeFrameSource();
      const { scheduler, setRate } = createTestScheduler(source);
      setRate(rate);
      let presentations = 0;
      scheduler.request(function present() {
        presentations += 1;
        scheduler.request(present);
      });

      const nativeFrames = 1440;
      for (let frame = 0; frame < nativeFrames; frame += 1) {
        source.emit((frame * 1000) / 144);
      }

      const durationSeconds = (nativeFrames - 1) / 144;
      const average = presentations / durationSeconds;
      expect(average).toBeGreaterThan(minimum);
      expect(average).toBeLessThan(maximum);
    },
  );

  it("does not exceed the display when the selected rate is higher", () => {
    const source = new FakeFrameSource();
    const { scheduler, setRate } = createTestScheduler(source);
    setRate(180);
    let presentations = 0;
    scheduler.request(function present() {
      presentations += 1;
      scheduler.request(present);
    });

    for (let frame = 0; frame < 600; frame += 1) {
      source.emit((frame * 1000) / 144);
    }

    expect(presentations).toBe(600);
  });

  it("follows a 60 Hz display when 180 Hz is selected", () => {
    const source = new FakeFrameSource();
    const { scheduler, setRate } = createTestScheduler(source);
    setRate(180);
    let presentations = 0;
    scheduler.request(function present() {
      presentations += 1;
      scheduler.request(present);
    });

    for (let frame = 0; frame < 600; frame += 1) {
      source.emit((frame * 1000) / 60);
    }

    expect(presentations).toBe(600);
  });

  it("cancels the native frame when the final callback is cancelled", () => {
    const source = new FakeFrameSource();
    const { scheduler } = createTestScheduler(source);
    const callbackId = scheduler.request(() => undefined);

    scheduler.cancel(callbackId);

    expect(source.callbacks.size).toBe(0);
    expect(source.cancelled).toHaveLength(1);
  });

  it("resets the phase after an idle one-shot callback", () => {
    const source = new FakeFrameSource();
    const { scheduler, setRate } = createTestScheduler(source);
    setRate(60);
    const timestamps: number[] = [];

    scheduler.request((timestamp) => {
      timestamps.push(timestamp);
    });
    source.emit(0);

    scheduler.request((timestamp) => {
      timestamps.push(timestamp);
    });
    source.emit(1);

    expect(timestamps).toEqual([0, 1]);
  });

  it("runs later callbacks and preserves scheduling when an earlier callback throws", () => {
    const source = new FakeFrameSource();
    const { scheduler } = createTestScheduler(source);
    const firstError = new Error("first callback failed");
    const events: string[] = [];

    scheduler.request(() => {
      events.push("first");
      throw firstError;
    });
    scheduler.request(() => {
      events.push("second");
      scheduler.request(() => {
        events.push("future");
      });
    });

    expect(() => {
      source.emit(0);
    }).toThrow(firstError);
    expect(events).toEqual(["first", "second"]);
    expect(source.callbacks.size).toBe(1);

    source.emit(16.7);
    expect(events).toEqual(["first", "second", "future"]);
  });

  it("defers callbacks queued during a callback to the next eligible frame", () => {
    const source = new FakeFrameSource();
    const { scheduler, setRate } = createTestScheduler(source);
    setRate(60);
    const timestamps: number[] = [];
    scheduler.request(function present(timestamp) {
      timestamps.push(timestamp);
      scheduler.request(present);
    });

    source.emit(0);
    source.emit(5);
    expect(timestamps).toEqual([0]);
    source.emit(16.7);
    expect(timestamps).toEqual([0, 16.7]);
  });

  it("presents promptly after a running rate switch", () => {
    const source = new FakeFrameSource();
    const { scheduler, setRate } = createTestScheduler(source);
    setRate(60);
    const timestamps: number[] = [];
    scheduler.request(function present(timestamp) {
      timestamps.push(timestamp);
      scheduler.request(present);
    });

    source.emit(0);
    source.emit(5);
    expect(timestamps).toEqual([0]);
    setRate(120);
    source.emit(6);
    expect(timestamps).toEqual([0, 6]);
  });

  it("bounds malformed timestamps without creating an uncontrolled loop", () => {
    const source = new FakeFrameSource();
    const { scheduler, setRate } = createTestScheduler(source);
    setRate(60);
    let presentations = 0;
    scheduler.request(function present() {
      presentations += 1;
      scheduler.request(present);
    });

    source.emit(0);
    source.emit(Number.NaN);
    source.emit(Number.POSITIVE_INFINITY);
    source.emit(Number.NEGATIVE_INFINITY);

    expect(presentations).toBe(1);
    expect(source.callbacks.size).toBe(1);
  });
});
