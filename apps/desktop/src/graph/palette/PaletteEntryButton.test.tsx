import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/Tooltip";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import type { PaletteEntry } from "./palette-model";
import { PaletteEntryButton } from "./PaletteEntryButton";

const mockNodeEntry: PaletteEntry = {
  kind: "node",
  key: "core.flow.start",
  titleKey: "node.core.flow.start.title",
  descriptionKey: "node.core.flow.start.description",
  category: "flow",
  requiredCapabilities: [],
  keywordKeys: ["start"],
  iconKey: "category.flow",
  ports: [],
};

const mockTemplateEntry: PaletteEntry = {
  kind: "template",
  key: "template.compareNumbersAndBranch",
  titleKey: "template.compareNumbersAndBranch.title",
  descriptionKey: "template.compareNumbersAndBranch.description",
  category: "templates",
  requiredCapabilities: [],
  keywordKeys: ["template"],
  iconKey: "category.flow",
  ports: [],
};

const mockLabels = {
  title: "Start",
  secondaryTitle: "core.flow.start",
  description: "The graph entry point.",
};

const mockTemplateLabels = {
  title: "Compare numbers and branch",
  secondaryTitle: "template.compareNumbersAndBranch",
  description: "Inserts compare and branch nodes.",
};

describe("PaletteEntryButton", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
  });

  it("renders a node entry without template badge", () => {
    render(
      <TooltipProvider>
        <PaletteEntryButton
          entry={mockNodeEntry}
          labels={mockLabels}
          capability="satisfied"
          onActivate={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.queryByText("模板")).not.toBeInTheDocument();
  });

  it("renders a template badge, explains ordinary-node insertion, and keeps keyboard activation", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <TooltipProvider>
        <PaletteEntryButton
          entry={mockTemplateEntry}
          labels={mockTemplateLabels}
          capability="satisfied"
          onActivate={onActivate}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Compare numbers and branch")).toBeInTheDocument();
    expect(screen.getByText("模板")).toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: /Compare numbers and branch/,
    });

    await user.hover(button);
    expect(
      await screen.findAllByText(
        "插入可独立编辑的常规节点组合，支持单步撤销。",
      ),
    ).not.toHaveLength(0);

    button.focus();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it("renders localized insertion hint in tooltip", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <PaletteEntryButton
          entry={mockNodeEntry}
          labels={mockLabels}
          capability="satisfied"
          onActivate={vi.fn()}
        />
      </TooltipProvider>,
    );

    const button = screen.getByRole("button", { name: /Start/ });
    await user.hover(button);

    expect(
      (await screen.findAllByText("拖拽到画布指定位置，或点击在视图中央插入。"))
        .length,
    ).toBeGreaterThan(0);
  });

  it("keeps an unavailable entry focusable but blocks insertion", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onDisabledActivate = vi.fn();
    render(
      <TooltipProvider>
        <PaletteEntryButton
          entry={mockNodeEntry}
          labels={mockLabels}
          capability="satisfied"
          disabled
          disabledDescription="Create or open a project first."
          onActivate={onActivate}
          onDisabledActivate={onDisabledActivate}
        />
      </TooltipProvider>,
    );

    const button = screen.getByRole("button", { name: /Start/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("draggable", "false");

    await user.click(button);

    expect(onActivate).not.toHaveBeenCalled();
    expect(onDisabledActivate).toHaveBeenCalledOnce();
  });
});
