import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

import { RuntimeContext, type RuntimeContextValue } from "./runtime-context";
import { useRuntimeStore } from "./runtime-store";
import { useDevicePreview, type PreviewLease } from "./useDevicePreview";

const PREVIEW_TOKEN = "0123456789abcdef0123456789abcdef";
const createObjectUrl = vi.fn(() => "blob:rino-preview");
const revokeObjectUrl = vi.fn();

function PreviewHarness() {
  const preview = useDevicePreview();
  const leaseRef = useRef<PreviewLease | undefined>(undefined);
  return (
    <div>
      <span>{preview.selectedDevice?.state ?? "none"}</span>
      <span>{preview.preview?.objectUrl ?? "no-preview"}</span>
      <span>{preview.preview?.descriptor.previewToken ?? "no-token"}</span>
      <button type="button" onClick={() => void preview.connect()}>
        Connect
      </button>
      <button type="button" onClick={() => void preview.capture()}>
        Capture
      </button>
      <button type="button" onClick={() => void preview.refreshPreview()}>
        Refresh
      </button>
      <button
        type="button"
        onClick={() => {
          leaseRef.current = preview.acquirePreviewLease();
        }}
      >
        Hold
      </button>
      <button
        type="button"
        onClick={() => {
          leaseRef.current?.release();
          leaseRef.current = undefined;
        }}
      >
        Release hold
      </button>
      <button
        type="button"
        onClick={() =>
          void preview.interact({
            kind: "click",
            point: {
              x: 12,
              y: 34,
              coordinateSpaceId: "space-1",
              sourceGeneration: 1,
            },
          })
        }
      >
        Control
      </button>
    </div>
  );
}

function requestDouble(): RuntimeContextValue["request"] {
  return vi.fn((request: string) => {
    if (request === "deviceList") {
      return Promise.resolve({
        devices: [
          {
            deviceKey: "device-1",
            displayName: "Emulator",
            controllerFamily: "adb",
            state: "disconnected",
          },
        ],
      });
    }
    if (request === "deviceConnect") {
      return Promise.resolve({
        device: {
          deviceKey: "device-1",
          displayName: "Emulator",
          controllerFamily: "adb",
          state: "connected",
        },
      });
    }
    if (request === "previewCapture") {
      return Promise.resolve({
        preview: {
          previewToken: PREVIEW_TOKEN,
          mediaType: "image/png",
          width: 1,
          height: 1,
          sourceWidth: 1080,
          sourceHeight: 1920,
          sourceGeneration: 1,
          byteLength: 8,
          expiresInMilliseconds: 30_000,
        },
      });
    }
    if (request === "previewRelease") {
      return Promise.resolve({ released: true });
    }
    if (request === "deviceInteract") {
      return Promise.resolve({ completed: true, kind: "click" });
    }
    throw new Error(`Unexpected request: ${request}`);
  }) as unknown as RuntimeContextValue["request"];
}

beforeEach(() => {
  createObjectUrl.mockClear();
  revokeObjectUrl.mockClear();
  useRuntimeStore.setState({
    availability: "available",
    status: {
      state: "ready",
      generation: 1,
      automaticRestarts: 0,
      protocolVersion: 1,
      maximumFrameBytes: 1_048_576,
      featureFlags: [
        "runtime.deviceManagement",
        "runtime.devicePreview",
        "runtime.deviceControl",
      ],
    },
    readySignalReceived: true,
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectUrl,
  });
});

