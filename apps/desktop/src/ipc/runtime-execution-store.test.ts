import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeEvent } from "./runtime-contract";
import { useRuntimeExecutionStore } from "./runtime-execution-store";

const GENERATION = 1;
const REGISTRY_VERSION = "1.0.0";
const GRAPH_ID = "90000000-0000-4000-8000-000000000004";
const OTHER_GRAPH_ID = "90000000-0000-4000-8000-000000000005";
const RUN_ID = "90000000-0000-4000-8000-000000000006";
const OTHER_RUN_ID = "90000000-0000-4000-8000-000000000007";
const NODE_ID = "90000000-0000-4000-8000-000000000010";
const FIRST_EDGE_ID = "90000000-0000-4000-8000-000000000012";
const SECOND_EDGE_ID = "90000000-0000-4000-8000-000000000014";

function event(
  messageType: string,
  payload: Record<string, unknown>,
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return {
    generation: GENERATION,
    messageType,
    eventId: "90000000-0000-4000-8000-000000000008",
    sequence: 1,
    runId: RUN_ID,
    nodeId: NODE_ID,
    payload,
    ...overrides,
  };
}

function beginAcceptedRun(): ReturnType<
  typeof useRuntimeExecutionStore.getState
> {
  const store = useRuntimeExecutionStore.getState();
  store.beginRun(GRAPH_ID, GENERATION);
  expect(
    store.acceptRun(
      {
        accepted: true,
        runId: RUN_ID,
        graphId: GRAPH_ID,
        registryVersion: REGISTRY_VERSION,
      },
      GENERATION,
    ),
  ).toBe(true);
  return store;
}

beforeEach(() => {
  useRuntimeExecutionStore.getState().reset();
});

