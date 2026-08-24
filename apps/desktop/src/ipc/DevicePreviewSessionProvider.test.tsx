import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";

import { DevicePreviewSessionProvider } from "./DevicePreviewSessionProvider";
import { useDevicePreviewSession } from "./device-preview-session-context";
import { RuntimeContext, type RuntimeContextValue } from "./runtime-context";
import { useRuntimeStore } from "./runtime-store";

const PREVIEW_TOKEN = "0123456789abcdef0123456789abcdef";
const createObjectUrl = vi.fn(() => "blob:rino-preview");
const revokeObjectUrl = vi.fn();

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
          sourceCoordinateSpaceId: "space-1",
          sourceGeneration: 1,
          byteLength: 8,
          expiresInMilliseconds: 30_000,
        },
      });
    }
    if (request === "previewRelease") {
      return Promise.resolve({ released: true });
    }
    throw new Error(`Unexpected request: ${request}`);
  }) as unknown as RuntimeContextValue["request"];
}

function PreviewSurface({ label }: { label: string }) {
  const session = useDevicePreviewSession();

  useEffect(() => {
    if (session.preview === undefined) {
      void session.capture();
    }
  }, [session.capture, session.preview]);

  return (
    <div>
      <span>{label}</span>
      <span>{session.previewToken ?? "no-preview"}</span>
      <span>{session.previewWidth ?? "no-width"}</span>{" "}
      <span>{session.selectedDevice?.state ?? "none"}</span>
    </div>
  );
}

function SwitchableSurfaces() {
  const [primary, setPrimary] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setPrimary((current) => !current)}>
        Switch surface
      </button>
      <PreviewSurface label={primary ? "primary" : "secondary"} />
    </>
  );
}

function runtimeContext(
  request: RuntimeContextValue["request"],
): RuntimeContextValue {
  const status = useRuntimeStore.getState().status;
  if (status === undefined) {
    throw new Error("Expected a runtime status.");
  }
  return {
    start: () => Promise.resolve(status),
    restart: () => Promise.resolve(status),
    shutdown: () => Promise.resolve({ ...status, state: "stopped" }),
    request,
    readPreview: () =>
      Promise.resolve(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    readCapture: () => Promise.resolve(new Uint8Array()),
  };
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

describe("DevicePreviewSessionProvider", () => {
  it("keeps one session across surface replacement and releases its preview once on provider unmount", async () => {
    const user = userEvent.setup();
    const request = requestDouble();
    const view = render(
      <RuntimeContext.Provider value={runtimeContext(request)}>
        <DevicePreviewSessionProvider>
          <SwitchableSurfaces />
        </DevicePreviewSessionProvider>
      </RuntimeContext.Provider>,
    );

    await waitFor(() => expect(screen.getByText("primary")).toBeVisible());
    await waitFor(() => expect(screen.getByText("connected")).toBeVisible());
    await waitFor(() => expect(screen.getByText(PREVIEW_TOKEN)).toBeVisible());

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledWith("deviceList", {});
    expect(request).toHaveBeenCalledWith("deviceConnect", {
      deviceKey: "device-1",
    });
    expect(request).toHaveBeenCalledWith("previewCapture", {
      deviceKey: "device-1",
      maximumWidth: 1920,
      maximumHeight: 1920,
    });

    await user.click(screen.getByRole("button", { name: "Switch surface" }));
    expect(screen.getByText("secondary")).toBeVisible();
    expect(request).toHaveBeenCalledTimes(3);

    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(4);
    expect(request).toHaveBeenCalledWith("previewRelease", {
      previewToken: PREVIEW_TOKEN,
    });
  });
});
