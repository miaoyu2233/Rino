import type { NodeDefinitionV1, NodeV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import { buildNumericWorkflowModel } from "./numeric-workflow-model";

const mockParseNumberDefinition: NodeDefinitionV1 = {
  typeKey: "text.parseNumber",
  typeVersion: 1,
  runtimeKind: "execution",
  sideEffect: "none",
  category: "text",
  titleKey: "node.text.parseNumber.title",
  descriptionKey: "node.text.parseNumber.description",
  iconKey: "node.text",
  ports: [
    {
      portId: "run",
      direction: "input",
      portKind: "execution",
      type: { kind: "exec" },
      labelKey: "run",
    },
    {
      portId: "text",
      direction: "input",
      portKind: "data",
      type: { kind: "string" },
      labelKey: "text",
    },
    {
      portId: "number",
      direction: "output",
      portKind: "data",
      type: { kind: "number" },
      labelKey: "number",
    },
    {
      portId: "parsed",
      direction: "output",
      portKind: "execution",
      type: { kind: "exec" },
      labelKey: "parsed",
    },
    {
      portId: "invalid",
      direction: "output",
      portKind: "execution",
      type: { kind: "exec" },
      labelKey: "invalid",
    },
  ],
  propertyDefaults: {
    decimalSeparator: ".",
    groupingSeparator: ",",
    normalizeFullWidth: false,
    allowSign: true,
  },
};

const mockNumberCompareDefinition: NodeDefinitionV1 = {
  typeKey: "core.logic.numberCompare",
  typeVersion: 1,
  runtimeKind: "execution",
  sideEffect: "none",
  category: "logic",
  titleKey: "node.core.logic.numberCompare.title",
  descriptionKey: "node.core.logic.numberCompare.description",
  iconKey: "node.compare",
  ports: [
    {
      portId: "left",
      direction: "input",
      portKind: "data",
      type: { kind: "number" },
      labelKey: "left",
    },
    {
      portId: "right",
      direction: "input",
      portKind: "data",
      type: { kind: "number" },
      labelKey: "right",
    },
    {
      portId: "result",
      direction: "output",
      portKind: "data",
      type: { kind: "bool" },
      labelKey: "result",
    },
    {
      portId: "relation",
      direction: "output",
      portKind: "data",
      type: { kind: "string" },
      labelKey: "relation",
    },
  ],
};

const mockBranchDefinition: NodeDefinitionV1 = {
  typeKey: "core.logic.branch",
  typeVersion: 1,
  runtimeKind: "execution",
  sideEffect: "none",
  category: "logic",
  titleKey: "node.core.logic.branch.title",
  descriptionKey: "node.core.logic.branch.description",
  iconKey: "node.branch",
  ports: [
    {
      portId: "run",
      direction: "input",
      portKind: "execution",
      type: { kind: "exec" },
      labelKey: "run",
    },
    {
      portId: "condition",
      direction: "input",
      portKind: "data",
      type: { kind: "bool" },
      labelKey: "condition",
    },
    {
      portId: "whenTrue",
      direction: "output",
      portKind: "execution",
      type: { kind: "exec" },
      labelKey: "whenTrue",
    },
    {
      portId: "whenFalse",
      direction: "output",
      portKind: "execution",
      type: { kind: "exec" },
      labelKey: "whenFalse",
    },
  ],
};

function createMockNode(
  typeKey: string,
  properties = {},
  inputValues = {},
): NodeV1 {
  return {
    nodeId: "node-1",
    typeKey,
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties,
    inputValues,
  };
}

describe("numeric-workflow-model", () => {
  it("uses authoritative definition defaults when properties are not stored", () => {
    const node = createMockNode("text.parseNumber");
    const model = buildNumericWorkflowModel(
      node,
      mockParseNumberDefinition,
      new Set(),
    );

    expect(model?.kind).toBe("parseNumber");
    if (model?.kind === "parseNumber") {
      expect(model.sampleText).toBe("-12,345.67");
      expect(model.allowSign).toBe(true);
      expect(model.configurationInvalid).toBe(false);
    }
  });

  it("computes parse number sample with period decimal and comma grouping", () => {
    const node = createMockNode("text.parseNumber", {
      decimalSeparator: ".",
      groupingSeparator: ",",
      allowSign: false,
    });
    const model = buildNumericWorkflowModel(
      node,
      mockParseNumberDefinition,
      new Set(),
    );
    expect(model?.kind).toBe("parseNumber");
    if (model?.kind === "parseNumber") {
      expect(model.sampleText).toBe("12,345.67");
      expect(model.equalSeparatorsWarning).toBe(false);
      expect(model.reversedBoundsWarning).toBe(false);
    }
  });

  it("computes parse number sample with comma decimal, period grouping, and empty grouping", () => {
    const node1 = createMockNode("text.parseNumber", {
      decimalSeparator: ",",
      groupingSeparator: ".",
      allowSign: false,
    });
    const model1 = buildNumericWorkflowModel(
      node1,
      mockParseNumberDefinition,
      new Set(),
    );
    expect(model1?.kind === "parseNumber" && model1.sampleText).toBe(
      "12.345,67",
    );

    const node2 = createMockNode("text.parseNumber", {
      decimalSeparator: ",",
      groupingSeparator: "",
      allowSign: false,
    });
    const model2 = buildNumericWorkflowModel(
      node2,
      mockParseNumberDefinition,
      new Set(),
    );
    expect(model2?.kind === "parseNumber" && model2.sampleText).toBe(
      "12345,67",
    );
  });

  it("handles opt-in sign and full-width normalization badges", () => {
    const node = createMockNode("text.parseNumber", {
      allowSign: true,
      normalizeFullWidth: true,
      decimalSeparator: ".",
      groupingSeparator: ",",
    });
    const model = buildNumericWorkflowModel(
      node,
      mockParseNumberDefinition,
      new Set(),
    );
    if (model?.kind === "parseNumber") {
      expect(model.allowSign).toBe(true);
      expect(model.normalizeFullWidth).toBe(true);
      expect(model.sampleText).toBe("-12,345.67");
    }
  });

  it("handles independent minimum and maximum bounds", () => {
    const nodeMin = createMockNode("text.parseNumber", { minimum: 0 });
    const modelMin = buildNumericWorkflowModel(
      nodeMin,
      mockParseNumberDefinition,
      new Set(),
    );
    if (modelMin?.kind === "parseNumber") {
      expect(modelMin.minimum).toBe(0);
      expect(modelMin.maximum).toBeUndefined();
      expect(modelMin.reversedBoundsWarning).toBe(false);
    }

    const nodeMax = createMockNode("text.parseNumber", { maximum: 100 });
    const modelMax = buildNumericWorkflowModel(
      nodeMax,
      mockParseNumberDefinition,
      new Set(),
    );
    if (modelMax?.kind === "parseNumber") {
      expect(modelMax.minimum).toBeUndefined();
      expect(modelMax.maximum).toBe(100);
      expect(modelMax.reversedBoundsWarning).toBe(false);
    }
  });

  it("detects equal separators and reversed bounds warnings without mutating settings", () => {
    const nodeEqual = createMockNode("text.parseNumber", {
      decimalSeparator: ".",
      groupingSeparator: ".",
    });
    const modelEqual = buildNumericWorkflowModel(
      nodeEqual,
      mockParseNumberDefinition,
      new Set(),
    );
    if (modelEqual?.kind === "parseNumber") {
      expect(modelEqual.equalSeparatorsWarning).toBe(true);
    }

    const nodeReversed = createMockNode("text.parseNumber", {
      minimum: 100,
      maximum: 10,
    });
    const modelReversed = buildNumericWorkflowModel(
      nodeReversed,
      mockParseNumberDefinition,
      new Set(),
    );
    if (modelReversed?.kind === "parseNumber") {
      expect(modelReversed.reversedBoundsWarning).toBe(true);
    }
  });

  it("keeps malformed parse settings visible instead of substituting defaults", () => {
    const node = createMockNode("text.parseNumber", {
      decimalSeparator: ";",
      allowSign: "yes",
    });
    const model = buildNumericWorkflowModel(
      node,
      mockParseNumberDefinition,
      new Set(),
    );

    expect(model?.kind).toBe("parseNumber");
    if (model?.kind === "parseNumber") {
      expect(model.decimalSeparator).toBeUndefined();
      expect(model.allowSign).toBeUndefined();
      expect(model.sampleText).toBeUndefined();
      expect(model.configurationInvalid).toBe(true);
    }
  });

  it("parses all six operator choices for number compare", () => {
    const operators = [
      "greaterThan",
      "greaterThanOrEqual",
      "lessThan",
      "lessThanOrEqual",
      "equalTo",
      "notEqualTo",
    ] as const;

    for (const op of operators) {
      const node = createMockNode("core.logic.numberCompare", { operator: op });
      const model = buildNumericWorkflowModel(
        node,
        mockNumberCompareDefinition,
        new Set(),
      );
      expect(model?.kind).toBe("numberCompare");
      if (model?.kind === "numberCompare") {
        expect(model.operator).toBe(op);
      }
    }
  });

  it("distinguishes connected, finite literal, missing, and unknown operator in compare", () => {
    const connectedNode = createMockNode("core.logic.numberCompare");
    const modelConn = buildNumericWorkflowModel(
      connectedNode,
      mockNumberCompareDefinition,
      new Set(["left"]),
    );
    if (modelConn?.kind === "numberCompare") {
      expect(modelConn.leftSource).toEqual({ kind: "connected" });
      expect(modelConn.rightSource).toEqual({ kind: "required" });
    }

    const literalNode = createMockNode(
      "core.logic.numberCompare",
      {},
      { left: 42, right: 100 },
    );
    const modelLit = buildNumericWorkflowModel(
      literalNode,
      mockNumberCompareDefinition,
      new Set(),
    );
    if (modelLit?.kind === "numberCompare") {
      expect(modelLit.leftSource).toEqual({ kind: "literal", value: 42 });
      expect(modelLit.rightSource).toEqual({ kind: "literal", value: 100 });
    }

    const invalidNode = createMockNode(
      "core.logic.numberCompare",
      {},
      { left: "42" },
    );
    const modelInvalid = buildNumericWorkflowModel(
      invalidNode,
      mockNumberCompareDefinition,
      new Set(),
    );
    if (modelInvalid?.kind === "numberCompare") {
      expect(modelInvalid.leftSource).toEqual({ kind: "invalid" });
    }

    const unknownOpNode = createMockNode("core.logic.numberCompare", {
      operator: "invalidOp",
    });
    const modelUnknown = buildNumericWorkflowModel(
      unknownOpNode,
      mockNumberCompareDefinition,
      new Set(),
    );
    if (modelUnknown?.kind === "numberCompare") {
      expect(modelUnknown.operator).toBe("unknown");
      expect(modelUnknown.rawOperator).toBe("invalidOp");
    }
  });

  it("computes branch condition state and path order", () => {
    const branchConnNode = createMockNode("core.logic.branch");
    const modelBranchConn = buildNumericWorkflowModel(
      branchConnNode,
      mockBranchDefinition,
      new Set(["condition"]),
    );
    if (modelBranchConn?.kind === "branch") {
      expect(modelBranchConn.conditionSource).toEqual({ kind: "connected" });
      expect(modelBranchConn.whenTruePortId).toBe("whenTrue");
      expect(modelBranchConn.whenFalsePortId).toBe("whenFalse");
    }

    const branchLitNode = createMockNode(
      "core.logic.branch",
      {},
      { condition: true },
    );
    const modelBranchLit = buildNumericWorkflowModel(
      branchLitNode,
      mockBranchDefinition,
      new Set(),
    );
    if (modelBranchLit?.kind === "branch") {
      expect(modelBranchLit.conditionSource).toEqual({
        kind: "literal",
        value: true,
      });
    }
  });

  it("returns undefined for unrecognized node types", () => {
    const node = createMockNode("automation.clickPoint");
    const model = buildNumericWorkflowModel(
      node,
      mockParseNumberDefinition,
      new Set(),
    );
    expect(model).toBeUndefined();
  });
});
