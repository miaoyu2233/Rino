import type { NodeV1, RinoProjectDocumentV1 } from "@rino/contracts";
import axe from "axe-core";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../app/App";
import { createEmptyProject } from "../graph/project-factory";
import { sceneIdentifier } from "../test/graph-scenes";
import {
  DARK_THEME_QUERY,
  installMatchingMediaQueries,
} from "../test/media-queries";
import { installInMemoryProjectService } from "../test/project-transport-double";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../graph/store/project-lifecycle";
import { applicationI18n } from "../localization/i18n";
import { enUSTranslation, zhCNTranslation } from "../localization/catalogs";
import { LOCALE_STORAGE_KEY } from "../localization/locale-state";
import { THEME_STORAGE_KEY } from "../design-system/theme/theme-state";
import { useLayoutPreferenceStore } from "../preferences/layout-preference-store";
import { defaultLayoutPreferences } from "../preferences/layout-preferences";
import { useEditorSessionStore } from "../graph/store/editor-session-store";
import { useDocumentStore } from "../graph/store/document-store";
import { useRuntimeExecutionStore } from "../ipc/runtime-execution-store";

/** The accessible-name sources this project uses. `title` counts because the canvas draws
 * labels that truncate, and the style guide requires the full text to stay reachable. */
function accessibleName(element: Element): string {
  for (const attribute of ["aria-label", "title"]) {
    const value = element.getAttribute(attribute)?.trim() ?? "";
    if (value.length > 0) {
      return value;
    }
  }
  return element.textContent.trim();
}

function node(
  localName: string,
  typeKey: string,
  overrides: Partial<NodeV1> = {},
): NodeV1 {
  return {
    nodeId: sceneIdentifier(`accessibility/${localName}`),
    typeKey,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
    ...overrides,
  };
}

/** A small document covering the node states whose meaning must survive without colour. */
function statesDocument(): RinoProjectDocumentV1 {
  const document = createEmptyProject({
    name: "可访问性场景",
    entryGraphName: "主图",
    createdAt: "2026-07-27T00:00:00.000Z",
    createIdentifier: (() => {
      let index = 0;
      return () => sceneIdentifier(`accessibility/document/${String(index++)}`);
    })(),
  });
  const graph = document.graphs[0];
  if (graph === undefined) {
    throw new Error("A new project always holds its entry graph.");
  }
  return {
    ...document,
    graphs: [
      {
        ...graph,
        nodes: [
          node("start", "core.flow.start"),
          node("compare", "core.logic.numberCompare", {
            position: { x: 240, y: 0 },
            properties: { operator: "greaterThan" },
            inputValues: { left: 3, right: 5 },
          }),
          node("branch", "core.logic.branch", {
            position: { x: 480, y: 0 },
            breakpoint: true,
          }),
          node("recognize", "vision.ocr", {
            position: { x: 720, y: 0 },
            disabled: true,
          }),
        ],
        edges: [],
      },
    ],
  };
}

function countCatalogCharacters(value: unknown): number {
  if (typeof value === "string") {
    return value.length;
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).reduce<number>(
      (total, entry) => total + countCatalogCharacters(entry),
      0,
    );
  }
  return 0;
}

async function openStatesProject(): Promise<void> {
  render(<App />);
  act(() => {
    openProjectDocument(statesDocument());
  });
  await screen.findByLabelText("节点图");
}

/** An accessibility audit walks the whole rendered tree and takes seconds, and how many
 * seconds depends on how much of the machine the other test files are using. The
 * assertion is the list of violations, not the wall clock. */
const AUDIT_TIMEOUT_MILLISECONDS = 60_000;

