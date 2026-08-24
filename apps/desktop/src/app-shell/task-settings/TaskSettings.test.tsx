import type { GraphV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import { TooltipProvider } from "../../components/ui/Tooltip";
import { installDevelopmentRegistry } from "../../graph/registry/development-registry";
import { commitNodeProperty } from "../../graph/fields/field-commands";
import { useDocumentStore } from "../../graph/store/document-store";
import {
  closeProjectDocument,
  openProjectDocument,
} from "../../graph/store/project-lifecycle";
import { TaskSettingsTrigger } from "./TaskSettings";

const GRAPH_ID = "10000000-0000-4000-8000-000000000001";
const NODE_ID = "20000000-0000-4000-8000-000000000001";

function documentWithTaskChoice(): RinoProjectDocumentV1 {
  const graph: GraphV1 = {
    graphId: GRAPH_ID,
    name: "刷资源",
    kind: "entry",
    nodes: [
      {
        nodeId: NODE_ID,
        typeKey: "core.logic.taskChoice",
        typeVersion: 1,
        position: { x: 0, y: 0 },
        displayAlias: "资源类型",
        properties: {
          selectedCaseId: "gold",
          settingKey: "resourceType",
          exposeInTaskSettings: true,
        },
        inputValues: {},
        dynamicPortState: {
          taskChoiceCases: [
            { caseId: "gold", portId: "case1", label: "刷金币" },
            { caseId: "diamond", portId: "case2", label: "刷钻石" },
          ],
        },
      },
    ],
    edges: [],
  };
  return {
    schemaVersion: 1,
    documentId: "00000000-0000-4000-8000-000000000001",
    metadata: {
      name: "任务设置测试项目",
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: "2026-08-01T00:00:00Z",
    },
    entryGraphId: GRAPH_ID,
    graphs: [graph],
    assets: [],
    requiredCapabilities: [],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
  void applicationI18n.changeLanguage("zh-CN");
  closeProjectDocument();
  installDevelopmentRegistry();
  openProjectDocument(documentWithTaskChoice());
});

describe("TaskSettingsTrigger", () => {
  it("opens the current task setting and writes the same node property", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <TaskSettingsTrigger />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "打开当前任务设置" }));
    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "当前任务设置" }),
      ).toBeVisible();
    });

    expect(
      screen.getByRole("combobox", { name: "设置 资源类型" }),
    ).toBeVisible();

    expect(commitNodeProperty(NODE_ID, "selectedCaseId", "diamond")).toBe(true);

    const document = useDocumentStore.getState().history?.document;
    const node = document?.graphs[0]?.nodes[0];
    expect(node?.properties["selectedCaseId"]).toBe("diamond");
    expect(useDocumentStore.getState().history?.undoable).toHaveLength(1);
  });
});
