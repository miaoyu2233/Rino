import type { EdgeV1, NodeDefinitionV1, NodeV1 } from "@rino/contracts";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "../../app/App";
import { applicationI18n } from "../../localization/i18n";
import { LOCALE_STORAGE_KEY } from "../../localization/locale-state";
import { useLayoutPreferenceStore } from "../../preferences/layout-preference-store";
import { defaultLayoutPreferences } from "../../preferences/layout-preferences";
import type { GraphCommand } from "../commands/graph-commands";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import { closeProjectDocument } from "../store/project-lifecycle";
import { developmentRegistrySnapshot } from "../registry/development-registry";
import { useRegistryStore } from "../registry/registry-store";
import {
  createProjectFromEmptyState,
  installInMemoryProjectService,
} from "../../test/project-transport-double";

const COMPARE = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";
const LITERAL = "7c6d5e4f-8091-42a3-9bc4-5d6e7f809123";
const OCR = "9a8b7c6d-5e4f-4382-9170-8f7e6d5c4b3a";
const EDGE = "8b7a6c5d-4e3f-4291-8071-6d5c4b3a2918";

function compareNode(): NodeV1 {
  return {
    nodeId: COMPARE,
    typeKey: "core.logic.numberCompare",
    typeVersion: 1,
    position: { x: 240, y: 120 },
    properties: { operator: "greaterThan" },
    inputValues: { right: 100 },
  };
}

function numberLiteralNode(): NodeV1 {
  return {
    nodeId: LITERAL,
    typeKey: "core.value.numberLiteral",
    typeVersion: 1,
    position: { x: 0, y: 0 },
    properties: { value: 0 },
    inputValues: {},
  };
}

function ocrNode(): NodeV1 {
  return {
    nodeId: OCR,
    typeKey: "vision.ocr",
    typeVersion: 1,
    position: { x: 480, y: 0 },
    properties: {},
    inputValues: {},
  };
}

function currentOcrDefinition(): NodeDefinitionV1 {
  return {
    typeKey: "vision.ocr",
    typeVersion: 1,
    runtimeKind: "execution",
    sideEffect: "runtime",
    category: "vision",
    titleKey: "node.vision.ocr.title",
    descriptionKey: "node.vision.ocr.description",
    iconKey: "node.ocr",
    ports: [
      {
        portId: "run",
        direction: "input",
        portKind: "execution",
        type: { kind: "exec" },
        labelKey: "node.vision.ocr.port.run",
      },
      {
        portId: "image",
        direction: "input",
        portKind: "data",
        type: { kind: "imageRef" },
        labelKey: "node.vision.ocr.port.image",
        required: true,
      },
      {
        portId: "roi",
        direction: "input",
        portKind: "data",
        type: { kind: "rect" },
        labelKey: "node.vision.ocr.port.roi",
      },
      {
        portId: "result",
        direction: "output",
        portKind: "data",
        type: { kind: "ocrResult" },
        labelKey: "node.vision.ocr.port.result",
      },
      {
        portId: "matched",
        direction: "output",
        portKind: "data",
        type: { kind: "bool" },
        labelKey: "node.vision.ocr.port.matched",
      },
      {
        portId: "bestText",
        direction: "output",
        portKind: "data",
        type: { kind: "string" },
        labelKey: "node.vision.ocr.port.bestText",
      },
      {
        portId: "bestRect",
        direction: "output",
        portKind: "data",
        type: { kind: "rect" },
        labelKey: "node.vision.ocr.port.bestRect",
      },
      {
        portId: "next",
        direction: "output",
        portKind: "execution",
        type: { kind: "exec" },
        labelKey: "node.vision.ocr.port.next",
      },
    ],
    propertySchema: {
      type: "object",
      additionalProperties: false,
      required: ["confidenceThreshold"],
      properties: {
        confidenceThreshold: {
          type: "number",
          minimum: 0,
          maximum: 1,
          "x-rinoLabelKey":
            "node.vision.ocr.property.confidenceThreshold.label",
          "x-rinoDescriptionKey":
            "node.vision.ocr.property.confidenceThreshold.description",
        },
      },
    },
    propertyDefaults: { confidenceThreshold: 0.3 },
    requiredCapabilities: ["vision.ocr"],
  };
}

