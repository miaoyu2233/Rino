import { describe, expect, it } from "vitest";
import type { NodeV1 } from "@rino/contracts";

import {
  caseCatalogCases,
  caseCatalogPortLabel,
  initialTaskChoiceDynamicPortState,
  isVisibleCaseCatalogPort,
  isVisibleTaskChoicePort,
  taskChoiceHasUnmatchedSelection,
  taskChoiceCases,
} from "./task-choice";

function taskChoiceNode(
  dynamicPortState: NodeV1["dynamicPortState"] = initialTaskChoiceDynamicPortState(),
  selectedCaseId = "case1",
): NodeV1 {
  const node: NodeV1 = {
    nodeId: "10000000-0000-4000-8000-000000000001",
    typeKey: "core.logic.taskChoice",
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: { selectedCaseId },
    inputValues: {},
  };
  return dynamicPortState === undefined ? node : { ...node, dynamicPortState };
}

function overlayNode(dynamicPortState: NodeV1["dynamicPortState"]): NodeV1 {
  return {
    nodeId: "10000000-0000-4000-8000-000000000002",
    typeKey: "core.logic.caseOverlayNumber",
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: {},
    inputValues: {},
    ...(dynamicPortState === undefined ? {} : { dynamicPortState }),
  };
}

describe("task choice dynamic state", () => {
  it("accepts the bounded catalog and exposes only authored case ports", () => {
    const node = taskChoiceNode();

    expect(taskChoiceCases(node)).toEqual([
      { caseId: "case1", portId: "case1", label: "Case 1" },
      { caseId: "case2", portId: "case2", label: "Case 2" },
    ]);
    expect(isVisibleTaskChoicePort(node, "case1")).toBe(true);
    expect(isVisibleTaskChoicePort(node, "case3")).toBe(false);
    expect(isVisibleTaskChoicePort(node, "unmatched")).toBe(true);
  });

  it("makes malformed state inspectable and flags stale selection", () => {
    const malformed = taskChoiceNode({ taskChoiceCases: [] });
    const stale = taskChoiceNode(undefined, "removed");

    expect(taskChoiceCases(malformed)).toBeUndefined();
    expect(isVisibleTaskChoicePort(malformed, "case16")).toBe(true);
    expect(taskChoiceHasUnmatchedSelection(stale)).toBe(true);
  });

  it("rejects duplicate or over-limit cases", () => {
    const duplicate = taskChoiceNode({
      taskChoiceCases: [
        { caseId: "one", portId: "case1", label: "One" },
        { caseId: "one", portId: "case2", label: "Duplicate" },
      ],
    });
    const tooMany = taskChoiceNode({
      taskChoiceCases: Array.from({ length: 17 }, (_, index) => ({
        caseId: `case${String(index + 1)}`,
        portId: `case${String(index + 1)}`,
        label: `Case ${String(index + 1)}`,
      })),
    });

    expect(taskChoiceCases(duplicate)).toBeUndefined();
    expect(taskChoiceCases(tooMany)).toBeUndefined();
  });

  it("projects valid overlay case ports with catalog labels", () => {
    const node = overlayNode({
      taskChoiceCases: [
        { caseId: "primary", portId: "case1", label: "Primary" },
        { caseId: "backup", portId: "case3", label: "Backup" },
      ],
    });

    expect(caseCatalogCases(node)).toEqual([
      { caseId: "primary", portId: "case1", label: "Primary" },
      { caseId: "backup", portId: "case3", label: "Backup" },
    ]);
    expect(isVisibleCaseCatalogPort(node, "selectedCaseId")).toBe(true);
    expect(isVisibleCaseCatalogPort(node, "fallback")).toBe(true);
    expect(isVisibleCaseCatalogPort(node, "case1")).toBe(true);
    expect(isVisibleCaseCatalogPort(node, "case2")).toBe(false);
    expect(isVisibleCaseCatalogPort(node, "case3")).toBe(true);
    expect(caseCatalogPortLabel(node, "case3")).toBe("Backup");
  });

  it("keeps all overlay case ports inspectable when the catalog is malformed", () => {
    const node = overlayNode({ taskChoiceCases: [] });

    expect(caseCatalogCases(node)).toBeUndefined();
    expect(isVisibleCaseCatalogPort(node, "case1")).toBe(true);
    expect(isVisibleCaseCatalogPort(node, "case16")).toBe(true);
    expect(isVisibleCaseCatalogPort(node, "value")).toBe(true);
  });
});
