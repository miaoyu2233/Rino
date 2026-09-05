import { Position, ReactFlowProvider, useStoreApi } from "@xyflow/react";
import { render, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { applicationI18n } from "../../localization/i18n";
import type { CanvasEdgeData } from "./graph-view-model";
import { RinoEdgeView } from "./RinoEdgeView";

const EDGE = "8c7ebda1-c5d6-41e2-9d05-7f8091021324";
const SOURCE = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80";
const TARGET = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091";

function SelectSourceNode() {
  const store = useStoreApi();

  useEffect(() => {
    store.getState().setNodes([
      {
        id: SOURCE,
        position: { x: 0, y: 0 },
        data: {},
        selected: true,
      },
    ]);
  }, [store]);

  return null;
}

function SetCanvasZoom({ zoom }: { zoom: number }) {
  const store = useStoreApi();

  useEffect(() => {
    store.setState({ transform: [0, 0, zoom] });
  }, [store, zoom]);

  return null;
}

function renderEdgeRoot(element: ReactNode, zoom = 1, sourceSelected = false) {
  return render(
    <ReactFlowProvider>
      <SetCanvasZoom zoom={zoom} />
      {sourceSelected ? <SelectSourceNode /> : null}
      <svg>{element}</svg>
    </ReactFlowProvider>,
  );
}

function renderEdge(data: CanvasEdgeData): SVGSVGElement {
  const { container } = renderEdgeRoot(
    <RinoEdgeView
      id={EDGE}
      source={SOURCE}
      target={TARGET}
      sourceX={0}
      sourceY={0}
      targetX={120}
      targetY={80}
      sourcePosition={Position.Right}
      targetPosition={Position.Left}
      data={data}
    />,
  );
  const svg = container.querySelector("svg");
  if (!svg) {
    throw new Error("The edge should have rendered inside an SVG root.");
  }
  return svg;
}

function edgePath(svg: SVGSVGElement): SVGPathElement {
  const path = svg.querySelector<SVGPathElement>(".rino-edge");
  if (!path) {
    throw new Error("The edge path should have rendered.");
  }
  return path;
}

describe("typed edge rendering", () => {
  beforeEach(async () => {
    await applicationI18n.changeLanguage("zh-CN");
  });

  it("draws a data connection as a curve carrying its type colour", () => {
    const svg = renderEdge({
      edgeKind: "data",
      colorRole: "number",
      typeLabel: "number",
      activity: "idle",
    });
    const path = edgePath(svg);

    expect(path).toHaveClass("rino-edge--data");
    expect(path.getAttribute("d")).toContain("C");
    expect(path.getAttribute("style")).toContain(
      "--edge-color: var(--port-number)",
    );
    expect(svg.querySelector("title")?.textContent).toBe("数据连线，类型 数值");
  });

  it("routes an execution connection orthogonally and names it", () => {
    const svg = renderEdge({
      edgeKind: "execution",
      colorRole: "execution",
      typeLabel: "exec",
      activity: "idle",
    });
    const path = edgePath(svg);

    expect(path).toHaveClass("rino-edge--execution");
    expect(path.getAttribute("d")).toContain("L");
    expect(path.getAttribute("d")).not.toContain("C");
    expect(svg.querySelector("title")?.textContent).toBe("执行连线");
  });

  it("routes a backward execution edge outside the nodes before returning", () => {
    const { container } = renderEdgeRoot(
      <RinoEdgeView
        id={EDGE}
        source={SOURCE}
        target={TARGET}
        sourceX={360}
        sourceY={220}
        targetX={80}
        targetY={60}
        sourcePosition={Position.Right}
        targetPosition={Position.Left}
        data={{
          edgeKind: "execution",
          colorRole: "execution",
          typeLabel: "exec",
          activity: "idle",
        }}
      />,
    );
    const path = container.querySelector<SVGPathElement>(".rino-edge");

    expect(path).not.toBeNull();
    expect(path).toHaveClass("rino-edge--loopback");
    expect(path?.getAttribute("d")).toBe(
      "M 360,220 L 424,220 L 424,4 L 40,4 L 40,60 L 80,60",
    );
  });

  it("keeps a clearly rightward upward execution edge on the forward route", () => {
    const { container } = renderEdgeRoot(
      <RinoEdgeView
        id={EDGE}
        source={SOURCE}
        target={TARGET}
        sourceX={100}
        sourceY={300}
        targetX={420}
        targetY={80}
        sourcePosition={Position.Right}
        targetPosition={Position.Left}
        data={{
          edgeKind: "execution",
          colorRole: "execution",
          typeLabel: "exec",
          activity: "idle",
        }}
      />,
    );
    const path = container.querySelector<SVGPathElement>(".rino-edge");

    expect(path).not.toBeNull();
    expect(path).not.toHaveClass("rino-edge--loopback");
    expect(path?.getAttribute("d")).not.toContain("M 100,300 L 164,300");
  });

  it("keeps a same-height rightward execution edge as a short forward route", () => {
    const { container } = renderEdgeRoot(
      <RinoEdgeView
        id={EDGE}
        source={SOURCE}
        target={TARGET}
        sourceX={100}
        sourceY={300}
        targetX={420}
        targetY={300}
        sourcePosition={Position.Right}
        targetPosition={Position.Left}
        data={{
          edgeKind: "execution",
          colorRole: "execution",
          typeLabel: "exec",
          activity: "idle",
        }}
      />,
    );
    const path = container.querySelector<SVGPathElement>(".rino-edge");

    expect(path).not.toBeNull();
    expect(path).not.toHaveClass("rino-edge--loopback");
    expect(path?.getAttribute("d")).not.toContain("M 100,300 L 164,300");
    expect(path?.getAttribute("d")).not.toContain("Q");
    expect(path?.getAttribute("d")?.length).toBeLessThan(100);
  });

  it("marks the running path apart from a path a run already took", () => {
    const active = edgePath(
      renderEdge({
        edgeKind: "execution",
        colorRole: "execution",
        typeLabel: "exec",
        activity: "active",
      }),
    );
    expect(active).toHaveClass("rino-edge--active");
    expect(active).not.toHaveClass("rino-edge--traversed");
  });

  it("highlights a directly selected edge", () => {
    const { container } = renderEdgeRoot(
      <RinoEdgeView
        id={EDGE}
        source={SOURCE}
        target={TARGET}
        sourceX={0}
        sourceY={0}
        targetX={120}
        targetY={80}
        sourcePosition={Position.Right}
        targetPosition={Position.Left}
        selected
        data={{
          edgeKind: "execution",
          colorRole: "execution",
          typeLabel: "exec",
          activity: "idle",
        }}
      />,
    );

    const svg = container.querySelector("svg");
    if (svg === null) {
      throw new Error("The selected edge should render inside an SVG root.");
    }
    expect(edgePath(svg)).toHaveClass("rino-edge--selected");
  });

  it("highlights an edge whose source node is selected", async () => {
    const { container } = renderEdgeRoot(
      <RinoEdgeView
        id={EDGE}
        source={SOURCE}
        target={TARGET}
        sourceX={0}
        sourceY={0}
        targetX={120}
        targetY={80}
        sourcePosition={Position.Right}
        targetPosition={Position.Left}
        data={{
          edgeKind: "execution",
          colorRole: "execution",
          typeLabel: "exec",
          activity: "idle",
        }}
      />,
      1,
      true,
    );

    await waitFor(() => {
      expect(container.querySelector(".rino-edge")).toHaveClass(
        "rino-edge--source-selected",
      );
    });
  });

  it("marks a traversed path as static history", () => {
    const traversed = edgePath(
      renderEdge({
        edgeKind: "execution",
        colorRole: "execution",
        typeLabel: "exec",
        activity: "traversed",
      }),
    );
    expect(traversed).toHaveClass("rino-edge--traversed");
    expect(traversed).not.toHaveClass("rino-edge--active");
  });

  it("carries no activity class while nothing is running", () => {
    const idle = edgePath(
      renderEdge({
        edgeKind: "data",
        colorRole: "number",
        typeLabel: "number",
        activity: "idle",
      }),
    );

    expect(idle.getAttribute("class")).toBe(
      "react-flow__edge-path rino-edge rino-edge--data",
    );
  });

  it("uses a marker-free straight path without a title below overview zoom", async () => {
    const { container } = renderEdgeRoot(
      <RinoEdgeView
        id={EDGE}
        source={SOURCE}
        target={TARGET}
        sourceX={0}
        sourceY={0}
        targetX={120}
        targetY={80}
        sourcePosition={Position.Right}
        targetPosition={Position.Left}
        markerEnd="url(#arrow)"
        data={{
          edgeKind: "data",
          colorRole: "number",
          typeLabel: "number",
          activity: "idle",
        }}
      />,
      0.4,
    );

    await waitFor(() => {
      expect(container.querySelector(".rino-edge")).toHaveClass(
        "rino-edge--overview",
      );
    });
    const path = container.querySelector<SVGPathElement>(".rino-edge");

    expect(path?.getAttribute("d")).toBe("M 0,0L 120,80");
    expect(path).not.toHaveAttribute("marker-end");
    expect(container.querySelector("title")).toBeNull();
    expect(
      container.querySelector(".react-flow__edge-interaction"),
    ).toHaveAttribute("stroke-width", "12");
  });
});
