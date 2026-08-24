import {
  describeGraphDocumentErrors,
  describeProjectDocumentErrors,
  describeProjectManifestErrors,
  isValidGraphDocument,
  isValidProjectDocument,
  isValidProjectManifest,
  type GraphV1,
  type ImageAssetV1,
  type RinoProjectDocumentV1,
} from "@rino/contracts";

import { findDuplicateAssetDisplayName } from "./asset-names";
import { migrateProjectManifest } from "./project-migration";
import { normalizeVariableName } from "../variables/variable-authoring";
import {
  allocateGraphFileName,
  isAllocatableGraphFileName,
  PROJECT_MANIFEST_FILE_NAME,
} from "./project-paths";

/** One file of the project directory, named relative to the directory that owns it. */
export interface ProjectFileContents {
  fileName: string;
  contents: string;
}

/** The complete text form of a project, ready to be written or compared. */
export interface SerializedProject {
  manifest: string;
  graphs: ProjectFileContents[];
  /** The graph file name each graph is stored under, including names allocated here. */
  graphFileNames: ReadonlyMap<string, string>;
}

export type ProjectSerializeResult =
  | { ok: true; value: SerializedProject }
  | { ok: false; failure: ProjectFormatFailure };

export type ProjectFormatFailure =
  /** A file on disk is not JSON at all. */
  | { reason: "notJson"; fileName: string }
  /** A file is JSON but does not match its canonical definition. */
  | { reason: "invalidShape"; fileName: string; detail: string }
  /** The manifest declares a schema version this build cannot read. */
  | { reason: "unsupportedVersion"; foundVersion: number }
  /** The manifest names a graph file that is not present. */
  | { reason: "graphFileMissing"; fileName: string }
  /** A graph file belongs to a different project or a different graph. */
  | { reason: "graphFileMismatch"; fileName: string }
  /** The manifest lists one graph or one file name twice. */
  | { reason: "duplicateGraphEntry"; fileName: string }
  /** The manifest's entry graph is not among its graphs. */
  | { reason: "entryGraphMissing" }
  /** Two asset records normalize onto the same display name. */
  | { reason: "duplicateAssetName"; displayName: string }
  /** The assembled document is not a valid project document. */
  | { reason: "documentInvalid"; detail: string };

export type ProjectParseResult =
  | { ok: true; value: LoadedProject }
  | { ok: false; failure: ProjectFormatFailure };

export interface LoadedProject {
  document: RinoProjectDocumentV1;
  graphFileNames: ReadonlyMap<string, string>;
}

type JsonRecord = Record<string, unknown>;

function failure(reason: ProjectFormatFailure): ProjectSerializeResult {
  return { ok: false, failure: reason };
}

/** Recursively orders the keys of a free-form JSON value.
 *
 * Node properties and literal inputs are user-shaped JSON whose key order depends on how
 * the value was built. Ordering them here is what makes a saved file a function of the
 * document alone, so saving an unchanged project rewrites nothing.
 */
function orderJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(orderJsonValue);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    // JSON has no representation for these, and stringify would quietly emit null.
    throw new RangeError("A stored value is not a finite number.");
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const source = value as JsonRecord;
  const ordered: JsonRecord = {};
  for (const key of Object.keys(source).sort()) {
    ordered[key] = orderJsonValue(source[key]);
  }
  return ordered;
}

/** Writes one document with a trailing newline, the shape a text editor expects. */
function writeJson(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

type FunctionParameterList = NonNullable<
  GraphV1["functionSignature"]
>["inputs"];

function orderFunctionParameters<T extends FunctionParameterList>(
  parameters: T,
): T {
  // The generated maxItems union encodes each permitted length as a tuple; mapping keeps that length and author order.
  return parameters.map((parameter) => ({
    parameterId: parameter.parameterId,
    portId: parameter.portId,
    name: parameter.name,
    valueKind: parameter.valueKind,
  })) as T;
}

type ProjectVariableDefinition = NonNullable<
  RinoProjectDocumentV1["variables"]
>[number];

function orderVariable(
  variable: ProjectVariableDefinition,
): ProjectVariableDefinition {
  return {
    variableId: variable.variableId,
    name: variable.name,
    valueKind: variable.valueKind,
    persistent: variable.persistent,
  };
}

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}

