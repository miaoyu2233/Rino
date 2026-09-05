import type {
  EditorPositionV1,
  GraphCommentV1,
  GraphV1,
  RinoNodeRegistrySnapshotV1,
} from "@rino/contracts";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  useStore,
  useStoreApi,
  useUpdateNodeInternals,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type IsValidConnection,
  type NodeChange,
  type NodeMouseHandler,
  type OnConnectStartParams,
  type OnSelectionChangeParams,
} from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useTranslation } from "react-i18next";

import {
  resolveCanvasShortcut,
  type CanvasShortcutId,
} from "../../app-shell/shortcut-registry";
import {
  motionDurations,
  prefersReducedMotion,
} from "../../design-system/motion";
import { ProductIcon } from "../../design-system/icons/ProductIcon";
import type { LocalizationKey } from "../../diagnostics/diagnostic-model";
import { notify } from "../../diagnostics/diagnostic-store";
import { createIdentifier } from "../../platform/identifiers";
import { useLayoutPreferenceStore } from "../../preferences/layout-preference-store";
import { canvasPerformanceProfiles } from "../../preferences/layout-preferences";
import {
  cancelUiAnimationFrame,
  requestUiAnimationFrame,
} from "../../preferences/ui-animation-frame-scheduler";
import {
  isGraphRunActive,
  useRuntimeExecutionStore,
} from "../../ipc/runtime-execution-store";
import { useProblemFocusStore } from "../problems/problem-focus";
import type { GraphCommand } from "../commands/graph-commands";
import {
  buildConnectCommand,
  buildDisconnectPortCommand,
  buildDuplicateCommand,
  buildPasteCommand,
  buildReconnectEdgeCommand,
  buildRemoveSelectionCommand,
  buildRetargetPortConnectionsCommand,
  extractFragment,
  type GraphPortAddress,
} from "../commands/graph-editing";
import type { ConnectionCandidate } from "../connection-rules";
import { NodeRegistryIndex } from "../node-registry-index";
import {
  insertImageAssetNode,
  insertPaletteEntry,
} from "../palette/insert-entry";
import {
  buildInsertFunctionCallCommand,
  type FunctionAuthoringFailureReason,
} from "../functions/function-authoring";
import { variablesForGraph } from "../variables/variable-authoring";
import {
  insertVariableNode,
  type VariableNodeInsertRole,
} from "../variables/variable-commands";
import { buildPaletteEntries } from "../palette/palette-model";
import { useNodeRegistry, useRegistryStore } from "../registry/registry-store";
import {
  useActiveDocument,
  useDocumentStore,
  useGraph,
} from "../store/document-store";
import { useEditorSessionStore } from "../store/editor-session-store";
import {
  resolveWorkflowGroupEndpoint,
  workflowGroupIdFromNodeId,
  workflowGroupNodeId,
  workflowGroupOrigin,
  workflowGroups,
} from "../workflow-groups";
import { CanvasContextMenu } from "./CanvasContextMenu";
import {
  clearDragPayload,
  readDragKinds,
  readDragPayload,
} from "./canvas-drag";
import {
  FULL_CANVAS_DETAIL_MINIMUM_ZOOM,
  shouldVirtualizeCanvasElements,
} from "./canvas-detail";
import {
  connectionIndexFor,
  useConnectionDragStore,
} from "./connection-drag-store";
import { ConnectionFeedback } from "./ConnectionFeedback";
import { connectionRejectionKeys } from "./connection-messages";
import {
  useCanvasViewportStore,
  visibleCanvasCenter,
} from "./canvas-viewport-store";
import {
  acceleratedPanDelta,
  zoomViewportAtPointer,
} from "./canvas-interaction";
import {
  canvasToScreenPosition,
  centerOnPointer,
  pointerOrCanvasCenter,
  screenToCanvasPosition,
  snapToGrid,
  type CanvasViewport,
} from "./canvas-geometry";
import {
  GraphProjection,
  EMPTY_EDGE_ACTIVITY,
  mergeEdgeRenderState,
  mergeNodeRenderState,
  NODE_HEADER_HEIGHT,
  NODE_WIDTH,
  repeatHintIdFromNodeId,
  RINO_EDGE_TYPE,
  RINO_NODE_TYPE,
  type RinoFlowEdge,
  type RinoFlowNode,
} from "./graph-view-model";
import {
  alignPositionChanges,
  applyTransientNodeChanges,
  filterNoOpNodeSelectionChanges,
  nodeRectangle,
  shouldDeferNodeChange,
} from "./graph-canvas-helpers";
import {
  hasNodeOverlap,
  resolveNodeOverlaps,
  type NodeOverlapLayoutNode,
} from "./node-overlap-layout";

import { QuickAddPanel, type QuickAddRequest } from "./QuickAddPanel";
import { RinoEdgeView } from "./RinoEdgeView";
import {
  isRepeatHintFailurePort,
  recommendRepeatHintTarget,
} from "./repeat-hint-actions";
import { canonicalExecutionInput } from "./smart-connection";
import {
  DEFAULT_COMMENT_HEIGHT,
  DEFAULT_COMMENT_WIDTH,
  GraphCommentLayer,
  MINIMUM_COMMENT_HEIGHT,
  MINIMUM_COMMENT_WIDTH,
  type CommentRectangle,
} from "./GraphCommentLayer";
import { RinoNodeView } from "./RinoNodeView";
import "@xyflow/react/dist/base.css";
import "./graph-canvas.css";

/** Defined once at module scope. React Flow remounts every node when these maps change
 * identity, so they must never be rebuilt during a render. */
const nodeTypes = { [RINO_NODE_TYPE]: RinoNodeView };
const edgeTypes = { [RINO_EDGE_TYPE]: RinoEdgeView };

const MINOR_GRID_GAP = 16;
const MAJOR_GRID_GAP = 96;
const MINIMUM_CANVAS_ZOOM = 0.2;
const MAXIMUM_CANVAS_ZOOM = 2;
const MIDDLE_MOUSE_BUTTON = 1;
const RIGHT_MOUSE_BUTTON = 2;
const PAN_START_DISTANCE_PIXELS = 4;
const INITIAL_FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 } as const;

/** React Flow owns middle-button and space-plus-primary panning. Right-button panning is
 * promoted by the surface gesture handler only after a short movement threshold so a
 * stationary right click remains the context menu. */
const PAN_BUTTONS = [1];
const MULTI_SELECTION_KEYS = ["Control", "Meta"];
const PRO_OPTIONS = { hideAttribution: true };
const EMPTY_GRAPH_COMMENTS: readonly GraphCommentV1[] = [];
const VARIABLE_DROP_MENU_WIDTH = 176;
const VARIABLE_DROP_MENU_HEIGHT = 88;
const VARIABLE_DROP_MENU_MARGIN = 8;
const VARIABLE_DROP_ACTIONS: readonly VariableNodeInsertRole[] = [
  "getter",
  "setter",
];

interface VariableDropRequest {
  graphId: string;
  variableId: string;
  position: EditorPositionV1;
  menuPosition: { x: number; y: number };
}

const functionFailureTitleKeys: Record<
  FunctionAuthoringFailureReason,
  LocalizationKey
> = {
  graphMissing: "graph.function.library.errors.operationFailed",
  graphLimitReached: "graph.function.library.errors.limit",
  graphNotFunction: "graph.function.library.errors.operationFailed",
  functionSignatureMissing: "graph.function.library.errors.operationFailed",
  functionParameterLimitReached: "graph.function.library.errors.limit",
  functionParameterIdInvalid: "graph.function.library.errors.operationFailed",
  functionParameterIdDuplicate: "graph.function.library.errors.operationFailed",
  functionParameterPortIdInvalid:
    "graph.function.library.errors.operationFailed",
  functionParameterPortIdReserved:
    "graph.function.library.errors.operationFailed",
  functionParameterPortIdDuplicate:
    "graph.function.library.errors.operationFailed",
  functionParameterNameInvalid: "graph.function.library.errors.name",
  functionParameterNameDuplicate: "graph.function.library.errors.name",
  functionParameterKindInvalid: "graph.function.library.errors.operationFailed",
  nameInvalid: "graph.function.library.errors.name",
  notFunction: "graph.function.library.errors.operationFailed",
  parameterMissing: "graph.function.library.errors.operationFailed",
  directionInvalid: "graph.function.library.errors.operationFailed",
  identifierInvalid: "graph.function.library.errors.operationFailed",
  identifierDuplicate: "graph.function.library.errors.operationFailed",
  targetGraphMissing: "graph.function.library.errors.target",
  targetNotFunction: "graph.function.library.errors.target",
  selfCall: "graph.function.library.errors.self",
  recursion: "graph.function.library.errors.recursion",
  depthLimit: "graph.function.library.errors.depth",
};

function notifyFunctionFailure(reason: FunctionAuthoringFailureReason): void {
  notify({ severity: "error", titleKey: functionFailureTitleKeys[reason] });
}

function clampVariableDropMenuPosition(
  point: { x: number; y: number },
  bounds: { width: number; height: number },
): { x: number; y: number } {
  const maxX = Math.max(
    VARIABLE_DROP_MENU_MARGIN,
    bounds.width - VARIABLE_DROP_MENU_WIDTH - VARIABLE_DROP_MENU_MARGIN,
  );
  const maxY = Math.max(
    VARIABLE_DROP_MENU_MARGIN,
    bounds.height - VARIABLE_DROP_MENU_HEIGHT - VARIABLE_DROP_MENU_MARGIN,
  );
  return {
    x: Math.min(Math.max(point.x, VARIABLE_DROP_MENU_MARGIN), maxX),
    y: Math.min(Math.max(point.y, VARIABLE_DROP_MENU_MARGIN), maxY),
  };
}

/** The motion system states durations in seconds; the graph library takes milliseconds. */
const MILLISECONDS_PER_SECOND = 1000;
/** Bump when the rectangle measurement or automatic-layout strategy changes. */
const OVERLAP_LAYOUT_STRATEGY_VERSION = 4;
const OVERLAP_LAYOUT_STABILITY_FRAMES = 2;
const MAXIMUM_OVERLAP_LAYOUT_RETRIES = 3;

type OverlapLayoutResolution =
  | { status: "applied" }
  | { status: "noOverlap" }
  | { status: "notReady" }
  | { status: "locked" }
  | { status: "commandRejected"; reason: string };

interface OverlapLayoutStability {
  attemptKey: string;
  shape: string;
  quietFrames: number;
}

function overlapLayoutShape(nodes: readonly RinoFlowNode[]): string {
  return nodes
    .map(
      (node) =>
        `${node.id}:${String(node.position.x)}:${String(node.position.y)}`,
    )
    .join("|");
}

function notifyOverlapLayoutFailure(
  result: Extract<
    OverlapLayoutResolution,
    { status: "locked" | "commandRejected" }
  >,
): void {
  notify({
    severity: "warning",
    titleKey:
      result.status === "locked"
        ? "shell.tasks.errors.executionLocked"
        : "shell.tasks.errors.commandRejected",
  });
}

