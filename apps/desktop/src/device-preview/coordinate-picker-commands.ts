import type { SourcePoint, SourceRectangle } from "./geometry";
import {
  createAuthoringPointSelection,
  createAuthoringRectangleSelection,
  type AuthoringCoordinateSelection,
} from "./authoring-selection";
import { useCoordinatePickerStore } from "./coordinate-picker-store";
import { buildSetCoordinateSelectionCommand } from "../graph/commands/coordinate-node-commands";
import { useDocumentStore } from "../graph/store/document-store";

export type CoordinatePickerCommitFailure =
  | "sessionMissing"
  | "selectionKindMismatch"
  | "staleOrInvalidSelection"
  | "graphMissing"
  | "nodeMissing"
  | "nodeTypeMismatch"
  | "commandRejected";

export type CoordinatePickerCommitResult =
  | { ok: true; selection: AuthoringCoordinateSelection }
  | { ok: false; reason: CoordinatePickerCommitFailure };

function commitSelection(
  sessionId: number,
  selection: AuthoringCoordinateSelection,
): CoordinatePickerCommitResult {
  const picker = useCoordinatePickerStore.getState();
  const session = picker.session;
  if (session?.sessionId !== sessionId) {
    return { ok: false, reason: "sessionMissing" };
  }
  if (session.kind !== selection.kind) {
    return { ok: false, reason: "selectionKindMismatch" };
  }
  const documentStore = useDocumentStore.getState();
  const graph = documentStore.history?.document.graphs.find(
    (candidate) => candidate.graphId === session.target.graphId,
  );
  if (!graph) {
    return { ok: false, reason: "graphMissing" };
  }
  const command = buildSetCoordinateSelectionCommand(
    graph,
    session.target.nodeId,
    selection,
  );
  if (!command.ok) {
    return command;
  }
  const outcome = documentStore.runCommand(
    "graph.history.setCoordinateSelection",
    command.command,
  );
  if (!outcome.ok) {
    return { ok: false, reason: "commandRejected" };
  }
  if (!useCoordinatePickerStore.getState().finish(sessionId)) {
    return { ok: false, reason: "sessionMissing" };
  }
  return { ok: true, selection };
}

export function commitPointPickerSelection(
  sessionId: number,
  point: SourcePoint,
): CoordinatePickerCommitResult {
  const session = useCoordinatePickerStore.getState().session;
  if (session?.sessionId !== sessionId) {
    return { ok: false, reason: "sessionMissing" };
  }
  if (session.kind !== "point") {
    return { ok: false, reason: "selectionKindMismatch" };
  }
  const selection = createAuthoringPointSelection(session.source, point);
  return selection === undefined
    ? { ok: false, reason: "staleOrInvalidSelection" }
    : commitSelection(sessionId, selection);
}

export function commitRectanglePickerSelection(
  sessionId: number,
  rectangle: SourceRectangle,
): CoordinatePickerCommitResult {
  const session = useCoordinatePickerStore.getState().session;
  if (session?.sessionId !== sessionId) {
    return { ok: false, reason: "sessionMissing" };
  }
  if (session.kind !== "rectangle") {
    return { ok: false, reason: "selectionKindMismatch" };
  }
  const selection = createAuthoringRectangleSelection(
    session.source,
    rectangle,
  );
  return selection === undefined
    ? { ok: false, reason: "staleOrInvalidSelection" }
    : commitSelection(sessionId, selection);
}
