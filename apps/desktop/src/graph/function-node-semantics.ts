import type {
  GraphV1,
  NodeV1,
  NodeDefinitionV1,
  PortDefinitionV1,
  RinoProjectDocumentV1,
  TypeDescriptorV1,
} from "@rino/contracts";

export const FUNCTION_INPUT_NODE_TYPE = "core.function.input";
export const FUNCTION_RETURN_NODE_TYPE = "core.function.return";
export const FUNCTION_CALL_NODE_TYPE = "core.function.call";

const FUNCTION_PORT_LABEL_KEY = "graph.port.groupBoundary";
const EXECUTION_TYPE: TypeDescriptorV1 = { kind: "exec" };

type FunctionValueKind =
  "bool" | "number" | "string" | "point" | "rect" | "imageRef";

const VALUE_KIND_TYPES: Readonly<Record<FunctionValueKind, TypeDescriptorV1>> =
  {
    bool: { kind: "bool" },
    number: { kind: "number" },
    string: { kind: "string" },
    point: { kind: "point" },
    rect: { kind: "rect" },
    imageRef: { kind: "imageRef" },
  };

/** The validator-facing subset of a registry definition, with dynamic ports attached. */
export interface ResolvedNodeDefinition {
  readonly definition: Pick<
    NodeDefinitionV1,
    | "typeKey"
    | "typeVersion"
    | "runtimeKind"
    | "sideEffect"
    | "category"
    | "titleKey"
    | "descriptionKey"
    | "iconKey"
    | "ports"
    | "propertySchema"
    | "propertyDefaults"
    | "requiredCapabilities"
    | "deprecation"
  >;
  readonly ports: ReadonlyMap<string, PortDefinitionV1>;
  /** Signature names are presentation data and are intentionally not persisted on nodes. */
  readonly portLabels: ReadonlyMap<string, string>;
}

export function isFunctionInternalNode(typeKey: string): boolean {
  return (
    typeKey === FUNCTION_INPUT_NODE_TYPE ||
    typeKey === FUNCTION_RETURN_NODE_TYPE ||
    typeKey === FUNCTION_CALL_NODE_TYPE
  );
}

function makePort(
  portId: string,
  direction: "input" | "output",
  portKind: "execution" | "data",
  type: TypeDescriptorV1,
  options: Pick<PortDefinitionV1, "required" | "acceptsLiteral"> = {},
): PortDefinitionV1 {
  return {
    portId,
    direction,
    portKind,
    type,
    labelKey: FUNCTION_PORT_LABEL_KEY,
    ...options,
  };
}

function fixedExecutionPorts(typeKey: string): Map<string, PortDefinitionV1> {
  const ports = new Map<string, PortDefinitionV1>();
  if (typeKey !== FUNCTION_INPUT_NODE_TYPE) {
    ports.set("run", makePort("run", "input", "execution", EXECUTION_TYPE));
  }
  if (typeKey !== FUNCTION_RETURN_NODE_TYPE) {
    ports.set("next", makePort("next", "output", "execution", EXECUTION_TYPE));
  }
  return ports;
}

function addPortIfAvailable(
  ports: Map<string, PortDefinitionV1>,
  port: PortDefinitionV1,
  dynamic = false,
): void {
  // Reserved names and duplicate signature ports are diagnosed separately. Keeping the
  // fixed execution port wins here prevents malformed signatures from changing its kind.
  if (dynamic && (port.portId === "run" || port.portId === "next")) {
    return;
  }
  if (!ports.has(port.portId)) {
    ports.set(port.portId, port);
  }
}

function addInputParameters(
  ports: Map<string, PortDefinitionV1>,
  portLabels: Map<string, string>,
  parameters: readonly {
    portId: string;
    name: string;
    valueKind: FunctionValueKind;
  }[],
  acceptsLiteral: boolean,
): void {
  for (const parameter of parameters) {
    addPortIfAvailable(
      ports,
      makePort(
        parameter.portId,
        "input",
        "data",
        VALUE_KIND_TYPES[parameter.valueKind],
        {
          required: true,
          ...(acceptsLiteral &&
          (parameter.valueKind === "bool" ||
            parameter.valueKind === "number" ||
            parameter.valueKind === "string")
            ? { acceptsLiteral: true }
            : {}),
        },
      ),
      true,
    );
    portLabels.set(parameter.portId, parameter.name);
  }
}

function addOutputParameters(
  ports: Map<string, PortDefinitionV1>,
  portLabels: Map<string, string>,
  parameters: readonly {
    portId: string;
    name: string;
    valueKind: FunctionValueKind;
  }[],
): void {
  for (const parameter of parameters) {
    addPortIfAvailable(
      ports,
      makePort(
        parameter.portId,
        "output",
        "data",
        VALUE_KIND_TYPES[parameter.valueKind],
      ),
      true,
    );
    portLabels.set(parameter.portId, parameter.name);
  }
}