function sourceQualifiedName(
  originalName: string,
  sourceName: string,
  ordinal?: number,
): string {
  const boundedSource = truncateCodePoints(sourceName, 76);
  const sourceSuffix = ` (${boundedSource})`;
  const ordinalSuffix = ordinal === undefined ? "" : ` ${ordinal}`;
  const prefixLimit = Math.max(
    1,
    80 - Array.from(sourceSuffix).length - Array.from(ordinalSuffix).length,
  );
  return `${truncateCodePoints(originalName, prefixLimit)}${sourceSuffix}${ordinalSuffix}`;
}

interface LegacyVariableSource {
  graphName: string;
  variables: readonly ProjectVariableDefinition[];
}

type VariableMergeResult =
  | { ok: true; variables: ProjectVariableDefinition[] }
  | { ok: false; detail: string };

function sameVariableDefinition(
  left: ProjectVariableDefinition,
  right: ProjectVariableDefinition,
): boolean {
  return (
    left.name === right.name &&
    left.valueKind === right.valueKind &&
    left.persistent === right.persistent
  );
}

/** Promotes legacy graph definitions into one deterministic project scope. */
function mergeProjectVariables(
  manifestVariables: readonly ProjectVariableDefinition[] | undefined,
  legacySources: readonly LegacyVariableSource[],
): VariableMergeResult {
  const merged: ProjectVariableDefinition[] = [];
  const byId = new Map<string, ProjectVariableDefinition>();
  const usedNames = new Set<string>();
  const sources: Array<{
    definition: ProjectVariableDefinition;
    sourceName: string;
  }> = [
    ...(manifestVariables ?? []).map((definition) => ({
      definition,
      sourceName: "项目",
    })),
    ...legacySources.flatMap((source) =>
      source.variables.map((definition) => ({
        definition,
        sourceName: source.graphName,
      })),
    ),
  ];

  for (const { definition, sourceName } of sources) {
    const existing = byId.get(definition.variableId);
    if (existing !== undefined) {
      if (!sameVariableDefinition(existing, definition)) {
        return {
          ok: false,
          detail: `/variables/${definition.variableId} has conflicting definitions`,
        };
      }
      continue;
    }

    let name = definition.name;
    if (usedNames.has(normalizeVariableName(name))) {
      name = sourceQualifiedName(definition.name, sourceName);
      let ordinal = 2;
      while (usedNames.has(normalizeVariableName(name))) {
        name = sourceQualifiedName(definition.name, sourceName, ordinal);
        ordinal += 1;
      }
    }
    const normalized = normalizeVariableName(name);
    if (usedNames.has(normalized)) {
      return {
        ok: false,
        detail: `/variables/${definition.variableId} could not be assigned a unique name`,
      };
    }
    const promoted =
      name === definition.name ? definition : { ...definition, name };
    byId.set(promoted.variableId, promoted);
    usedNames.add(normalized);
    merged.push(promoted);
  }
  return { ok: true, variables: merged };
}

function legacyVariableSourcesForGraphs(
  graphs: readonly GraphV1[],
): LegacyVariableSource[] {
  return graphs.flatMap((graph) =>
    graph.variables === undefined || graph.variables.length === 0
      ? []
      : [{ graphName: graph.name, variables: graph.variables }],
  );
}

function withoutLegacyVariables(graph: GraphV1): GraphV1 {
  const copy = { ...graph };
  delete copy.variables;
  return copy;
}
/** Rebuilds one graph with its keys in canonical order.
 *
 * The properties are listed in the order the canonical schema declares them rather than
 * the order the in-memory object happens to carry, so two builds of the same graph
 * produce the same bytes.
 */
