import { describe, expect, it } from "vitest";
import type {
  GraphV1,
  NodeV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";

import { readTaskSettings } from "./task-settings-model";

const registry = {
  schemaVersion: 1,
  registryVersion: "test",
  definitions: [
    {
      typeKey: "core.logic.taskChoice",
      typeVersion: 1,
      runtimeKind: "execution",
      sideEffect: "none",
      category: "logic",
      titleKey: "node.core.logic.taskChoice.title",
      descriptionKey: "node.core.logic.taskChoice.description",
      iconKey: "node.branch",
      ports: [],
      propertyDefaults: {
        selectedCaseId: "case1",
        settingKey: "taskChoice",
        exposeInTaskSettings: true,
      },
    },
  ],
  workflowTemplates: [],
} as unknown as RinoNodeRegistrySnapshotV1;

const graph: GraphV1 = {
  graphId: "10000000-0000-4000-8000-000000000001",
  name: "刷资源",
  kind: "entry",
  nodes: [
    {
      nodeId: "20000000-0000-4000-8000-000000000001",
      typeKey: "core.logic.taskChoice",
      typeVersion: 1,
      position: { x: 0, y: 0 },
      displayAlias: "资源类型",
      properties: {
        selectedCaseId: "diamond",
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

const taskChoiceNode = graph.nodes[0];
if (taskChoiceNode === undefined) {
  throw new Error("Expected a task-choice node fixture.");
}

function graphWithNode(node: NodeV1): GraphV1 {
  return { ...graph, nodes: [node] };
}

describe("readTaskSettings", () => {
  it("projects exposed task choices with their persisted selection", () => {
    expect(readTaskSettings(graph, registry)).toEqual([
      {
        nodeId: "20000000-0000-4000-8000-000000000001",
        titleKey: "node.core.logic.taskChoice.title",
        displayAlias: "资源类型",
        settingKey: "resourceType",
        selectedCaseId: "diamond",
        cases: [
          { caseId: "gold", portId: "case1", label: "刷金币" },
          { caseId: "diamond", portId: "case2", label: "刷钻石" },
        ],
        stateValid: true,
        unmatched: false,
      },
    ]);
  });

  it("does not expose hidden settings and marks stale values", () => {
    const hidden = graphWithNode({
      ...taskChoiceNode,
      properties: {
        ...taskChoiceNode.properties,
        exposeInTaskSettings: false,
      },
    });
    expect(readTaskSettings(hidden, registry)).toEqual([]);

    const stale = graphWithNode({
      ...taskChoiceNode,
      properties: {
        ...taskChoiceNode.properties,
        selectedCaseId: "removed",
      },
    });
    expect(readTaskSettings(stale, registry)[0]?.unmatched).toBe(true);
  });
});
