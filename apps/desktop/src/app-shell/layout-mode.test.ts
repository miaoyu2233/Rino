import { describe, expect, it } from "vitest";

import { resolveApplicationLayoutMode } from "./layout-mode";

describe("application layout mode", () => {
  it("selects deterministic responsive modes", () => {
    expect(resolveApplicationLayoutMode(849)).toBe("narrow");
    expect(resolveApplicationLayoutMode(850)).toBe("compact");
    expect(resolveApplicationLayoutMode(1159)).toBe("compact");
    expect(resolveApplicationLayoutMode(1160)).toBe("wide");
  });
});
