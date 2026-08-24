import { describe, expect, it } from "vitest";

import { choosePreviewRefreshPolicy } from "./preview-policy";

const active = {
  deviceConnected: true,
  userPaused: false,
  surfaceVisible: true,
  windowActive: true,
  deviceBusy: false,
  graphInteracting: false,
  runActive: false,
  targetRefreshFps: 5,
};

describe("device preview refresh policy", () => {
  it.each([
    [{ ...active, deviceConnected: false }, "disconnected"],
    [{ ...active, userPaused: true }, "userPaused"],
    [{ ...active, surfaceVisible: false }, "surfaceHidden"],
    [{ ...active, windowActive: false }, "windowInactive"],
  ] as const)("pauses when acquisition should stop", (context, reason) => {
    expect(choosePreviewRefreshPolicy(context)).toEqual({
      mode: "paused",
      reason,
    });
  });

  it("uses the selected rate while preserving run and busy backoff", () => {
    expect(choosePreviewRefreshPolicy(active)).toEqual({
      mode: "refresh",
      intervalMilliseconds: 200,
    });
    expect(
      choosePreviewRefreshPolicy({ ...active, graphInteracting: true }),
    ).toEqual({ mode: "refresh", intervalMilliseconds: 200 });
    expect(choosePreviewRefreshPolicy({ ...active, runActive: true })).toEqual({
      mode: "refresh",
      intervalMilliseconds: 200,
    });
    expect(choosePreviewRefreshPolicy({ ...active, deviceBusy: true })).toEqual(
      {
        mode: "refresh",
        intervalMilliseconds: 500,
      },
    );
  });

  it("accounts for completed capture time without overlapping work", () => {
    expect(
      choosePreviewRefreshPolicy({
        ...active,
        lastCaptureDurationMilliseconds: 87,
      }),
    ).toEqual({ mode: "refresh", intervalMilliseconds: 113 });
    expect(
      choosePreviewRefreshPolicy({
        ...active,
        lastCaptureDurationMilliseconds: 233,
      }),
    ).toEqual({ mode: "refresh", intervalMilliseconds: 16 });
  });

  it("bounds requested refresh rates to the supported one-to-ten FPS range", () => {
    expect(
      choosePreviewRefreshPolicy({ ...active, targetRefreshFps: 1 }),
    ).toEqual({ mode: "refresh", intervalMilliseconds: 1000 });
    expect(
      choosePreviewRefreshPolicy({ ...active, targetRefreshFps: 10 }),
    ).toEqual({ mode: "refresh", intervalMilliseconds: 100 });
  });
});
