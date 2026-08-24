import type {
  EdgeTraversedEventPayloadV1,
  NodeStateChangedEventPayloadV1,
  RunStartResultV1,
  RunStateChangedEventPayloadV1,
  RuntimeLogCreatedEventPayloadV1,
  RuntimeTerminalErrorV1,
  RuntimeValueSummaryV1,
} from "@rino/contracts";
import { create } from "zustand";

import type { EdgeActivityMap } from "../graph/canvas/graph-view-model";
import type { RuntimeEvent } from "./runtime-contract";

const MAXIMUM_VISIBLE_LOGS = 1_000;
const MAXIMUM_VISIBLE_ACTIVATIONS = 10_000;

const EXECUTION_PRESENTATION_EVENT_TYPES = new Set([
  "run.stateChanged",
  "node.stateChanged",
  "edge.traversed",
  "runtime.logCreated",
]);

export type GraphRunState =
  "starting" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";

export type TerminalGraphRunState = Extract<
  GraphRunState,
  "succeeded" | "failed" | "cancelled"
>;

export interface GraphRunView {
  generation: number;
  graphId: string;
  runId: string | undefined;
  state: GraphRunState;
  stepCount: number | undefined;
  tokensCreated: number | undefined;
  pureCacheHits: number | undefined;
  terminalError: RuntimeTerminalErrorV1 | undefined;
  lastEventSequence: number;
}

export interface NodeExecutionView {
  state: NodeStateChangedEventPayloadV1["state"];
  runSequence: number;
  tokenId: number;
  activationId: number;
  valueSummaries: readonly RuntimeValueSummaryV1[];
  errorCode: string | undefined;
}

export interface NodeActivationView extends NodeExecutionView {
  nodeId: string;
  firstRunSequence: number;
  eventSequence: number;
}

export interface RuntimeLogView extends RuntimeLogCreatedEventPayloadV1 {
  nodeId: string;
}

interface RuntimeExecutionData {
  run: GraphRunView | undefined;
  nodeStates: Readonly<Record<string, NodeExecutionView>>;
  activations: readonly NodeActivationView[];
  activationIndexByKey: ReadonlyMap<string, number>;
  edgeActivity: EdgeActivityMap;
  activeEdgeId: string | undefined;
  logs: readonly RuntimeLogView[];
}

interface RuntimeExecutionState extends RuntimeExecutionData {
  beginRun: (graphId: string, generation: number) => void;
  acceptRun: (result: RunStartResultV1, generation: number) => boolean;
  failToStart: (generation: number) => boolean;
  applyEvent: (event: RuntimeEvent) => void;
  applyEvents: (events: readonly RuntimeEvent[]) => void;
  reset: () => void;
}

const EMPTY_EDGE_ACTIVITY: EdgeActivityMap = new Map();

function emptyExecutionData(): RuntimeExecutionData {
  return {
    run: undefined,
    nodeStates: {},
    activations: [],
    activationIndexByKey: new Map(),
    edgeActivity: new Map(),
    activeEdgeId: undefined,
    logs: [],
  };
}

export function isGraphRunTerminal(
  state: string,
): state is TerminalGraphRunState {
  return state === "succeeded" || state === "failed" || state === "cancelled";
}

export function isExecutionPresentationEvent(event: RuntimeEvent): boolean {
  return EXECUTION_PRESENTATION_EVENT_TYPES.has(event.messageType);
}

function belongsToRun(
  run: GraphRunView | undefined,
  event: RuntimeEvent,
): run is GraphRunView {
  return (
    run?.runId !== undefined &&
    event.runId === run.runId &&
    event.generation === run.generation &&
    event.sequence > run.lastEventSequence
  );
}

function activationKey(
  nodeId: string,
  tokenId: number,
  activationId: number,
): string {
  return `${nodeId}:${String(tokenId)}:${String(activationId)}`;
}

function appendActivation(
  state: RuntimeExecutionData,
  activation: NodeActivationView,
): Pick<RuntimeExecutionData, "activations" | "activationIndexByKey"> {
  const key = activationKey(
    activation.nodeId,
    activation.tokenId,
    activation.activationId,
  );
  const existingIndex = state.activationIndexByKey.get(key);
  if (existingIndex !== undefined) {
    const existing = state.activations[existingIndex];
    if (
      existing === undefined ||
      activation.runSequence < existing.runSequence
    ) {
      return {
        activations: state.activations,
        activationIndexByKey: state.activationIndexByKey,
      };
    }
    const activations = [...state.activations];
    activations[existingIndex] = {
      ...activation,
      firstRunSequence: existing.firstRunSequence,
    };
    return { activations, activationIndexByKey: state.activationIndexByKey };
  }

  if (state.activations.length < MAXIMUM_VISIBLE_ACTIVATIONS) {
    const activationIndexByKey = new Map(state.activationIndexByKey);
    activationIndexByKey.set(key, state.activations.length);
    return {
      activations: [...state.activations, activation],
      activationIndexByKey,
    };
  }

  const activations = [...state.activations.slice(1), activation];
  const activationIndexByKey = new Map<string, number>();
  activations.forEach((item, index) => {
    activationIndexByKey.set(
      activationKey(item.nodeId, item.tokenId, item.activationId),
      index,
    );
  });
  return { activations, activationIndexByKey };
}

