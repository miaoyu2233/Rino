import type { EditorPositionV1 } from "@rino/contracts";

import { createIdentifier } from "../../platform/identifiers";
import { centerOnPointer, snapToGrid } from "../canvas/canvas-geometry";
import { NODE_HEADER_HEIGHT, NODE_WIDTH } from "../canvas/graph-view-model";
import {
  buildConnectCommand,
  buildInsertNodeCommand,
  buildTemplateInsertCommand,
} from "../commands/graph-editing";
import { evaluateConnection } from "../connection-rules";
import { useRegistryStore } from "../registry/registry-store";
import { useDocumentStore } from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import {
  createVariableDefinition,
  variableValueKindForNodeTypeKey,
} from "../variables/variable-authoring";
import type { VariableDefinition } from "../variables/variable-authoring";
import {
  findConnectablePort,
  findConnectableTemplatePort,
  type ConnectionOrigin,
} from "./palette-model";
import type { PaletteEntry } from "./palette-model";

export type InsertionFailure =
  | "noProject"
  | "noRegistry"
  | "definitionUnknown"
  | "templateUnknown"
  | "placeholderUnknown"
  | "assetUnknown"
  | "commandRejected";

export type InsertionResult =
  | { ok: true; nodeId: string | undefined }
  | { ok: false; reason: InsertionFailure };

export interface InsertOptions {
  /** Graph coordinates of the node's top-left corner. Absent centres the node on the
   * position instead, which is what a drop or a menu invocation wants. */
  origin?: EditorPositionV1;
  centerOn?: EditorPositionV1;
  /** When present, the inserted node is wired to the port the user dragged from. */
  connectFrom?: ConnectionOrigin & { nodeId: string; portId: string };
  /** Execution output belonging to the same visible recognition node as a dragged data
   * result. When a branch is inserted from a boolean result, this preserves the control
   * path without asking the user to draw the obvious second edge. */
  companionExecutionFrom?: { nodeId: string; portId: string };
}

function resolveOrigin(options: InsertOptions): EditorPositionV1 {
  if (options.origin) {
    return snapToGrid(options.origin);
  }
  const center = options.centerOn ?? { x: 0, y: 0 };
  return snapToGrid(centerOnPointer(center, NODE_WIDTH, NODE_HEADER_HEIGHT));
}

/** Inserts a palette entry into the active graph.
 *
 * Shared by the palette, the canvas context menu, the keyboard quick add, and the drop
 * handler, so every route into the graph produces the same command and the same undo
 * entry rather than four near-copies.
 */
