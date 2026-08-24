import { describe, expect, it } from "vitest";

import {
  portAppearance,
  portColorVariable,
  requiresTypeLabel,
} from "./port-appearance";

describe("port appearance", () => {
  it("gives every primitive type its own colour and a value shape", () => {
    expect(portAppearance({ kind: "exec" })).toEqual({
      colorRole: "execution",
      shape: "execution",
    });
    expect(portAppearance({ kind: "bool" }).colorRole).toBe("boolean");
    expect(portAppearance({ kind: "number" }).colorRole).toBe("number");
    expect(portAppearance({ kind: "string" }).colorRole).toBe("string");
    expect(portAppearance({ kind: "imageRef" }).colorRole).toBe("image");
    expect(portAppearance({ kind: "point" }).colorRole).toBe("spatial");
    expect(portAppearance({ kind: "rect" }).colorRole).toBe("spatial");
  });

  it("keeps the element colour of a collection and marks the wrapper by shape", () => {
    expect(
      portAppearance({ kind: "collection", element: { kind: "number" } }),
    ).toEqual({ colorRole: "number", shape: "collection" });
  });

  it("falls back to the collection colour when the element has no hue of its own", () => {
    expect(
      portAppearance({ kind: "collection", element: { kind: "ocrCandidate" } }),
    ).toEqual({ colorRole: "collection", shape: "collection" });
  });

  it("marks an optional through shape while keeping the value colour", () => {
    expect(
      portAppearance({ kind: "optional", value: { kind: "rect" } }),
    ).toEqual({
      colorRole: "spatial",
      shape: "optionalValue",
    });
    expect(
      portAppearance({
        kind: "optional",
        value: { kind: "collection", element: { kind: "string" } },
      }),
    ).toEqual({ colorRole: "string", shape: "optionalCollection" });
  });

  it("requires a written type only where the colour covers a family of types", () => {
    expect(requiresTypeLabel("unknown")).toBe(true);
    expect(requiresTypeLabel("collection")).toBe(true);
    expect(requiresTypeLabel("number")).toBe(false);
    expect(requiresTypeLabel("execution")).toBe(false);
  });

  it("resolves the colour to a semantic theme token rather than a literal colour", () => {
    expect(portColorVariable({ kind: "bool" })).toBe("--port-boolean");
    expect(
      portColorVariable({ kind: "collection", element: { kind: "ocrResult" } }),
    ).toBe("--port-collection");
  });
});
