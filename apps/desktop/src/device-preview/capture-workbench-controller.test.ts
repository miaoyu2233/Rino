import type {
  CaptureArtifactDescriptorV1,
  ImageAssetV1,
  PreviewArtifactDescriptorV1,
  RinoProjectDocumentV1,
} from "@rino/contracts";
import { describe, expect, it, vi } from "vitest";

import { RuntimeCommandError } from "../ipc/runtime-client";

import { applyCommand } from "../graph/commands/graph-commands";
import { createEmptyProject } from "../graph/project-factory";
import type { ProjectOutcome } from "../graph/project/project-actions";
import type { StoredImageObject } from "../graph/project/project-transport";
import {
  CaptureWorkbenchController,
  createCapturePreparePayload,
  type CaptureWorkbenchDependencies,
} from "./capture-workbench-controller";

const PREVIEW_TOKEN = "0123456789abcdef0123456789abcdef";
const CAPTURE_TOKEN = "abcdef0123456789abcdef0123456789";
const ASSET_ID = "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb";

const preview: PreviewArtifactDescriptorV1 = {
  previewToken: PREVIEW_TOKEN,
  mediaType: "image/png",
  width: 500,
  height: 400,
  sourceWidth: 1000,
  sourceHeight: 800,
  sourceCoordinateSpaceId: "preview-space",
  sourceGeneration: 7,
  byteLength: 8,
  expiresInMilliseconds: 30_000,
};

const descriptor: CaptureArtifactDescriptorV1 = {
  captureToken: CAPTURE_TOKEN,
  mediaType: "image/png",
  width: 1000,
  height: 800,
  coordinateSpaceId: "capture-space",
  sourceKind: "deviceCapture",
  byteLength: 8,
  expiresInMilliseconds: 60_000,
};

const stored: StoredImageObject = {
  contentHash: "0a".repeat(32),
  byteLength: descriptor.byteLength,
  width: descriptor.width,
  height: descriptor.height,
  coordinateSpaceId: descriptor.coordinateSpaceId,
  sourceKind: descriptor.sourceKind,
};

function projectDocument(): RinoProjectDocumentV1 {
  const identifiers = [
    "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
    "1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea",
  ];
  return createEmptyProject({
    name: "截图测试",
    entryGraphName: "主图",
    createdAt: "2026-07-28T09:00:00.000Z",
    createIdentifier: () => {
      const identifier = identifiers.shift();
      if (identifier === undefined) {
        throw new Error("The project fixture exhausted its identifiers.");
      }
      return identifier;
    },
  });
}