export function insertPaletteEntry(
  entry: PaletteEntry,
  options: InsertOptions = {},
): InsertionResult {
  const registry = useRegistryStore.getState().snapshot;
  const graphId = useEditorSessionStore.getState().activeGraphId;
  const documentStore = useDocumentStore.getState();
  const document = documentStore.history?.document;
  const graph = document?.graphs.find(
    (candidate) => candidate.graphId === graphId,
  );

  if (!document || !graph) {
    return { ok: false, reason: "noProject" };
  }
  if (!registry) {
    return { ok: false, reason: "noRegistry" };
  }

  const position = resolveOrigin(options);

  if (entry.kind === "template") {
    const expansion = buildTemplateInsertCommand(
      graph.graphId,
      entry.key,
      registry,
      position,
      createIdentifier,
    );
    if (!expansion.ok) {
      return {
        ok: false,
        reason:
          expansion.reason === "definitionUnknown"
            ? "definitionUnknown"
            : expansion.reason === "placeholderUnknown"
              ? "placeholderUnknown"
              : "templateUnknown",
      };
    }
    const connection = options.connectFrom;
    if (connection === undefined) {
      return documentStore.runCommand(
        "graph.history.insertTemplate",
        expansion.command,
      ).ok
        ? { ok: true, nodeId: undefined }
        : { ok: false, reason: "commandRejected" };
    }

    const templatePort = findConnectableTemplatePort(entry, connection);
    if (templatePort === undefined) {
      return { ok: false, reason: "definitionUnknown" };
    }
    const expansionPort = expansion.exposedPorts.find(
      (candidate) => candidate.proxyPortId === templatePort.proxyPortId,
    );
    if (expansionPort === undefined) {
      return { ok: false, reason: "placeholderUnknown" };
    }

    const templateNodes = expansion.command.commands.flatMap((command) =>
      command.kind === "addNode" ? [command.node] : [],
    );
    const templateEdges = expansion.command.commands.flatMap((command) =>
      command.kind === "addEdge" ? [command.edge] : [],
    );
    const graphWithTemplate = {
      ...graph,
      nodes: [...graph.nodes, ...templateNodes],
      edges: [...graph.edges, ...templateEdges],
    };
    const candidate =
      connection.direction === "output"
        ? {
            sourceNodeId: connection.nodeId,
            sourcePortId: connection.portId,
            targetNodeId: expansionPort.nodeId,
            targetPortId: expansionPort.portId,
          }
        : {
            sourceNodeId: expansionPort.nodeId,
            sourcePortId: expansionPort.portId,
            targetNodeId: connection.nodeId,
            targetPortId: connection.portId,
          };
    const evaluation = evaluateConnection(
      graphWithTemplate,
      registry,
      candidate,
    );
    if (!evaluation.accepted) {
      return { ok: false, reason: "commandRejected" };
    }

    const command = {
      kind: "composite" as const,
      label: "insertConnectedTemplate",
      commands: [
        ...expansion.command.commands,
        ...buildConnectCommand(
          graph.graphId,
          candidate,
          evaluation,
          createIdentifier,
        ).commands,
      ],
    };
    return documentStore.runCommand("graph.history.insertTemplate", command).ok
      ? { ok: true, nodeId: undefined }
      : { ok: false, reason: "commandRejected" };
  }

  const insertion = buildInsertNodeCommand(
    graph.graphId,
    entry.key,
    registry,
    position,
    createIdentifier,
  );
  if (!insertion.ok) {
    return { ok: false, reason: "definitionUnknown" };
  }

  const variableValueKind = variableValueKindForNodeTypeKey(entry.key);
  let createdVariable: VariableDefinition | undefined;
  if (variableValueKind !== undefined) {
    const projectVariables = document.variables ?? [];
    const existingVariable = projectVariables.find(
      (variable) => variable.valueKind === variableValueKind,
    );
    const boundVariable =
      existingVariable ??
      createVariableDefinition(
        variableValueKind,
        projectVariables,
        createIdentifier,
      );
    if (existingVariable === undefined) {
      createdVariable = boundVariable;
    }
    insertion.command.node = {
      ...insertion.command.node,
      properties: {
        ...insertion.command.node.properties,
        variableId: boundVariable.variableId,
      },
    };
  }
  const variableCommand =
    createdVariable === undefined
      ? undefined
      : {
          kind: "setProjectVariables" as const,
          variables: [...(document.variables ?? []), createdVariable],
        };

  const connection = options.connectFrom;
  const shouldCreateClickPointBundle =
    entry.key === "automation.clickPoint" &&
    !(connection?.portKind === "data" && connection.type.kind === "point");
  const automaticNodeCommands: (typeof insertion.command)[] = [];
  const automaticConnectionCommands: ReturnType<
    typeof buildConnectCommand
  >["commands"] = [];
  let executionEntryNodeId = insertion.command.node.nodeId;

  if (shouldCreateClickPointBundle) {
    const capture = buildInsertNodeCommand(
      graph.graphId,
      "automation.captureScreen",
      registry,
      { x: position.x - 560, y: position.y },
      createIdentifier,
    );
    const point = buildInsertNodeCommand(
      graph.graphId,
      "core.geometry.point",
      registry,
      { x: position.x - 280, y: position.y + 184 },
      createIdentifier,
    );
    if (!capture.ok || !point.ok) {
      return { ok: false, reason: "definitionUnknown" };
    }
    point.command.node = {
      ...point.command.node,
      inputValues: {
        x: 0,
        y: 0,
        referenceWidth: 1,
        referenceHeight: 1,
      },
    };
    automaticNodeCommands.push(capture.command, point.command);
    executionEntryNodeId = capture.command.node.nodeId;

    const graphWithBundleNodes = {
      ...graph,
      nodes: [
        ...graph.nodes,
        capture.command.node,
        point.command.node,
        insertion.command.node,
      ],
    };
    const bundleCandidates = [
      {
        sourceNodeId: capture.command.node.nodeId,
        sourcePortId: "next",
        targetNodeId: insertion.command.node.nodeId,
        targetPortId: "run",
      },
      {
        sourceNodeId: capture.command.node.nodeId,
        sourcePortId: "image",
        targetNodeId: point.command.node.nodeId,
        targetPortId: "image",
      },
      {
        sourceNodeId: point.command.node.nodeId,
        sourcePortId: "point",
        targetNodeId: insertion.command.node.nodeId,
        targetPortId: "point",
      },
    ];
    for (const candidate of bundleCandidates) {
      const evaluation = evaluateConnection(
        graphWithBundleNodes,
        registry,
        candidate,
      );
      if (!evaluation.accepted) {
        return { ok: false, reason: "commandRejected" };
      }
      automaticConnectionCommands.push(
        ...buildConnectCommand(
          graph.graphId,
          candidate,
          evaluation,
          createIdentifier,
        ).commands,
      );
    }
  }

  if (!connection) {
    const insertionCommands = [
      ...(variableCommand === undefined ? [] : [variableCommand]),
      ...automaticNodeCommands,
      insertion.command,
      ...automaticConnectionCommands,
    ];
    const command =
      shouldCreateClickPointBundle || variableCommand !== undefined
        ? {
            kind: "composite" as const,
            label:
              variableCommand === undefined
                ? "insertClickPointBundle"
                : "insertVariableNode",
            commands: insertionCommands,
          }
        : insertion.command;
    return documentStore.runCommand("graph.history.insertNode", command).ok
      ? { ok: true, nodeId: insertion.command.node.nodeId }
      : { ok: false, reason: "commandRejected" };
  }

  const port = findConnectablePort(entry, connection);
  if (!port) {
    return { ok: false, reason: "definitionUnknown" };
  }
  if (entry.key === "core.diagnostic.log") {
    insertion.command.node = {
      ...insertion.command.node,
      properties: {
        ...insertion.command.node.properties,
        segmentKinds: [
          port.portId.startsWith("numberPart") ? "number" : "text",
        ],
      },
    };
  }

  // The connection is evaluated against the graph the insertion will produce, so the new
  // node's ports are present when the rules run.
  const graphWithNode = {
    ...graph,
    nodes: [
      ...graph.nodes,
      ...automaticNodeCommands.map((command) => command.node),
      insertion.command.node,
    ],
  };
  const candidate =
    connection.direction === "output"
      ? {
          sourceNodeId: connection.nodeId,
          sourcePortId: connection.portId,
          targetNodeId:
            shouldCreateClickPointBundle && connection.portKind === "execution"
              ? executionEntryNodeId
              : insertion.command.node.nodeId,
          targetPortId:
            shouldCreateClickPointBundle && connection.portKind === "execution"
              ? "run"
              : port.portId,
        }
      : {
          sourceNodeId: insertion.command.node.nodeId,
          sourcePortId: port.portId,
          targetNodeId: connection.nodeId,
          targetPortId: connection.portId,
        };
  const evaluation = evaluateConnection(graphWithNode, registry, candidate);
  if (!evaluation.accepted) {
    return { ok: false, reason: "commandRejected" };
  }

  const connectionCommands = [
    ...automaticConnectionCommands,
    ...buildConnectCommand(
      graph.graphId,
      candidate,
      evaluation,
      createIdentifier,
    ).commands,
  ];
  const companion = options.companionExecutionFrom;
  if (
    entry.key === "core.logic.branch" &&
    connection.direction === "output" &&
    connection.portKind === "data" &&
    connection.type.kind === "bool" &&
    companion !== undefined
  ) {
    const executionInput = entry.ports.find(
      (candidatePort) =>
        candidatePort.direction === "input" &&
        candidatePort.portKind === "execution",
    );
    if (executionInput !== undefined) {
      const executionCandidate = {
        sourceNodeId: companion.nodeId,
        sourcePortId: companion.portId,
        targetNodeId: insertion.command.node.nodeId,
        targetPortId: executionInput.portId,
      };
      const executionEvaluation = evaluateConnection(
        graphWithNode,
        registry,
        executionCandidate,
      );
      if (executionEvaluation.accepted) {
        connectionCommands.push(
          ...buildConnectCommand(
            graph.graphId,
            executionCandidate,
            executionEvaluation,
            createIdentifier,
          ).commands,
        );
      }
    }
  }

  // Insertion and all wiring created by the gesture are one undo step.
  const outcome = documentStore.runCommand("graph.history.insertNode", {
    kind: "composite",
    label: "insertConnected",
    commands: [
      ...(variableCommand === undefined ? [] : [variableCommand]),
      ...automaticNodeCommands,
      insertion.command,
      ...connectionCommands,
    ],
  });
  return outcome.ok
    ? { ok: true, nodeId: insertion.command.node.nodeId }
    : { ok: false, reason: "commandRejected" };
}

