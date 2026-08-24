import type { RinoNodeRegistrySnapshotV1 } from "@rino/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import coreDefinitions from "../../../../../contracts/fixtures/registry/valid/core-definitions.json";
import { applicationI18n } from "../../localization/i18n";
import {
  buildPaletteEntries,
  type PaletteEntry,
} from "../palette/palette-model";
import type { PaletteCatalog } from "../palette/usePaletteCatalog";
import { QuickAddPanel, type QuickAddRequest } from "./QuickAddPanel";

const quickAddMocks = vi.hoisted(() => ({
  insertPaletteEntry: vi.fn(),
  usePaletteCatalog: vi.fn(),
  applyRepeatHintAction: vi.fn(),
}));

vi.mock("../palette/insert-entry", () => ({
  insertPaletteEntry: quickAddMocks.insertPaletteEntry,
}));

vi.mock("../palette/usePaletteCatalog", () => ({
  usePaletteCatalog: quickAddMocks.usePaletteCatalog,
}));

vi.mock("./repeat-hint-actions", () => ({
  applyRepeatHintAction: quickAddMocks.applyRepeatHintAction,
}));

const entries = buildPaletteEntries(
  coreDefinitions as unknown as RinoNodeRegistrySnapshotV1,
);

function entryFor(key: string): PaletteEntry {
  const entry = entries.find((candidate) => candidate.key === key);
  if (entry === undefined) {
    throw new Error(`Missing fixture palette entry: ${key}`);
  }
  return entry;
}

const catalog: PaletteCatalog = {
  entries,
  lookup: (entry) => ({
    titles: [entry.key],
    keywords: [],
    descriptions: [],
  }),
  describe: (entry) => ({
    title: entry.key,
    secondaryTitle: entry.category,
    description: entry.descriptionKey,
  }),
};

const request: QuickAddRequest = {
  position: { x: 320, y: 180 },
  connectFrom: {
    nodeId: "source-node",
    portId: "next",
    type: { kind: "exec" },
    portKind: "execution",
    direction: "output",
  },
};

function resultButton(key: string): HTMLButtonElement {
  const button = screen.getByText(key).closest("button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing quick-add button for ${key}`);
  }
  return button;
}

describe("QuickAddPanel context matching", () => {
  beforeEach(() => {
    quickAddMocks.insertPaletteEntry.mockReset();
    quickAddMocks.usePaletteCatalog.mockReset();
    quickAddMocks.applyRepeatHintAction.mockReset();
    quickAddMocks.usePaletteCatalog.mockReturnValue(catalog);
    void applicationI18n.changeLanguage("zh-CN");
  });

  it("shows only compatible nodes while context matching is enabled", () => {
    render(<QuickAddPanel request={request} onClose={vi.fn()} />);

    expect(screen.getByRole("switch", { name: "情景匹配" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("template.imageRecognition")).toBeInTheDocument();
    expect(screen.getByText("template.textRecognition")).toBeInTheDocument();
    expect(
      screen.getByText("template.recognizeNumberAndBranch"),
    ).toBeInTheDocument();
    expect(screen.getByText("core.logic.branch")).toBeInTheDocument();
    expect(
      screen.queryByText("core.value.numberLiteral"),
    ).not.toBeInTheDocument();
  });

  it("shows the full catalog when disabled and inserts incompatible entries unconnected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<QuickAddPanel request={request} onClose={onClose} />);

    await user.click(screen.getByRole("switch", { name: "情景匹配" }));
    expect(screen.getByText("core.value.numberLiteral")).toBeInTheDocument();

    await user.click(resultButton("core.value.numberLiteral"));

    expect(quickAddMocks.insertPaletteEntry).toHaveBeenCalledWith(
      entryFor("core.value.numberLiteral"),
      { centerOn: request.position },
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the automatic connection for compatible entries when the filter is disabled", async () => {
    const user = userEvent.setup();
    render(<QuickAddPanel request={request} onClose={vi.fn()} />);

    await user.click(screen.getByRole("switch", { name: "情景匹配" }));
    await user.click(resultButton("core.logic.branch"));

    expect(quickAddMocks.insertPaletteEntry).toHaveBeenCalledWith(
      entryFor("core.logic.branch"),
      {
        centerOn: request.position,
        connectFrom: request.connectFrom,
      },
    );
  });

  it("passes the execution origin when a template is selected", async () => {
    const user = userEvent.setup();
    render(<QuickAddPanel request={request} onClose={vi.fn()} />);

    await user.click(resultButton("template.recognizeNumberAndBranch"));

    expect(quickAddMocks.insertPaletteEntry).toHaveBeenCalledWith(
      entryFor("template.recognizeNumberAndBranch"),
      {
        centerOn: request.position,
        connectFrom: request.connectFrom,
      },
    );
  });

  it("shows the repeat editor action separately from palette entries", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const repeatRequest: QuickAddRequest = {
      position: { x: 320, y: 180 },
      repeatAction: {
        graphId: "graph",
        source: { nodeId: "source", portId: "noMatch" },
        position: { x: 320, y: 180 },
        target: {
          visualNodeId: "recognizer",
          stableId: "recognizer",
          target: { nodeId: "recognizer", portId: "run" },
          titleKey: "node.vision.ocr.title",
        },
      },
    };
    quickAddMocks.applyRepeatHintAction.mockReturnValue(true);

    render(<QuickAddPanel request={repeatRequest} onClose={onClose} />);

    const action = screen.getByRole("button", { name: /重复执行/u });
    expect(action).toHaveAttribute("data-editor-action", "repeat");
    expect(action).toHaveTextContent("沿原连线返回到：文字识别");
    await user.click(action);

    expect(quickAddMocks.applyRepeatHintAction).toHaveBeenCalledWith(
      repeatRequest.repeatAction,
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables the repeat action when no visible upstream recognition exists", () => {
    const repeatRequest: QuickAddRequest = {
      position: { x: 0, y: 0 },
      repeatAction: {
        graphId: "graph",
        source: { nodeId: "source", portId: "notReached" },
        position: { x: 0, y: 0 },
        target: undefined,
      },
    };

    render(<QuickAddPanel request={repeatRequest} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /重复执行/u })).toBeDisabled();
    expect(screen.getByText("当前画布没有可返回的识别节点")).toHaveTextContent(
      "当前画布没有可返回的识别节点",
    );
  });
});
