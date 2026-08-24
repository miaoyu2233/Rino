import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Select } from "./Select";

describe("Select", () => {
  it("opens a themed listbox and reports a keyboard-accessible selection", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Select
        aria-label="匹配方式"
        value="template"
        options={[
          { value: "template", label: "模板匹配" },
          { value: "feature", label: "特征匹配" },
        ]}
        onValueChange={onValueChange}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "匹配方式" }));
    expect(screen.getByRole("listbox")).toHaveClass("ui-select__content");
    await user.click(screen.getByRole("option", { name: "特征匹配" }));

    expect(onValueChange).toHaveBeenCalledWith("feature");
  });

  it("shows a placeholder and remains unavailable when disabled", () => {
    render(
      <Select
        aria-label="设备"
        value=""
        placeholder="未发现设备"
        options={[]}
        disabled
        onValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "设备" })).toBeDisabled();
    expect(screen.getByText("未发现设备")).toBeVisible();
  });

  it("shows help for the highlighted option and follows keyboard navigation", async () => {
    const user = userEvent.setup();
    render(
      <Select
        aria-label="匹配方式"
        value="template"
        options={[
          {
            value: "template",
            label: "模板匹配",
            description: "适合外观稳定的目标。",
          },
          {
            value: "feature",
            label: "特征匹配",
            description: "允许一定缩放或旋转。",
          },
        ]}
        onValueChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "匹配方式" }));
    expect(screen.getByRole("note")).toHaveTextContent("适合外观稳定的目标");

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("note")).toHaveTextContent("允许一定缩放或旋转");
  });
});