describe(
  "editor accessibility gate",
  { timeout: AUDIT_TIMEOUT_MILLISECONDS },
  () => {
    beforeEach(() => {
      window.localStorage.clear();
      window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
      void applicationI18n.changeLanguage("zh-CN");
      useLayoutPreferenceStore.setState({
        layout: { ...defaultLayoutPreferences },
      });
      closeProjectDocument();
      installInMemoryProjectService();
      installMatchingMediaQueries([]);
    });

    it("has no detectable structural violation with a graph and its diagnostics open", async () => {
      await openStatesProject();
      act(() => {
        useEditorSessionStore
          .getState()
          .setSelection([sceneIdentifier("accessibility/recognize")], []);
      });

      // The problems tab is the default, so the diagnostics this graph produces are on
      // screen and are part of what is being checked.
      expect(screen.getByText("图诊断")).toBeInTheDocument();
      expect(
        screen.getByRole("region", { name: "文字识别概览" }),
      ).toBeInTheDocument();

      const result = await axe.run(document.body, {
        // Contrast needs a layout engine and real stylesheets; it is checked on the running
        // desktop application instead and is recorded as a manual gate item.
        rules: { "color-contrast": { enabled: false } },
      });
      expect(result.violations).toEqual([]);
    });

    it("has no detectable structural violation in the dark theme", async () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      installMatchingMediaQueries([DARK_THEME_QUERY]);
      await openStatesProject();

      expect(document.documentElement.dataset["theme"]).toBe("dark");

      const result = await axe.run(document.body, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(result.violations).toEqual([]);
    });

    it("names every control the shell renders", async () => {
      await openStatesProject();

      const unnamed = [...document.querySelectorAll("button, [role='button']")]
        .filter((element) => accessibleName(element).length === 0)
        .map((element) => element.outerHTML);

      expect(unnamed).toEqual([]);
    });

    it("takes no control out of the tab order and gives none a forced position", async () => {
      await openStatesProject();

      const forced = [...document.querySelectorAll("[tabindex]")]
        .map((element) => Number(element.getAttribute("tabindex")))
        .filter((value) => value > 0);

      expect(forced).toEqual([]);
    });

    it("states a node's disabled and breakpoint status in words, not only in colour", async () => {
      await openStatesProject();

      const canvas = within(screen.getByLabelText("节点图"));
      expect(canvas.getByLabelText("已设置断点")).toBeInTheDocument();
      expect(canvas.getByLabelText("已停用")).toBeInTheDocument();
      // The graph diagnostics say which severity a row carries rather than relying on the
      // row's colour.
      expect(screen.getAllByText("错误").length).toBeGreaterThan(0);
    });

    it("shows a node's name in both display languages", async () => {
      await openStatesProject();

      const canvas = within(screen.getByLabelText("节点图"));
      expect(canvas.getByText("数值比较")).toBeInTheDocument();
      expect(canvas.getByText("Compare numbers")).toBeInTheDocument();

      await act(async () => {
        await applicationI18n.changeLanguage("en-US");
      });

      expect(canvas.getByText("Compare numbers")).toBeInTheDocument();
      expect(canvas.getByText("数值比较")).toBeInTheDocument();
    });

    it("opens an icon action's tooltip when the keyboard reaches it", async () => {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole("button", { name: "打开设置" });
      await user.tab();

      const focused = document.activeElement;
      const label = focused?.getAttribute("aria-label") ?? "";
      expect(label.length).toBeGreaterThan(0);

      // The tooltip is shown as soon as the keyboard reaches the control rather than after
      // the hover delay, so a keyboard user is not left waiting for an explanation a
      // pointer user gets.
      expect(await screen.findByRole("tooltip")).toHaveTextContent(label);
    });

    it("keeps every region and control named after the catalog expands by a third", async () => {
      // English is the longer of the two shipped catalogs by well over the thirty percent
      // the accessibility requirement names, so rendering in it is a real expansion test
      // rather than a synthetic one.
      const expansion =
        countCatalogCharacters(enUSTranslation) /
        countCatalogCharacters(zhCNTranslation);
      expect(expansion).toBeGreaterThan(1.3);

      window.localStorage.setItem(LOCALE_STORAGE_KEY, "en-US");
      await act(async () => {
        await applicationI18n.changeLanguage("en-US");
      });
      render(<App />);
      act(() => {
        openProjectDocument(statesDocument());
      });

      expect(await screen.findByLabelText("Node graph")).toBeInTheDocument();
      expect(
        screen.getByRole("complementary", { name: "Node library" }),
      ).toBeInTheDocument();
      const unnamed = [...document.querySelectorAll("button, [role='button']")]
        .filter((element) => accessibleName(element).length === 0)
        .map((element) => element.outerHTML);
      expect(unnamed).toEqual([]);
    });

    it("keeps a truncating canvas label reachable in full", async () => {
      await openStatesProject();

      const title = screen
        .getByLabelText("节点图")
        .querySelector(".rino-node__title");
      // The style guide allows a node title to truncate only when the whole label stays
      // available; the title attribute is what carries it.
      expect(title?.getAttribute("title")).toBe(title?.textContent);
    });

    it("names all execution panel controls and presents runtime state without relying only on colour", async () => {
      await openStatesProject();
      const doc = useDocumentStore.getState().history?.document;
      const graphId = doc?.graphs[0]?.graphId ?? "accessibility-graph";
      const compareNodeId = sceneIdentifier("accessibility/compare");

      act(() => {
        useRuntimeExecutionStore.getState().beginRun(graphId, 1);
        useRuntimeExecutionStore.getState().acceptRun(
          {
            accepted: true,
            runId: "run-acc-1",
            graphId,
            registryVersion: "test-v1",
          },
          1,
        );
        useRuntimeExecutionStore.getState().applyEvent({
          eventId: "evt-acc-1",
          runId: "run-acc-1",
          generation: 1,
          sequence: 1,
          messageType: "node.stateChanged",
          nodeId: compareNodeId,
          payload: {
            runSequence: 1,
            tokenId: 1,
            activationId: 10,
            state: "running",
          },
        });
      });

      const executionTab = screen.getByRole("tab", { name: "执行" });
      await userEvent.click(executionTab);

      const debugRegion = within(screen.getByRole("region", { name: "调试" }));
      expect(debugRegion.getByText("正在运行")).toBeInTheDocument();

      const rowButton = debugRegion.getByRole("button", { name: /数值比较/ });
      expect(rowButton).toHaveAttribute("aria-current", "step");
      expect(rowButton).toHaveTextContent("正在执行");
    });
  },
);