describe("useDevicePreview", () => {
  it("automatically connects a discovered device, displays one bounded preview, and releases it on unmount", async () => {
    const user = userEvent.setup();
    const request = requestDouble();
    const readPreview = vi.fn(() =>
      Promise.resolve(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    );
    const status = useRuntimeStore.getState().status;
    if (status === undefined) {
      throw new Error("Expected a runtime status.");
    }
    const view = render(
      <RuntimeContext.Provider
        value={{
          start: () => Promise.resolve(status),
          restart: () => Promise.resolve(status),
          shutdown: () => Promise.resolve({ ...status, state: "stopped" }),
          request,
          readPreview,
          readCapture: () => Promise.resolve(new Uint8Array()),
        }}
      >
        <PreviewHarness />
      </RuntimeContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("connected")).toBeVisible());
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith("deviceConnect", {
      deviceKey: "device-1",
    });
    await user.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() =>
      expect(screen.getByText("blob:rino-preview")).toBeVisible(),
    );

    expect(readPreview).toHaveBeenCalledWith(PREVIEW_TOKEN);
    expect(request).toHaveBeenCalledWith("previewCapture", {
      deviceKey: "device-1",
      maximumWidth: 1920,
      maximumHeight: 1920,
    });
    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:rino-preview");
    expect(request).toHaveBeenCalledWith("previewRelease", {
      previewToken: PREVIEW_TOKEN,
    });
  });

  it("sends a versioned interaction once for a connected device", async () => {
    const user = userEvent.setup();
    const request = requestDouble();
    const status = useRuntimeStore.getState().status;
    if (status === undefined) {
      throw new Error("Expected a runtime status.");
    }
    render(
      <RuntimeContext.Provider
        value={{
          start: () => Promise.resolve(status),
          restart: () => Promise.resolve(status),
          shutdown: () => Promise.resolve({ ...status, state: "stopped" }),
          request,
          readPreview: () => Promise.resolve(new Uint8Array()),
          readCapture: () => Promise.resolve(new Uint8Array()),
        }}
      >
        <PreviewHarness />
      </RuntimeContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("connected")).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Control" }));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("deviceInteract", {
        deviceKey: "device-1",
        interaction: {
          kind: "click",
          point: {
            x: 12,
            y: 34,
            coordinateSpaceId: "space-1",
            sourceGeneration: 1,
          },
        },
      });
    });
  });

  it("keeps a leased frame visible when an in-flight refresh completes", async () => {
    const user = userEvent.setup();
    const firstToken = "00000000000000000000000000000001";
    const secondToken = "00000000000000000000000000000002";
    let previewCaptureCount = 0;
    const baseRequest = requestDouble();
    const request = vi.fn((requestName: string, payload: unknown) => {
      if (requestName !== "previewCapture") {
        return baseRequest(requestName as never, payload as never);
      }
      previewCaptureCount += 1;
      const previewToken = previewCaptureCount === 1 ? firstToken : secondToken;
      return Promise.resolve({
        preview: {
          previewToken,
          mediaType: "image/png" as const,
          width: 1,
          height: 1,
          sourceWidth: 1080,
          sourceHeight: 1920,
          sourceCoordinateSpaceId: "space-1",
          sourceGeneration: previewCaptureCount,
          byteLength: 8,
          expiresInMilliseconds: 30_000,
        },
      });
    }) as unknown as RuntimeContextValue["request"];
    const status = useRuntimeStore.getState().status;
    if (status === undefined) {
      throw new Error("Expected a runtime status.");
    }
    render(
      <RuntimeContext.Provider
        value={{
          start: () => Promise.resolve(status),
          restart: () => Promise.resolve(status),
          shutdown: () => Promise.resolve({ ...status, state: "stopped" }),
          request,
          readPreview: () =>
            Promise.resolve(
              new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            ),
          readCapture: () => Promise.resolve(new Uint8Array()),
        }}
      >
        <PreviewHarness />
      </RuntimeContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("connected")).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() => expect(screen.getByText(firstToken)).toBeVisible());

    await user.click(screen.getByRole("button", { name: "Hold" }));
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith("previewRelease", {
        previewToken: secondToken,
      });
    });
    expect(screen.getByText(firstToken)).toBeVisible();
    expect(request).not.toHaveBeenCalledWith("previewRelease", {
      previewToken: firstToken,
    });
  });

  it("shares one in-flight preview capture between automatic and manual callers", async () => {
    const user = userEvent.setup();
    let resolvePreview:
      | ((value: {
          preview: {
            previewToken: string;
            mediaType: "image/png";
            width: number;
            height: number;
            sourceWidth: number;
            sourceHeight: number;
            sourceCoordinateSpaceId: string;
            sourceGeneration: number;
            byteLength: number;
            expiresInMilliseconds: number;
          };
        }) => void)
      | undefined;
    let previewCaptureCalls = 0;
    const baseRequest = requestDouble();
    const request = vi.fn((requestName: string, payload: unknown) => {
      if (requestName !== "previewCapture") {
        return baseRequest(requestName as never, payload as never);
      }
      previewCaptureCalls += 1;
      return new Promise((resolve) => {
        resolvePreview = resolve;
      });
    }) as unknown as RuntimeContextValue["request"];
    const status = useRuntimeStore.getState().status;
    if (status === undefined) {
      throw new Error("Expected a runtime status.");
    }
    render(
      <RuntimeContext.Provider
        value={{
          start: () => Promise.resolve(status),
          restart: () => Promise.resolve(status),
          shutdown: () => Promise.resolve({ ...status, state: "stopped" }),
          request,
          readPreview: () =>
            Promise.resolve(
              new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            ),
          readCapture: () => Promise.resolve(new Uint8Array()),
        }}
      >
        <PreviewHarness />
      </RuntimeContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("connected")).toBeVisible());
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        "previewCapture",
        expect.any(Object),
      );
    });
    await user.click(screen.getByRole("button", { name: "Capture" }));
    expect(previewCaptureCalls).toBe(1);

    resolvePreview?.({
      preview: {
        previewToken: PREVIEW_TOKEN,
        mediaType: "image/png",
        width: 1,
        height: 1,
        sourceWidth: 1080,
        sourceHeight: 1920,
        sourceCoordinateSpaceId: "space-1",
        sourceGeneration: 1,
        byteLength: 8,
        expiresInMilliseconds: 30_000,
      },
    });
    await waitFor(() => expect(screen.getByText(PREVIEW_TOKEN)).toBeVisible());
  });
});
