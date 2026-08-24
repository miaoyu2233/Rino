import { afterEach, describe, expect, it } from "vitest";

import {
  clearDragPayload,
  FUNCTION_DRAG_FORMAT,
  IMAGE_ASSET_DRAG_FORMAT,
  readDragKinds,
  readDragPayload,
  VARIABLE_DRAG_FORMAT,
  writeDragPayload,
} from "./canvas-drag";

const FUNCTION_GRAPH_ID = "10000000-0000-4000-8000-000000000001";
const VARIABLE_ID = "10000000-0000-4000-8000-000000000002";

function transferStub(): {
  get types(): string[];
  getData: (format: string) => string;
  setData: (format: string, value: string) => void;
} {
  const values = new Map<string, string>();
  return {
    get types() {
      return [...values.keys()];
    },
    getData: (format: string) => values.get(format) ?? "",
    setData: (format: string, value: string) => {
      values.set(format, value);
    },
  };
}

describe("canvas drag payloads", () => {
  afterEach(() => {
    clearDragPayload();
  });

  it("round-trips a project screenshot through its private media type", () => {
    const transfer = transferStub();

    writeDragPayload(transfer, { kind: "asset", key: "asset-id" });

    expect(transfer.getData(IMAGE_ASSET_DRAG_FORMAT)).toBe("asset-id");
    expect(readDragKinds(transfer)).toBe("asset");
    expect(readDragPayload(transfer)).toEqual({
      kind: "asset",
      key: "asset-id",
    });
  });

  it("round-trips function and variable references without role fields", () => {
    const functionTransfer = transferStub();
    writeDragPayload(functionTransfer, {
      kind: "function",
      functionGraphId: FUNCTION_GRAPH_ID,
    });
    expect(readDragKinds(functionTransfer)).toBe("function");
    expect(readDragPayload(functionTransfer)).toEqual({
      kind: "function",
      functionGraphId: FUNCTION_GRAPH_ID,
    });
    expect(
      JSON.parse(functionTransfer.getData(FUNCTION_DRAG_FORMAT)) as unknown,
    ).toEqual({
      kind: "function",
      functionGraphId: FUNCTION_GRAPH_ID,
    });

    const variableTransfer = transferStub();
    writeDragPayload(variableTransfer, {
      kind: "variable",
      variableId: VARIABLE_ID,
    });
    expect(readDragKinds(variableTransfer)).toBe("variable");
    expect(readDragPayload(variableTransfer)).toEqual({
      kind: "variable",
      variableId: VARIABLE_ID,
    });
    expect(
      JSON.parse(variableTransfer.getData(VARIABLE_DRAG_FORMAT)) as unknown,
    ).toEqual({
      kind: "variable",
      variableId: VARIABLE_ID,
    });
  });

  it("rejects unknown fields and invalid identifiers in structured payloads", () => {
    const unknownField = transferStub();
    unknownField.setData(
      FUNCTION_DRAG_FORMAT,
      JSON.stringify({
        kind: "function",
        functionGraphId: FUNCTION_GRAPH_ID,
        role: "get",
      }),
    );
    expect(readDragPayload(unknownField)).toBeUndefined();

    const invalidVariable = transferStub();
    invalidVariable.setData(
      VARIABLE_DRAG_FORMAT,
      JSON.stringify({ kind: "variable", variableId: "not-a-uuid" }),
    );
    expect(readDragPayload(invalidVariable)).toBeUndefined();

    const malformed = transferStub();
    malformed.setData(FUNCTION_DRAG_FORMAT, "{not-json");
    expect(readDragPayload(malformed)).toBeUndefined();
  });
});
