import type { NodeDefinitionV1, NodeV1 } from "@rino/contracts";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import { NumericWorkflowInspectorSection } from "./NumericWorkflowInspectorSection";

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
      labelKey: "node.text.parseNumber.port.run",
    },
    {
      portId: "text",
      direction: "input",
      portKind: "data",
      type: { kind: "string" },
      labelKey: "node.text.parseNumber.port.text",
    },
    {
      portId: "number",
      direction: "output",
      portKind: "data",
      type: { kind: "number" },
      labelKey: "node.text.parseNumber.port.number",
    },
    {
      portId: "parsed",
      direction: "output",
      portKind: "execution",
      type: { kind: "exec" },
      labelKey: "node.text.parseNumber.port.parsed",
    },
    {
      portId: "invalid",
      direction: "output",
      portKind: "execution",
      type: { kind: "exec" },
      labelKey: "node.text.parseNumber.port.invalid",
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
      labelKey: "node.core.logic.numberCompare.port.left",
    },
    {
      portId: "right",
      direction: "input",
      portKind: "data",
      type: { kind: "number" },
      labelKey: "node.core.logic.numberCompare.port.right",
    },
    {
      portId: "result",
      direction: "output",
      portKind: "data",
      type: { kind: "bool" },
      labelKey: "node.core.logic.numberCompare.port.result",
    },
    {
      portId: "relation",
      direction: "output",
      portKind: "data",
      type: { kind: "string" },
      labelKey: "node.core.logic.numberCompare.port.relation",
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
      labelKey: "node.core.logic.branch.port.run",
    },
    {
      portId: "condition",
      direction: "input",
      portKind: "data",
      type: { kind: "bool" },
      labelKey: "node.core.logic.branch.port.condition",
    },
    {
      portId: "whenTrue",
      direction: "output",
      portKind: "execution",
      type: { kind: "exec" },
      labelKey: "node.core.logic.branch.port.whenTrue",
    },
    {
      portId: "whenFalse",
      direction: "output",
      portKind: "execution",
      type: { kind: "exec" },
      labelKey: "node.core.logic.branch.port.whenFalse",
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

describe("NumericWorkflowInspectorSection", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
  });

  it("renders null for valid parse number without warnings to keep panel compact", () => {
    const node = createMockNode("text.parseNumber", {
      decimalSeparator: ".",
      groupingSeparator: ",",
      allowSign: true,
      normalizeFullWidth: true,
      minimum: 0,
      maximum: 100,
    });
    const { container } = render(
      <NumericWorkflowInspectorSection
        node={node}
        definition={mockParseNumberDefinition}
        connectedPortIds={new Set()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders warnings for equal separators and reversed bounds", () => {
    const node = createMockNode("text.parseNumber", {
      decimalSeparator: ".",
      groupingSeparator: ".",
      minimum: 100,
      maximum: 10,
    });
    render(
      <NumericWorkflowInspectorSection
        node={node}
        definition={mockParseNumberDefinition}
        connectedPortIds={new Set()}
      />,
    );

    expect(
      screen.getByText("小数分隔符与千位分隔符不能相同。"),
    ).toBeInTheDocument();
    expect(screen.getByText("最小值不能大于最大值。")).toBeInTheDocument();
  });

  it("reports malformed settings without hiding them", () => {
    const parseNode = createMockNode("text.parseNumber", {
      decimalSeparator: ";",
    });
    const { rerender } = render(
      <NumericWorkflowInspectorSection
        node={parseNode}
        definition={mockParseNumberDefinition}
        connectedPortIds={new Set()}
      />,
    );

    expect(screen.getByText(/部分保存的格式设置无效/)).toBeInTheDocument();

    const compareNode = createMockNode(
      "core.logic.numberCompare",
      { operator: "greaterThan" },
      { left: "42" },
    );
    rerender(
      <NumericWorkflowInspectorSection
        node={compareNode}
        definition={mockNumberCompareDefinition}
        connectedPortIds={new Set()}
      />,
    );

    expect(screen.getByText("保存的值无效")).toBeInTheDocument();
    expect(screen.getByText("需要数值")).toBeInTheDocument();
  });

  it("renders number compare expression with literal and connected sources", () => {
    const node = createMockNode(
      "core.logic.numberCompare",
      { operator: "greaterThanOrEqual" },
      { left: 50 },
    );
    render(
      <NumericWorkflowInspectorSection
        node={node}
        definition={mockNumberCompareDefinition}
        connectedPortIds={new Set(["right"])}
      />,
    );

    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText(">=")).toBeInTheDocument();
    expect(screen.getByText("(左值大于或等于右值)")).toBeInTheDocument();
    expect(screen.getByText("连线提供")).toBeInTheDocument();
    expect(screen.getByText("结果 (Boolean)")).toBeInTheDocument();
  });

  it("renders unknown operator state in compare section", () => {
    const node = createMockNode("core.logic.numberCompare", {
      operator: "unknownOp",
    });
    render(
      <NumericWorkflowInspectorSection
        node={node}
        definition={mockNumberCompareDefinition}
        connectedPortIds={new Set()}
      />,
    );

    expect(screen.getByText("不支持的比较符：unknownOp")).toBeInTheDocument();
  });

  it("renders branch paths in stable order", () => {
    const node = createMockNode("core.logic.branch", {}, { condition: true });
    render(
      <NumericWorkflowInspectorSection
        node={node}
        definition={mockBranchDefinition}
        connectedPortIds={new Set()}
      />,
    );

    expect(screen.getByText("true")).toBeInTheDocument();
    expect(screen.getByText("真 (true)")).toBeInTheDocument();
    expect(screen.getByText("假 (false)")).toBeInTheDocument();
  });

  it("returns null for non-numeric-workflow node definition", () => {
    const otherDef: NodeDefinitionV1 = {
      ...mockBranchDefinition,
      typeKey: "automation.clickPoint",
    };
    const node = createMockNode("automation.clickPoint");
    const { container } = render(
      <NumericWorkflowInspectorSection
        node={node}
        definition={otherDef}
        connectedPortIds={new Set()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
