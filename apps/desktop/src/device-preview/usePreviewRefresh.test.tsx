import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePreviewRefresh } from "./usePreviewRefresh";

const activeOptions = {
  enabled: true,
  deviceConnected: true,
  userPaused: false,
  surfaceVisible: true,
  windowActive: true,
  windowInteracting: false,
  deviceBusy: false,
  graphInteracting: false,
  runActive: false,
  targetRefreshFps: 5,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("preview refresh scheduling", () => {
  it("runs one refresh at the selected cadence and measures successful work", async () => {
    let currentTime = 100;
    const refreshPreview = vi.fn(() => {
      currentTime = 138;
      return Promise.resolve(true);
    });
    const { result } = renderHook(() =>
      usePreviewRefresh({
        ...activeOptions,
        refreshPreview,
        now: () => currentTime,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(refreshPreview).toHaveBeenCalledOnce();
    expect(result.current.lastCaptureDurationMilliseconds).toBe(38);
    expect(result.current.refreshing).toBe(false);
  });

  it("never schedules a second refresh while the previous one is pending", async () => {
    let finish: ((captured: boolean) => void) | undefined;
    const refreshPreview = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() =>
      usePreviewRefresh({ ...activeOptions, refreshPreview, now: () => 0 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(refreshPreview).toHaveBeenCalledOnce();
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      finish?.(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.refreshing).toBe(false);
  });

  it("stops timers while paused, hidden, inactive, or disabled", async () => {
    const refreshPreview = vi.fn(() => Promise.resolve(true));
    const { rerender } = renderHook(
      ({ enabled, surfaceVisible, windowActive }) =>
        usePreviewRefresh({
          ...activeOptions,
          enabled,
          surfaceVisible,
          windowActive,
          refreshPreview,
        }),
      {
        initialProps: {
          enabled: false,
          surfaceVisible: true,
          windowActive: true,
        },
      },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    rerender({ enabled: true, surfaceVisible: false, windowActive: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    rerender({ enabled: true, surfaceVisible: true, windowActive: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(refreshPreview).not.toHaveBeenCalled();
  });

  it("does not capture or queue work while the window is interacting", async () => {
    let finish: ((captured: boolean) => void) | undefined;
    const refreshPreview = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const { rerender } = renderHook(
      ({ windowInteracting }) =>
        usePreviewRefresh({
          ...activeOptions,
          windowInteracting,
          refreshPreview,
          now: () => 0,
        }),
      { initialProps: { windowInteracting: true } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(refreshPreview).not.toHaveBeenCalled();

    rerender({ windowInteracting: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(refreshPreview).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(refreshPreview).toHaveBeenCalledOnce();

    rerender({ windowInteracting: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(refreshPreview).toHaveBeenCalledOnce();

    await act(async () => {
      finish?.(true);
      await vi.advanceTimersByTimeAsync(0);
    });

    rerender({ windowInteracting: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(refreshPreview).toHaveBeenCalledTimes(2);
  });
});