function orderGraph(graph: GraphV1): GraphV1 {
  return {
    graphId: graph.graphId,
    name: graph.name,
    kind: graph.kind,
    ...(graph.functionSignature === undefined
      ? {}
      : {
          functionSignature: {
            inputs: orderFunctionParameters(graph.functionSignature.inputs),
            outputs: orderFunctionParameters(graph.functionSignature.outputs),
          },
        }),
    nodes: graph.nodes.map((node) => ({
      nodeId: node.nodeId,
      typeKey: node.typeKey,
      typeVersion: node.typeVersion,
      ...(node.displayAlias === undefined
        ? {}
        : { displayAlias: node.displayAlias }),
      position: { x: node.position.x, y: node.position.y },
      properties: orderJsonValue(node.properties) as NodeProperties,
      inputValues: orderJsonValue(node.inputValues) as NodeProperties,
      ...(node.dynamicPortState === undefined
        ? {}
        : {
            dynamicPortState: orderJsonValue(
              node.dynamicPortState,
            ) as NodeProperties,
          }),
      ...(node.disabled === undefined ? {} : { disabled: node.disabled }),
      ...(node.breakpoint === undefined ? {} : { breakpoint: node.breakpoint }),
    })),
    edges: graph.edges.map((edge) => ({
      edgeId: edge.edgeId,
      edgeKind: edge.edgeKind,
      sourceNodeId: edge.sourceNodeId,
      sourcePortId: edge.sourcePortId,
      targetNodeId: edge.targetNodeId,
      targetPortId: edge.targetPortId,
    })),
    ...(graph.editorMetadata === undefined
      ? {}
      : {
          editorMetadata: {
            ...(graph.editorMetadata.comments === undefined
              ? {}
              : {
                  comments: graph.editorMetadata.comments.map((comment) => ({
                    commentId: comment.commentId,
                    text: comment.text,
                    position: {
                      x: comment.position.x,
                      y: comment.position.y,
                    },
                    ...(comment.size === undefined
                      ? {}
                      : {
                          size: {
                            width: comment.size.width,
                            height: comment.size.height,
                          },
                        }),
                  })),
                }),
            ...(graph.editorMetadata.workflowGroups === undefined
              ? {}
              : {
                  workflowGroups: graph.editorMetadata.workflowGroups.map(
                    (group) => ({
                      groupId: group.groupId,
                      kind: group.kind,
                      members: group.members.map((member) => ({
                        role: member.role,
                        nodeId: member.nodeId,
                      })) as typeof group.members,
                      exposedPorts: group.exposedPorts.map((port) => ({
                        proxyPortId: port.proxyPortId,
                        nodeId: port.nodeId,
                        portId: port.portId,
                        labelKey: port.labelKey,
                      })),
                      collapsed: group.collapsed,
                    }),
                  ),
                }),
            ...(graph.editorMetadata.repeatHints === undefined
              ? {}
              : {
                  repeatHints: graph.editorMetadata.repeatHints.map((hint) => ({
                    hintId: hint.hintId,
                    edgeId: hint.edgeId,
                    position: {
                      x: hint.position.x,
                      y: hint.position.y,
                    },
                  })),
                }),
          },
        }),
  };
}

type NodeProperties = GraphV1["nodes"][number]["properties"];

function orderAsset(asset: ImageAssetV1): ImageAssetV1 {
  return {
    assetId: asset.assetId,
    displayName: asset.displayName,
    contentHash: asset.contentHash,
    mediaType: asset.mediaType,
    byteLength: asset.byteLength,
    coordinateSpace: {
      spaceId: asset.coordinateSpace.spaceId,
      width: asset.coordinateSpace.width,
      height: asset.coordinateSpace.height,
    },
    sourceKind: asset.sourceKind,
    createdAt: asset.createdAt,
  };
}

/** Turns a document into the exact text of every file the project directory holds.
 *
 * Graph file names already known to the caller are reused so a graph keeps its file
 * across saves; a graph the caller has no name for is assigned one here.
 */
