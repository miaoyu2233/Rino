import type {
  GraphCommentV1,
  GraphV1,
  RepeatHintV1,
  RinoProjectDocumentV1,
  WorkflowGroupV1,
} from "@rino/contracts";

import type { IdentifierFactory } from "./graph-editing";
import type { GraphCommand } from "./graph-commands";

export const MAXIMUM_TASKS = 64;
export const MAXIMUM_TASK_NAME_LENGTH = 200;

const TASK_DUPLICATE_OFFSET = { x: 32, y: 32 } as const;

export type TaskCommandFailureReason =
  | "taskMissing"
  | "taskLimitReached"
  | "taskNameInvalid"
  | "cannotDeleteOnlyTask";

export type TaskCommandBuildResult<T> =
  { ok: true; value: T } | { ok: false; reason: TaskCommandFailureReason };

export interface BuiltTaskCommand {
  command: GraphCommand;
  taskId: string;
}

export interface BuiltDeleteTaskCommand {
  command: GraphCommand;
  deletedTaskId: string;
  fallbackTaskId: string;
}

function normalizeTaskName(name: string): string | undefined {
  const normalized = name.trim();
  return normalized.length === 0 || normalized.length > MAXIMUM_TASK_NAME_LENGTH
    ? undefined
    : normalized;
}

function taskIndex(document: RinoProjectDocumentV1, taskId: string): number {
  return document.graphs.findIndex((graph) => graph.graphId === taskId);
}

function taskMissing<T>(): TaskCommandBuildResult<T> {
  return { ok: false, reason: "taskMissing" };
}

function invalidName<T>(): TaskCommandBuildResult<T> {
  return { ok: false, reason: "taskNameInvalid" };
}

function ensureFreshIdentifier(
  createIdentifier: IdentifierFactory,
  used: Set<string>,
): string {
  const identifier = createIdentifier();
  if (used.has(identifier)) {
    throw new Error(
      `Identifier factory returned an existing identifier: ${identifier}`,
    );
  }
  used.add(identifier);
  return identifier;
}

/** Builds an empty task appended to the project's graph order. */
export function buildCreateTaskCommand(
  document: RinoProjectDocumentV1,
  name: string,
  createIdentifier: IdentifierFactory,
): TaskCommandBuildResult<BuiltTaskCommand> {
  const normalizedName = normalizeTaskName(name);
  if (normalizedName === undefined) {
    return invalidName();
  }
  if (document.graphs.length >= MAXIMUM_TASKS) {
    return { ok: false, reason: "taskLimitReached" };
  }

  const graphId = ensureFreshIdentifier(
    createIdentifier,
    new Set(document.graphs.map((graph) => graph.graphId)),
  );
  const graph: GraphV1 = {
    graphId,
    name: normalizedName,
    kind: "entry",
    nodes: [],
    edges: [],
  };
  return {
    ok: true,
    value: {
      command: { kind: "addGraph", graph },
      taskId: graphId,
    },
  };
}

