import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../components/ui/Tooltip";
import { IconAction } from "./IconAction";

describe("IconAction", () => {
  it("renders an icon button with accessible label and tooltip", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TooltipProvider>
        <IconAction icon="action.search" label="Search" onClick={onClick} />
      </TooltipProvider>,
    );

    const button = screen.getByRole("button", { name: "Search" });
    expect(button).toBeInTheDocument();

    await user.hover(button);
    expect((await screen.findAllByText("Search")).length).toBeGreaterThan(0);

    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("exposes an optional shortcut hint inside the tooltip", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <IconAction icon="action.save" label="Save" shortcut="Ctrl+S" />
      </TooltipProvider>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    await user.hover(button);

    expect((await screen.findAllByText("Ctrl+S")).length).toBeGreaterThan(0);
  });

  it("retains a readable tooltip when disabled without duplicate actionable tab stops", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <IconAction
          disabled
          icon="action.save"
          label="Save"
          tooltip="Open a project first."
        />
      </TooltipProvider>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();

    // The wrapper trigger is focusable so keyboard users can inspect why it's disabled,
    // but the button itself is disabled and not actionable.
    const trigger = button.closest(".icon-action__disabled-trigger");
    expect(trigger).not.toBeNull();
    if (!trigger) {
      throw new Error("Trigger element not found");
    }
    expect(trigger).toHaveAttribute("tabindex", "0");
    expect(trigger).toHaveAttribute("aria-label", "Save");

    await user.hover(trigger);
    expect(
      (await screen.findAllByText("Open a project first.")).length,
    ).toBeGreaterThan(0);
  });
});
