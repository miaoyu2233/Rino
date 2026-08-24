import type { CaptureArtifactDescriptorV1 } from "@rino/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  prepareCaptureSession,
  type CaptureProjectPort,
  type CaptureRuntimePort,
} from "./capture-session";

const descriptor: CaptureArtifactDescriptorV1 = {
  captureToken: "abcdef0123456789abcdef0123456789",
  mediaType: "image/png",
  width: 300,
  height: 400,
  coordinateSpaceId: "capture-space",
  sourceKind: "regionCapture",
  byteLength: 8,
  expiresInMilliseconds: 60_000,
};

function ports(): {
  runtime: CaptureRuntimePort;
  project: CaptureProjectPort;
} {
  return {
    runtime: {
      prepareCapture: vi.fn(() => Promise.resolve(descriptor)),
      readCapture: vi.fn(() =>
        Promise.resolve(
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
      ),
      releaseCapture: vi.fn(() => Promise.resolve(true)),
    },
    project: {
      storeCapture: vi.fn(() =>
        Promise.resolve({
          contentHash: "0a".repeat(32),
          byteLength: 8,
          width: 300,
          height: 400,
          coordinateSpaceId: "capture-space",
          sourceKind: "regionCapture" as const,
        }),
      ),
    },
  };
}

describe("prepared capture sessions", () => {
  it("preserves a runtime preparation failure stage", async () => {
    const { runtime, project } = ports();
    const failure = new Error("runtime rejected capture");
    vi.mocked(runtime.prepareCapture).mockRejectedValueOnce(failure);

    await expect(
      prepareCaptureSession(runtime, project, {
        previewToken: "0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      stage: "runtimePrepare",
      originalCause: failure,
    });
    expect(runtime.readCapture).not.toHaveBeenCalled();
    expect(runtime.releaseCapture).not.toHaveBeenCalled();
  });

  it("keeps a prepared capture private until commit", async () => {
    const { runtime, project } = ports();
    const payload = {
      previewToken: "0123456789abcdef0123456789abcdef",
      region: {
        x: 100,
        y: 200,
        width: 300,
        height: 400,
        coordinateSpaceId: "source-space",
        sourceGeneration: 7,
      },
    };

    const session = await prepareCaptureSession(runtime, project, payload);

    expect(runtime.prepareCapture).toHaveBeenCalledWith(payload);
    expect(project.storeCapture).not.toHaveBeenCalled();
    expect(session.state).toBe("active");
    expect(session.bytes).toHaveLength(8);

    await expect(session.commit()).resolves.toMatchObject({
      width: 300,
      height: 400,
    });
    expect(project.storeCapture).toHaveBeenCalledWith(descriptor.captureToken);
    expect(session.state).toBe("committed");
    expect(() => session.bytes).toThrow();
    await expect(session.commit()).rejects.toThrow();
  });

  it("releases a discarded capture and clears its bytes", async () => {
    const { runtime, project } = ports();
    const session = await prepareCaptureSession(runtime, project, {
      previewToken: "0123456789abcdef0123456789abcdef",
    });

    await expect(session.discard()).resolves.toBe(true);

    expect(runtime.releaseCapture).toHaveBeenCalledWith(
      descriptor.captureToken,
    );
    expect(session.state).toBe("released");
    expect(() => session.bytes).toThrow();
  });

  it("releases metadata when native bytes do not match", async () => {
    const { runtime, project } = ports();
    vi.mocked(runtime.readCapture).mockResolvedValue(new Uint8Array([1, 2]));

    await expect(
      prepareCaptureSession(runtime, project, {
        previewToken: "0123456789abcdef0123456789abcdef",
      }),
    ).rejects.toMatchObject({
      stage: "captureRead",
    });
    expect(runtime.releaseCapture).toHaveBeenCalledWith(
      descriptor.captureToken,
    );
  });

  it("keeps a failed project commit active for retry or discard", async () => {
    const { runtime, project } = ports();
    vi.mocked(project.storeCapture).mockRejectedValueOnce(
      new Error("disk full"),
    );
    const session = await prepareCaptureSession(runtime, project, {
      previewToken: "0123456789abcdef0123456789abcdef",
    });

    await expect(session.commit()).rejects.toThrow("disk full");

    expect(session.state).toBe("active");
    expect(session.bytes).toHaveLength(8);
    await expect(session.discard()).resolves.toBe(true);
  });

  it("allows only one terminal operation at a time", async () => {
    const { runtime, project } = ports();
    let finishStore:
      | ((
          value: Awaited<ReturnType<CaptureProjectPort["storeCapture"]>>,
        ) => void)
      | undefined;
    vi.mocked(project.storeCapture).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStore = resolve;
        }),
    );
    const session = await prepareCaptureSession(runtime, project, {
      previewToken: "0123456789abcdef0123456789abcdef",
    });

    const committing = session.commit();
    await expect(session.commit()).rejects.toThrow("in progress");
    await expect(session.discard()).rejects.toThrow("in progress");
    if (finishStore === undefined) {
      throw new Error("The store operation did not start.");
    }
    finishStore({
      contentHash: "0a".repeat(32),
      byteLength: 8,
      width: 300,
      height: 400,
      coordinateSpaceId: "capture-space",
      sourceKind: "regionCapture",
    });
    await expect(committing).resolves.toBeDefined();
    expect(project.storeCapture).toHaveBeenCalledOnce();
  });

  it("clears local bytes even when remote release fails", async () => {
    const { runtime, project } = ports();
    vi.mocked(runtime.releaseCapture).mockRejectedValueOnce(
      new Error("runtime unavailable"),
    );
    const session = await prepareCaptureSession(runtime, project, {
      previewToken: "0123456789abcdef0123456789abcdef",
    });

    await expect(session.discard()).rejects.toThrow("runtime unavailable");
    expect(session.state).toBe("released");
    expect(() => session.bytes).toThrow();
  });
});