function installCurrentOcrDefinition(): void {
  const snapshot = developmentRegistrySnapshot();
  act(() => {
    useRegistryStore.getState().installSnapshot(
      {
        ...snapshot,
        registryVersion: `${snapshot.registryVersion}-current-ocr-test`,
        definitions: snapshot.definitions.map((definition) =>
          definition.typeKey === "vision.ocr"
            ? currentOcrDefinition()
            : definition,
        ),
      },
      "development",
    );
  });
}

function installCurrentVariableDefinition(): void {
  const snapshot = developmentRegistrySnapshot();
  const source = snapshot.definitions.find(
    (definition) => definition.typeKey === "core.value.numberLiteral",
  );
  if (source === undefined) {
    throw new Error("The registry fixture must define a number literal.");
  }
  const variableDefinition: NodeDefinitionV1 = {
    ...source,
    typeKey: "core.variable.getNumber",
    titleKey: "node.core.variable.getNumber.title",
    propertySchema: {
      type: "object",
      additionalProperties: false,
      required: ["variableId"],
      properties: {
        variableId: {
          type: "string",
          format: "uuid",
          "x-rinoLabelKey":
            "node.core.variable.getNumber.property.variableId.label",
          "x-rinoDescriptionKey":
            "node.core.variable.getNumber.property.variableId.description",
        },
      },
    },
    propertyDefaults: {},
  };
  act(() => {
    useRegistryStore.getState().installSnapshot(
      {
        ...snapshot,
        registryVersion: `${snapshot.registryVersion}-variable-test`,
        definitions: [
          ...snapshot.definitions.filter(
            (definition) => definition.typeKey !== "core.variable.getNumber",
          ),
          variableDefinition,
        ],
      },
      "development",
    );
  });
}

function literalIntoCompareLeft(): EdgeV1 {
  return {
    edgeId: EDGE,
    edgeKind: "data",
    sourceNodeId: LITERAL,
    sourcePortId: "value",
    targetNodeId: COMPARE,
    targetPortId: "left",
  };
}

function activeGraphId(): string {
  const graphId = useEditorSessionStore.getState().activeGraphId;
  if (graphId === undefined) {
    throw new Error("A project must be open.");
  }
  return graphId;
}

function run(command: GraphCommand): void {
  act(() => {
    const outcome = useDocumentStore
      .getState()
      .runCommand("graph.history.insertNode", command);
    if (!outcome.ok) {
      throw new Error(`The command should have applied: ${outcome.reason}`);
    }
  });
}

/** React Flow keeps a node hidden until it has been measured, which never happens in a
 * DOM without layout, so a control drawn inside a node has no computed accessible name
 * here. It is queried by its label instead. */
function inlineField(name: string): HTMLElement {
  return screen.getByLabelText(name);
}

function addNode(node: NodeV1): void {
  run({ kind: "addNode", graphId: activeGraphId(), node });
}

function addEdge(edge: EdgeV1): void {
  run({ kind: "addEdge", graphId: activeGraphId(), edge });
}

function select(...nodeIds: string[]): void {
  act(() => {
    useEditorSessionStore.getState().setSelection(nodeIds, []);
  });
}

function storedNode(nodeId: string): NodeV1 {
  const node = useDocumentStore
    .getState()
    .history?.document.graphs[0]?.nodes.find(
      (candidate) => candidate.nodeId === nodeId,
    );
  if (!node) {
    throw new Error(`The graph should contain ${nodeId}.`);
  }
  return node;
}

function historyLabels(): readonly string[] {
  return (useDocumentStore.getState().history?.undoable ?? []).map(
    (entry) => entry.label,
  );
}

