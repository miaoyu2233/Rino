import type { TypeDescriptorV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import { describeType, isAssignable } from "./type-compatibility";

const NUMBER: TypeDescriptorV1 = { kind: "number" };
const STRING: TypeDescriptorV1 = { kind: "string" };
const BOOLEAN: TypeDescriptorV1 = { kind: "bool" };
const EXEC: TypeDescriptorV1 = { kind: "exec" };

function collectionOf(element: TypeDescriptorV1): TypeDescriptorV1 {
  return { kind: "collection", element };
}

function optionalOf(value: TypeDescriptorV1): TypeDescriptorV1 {
  return { kind: "optional", value };
}

describe("primitive assignability", () => {
  it("accepts a type flowing into its own kind", () => {
    expect(isAssignable(NUMBER, NUMBER)).toBe(true);
    expect(isAssignable(STRING, STRING)).toBe(true);
  });

  it("rejects every implicit conversion between primitives", () => {
    expect(isAssignable(NUMBER, STRING)).toBe(false);
    expect(isAssignable(STRING, NUMBER)).toBe(false);
    expect(isAssignable(BOOLEAN, NUMBER)).toBe(false);
    expect(isAssignable(NUMBER, BOOLEAN)).toBe(false);
  });
});

describe("execution assignability", () => {
  it("connects execution only to execution", () => {
    expect(isAssignable(EXEC, EXEC)).toBe(true);
    expect(isAssignable(EXEC, NUMBER)).toBe(false);
    expect(isAssignable(NUMBER, EXEC)).toBe(false);
  });

  it("never lets an optional or a collection stand in for execution", () => {
    expect(isAssignable(optionalOf(EXEC), EXEC)).toBe(false);
    expect(isAssignable(collectionOf(EXEC), EXEC)).toBe(false);
  });
});

describe("optional assignability", () => {
  it("accepts a value entering an optional input", () => {
    expect(isAssignable(NUMBER, optionalOf(NUMBER))).toBe(true);
    expect(isAssignable(optionalOf(NUMBER), optionalOf(NUMBER))).toBe(true);
  });

  it("rejects an optional satisfying a required input", () => {
    // The absent case has to be handled explicitly rather than reaching a node that
    // assumes a value is present.
    expect(isAssignable(optionalOf(NUMBER), NUMBER)).toBe(false);
  });

  it("still checks the value type inside an optional", () => {
    expect(isAssignable(STRING, optionalOf(NUMBER))).toBe(false);
    expect(isAssignable(optionalOf(STRING), optionalOf(NUMBER))).toBe(false);
  });
});

describe("collection assignability", () => {
  it("accepts matching element types", () => {
    expect(isAssignable(collectionOf(NUMBER), collectionOf(NUMBER))).toBe(true);
  });

  it("rejects mismatched element types", () => {
    expect(isAssignable(collectionOf(NUMBER), collectionOf(STRING))).toBe(
      false,
    );
  });

  it("is covariant in its element", () => {
    expect(
      isAssignable(collectionOf(NUMBER), collectionOf(optionalOf(NUMBER))),
    ).toBe(true);
  });

  it("does not unwrap a collection into its element", () => {
    expect(isAssignable(collectionOf(NUMBER), NUMBER)).toBe(false);
    expect(isAssignable(NUMBER, collectionOf(NUMBER))).toBe(false);
  });

  it("compares nested collections by depth", () => {
    expect(
      isAssignable(
        collectionOf(collectionOf(NUMBER)),
        collectionOf(collectionOf(NUMBER)),
      ),
    ).toBe(true);
    expect(
      isAssignable(collectionOf(collectionOf(NUMBER)), collectionOf(NUMBER)),
    ).toBe(false);
  });
});

describe("type descriptions", () => {
  it("renders generic types the way a port label shows them", () => {
    expect(describeType(NUMBER)).toBe("number");
    expect(describeType(collectionOf(NUMBER))).toBe("collection<number>");
    expect(describeType(optionalOf(collectionOf(STRING)))).toBe(
      "optional<collection<string>>",
    );
  });
});
