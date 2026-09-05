import {
  BaseEdge,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useStore,
  type EdgeProps,
} from "@xyflow/react";
import { memo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { portColorTokens } from "../../design-system/tokens";
import { FULL_CANVAS_DETAIL_MINIMUM_ZOOM } from "./canvas-detail";
import { displayPortType } from "./port-presentation";
import type { RinoFlowEdge } from "./graph-view-model";

type EdgeStyle = CSSProperties & { "--edge-color": string };

const EXECUTION_CORNER_RADIUS = 12;
const LOOPBACK_OUTWARD_CLEARANCE = 64;
const LOOPBACK_UPPER_OFFSET = 56;
const LOOPBACK_TARGET_CLEARANCE = 40;

function EdgeTitle({
  edgeKind,
  typeLabel,
}: {
  edgeKind: "data" | "execution";
  typeLabel: string;
}) {
  const { t } = useTranslation();
  const description =
    edgeKind === "execution"
      ? t("graph.edge.executionDescription")
      : t("graph.edge.dataDescription", {
          type: displayPortType(t, typeLabel, "full"),
        });

  return <title>{description}</title>;
}

function executionLoopbackPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): string {
  const outwardX = sourceX + LOOPBACK_OUTWARD_CLEARANCE;
  const upperY = Math.min(sourceY, targetY) - LOOPBACK_UPPER_OFFSET;
  const approachX = targetX - LOOPBACK_TARGET_CLEARANCE;
  return [
    `M ${sourceX.toString()},${sourceY.toString()}`,
    `L ${outwardX.toString()},${sourceY.toString()}`,
    `L ${outwardX.toString()},${upperY.toString()}`,
    `L ${approachX.toString()},${upperY.toString()}`,
    `L ${approachX.toString()},${targetY.toString()}`,
    `L ${targetX.toString()},${targetY.toString()}`,
  ].join(" ");
}

function RinoEdgeViewComponent({
  sourceX,
  sourceY,
  sourcePosition,
  source,
  targetX,
  targetY,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<RinoFlowEdge>) {
  // This selector changes only when zoom crosses the semantic-detail threshold. It
  // therefore does not redraw every edge on each wheel or pan frame.
  const showEdgeDetails = useStore(
    (store) => store.transform[2] >= FULL_CANVAS_DETAIL_MINIMUM_ZOOM,
  );
  const sourceSelected = useStore(
    (store) => store.nodeLookup.get(source)?.selected === true,
  );
  const edgeKind = data?.edgeKind ?? "data";
  const geometry = {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  };
  const loopback =
    showEdgeDetails && edgeKind === "execution" && targetX <= sourceX;
  // Full detail separates control flow with orthogonal routing and data flow with a
  // curve. Overview scale uses the cheapest topology-preserving SVG path for both.
  const path = showEdgeDetails
    ? loopback
      ? executionLoopbackPath(sourceX, sourceY, targetX, targetY)
      : edgeKind === "execution"
        ? getSmoothStepPath({
            ...geometry,
            borderRadius: EXECUTION_CORNER_RADIUS,
          })[0]
        : getBezierPath(geometry)[0]
    : getStraightPath(geometry)[0];
  const colorRole = data?.colorRole ?? "unknown";
  const style: EdgeStyle = {
    "--edge-color": `var(${portColorTokens[colorRole]})`,
  };
  const activity = data?.activity ?? "idle";

  return (
    <>
      {/* Names the connection for a pointer tooltip; the kind and the carried type are
          otherwise expressed only through shape and colour. */}
      {showEdgeDetails ? (
        <EdgeTitle edgeKind={edgeKind} typeLabel={data?.typeLabel ?? ""} />
      ) : null}
      <BaseEdge
        path={path}
        interactionWidth={showEdgeDetails ? 20 : 12}
        {...(!showEdgeDetails || markerEnd === undefined ? {} : { markerEnd })}
        style={style}
        className={[
          "rino-edge",
          `rino-edge--${edgeKind}`,
          showEdgeDetails ? "" : "rino-edge--overview",
          loopback ? "rino-edge--loopback" : "",
          activity === "idle" ? "" : `rino-edge--${activity}`,
          sourceSelected ? "rino-edge--source-selected" : "",
          selected === true ? "rino-edge--selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      />
    </>
  );
}

/** Memoized so panning, zooming, or editing one node does not redraw every connection. */
export const RinoEdgeView = memo(RinoEdgeViewComponent);