function presentationDefinition(
  typeKey: string,
  runtimeKind: "entry" | "execution",
  titleKey: string,
  descriptionKey: string,
  ports: ReadonlyMap<string, PortDefinitionV1>,
): ResolvedNodeDefinition["definition"] {
  return {
    typeKey,
    typeVersion: 1,
    runtimeKind,
    sideEffect: runtimeKind === "entry" ? "none" : "runtime",
    category: "flow",
    titleKey,
    descriptionKey,
    iconKey: "category.flow",
    ports: [...ports.values()],
  };
}

function resolvedDefinition(
  node: NodeV1,
  graph: GraphV1,
  document: RinoProjectDocumentV1 | undefined,
): ResolvedNodeDefinition {
  const ports = fixedExecutionPorts(node.typeKey);
  const portLabels = new Map<string, string>();
  let runtimeKind: "entry" | "execution" = "execution";
  let titleKey = "node.core.function.call.title";
  let descriptionKey = "node.core.function.call.description";

  if (node.typeKey === FUNCTION_INPUT_NODE_TYPE) {
    runtimeKind = "entry";
    titleKey = "node.core.function.input.title";
    descriptionKey = "node.core.function.input.description";
    addOutputParameters(
      ports,
      portLabels,
      graph.functionSignature?.inputs ?? [],
    );
  } else if (node.typeKey === FUNCTION_RETURN_NODE_TYPE) {
    titleKey = "node.core.function.return.title";
    descriptionKey = "node.core.function.return.description";
    addInputParameters(
      ports,
      portLabels,
      graph.functionSignature?.outputs ?? [],
      false,
    );
  } else {
    const target = targetGraph(node, document);
    if (target?.kind === "function" && target.functionSignature !== undefined) {
      addInputParameters(
        ports,
        portLabels,
        target.functionSignature.inputs,
        true,
      );
      addOutputParameters(ports, portLabels, target.functionSignature.outputs);
    }
  }

  return {
    definition: presentationDefinition(
      node.typeKey,
      runtimeKind,
      titleKey,
      descriptionKey,
      ports,
    ),
    ports,
    portLabels,
  };
}

function targetGraph(
  node: NodeV1,
  document: RinoProjectDocumentV1 | undefined,
): GraphV1 | undefined {
  const target = node.properties["functionGraphId"];
  if (typeof target !== "string" || document === undefined) {
    return undefined;
  }
  return document.graphs.find((graph) => graph.graphId === target);
}

function signatureIdentity(signature: GraphV1["functionSignature"]): string {
  if (signature === undefined) {
    return "none";
  }
  return [...signature.inputs, ...signature.outputs]
    .map(
      (parameter) =>
        `${parameter.parameterId}:${parameter.portId}:${parameter.name}:${parameter.valueKind}`,
    )
    .join("|");
}

/** Stable cache identity for a dynamic function definition.
 * It includes the target graph's name because the call node displays that name. */
export function functionNodeDefinitionCacheKey(
  node: NodeV1,
  graph: GraphV1,
  document?: RinoProjectDocumentV1,
): string {
  if (
    node.typeKey === FUNCTION_INPUT_NODE_TYPE ||
    node.typeKey === FUNCTION_RETURN_NODE_TYPE
  ) {
    return `${node.typeKey}:${signatureIdentity(graph.functionSignature)}`;
  }
  if (node.typeKey !== FUNCTION_CALL_NODE_TYPE) {
    return `registry:${node.typeKey}`;
  }
  const target = targetGraph(node, document);
  const targetGraphId = node.properties["functionGraphId"];
  const targetGraphIdText =
    typeof targetGraphId === "string" ? targetGraphId : "";
  return `${node.typeKey}:${targetGraphIdText}:${target?.name ?? ""}:${signatureIdentity(target?.functionSignature)}`;
}

/** Resolves ports for internal function nodes without adding them to the production registry. */
export function resolveFunctionNodeDefinition(
  node: NodeV1,
  graph: GraphV1,
  document?: RinoProjectDocumentV1,
): ResolvedNodeDefinition | undefined {
  if (!isFunctionInternalNode(node.typeKey)) {
    return undefined;
  }
  return resolvedDefinition(node, graph, document);
}

/** Presentation-aware alias used by the canvas while keeping internal nodes out of the registry. */
export const resolveFunctionNodePresentation = resolveFunctionNodeDefinition;