function inspector(): HTMLElement {
  return screen.getByRole("region", { name: "属性" });
}

/** Opens a project holding one compare node and selects it. */
async function openWithSelectedCompareNode(): Promise<void> {
  render(<App />);
  await createProjectFromEmptyState();
  addNode(compareNode());
  select(COMPARE);
}

describe("inspector", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    closeProjectDocument();
    installInMemoryProjectService();
    useLayoutPreferenceStore.setState({
      layout: { ...defaultLayoutPreferences, activeRightTab: "inspector" },
    });
  });

  it("explains that nothing is selected", async () => {
    render(<App />);
    await createProjectFromEmptyState();

    expect(within(inspector()).getByText("未选择节点")).toBeInTheDocument();
  });

  it("refuses to edit several nodes at once and says how many are selected", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(compareNode());
    addNode(numberLiteralNode());
    select(COMPARE, LITERAL);

    expect(within(inspector()).getByText("选择了多个节点")).toBeInTheDocument();
    expect(within(inspector()).getByText(/当前选中 2 个节点/)).toBeVisible();
  });

  it("names the selected node and renders the properties its definition declares", async () => {
    await openWithSelectedCompareNode();
    const panel = inspector();

    expect(within(panel).getAllByText("数值比较").length).toBeGreaterThan(0);
    expect(
      within(panel).getByRole("combobox", { name: "比较方式" }),
    ).toHaveAttribute("data-value", "greaterThan");
    expect(within(panel).getByRole("textbox", { name: "右值" })).toHaveValue(
      "100",
    );
  });

  it("commits a choice as one undoable change", async () => {
    await openWithSelectedCompareNode();

    await userEvent.click(
      within(inspector()).getByRole("combobox", { name: "比较方式" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "左值小于右值" }));

    expect(storedNode(COMPARE).properties["operator"]).toBe("lessThan");
    expect(historyLabels()).toEqual([
      "graph.history.insertNode",
      "graph.history.setProperty",
    ]);

    act(() => {
      useDocumentStore.getState().undoChange();
    });
    expect(storedNode(COMPARE).properties["operator"]).toBe("greaterThan");
  });

  it("records one undo entry for a typed edit rather than one per keystroke", async () => {
    await openWithSelectedCompareNode();
    const field = within(inspector()).getByRole("textbox", { name: "右值" });

    await userEvent.clear(field);
    await userEvent.type(field, "250");
    await userEvent.tab();

    expect(storedNode(COMPARE).inputValues["right"]).toBe(250);
    expect(historyLabels()).toEqual([
      "graph.history.insertNode",
      "graph.history.setInputValue",
    ]);
  });

  it("keeps an invalid entry out of the document and says what is wrong", async () => {
    await openWithSelectedCompareNode();
    const field = within(inspector()).getByRole("textbox", { name: "右值" });

    await userEvent.clear(field);
    await userEvent.type(field, "abc");
    await userEvent.tab();

    expect(within(inspector()).getByText("请输入数字。")).toBeVisible();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(storedNode(COMPARE).inputValues["right"]).toBe(100);
    expect(historyLabels()).toEqual(["graph.history.insertNode"]);
  });

  it("refuses to empty a required input", async () => {
    await openWithSelectedCompareNode();

    await userEvent.clear(
      within(inspector()).getByRole("textbox", { name: "右值" }),
    );
    await userEvent.tab();

    expect(within(inspector()).getByText("该字段必须填写。")).toBeVisible();
    expect(storedNode(COMPARE).inputValues["right"]).toBe(100);
  });

  it("reverts the field being edited when Escape is pressed", async () => {
    await openWithSelectedCompareNode();
    const field = within(inspector()).getByRole("textbox", { name: "右值" });

    await userEvent.clear(field);
    await userEvent.type(field, "7{Escape}");

    expect(field).toHaveValue("100");
    expect(storedNode(COMPARE).inputValues["right"]).toBe(100);
  });

  it("restores a property to the default its definition declares", async () => {
    await openWithSelectedCompareNode();
    const panel = inspector();

    await userEvent.click(
      within(panel).getByRole("combobox", { name: "比较方式" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "左值等于右值" }));
    await userEvent.click(
      within(panel).getByRole("button", { name: "恢复默认值" }),
    );

    expect(storedNode(COMPARE).properties["operator"]).toBe("greaterThan");
    expect(historyLabels().at(-1)).toBe("graph.history.resetProperty");
  });

  it("edits the alias without touching the node's execution identity", async () => {
    await openWithSelectedCompareNode();

    await userEvent.type(
      within(inspector()).getByRole("textbox", { name: "备注名称" }),
      "血量判断",
    );
    await userEvent.tab();

    const edited = storedNode(COMPARE);
    expect(edited.displayAlias).toBe("血量判断");
    expect(edited.typeKey).toBe("core.logic.numberCompare");
    expect(edited.typeVersion).toBe(1);

    act(() => {
      useDocumentStore.getState().undoChange();
    });
    expect(storedNode(COMPARE).displayAlias).toBeUndefined();
  });

  it("says that a connected input is supplied by its connection", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(compareNode());
    addNode(numberLiteralNode());
    addEdge(literalIntoCompareLeft());
    select(COMPARE);

    expect(
      within(inspector()).getByText("该输入由连线提供，内联值不会被使用。"),
    ).toBeVisible();
    expect(
      within(inspector()).queryByRole("textbox", { name: "左值" }),
    ).not.toBeInTheDocument();
  });

  it("explains an input that only a connection can supply", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(ocrNode());
    select(OCR);

    // OCR image, roi, regions, and confidenceThreshold are connection-only inputs.
    expect(
      within(inspector()).getAllByText("该输入只能由连线提供，不接受内联值。"),
    ).toHaveLength(4);
  });

  it("states the capability a node needs while no runtime has reported one", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode(ocrNode());
    select(OCR);

    expect(
      within(inspector()).getByText(/需要后端能力：vision\.ocr/),
    ).toBeVisible();
  });

  it("integrates the authoritative OCR overview with one confidence editor", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    installCurrentOcrDefinition();
    addNode({
      ...ocrNode(),
      properties: { confidenceThreshold: 0.3 },
    });
    select(OCR);
    const panel = inspector();
    const overview = within(panel).getByRole("region", {
      name: "文字识别概览",
    });
    const confidenceFields = within(panel).getAllByRole("textbox", {
      name: "最低置信度",
    });
    const confidenceField = confidenceFields[0];
    if (confidenceField === undefined) {
      throw new Error("The OCR confidence editor should be present.");
    }

    expect(within(overview).getByText("30%")).toBeVisible();
    expect(confidenceFields).toHaveLength(1);
    expect(confidenceField).toHaveValue("0.3");

    await userEvent.clear(confidenceField);
    await userEvent.type(confidenceField, "0.7");
    await userEvent.tab();

    expect(storedNode(OCR).properties["confidenceThreshold"]).toBe(0.7);
    expect(historyLabels().at(-1)).toBe("graph.history.setProperty");
    expect(within(overview).getByText("70%")).toBeVisible();

    await userEvent.click(
      within(panel).getByRole("button", { name: "恢复默认值" }),
    );
    expect(storedNode(OCR).properties["confidenceThreshold"]).toBe(0.3);
    expect(historyLabels().at(-1)).toBe("graph.history.resetProperty");

    const properties = within(panel).getByRole("region", { name: "参数" });
    expect(
      overview.compareDocumentPosition(properties) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("keeps a stored property the definition no longer declares visible", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode({ ...compareNode(), properties: { legacyMode: true } });
    select(COMPARE);
    const panel = inspector();

    expect(within(panel).getByText("已保存的参数")).toBeVisible();
    expect(within(panel).getByText("legacyMode")).toBeVisible();
    // The declared property is still offered as a control rather than listed as stored.
    expect(
      within(panel).getByRole("combobox", { name: "比较方式" }),
    ).toBeInTheDocument();
  });

  it("keeps a node whose definition is unknown readable and editable by alias only", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    addNode({
      nodeId: LITERAL,
      typeKey: "future.node.unknown",
      typeVersion: 1,
      position: { x: 0, y: 0 },
      properties: { retained: "value" },
      inputValues: {},
    });
    select(LITERAL);
    const panel = inspector();

    expect(
      within(panel).getByText("未知节点：future.node.unknown"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("retained")).toBeVisible();
    expect(within(panel).getByText("value")).toBeVisible();
    expect(
      within(panel).queryByRole("combobox", { name: "比较方式" }),
    ).not.toBeInTheDocument();
  });

  it("renders specialist numeric workflow section and generic properties/inputs for number compare", async () => {
    await openWithSelectedCompareNode();
    const panel = inspector();

    expect(within(panel).getAllByText("数值比较").length).toBeGreaterThan(0);
    expect(
      within(panel).getByRole("combobox", { name: "比较方式" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("textbox", { name: "右值" }),
    ).toBeInTheDocument();
  });

  it("hides the raw variable identifier from the inspector", async () => {
    render(<App />);
    await createProjectFromEmptyState();
    installCurrentVariableDefinition();
    const variableId = "10000000-0000-4000-8000-000000000001";
    act(() => {
      run({
        kind: "setGraphVariables",
        graphId: activeGraphId(),
        variables: [
          {
            variableId,
            name: "score",
            valueKind: "number",
            persistent: false,
          },
        ],
      });
    });
    addNode({
      nodeId: "10000000-0000-4000-8000-000000000002",
      typeKey: "core.variable.getNumber",
      typeVersion: 1,
      position: { x: 0, y: 0 },
      properties: { variableId },
      inputValues: {},
    });
    select("10000000-0000-4000-8000-000000000002");

    const panel = inspector();
    expect(within(panel).queryByText("变量标识")).not.toBeInTheDocument();
    expect(
      within(panel).queryByDisplayValue(variableId),
    ).not.toBeInTheDocument();
    expect(within(panel).getByText("该节点没有可配置参数。")).toBeVisible();
  });
});

describe("inline node fields", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "zh-CN");
    void applicationI18n.changeLanguage("zh-CN");
    closeProjectDocument();
    installInMemoryProjectService();
  });

  it("edits the same value as the inspector and produces the same command", async () => {
    await openWithSelectedCompareNode();
    const inline = inlineField("数值比较 的 右值 输入值");

    await userEvent.clear(inline);
    await userEvent.type(inline, "42");
    await userEvent.tab();

    expect(storedNode(COMPARE).inputValues["right"]).toBe(42);
    expect(historyLabels()).toEqual([
      "graph.history.insertNode",
      "graph.history.setInputValue",
    ]);
    // The inspector follows the document rather than holding its own copy.
    expect(
      within(inspector()).getByRole("textbox", { name: "右值" }),
    ).toHaveValue("42");
  });

  it("shows an edit made in the inspector on the node", async () => {
    await openWithSelectedCompareNode();
    const field = within(inspector()).getByRole("textbox", { name: "右值" });

    await userEvent.clear(field);
    await userEvent.type(field, "8");
    await userEvent.tab();

    expect(inlineField("数值比较 的 右值 输入值")).toHaveValue("8");
  });

  it("does not overwrite a field the user is typing in when the document changes", async () => {
    await openWithSelectedCompareNode();
    const field = within(inspector()).getByRole("textbox", { name: "右值" });

    await userEvent.clear(field);
    await userEvent.type(field, "77");
    // An edit arriving from elsewhere while the field has focus.
    act(() => {
      run({
        kind: "setInputValue",
        graphId: activeGraphId(),
        nodeId: COMPARE,
        portId: "right",
        value: 3,
      });
    });

    expect(field).toHaveValue("77");

    await userEvent.tab();
    expect(storedNode(COMPARE).inputValues["right"]).toBe(77);
  });
});