function horizontalPriorityNodeIds(
  nodes: readonly RinoFlowNode[],
  edges: readonly RinoFlowEdge[],
): ReadonlySet<string> {
  const positions = new Map(nodes.map((node) => [node.id, node.position]));
  const preferred = new Set<string>();
  for (const edge of edges) {
    if (edge.data?.edgeKind !== "execution") {
      continue;
    }
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (source !== undefined && target !== undefined && target.x > source.x) {
      preferred.add(edge.target);
    }
  }
  return preferred;
}

function buildNodeOverlapCommand(
  graph: GraphV1,
  visualNodes: readonly RinoFlowNode[],
  rectangles: readonly NodeOverlapLayoutNode[],
  resolved: readonly NodeOverlapLayoutNode[],
): GraphCommand | undefined {
  const resolvedById = new Map(resolved.map((node) => [node.id, node]));
  const rectangleById = new Map(rectangles.map((node) => [node.id, node]));
  const commands: GraphCommand[] = [];
  const movedGroups = new Set<string>();

  for (const visualNode of visualNodes) {
    const current = rectangleById.get(visualNode.id);
    const target = resolvedById.get(visualNode.id);
    if (
      current === undefined ||
      target === undefined ||
      (current.x === target.x && current.y === target.y)
    ) {
      continue;
    }

    const groupId = workflowGroupIdFromNodeId(visualNode.id);
    if (groupId === undefined) {
      const node = graph.nodes.find(
        (candidate) => candidate.nodeId === visualNode.id,
      );
      if (node !== undefined) {
        const nextPosition = {
          x: node.position.x + (target.x - current.x),
          y: node.position.y + (target.y - current.y),
        };
        if (
          node.position.x !== nextPosition.x ||
          node.position.y !== nextPosition.y
        ) {
          commands.push({
            kind: "moveNode",
            graphId: graph.graphId,
            nodeId: node.nodeId,
            position: nextPosition,
          });
        }
      }
      continue;
    }

    if (movedGroups.has(groupId)) {
      continue;
    }
    movedGroups.add(groupId);
    const group = workflowGroups(graph).find(
      (candidate) => candidate.groupId === groupId,
    );
    if (group === undefined) {
      continue;
    }
    const deltaX = target.x - current.x;
    const deltaY = target.y - current.y;
    for (const member of group.members) {
      const node = graph.nodes.find(
        (candidate) => candidate.nodeId === member.nodeId,
      );
      if (node === undefined) {
        continue;
      }
      const nextPosition = {
        x: node.position.x + deltaX,
        y: node.position.y + deltaY,
      };
      if (
        node.position.x !== nextPosition.x ||
        node.position.y !== nextPosition.y
      ) {
        commands.push({
          kind: "moveNode",
          graphId: graph.graphId,
          nodeId: node.nodeId,
          position: nextPosition,
        });
      }
    }
  }

  return commands.length === 0
    ? undefined
    : {
        kind: "composite",
        label: "resolveNodeOverlaps",
        commands,
      };
}

interface HandleEndpoints {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

interface PendingWheelZoom {
  deltaY: number;
  deltaMode: number;
  clientX: number;
  clientY: number;
}

interface PanGesture {
  pointerId: number;
  button: number;
  moved: boolean;
  startClientX: number;
  startClientY: number;
  lastClientX: number;
  lastClientY: number;
  pendingX: number;
  pendingY: number;
  frameId: number | undefined;
}

interface CommentDrawGesture {
  pointerId: number;
  origin: { x: number; y: number };
}

interface PortRetargetGesture {
  pointerId: number;
  origin: GraphPortAddress;
}

/** Reads the graph the user is editing at this instant.
 *
 * Event handlers read through the stores rather than through values captured at render
 * time: their identities stay stable for React Flow, and a connection or paste can never
 * be evaluated against a graph that an edit has already replaced.
 */
function currentGraph(): GraphV1 | undefined {
  const graphId = useEditorSessionStore.getState().activeGraphId;
  if (graphId === undefined) {
    return undefined;
  }
  return useDocumentStore
    .getState()
    .history?.document.graphs.find((graph) => graph.graphId === graphId);
}

function currentDocument() {
  return useDocumentStore.getState().history?.document;
}

function currentRegistry(): RinoNodeRegistrySnapshotV1 | undefined {
  return useRegistryStore.getState().snapshot;
}

function companionExecutionOutput(
  graph: GraphV1,
  registry: RinoNodeRegistrySnapshotV1,
  visualNodeId: string,
): { nodeId: string; portId: string } | undefined {
  const index = new NodeRegistryIndex(registry);
  const groupEndpoint = resolveWorkflowGroupEndpoint(
    graph,
    visualNodeId,
    "next",
  );
  if (groupEndpoint !== undefined) {
    const groupNode = graph.nodes.find(
      (node) => node.nodeId === groupEndpoint.nodeId,
    );
    const groupPort = groupNode
      ? index.find(groupNode.typeKey)?.ports.get(groupEndpoint.portId)
      : undefined;
    if (
      groupPort?.portKind === "execution" &&
      groupPort.direction === "output"
    ) {
      return groupEndpoint;
    }
  }

  const node = graph.nodes.find(
    (candidate) => candidate.nodeId === visualNodeId,
  );
  const port = node
    ? [...(index.find(node.typeKey)?.ports.values() ?? [])].find(
        (candidate) =>
          candidate.portKind === "execution" &&
          candidate.direction === "output",
      )
    : undefined;
  return node && port
    ? { nodeId: node.nodeId, portId: port.portId }
    : undefined;
}

function toCandidate(
  connection: HandleEndpoints,
  graph: GraphV1,
): ConnectionCandidate | undefined {
  const { sourceHandle, targetHandle } = connection;
  if (
    sourceHandle === null ||
    sourceHandle === undefined ||
    targetHandle === null ||
    targetHandle === undefined
  ) {
    return undefined;
  }
  const source = resolveWorkflowGroupEndpoint(
    graph,
    connection.source,
    sourceHandle,
  );
  const target = resolveWorkflowGroupEndpoint(
    graph,
    connection.target,
    targetHandle,
  );
  return source === undefined || target === undefined
    ? undefined
    : {
        sourceNodeId: source.nodeId,
        sourcePortId: source.portId,
        targetNodeId: target.nodeId,
        targetPortId: target.portId,
      };
}

function graphPortAtElement(
  element: Element | null,
): GraphPortAddress | undefined {
  const port = element?.closest<HTMLElement>(".rino-port");
  const nodeId = port?.dataset["domainNodeId"];
  const portId = port?.dataset["domainPortId"];
  const direction = port?.dataset["side"];
  if (
    nodeId === undefined ||
    portId === undefined ||
    (direction !== "input" && direction !== "output")
  ) {
    return undefined;
  }
  return { nodeId, portId, direction };
}

function edgeTouchesPort(
  edge: GraphV1["edges"][number],
  port: GraphPortAddress,
): boolean {
  return port.direction === "output"
    ? edge.sourceNodeId === port.nodeId && edge.sourcePortId === port.portId
    : edge.targetNodeId === port.nodeId && edge.targetPortId === port.portId;
}

function candidateMatchesEdge(
  candidate: ConnectionCandidate,
  edge: GraphV1["edges"][number],
): boolean {
  return (
    candidate.sourceNodeId === edge.sourceNodeId &&
    candidate.sourcePortId === edge.sourcePortId &&
    candidate.targetNodeId === edge.targetNodeId &&
    candidate.targetPortId === edge.targetPortId
  );
}

/** The graph position a reveal should bring to the middle of the canvas.
 *
 * A measured node is centred on what the user actually sees; an unmeasured one falls back
 * to the default node box. An edge is centred between its endpoints, so both ends of the
 * connection the diagnostic is about stay in view.
 */
function revealCenter(
  nodes: readonly RinoFlowNode[],
  edges: readonly RinoFlowEdge[],
  target: { nodeId: string | undefined; edgeId: string | undefined },
): { x: number; y: number } | undefined {
  const centerOfNode = (
    nodeId: string,
  ): { x: number; y: number } | undefined => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    return node
      ? {
          x: node.position.x + (node.measured?.width ?? NODE_WIDTH) / 2,
          y:
            node.position.y + (node.measured?.height ?? NODE_HEADER_HEIGHT) / 2,
        }
      : undefined;
  };

  if (target.nodeId !== undefined) {
    return centerOfNode(target.nodeId);
  }
  if (target.edgeId === undefined) {
    return undefined;
  }
  const edge = edges.find((candidate) => candidate.id === target.edgeId);
  if (!edge) {
    return undefined;
  }
  const sourceCenter = centerOfNode(edge.source);
  const targetCenter = centerOfNode(edge.target);
  if (!sourceCenter || !targetCenter) {
    return sourceCenter ?? targetCenter;
  }
  return {
    x: (sourceCenter.x + targetCenter.x) / 2,
    y: (sourceCenter.y + targetCenter.y) / 2,
  };
}

/** Re-measures node geometry only when semantic detail changes; both tiers stay in the
 * same React Flow scene so viewport interaction never swaps renderers. */
function CanvasDetailInternalsSynchronizer({
  fullDetail,
}: {
  fullDetail: boolean;
}) {
  const reactFlowStore = useStoreApi<RinoFlowNode, RinoFlowEdge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const previousFullDetailRef = useRef(fullDetail);

  useEffect(() => {
    if (previousFullDetailRef.current === fullDetail) {
      return;
    }
    previousFullDetailRef.current = fullDetail;
    updateNodeInternals([...reactFlowStore.getState().nodeLookup.keys()]);
  }, [fullDetail, reactFlowStore, updateNodeInternals]);

  return null;
}

