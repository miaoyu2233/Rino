import { beforeEach, describe, expect, it } from "vitest";

import {
  consumePersistentVariableRun,
  currentPersistentVariableRun,
  registerPersistentVariableRun,
  resetPersistentVariableRunContext,
} from "./persistent-variable-run-context";

const RUN_ID = "62000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "62000000-0000-4000-8000-000000000002";
const GRAPH_ID = "62000000-0000-4000-8000-000000000003";
const OTHER_GRAPH_ID = "62000000-0000-4000-8000-000000000004";
const VARIABLE_ID = "62000000-0000-4000-8000-000000000005";

beforeEach(() => {
  resetPersistentVariableRunContext();
});

function registration() {
  return {
    runId: RUN_ID,
    documentId: DOCUMENT_ID,
    graphId: GRAPH_ID,
    generation: 1,
    variables: [{ variableId: VARIABLE_ID, valueKind: "number" as const }],
  };
}

describe("persistent variable run context", () => {
  it("accepts one run and consumes it only once", () => {
    expect(registerPersistentVariableRun(registration())).toBe(true);
    expect(consumePersistentVariableRun(RUN_ID, GRAPH_ID, 1)).toMatchObject({
      status: "accepted",
    });
    expect(consumePersistentVariableRun(RUN_ID, GRAPH_ID, 1)).toEqual({
      status: "ignored",
    });
  });

  it("rejects a graph mismatch and clears the context", () => {
    expect(registerPersistentVariableRun(registration())).toBe(true);
    expect(consumePersistentVariableRun(RUN_ID, OTHER_GRAPH_ID, 1)).toEqual({
      status: "invalid",
      reason: "graphIdMismatch",
    });
    expect(currentPersistentVariableRun()).toBeUndefined();
  });

  it("rejects a stale generation and clears the context", () => {
    expect(registerPersistentVariableRun(registration())).toBe(true);
    expect(consumePersistentVariableRun(RUN_ID, GRAPH_ID, 2)).toEqual({
      status: "invalid",
      reason: "generationMismatch",
    });
    expect(currentPersistentVariableRun()).toBeUndefined();
  });

  it("keeps an unrelated run from consuming the accepted context", () => {
    expect(registerPersistentVariableRun(registration())).toBe(true);
    expect(
      consumePersistentVariableRun(
        "62000000-0000-4000-8000-000000000099",
        GRAPH_ID,
        1,
      ),
    ).toEqual({ status: "ignored" });
    expect(currentPersistentVariableRun()).toBeDefined();
  });
});
