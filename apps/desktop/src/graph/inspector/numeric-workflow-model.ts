import type { NodeDefinitionV1, NodeV1 } from "@rino/contracts";

export type CompareOperator =
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "equalTo"
  | "notEqualTo";

export type SourceState =
  | { kind: "connected" }
  | { kind: "literal"; value: number | boolean }
  | { kind: "invalid" }
  | { kind: "required" };

export interface ParseNumberWorkflowModel {
  kind: "parseNumber";
  sampleText: string | undefined;
  decimalSeparator: string | undefined;
  groupingSeparator: string | undefined;
  normalizeFullWidth: boolean | undefined;
  allowSign: boolean | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  configurationInvalid: boolean;
  equalSeparatorsWarning: boolean;
  reversedBoundsWarning: boolean;
  parsedPortId: string;
  parsedPortLabelKey: string;
  invalidPortId: string;
  invalidPortLabelKey: string;
}

export interface NumberCompareWorkflowModel {
  kind: "numberCompare";
  operator: CompareOperator | "unknown";
  rawOperator?: string | undefined;
  leftSource: SourceState;
  rightSource: SourceState;
  resultPortId: string;
  relationPortId: string;
}

export interface BranchWorkflowModel {
  kind: "branch";
  conditionSource: SourceState;
  whenTruePortId: string;
  whenTruePortLabelKey: string;
  whenFalsePortId: string;
  whenFalsePortLabelKey: string;
}

export type NumericWorkflowModel =
  ParseNumberWorkflowModel | NumberCompareWorkflowModel | BranchWorkflowModel;

const VALID_OPERATORS = new Set<CompareOperator>([
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
  "equalTo",
  "notEqualTo",
]);

function effectiveProperty(
  node: NodeV1,
  definition: NodeDefinitionV1,
  propertyKey: string,
): { present: boolean; value: unknown } {
  if (Object.hasOwn(node.properties, propertyKey)) {
    return { present: true, value: node.properties[propertyKey] };
  }
  if (Object.hasOwn(definition.propertyDefaults ?? {}, propertyKey)) {
    return {
      present: true,
      value: definition.propertyDefaults?.[propertyKey],
    };
  }
  return { present: false, value: undefined };
}

function readChoice(
  property: { present: boolean; value: unknown },
  choices: ReadonlySet<string>,
): string | undefined {
  return property.present &&
    typeof property.value === "string" &&
    choices.has(property.value)
    ? property.value
    : undefined;
}

function readBoolean(property: {
  present: boolean;
  value: unknown;
}): boolean | undefined {
  return property.present && typeof property.value === "boolean"
    ? property.value
    : undefined;
}

function readOptionalFiniteNumber(property: {
  present: boolean;
  value: unknown;
}): { invalid: boolean; value: number | undefined } {
  if (!property.present) {
    return { invalid: false, value: undefined };
  }
  return typeof property.value === "number" && Number.isFinite(property.value)
    ? { invalid: false, value: property.value }
    : { invalid: true, value: undefined };
}

function displayUnknownValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value);
}

function buildSourceState(
  portId: string,
  expectedKind: "number" | "boolean",
  node: NodeV1,
  connectedPortIds: ReadonlySet<string>,
): SourceState {
  if (connectedPortIds.has(portId)) {
    return { kind: "connected" };
  }

  if (Object.hasOwn(node.inputValues, portId)) {
    const rawVal = node.inputValues[portId];
    if (
      expectedKind === "number" &&
      typeof rawVal === "number" &&
      Number.isFinite(rawVal)
    ) {
      return { kind: "literal", value: rawVal };
    }
    if (expectedKind === "boolean" && typeof rawVal === "boolean") {
      return { kind: "literal", value: rawVal };
    }
    return { kind: "invalid" };
  }

  return { kind: "required" };
}