export function serializeProject(
  document: RinoProjectDocumentV1,
  knownGraphFileNames: ReadonlyMap<string, string>,
): ProjectSerializeResult {
  // The uniqueness rule is rechecked here, inside the transaction that produces the
  // bytes, because a check performed while the user was still editing cannot promise the
  // manifest being committed is still free of collisions.
  const duplicate = findDuplicateAssetDisplayName(document.assets);
  if (duplicate !== undefined) {
    return failure({ reason: "duplicateAssetName", displayName: duplicate });
  }

  const graphFileNames = new Map<string, string>();
  const taken = new Set<string>();
  for (const graph of document.graphs) {
    const known = knownGraphFileNames.get(graph.graphId);
    const fileName =
      known !== undefined &&
      isAllocatableGraphFileName(known) &&
      !taken.has(known)
        ? known
        : allocateGraphFileName(graph.graphId === document.entryGraphId, taken);
    graphFileNames.set(graph.graphId, fileName);
    taken.add(fileName);
  }

  const variableMerge = mergeProjectVariables(
    document.variables,
    legacyVariableSourcesForGraphs(document.graphs),
  );
  if (!variableMerge.ok) {
    return failure({ reason: "documentInvalid", detail: variableMerge.detail });
  }

  const manifest = {
    schemaVersion: 1 as const,
    documentId: document.documentId,
    metadata: {
      name: document.metadata.name,
      createdAt: document.metadata.createdAt,
      updatedAt: document.metadata.updatedAt,
    },
    entryGraphId: document.entryGraphId,
    graphs: document.graphs.map((graph) => ({
      graphId: graph.graphId,
      // Every graph received a name in the loop above.
      fileName: graphFileNames.get(graph.graphId) ?? "",
    })),
    variables: variableMerge.variables.map(orderVariable),
    assets: document.assets.map(orderAsset),
    requiredCapabilities: [...document.requiredCapabilities],
  };

  if (!isValidProjectManifest(manifest)) {
    return failure({
      reason: "invalidShape",
      fileName: PROJECT_MANIFEST_FILE_NAME,
      detail: describeProjectManifestErrors(manifest),
    });
  }

  const graphs: ProjectFileContents[] = [];
  for (const graph of document.graphs) {
    const fileName = graphFileNames.get(graph.graphId) ?? "";
    let graphDocument;
    try {
      graphDocument = {
        schemaVersion: 1 as const,
        documentId: document.documentId,
        graph: orderGraph(graph),
      };
    } catch {
      return failure({
        reason: "invalidShape",
        fileName,
        detail: "nonFiniteNumber",
      });
    }
    if (!isValidGraphDocument(graphDocument)) {
      return failure({
        reason: "invalidShape",
        fileName,
        detail: describeGraphDocumentErrors(graphDocument),
      });
    }
    graphs.push({ fileName, contents: writeJson(graphDocument) });
  }

  return {
    ok: true,
    value: { manifest: writeJson(manifest), graphs, graphFileNames },
  };
}

function parseJsonRecord(
  fileName: string,
  contents: string,
): JsonRecord | ProjectFormatFailure {
  let decoded: unknown;
  try {
    decoded = JSON.parse(contents);
  } catch {
    return { reason: "notJson", fileName };
  }
  if (
    decoded === null ||
    typeof decoded !== "object" ||
    Array.isArray(decoded)
  ) {
    return { reason: "invalidShape", fileName, detail: "/ type" };
  }
  return decoded as JsonRecord;
}

function isFailure(
  value: JsonRecord | ProjectFormatFailure,
): value is ProjectFormatFailure {
  return "reason" in value;
}

/** Rebuilds one in-memory document from the text of a project directory.
 *
 * Every file is untrusted input: it is decoded, raised to the current schema version,
 * and validated against its canonical definition before any part of it reaches the
 * editor. Graph files not named by the manifest are ignored, because the manifest is
 * what defines the project.
 */
