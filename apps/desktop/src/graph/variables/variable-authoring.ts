import type { RinoProjectDocumentV1 } from "@rino/contracts";

/** The project contract's variable definition without requiring a generated re-export. */
export type VariableDefinition = NonNullable<
  RinoProjectDocumentV1["variables"]
>[number];
export type VariableValueKind = VariableDefinition["valueKind"];

export type VariableNodeRole = "getter" | "setter";

/** The document shape accepted while an old graph-scoped project is being normalized. */
export type VariableDocumentSource = Partial<
  Pick<RinoProjectDocumentV1, "variables" | "graphs">
>;

/** Returns project variables, falling back only to the selected legacy graph. */
export function variablesForGraph(
  document: VariableDocumentSource,
  graphId: string | undefined,
): readonly VariableDefinition[] {
  if (document.variables !== undefined) {
    return document.variables;
  }
  return (
    document.graphs?.find((graph) => graph.graphId === graphId)?.variables ?? []
  );
}

const VARIABLE_NODE_KINDS: Readonly<Record<string, VariableValueKind>> = {
  "core.variable.getBool": "bool",
  "core.variable.setBool": "bool",
  "core.variable.getNumber": "number",
  "core.variable.setNumber": "number",
  "core.variable.getString": "string",
  "core.variable.setString": "string",
  "core.variable.getPoint": "point",
  "core.variable.setPoint": "point",
  "core.variable.getRect": "rect",
  "core.variable.setRect": "rect",
  "core.variable.getImageRef": "imageRef",
  "core.variable.setImageRef": "imageRef",
};

const VARIABLE_NAME_BASES: Readonly<Record<VariableValueKind, string>> = {
  bool: "bool",
  number: "number",
  string: "text",
  point: "point",
  rect: "region",
  imageRef: "image",
};

export const VARIABLE_NODE_TYPE_KEYS = Object.freeze(
  Object.keys(VARIABLE_NODE_KINDS),
);

export function variableValueKindForNodeTypeKey(
  typeKey: string,
): VariableValueKind | undefined {
  return VARIABLE_NODE_KINDS[typeKey];
}

export function variableNodeRoleForTypeKey(
  typeKey: string,
): VariableNodeRole | undefined {
  if (variableValueKindForNodeTypeKey(typeKey) === undefined) {
    return undefined;
  }
  if (typeKey.startsWith("core.variable.get")) {
    return "getter";
  }
  if (typeKey.startsWith("core.variable.set")) {
    return "setter";
  }
  return undefined;
}

export function normalizeVariableName(name: string): string {
  return name.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

/** Returns a language-independent name that is unique under graph name normalization. */
export function nextVariableName(
  valueKind: VariableValueKind,
  existing: readonly VariableDefinition[],
): string {
  const used = new Set(
    existing.map((variable) => normalizeVariableName(variable.name)),
  );
  const base = VARIABLE_NAME_BASES[valueKind];
  let ordinal = 1;
  while (used.has(normalizeVariableName(`${base}${String(ordinal)}`))) {
    ordinal += 1;
  }
  return `${base}${String(ordinal)}`;
}

export function createVariableDefinition(
  valueKind: VariableValueKind,
  existing: readonly VariableDefinition[],
  createIdentifier: () => string,
): VariableDefinition {
  return {
    variableId: createIdentifier(),
    name: nextVariableName(valueKind, existing),
    valueKind,
    persistent: false,
  };
}
