import type {
  GraphV1,
  RinoProjectDocumentV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";
import { useConnection, useReactFlow } from "@xyflow/react";
import { useTranslation } from "react-i18next";

import { connectionIndexFor } from "./connection-drag-store";
import { connectionRejectionKeys } from "./connection-messages";
import type { RinoFlowEdge, RinoFlowNode } from "./graph-view-model";

/** The hovered end of a connection drag, reduced to primitives.
 *
 * React Flow compares the selected slice shallowly, so keeping the slice to primitives is
 * what stops the callout from re-rendering on every pointer move: it wakes only when the
 * pointer moves onto, off, or between handles.
 */
interface HoveredConnectionTarget {
  fromNodeId: string;
  fromPortId: string;
  fromHandleType: "source" | "target";
  toNodeId: string;
  toPortId: string;
  toX: number;
  toY: number;
}

export interface ConnectionFeedbackProps {
  graph: GraphV1 | undefined;
  document?: RinoProjectDocumentV1;
  registry: RinoNodeRegistrySnapshotV1 | undefined;
  readBounds: () => { left: number; top: number };
}

/** Explains, at the port the pointer is over, why a connection cannot be made.
 *
 * React Flow already refuses the drop and marks the handle, but a colour change alone does
 * not say what is wrong. The reason comes from the same evaluation that refuses the drop,
 * so the sentence can never disagree with the editor's decision.
 */
export function ConnectionFeedback({
  graph,
  document,
  registry,
  readBounds,
}: ConnectionFeedbackProps) {
  const { t } = useTranslation();
  const { flowToScreenPosition } = useReactFlow<RinoFlowNode, RinoFlowEdge>();
  const hovered = useConnection<RinoFlowNode, HoveredConnectionTarget | null>(
    (connection) => {
      if (
        !connection.inProgress ||
        connection.isValid !== false ||
        !connection.fromHandle.id ||
        !connection.toHandle?.id
      ) {
        return null;
      }
      return {
        fromNodeId: connection.fromHandle.nodeId,
        fromPortId: connection.fromHandle.id,
        fromHandleType: connection.fromHandle.type,
        toNodeId: connection.toHandle.nodeId,
        toPortId: connection.toHandle.id,
        toX: connection.toHandle.x,
        toY: connection.toHandle.y,
      };
    },
  );

  if (!hovered || !graph || !registry) {
    return null;
  }

  const candidate =
    hovered.fromHandleType === "source"
      ? {
          sourceNodeId: hovered.fromNodeId,
          sourcePortId: hovered.fromPortId,
          targetNodeId: hovered.toNodeId,
          targetPortId: hovered.toPortId,
        }
      : {
          sourceNodeId: hovered.toNodeId,
          sourcePortId: hovered.toPortId,
          targetNodeId: hovered.fromNodeId,
          targetPortId: hovered.fromPortId,
        };
  const evaluation = connectionIndexFor(graph, registry, document).evaluate(
    candidate,
  );
  if (evaluation.accepted) {
    return null;
  }

  const bounds = readBounds();
  const anchor = flowToScreenPosition({ x: hovered.toX, y: hovered.toY });

  return (
    <p
      className="graph-canvas__connection-rejection"
      role="status"
      style={{
        left: `${String(anchor.x - bounds.left)}px`,
        top: `${String(anchor.y - bounds.top)}px`,
      }}
    >
      {t(connectionRejectionKeys[evaluation.reason])}
    </p>
  );
}