export function parseProject(files: {
  manifest: string;
  graphs: readonly ProjectFileContents[];
}): ProjectParseResult {
  const decodedManifest = parseJsonRecord(
    PROJECT_MANIFEST_FILE_NAME,
    files.manifest,
  );
  if (isFailure(decodedManifest)) {
    return { ok: false, failure: decodedManifest };
  }

  const migration = migrateProjectManifest(decodedManifest);
  if (migration.status === "unsupportedVersion") {
    return {
      ok: false,
      failure: {
        reason: "unsupportedVersion",
        foundVersion: migration.foundVersion,
      },
    };
  }
  if (migration.status === "unreadableVersion") {
    return {
      ok: false,
      failure: {
        reason: "invalidShape",
        fileName: PROJECT_MANIFEST_FILE_NAME,
        detail: "/schemaVersion type",
      },
    };
  }

  const manifest = migration.manifest;
  if (!isValidProjectManifest(manifest)) {
    return {
      ok: false,
      failure: {
        reason: "invalidShape",
        fileName: PROJECT_MANIFEST_FILE_NAME,
        detail: describeProjectManifestErrors(manifest),
      },
    };
  }

  const contentsByFileName = new Map(
    files.graphs.map((file) => [file.fileName, file.contents]),
  );
  const graphFileNames = new Map<string, string>();
  const seenFileNames = new Set<string>();
  const graphs: GraphV1[] = [];
  const legacyVariableGraphs: GraphV1[] = [];

  for (const entry of manifest.graphs) {
    if (
      graphFileNames.has(entry.graphId) ||
      seenFileNames.has(entry.fileName)
    ) {
      return {
        ok: false,
        failure: { reason: "duplicateGraphEntry", fileName: entry.fileName },
      };
    }
    seenFileNames.add(entry.fileName);

    const contents = contentsByFileName.get(entry.fileName);
    if (contents === undefined) {
      return {
        ok: false,
        failure: { reason: "graphFileMissing", fileName: entry.fileName },
      };
    }

    const decoded = parseJsonRecord(entry.fileName, contents);
    if (isFailure(decoded)) {
      return { ok: false, failure: decoded };
    }
    if (!isValidGraphDocument(decoded)) {
      return {
        ok: false,
        failure: {
          reason: "invalidShape",
          fileName: entry.fileName,
          detail: describeGraphDocumentErrors(decoded),
        },
      };
    }
    if (
      decoded.documentId !== manifest.documentId ||
      decoded.graph.graphId !== entry.graphId
    ) {
      return {
        ok: false,
        failure: { reason: "graphFileMismatch", fileName: entry.fileName },
      };
    }

    graphFileNames.set(entry.graphId, entry.fileName);
    const graph = decoded.graph;
    legacyVariableGraphs.push(graph);
    graphs.push(withoutLegacyVariables(graph));
  }

  if (!graphFileNames.has(manifest.entryGraphId)) {
    return { ok: false, failure: { reason: "entryGraphMissing" } };
  }

  const duplicate = findDuplicateAssetDisplayName(manifest.assets);
  if (duplicate !== undefined) {
    return {
      ok: false,
      failure: { reason: "duplicateAssetName", displayName: duplicate },
    };
  }

  const variableMerge = mergeProjectVariables(
    manifest.variables,
    legacyVariableSourcesForGraphs(legacyVariableGraphs),
  );
  if (!variableMerge.ok) {
    return {
      ok: false,
      failure: { reason: "documentInvalid", detail: variableMerge.detail },
    };
  }

  const document: RinoProjectDocumentV1 = {
    schemaVersion: 1,
    documentId: manifest.documentId,
    metadata: manifest.metadata,
    entryGraphId: manifest.entryGraphId,
    graphs,
    variables: variableMerge.variables,
    assets: manifest.assets,
    requiredCapabilities: manifest.requiredCapabilities,
  };
  if (!isValidProjectDocument(document)) {
    return {
      ok: false,
      failure: {
        reason: "documentInvalid",
        detail: describeProjectDocumentErrors(document),
      },
    };
  }

  return { ok: true, value: { document, graphFileNames } };
}

/** Reports whether two serialized projects would write identical bytes.
 *
 * A save that would change nothing is skipped entirely, which is what keeps `updatedAt`
 * and the file modification times from moving on a project the user only looked at.
 */
export function serializedProjectsMatch(
  left: SerializedProject,
  right: SerializedProject,
): boolean {
  if (left.manifest !== right.manifest) {
    return false;
  }
  if (left.graphs.length !== right.graphs.length) {
    return false;
  }
  return left.graphs.every((file, index) => {
    const other = right.graphs[index];
    return (
      other?.fileName === file.fileName && other.contents === file.contents
    );
  });
}
