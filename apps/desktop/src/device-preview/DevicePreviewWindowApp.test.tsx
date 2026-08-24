import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applicationI18n } from "../localization/i18n";
import { LocaleProvider } from "../localization/LocaleProvider";
import { DevicePreviewWindowApp } from "./DevicePreviewWindowApp";
import type {
  DevicePreviewWindowBridge,
  DevicePreviewWindowSnapshot,
} from "./device-preview-window-bridge";

const FIRST_TOKEN = "0123456789abcdef0123456789abcdef";
const SECOND_TOKEN = "abcdef0123456789abcdef0123456789";

function readySnapshot(
  generation: number,
  previewToken: string,
): DevicePreviewWindowSnapshot {
  return {
    generation,
    phase: "ready",
    previewToken,
    width: 1_080,
    height: 1_920,
    interactionAvailable: false,
  };
}

function createBridge(
  currentSnapshot: DevicePreviewWindowSnapshot | undefined,
) {
  let listener: ((snapshot: DevicePreviewWindowSnapshot) => void) | undefined;
  const close = vi.fn(() => Promise.resolve());
  const bridge: DevicePreviewWindowBridge = {
    isAvailable: () => false,
    open: () => Promise.resolve(),
    publish: () => Promise.resolve(),
    current: () => Promise.resolve(currentSnapshot),
    close,
    focus: () => Promise.resolve(),
    listen: (nextListener) => {
      listener = nextListener;
      return Promise.resolve(() => {
        listener = undefined;
      });
    },
  };
  return {
    bridge,
    close,
    emit: (snapshot: DevicePreviewWindowSnapshot) => listener?.(snapshot),
  };
}

function renderWindow(
  bridge: DevicePreviewWindowBridge,
  readPreview: (previewToken: string) => Promise<Uint8Array>,
) {
  return render(
    <LocaleProvider>
      <DevicePreviewWindowApp bridge={bridge} readPreview={readPreview} />
    </LocaleProvider>,
  );
}

beforeEach(async () => {
  await applicationI18n.changeLanguage("zh-CN");
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi
        .fn()
        .mockReturnValueOnce("blob:first")
        .mockReturnValueOnce("blob:second"),
      revokeObjectURL: vi.fn(),
    }),
  );
});

describe("DevicePreviewWindowApp", () => {
  it("reads token-backed frames, ignores stale generations, and revokes only local object URLs", async () => {
    const bridge = createBridge(readySnapshot(2, FIRST_TOKEN));
    const readPreview = vi.fn(() =>
      Promise.resolve(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    );
    const view = renderWindow(bridge.bridge, readPreview);

    expect(
      await screen.findByRole("img", { name: "Device screen" }),
    ).toHaveAttribute("src", "blob:first");
    expect(readPreview).toHaveBeenCalledWith(FIRST_TOKEN);

    act(() => bridge.emit(readySnapshot(3, SECOND_TOKEN)));
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Device screen" }),
      ).toHaveAttribute("src", "blob:second"),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first");

    act(() => bridge.emit(readySnapshot(1, FIRST_TOKEN)));
    expect(readPreview).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:second");
    expect(bridge.close).not.toHaveBeenCalled();
  });

  it("shows the main session empty state and closes only through the native bridge", async () => {
    const user = userEvent.setup();
    const bridge = createBridge({
      generation: 1,
      phase: "unavailable",
      interactionAvailable: false,
    });
    renderWindow(bridge.bridge, vi.fn());

    expect(
      await screen.findAllByText("Device backend is not configured"),
    ).toHaveLength(2);
    expect(screen.getByText(/runtime has no local ADB backend/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Close separate device preview" }),
    );
    expect(bridge.close).toHaveBeenCalledTimes(1);
  });
});