function GraphCanvasSurface() {
  const { t } = useTranslation();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const { fitView, getViewport, setCenter, setViewport } = useReactFlow<
    RinoFlowNode,
    RinoFlowEdge
  >();
  const reactFlowStore = useStoreApi<RinoFlowNode, RinoFlowEdge>();

  const activeGraphId = useEditorSessionStore((store) => store.activeGraphId);
  const graph = useGraph(activeGraphId);
  const activeDocument = useActiveDocument();
  const performanceProfile = useLayoutPreferenceStore(
    (state) => state.layout.performanceProfile,
  );
  const canvasPerformance = canvasPerformanceProfiles[performanceProfile];
  const registry = useNodeRegistry();
  const runCommand = useDocumentStore((store) => store.runCommand);
  const executionLocked = useDocumentStore((store) => store.executionLocked);
  const undoChange = useDocumentStore((store) => store.undoChange);
  const redoChange = useDocumentStore((store) => store.redoChange);
  const setSelection = useEditorSessionStore((store) => store.setSelection);
  const enterGraph = useEditorSessionStore((store) => store.enterGraph);
  const edgeActivity = useRuntimeExecutionStore((store) =>
    store.run?.graphId === activeGraphId
      ? store.edgeActivity
      : EMPTY_EDGE_ACTIVITY,
  );
  const graphRunActive = useRuntimeExecutionStore((store) =>
    isGraphRunActive(store.run?.state),
  );

  /** What React Flow itself has changed: selection, measured sizes, and positions during
   * a drag. It is merged onto each projection rather than written into the document. */
  const [renderState, setRenderState] = useState<{
    nodes: readonly RinoFlowNode[];
    edges: readonly RinoFlowEdge[];
  }>({ nodes: [], edges: [] });
  const [nodeDragActive, setNodeDragActive] = useState(false);
  const [dropPreview, setDropPreview] = useState<CSSProperties | undefined>(
    undefined,
  );
  const pendingDropPreviewRef = useRef<CSSProperties | undefined>(undefined);
  const dropPreviewFrameRef = useRef<number | undefined>(undefined);
  const pendingCanvasGeometryRef = useRef<
    { width: number; height: number } | undefined
  >(undefined);
  const canvasGeometryFrameRef = useRef<number | undefined>(undefined);
  const pendingWheelZoomRef = useRef<PendingWheelZoom | undefined>(undefined);
  const wheelZoomInputFrameRef = useRef<number | undefined>(undefined);
  const panGestureRef = useRef<PanGesture | undefined>(undefined);
  const suppressNextContextMenuRef = useRef(false);
  const pendingNodeChangesRef = useRef<NodeChange<RinoFlowNode>[]>([]);
  const pendingNodeChangesRequireRenderRef = useRef(false);
  const nodeChangeFrameRef = useRef<number | undefined>(undefined);
  const commentDrawGestureRef = useRef<CommentDrawGesture | undefined>(
    undefined,
  );
  const portRetargetGestureRef = useRef<PortRetargetGesture | undefined>(
    undefined,
  );
  const commentModeRef = useRef(false);
  const [commentMode, setCommentMode] = useState(false);
  const [commentDraft, setCommentDraft] = useState<
    CommentRectangle | undefined
  >(undefined);
  const [selectedCommentId, setSelectedCommentId] = useState<
    string | undefined
  >(undefined);
  const selectedCommentIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    selectedCommentIdRef.current = selectedCommentId;
  }, [selectedCommentId]);
  const [quickAdd, setQuickAdd] = useState<QuickAddRequest | undefined>(
    undefined,
  );
  const [variableDropRequest, setVariableDropRequest] = useState<
    VariableDropRequest | undefined
  >(undefined);
  const [variableDropActionIndex, setVariableDropActionIndex] = useState(0);
  const variableDropMenuRef = useRef<HTMLDivElement>(null);
  const variableDropMenuItemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (variableDropRequest === undefined) {
      return;
    }
    variableDropMenuItemsRef.current[variableDropActionIndex]?.focus();
  }, [variableDropActionIndex, variableDropRequest]);

  useEffect(() => {
    if (variableDropRequest === undefined) {
      return;
    }
    const document = currentDocument();
    const currentGraphId = useEditorSessionStore.getState().activeGraphId;
    const locked =
      graphRunActive ||
      isGraphRunActive(useRuntimeExecutionStore.getState().run?.state) ||
      useDocumentStore.getState().executionLocked;
    const variableStillExists =
      document !== undefined &&
      currentGraphId !== undefined &&
      variablesForGraph(document, currentGraphId).some(
        (variable) => variable.variableId === variableDropRequest.variableId,
      );
    if (
      currentGraphId === variableDropRequest.graphId &&
      !locked &&
      variableStillExists
    ) {
      return;
    }
    // An external graph update invalidates this menu. Close it outside the effect
    // commit to avoid another synchronous render cascade through the canvas.
    const frameId = window.requestAnimationFrame(() => {
      setVariableDropRequest(undefined);
      setVariableDropActionIndex(0);
      notify({
        severity: "warning",
        titleKey: locked
          ? "shell.tasks.errors.executionLocked"
          : "graph.variable.library.insertFailed",
      });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    activeDocument,
    activeGraphId,
    executionLocked,
    graphRunActive,
    variableDropRequest,
  ]);

  useEffect(() => {
    if (variableDropRequest === undefined) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        variableDropMenuRef.current?.contains(event.target)
      ) {
        return;
      }
      setVariableDropRequest(undefined);
      setVariableDropActionIndex(0);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [variableDropRequest]);

  const projection = useMemo(() => new GraphProjection(), []);

  const projectedNodes = useMemo(
    () =>
      graph && registry
        ? projection.projectNodes(graph, registry, activeDocument)
        : [],
    [activeDocument, graph, projection, registry],
  );
  const projectedEdges = useMemo(
    () =>
      graph && registry
        ? projection.projectEdges(graph, registry, edgeActivity, activeDocument)
        : [],
    [activeDocument, edgeActivity, graph, projection, registry],
  );
  const flowNodes = useMemo(
    () => mergeNodeRenderState(projectedNodes, renderState.nodes),
    [projectedNodes, renderState.nodes],
  );
  const flowEdges = useMemo(
    () => mergeEdgeRenderState(projectedEdges, renderState.edges),
    [projectedEdges, renderState.edges],
  );
  const flowNodesRef = useRef<readonly RinoFlowNode[]>(flowNodes);
  const flowEdgesRef = useRef<readonly RinoFlowEdge[]>(flowEdges);
  useEffect(() => {
    flowNodesRef.current = flowNodes;
    flowEdgesRef.current = flowEdges;
  }, [flowEdges, flowNodes]);
  const graphComments = graph?.editorMetadata?.comments ?? EMPTY_GRAPH_COMMENTS;

  const focusRequest = useProblemFocusStore((store) => store.request);
  const revealedRequestRef = useRef<number | undefined>(undefined);
  const framedGraphRef = useRef<string | undefined>(undefined);
  const overlapLayoutAttemptedGraphRef = useRef<string | undefined>(undefined);
  const overlapLayoutStabilityRef = useRef<OverlapLayoutStability | undefined>(
    undefined,
  );

  /** A graph has no persisted viewport in the MVP. Frame its existing nodes once when it
   * becomes active; for an empty graph, the first inserted node receives the same
   * treatment. Later edits preserve the user's pan and zoom. */
  useEffect(() => {
    if (
      activeGraphId === undefined ||
      flowNodes.length === 0 ||
      framedGraphRef.current === activeGraphId
    ) {
      return;
    }
    framedGraphRef.current = activeGraphId;
    const frameRequest = requestUiAnimationFrame(() => {
      void fitView(INITIAL_FIT_VIEW_OPTIONS);
    });
    return () => {
      cancelUiAnimationFrame(frameRequest);
    };
  }, [activeGraphId, fitView, flowNodes.length]);

  /** Answers a request to show a node or edge: it becomes the selection and the viewport
   * moves to it. The request is left in place for the inspector, which answers the field
   * part of the same request. */
  useEffect(() => {
    if (
      focusRequest === undefined ||
      focusRequest.requestId === revealedRequestRef.current ||
      focusRequest.graphId !== activeGraphId
    ) {
      return;
    }
    revealedRequestRef.current = focusRequest.requestId;

    setRenderState({
      nodes: flowNodes.map((node) =>
        node.selected === (node.id === focusRequest.nodeId)
          ? node
          : { ...node, selected: node.id === focusRequest.nodeId },
      ),
      edges: flowEdges.map((edge) =>
        edge.selected === (edge.id === focusRequest.edgeId)
          ? edge
          : { ...edge, selected: edge.id === focusRequest.edgeId },
      ),
    });

    const center = revealCenter(flowNodes, flowEdges, focusRequest);
    if (center) {
      // The viewport animation resolves when it settles; nothing depends on that moment.
      void setCenter(center.x, center.y, {
        zoom: getViewport().zoom,
        duration: prefersReducedMotion()
          ? 0
          : motionDurations.panel * MILLISECONDS_PER_SECOND,
      });
    }
  }, [
    activeGraphId,
    flowEdges,
    flowNodes,
    focusRequest,
    getViewport,
    setCenter,
  ]);

  /** Runs a command and records it under a localization key.
   *
   * History labels are keys rather than translated text, so the undo menu follows a
   * language change made after the edit. */
  const apply = useCallback(
    (label: LocalizationKey, command: GraphCommand) => {
      runCommand(label, command);
    },
    [runCommand],
  );

  const fitViewAfterOverlapLayout = useCallback((): void => {
    const options = prefersReducedMotion()
      ? INITIAL_FIT_VIEW_OPTIONS
      : {
          ...INITIAL_FIT_VIEW_OPTIONS,
          duration: motionDurations.panel * MILLISECONDS_PER_SECOND,
        };
    requestUiAnimationFrame(() => {
      void fitView(options);
    });
  }, [fitView]);

  const resolveOverlappingNodes = useCallback(
    (automatic: boolean): OverlapLayoutResolution => {
      const editedGraph = currentGraph();
      if (editedGraph === undefined || flowNodesRef.current.length < 2) {
        return { status: "notReady" };
      }
      if (
        graphRunActive ||
        isGraphRunActive(useRuntimeExecutionStore.getState().run?.state) ||
        useDocumentStore.getState().executionLocked
      ) {
        return { status: "locked" };
      }
      const allowEstimation =
        !automatic ||
        flowNodesRef.current.length >=
          canvasPerformance.visibleElementThreshold;
      const preferredNodes = horizontalPriorityNodeIds(
        flowNodesRef.current,
        flowEdgesRef.current,
      );
      const rectangles = flowNodesRef.current.flatMap((node) => {
        const rectangle = nodeRectangle(
          node,
          surfaceRef.current,
          automatic && !allowEstimation,
          allowEstimation,
          preferredNodes.has(node.id),
        );
        return rectangle === undefined ? [] : [rectangle];
      });
      if (rectangles.length !== flowNodesRef.current.length) {
        return { status: "notReady" };
      }
      if (
        automatic &&
        !hasNodeOverlap(rectangles, { horizontalGap: 0, verticalGap: 0 })
      ) {
        return { status: "noOverlap" };
      }
      const resolved = resolveNodeOverlaps(rectangles);
      const command = buildNodeOverlapCommand(
        editedGraph,
        flowNodesRef.current,
        rectangles,
        resolved,
      );
      if (command === undefined) {
        return { status: "noOverlap" };
      }
      const outcome = runCommand("graph.history.resolveNodeOverlaps", command);
      if (!outcome.ok) {
        return outcome.reason === "executionLocked"
          ? { status: "locked" }
          : { status: "commandRejected", reason: outcome.reason };
      }
      fitViewAfterOverlapLayout();
      return { status: "applied" };
    },
    [
      canvasPerformance.visibleElementThreshold,
      fitViewAfterOverlapLayout,
      graphRunActive,
      runCommand,
    ],
  );

  /** Imported graphs can contain coordinates written before the current node dimensions
   * were known. Repair such a graph once after React Flow has measured every visual node.
   * A running graph is never changed; the effect runs again when execution ends. */
  useEffect(() => {
    if (activeGraphId === undefined) {
      overlapLayoutAttemptedGraphRef.current = undefined;
      overlapLayoutStabilityRef.current = undefined;
      return;
    }
    const attemptKey = `${activeGraphId}:${String(OVERLAP_LAYOUT_STRATEGY_VERSION)}`;
    if (nodeDragActive || flowNodes.some((node) => node.dragging === true)) {
      return;
    }
    const shape = overlapLayoutShape(flowNodes);
    const previousStability = overlapLayoutStabilityRef.current;
    const previousAttemptKey = previousStability?.attemptKey;
    const previousShape = previousStability?.shape;
    if (previousAttemptKey !== attemptKey || previousShape !== shape) {
      overlapLayoutStabilityRef.current = {
        attemptKey,
        shape,
        quietFrames: 0,
      };
    }
    if (overlapLayoutAttemptedGraphRef.current === attemptKey) {
      return;
    }
    if (graphRunActive || executionLocked || flowNodes.length < 2) {
      return;
    }
    const allowEstimation =
      flowNodes.length >= canvasPerformance.visibleElementThreshold;
    const preferredNodes = horizontalPriorityNodeIds(flowNodes, flowEdges);
    const rectangles = flowNodes.flatMap((node) => {
      const rectangle = nodeRectangle(
        node,
        surfaceRef.current,
        !allowEstimation,
        allowEstimation,
        preferredNodes.has(node.id),
      );
      return rectangle === undefined ? [] : [rectangle];
    });
    if (rectangles.length !== flowNodes.length) {
      return;
    }
    let cancelled = false;
    let frameRequest: number | undefined;
    let retries = 0;
    const scheduleAttempt = () => {
      frameRequest = requestUiAnimationFrame(() => {
        frameRequest = undefined;
        if (cancelled) {
          return;
        }
        if (
          activeGraphId !== useEditorSessionStore.getState().activeGraphId ||
          isGraphRunActive(useRuntimeExecutionStore.getState().run?.state) ||
          useDocumentStore.getState().executionLocked
        ) {
          return;
        }
        if (overlapLayoutShape(flowNodesRef.current) !== shape) {
          return;
        }
        const stability = overlapLayoutStabilityRef.current;
        const stabilityAttemptKey = stability?.attemptKey;
        const stabilityShape = stability?.shape;
        if (
          stabilityAttemptKey !== attemptKey ||
          stabilityShape !== shape ||
          stability === undefined
        ) {
          return;
        }
        if (stability.quietFrames < OVERLAP_LAYOUT_STABILITY_FRAMES) {
          stability.quietFrames += 1;
          scheduleAttempt();
          return;
        }

        const result = resolveOverlappingNodes(true);
        if (result.status === "applied" || result.status === "noOverlap") {
          overlapLayoutAttemptedGraphRef.current = attemptKey;
          return;
        }
        if (retries >= MAXIMUM_OVERLAP_LAYOUT_RETRIES) {
          if (
            result.status === "locked" ||
            result.status === "commandRejected"
          ) {
            notifyOverlapLayoutFailure(result);
          }
          return;
        }
        retries += 1;
        scheduleAttempt();
      });
    };
    scheduleAttempt();
    return () => {
      cancelled = true;
      if (frameRequest !== undefined) {
        cancelUiAnimationFrame(frameRequest);
      }
    };
  }, [
    activeGraphId,
    canvasPerformance.visibleElementThreshold,
    executionLocked,
    fitViewAfterOverlapLayout,
    flowEdges,
    flowNodes,
    graphRunActive,
    nodeDragActive,
    resolveOverlappingNodes,
  ]);

  const addComment = useCallback(
    (rectangle: CommentRectangle) => {
      const editedGraph = currentGraph();
      if (!editedGraph) {
        return;
      }
      const comment: GraphCommentV1 = {
        commentId: createIdentifier(),
        text: t("graph.comment.defaultText"),
        position: { x: rectangle.x, y: rectangle.y },
        size: { width: rectangle.width, height: rectangle.height },
      };
      apply("graph.history.addComment", {
        kind: "addComment",
        graphId: editedGraph.graphId,
        comment,
      });
      setSelectedCommentId(comment.commentId);
    },
    [apply, t],
  );

  const replaceComment = useCallback(
    (comment: GraphCommentV1) => {
      const editedGraph = currentGraph();
      if (!editedGraph) {
        return;
      }
      const existing = editedGraph.editorMetadata?.comments?.find(
        (c) => c.commentId === comment.commentId,
      );

      // UE Blueprint style: Moving a comment box moves all contained nodes and comments inside it
      if (
        existing &&
        (existing.position.x !== comment.position.x ||
          existing.position.y !== comment.position.y)
      ) {
        const deltaX = comment.position.x - existing.position.x;
        const deltaY = comment.position.y - existing.position.y;

        const commentBox = {
          left: existing.position.x,
          top: existing.position.y,
          right:
            existing.position.x +
            (existing.size?.width ?? DEFAULT_COMMENT_WIDTH),
          bottom:
            existing.position.y +
            (existing.size?.height ?? DEFAULT_COMMENT_HEIGHT),
        };

        const commands: GraphCommand[] = [
          {
            kind: "replaceComment",
            graphId: editedGraph.graphId,
            comment,
          },
        ];

        // UE Blueprint style: Find all nodes whose center point or top-left is contained within the comment box
        for (const flowNode of flowNodesRef.current) {
          const el = surfaceRef.current?.querySelector<HTMLElement>(
            `.react-flow__node[data-id="${CSS.escape(flowNode.id)}"]`,
          );
          const width =
            el?.offsetWidth ?? flowNode.measured?.width ?? NODE_WIDTH;
          const height =
            el?.offsetHeight ?? flowNode.measured?.height ?? NODE_HEADER_HEIGHT;

          const centerX = flowNode.position.x + width / 2;
          const centerY = flowNode.position.y + height / 2;

          // Check if node center point or top-left position is inside comment box bounds
          const isInside =
            (centerX >= commentBox.left &&
              centerX <= commentBox.right &&
              centerY >= commentBox.top &&
              centerY <= commentBox.bottom) ||
            (flowNode.position.x >= commentBox.left &&
              flowNode.position.x <= commentBox.right &&
              flowNode.position.y >= commentBox.top &&
              flowNode.position.y <= commentBox.bottom);

          if (isInside) {
            const groupId = workflowGroupIdFromNodeId(flowNode.id);
            const group = workflowGroups(editedGraph).find(
              (candidate) => candidate.groupId === groupId,
            );
            if (group === undefined) {
              const node = editedGraph.nodes.find(
                (n) => n.nodeId === flowNode.id,
              );
              if (node) {
                commands.push({
                  kind: "moveNode",
                  graphId: editedGraph.graphId,
                  nodeId: node.nodeId,
                  position: {
                    x: node.position.x + deltaX,
                    y: node.position.y + deltaY,
                  },
                });
              }
            } else {
              for (const member of group.members) {
                const node = editedGraph.nodes.find(
                  (candidate) => candidate.nodeId === member.nodeId,
                );
                if (node !== undefined) {
                  commands.push({
                    kind: "moveNode",
                    graphId: editedGraph.graphId,
                    nodeId: node.nodeId,
                    position: {
                      x: node.position.x + deltaX,
                      y: node.position.y + deltaY,
                    },
                  });
                }
              }
            }
          }
        }

        // Find other comments contained inside this comment box before movement
        for (const otherComment of editedGraph.editorMetadata?.comments ?? []) {
          if (otherComment.commentId === comment.commentId) {
            continue;
          }
          const otherWidth = otherComment.size?.width ?? DEFAULT_COMMENT_WIDTH;
          const otherHeight =
            otherComment.size?.height ?? DEFAULT_COMMENT_HEIGHT;
          const otherCenterX = otherComment.position.x + otherWidth / 2;
          const otherCenterY = otherComment.position.y + otherHeight / 2;

          const isOtherInside =
            (otherCenterX >= commentBox.left &&
              otherCenterX <= commentBox.right &&
              otherCenterY >= commentBox.top &&
              otherCenterY <= commentBox.bottom) ||
            (otherComment.position.x >= commentBox.left &&
              otherComment.position.x <= commentBox.right &&
              otherComment.position.y >= commentBox.top &&
              otherComment.position.y <= commentBox.bottom);

          if (isOtherInside) {
            commands.push({
              kind: "replaceComment",
              graphId: editedGraph.graphId,
              comment: {
                ...otherComment,
                position: {
                  x: otherComment.position.x + deltaX,
                  y: otherComment.position.y + deltaY,
                },
              },
            });
          }
        }

        if (commands.length === 1 && commands[0]) {
          apply("graph.history.editComment", commands[0]);
        } else {
          apply("graph.history.moveNodes", {
            kind: "composite",
            label: "move",
            commands,
          });
        }
        return;
      }

      apply("graph.history.editComment", {
        kind: "replaceComment",
        graphId: editedGraph.graphId,
        comment,
      });
    },
    [apply],
  );

  const removeComment = useCallback(
    (commentId: string) => {
      const editedGraph = currentGraph();
      if (editedGraph) {
        apply("graph.history.removeComment", {
          kind: "removeComment",
          graphId: editedGraph.graphId,
          commentId,
        });
        setSelectedCommentId(undefined);
      }
    },
    [apply],
  );

  /** React Flow can report several position changes between two paints. Applying the
   * transient changes to React Flow's internal store keeps the outer canvas component
   * still while preserving the final position command and its undo boundary. */
  const flushNodeChanges = useCallback(() => {
    nodeChangeFrameRef.current = undefined;
    const changes = pendingNodeChangesRef.current;
    const requireRender = pendingNodeChangesRequireRenderRef.current;
    pendingNodeChangesRef.current = [];
    pendingNodeChangesRequireRenderRef.current = false;
    if (changes.length === 0) {
      return;
    }
    applyTransientNodeChanges(changes, flowNodesRef.current, (nextNodes) => {
      flowNodesRef.current = nextNodes;
      reactFlowStore.getState().setNodes(nextNodes);
      if (requireRender) {
        setRenderState((current) => ({ ...current, nodes: nextNodes }));
      }
    });
  }, [reactFlowStore]);

  const queueNodeChanges = useCallback(
    (changes: NodeChange<RinoFlowNode>[], requireRender = false) => {
      if (changes.length === 0) {
        return;
      }
      pendingNodeChangesRef.current.push(...changes);
      pendingNodeChangesRequireRenderRef.current ||= requireRender;
      nodeChangeFrameRef.current ??=
        window.requestAnimationFrame(flushNodeChanges);
    },
    [flushNodeChanges],
  );

  const handleNodeDragStart = useCallback(() => {
    setNodeDragActive(true);
  }, []);

  const handleNodeDragStop = useCallback(() => {
    setNodeDragActive(false);
  }, []);

  const handleNodesChange = useCallback(
    (changes: NodeChange<RinoFlowNode>[]) => {
      const effectiveChanges = filterNoOpNodeSelectionChanges(
        changes,
        flowNodesRef.current,
      );
      if (effectiveChanges.length === 0) {
        return;
      }
      if (
        effectiveChanges.some(
          (change) => change.type === "position" && change.dragging === false,
        )
      ) {
        setNodeDragActive(false);
      }
      const gridSnappedReleaseChanges = effectiveChanges.map((change) => {
        if (
          change.type !== "position" ||
          change.dragging !== false ||
          change.position === undefined
        ) {
          return change;
        }
        return {
          ...change,
          position: snapToGrid(change.position),
        };
      });
      const alignedChanges = alignPositionChanges(
        gridSnappedReleaseChanges,
        flowNodesRef.current,
        getViewport().zoom,
      );
      const transientChanges = alignedChanges.filter(shouldDeferNodeChange);
      const immediateChanges = alignedChanges.filter(
        (change) => !transientChanges.includes(change),
      );
      if (transientChanges.length > 0) {
        queueNodeChanges(
          transientChanges,
          transientChanges.some((change) => change.type === "dimensions"),
        );
      }
      if (immediateChanges.length > 0) {
        if (nodeChangeFrameRef.current !== undefined) {
          window.cancelAnimationFrame(nodeChangeFrameRef.current);
        }
        flushNodeChanges();
        const nextNodes = applyNodeChanges(immediateChanges, [
          ...flowNodesRef.current,
        ]);
        flowNodesRef.current = nextNodes;
        setRenderState((current) => ({
          ...current,
          nodes: nextNodes,
        }));
      }

      const editedGraph = currentGraph();
      if (!editedGraph) {
        return;
      }
      const moves: GraphCommand[] = [];
      for (const change of alignedChanges) {
        if (
          change.type === "position" &&
          change.dragging === false &&
          change.position
        ) {
          const repeatHintId = repeatHintIdFromNodeId(change.id);
          if (repeatHintId !== undefined) {
            moves.push({
              kind: "moveRepeatHint",
              graphId: editedGraph.graphId,
              hintId: repeatHintId,
              position: change.position,
            });
            continue;
          }
          const groupId = workflowGroupIdFromNodeId(change.id);
          const group = workflowGroups(editedGraph).find(
            (candidate) => candidate.groupId === groupId,
          );
          if (group === undefined) {
            moves.push({
              kind: "moveNode",
              graphId: editedGraph.graphId,
              nodeId: change.id,
              position: change.position,
            });
          } else {
            const origin = workflowGroupOrigin(editedGraph, group);
            const destination = change.position;
            const offset = {
              x: destination.x - origin.x,
              y: destination.y - origin.y,
            };
            for (const member of group.members) {
              const node = editedGraph.nodes.find(
                (candidate) => candidate.nodeId === member.nodeId,
              );
              if (node !== undefined) {
                moves.push({
                  kind: "moveNode",
                  graphId: editedGraph.graphId,
                  nodeId: node.nodeId,
                  position: {
                    x: node.position.x + offset.x,
                    y: node.position.y + offset.y,
                  },
                });
              }
            }
          }
        }
      }

      const single = moves.length === 1 ? moves[0] : undefined;
      if (single) {
        apply(
          single.kind === "moveRepeatHint"
            ? "graph.history.moveRepeatHint"
            : "graph.history.moveNode",
          single,
        );
        return;
      }
      if (moves.length > 1) {
        // A drag that moved several nodes is one edit, so one undo returns all of them.
        apply("graph.history.moveNodes", {
          kind: "composite",
          label: "move",
          commands: moves,
        });
      }
    },
    [apply, flushNodeChanges, getViewport, queueNodeChanges],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<RinoFlowEdge>[]) => {
      // Only selection and hover state arrive here. Removal runs through a command so it
      // stays undoable, which is why the delete key is not handed to React Flow.
      setRenderState((current) => ({
        ...current,
        edges: applyEdgeChanges(changes, [...flowEdgesRef.current]),
      }));
    },
    [],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      const editedGraph = currentGraph();
      const registrySnapshot = currentRegistry();
      if (!editedGraph || !registrySnapshot) {
        return;
      }
      const candidate = toCandidate(connection, editedGraph);
      if (!candidate) {
        return;
      }
      const evaluation = connectionIndexFor(
        editedGraph,
        registrySnapshot,
        currentDocument(),
      ).evaluate(candidate);
      if (!evaluation.accepted) {
        notify({
          severity: "warning",
          titleKey: connectionRejectionKeys[evaluation.reason],
        });
        return;
      }
      apply(
        "graph.history.connect",
        buildConnectCommand(
          editedGraph.graphId,
          candidate,
          evaluation,
          createIdentifier,
        ),
      );
    },
    [apply],
  );

  const isValidConnection = useCallback<IsValidConnection<RinoFlowEdge>>(
    (connection) => {
      const editedGraph = currentGraph();
      const registrySnapshot = currentRegistry();
      if (!editedGraph || !registrySnapshot) {
        return false;
      }
      const candidate = toCandidate(connection, editedGraph);
      if (!candidate) {
        return false;
      }
      return connectionIndexFor(
        editedGraph,
        registrySnapshot,
        currentDocument(),
      ).evaluate(candidate).accepted;
    },
    [],
  );

  /** Marks every port this connection could land on, so the user aims at a target the
   * editor has already agreed to rather than discovering the refusal on release. */
  const handleConnectStart = useCallback(
    (_event: unknown, params: OnConnectStartParams) => {
      const editedGraph = currentGraph();
      const registrySnapshot = currentRegistry();
      if (
        !editedGraph ||
        !registrySnapshot ||
        !params.nodeId ||
        !params.handleId ||
        params.handleType === null
      ) {
        return;
      }
      const endpoint = resolveWorkflowGroupEndpoint(
        editedGraph,
        params.nodeId,
        params.handleId,
      );
      if (endpoint === undefined) {
        return;
      }
      useConnectionDragStore.getState().beginDrag(
        editedGraph,
        registrySnapshot,
        {
          nodeId: endpoint.nodeId,
          portId: endpoint.portId,
          handleType: params.handleType,
        },
        currentDocument(),
      );
    },
    [],
  );

  /** Reconnecting a wire uses the same validation and compatible-target highlight as a
   * new connection. The persisted change still replaces the original edge atomically. */
  const handleReconnectStart = useCallback(
    (_event: unknown, edge: RinoFlowEdge, handleType: "source" | "target") => {
      const editedGraph = currentGraph();
      const registrySnapshot = currentRegistry();
      const nodeId = handleType === "source" ? edge.source : edge.target;
      const handleId =
        handleType === "source" ? edge.sourceHandle : edge.targetHandle;
      if (!editedGraph || !registrySnapshot || !handleId) {
        return;
      }
      const endpoint = resolveWorkflowGroupEndpoint(
        editedGraph,
        nodeId,
        handleId,
      );
      if (endpoint === undefined) {
        return;
      }
      useConnectionDragStore.getState().beginDrag(
        editedGraph,
        registrySnapshot,
        {
          nodeId: endpoint.nodeId,
          portId: endpoint.portId,
          handleType,
        },
        currentDocument(),
      );
    },
    [],
  );

  const handleReconnect = useCallback(
    (edge: RinoFlowEdge, connection: Connection) => {
      const editedGraph = currentGraph();
      const registrySnapshot = currentRegistry();
      if (!editedGraph || !registrySnapshot) {
        return;
      }
      const original = editedGraph.edges.find(
        (candidate) => candidate.edgeId === edge.id,
      );
      const candidate = toCandidate(connection, editedGraph);
      if (
        !original ||
        !candidate ||
        candidateMatchesEdge(candidate, original)
      ) {
        return;
      }
      const evaluation = connectionIndexFor(
        editedGraph,
        registrySnapshot,
        currentDocument(),
      ).evaluate(candidate);
      if (!evaluation.accepted) {
        notify({
          severity: "warning",
          titleKey: connectionRejectionKeys[evaluation.reason],
        });
        return;
      }
      apply(
        "graph.history.reconnectEdge",
        buildReconnectEdgeCommand(
          editedGraph.graphId,
          original.edgeId,
          candidate,
          evaluation,
          createIdentifier,
        ),
      );
    },
    [apply],
  );

  const handleReconnectEnd = useCallback(() => {
    useConnectionDragStore.getState().endDrag();
  }, []);

  const handleNodeDoubleClick = useCallback<NodeMouseHandler<RinoFlowNode>>(
    (_event, node) => {
      const repeatHintId = repeatHintIdFromNodeId(node.id);
      if (repeatHintId !== undefined) {
        const editedGraph = currentGraph();
        const hint = editedGraph?.editorMetadata?.repeatHints?.find(
          (candidate) => candidate.hintId === repeatHintId,
        );
        const edge = editedGraph?.edges.find(
          (candidate) => candidate.edgeId === hint?.edgeId,
        );
        if (editedGraph === undefined || edge === undefined) {
          return;
        }
        const targetGroup = workflowGroups(editedGraph).find((group) =>
          group.members.some((member) => member.nodeId === edge.targetNodeId),
        );
        const targetNodeId =
          targetGroup?.collapsed === true
            ? workflowGroupNodeId(targetGroup.groupId)
            : (targetGroup?.exposedPorts.find(
                (port) => port.proxyPortId === "run",
              )?.nodeId ?? edge.targetNodeId);
        const targetNode = flowNodesRef.current.find(
          (candidate) => candidate.id === targetNodeId,
        );
        if (targetNode === undefined) {
          return;
        }
        const nextNodes = flowNodesRef.current.map((candidate) =>
          candidate.selected === (candidate.id === targetNodeId)
            ? candidate
            : { ...candidate, selected: candidate.id === targetNodeId },
        );
        setRenderState({
          nodes: nextNodes,
          edges: flowEdgesRef.current.map((candidate) =>
            candidate.selected === false
              ? candidate
              : { ...candidate, selected: false },
          ),
        });
        setSelection(
          targetGroup?.collapsed === true
            ? targetGroup.members.map((member) => member.nodeId)
            : [targetNodeId],
          [],
        );
        void setCenter(
          targetNode.position.x +
            (targetNode.measured?.width ?? targetNode.width ?? NODE_WIDTH) / 2,
          targetNode.position.y +
            (targetNode.measured?.height ??
              targetNode.height ??
              NODE_HEADER_HEIGHT) /
              2,
          {
            zoom: getViewport().zoom,
            duration: prefersReducedMotion()
              ? 0
              : motionDurations.panel * MILLISECONDS_PER_SECOND,
          },
        );
        return;
      }
      if (
        node.data.typeKey !== "core.function.call" ||
        isGraphRunActive(useRuntimeExecutionStore.getState().run?.state) ||
        useDocumentStore.getState().executionLocked
      ) {
        return;
      }
      const targetGraphId = node.data.functionGraphId;
      if (targetGraphId === undefined) {
        return;
      }
      const targetGraph = currentDocument()?.graphs.find(
        (candidate) => candidate.graphId === targetGraphId,
      );
      if (targetGraph?.kind !== "function") {
        return;
      }
      enterGraph(targetGraph.graphId);
    },
    [enterGraph, getViewport, setCenter, setSelection],
  );

  const handleSelectionChange = useCallback(
    ({ nodes, edges }: OnSelectionChangeParams<RinoFlowNode, RinoFlowEdge>) => {
      setSelection(
        nodes.flatMap((node) => {
          if (repeatHintIdFromNodeId(node.id) !== undefined) {
            return [];
          }
          const groupId = workflowGroupIdFromNodeId(node.id);
          if (groupId === undefined) {
            return [node.id];
          }
          return (
            currentGraph()
              ?.editorMetadata?.workflowGroups?.find(
                (group) => group.groupId === groupId,
              )
              ?.members.map((member) => member.nodeId) ?? []
          );
        }),
        edges.map((edge) => edge.id),
      );
    },
    [setSelection],
  );

  const readBounds = useCallback(
    () =>
      surfaceRef.current?.getBoundingClientRect() ?? {
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      },
    [],
  );

  /** The graph position under a pointer, without the node-centring offset. */
  const pointerGraphPosition = useCallback(
    (point: { clientX: number; clientY: number }) =>
      screenToCanvasPosition(point, readBounds(), getViewport()),
    [getViewport, readBounds],
  );

  const handleViewportMoveStart = useCallback(() => {
    if (surfaceRef.current !== null) {
      surfaceRef.current.dataset["viewportMoving"] = "true";
    }
  }, []);

  const handleViewportMoveEnd = useCallback(
    (_event: unknown, viewport: CanvasViewport) => {
      surfaceRef.current?.removeAttribute("data-viewport-moving");
      useCanvasViewportStore.getState().reportViewport(viewport);
    },
    [],
  );

  const reportCanvasGeometry = useCallback(
    (measuredSize?: { width: number; height: number }) => {
      const size = measuredSize ?? readBounds();
      const viewport = getViewport();
      useCanvasViewportStore
        .getState()
        .reportGeometry(viewport, size.width, size.height);
    },
    [getViewport, readBounds],
  );

  const scheduleCanvasGeometryReport = useCallback(
    (size: { width: number; height: number }) => {
      pendingCanvasGeometryRef.current = size;
      canvasGeometryFrameRef.current ??= requestUiAnimationFrame(() => {
        canvasGeometryFrameRef.current = undefined;
        const pendingSize = pendingCanvasGeometryRef.current;
        pendingCanvasGeometryRef.current = undefined;
        if (pendingSize !== undefined) {
          reportCanvasGeometry(pendingSize);
        }
      });
    },
    [reportCanvasGeometry],
  );

  // Direct manipulation reaches its target on the next display frame. A second
  // animation queue would add latency and keep painting after input has stopped.
  const flushWheelZoom = useCallback(() => {
    wheelZoomInputFrameRef.current = undefined;
    const pending = pendingWheelZoomRef.current;
    pendingWheelZoomRef.current = undefined;
    if (pending === undefined) {
      return;
    }
    const current = getViewport();
    const next = zoomViewportAtPointer(
      current,
      pending,
      readBounds(),
      pending.deltaY,
      pending.deltaMode,
      MINIMUM_CANVAS_ZOOM,
      MAXIMUM_CANVAS_ZOOM,
      canvasPerformance.wheelZoomSensitivity,
    );
    if (next !== current) {
      void setViewport(next, { duration: 0 });
    }
  }, [
    canvasPerformance.wheelZoomSensitivity,
    getViewport,
    readBounds,
    setViewport,
  ]);

  const handleWheelCapture = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".nowheel") !== null
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const pending = pendingWheelZoomRef.current;
      pendingWheelZoomRef.current = {
        deltaY:
          pending?.deltaMode === event.deltaMode
            ? pending.deltaY + event.deltaY
            : event.deltaY,
        deltaMode: event.deltaMode,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      wheelZoomInputFrameRef.current ??=
        window.requestAnimationFrame(flushWheelZoom);
    },
    [flushWheelZoom],
  );

  const cancelWheelZoom = useCallback(() => {
    if (wheelZoomInputFrameRef.current !== undefined) {
      window.cancelAnimationFrame(wheelZoomInputFrameRef.current);
      wheelZoomInputFrameRef.current = undefined;
    }
    pendingWheelZoomRef.current = undefined;
  }, []);

  const flushPan = useCallback(() => {
    const gesture = panGestureRef.current;
    if (gesture === undefined) {
      return;
    }
    gesture.frameId = undefined;
    const deltaX = gesture.pendingX;
    const deltaY = gesture.pendingY;
    gesture.pendingX = 0;
    gesture.pendingY = 0;
    if (deltaX === 0 && deltaY === 0) {
      return;
    }
    const viewport = getViewport();
    void setViewport(
      {
        ...viewport,
        x: viewport.x + acceleratedPanDelta(deltaX),
        y: viewport.y + acceleratedPanDelta(deltaY),
      },
      { duration: 0 },
    );
  }, [getViewport, setViewport]);

  const handlePointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      cancelWheelZoom();
      const port =
        event.target instanceof Element
          ? graphPortAtElement(event.target)
          : undefined;
      if (
        !graphRunActive &&
        event.button === 0 &&
        event.altKey &&
        !event.ctrlKey &&
        port !== undefined
      ) {
        const editedGraph = currentGraph();
        const edgeIds = editedGraph?.edges
          .filter((edge) => edgeTouchesPort(edge, port))
          .map((edge) => edge.edgeId);
        if (editedGraph && edgeIds && edgeIds.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          apply(
            "graph.history.disconnectPort",
            buildDisconnectPortCommand(editedGraph.graphId, edgeIds),
          );
          return;
        }
      }
      if (
        !graphRunActive &&
        event.button === 0 &&
        event.ctrlKey &&
        !event.altKey &&
        port !== undefined
      ) {
        const editedGraph = currentGraph();
        const hasConnections = editedGraph?.edges.some((edge) =>
          edgeTouchesPort(edge, port),
        );
        if (hasConnections) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          portRetargetGestureRef.current = {
            pointerId: event.pointerId,
            origin: port,
          };
          return;
        }
      }
      if (
        commentModeRef.current &&
        event.button === 0 &&
        !(
          event.target instanceof Element &&
          event.target.closest(".react-flow__node, .graph-comment") !== null
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
        const origin = pointerGraphPosition(event);
        event.currentTarget.setPointerCapture(event.pointerId);
        commentDrawGestureRef.current = { pointerId: event.pointerId, origin };
        setCommentDraft({ ...origin, width: 0, height: 0 });
        return;
      }
      if (
        event.button !== MIDDLE_MOUSE_BUTTON &&
        event.button !== RIGHT_MOUSE_BUTTON
      ) {
        return;
      }
      if (event.button === MIDDLE_MOUSE_BUTTON) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset["panning"] = "true";
      } else {
        // Keep an ordinary right click available for the canvas context menu. The drag
        // threshold below promotes this pending gesture to a real pan.
        suppressNextContextMenuRef.current = false;
      }
      panGestureRef.current = {
        pointerId: event.pointerId,
        button: event.button,
        moved: event.button === MIDDLE_MOUSE_BUTTON,
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        pendingX: 0,
        pendingY: 0,
        frameId: undefined,
      };
    },
    [apply, cancelWheelZoom, graphRunActive, pointerGraphPosition],
  );

  const handlePointerMoveCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const commentGesture = commentDrawGestureRef.current;
      if (commentGesture?.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        const point = pointerGraphPosition(event);
        setCommentDraft({
          x: Math.min(commentGesture.origin.x, point.x),
          y: Math.min(commentGesture.origin.y, point.y),
          width: Math.abs(point.x - commentGesture.origin.x),
          height: Math.abs(point.y - commentGesture.origin.y),
        });
        return;
      }
      const gesture = panGestureRef.current;
      if (gesture?.pointerId !== event.pointerId) {
        return;
      }
      if (!gesture.moved) {
        const distanceX = event.clientX - gesture.startClientX;
        const distanceY = event.clientY - gesture.startClientY;
        if (
          distanceX * distanceX + distanceY * distanceY <
          PAN_START_DISTANCE_PIXELS * PAN_START_DISTANCE_PIXELS
        ) {
          return;
        }
        gesture.moved = true;
        suppressNextContextMenuRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset["panning"] = "true";
      }
      event.preventDefault();
      event.stopPropagation();
      gesture.pendingX += event.clientX - gesture.lastClientX;
      gesture.pendingY += event.clientY - gesture.lastClientY;
      gesture.lastClientX = event.clientX;
      gesture.lastClientY = event.clientY;
      gesture.frameId ??= window.requestAnimationFrame(flushPan);
    },
    [flushPan, pointerGraphPosition],
  );

  const finishPointerGesture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, commitComment: boolean) => {
      const retargetGesture = portRetargetGestureRef.current;
      if (retargetGesture?.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        portRetargetGestureRef.current = undefined;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (!commitComment) {
          return;
        }
        const destination = graphPortAtElement(
          document.elementFromPoint(event.clientX, event.clientY),
        );
        const editedGraph = currentGraph();
        const registrySnapshot = currentRegistry();
        if (!destination || !editedGraph || !registrySnapshot) {
          return;
        }
        const result = buildRetargetPortConnectionsCommand(
          editedGraph,
          registrySnapshot,
          retargetGesture.origin,
          destination,
          createIdentifier,
        );
        if (!result.ok) {
          if (result.reason !== "samePort") {
            notify({
              severity: "warning",
              titleKey: "graph.connection.retargetRejected",
            });
          }
          return;
        }
        apply("graph.history.retargetPortConnections", result.command);
        return;
      }
      const commentGesture = commentDrawGestureRef.current;
      if (commentGesture?.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        const point = pointerGraphPosition(event);
        const width = Math.abs(point.x - commentGesture.origin.x);
        const height = Math.abs(point.y - commentGesture.origin.y);
        if (commitComment) {
          addComment({
            x: Math.min(commentGesture.origin.x, point.x),
            y: Math.min(commentGesture.origin.y, point.y),
            width: Math.max(
              MINIMUM_COMMENT_WIDTH,
              width || DEFAULT_COMMENT_WIDTH,
            ),
            height: Math.max(
              MINIMUM_COMMENT_HEIGHT,
              height || DEFAULT_COMMENT_HEIGHT,
            ),
          });
        }
        commentDrawGestureRef.current = undefined;
        commentModeRef.current = false;
        setCommentMode(false);
        setCommentDraft(undefined);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        return;
      }
      const gesture = panGestureRef.current;
      if (gesture?.pointerId !== event.pointerId) {
        return;
      }
      if (!gesture.moved) {
        // A right click that never crossed the drag threshold belongs to the context
        // menu. Do not cancel its native/context-menu event here.
        panGestureRef.current = undefined;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (gesture.frameId !== undefined) {
        window.cancelAnimationFrame(gesture.frameId);
        gesture.frameId = undefined;
      }
      flushPan();
      panGestureRef.current = undefined;
      delete event.currentTarget.dataset["panning"];
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [addComment, apply, flushPan, pointerGraphPosition],
  );

  const handleContextMenuCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!suppressNextContextMenuRef.current) {
        return;
      }
      suppressNextContextMenuRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) {
      return;
    }
    reportCanvasGeometry();
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) {
        return;
      }
      scheduleCanvasGeometryReport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(surface);
    return () => {
      observer.disconnect();
      pendingCanvasGeometryRef.current = undefined;
      if (canvasGeometryFrameRef.current !== undefined) {
        cancelUiAnimationFrame(canvasGeometryFrameRef.current);
        canvasGeometryFrameRef.current = undefined;
      }
    };
  }, [reportCanvasGeometry, scheduleCanvasGeometryReport]);

  /** Records geometry as soon as React Flow is ready. The resize observer keeps it
   * current after later panel or window changes. */
  const handleInit = useCallback(() => {
    reportCanvasGeometry();
  }, [reportCanvasGeometry]);

  /** Where a node dropped at this pointer position lands. The drop and its preview share
   * this so the ghost sits exactly where the node will appear. */
  const dropOrigin = useCallback(
    (point: { clientX: number; clientY: number }) => {
      const viewport: CanvasViewport = getViewport();
      const bounds = readBounds();
      return snapToGrid(
        centerOnPointer(
          screenToCanvasPosition(
            pointerOrCanvasCenter(point, bounds),
            bounds,
            viewport,
          ),
          NODE_WIDTH,
          NODE_HEADER_HEIGHT,
        ),
      );
    },
    [getViewport, readBounds],
  );

  const scheduleDropPreview = useCallback((preview: CSSProperties) => {
    pendingDropPreviewRef.current = preview;
    if (dropPreviewFrameRef.current !== undefined) {
      return;
    }
    dropPreviewFrameRef.current = requestUiAnimationFrame(() => {
      dropPreviewFrameRef.current = undefined;
      setDropPreview(pendingDropPreviewRef.current);
    });
  }, []);

  const clearDropPreview = useCallback(() => {
    pendingDropPreviewRef.current = undefined;
    if (dropPreviewFrameRef.current !== undefined) {
      cancelUiAnimationFrame(dropPreviewFrameRef.current);
      dropPreviewFrameRef.current = undefined;
    }
    setDropPreview(undefined);
  }, []);

  useEffect(
    () => () => {
      if (dropPreviewFrameRef.current !== undefined) {
        cancelUiAnimationFrame(dropPreviewFrameRef.current);
      }
      if (wheelZoomInputFrameRef.current !== undefined) {
        window.cancelAnimationFrame(wheelZoomInputFrameRef.current);
      }
      const panGesture = panGestureRef.current;
      if (panGesture?.frameId !== undefined) {
        window.cancelAnimationFrame(panGesture.frameId);
      }
      if (nodeChangeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(nodeChangeFrameRef.current);
      }
      pendingNodeChangesRef.current = [];
      pendingNodeChangesRequireRenderRef.current = false;
    },
    [],
  );

  const handleDragOver = useCallback(
    (event: ReactDragEvent) => {
      if (readDragKinds(event.dataTransfer) === undefined) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";

      // The preview is positioned here rather than during render, so it shows the exact
      // place the drop will produce, snapped and scaled with the viewport.
      const bounds = readBounds();
      const viewport: CanvasViewport = getViewport();
      const screen = canvasToScreenPosition(
        dropOrigin(event),
        bounds,
        viewport,
      );
      scheduleDropPreview({
        transform: `translate3d(${String(screen.clientX - bounds.left)}px, ${String(screen.clientY - bounds.top)}px, 0)`,
        width: `${String(NODE_WIDTH * viewport.zoom)}px`,
        height: `${String(NODE_HEADER_HEIGHT * viewport.zoom)}px`,
      });
    },
    [dropOrigin, getViewport, readBounds, scheduleDropPreview],
  );

  const handleDragLeave = useCallback(
    (event: ReactDragEvent) => {
      // Moving onto a child element is not leaving the canvas.
      if (
        event.relatedTarget instanceof Node &&
        surfaceRef.current?.contains(event.relatedTarget) === true
      ) {
        return;
      }
      clearDropPreview();
    },
    [clearDropPreview],
  );

  const handleDrop = useCallback(
    (event: ReactDragEvent) => {
      clearDropPreview();
      const dragKind = readDragKinds(event.dataTransfer);
      const payload = readDragPayload(event.dataTransfer);
      clearDragPayload();
      if (dragKind !== undefined) {
        event.preventDefault();
      }
      if (payload === undefined) {
        if (dragKind !== undefined) {
          notify({
            severity: "warning",
            titleKey: "graph.canvas.dropInvalid",
          });
        }
        return;
      }

      if (payload.kind === "function") {
        if (
          graphRunActive ||
          isGraphRunActive(useRuntimeExecutionStore.getState().run?.state) ||
          useDocumentStore.getState().executionLocked
        ) {
          notify({
            severity: "warning",
            titleKey: "shell.tasks.errors.executionLocked",
          });
          return;
        }
        const document = currentDocument();
        const ownerGraphId = useEditorSessionStore.getState().activeGraphId;
        if (document === undefined || ownerGraphId === undefined) {
          notify({
            severity: "info",
            titleKey: "graph.function.library.errors.noProject",
          });
          return;
        }
        const built = buildInsertFunctionCallCommand(
          document,
          ownerGraphId,
          payload.functionGraphId,
          dropOrigin(event),
          createIdentifier,
        );
        if (!built.ok) {
          notifyFunctionFailure(built.reason);
          return;
        }
        const outcome = runCommand(
          "graph.history.insertFunctionCall",
          built.value.command,
        );
        if (!outcome.ok) {
          notify({
            severity: "error",
            titleKey: "graph.function.library.errors.commandRejected",
          });
        }
        return;
      }

      if (payload.kind === "variable") {
        const document = currentDocument();
        const graphId = useEditorSessionStore.getState().activeGraphId;
        const variableExists =
          document !== undefined &&
          graphId !== undefined &&
          variablesForGraph(document, graphId).some(
            (variable) => variable.variableId === payload.variableId,
          );
        if (!variableExists) {
          notify({
            severity: "warning",
            titleKey: "graph.variable.library.insertFailed",
          });
          return;
        }
        const position = dropOrigin(event);
        const bounds = readBounds();
        const screen = canvasToScreenPosition(position, bounds, getViewport());
        setVariableDropActionIndex(0);
        setVariableDropRequest({
          graphId,
          variableId: payload.variableId,
          position,
          menuPosition: clampVariableDropMenuPosition(
            {
              x: screen.clientX - bounds.left,
              y: screen.clientY - bounds.top,
            },
            bounds,
          ),
        });
        return;
      }

      const registrySnapshot = currentRegistry();
      if (!registrySnapshot) {
        return;
      }

      if (payload.kind === "asset") {
        insertImageAssetNode(payload.key, { origin: dropOrigin(event) });
        return;
      }

      const entry = buildPaletteEntries(registrySnapshot).find(
        (candidate) =>
          candidate.kind === payload.kind && candidate.key === payload.key,
      );
      if (entry) {
        // The drop shares the palette's insertion path, so a node dropped, created from
        // the menu, or added by keyboard produces the same command and undo entry.
        insertPaletteEntry(entry, { origin: dropOrigin(event) });
      }
    },
    [
      clearDropPreview,
      dropOrigin,
      getViewport,
      graphRunActive,
      readBounds,
      runCommand,
    ],
  );

  const chooseVariableDropRole = useCallback(
    (role: VariableNodeInsertRole) => {
      const request = variableDropRequest;
      setVariableDropRequest(undefined);
      setVariableDropActionIndex(0);
      if (request === undefined) {
        return;
      }
      const document = currentDocument();
      const graphId = useEditorSessionStore.getState().activeGraphId;
      const locked =
        graphRunActive ||
        isGraphRunActive(useRuntimeExecutionStore.getState().run?.state) ||
        useDocumentStore.getState().executionLocked;
      const variableExists =
        document !== undefined &&
        graphId !== undefined &&
        variablesForGraph(document, graphId).some(
          (variable) => variable.variableId === request.variableId,
        );
      if (locked) {
        notify({
          severity: "warning",
          titleKey: "shell.tasks.errors.executionLocked",
        });
        return;
      }
      if (!variableExists || graphId !== request.graphId) {
        notify({
          severity: "warning",
          titleKey: "graph.variable.library.insertFailed",
        });
        return;
      }
      if (
        insertVariableNode(request.variableId, role, request.position) ===
        undefined
      ) {
        notify({
          severity: "warning",
          titleKey: "graph.variable.library.insertFailed",
        });
      }
    },
    [graphRunActive, variableDropRequest],
  );

  const handleVariableDropMenuKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setVariableDropRequest(undefined);
        setVariableDropActionIndex(0);
        surfaceRef.current?.focus();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setVariableDropActionIndex((index) =>
          event.key === "ArrowDown"
            ? (index + 1) % VARIABLE_DROP_ACTIONS.length
            : (index + VARIABLE_DROP_ACTIONS.length - 1) %
              VARIABLE_DROP_ACTIONS.length,
        );
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        setVariableDropActionIndex(event.key === "Home" ? 0 : 1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        chooseVariableDropRole(
          VARIABLE_DROP_ACTIONS[variableDropActionIndex] ?? "getter",
        );
      }
    },
    [chooseVariableDropRole, variableDropActionIndex],
  );

  const runCanvasShortcut = useCallback(
    (shortcut: CanvasShortcutId) => {
      if (graphRunActive) {
        return;
      }
      const editedGraph = currentGraph();
      const session = useEditorSessionStore.getState();
      switch (shortcut) {
        case "undo":
          undoChange();
          return;
        case "redo":
          redoChange();
          return;
        case "remove":
          if (editedGraph && session.selectedNodeIds.length > 0) {
            apply(
              "graph.history.removeSelection",
              buildRemoveSelectionCommand(
                editedGraph.graphId,
                session.selectedNodeIds,
              ),
            );
          } else if (editedGraph && session.selectedEdgeIds.length > 0) {
            apply(
              "graph.history.removeSelection",
              buildDisconnectPortCommand(
                editedGraph.graphId,
                session.selectedEdgeIds,
              ),
            );
          } else if (
            editedGraph &&
            selectedCommentIdRef.current !== undefined
          ) {
            removeComment(selectedCommentIdRef.current);
          }
          return;
        case "copy":
          if (editedGraph && session.selectedNodeIds.length > 0) {
            session.setClipboard(
              extractFragment(editedGraph, session.selectedNodeIds),
            );
          }
          return;
        case "paste":
          if (editedGraph && session.clipboard) {
            apply(
              "graph.history.paste",
              buildPasteCommand(
                editedGraph.graphId,
                session.clipboard,
                createIdentifier,
              ),
            );
          }
          return;
        case "duplicate":
          if (editedGraph && session.selectedNodeIds.length > 0) {
            apply(
              "graph.history.duplicate",
              buildDuplicateCommand(
                editedGraph,
                session.selectedNodeIds,
                createIdentifier,
              ),
            );
          }
          return;
        case "addNode":
          setQuickAdd({ position: visibleCanvasCenter() });
          return;
        case "comment": {
          const selectedNodeIds = new Set(session.selectedNodeIds);
          const selectedNodes = flowNodesRef.current.filter((node) => {
            if (selectedNodeIds.has(node.id)) {
              return true;
            }
            const groupId = workflowGroupIdFromNodeId(node.id);
            if (groupId === undefined) {
              return false;
            }
            const group = currentGraph()?.editorMetadata?.workflowGroups?.find(
              (g) => g.groupId === groupId,
            );
            return (
              group?.members.some((m) => selectedNodeIds.has(m.nodeId)) ?? false
            );
          });

          const selectedComments = graphComments.filter(
            (c) => c.commentId === selectedCommentIdRef.current,
          );

          if (selectedNodes.length > 0 || selectedComments.length > 0) {
            const boxes: {
              x: number;
              y: number;
              width: number;
              height: number;
            }[] = [];

            for (const node of selectedNodes) {
              const rectangle = nodeRectangle(
                node,
                surfaceRef.current,
                false,
                false,
                false,
              );
              if (rectangle === undefined) {
                continue;
              }
              boxes.push({
                x: rectangle.x,
                y: rectangle.y,
                width: rectangle.width,
                height: rectangle.height,
              });
            }

            for (const comment of selectedComments) {
              boxes.push({
                x: comment.position.x,
                y: comment.position.y,
                width: comment.size?.width ?? DEFAULT_COMMENT_WIDTH,
                height: comment.size?.height ?? DEFAULT_COMMENT_HEIGHT,
              });
            }

            const left = Math.min(...boxes.map((b) => b.x));
            const top = Math.min(...boxes.map((b) => b.y));
            const right = Math.max(...boxes.map((b) => b.x + b.width));
            const bottom = Math.max(...boxes.map((b) => b.y + b.height));
            const padding = 32;
            addComment({
              x: left - padding,
              y: top - padding,
              width: Math.max(
                MINIMUM_COMMENT_WIDTH,
                right - left + padding * 2,
              ),
              height: Math.max(
                MINIMUM_COMMENT_HEIGHT,
                bottom - top + padding * 2,
              ),
            });
            return;
          }
          commentModeRef.current = true;
          setCommentMode(true);
          setSelectedCommentId(undefined);
          return;
        }
        default: {
          const unhandled: never = shortcut;
          return unhandled;
        }
      }
    },
    [
      addComment,
      apply,
      graphComments,
      graphRunActive,
      redoChange,
      removeComment,
      undoChange,
    ],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (event.key === "Escape" && commentModeRef.current) {
        event.preventDefault();
        commentModeRef.current = false;
        commentDrawGestureRef.current = undefined;
        setCommentMode(false);
        setCommentDraft(undefined);
        return;
      }
      const shortcut = resolveCanvasShortcut(event.nativeEvent);
      if (shortcut === null) {
        return;
      }
      // Tab is claimed only by the graph surface itself. Anywhere else inside the canvas
      // it keeps moving focus, so keyboard navigation is never trapped here.
      if (
        shortcut === "addNode" &&
        event.target !== surfaceRef.current &&
        !(
          event.target instanceof Element &&
          event.target.classList.contains("react-flow__pane")
        )
      ) {
        return;
      }
      event.preventDefault();
      runCanvasShortcut(shortcut);
    },
    [runCanvasShortcut],
  );

  const closeQuickAdd = useCallback(() => {
    setQuickAdd(undefined);
    surfaceRef.current?.focus();
  }, []);

  /** A connection released over empty canvas offers the nodes that could receive it. */
  const handleConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      useConnectionDragStore.getState().endDrag();
      const handle = connectionState.fromHandle;
      const registrySnapshot = currentRegistry();
      const editedGraph = currentGraph();
      if (
        connectionState.isValid === true ||
        !handle?.nodeId ||
        !handle.id ||
        !registrySnapshot ||
        !editedGraph
      ) {
        return;
      }
      const endpoint = resolveWorkflowGroupEndpoint(
        editedGraph,
        handle.nodeId,
        handle.id,
      );
      const node = editedGraph.nodes.find(
        (candidate) => candidate.nodeId === endpoint?.nodeId,
      );
      const port = node
        ? new NodeRegistryIndex(registrySnapshot)
            .find(node.typeKey)
            ?.ports.get(endpoint?.portId ?? "")
        : undefined;
      if (!node || !port) {
        return;
      }
      const companion =
        port.portKind === "data" && port.direction === "output"
          ? companionExecutionOutput(
              editedGraph,
              registrySnapshot,
              handle.nodeId,
            )
          : undefined;

      if (
        port.portKind === "execution" &&
        port.direction === "output" &&
        connectionState.toNode !== null
      ) {
        const target = canonicalExecutionInput(
          editedGraph,
          registrySnapshot,
          connectionState.toNode.id,
        );
        if (target !== undefined && endpoint !== undefined) {
          const candidate = {
            sourceNodeId: endpoint.nodeId,
            sourcePortId: endpoint.portId,
            targetNodeId: target.nodeId,
            targetPortId: target.portId,
          };
          const evaluation = connectionIndexFor(
            editedGraph,
            registrySnapshot,
            currentDocument(),
          ).evaluate(candidate);
          if (!evaluation.accepted) {
            notify({
              severity: "warning",
              titleKey: connectionRejectionKeys[evaluation.reason],
            });
            return;
          }
          apply(
            "graph.history.connect",
            buildConnectCommand(
              editedGraph.graphId,
              candidate,
              evaluation,
              createIdentifier,
            ),
          );
          return;
        }
      }

      // `connectionState.to` is in screen coordinates, not graph coordinates.
      // Convert to graph space using the same transform palette drops use.
      const screenPoint: { clientX: number; clientY: number } =
        event instanceof MouseEvent
          ? { clientX: event.clientX, clientY: event.clientY }
          : (() => {
              const touch = event.changedTouches[0];
              return touch !== undefined
                ? { clientX: touch.clientX, clientY: touch.clientY }
                : {
                    clientX: connectionState.to.x,
                    clientY: connectionState.to.y,
                  };
            })();
      const position = screenToCanvasPosition(
        screenPoint,
        readBounds(),
        getViewport(),
      );

      const repeatAction =
        endpoint !== undefined &&
        port.portKind === "execution" &&
        port.direction === "output" &&
        connectionState.toNode === null &&
        isRepeatHintFailurePort(handle.id, endpoint.portId)
          ? {
              graphId: editedGraph.graphId,
              source: {
                nodeId: endpoint.nodeId,
                portId: endpoint.portId,
              },
              position,
              target: recommendRepeatHintTarget(
                editedGraph,
                registrySnapshot,
                { nodeId: endpoint.nodeId, portId: endpoint.portId },
                position,
                flowNodesRef.current,
              ),
            }
          : undefined;

      setQuickAdd({
        position,
        connectFrom: {
          nodeId: node.nodeId,
          portId: endpoint?.portId ?? port.portId,
          type: port.type,
          portKind: port.portKind,
          direction: port.direction,
        },
        ...(companion === undefined
          ? {}
          : { companionExecutionFrom: companion }),
        ...(repeatAction === undefined ? {} : { repeatAction }),
      });
    },
    [apply, getViewport, readBounds],
  );

  const fullCanvasDetail = useStore(
    (state) => state.transform[2] >= FULL_CANVAS_DETAIL_MINIMUM_ZOOM,
  );
  const virtualizeCanvasElements = shouldVirtualizeCanvasElements(
    flowNodes.length + flowEdges.length,
    canvasPerformance.visibleElementThreshold,
  );

  return (
    <CanvasContextMenu
      toGraphPosition={pointerGraphPosition}
      onRemoveSelection={() => {
        runCanvasShortcut("remove");
      }}
      onDuplicateSelection={() => {
        runCanvasShortcut("duplicate");
      }}
      onPaste={() => {
        runCanvasShortcut("paste");
      }}
      canResolveOverlaps={
        flowNodes.length >= 2 && !graphRunActive && !executionLocked
      }
      onResolveOverlaps={() => {
        const result = resolveOverlappingNodes(false);
        if (result.status === "locked" || result.status === "commandRejected") {
          notifyOverlapLayoutFailure(result);
        }
      }}
    >
      <div
        ref={surfaceRef}
        className="graph-canvas"
        data-performance-profile={performanceProfile}
        data-comment-mode={commentMode ? "true" : undefined}
        tabIndex={0}
        aria-label={t("graph.canvas.surfaceLabel")}
        onKeyDown={handleKeyDown}
        onWheelCapture={handleWheelCapture}
        onContextMenuCapture={handleContextMenuCapture}
        onPointerDownCapture={handlePointerDownCapture}
        onPointerMoveCapture={handlePointerMoveCapture}
        onPointerUpCapture={(event) => {
          finishPointerGesture(event, true);
        }}
        onPointerCancelCapture={(event) => {
          finishPointerGesture(event, false);
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ReactFlow<RinoFlowNode, RinoFlowEdge>
          nodes={flowNodes}
          edges={flowEdges}
          nodesDraggable={!graphRunActive}
          nodesConnectable={!graphRunActive}
          edgesReconnectable={!graphRunActive}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={handleNodeDragStop}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onNodeDoubleClick={handleNodeDoubleClick}
          onReconnect={handleReconnect}
          onReconnectStart={handleReconnectStart}
          onReconnectEnd={handleReconnectEnd}
          onMoveStart={handleViewportMoveStart}
          onMoveEnd={handleViewportMoveEnd}
          onInit={handleInit}
          isValidConnection={isValidConnection}
          onSelectionChange={handleSelectionChange}
          selectionOnDrag
          selectionMode={SelectionMode.Partial}
          panOnDrag={PAN_BUTTONS}
          panActivationKeyCode="Space"
          multiSelectionKeyCode={MULTI_SELECTION_KEYS}
          selectionKeyCode="Shift"
          deleteKeyCode={null}
          minZoom={MINIMUM_CANVAS_ZOOM}
          maxZoom={MAXIMUM_CANVAS_ZOOM}
          zoomOnScroll={false}
          zoomOnPinch={false}
          onlyRenderVisibleElements={virtualizeCanvasElements}
          proOptions={PRO_OPTIONS}
          aria-label={t("graph.canvas.label")}
        >
          <CanvasDetailInternalsSynchronizer fullDetail={fullCanvasDetail} />
          <Background
            id="minor"
            variant={BackgroundVariant.Dots}
            gap={MINOR_GRID_GAP}
            size={1}
            className="graph-canvas__grid graph-canvas__grid--minor"
          />
          <Background
            id="major"
            variant={BackgroundVariant.Dots}
            gap={MAJOR_GRID_GAP}
            size={1.6}
            className="graph-canvas__grid graph-canvas__grid--major"
          />
          <GraphCommentLayer
            comments={graphComments}
            {...(commentDraft === undefined ? {} : { draft: commentDraft })}
            editable={!graphRunActive}
            {...(selectedCommentId === undefined ? {} : { selectedCommentId })}
            onSelect={setSelectedCommentId}
            onReplace={replaceComment}
            onRemove={removeComment}
          />
        </ReactFlow>
        <ConnectionFeedback
          graph={graph}
          {...(activeDocument === undefined
            ? {}
            : { document: activeDocument })}
          registry={registry}
          readBounds={readBounds}
        />
        {dropPreview ? (
          <div
            className="graph-canvas__drop-preview"
            style={dropPreview}
            aria-hidden="true"
          />
        ) : null}
        {variableDropRequest ? (
          <div
            ref={variableDropMenuRef}
            className="graph-canvas__variable-drop-menu"
            role="menu"
            aria-label={t("graph.variable.library.insertMenuLabel")}
            style={{
              left: String(variableDropRequest.menuPosition.x) + "px",
              top: String(variableDropRequest.menuPosition.y) + "px",
            }}
            onKeyDown={handleVariableDropMenuKeyDown}
          >
            {VARIABLE_DROP_ACTIONS.map((role, index) => (
              <button
                key={role}
                ref={(element) => {
                  variableDropMenuItemsRef.current[index] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={index === variableDropActionIndex ? 0 : -1}
                className="graph-canvas__variable-drop-action"
                onClick={() => {
                  chooseVariableDropRole(role);
                }}
              >
                <ProductIcon icon="node.variable" size="small" />
                <span>
                  {t(
                    role === "getter"
                      ? "graph.variable.library.insertGetter"
                      : "graph.variable.library.insertSetter",
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <QuickAddPanel request={quickAdd} onClose={closeQuickAdd} />
      </div>
    </CanvasContextMenu>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphCanvasSurface />
    </ReactFlowProvider>
  );
}
