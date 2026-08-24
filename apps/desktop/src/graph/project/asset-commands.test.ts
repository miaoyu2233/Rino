import type { ImageAssetV1, RinoProjectDocumentV1 } from "@rino/contracts";
import { describe, expect, it } from "vitest";

import { applyCommand } from "../commands/graph-commands";
import { createEmptyProject } from "../project-factory";
import {
  buildAddImageAssetCommand,
  buildRenameImageAssetCommand,
  type CapturedImageRecord,
} from "./asset-commands";
import {
  createAvailableQualifiedAssetDisplayName,
  createAvailableCaptureDisplayName,
  createCaptureDisplayName,
  findAssetDisplayNameConflict,
  findDuplicateAssetDisplayName,
  isAssetDisplayNameAvailable,
  normalizeAssetDisplayName,
  suggestAvailableAssetDisplayName,
  validateAssetDisplayName,
  visibleAssetDisplayName,
} from "./asset-names";

const FIRST_ASSET = "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb";
const SECOND_ASSET = "3d4e5f60-7182-4394-a5b6-c7d8e9fa0b1c";

function emptyProject(): RinoProjectDocumentV1 {
  let sequence = 0;
  const identifiers = [
    "1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea",
    "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
  ];
  return createEmptyProject({
    name: "示例项目",
    entryGraphName: "主图",
    createdAt: "2026-07-27T09:00:00Z",
    createIdentifier: () => {
      const identifier = identifiers[sequence];
      sequence += 1;
      if (identifier === undefined) {
        throw new Error("The fixture ran out of identifiers.");
      }
      return identifier;
    },
  });
}

function capture(
  assetId: string,
  desiredDisplayName: string,
): CapturedImageRecord {
  return {
    assetId,
    desiredDisplayName,
    installationCode: "RINO2026",
    minimumOrdinal: 1,
    contentHash: "0a".repeat(32),
    byteLength: 4096,
    coordinateSpace: { spaceId: "device:1080x1920", width: 1080, height: 1920 },
    sourceKind: "deviceCapture",
    createdAt: "2026-07-27T09:05:00Z",
  };
}

function withAssets(assets: ImageAssetV1[]): RinoProjectDocumentV1 {
  return { ...emptyProject(), assets };
}

function fileAsset(
  document: RinoProjectDocumentV1,
  record: CapturedImageRecord,
): RinoProjectDocumentV1 {
  const built = buildAddImageAssetCommand(document, record);
  if (!built.ok) {
    throw new Error(
      `The asset command should have been built: ${built.failure.reason}`,
    );
  }
  const outcome = applyCommand(document, built.command);
  if (!outcome.ok) {
    throw new Error(`The asset should have been filed: ${outcome.reason}`);
  }
  return outcome.document;
}

describe("asset display names", () => {
  it("compares names after compatibility form, trimming, and case", () => {
    expect(normalizeAssetDisplayName("  Ｂutton ")).toBe(
      normalizeAssetDisplayName("button"),
    );
  });

  it("finds the collision a manifest would carry", () => {
    const assets = [
      { ...capture(FIRST_ASSET, ""), displayName: "按钮" },
      { ...capture(SECOND_ASSET, ""), displayName: " 按钮" },
    ].map((record): ImageAssetV1 => ({
      assetId: record.assetId,
      displayName: record.displayName,
      contentHash: record.contentHash,
      mediaType: "image/png",
      byteLength: record.byteLength,
      coordinateSpace: record.coordinateSpace,
      sourceKind: record.sourceKind,
      createdAt: record.createdAt,
    }));

    expect(findDuplicateAssetDisplayName(assets)).toBe(" 按钮");
    expect(isAssetDisplayNameAvailable("按钮", assets)).toBe(false);
    expect(isAssetDisplayNameAvailable("按钮", assets, FIRST_ASSET)).toBe(
      false,
    );
    expect(isAssetDisplayNameAvailable("按钮", assets, SECOND_ASSET)).toBe(
      false,
    );
    expect(suggestAvailableAssetDisplayName("按钮", assets)).toBe("按钮 (2)");
    expect(findAssetDisplayNameConflict("按钮", assets)).toEqual({
      reason: "collision",
      conflictingAssetId: FIRST_ASSET,
      suggestion: "按钮 (2)",
    });
  });

  it("refuses a name that normalizes to nothing", () => {
    expect(isAssetDisplayNameAvailable("   ", [])).toBe(false);
  });

  it("qualifies repeated visible names while keeping their UI label concise", () => {
    const firstName = createAvailableQualifiedAssetDisplayName(
      "RINO2026",
      "退出按钮",
      [],
    );
    const firstAsset = {
      assetId: FIRST_ASSET,
      displayName: firstName,
      contentHash: "0a".repeat(32),
      mediaType: "image/png" as const,
      byteLength: 4096,
      coordinateSpace: { spaceId: "device", width: 100, height: 100 },
      sourceKind: "deviceCapture" as const,
      createdAt: "2026-07-27T09:05:00Z",
    } satisfies ImageAssetV1;
    const secondName = createAvailableQualifiedAssetDisplayName(
      "RINO2026",
      "退出按钮",
      [firstAsset],
    );

    expect(firstName).toBe("RINO2026_退出按钮_01");
    expect(secondName).toBe("RINO2026_退出按钮_02");
    expect(visibleAssetDisplayName(secondName)).toBe("退出按钮");
    expect(visibleAssetDisplayName("旧素材")).toBe("旧素材");
  });

  it.each([
    ["", "empty"],
    ["folder/name", "pathSeparator"],
    ["folder\\name", "pathSeparator"],
    ["line\u0000break", "controlCharacter"],
    ["capture.", "trailingPeriod"],
    ["CON", "reservedName"],
  ] as const)("rejects unsafe display name %j", (name, reason) => {
    expect(validateAssetDisplayName(name)).toEqual({ ok: false, reason });
  });

  it("builds deterministic local capture names and skips existing ordinals", () => {
    const capturedAt = new Date(2026, 6, 27, 9, 5, 4);
    expect(createCaptureDisplayName(capturedAt, 1)).toBe(
      "capture-20260727-090504-001",
    );
    const existing = fileAsset(
      emptyProject(),
      capture(FIRST_ASSET, "capture-20260727-090504-001"),
    );
    expect(createAvailableCaptureDisplayName(capturedAt, existing.assets)).toBe(
      "capture-20260727-090504-002",
    );
  });
});

