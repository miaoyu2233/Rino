import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "../components/ui/Tooltip";
import { applicationI18n } from "../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import { RuntimeStatusIndicator } from "./RuntimeStatusIndicator";
import { useRuntimeStore } from "../ipc/runtime-store";

describe("RuntimeStatusIndicator", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    useRuntimeStore.setState({
      availability: "available",
      status: {
        state: "ready",
        generation: 1,
        automaticRestarts: 0,
        protocolVersion: 1,
        maximumFrameBytes: 1048576,
        runtimeVersion: "Rino Sidecar v1.0.0",
      },
    });
  });

  it("renders status text and discloses runtime version via Tooltip when present", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <RuntimeStatusIndicator />
      </TooltipProvider>,
    );

    expect(screen.getByText("运行时就绪")).toBeInTheDocument();

    const indicator = screen.getByRole("status");
    expect(indicator).toHaveAttribute("tabindex", "0");

    await user.hover(indicator);
    expect(
      (await screen.findAllByText("Rino Sidecar v1.0.0")).length,
    ).toBeGreaterThan(0);
  });

  it("omits tooltip and tabIndex when runtime version is not provided", () => {
    useRuntimeStore.setState({
      availability: "available",
      status: {
        state: "ready",
        generation: 1,
        automaticRestarts: 0,
        protocolVersion: 1,
        maximumFrameBytes: 1048576,
      },
    });

    render(
      <TooltipProvider>
        <RuntimeStatusIndicator />
      </TooltipProvider>,
    );

    const indicator = screen.getByRole("status");
    expect(indicator).not.toHaveAttribute("tabindex");
  });
});
