import type { GraphV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../app/App";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
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

function functionGraph(graphId: string, name: string): GraphV1 {
  return {
    graphId,
    name,
    kind: "function",
    functionSignature: { inputs: [], outputs: [] },
    nodes: [],
    edges: [],
  };
}

function navigationDocument(): RinoProjectDocumentV1 {
  const entry: GraphV1 = {
    graphId: "entry-graph",
    name: "主图",
    kind: "entry",
    nodes: [],
    edges: [],
  };
  return {
    schemaVersion: 1,
    documentId: "navigation-document",
    metadata: {
      name: "导航测试",
      createdAt: "2026-08-22T00:00:00Z",
      updatedAt: "2026-08-22T00:00:00Z",
    },
    entryGraphId: entry.graphId,
    graphs: [
      entry,
      functionGraph("function-a", "函数 A"),
      functionGraph("function-b", "函数 B"),
    ],
    assets: [],
    requiredCapabilities: [],
  };
}

describe("function navigation bar", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    closeProjectDocument();
    installInMemoryProjectService();
    setViewport(1280);
  });

  it("shows the active function and returns through nested navigation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    act(() => {
      openProjectDocument(navigationDocument());
      useEditorSessionStore.getState().enterGraph("function-a");
      useEditorSessionStore.getState().enterGraph("function-b");
    });

    expect(
      screen.getByRole("navigation", { name: "函数导航" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "函数导航" })).getByText(
        "函数 B",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "返回上一级" }));
    expect(useEditorSessionStore.getState().activeGraphId).toBe("function-a");
    await user.click(screen.getByRole("button", { name: "返回上一级" }));
    expect(useEditorSessionStore.getState().activeGraphId).toBe("entry-graph");
    expect(
      screen.queryByRole("navigation", { name: "函数导航" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the safe editor return action available while execution is locked", async () => {
    const user = userEvent.setup();
    render(<App />);
    await createProjectFromEmptyState();
    act(() => {
      openProjectDocument(navigationDocument());
      useEditorSessionStore.getState().enterGraph("function-a");
      useDocumentStore.getState().setExecutionLocked(true);
    });

    const back = screen.getByRole("button", { name: "返回上一级" });
    expect(back).not.toBeDisabled();
    await user.click(back);
    expect(useEditorSessionStore.getState().activeGraphId).toBe("entry-graph");
  });
});
