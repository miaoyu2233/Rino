import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isValidMessage,
  isValidPayload,
  isValidProjectDocument,
} from "./validation";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

interface CaptureRequestFixture {
  readonly payload: unknown;
}

function readFixture(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(resolve(repositoryRoot, relativePath), "utf8"),
  ) as unknown;
}

function withUnsafeEvalBlocked<T>(action: () => T): T {
  const globalObject = globalThis as typeof globalThis & {
    Function: FunctionConstructor;
  };
  const originalFunction = globalObject.Function;

  function blockedFunction(): never {
    throw new EvalError("unsafe-eval is blocked");
  }

  globalObject.Function = blockedFunction as unknown as FunctionConstructor;
  try {
    return action();
  } finally {
    globalObject.Function = originalFunction;
  }
}

describe("static validators under CSP", () => {
  it("validates IPC, payload, and project data without unsafe-eval", () => {
    const captureRequest = readFixture(
      "contracts/fixtures/valid/capture-prepare-region-request.json",
    ) as CaptureRequestFixture;
    const projectDocument = readFixture(
      "contracts/fixtures/graph/valid/empty-project.json",
    );

    const result = withUnsafeEvalBlocked(() => ({
      message: isValidMessage(captureRequest),
      payload: isValidPayload(
        "CapturePrepareRequestPayloadV1",
        captureRequest.payload,
      ),
      project: isValidProjectDocument(projectDocument),
    }));

    expect(result).toEqual({
      message: true,
      payload: true,
      project: true,
    });
  });
});
