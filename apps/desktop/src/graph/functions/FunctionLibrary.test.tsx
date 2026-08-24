import type { GraphV1, RinoProjectDocumentV1 } from "@rino/contracts";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../app/App";
import { applicationI18n } from "../../localization/i18n";
import { FUNCTION_DRAG_FORMAT } from "../canvas/canvas-drag";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import { useLayoutPreferenceStore } from "../../preferences/layout-preference-store";
import { defaultLayoutPreferences } from "../../preferences/layout-preferences";
import { useDiagnosticStore } from "../../diagnostics/diagnostic-store";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../store/project-lifecycle";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import {
  createProjectFromEmptyState,
  installInMemoryProjectService,
} from "../../test/project-transport-double";

function emptyGraph(
  graphId: string,
  name: string,
  kind: GraphV1["kind"],
): GraphV1 {
  return {
    graphId,
    name,
    kind,
    ...(kind === "function"
      ? { functionSignature: { inputs: [], outputs: [] } }
      : {}),
    nodes: [],
    edges: [],
  };
}

function functionDocument(withRecursion = false): RinoProjectDocumentV1 {
  const entry = emptyGraph("entry-graph", "主图", "entry");
  const first = emptyGraph("function-a", "函数 A", "function");
  const second: GraphV1 = {
    ...emptyGraph("function-b", "函数 B", "function"),
    nodes: withRecursion
      ? [
          {
            nodeId: "call-a",
            typeKey: "core.function.call",
            typeVersion: 1,
            position: { x: 0, y: 0 },
            properties: { functionGraphId: first.graphId },
            inputValues: {},
          },
        ]
      : [],
  };
  return {
    schemaVersion: 1,
    documentId: "function-library-document",
    metadata: {
      name: "函数库测试",
      createdAt: "2026-08-22T00:00:00Z",
      updatedAt: "2026-08-22T00:00:00Z",
    },
    entryGraphId: entry.graphId,
    graphs: [entry, first, second],
    assets: [],
    requiredCapabilities: [],
  };
}

const DRAG_ENTRY_GRAPH_ID = "10000000-0000-4000-8000-000000000010";
const DRAG_FUNCTION_A_ID = "10000000-0000-4000-8000-000000000011";
const DRAG_FUNCTION_B_ID = "10000000-0000-4000-8000-000000000012";

function dragFunctionDocument(): RinoProjectDocumentV1 {
  const document = functionDocument();
  return {
    ...document,
    entryGraphId: DRAG_ENTRY_GRAPH_ID,
    graphs: document.graphs.map((graph) => ({
      ...graph,
      graphId:
        graph.graphId === "entry-graph"
          ? DRAG_ENTRY_GRAPH_ID
          : graph.graphId === "function-a"
            ? DRAG_FUNCTION_A_ID
            : DRAG_FUNCTION_B_ID,
    })),
  };
}

function dragTransfer(): {
  effectAllowed: string;
  getData: (format: string) => string;
  setData: (format: string, value: string) => void;
} {
  const values = new Map<string, string>();
  return {
    effectAllowed: "",
    getData: (format: string) => values.get(format) ?? "",
    setData: (format: string, value: string) => {
      values.set(format, value);
    },
  };
}
function workbenchRail(): HTMLElement {
  return screen.getByRole("complementary", { name: "打开工作台" });
}

async function openFunctionLibrary(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(
    within(workbenchRail()).getByRole("button", { name: "函数库" }),
  );
  return screen.getByRole("complementary", { name: "函数库" });
}

function setViewport(width: number, height = 800): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

function clearNotifications(): void {
  const { notifications, dismissNotification } = useDiagnosticStore.getState();
  for (const notification of notifications) {
    dismissNotification(notification.id);
  }
}

describe("function library", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    closeProjectDocument();
    installInMemoryProjectService();
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences },
    });
    clearNotifications();
    setViewport(1280);
  });

  it("creates a unique function graph as one undoable action and enters it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();

    const library = await openFunctionLibrary(user);

    await user.click(within(library).getByRole("button", { name: "新建函数" }));

    await waitFor(() => {
      const document = useDocumentStore.getState().history?.document;
      expect(document?.graphs.some((graph) => graph.kind === "function")).toBe(
        true,
      );
    });
    const document = useDocumentStore.getState().history?.document;
    const functionGraph = document?.graphs.find(
      (graph) => graph.kind === "function",
    );
    expect(functionGraph?.name).toBe("函数 1");
    expect(useEditorSessionStore.getState().activeGraphId).toBe(
      functionGraph?.graphId,
    );
    expect(useDocumentStore.getState().history?.undoable.at(-1)?.label).toBe(
      "graph.history.createFunction",
    );
  });

  it("drags a function entry while preserving navigation and lock behavior", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    act(() => {
      openProjectDocument(dragFunctionDocument());
    });

    const library = await openFunctionLibrary(user);
    const entry = within(library).getByRole("button", { name: "函数 A" });
    expect(entry).toHaveAttribute("draggable", "true");

    const dataTransfer = dragTransfer();
    fireEvent.dragStart(entry, { dataTransfer });
    expect(dataTransfer.getData(FUNCTION_DRAG_FORMAT)).toContain(
      DRAG_FUNCTION_A_ID,
    );
    fireEvent.dragEnd(entry, { dataTransfer });

    act(() => {
      useEditorSessionStore.getState().setActiveGraph(undefined);
    });
    expect(entry).toHaveAttribute("draggable", "false");

    act(() => {
      useDocumentStore.getState().setExecutionLocked(true);
      useEditorSessionStore.getState().setActiveGraph(DRAG_ENTRY_GRAPH_ID);
    });
    expect(entry).toHaveAttribute("draggable", "false");
  });
  it("inserts a function call at the visible canvas center and disables self-call", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    act(() => {
      openProjectDocument(functionDocument());
    });

    const library = await openFunctionLibrary(user);
    const insert = within(library).getByRole("button", {
      name: "插入函数 函数 A 的调用",
    });
    await user.click(insert);

    const entry = useDocumentStore.getState().history?.document.graphs[0];
    expect(entry?.nodes).toHaveLength(1);
    expect(entry?.nodes[0]).toMatchObject({
      typeKey: "core.function.call",
      properties: { functionGraphId: "function-a" },
      inputValues: {},
    });

    act(() => {
      useEditorSessionStore.getState().setActiveGraph("function-a");
    });
    expect(
      within(library).getByRole("button", {
        name: "插入函数 函数 A 的调用",
      }),
    ).toBeDisabled();
  });

  it("reports indirect recursion and respects the execution lock", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    act(() => {
      openProjectDocument(functionDocument(true));
    });
    useEditorSessionStore.getState().setActiveGraph("function-a");

    const library = await openFunctionLibrary(user);

    await user.click(
      within(library).getByRole("button", {
        name: "插入函数 函数 B 的调用",
      }),
    );
    expect(
      await screen.findByText("函数调用会形成直接或间接递归。"),
    ).toBeInTheDocument();

    act(() => {
      useDocumentStore.getState().setExecutionLocked(true);
      useEditorSessionStore.getState().setActiveGraph("entry-graph");
    });
    expect(
      within(library).getByRole("button", { name: "新建函数" }),
    ).toBeDisabled();
    expect(
      within(library).getByRole("button", {
        name: "插入函数 函数 A 的调用",
      }),
    ).toBeDisabled();
  });
});