export function buildNumericWorkflowModel(
  node: NodeV1,
  definition: NodeDefinitionV1,
  connectedPortIds: ReadonlySet<string>,
): NumericWorkflowModel | undefined {
  if (node.typeKey === "text.parseNumber") {
    const decimalSeparator = readChoice(
      effectiveProperty(node, definition, "decimalSeparator"),
      new Set([".", ","]),
    );
    const groupingSeparator = readChoice(
      effectiveProperty(node, definition, "groupingSeparator"),
      new Set(["", ".", ",", " "]),
    );
    const normalizeFullWidth = readBoolean(
      effectiveProperty(node, definition, "normalizeFullWidth"),
    );
    const allowSign = readBoolean(
      effectiveProperty(node, definition, "allowSign"),
    );
    const minimumProperty = readOptionalFiniteNumber(
      effectiveProperty(node, definition, "minimum"),
    );
    const maximumProperty = readOptionalFiniteNumber(
      effectiveProperty(node, definition, "maximum"),
    );
    const minimum = minimumProperty.value;
    const maximum = maximumProperty.value;
    const configurationInvalid =
      decimalSeparator === undefined ||
      groupingSeparator === undefined ||
      normalizeFullWidth === undefined ||
      allowSign === undefined ||
      minimumProperty.invalid ||
      maximumProperty.invalid;
    const sampleText =
      decimalSeparator === undefined ||
      groupingSeparator === undefined ||
      allowSign === undefined
        ? undefined
        : `${allowSign ? "-" : ""}12${groupingSeparator}345${decimalSeparator}67`;

    const equalSeparatorsWarning =
      decimalSeparator !== undefined &&
      groupingSeparator !== undefined &&
      decimalSeparator === groupingSeparator;
    const reversedBoundsWarning =
      minimum !== undefined && maximum !== undefined && minimum > maximum;

    const parsedPort = definition.ports.find(
      (port) => port.direction === "output" && port.portId === "parsed",
    );
    const invalidPort = definition.ports.find(
      (port) => port.direction === "output" && port.portId === "invalid",
    );

    return {
      kind: "parseNumber",
      sampleText,
      decimalSeparator,
      groupingSeparator,
      normalizeFullWidth,
      allowSign,
      minimum,
      maximum,
      configurationInvalid,
      equalSeparatorsWarning,
      reversedBoundsWarning,
      parsedPortId: "parsed",
      parsedPortLabelKey:
        parsedPort?.labelKey ?? "node.text.parseNumber.port.parsed",
      invalidPortId: "invalid",
      invalidPortLabelKey:
        invalidPort?.labelKey ?? "node.text.parseNumber.port.invalid",
    };
  }

  if (node.typeKey === "core.logic.numberCompare") {
    const operatorProperty = effectiveProperty(node, definition, "operator");
    const rawOperator = operatorProperty.value;
    let operator: CompareOperator | "unknown" = "unknown";
    let rawOperatorString: string | undefined = undefined;

    if (operatorProperty.present && typeof rawOperator === "string") {
      if (VALID_OPERATORS.has(rawOperator as CompareOperator)) {
        operator = rawOperator as CompareOperator;
      } else {
        operator = "unknown";
        rawOperatorString = rawOperator;
      }
    } else if (operatorProperty.present) {
      rawOperatorString = displayUnknownValue(rawOperator);
    }

    const leftSource = buildSourceState(
      "left",
      "number",
      node,
      connectedPortIds,
    );
    const rightSource = buildSourceState(
      "right",
      "number",
      node,
      connectedPortIds,
    );

    return {
      kind: "numberCompare",
      operator,
      rawOperator: rawOperatorString,
      leftSource,
      rightSource,
      resultPortId: "result",
      relationPortId: "relation",
    };
  }

  if (node.typeKey === "core.logic.branch") {
    const conditionSource = buildSourceState(
      "condition",
      "boolean",
      node,
      connectedPortIds,
    );

    const whenTruePort = definition.ports.find(
      (port) => port.direction === "output" && port.portId === "whenTrue",
    );
    const whenFalsePort = definition.ports.find(
      (port) => port.direction === "output" && port.portId === "whenFalse",
    );

    return {
      kind: "branch",
      conditionSource,
      whenTruePortId: "whenTrue",
      whenTruePortLabelKey:
        whenTruePort?.labelKey ?? "node.core.logic.branch.port.whenTrue",
      whenFalsePortId: "whenFalse",
      whenFalsePortLabelKey:
        whenFalsePort?.labelKey ?? "node.core.logic.branch.port.whenFalse",
    };
  }

  return undefined;
}
