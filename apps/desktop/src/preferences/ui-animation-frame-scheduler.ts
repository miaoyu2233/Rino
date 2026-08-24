import { useLayoutPreferenceStore } from "./layout-preference-store";
import type { UiRefreshRate } from "./layout-preferences";

export type UiAnimationFrameCallback = (timestamp: number) => void;

export interface FrameSource {
  request: (callback: UiAnimationFrameCallback) => number;
  cancel: (requestId: number) => void;
}

export interface UiAnimationFrameSchedulerOptions {
  frameSource: FrameSource;
  getRefreshRate: () => UiRefreshRate;
}

const MILLISECONDS_PER_SECOND = 1000;
const MAXIMUM_ELAPSED_MILLISECONDS = 250;
const MAXIMUM_ACCUMULATED_MILLISECONDS = 1000;

function intervalFor(rate: UiRefreshRate): number {
  return rate === "display" ? 0 : MILLISECONDS_PER_SECOND / rate;
}

function clampElapsedMilliseconds(elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return 0;
  }
  return Math.min(elapsed, MAXIMUM_ELAPSED_MILLISECONDS);
}

/**
 * Shares one native animation frame request between all UI animation clients and
 * applies the configured presentation-rate gate without changing event timing.
 */
export class UiAnimationFrameScheduler {
  private readonly frameSource: FrameSource;

  private readonly getRefreshRate: () => UiRefreshRate;

  private readonly callbacks = new Map<number, UiAnimationFrameCallback>();

  private nextCallbackId = 1;

  private nativeRequestId: number | undefined;

  private previousTimestamp: number | undefined;

  private accumulatedMilliseconds = 0;

  private previousRate: UiRefreshRate | undefined;

  public constructor({
    frameSource,
    getRefreshRate,
  }: UiAnimationFrameSchedulerOptions) {
    this.frameSource = frameSource;
    this.getRefreshRate = getRefreshRate;
  }

  public request(callback: UiAnimationFrameCallback): number {
    const callbackId = this.nextCallbackId;
    this.nextCallbackId += 1;
    this.callbacks.set(callbackId, callback);
    this.ensureNativeFrame();
    return callbackId;
  }

  public cancel(callbackId: number): void {
    this.callbacks.delete(callbackId);
    if (this.callbacks.size !== 0 || this.nativeRequestId === undefined) {
      return;
    }

    this.frameSource.cancel(this.nativeRequestId);
    this.nativeRequestId = undefined;
    this.resetPhase();
  }

  private resetPhase(): void {
    this.previousTimestamp = undefined;
    this.accumulatedMilliseconds = 0;
    this.previousRate = undefined;
  }

  private ensureNativeFrame(): void {
    if (this.callbacks.size === 0 || this.nativeRequestId !== undefined) {
      return;
    }
    this.nativeRequestId = this.frameSource.request((timestamp) => {
      this.handleNativeFrame(timestamp);
    });
  }

  private handleNativeFrame(timestamp: number): void {
    this.nativeRequestId = undefined;
    if (this.callbacks.size === 0) {
      this.resetPhase();
      return;
    }

    const frameTimestamp = Number.isFinite(timestamp)
      ? timestamp
      : (this.previousTimestamp ?? 0);
    const rate = this.getRefreshRate();
    const rateChanged = this.previousRate !== rate;
    const previousTimestamp = this.previousTimestamp;
    const firstFrame = previousTimestamp === undefined;

    if (firstFrame || rateChanged) {
      this.previousTimestamp = frameTimestamp;
      this.accumulatedMilliseconds = 0;
      this.previousRate = rate;
    } else {
      const elapsed = clampElapsedMilliseconds(
        frameTimestamp - previousTimestamp,
      );
      this.previousTimestamp = frameTimestamp;
      this.accumulatedMilliseconds = Math.min(
        MAXIMUM_ACCUMULATED_MILLISECONDS,
        this.accumulatedMilliseconds + elapsed,
      );
    }

    const interval = intervalFor(rate);
    const shouldPresent =
      firstFrame || rateChanged || rate === "display"
        ? true
        : this.accumulatedMilliseconds >= interval;

    if (!shouldPresent) {
      this.ensureNativeFrame();
      return;
    }

    if (rate === "display") {
      this.accumulatedMilliseconds = 0;
    } else {
      this.accumulatedMilliseconds = Math.max(
        0,
        this.accumulatedMilliseconds - interval,
      );
    }

    const callbacks = Array.from(this.callbacks.entries());
    for (const [callbackId] of callbacks) {
      this.callbacks.delete(callbackId);
    }

    let firstError: unknown;
    let hasError = false;
    for (const [, callback] of callbacks) {
      try {
        callback(frameTimestamp);
      } catch (error: unknown) {
        if (!hasError) {
          firstError = error;
          hasError = true;
        }
      }
    }

    if (this.callbacks.size === 0) {
      this.resetPhase();
    }
    this.ensureNativeFrame();

    if (hasError) {
      throw firstError;
    }
  }
}

export function createUiAnimationFrameScheduler(
  options: UiAnimationFrameSchedulerOptions,
): UiAnimationFrameScheduler {
  return new UiAnimationFrameScheduler(options);
}

const nativeFrameSource: FrameSource = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (requestId) => {
    window.cancelAnimationFrame(requestId);
  },
};

const sharedScheduler = createUiAnimationFrameScheduler({
  frameSource: nativeFrameSource,
  getRefreshRate: () =>
    useLayoutPreferenceStore.getState().layout.uiRefreshRate,
});

export function requestUiAnimationFrame(
  callback: UiAnimationFrameCallback,
): number {
  return sharedScheduler.request(callback);
}

export function cancelUiAnimationFrame(callbackId: number): void {
  sharedScheduler.cancel(callbackId);
}