function applyEventToProjection(
  state: RuntimeExecutionData,
  event: RuntimeEvent,
): RuntimeExecutionData {
  if (!belongsToRun(state.run, event)) {
    return state;
  }

  const run = { ...state.run, lastEventSequence: event.sequence };
  switch (event.messageType) {
    case "run.stateChanged": {
      const payload = event.payload as unknown as RunStateChangedEventPayloadV1;
      if (payload.graphId !== run.graphId) {
        return state;
      }
      const edgeActivity = new Map(state.edgeActivity);
      if (isGraphRunTerminal(payload.state)) {
        for (const [edgeId, activity] of edgeActivity) {
          if (activity === "active") {
            edgeActivity.set(edgeId, "traversed");
          }
        }
      }
      return {
        ...state,
        run: {
          ...run,
          state: payload.state,
          stepCount: payload.stepCount,
          tokensCreated: payload.tokensCreated,
          pureCacheHits: payload.pureCacheHits,
          terminalError: payload.terminalError,
        },
        edgeActivity,
        activeEdgeId: isGraphRunTerminal(payload.state)
          ? undefined
          : state.activeEdgeId,
      };
    }
    case "node.stateChanged": {
      if (event.nodeId === undefined) {
        return state;
      }
      const payload =
        event.payload as unknown as NodeStateChangedEventPayloadV1;
      const nodeView: NodeExecutionView = {
        state: payload.state,
        runSequence: payload.runSequence,
        tokenId: payload.tokenId,
        activationId: payload.activationId,
        valueSummaries: payload.valueSummaries ?? [],
        errorCode: payload.errorCode,
      };
      const activation = appendActivation(state, {
        nodeId: event.nodeId,
        firstRunSequence: payload.runSequence,
        eventSequence: event.sequence,
        ...nodeView,
      });
      return {
        ...state,
        run,
        nodeStates: { ...state.nodeStates, [event.nodeId]: nodeView },
        ...activation,
      };
    }
    case "edge.traversed": {
      const payload = event.payload as unknown as EdgeTraversedEventPayloadV1;
      const edgeActivity = new Map(state.edgeActivity);
      if (state.activeEdgeId !== undefined) {
        edgeActivity.set(state.activeEdgeId, "traversed");
      }
      edgeActivity.set(payload.edgeId, "active");
      return {
        ...state,
        run,
        edgeActivity,
        activeEdgeId: payload.edgeId,
      };
    }
    case "runtime.logCreated": {
      if (event.nodeId === undefined) {
        return state;
      }
      const payload =
        event.payload as unknown as RuntimeLogCreatedEventPayloadV1;
      return {
        ...state,
        run,
        logs: [...state.logs, { ...payload, nodeId: event.nodeId }].slice(
          -MAXIMUM_VISIBLE_LOGS,
        ),
      };
    }
    default:
      return state;
  }
}

export const useRuntimeExecutionStore = create<RuntimeExecutionState>(
  (set, get) => ({
    ...emptyExecutionData(),
    beginRun: (graphId, generation) => {
      set({
        ...emptyExecutionData(),
        run: {
          generation,
          graphId,
          runId: undefined,
          state: "starting",
          stepCount: undefined,
          tokensCreated: undefined,
          pureCacheHits: undefined,
          terminalError: undefined,
          lastEventSequence: 0,
        },
      });
    },
    acceptRun: (result, generation) => {
      const current = get().run;
      if (
        current?.generation !== generation ||
        current.graphId !== result.graphId ||
        current.state !== "starting"
      ) {
        return false;
      }
      set({
        run: {
          ...current,
          runId: result.runId,
          state: "running",
        },
      });
      return true;
    },
    failToStart: (generation) => {
      const current = get().run;
      if (current?.generation !== generation || current.state !== "starting") {
        return false;
      }
      set(emptyExecutionData());
      return true;
    },
    applyEvent: (event) => {
      set((state) => applyEventToProjection(state, event));
    },
    applyEvents: (events) => {
      if (events.length === 0) {
        return;
      }
      set((state) => {
        let projection: RuntimeExecutionData = state;
        for (const event of events) {
          projection = applyEventToProjection(projection, event);
        }
        return projection;
      });
    },
    reset: () => {
      set(emptyExecutionData());
    },
  }),
);

export function isGraphRunActive(state: GraphRunState | undefined): boolean {
  return state === "starting" || state === "running" || state === "cancelling";
}

export function useNodeExecutionView(
  graphId: string,
  nodeId: string,
): NodeExecutionView | undefined {
  return useRuntimeExecutionStore((state) => {
    if (state.run?.graphId !== graphId) {
      return undefined;
    }
    const node = state.nodeStates[nodeId];
    return node?.state === "running" && !isGraphRunActive(state.run.state)
      ? undefined
      : node;
  });
}

export { EMPTY_EDGE_ACTIVITY };
