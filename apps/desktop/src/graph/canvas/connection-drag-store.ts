import type {
  GraphV1,
  RinoProjectDocumentV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";
import { create } from "zustand";

import { GraphConnectionIndex } from "../connection-rules";
import {
  compatibleConnectionTargets,
  connectionTargetKey,
  type ConnectionDragOrigin,
} from "./connection-highlight";

/** Shared so that ending a drag restores one stable identity rather than a new empty set
 * on every release, which would wake every subscribed port for no reason. */
const NO_TARGETS: ReadonlySet<string> = new Set<string>();

interface PreparedConnectionIndex {
  graph: GraphV1;
  registry: RinoNodeRegistrySnapshotV1;
  document: RinoProjectDocumentV1 | undefined;
  index: GraphConnectionIndex;
}

interface ConnectionDragState {
  origin: ConnectionDragOrigin | undefined;
  prepared: PreparedConnectionIndex | undefined;
  compatibleTargets: ReadonlySet<string>;
  beginDrag: (
    graph: GraphV1,
    registry: RinoNodeRegistrySnapshotV1,
    origin: ConnectionDragOrigin,
    document?: RinoProjectDocumentV1,
  ) => void;
  endDrag: () => void;
}

/** What the canvas is currently dragging a connection from, and where it may land.
 *
 * The compatible set is computed once when the drag starts. A port subscribes only to
 * whether it is in that set, so beginning a drag re-renders the ports that light up and
 * leaves the rest of the graph alone.
 */
export const useConnectionDragStore = create<ConnectionDragState>((set) => ({
  origin: undefined,
  prepared: undefined,
  compatibleTargets: NO_TARGETS,
  beginDrag: (graph, registry, origin, document) => {
    const index = new GraphConnectionIndex(graph, registry, document);
    set({
      origin,
      prepared: { graph, registry, document, index },
      compatibleTargets: compatibleConnectionTargets(index, origin),
    });
  },
  endDrag: () => {
    set({
      origin: undefined,
      prepared: undefined,
      compatibleTargets: NO_TARGETS,
    });
  },
}));

/** The prepared index for the connection being dragged, reused while it still describes
 * the graph and registry being asked about. Hover validation and the rejection message
 * both run per pointer move, so rebuilding the lookups for each of them would make the
 * cost of a drag grow with the size of the graph. */
export function connectionIndexFor(
  graph: GraphV1,
  registry: RinoNodeRegistrySnapshotV1,
  document?: RinoProjectDocumentV1,
): GraphConnectionIndex {
  const { prepared } = useConnectionDragStore.getState();
  if (
    prepared?.graph === graph &&
    prepared.registry === registry &&
    prepared.document === document
  ) {
    return prepared.index;
  }
  return new GraphConnectionIndex(graph, registry, document);
}

/** Whether the connection being dragged may land on this port. */
export function useCompatibleConnectionTarget(
  nodeId: string,
  portId: string,
): boolean {
  return useConnectionDragStore((store) =>
    store.compatibleTargets.has(connectionTargetKey(nodeId, portId)),
  );
}