describe("filing a captured image", () => {
  it("accepts repeated visible names with increasing internal ordinals", () => {
    const first = fileAsset(emptyProject(), capture(FIRST_ASSET, "开始按钮"));
    const second = buildAddImageAssetCommand(
      first,
      capture(SECOND_ASSET, " 开始按钮 "),
    );

    expect(second.ok).toBe(true);
    expect(first.assets).toHaveLength(1);
    if (second.ok && second.command.kind === "addAsset") {
      expect(first.assets[0]?.displayName).toBe("RINO2026_开始按钮_01");
      expect(second.command.asset.displayName).toBe("RINO2026_开始按钮_02");
    }
  });

  it("honors the installation-wide ordinal in a different project", () => {
    const built = buildAddImageAssetCommand(emptyProject(), {
      ...capture(FIRST_ASSET, "退出按钮"),
      minimumOrdinal: 7,
    });

    expect(built.ok).toBe(true);
    if (built.ok && built.command.kind === "addAsset") {
      expect(built.ordinal).toBe(7);
      expect(built.command.asset.displayName).toBe("RINO2026_退出按钮_07");
    }
  });

  it("undoes to the manifest it started from", () => {
    const document = emptyProject();
    const built = buildAddImageAssetCommand(
      document,
      capture(FIRST_ASSET, "开始按钮"),
    );
    if (!built.ok) {
      throw new Error("The asset command should have been built.");
    }
    const outcome = applyCommand(document, built.command);
    if (!outcome.ok) {
      throw new Error("The asset should have been filed.");
    }

    const undone = applyCommand(outcome.document, outcome.inverse);

    expect(undone.ok && undone.document).toStrictEqual(document);
  });

  it("refuses a second record with the same identifier", () => {
    const document = fileAsset(
      emptyProject(),
      capture(FIRST_ASSET, "开始按钮"),
    );

    const outcome = applyCommand(document, {
      kind: "addAsset",
      asset: { ...document.assets[0] } as ImageAssetV1,
    });

    expect(outcome).toEqual({ ok: false, reason: "assetAlreadyPresent" });
  });
});

describe("renaming an asset", () => {
  it("changes only the record and reverses exactly", () => {
    const document = fileAsset(
      emptyProject(),
      capture(FIRST_ASSET, "开始按钮"),
    );

    const renamed = applyCommand(
      document,
      buildRenameImageAssetCommand(FIRST_ASSET, "确认按钮"),
    );
    if (!renamed.ok) {
      throw new Error("The rename should have applied.");
    }

    expect(renamed.document.assets[0]?.displayName).toBe(
      "RINO2026_确认按钮_01",
    );
    expect(renamed.document.assets[0]?.contentHash).toBe(
      document.assets[0]?.contentHash,
    );
    const undone = applyCommand(renamed.document, renamed.inverse);
    expect(undone.ok && undone.document).toStrictEqual(document);
  });

  it("allows a qualified asset to share another asset's visible name", () => {
    const first = fileAsset(emptyProject(), capture(FIRST_ASSET, "开始按钮"));
    const second = fileAsset(first, capture(SECOND_ASSET, "确认按钮"));

    const outcome = applyCommand(
      second,
      buildRenameImageAssetCommand(SECOND_ASSET, " 开始按钮 "),
    );

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.document.assets[1]?.displayName).toBe(
        "RINO2026_开始按钮_02",
      );
    }
  });

  it("accepts a rename that keeps the asset's own name", () => {
    const document = fileAsset(
      emptyProject(),
      capture(FIRST_ASSET, "开始按钮"),
    );

    const outcome = applyCommand(
      document,
      buildRenameImageAssetCommand(FIRST_ASSET, "开始按钮"),
    );

    expect(outcome.ok).toBe(true);
  });

  it("reports an asset the project does not hold", () => {
    const outcome = applyCommand(
      withAssets([]),
      buildRenameImageAssetCommand(FIRST_ASSET, "开始按钮"),
    );

    expect(outcome).toEqual({ ok: false, reason: "assetMissing" });
  });
});
