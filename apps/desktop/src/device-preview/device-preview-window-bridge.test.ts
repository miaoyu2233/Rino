import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, isTauri, listen, currentWindow } = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
  currentWindow: { label: "main" },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => currentWindow,
}));

import {
  createDevicePreviewWindowBridge,
  decodeDevicePreviewSnapshot,
  isDevicePreviewWindow,
  type DevicePreviewWindowSnapshot,
} from "./device-preview-window-bridge";

const initialUrl = window.location.href;

const snapshot: DevicePreviewWindowSnapshot = {
  generation: 7,
  phase: "ready",
  previewToken: "0123456789abcdef0123456789abcdef",
  width: 1_080,
  height: 1_920,
  interactionAvailable: true,
};

beforeEach(() => {
  invoke.mockReset();
  isTauri.mockReturnValue(true);
  currentWindow.label = "main";
  listen.mockReset();
  listen.mockResolvedValue(() => undefined);
});

afterEach(() => {
  window.history.replaceState({}, "", initialUrl);
});

describe("device preview snapshot codec", () => {
  it("accepts the bounded bridge shape and rejects unknown fields", () => {
    expect(decodeDevicePreviewSnapshot(snapshot)).toEqual(snapshot);
    expect(
      decodeDevicePreviewSnapshot({ ...snapshot, objectUrl: "blob:private" }),
    ).toBeUndefined();
    expect(
      decodeDevicePreviewSnapshot({
        ...snapshot,
        previewToken: "not-a-preview-token",
      }),
    ).toBeUndefined();
    expect(
      decodeDevicePreviewSnapshot({ ...snapshot, phase: "failed" }),
    ).toBeUndefined();
    expect(
      decodeDevicePreviewSnapshot({ ...snapshot, width: 0 }),
    ).toBeUndefined();
    expect(
      decodeDevicePreviewSnapshot({ ...snapshot, height: undefined }),
    ).toBeUndefined();
  });

  it("accepts a snapshot without an active image", () => {
    expect(
      decodeDevicePreviewSnapshot({
        generation: 0,
        phase: "disconnected",
        interactionAvailable: false,
      }),
    ).toEqual({
      generation: 0,
      phase: "disconnected",
      interactionAvailable: false,
    });
  });
});

describe("device preview window bridge", () => {
  it("uses only the fixed native commands and bounded snapshot payload", async () => {
    const bridge = createDevicePreviewWindowBridge();
    await bridge.open();
    await bridge.publish(snapshot);
    await bridge.close();
    await bridge.focus();

    expect(invoke.mock.calls).toEqual([
      ["device_preview_open"],
      ["device_preview_publish", { snapshot }],
      ["device_preview_close"],
      ["device_preview_focus"],
    ]);
  });

  it("identifies the preview window by native label in Tauri", () => {
    expect(isDevicePreviewWindow()).toBe(false);
    currentWindow.label = "device-preview";
    expect(isDevicePreviewWindow()).toBe(true);
  });

  it("uses the query route only outside Tauri", () => {
    isTauri.mockReturnValue(false);
    window.history.replaceState({}, "", "?window=device-preview");
    expect(isDevicePreviewWindow()).toBe(true);
    window.history.replaceState({}, "", "?window=main");
    expect(isDevicePreviewWindow()).toBe(false);
  });

  it("allows the bridge only in the Tauri main window", () => {
    const bridge = createDevicePreviewWindowBridge();
    expect(bridge.isAvailable()).toBe(true);
    currentWindow.label = "device-preview";
    expect(bridge.isAvailable()).toBe(false);
    isTauri.mockReturnValue(false);
    expect(bridge.isAvailable()).toBe(false);
  });

  it("strictly decodes current and event snapshots", async () => {
    const bridge = createDevicePreviewWindowBridge();
    invoke.mockResolvedValueOnce(snapshot);
    await expect(bridge.current()).resolves.toEqual(snapshot);
    invoke.mockResolvedValueOnce({ ...snapshot, localPath: "C:\\private" });
    await expect(bridge.current()).rejects.toThrow();

    let onSnapshot: ((event: { payload: unknown }) => void) | undefined;
    listen.mockImplementationOnce(
      async (_name: string, handler: (event: { payload: unknown }) => void) => {
        onSnapshot = handler;
        return () => undefined;
      },
    );
    const received: DevicePreviewWindowSnapshot[] = [];
    await bridge.listen((value) => received.push(value));
    onSnapshot?.({ payload: { ...snapshot, errorDetail: "private" } });
    onSnapshot?.({ payload: snapshot });
    expect(received).toEqual([snapshot]);
  });
});