function duplicateGraph(
  source: GraphV1,
  name: string,
  createIdentifier: IdentifierFactory,
  usedGraphIds: ReadonlySet<string>,
): GraphV1 {
  const duplicate = structuredClone(source);
  const sourceComments = source.editorMetadata?.comments ?? [];
  const sourceGroups = source.editorMetadata?.workflowGroups ?? [];
  const sourceHints = source.editorMetadata?.repeatHints ?? [];
  const usedIdentifiers = new Set(usedGraphIds);
  source.nodes.forEach((node) => usedIdentifiers.add(node.nodeId));
  source.edges.forEach((edge) => usedIdentifiers.add(edge.edgeId));
  sourceComments.forEach((comment) => usedIdentifiers.add(comment.commentId));
  sourceGroups.forEach((group) => usedIdentifiers.add(group.groupId));
  sourceHints.forEach((hint) => usedIdentifiers.add(hint.hintId));

  const graphId = ensureFreshIdentifier(createIdentifier, usedIdentifiers);

  const nodeIds = new Map<string, string>();
  for (const node of source.nodes) {
    nodeIds.set(
      node.nodeId,
      ensureFreshIdentifier(createIdentifier, usedIdentifiers),
    );
  }

  const edgeIds = new Map<string, string>();
  for (const edge of source.edges) {
    edgeIds.set(
      edge.edgeId,
      ensureFreshIdentifier(createIdentifier, usedIdentifiers),
    );
  }

  const commentIds = new Map<string, string>();
  for (const comment of sourceComments) {
    commentIds.set(
      comment.commentId,
      ensureFreshIdentifier(createIdentifier, usedIdentifiers),
    );
  }

  const groupIds = new Map<string, string>();
  for (const group of sourceGroups) {
    groupIds.set(
      group.groupId,
      ensureFreshIdentifier(createIdentifier, usedIdentifiers),
    );
  }

  const sourceEdgeIds = new Set(
    source.edges
      .filter((edge) => edge.edgeKind === "execution")
      .map((edge) => edge.edgeId),
  );
  const hintIds = new Map<string, string>();
  for (const hint of sourceHints) {
    if (!sourceEdgeIds.has(hint.edgeId)) {
      continue;
    }
    hintIds.set(
      hint.hintId,
      ensureFreshIdentifier(createIdentifier, usedIdentifiers),
    );
  }

  const nodes = duplicate.nodes.map((node) => ({
    ...node,
    nodeId:
      nodeIds.get(node.nodeId) ??
      (() => {
        throw new Error(`Node reference cannot be remapped: ${node.nodeId}`);
      })(),
    position: {
      x: node.position.x + TASK_DUPLICATE_OFFSET.x,
      y: node.position.y + TASK_DUPLICATE_OFFSET.y,
    },
  }));
  const edges = duplicate.edges.map((edge) => {
    const sourceNodeId = nodeIds.get(edge.sourceNodeId);
    const targetNodeId = nodeIds.get(edge.targetNodeId);
    const edgeId = edgeIds.get(edge.edgeId);
    if (
      sourceNodeId === undefined ||
      targetNodeId === undefined ||
      edgeId === undefined
    ) {
      throw new Error(`Edge reference cannot be remapped: ${edge.edgeId}`);
    }
    return { ...edge, edgeId, sourceNodeId, targetNodeId };
  });
  const comments: GraphCommentV1[] = sourceComments.map((comment) => {
    const commentId = commentIds.get(comment.commentId);
    if (commentId === undefined) {
      throw new Error(
        `Comment reference cannot be remapped: ${comment.commentId}`,
      );
    }
    return {
      ...comment,
      commentId,
      position: {
        x: comment.position.x + TASK_DUPLICATE_OFFSET.x,
        y: comment.position.y + TASK_DUPLICATE_OFFSET.y,
      },
    };
  });
  const groups: WorkflowGroupV1[] = sourceGroups.map((group) => {
    const groupId = groupIds.get(group.groupId);
    if (groupId === undefined) {
      throw new Error(
        `Workflow group reference cannot be remapped: ${group.groupId}`,
      );
    }
    const members = group.members.map((member) => {
      const nodeId = nodeIds.get(member.nodeId);
      if (nodeId === undefined) {
        throw new Error(
          `Workflow group member cannot be remapped: ${member.nodeId}`,
        );
      }
      return { ...member, nodeId };
    });
    const exposedPorts = group.exposedPorts.map((port) => {
      const nodeId = nodeIds.get(port.nodeId);
      if (nodeId === undefined) {
        throw new Error(
          `Workflow group port cannot be remapped: ${port.nodeId}`,
        );
      }
      return { ...port, nodeId };
    });
    return { ...group, groupId, members, exposedPorts } as WorkflowGroupV1;
  });

  const repeatHints: RepeatHintV1[] = sourceHints.flatMap((hint) => {
    const hintId = hintIds.get(hint.hintId);
    const edgeId = edgeIds.get(hint.edgeId);
    if (hintId === undefined || edgeId === undefined) {
      return [];
    }
    return [
      {
        ...hint,
        hintId,
        edgeId,
        position: {
          x: hint.position.x + TASK_DUPLICATE_OFFSET.x,
          y: hint.position.y + TASK_DUPLICATE_OFFSET.y,
        },
      },
    ];
  });

  const editorMetadata = duplicate.editorMetadata;
  return {
    ...duplicate,
    graphId,
    name,
    nodes,
    edges,
    ...(editorMetadata === undefined
      ? {}
      : {
          editorMetadata: {
            ...(editorMetadata.comments === undefined ? {} : { comments }),
            ...(editorMetadata.workflowGroups === undefined
              ? {}
              : { workflowGroups: groups }),
            ...(editorMetadata.repeatHints === undefined
              ? {}
              : { repeatHints }),
          },
        }),
  };
}

