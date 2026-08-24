import {
  BaseEdge,
  getBezierPath,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { memo, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { portColorTokens } from "../../design-system/tokens";
import { displayPortType } from "./port-presentation";
import type { RinoFlowEdge } from "./graph-view-model";

type EdgeStyle = CSSProperties & { "--edge-color": string };

const EXECUTION_CORNER_RADIUS = 12;
const LOOPBACK_OUTWARD_CLEARANCE = 64;
const LOOPBACK_UPPER_OFFSET = 56;
const LOOPBACK_TARGET_CLEARANCE = 40;

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
  targetX,
  targetY,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<RinoFlowEdge>) {
  const { t } = useTranslation();
  const edgeKind = data?.edgeKind ?? "data";
  const geometry = {
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  };
  const loopback = edgeKind === "execution" && targetX <= sourceX;
  // Control flow is routed orthogonally and data flows in a curve, so the two kinds stay
  // apart at a glance even when the view is zoomed out far enough to blur their colours.
  const path = loopback
    ? executionLoopbackPath(sourceX, sourceY, targetX, targetY)
    : edgeKind === "execution"
      ? getSmoothStepPath({
          ...geometry,
          borderRadius: EXECUTION_CORNER_RADIUS,
        })[0]
      : getBezierPath(geometry)[0];
  const colorRole = data?.colorRole ?? "unknown";
  const style: EdgeStyle = {
    "--edge-color": `var(${portColorTokens[colorRole]})`,
  };
  const activity = data?.activity ?? "idle";
  const description =
    edgeKind === "execution"
      ? t("graph.edge.executionDescription")
      : t("graph.edge.dataDescription", {
          type: displayPortType(t, data?.typeLabel ?? "", "full"),
        });

  return (
    <>
      {/* Names the connection for a pointer tooltip; the kind and the carried type are
          otherwise expressed only through shape and colour. */}
      <title>{description}</title>
      <BaseEdge
        path={path}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        style={style}
        className={[
          "rino-edge",
          `rino-edge--${edgeKind}`,
          loopback ? "rino-edge--loopback" : "",
          activity === "idle" ? "" : `rino-edge--${activity}`,
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
