import { describe, expect, it } from "vitest";

import {
  ProjectCommandError,
  toProjectCommandError,
} from "./project-transport";

describe("normalizing a desktop rejection", () => {
  it("keeps a structured project failure", () => {
    const normalized = toProjectCommandError({
      code: "WRITE_FAILED",
      detail: "commitReplace",
    });

    expect(normalized).toBeInstanceOf(ProjectCommandError);
    expect(normalized.code).toBe("WRITE_FAILED");
    expect(normalized.detail).toBe("commitReplace");
  });

  it("passes an already normalized failure through", () => {
    const original = new ProjectCommandError("READ_FAILED", "manifest");

    expect(toProjectCommandError(original)).toBe(original);
  });

  it("falls back when the shell rejects without a recognized code", () => {
    for (const cause of [undefined, "boom", { code: "SOMETHING_ELSE" }, {}]) {
      expect(toProjectCommandError(cause).code).toBe("DESKTOP_COMMAND_FAILED");
    }
  });
});