describe("runtime execution projection", () => {
  it("accepts events only after the run response binds the exact generation and run", () => {
    const store = useRuntimeExecutionStore.getState();
    store.beginRun(GRAPH_ID, GENERATION);

    store.applyEvent(
      event("node.stateChanged", {
        state: "running",
        runSequence: 1,
        tokenId: 1,
        activationId: 1,
      }),
    );
    expect(useRuntimeExecutionStore.getState().nodeStates).toEqual({});

    expect(
      store.acceptRun(
        {
          accepted: true,
          runId: RUN_ID,
          graphId: GRAPH_ID,
          registryVersion: REGISTRY_VERSION,
        },
        GENERATION,
      ),
    ).toBe(true);
    store.applyEvent(
      event("node.stateChanged", {
        state: "running",
        runSequence: 1,
        tokenId: 1,
        activationId: 1,
      }),
    );
    store.applyEvent(
      event(
        "node.stateChanged",
        {
          state: "failed",
          runSequence: 2,
          tokenId: 1,
          activationId: 2,
          errorCode: "SHOULD_BE_IGNORED",
        },
        { runId: OTHER_RUN_ID, sequence: 2 },
      ),
    );
    store.applyEvent(
      event(
        "node.stateChanged",
        {
          state: "failed",
          runSequence: 3,
          tokenId: 1,
          activationId: 3,
          errorCode: "STALE_GENERATION",
        },
        { generation: GENERATION + 1, sequence: 3 },
      ),
    );

    const state = useRuntimeExecutionStore.getState();
    expect(state.run).toMatchObject({
      generation: GENERATION,
      runId: RUN_ID,
      state: "running",
      lastEventSequence: 1,
    });
    expect(state.nodeStates[NODE_ID]).toMatchObject({
      state: "running",
      runSequence: 1,
    });
  });

  it("does not let a stale start result or failure mutate a replacement generation", () => {
    const store = useRuntimeExecutionStore.getState();
    store.beginRun(GRAPH_ID, GENERATION + 1);

    expect(
      store.acceptRun(
        {
          accepted: true,
          runId: RUN_ID,
          graphId: GRAPH_ID,
          registryVersion: REGISTRY_VERSION,
        },
        GENERATION,
      ),
    ).toBe(false);
    expect(store.failToStart(GENERATION)).toBe(false);
    expect(useRuntimeExecutionStore.getState().run).toMatchObject({
      generation: GENERATION + 1,
      state: "starting",
    });
  });

  it("keeps only the current edge active and freezes the path on completion", () => {
    const store = beginAcceptedRun();
    store.applyEvent(
      event("edge.traversed", {
        edgeId: FIRST_EDGE_ID,
        runSequence: 1,
        tokenId: 1,
        outputPortId: "next",
      }),
    );
    store.applyEvent(
      event(
        "edge.traversed",
        {
          edgeId: SECOND_EDGE_ID,
          runSequence: 2,
          tokenId: 1,
          outputPortId: "next",
        },
        { sequence: 2 },
      ),
    );

    expect(useRuntimeExecutionStore.getState().edgeActivity).toEqual(
      new Map([
        [FIRST_EDGE_ID, "traversed"],
        [SECOND_EDGE_ID, "active"],
      ]),
    );

    store.applyEvent(
      event(
        "run.stateChanged",
        {
          state: "succeeded",
          graphId: GRAPH_ID,
          runSequence: 3,
          stepCount: 2,
          tokensCreated: 1,
          pureCacheHits: 0,
        },
        { sequence: 3 },
      ),
    );

    const completed = useRuntimeExecutionStore.getState();
    expect(completed.run?.state).toBe("succeeded");
    expect(completed.activeEdgeId).toBeUndefined();
    expect(completed.edgeActivity.get(SECOND_EDGE_ID)).toBe("traversed");
  });

  it("rejects a run-state event for another graph", () => {
    const store = beginAcceptedRun();
    store.applyEvent(
      event("run.stateChanged", {
        state: "failed",
        graphId: OTHER_GRAPH_ID,
        terminalError: { code: "WRONG_GRAPH", messageKey: "wrong.graph" },
      }),
    );

    expect(useRuntimeExecutionStore.getState().run).toMatchObject({
      state: "running",
      lastEventSequence: 0,
    });
  });

  it("preserves repeated node activations in first-execution order", () => {
    const store = beginAcceptedRun();
    store.applyEvents([
      event("node.stateChanged", {
        state: "running",
        runSequence: 1,
        tokenId: 1,
        activationId: 1,
      }),
      event(
        "node.stateChanged",
        {
          state: "succeeded",
          runSequence: 2,
          tokenId: 1,
          activationId: 1,
        },
        { sequence: 2 },
      ),
      event(
        "node.stateChanged",
        {
          state: "running",
          runSequence: 3,
          tokenId: 2,
          activationId: 2,
        },
        { sequence: 3 },
      ),
    ]);

    const state = useRuntimeExecutionStore.getState();
    expect(state.activations).toHaveLength(2);
    expect(state.activations[0]).toMatchObject({
      state: "succeeded",
      firstRunSequence: 1,
      runSequence: 2,
      activationId: 1,
    });
    expect(state.activations[1]).toMatchObject({
      state: "running",
      firstRunSequence: 3,
      activationId: 2,
    });
    expect(state.nodeStates[NODE_ID]).toMatchObject({
      state: "running",
      activationId: 2,
    });
  });

  it("applies a frame of ordered events in one store notification", () => {
    const store = beginAcceptedRun();
    const listener = vi.fn();
    const unsubscribe = useRuntimeExecutionStore.subscribe(listener);

    store.applyEvents([
      event("node.stateChanged", {
        state: "running",
        runSequence: 1,
        tokenId: 1,
        activationId: 1,
      }),
      event(
        "node.stateChanged",
        {
          state: "succeeded",
          runSequence: 2,
          tokenId: 1,
          activationId: 1,
        },
        { sequence: 2 },
      ),
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("projects node values and bounded runtime logs", () => {
    const store = beginAcceptedRun();
    store.applyEvent(
      event("node.stateChanged", {
        state: "succeeded",
        runSequence: 1,
        tokenId: 2,
        activationId: 2,
        outputPortIds: ["text"],
        valueSummaries: [
          {
            portId: "text",
            generation: 1,
            kind: "string",
            preview: "42",
            truncated: false,
          },
        ],
      }),
    );

    const logEvents = Array.from({ length: 1_001 }, (_, offset) => {
      const logSequence = offset + 1;
      return event(
        "runtime.logCreated",
        {
          logSequence,
          activationId: 2,
          level: "info",
          message: `Log ${String(logSequence)}`,
        },
        { sequence: logSequence + 1 },
      );
    });
    store.applyEvents(logEvents);

    const state = useRuntimeExecutionStore.getState();
    expect(state.nodeStates[NODE_ID]?.valueSummaries[0]).toMatchObject({
      portId: "text",
      preview: "42",
    });
    expect(state.logs).toHaveLength(1_000);
    expect(state.logs[0]?.logSequence).toBe(2);
    expect(state.logs.at(-1)?.logSequence).toBe(1_001);
  });
});