/** Inserts an existing project screenshot as a typed image-value node. */
export function insertImageAssetNode(
  assetId: string,
  options: Pick<InsertOptions, "origin" | "centerOn"> = {},
): InsertionResult {
  const registry = useRegistryStore.getState().snapshot;
  const graphId = useEditorSessionStore.getState().activeGraphId;
  const documentStore = useDocumentStore.getState();
  const document = documentStore.history?.document;
  const graph = document?.graphs.find(
    (candidate) => candidate.graphId === graphId,
  );
  if (!graph || !document) {
    return { ok: false, reason: "noProject" };
  }
  if (!document.assets.some((asset) => asset.assetId === assetId)) {
    return { ok: false, reason: "assetUnknown" };
  }
  if (!registry) {
    return { ok: false, reason: "noRegistry" };
  }
  const insertion = buildInsertNodeCommand(
    graph.graphId,
    "core.image.projectAsset",
    registry,
    resolveOrigin(options),
    createIdentifier,
  );
  if (!insertion.ok) {
    return { ok: false, reason: "definitionUnknown" };
  }
  const command = {
    ...insertion.command,
    node: {
      ...insertion.command.node,
      properties: { ...insertion.command.node.properties, assetId },
    },
  };
  return documentStore.runCommand("graph.history.insertNode", command).ok
    ? { ok: true, nodeId: command.node.nodeId }
    : { ok: false, reason: "commandRejected" };
}
