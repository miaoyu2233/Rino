import type {
  EdgeV1,
  GraphV1,
  NodeV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";

/** The measurement scenes the editor performance gate is held to.
 *
 * The master plan names three sizes with a fixed edge-to-node ratio of 1.5. The scenes are
 * built rather than stored so a change to the node registry cannot leave a checked-in
 * fixture describing nodes that no longer exist.
 *
 * Every identifier is derived from the scene name and a local name, so two runs of the
 * same scene produce byte-identical documents. Nothing here uses `crypto.randomUUID`, the
 * clock, or a random source: a measurement that cannot be repeated is not evidence.
 */
export type GraphSceneName = "small" | "reference" | "stress";

export interface GraphScene {
  name: GraphSceneName;
  document: RinoProjectDocumentV1;
  graph: GraphV1;
  nodeCount: number;
  edgeCount: number;
}

/** How many units of each shape a named scene is made of.
 *
 * A simple unit is four flow and arithmetic nodes. A mixed unit adds capture and
 * recognition nodes, so the reference scene exercises the wider port shapes the editor has
 * to draw. Both shapes carry exactly 1.5 edges per node, which is what keeps a scene's
 * totals equal to the plan's numbers whatever mixture is used.
 */
const SCENE_SHAPES = {
  small: { simpleUnits: 25, mixedUnits: 0 },
  reference: { simpleUnits: 1, mixedUnits: 62 },
  stress: { simpleUnits: 250, mixedUnits: 0 },
} as const satisfies Record<
  GraphSceneName,
  { simpleUnits: number; mixedUnits: number }
>;

const SIMPLE_UNIT_NODES = 4;
const MIXED_UNIT_NODES = 8;
const EDGES_PER_NODE = 1.5;

/** Laid out on a grid so positions are distinct and a scene occupies a plausible area
 * instead of stacking every node at the origin. */
const COLUMN_SPACING = 320;
const ROW_SPACING = 200;
const UNITS_PER_ROW = 8;
const SLOTS_PER_UNIT = MIXED_UNIT_NODES;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const HEX_RADIX = 16;

function fnv1a(text: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

function hexBlock(seed: string, length: number): string {
  let block = "";
  let round = 0;
  while (block.length < length) {
    block += fnv1a(`${seed}:${String(round)}`)
      .toString(HEX_RADIX)
      .padStart(8, "0");
    round += 1;
  }
  return block.slice(0, length);
}

/** A UUID-shaped identifier derived from a name.
 *
 * The persisted format requires the UUID form and a measurement scene requires stable
 * identifiers, so the two are reconciled by hashing the name into the digits and stamping
 * the version and variant nibbles the format expects.
 */
export function sceneIdentifier(seed: string): string {
  const digits = hexBlock(seed, 30);
  return [
    digits.slice(0, 8),
    digits.slice(8, 12),
    `4${digits.slice(12, 15)}`,
    `8${digits.slice(15, 18)}`,
    digits.slice(18, 30),
  ].join("-");
}

/** A stable digest of a built scene.
 *
 * The plan requires a measurement to record which fixture produced it. Recording the
 * digest beside a measured number is what makes a later number comparable: if the scene
 * changed, the digest changed and the earlier measurement no longer describes the same
 * work.
 */
export function sceneDigest(scene: GraphScene): string {
  return fnv1a(JSON.stringify(scene.document))
    .toString(HEX_RADIX)
    .padStart(8, "0");
}

interface SceneBuilder {
  sceneName: GraphSceneName;
  nodes: NodeV1[];
  edges: EdgeV1[];
}

interface PortReference {
  nodeId: string;
  portId: string;
}

function addNode(
  builder: SceneBuilder,
  localName: string,
  typeKey: string,
  unitIndex: number,
  slot: number,
  properties: NodeV1["properties"] = {},
): string {
  const nodeId = sceneIdentifier(`${builder.sceneName}/node/${localName}`);
  const column = unitIndex % UNITS_PER_ROW;
  const row = Math.floor(unitIndex / UNITS_PER_ROW);
  builder.nodes.push({
    nodeId,
    typeKey,
    typeVersion: 1,
    position: {
      x: column * COLUMN_SPACING,
      y: (row * SLOTS_PER_UNIT + slot) * ROW_SPACING,
    },
    properties,
    inputValues: {},
  });
  return nodeId;
}

function addEdge(
  builder: SceneBuilder,
  edgeKind: EdgeV1["edgeKind"],
  source: PortReference,
  target: PortReference,
): void {
  builder.edges.push({
    edgeId: sceneIdentifier(
      `${builder.sceneName}/edge/${String(builder.edges.length)}`,
    ),
    edgeKind,
    sourceNodeId: source.nodeId,
    sourcePortId: source.portId,
    targetNodeId: target.nodeId,
    targetPortId: target.portId,
  });
}

interface SceneUnit {
  /** Absent on the first unit, which spends the slot on the graph's entry node. */
  literalNodeId: string | undefined;
  entryNodeId: string | undefined;
  comparisonNodeIds: readonly [string, string];
  branchNodeId: string;
  /** Present on a mixed unit: the recognition branch the execution chain leaves through. */
  tailBranchNodeId: string | undefined;
}

function buildUnit(
  builder: SceneBuilder,
  unitIndex: number,
  shape: "simple" | "mixed",
): SceneUnit {
  const prefix = `unit-${String(unitIndex)}`;
  const isFirstUnit = unitIndex === 0;
  const literalNodeId = isFirstUnit
    ? undefined
    : addNode(
        builder,
        `${prefix}/literal`,
        "core.value.numberLiteral",
        unitIndex,
        0,
      );
  const entryNodeId = isFirstUnit
    ? addNode(builder, `${prefix}/start`, "core.flow.start", unitIndex, 0)
    : undefined;
  const comparisonNodeIds = [
    addNode(
      builder,
      `${prefix}/compare-a`,
      "core.logic.numberCompare",
      unitIndex,
      1,
      { operator: "greaterThan" },
    ),
    addNode(
      builder,
      `${prefix}/compare-b`,
      "core.logic.numberCompare",
      unitIndex,
      2,
      { operator: "lessThan" },
    ),
  ] as const;
  const branchNodeId = addNode(
    builder,
    `${prefix}/branch`,
    "core.logic.branch",
    unitIndex,
    3,
  );

  if (shape === "simple") {
    return {
      literalNodeId,
      entryNodeId,
      comparisonNodeIds,
      branchNodeId,
      tailBranchNodeId: undefined,
    };
  }

  const sequenceNodeId = addNode(
    builder,
    `${prefix}/sequence`,
    "core.flow.sequence",
    unitIndex,
    4,
  );
  const captureNodeId = addNode(
    builder,
    `${prefix}/capture`,
    "automation.captureScreen",
    unitIndex,
    5,
  );
  const recognizeNodeId = addNode(
    builder,
    `${prefix}/recognize`,
    "vision.ocr",
    unitIndex,
    6,
  );
  const tailBranchNodeId = addNode(
    builder,
    `${prefix}/branch-recognized`,
    "core.logic.branch",
    unitIndex,
    7,
  );

  addEdge(
    builder,
    "execution",
    { nodeId: branchNodeId, portId: "whenTrue" },
    { nodeId: sequenceNodeId, portId: "run" },
  );
  addEdge(
    builder,
    "execution",
    { nodeId: sequenceNodeId, portId: "steps" },
    { nodeId: captureNodeId, portId: "run" },
  );
  addEdge(
    builder,
    "execution",
    { nodeId: captureNodeId, portId: "next" },
    { nodeId: recognizeNodeId, portId: "run" },
  );
  addEdge(
    builder,
    "data",
    { nodeId: captureNodeId, portId: "image" },
    { nodeId: recognizeNodeId, portId: "image" },
  );
  addEdge(
    builder,
    "data",
    { nodeId: recognizeNodeId, portId: "matched" },
    { nodeId: tailBranchNodeId, portId: "condition" },
  );
  addEdge(
    builder,
    "execution",
    { nodeId: recognizeNodeId, portId: "next" },
    { nodeId: tailBranchNodeId, portId: "run" },
  );

  return {
    literalNodeId,
    entryNodeId,
    comparisonNodeIds,
    branchNodeId,
    tailBranchNodeId,
  };
}

export function buildGraphScene(name: GraphSceneName): GraphScene {
  const shape = SCENE_SHAPES[name];
  const builder: SceneBuilder = { sceneName: name, nodes: [], edges: [] };
  const units: SceneUnit[] = [];

  for (
    let unitIndex = 0;
    unitIndex < shape.simpleUnits + shape.mixedUnits;
    unitIndex += 1
  ) {
    units.push(
      buildUnit(
        builder,
        unitIndex,
        unitIndex < shape.simpleUnits ? "simple" : "mixed",
      ),
    );
  }

  /** The first unit spends its literal slot on the entry node, so it reads the following
   * unit's literal. Every scene therefore needs at least two units. */
  const numberSourceFor = (unitIndex: number): string => {
    const source =
      units[unitIndex]?.literalNodeId ?? units[unitIndex + 1]?.literalNodeId;
    if (source === undefined) {
      throw new Error(
        `Scene ${name} has no number source for unit ${String(unitIndex)}.`,
      );
    }
    return source;
  };

  for (const [unitIndex, unit] of units.entries()) {
    const numberSource = numberSourceFor(unitIndex);
    for (const comparisonNodeId of unit.comparisonNodeIds) {
      for (const portId of ["left", "right"]) {
        addEdge(
          builder,
          "data",
          { nodeId: numberSource, portId: "value" },
          { nodeId: comparisonNodeId, portId },
        );
      }
    }
    addEdge(
      builder,
      "data",
      { nodeId: unit.comparisonNodeIds[0], portId: "result" },
      { nodeId: unit.branchNodeId, portId: "condition" },
    );

    const previous = units[unitIndex - 1];
    const executionSource: PortReference =
      previous === undefined
        ? { nodeId: unit.entryNodeId ?? "", portId: "next" }
        : previous.tailBranchNodeId === undefined
          ? { nodeId: previous.branchNodeId, portId: "whenFalse" }
          : { nodeId: previous.tailBranchNodeId, portId: "whenTrue" };
    addEdge(builder, "execution", executionSource, {
      nodeId: unit.branchNodeId,
      portId: "run",
    });
  }

  const graphId = sceneIdentifier(`${name}/graph`);
  const graph: GraphV1 = {
    graphId,
    name: `scene-${name}`,
    kind: "entry",
    nodes: builder.nodes,
    edges: builder.edges,
  };

  return {
    name,
    graph,
    nodeCount: builder.nodes.length,
    edgeCount: builder.edges.length,
    document: {
      schemaVersion: 1,
      documentId: sceneIdentifier(`${name}/document`),
      metadata: {
        name: `Rino performance scene ${name}`,
        createdAt: "2026-07-27T00:00:00.000Z",
        updatedAt: "2026-07-27T00:00:00.000Z",
      },
      entryGraphId: graphId,
      graphs: [graph],
      assets: [],
      requiredCapabilities: [],
    },
  };
}

function sceneSize(shape: { simpleUnits: number; mixedUnits: number }): {
  nodes: number;
  edges: number;
} {
  const nodes =
    shape.simpleUnits * SIMPLE_UNIT_NODES + shape.mixedUnits * MIXED_UNIT_NODES;
  return { nodes, edges: nodes * EDGES_PER_NODE };
}

/** The node and edge totals the master plan's performance scenes are defined by. */
export const expectedSceneSize: Record<
  GraphSceneName,
  { nodes: number; edges: number }
> = {
  small: sceneSize(SCENE_SHAPES.small),
  reference: sceneSize(SCENE_SHAPES.reference),
  stress: sceneSize(SCENE_SHAPES.stress),
};