/** Builds a full-graph duplicate with fresh structural identifiers. */
export function buildDuplicateTaskCommand(
  document: RinoProjectDocumentV1,
  sourceTaskId: string,
  name: string,
  createIdentifier: IdentifierFactory,
): TaskCommandBuildResult<BuiltTaskCommand> {
  const normalizedName = normalizeTaskName(name);
  if (normalizedName === undefined) {
    return invalidName();
  }
  if (document.graphs.length >= MAXIMUM_TASKS) {
    return { ok: false, reason: "taskLimitReached" };
  }
  const source = document.graphs.find(
    (graph) => graph.graphId === sourceTaskId,
  );
  if (source === undefined) {
    return taskMissing();
  }
  const graph = duplicateGraph(
    source,
    normalizedName,
    createIdentifier,
    new Set(document.graphs.map((candidate) => candidate.graphId)),
  );
  return {
    ok: true,
    value: { command: { kind: "addGraph", graph }, taskId: graph.graphId },
  };
}

export function buildRenameTaskCommand(
  document: RinoProjectDocumentV1,
  taskId: string,
  name: string,
): TaskCommandBuildResult<GraphCommand> {
  if (taskIndex(document, taskId) < 0) {
    return taskMissing();
  }
  const normalizedName = normalizeTaskName(name);
  if (normalizedName === undefined) {
    return invalidName();
  }
  return {
    ok: true,
    value: { kind: "renameGraph", graphId: taskId, name: normalizedName },
  };
}

export function buildDeleteTaskCommand(
  document: RinoProjectDocumentV1,
  taskId: string,
): TaskCommandBuildResult<BuiltDeleteTaskCommand> {
  const index = taskIndex(document, taskId);
  if (index < 0) {
    return taskMissing();
  }
  if (document.graphs.length === 1) {
    return { ok: false, reason: "cannotDeleteOnlyTask" };
  }
  const fallback = document.graphs[index + 1] ?? document.graphs[index - 1];
  if (fallback === undefined) {
    throw new Error("A multi-task document must have a deletion fallback.");
  }
  const command: GraphCommand =
    document.entryGraphId === taskId
      ? {
          kind: "composite",
          label: "deleteTask",
          commands: [
            { kind: "setEntryGraph", graphId: fallback.graphId },
            { kind: "removeGraph", graphId: taskId },
          ],
        }
      : { kind: "removeGraph", graphId: taskId };
  return {
    ok: true,
    value: {
      command,
      deletedTaskId: taskId,
      fallbackTaskId: fallback.graphId,
    },
  };
}

export function buildSetDefaultTaskCommand(
  document: RinoProjectDocumentV1,
  taskId: string,
): TaskCommandBuildResult<GraphCommand> {
  if (taskIndex(document, taskId) < 0) {
    return taskMissing();
  }
  return { ok: true, value: { kind: "setEntryGraph", graphId: taskId } };
}