function createHarness(overrides?: {
  storeCapture?: () => Promise<StoredImageObject>;
  saveProject?: () => Promise<{ status: "completed" } | { status: "failed" }>;
}) {
  let document = projectDocument();
  let executionLocked = false;
  const prepareCapture = vi.fn(() => Promise.resolve(descriptor));
  const readCapture = vi.fn(() =>
    Promise.resolve(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
  );
  const releaseCapture = vi.fn(() => Promise.resolve(true));
  const storeCapture = vi.fn(
    overrides?.storeCapture ?? (() => Promise.resolve(stored)),
  );
  const saveProject = vi.fn<() => Promise<ProjectOutcome>>(
    overrides?.saveProject ?? (() => Promise.resolve({ status: "completed" })),
  );
  const createObjectUrl = vi.fn(() => "blob:rino-capture");
  const revokeObjectUrl = vi.fn();
  const recordAssetNameOrdinal = vi.fn();

  const dependencies: CaptureWorkbenchDependencies = {
    runtime: { prepareCapture, readCapture, releaseCapture },
    project: { storeCapture },
    document: {
      readDocument: () => document,
      isExecutionLocked: () => executionLocked,
      runCommand: (_label, command) => {
        const outcome = applyCommand(document, command);
        if (!outcome.ok) {
          return outcome;
        }
        document = outcome.document;
        return { ok: true };
      },
      saveProject,
    },
    objectUrls: {
      create: createObjectUrl,
      revoke: revokeObjectUrl,
    },
    createIdentifier: () => ASSET_ID,
    readInstallationCode: () => "RINO2026",
    readNextAssetNameOrdinal: () => 1,
    recordAssetNameOrdinal,
    now: () => new Date(2026, 6, 28, 9, 5, 4),
  };
  const controller = new CaptureWorkbenchController(dependencies);
  return {
    controller,
    prepareCapture,
    readCapture,
    releaseCapture,
    storeCapture,
    saveProject,
    createObjectUrl,
    revokeObjectUrl,
    recordAssetNameOrdinal,
    readDocument: () => document,
    setDocument: (next: RinoProjectDocumentV1) => {
      document = next;
    },
    setExecutionLocked: (locked: boolean) => {
      executionLocked = locked;
    },
  };
}

describe("capture preparation payloads", () => {
  it("binds a valid region to the exact visible preview", () => {
    expect(
      createCapturePreparePayload(preview, {
        x: 100,
        y: 120,
        width: 300,
        height: 240,
        coordinateSpaceId: "preview-space",
        sourceGeneration: 7,
      }),
    ).toEqual({
      previewToken: PREVIEW_TOKEN,
      region: {
        x: 100,
        y: 120,
        width: 300,
        height: 240,
        coordinateSpaceId: "preview-space",
        sourceGeneration: 7,
      },
    });
  });

  it("rejects stale, fractional, empty, and out-of-bounds regions", () => {
    const base = {
      x: 100,
      y: 120,
      width: 300,
      height: 240,
      coordinateSpaceId: "preview-space",
      sourceGeneration: 7,
    };
    expect(
      createCapturePreparePayload(preview, {
        ...base,
        sourceGeneration: 6,
      }),
    ).toBeUndefined();
    expect(
      createCapturePreparePayload(preview, { ...base, x: 1.5 }),
    ).toBeUndefined();
    expect(
      createCapturePreparePayload(preview, { ...base, width: 0 }),
    ).toBeUndefined();
    expect(
      createCapturePreparePayload(preview, { ...base, x: 900 }),
    ).toBeUndefined();
  });
});

describe("capture workbench controller", () => {
  it("reports the runtime error code when capture preparation fails", async () => {
    const harness = createHarness();
    vi.mocked(harness.prepareCapture).mockRejectedValueOnce(
      new RuntimeCommandError({
        code: "CAPTURE_ARTIFACT_UNAVAILABLE",
        messageKey: "runtime.error.captureUnavailable",
        parameters: {},
        technicalDetail: "The source preview expired.",
        retryability: "safe",
      }),
    );

    await expect(harness.controller.prepare(preview)).resolves.toBe(false);
    expect(harness.controller.getSnapshot()).toEqual({
      phase: "failed",
      reason: "runtimePrepareFailed",
      diagnosticCode: "CAPTURE_ARTIFACT_UNAVAILABLE",
    });
  });

  it("reports the native read error and releases the capture artifact", async () => {
    const harness = createHarness();
    vi.mocked(harness.readCapture).mockRejectedValueOnce(
      new RuntimeCommandError({
        code: "CAPTURE_UNAVAILABLE",
        messageKey: "runtime.error.captureUnavailable",
        parameters: {},
        technicalDetail: "The capture file could not be read.",
        retryability: "safe",
      }),
    );

    await expect(harness.controller.prepare(preview)).resolves.toBe(false);
    expect(harness.controller.getSnapshot()).toEqual({
      phase: "failed",
      reason: "captureReadFailed",
      diagnosticCode: "CAPTURE_UNAVAILABLE",
    });
    expect(harness.releaseCapture).toHaveBeenCalledWith(CAPTURE_TOKEN);
  });

  it("preserves the exact requested source region for confirmation", async () => {
    const harness = createHarness();
    const region = {
      x: 120,
      y: 80,
      width: 300,
      height: 240,
      coordinateSpaceId: "preview-space",
      sourceGeneration: 7,
    };

    await expect(harness.controller.prepare(preview, region)).resolves.toBe(
      true,
    );
    expect(harness.controller.getSnapshot()).toMatchObject({
      phase: "confirming",
      sourceRegion: region,
    });
  });

  it("keeps prepared bytes private and proposes an available automatic name", async () => {
    const harness = createHarness();

    await expect(harness.controller.prepare(preview)).resolves.toBe(true);

    expect(harness.storeCapture).not.toHaveBeenCalled();
    expect(harness.controller.getSnapshot()).toMatchObject({
      phase: "confirming",
      displayName: "capture-20260728-090504-001",
      objectUrl: "blob:rino-capture",
      nameValidation: { ok: true },
    });
    expect(harness.createObjectUrl).toHaveBeenCalledOnce();
  });

  it("blocks an invalid or colliding name before storage", async () => {
    const harness = createHarness();
    await harness.controller.prepare(preview);

    harness.controller.setDisplayName("CON");
    await expect(harness.controller.commit()).resolves.toBe(false);
    expect(harness.storeCapture).not.toHaveBeenCalled();
    expect(harness.controller.getSnapshot()).toMatchObject({
      phase: "confirming",
      nameValidation: { ok: false, reason: "reservedName" },
    });
  });

  it("stores, files, saves, and releases presentation bytes once", async () => {
    const harness = createHarness();
    await harness.controller.prepare(preview);
    harness.controller.setDisplayName("开始按钮");

    await expect(harness.controller.commit()).resolves.toBe(true);

    expect(harness.storeCapture).toHaveBeenCalledOnce();
    expect(harness.saveProject).toHaveBeenCalledOnce();
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith("blob:rino-capture");
    expect(harness.recordAssetNameOrdinal).toHaveBeenCalledWith("开始按钮", 1);
    expect(harness.readDocument().assets).toHaveLength(1);
    expect(harness.readDocument().assets[0]).toMatchObject({
      assetId: ASSET_ID,
      displayName: "RINO2026_开始按钮_01",
      contentHash: stored.contentHash,
    });
    expect(harness.controller.getSnapshot()).toEqual({
      phase: "completed",
      assetId: ASSET_ID,
      displayName: "开始按钮",
    });
  });

  it("keeps a failed object-store attempt available for retry or discard", async () => {
    const harness = createHarness({
      storeCapture: vi
        .fn<() => Promise<StoredImageObject>>()
        .mockRejectedValueOnce(new Error("disk full"))
        .mockResolvedValue(stored),
    });
    await harness.controller.prepare(preview);

    await expect(harness.controller.commit()).resolves.toBe(false);
    expect(harness.controller.getSnapshot().phase).toBe("confirming");
    expect(harness.revokeObjectUrl).not.toHaveBeenCalled();

    await expect(harness.controller.commit()).resolves.toBe(true);
    expect(harness.storeCapture).toHaveBeenCalledTimes(2);
  });

  it("releases a prepared capture when execution becomes locked", async () => {
    const harness = createHarness();
    await harness.controller.prepare(preview);
    harness.setExecutionLocked(true);

    await expect(harness.controller.commit()).resolves.toBe(false);
    expect(harness.controller.getSnapshot()).toEqual({
      phase: "failed",
      reason: "executionLocked",
    });
    expect(harness.storeCapture).not.toHaveBeenCalled();
    expect(harness.releaseCapture).toHaveBeenCalledWith(CAPTURE_TOKEN);
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith("blob:rino-capture");
  });

  it("keeps the visible name when another same-named asset appears during storage", async () => {
    const harness = createHarness();
    await harness.controller.prepare(preview);
    const confirming = harness.controller.getSnapshot();
    if (confirming.phase !== "confirming") {
      throw new Error("Expected a confirming capture.");
    }
    const collision: ImageAssetV1 = {
      assetId: "3d4e5f60-7182-4394-a5b6-c7d8e9fa0b1c",
      displayName: confirming.displayName,
      contentHash: "0b".repeat(32),
      mediaType: "image/png",
      byteLength: 16,
      coordinateSpace: {
        spaceId: "existing-space",
        width: 20,
        height: 20,
      },
      sourceKind: "deviceCapture",
      createdAt: "2026-07-28T08:00:00.000Z",
    };
    vi.mocked(harness.storeCapture).mockImplementationOnce(() => {
      harness.setDocument({
        ...harness.readDocument(),
        assets: [collision],
      });
      return Promise.resolve(stored);
    });

    await expect(harness.controller.commit()).resolves.toBe(true);
    expect(harness.storeCapture).toHaveBeenCalledOnce();
    expect(harness.readDocument().assets).toHaveLength(2);
    expect(harness.readDocument().assets[1]?.displayName).toBe(
      `RINO2026_${confirming.displayName}_01`,
    );
  });

  it("abandons a filing failure without retaining controller state", async () => {
    const harness = createHarness();
    await harness.controller.prepare(preview);
    const confirming = harness.controller.getSnapshot();
    if (confirming.phase !== "confirming") {
      throw new Error("Expected a confirming capture.");
    }
    vi.mocked(harness.storeCapture).mockImplementationOnce(() => {
      harness.setDocument({
        ...harness.readDocument(),
        assets: [
          {
            assetId: "6a718293-a4b5-46c7-88d9-ea0b1c2d3e4f",
            displayName: confirming.displayName,
            contentHash: "0c".repeat(32),
            mediaType: "image/png",
            byteLength: 16,
            coordinateSpace: {
              spaceId: "existing-space",
              width: 20,
              height: 20,
            },
            sourceKind: "deviceCapture",
            createdAt: "2026-07-28T08:00:00.000Z",
          },
        ],
      });
      harness.setExecutionLocked(true);
      return Promise.resolve(stored);
    });
    await harness.controller.commit();

    await expect(harness.controller.discard()).resolves.toBe(true);
    expect(harness.controller.getSnapshot()).toEqual({ phase: "idle" });
    await expect(harness.controller.commit()).resolves.toBe(false);
  });

  it("retains a filed asset when save fails and retries only the save", async () => {
    const saveProject = vi
      .fn<() => Promise<{ status: "completed" } | { status: "failed" }>>()
      .mockResolvedValueOnce({ status: "failed" })
      .mockResolvedValueOnce({ status: "completed" });
    const harness = createHarness({ saveProject });
    await harness.controller.prepare(preview);

    await expect(harness.controller.commit()).resolves.toBe(false);
    expect(harness.controller.getSnapshot()).toMatchObject({
      phase: "saveFailed",
      assetId: ASSET_ID,
    });
    expect(harness.readDocument().assets).toHaveLength(1);

    await expect(harness.controller.retrySave()).resolves.toBe(true);
    expect(harness.storeCapture).toHaveBeenCalledOnce();
    expect(saveProject).toHaveBeenCalledTimes(2);
  });

  it("invalidates a prepared capture when the open project changes", async () => {
    const harness = createHarness();
    await harness.controller.prepare(preview);
    const replacement = {
      ...projectDocument(),
      documentId: "4e5f6071-8293-44a5-b6c7-d8e9fa0b1c2d",
    };
    harness.setDocument(replacement);

    expect(
      harness.controller.validateProjectContext(replacement.documentId),
    ).toBe(false);
    expect(harness.controller.getSnapshot()).toEqual({
      phase: "failed",
      reason: "projectChanged",
    });
    expect(harness.releaseCapture).toHaveBeenCalledWith(CAPTURE_TOKEN);
    expect(harness.revokeObjectUrl).toHaveBeenCalledWith("blob:rino-capture");
    await expect(harness.controller.commit()).resolves.toBe(false);
    expect(harness.storeCapture).not.toHaveBeenCalled();
  });

  it("never retries a failed save against a replacement project", async () => {
    const saveProject = vi
      .fn<() => Promise<{ status: "completed" } | { status: "failed" }>>()
      .mockResolvedValueOnce({ status: "failed" })
      .mockResolvedValueOnce({ status: "completed" });
    const harness = createHarness({ saveProject });
    await harness.controller.prepare(preview);
    await harness.controller.commit();

    const replacement = {
      ...projectDocument(),
      documentId: "5f607182-93a4-45b6-87d8-e9fa0b1c2d3e",
    };
    harness.setDocument(replacement);
    expect(
      harness.controller.validateProjectContext(replacement.documentId),
    ).toBe(false);

    await expect(harness.controller.retrySave()).resolves.toBe(false);
    expect(saveProject).toHaveBeenCalledOnce();
    expect(harness.controller.getSnapshot()).toEqual({
      phase: "failed",
      reason: "projectChanged",
    });
  });

  it("discards and disposes active captures without retaining object URLs", async () => {
    const discarded = createHarness();
    await discarded.controller.prepare(preview);
    await expect(discarded.controller.discard()).resolves.toBe(true);
    expect(discarded.releaseCapture).toHaveBeenCalledWith(CAPTURE_TOKEN);
    expect(discarded.revokeObjectUrl).toHaveBeenCalledWith("blob:rino-capture");
    expect(discarded.controller.getSnapshot()).toEqual({ phase: "idle" });

    const disposed = createHarness();
    await disposed.controller.prepare(preview);
    disposed.controller.dispose();
    expect(disposed.releaseCapture).toHaveBeenCalledWith(CAPTURE_TOKEN);
    expect(disposed.revokeObjectUrl).toHaveBeenCalledWith("blob:rino-capture");
  });

  it("rejects changed stored metadata before adding a manifest record", async () => {
    const harness = createHarness({
      storeCapture: () => Promise.resolve({ ...stored, width: 999 }),
    });
    await harness.controller.prepare(preview);

    await expect(harness.controller.commit()).resolves.toBe(false);
    expect(harness.controller.getSnapshot()).toEqual({
      phase: "failed",
      reason: "storedMetadataMismatch",
    });
    expect(harness.readDocument().assets).toHaveLength(0);
    expect(harness.revokeObjectUrl).toHaveBeenCalledOnce();
  });
});
