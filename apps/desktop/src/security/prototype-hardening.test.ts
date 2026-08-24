import { describe, expect, it } from "vitest";

import { hardenObjectPrototype } from "./prototype-hardening";

describe("object prototype hardening", () => {
  it("freezes the selected prototype without mutating the test realm", () => {
    const isolatedPrototype = {};

    hardenObjectPrototype(isolatedPrototype);

    expect(Object.isFrozen(isolatedPrototype)).toBe(true);
    expect(Object.isFrozen(Object.prototype)).toBe(false);
  });
});
