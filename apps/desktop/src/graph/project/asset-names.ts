import type { ImageAssetV1 } from "@rino/contracts";

import { isInstallationCode } from "../../platform/installation-identity";

const MAXIMUM_DISPLAY_NAME_CODE_POINTS = 200;
const MAXIMUM_VISIBLE_NAME_CODE_POINTS = 180;
const PATH_SEPARATOR_PATTERN = /[\\/]/u;
const RESERVED_DEVICE_NAME_PATTERN =
  /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu;
const QUALIFIED_ASSET_NAME_PATTERN =
  /^(?<installationCode>[A-Z0-9]{8})_(?<visibleName>.+)_(?<ordinal>[0-9]{2,})$/u;

export type AssetDisplayNameFailureReason =
  | "empty"
  | "tooLong"
  | "controlCharacter"
  | "pathSeparator"
  | "trailingPeriod"
  | "reservedName"
  | "collision";

export type AssetDisplayNameValidation =
  | {
      ok: true;
      displayName: string;
      normalizedName: string;
    }
  | {
      ok: false;
      reason: Exclude<AssetDisplayNameFailureReason, "collision">;
    };

export interface AssetDisplayNameConflict {
  reason: "collision";
  conflictingAssetId: string;
  suggestion: string;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}

export function normalizeAssetDisplayName(displayName: string): string {
  return displayName.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function validateName(
  candidate: string,
  maximumCodePoints: number,
): AssetDisplayNameValidation {
  const displayName = candidate.normalize("NFKC").trim();
  if (displayName.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (Array.from(displayName).length > maximumCodePoints) {
    return { ok: false, reason: "tooLong" };
  }
  if (containsControlCharacter(displayName)) {
    return { ok: false, reason: "controlCharacter" };
  }
  if (PATH_SEPARATOR_PATTERN.test(displayName)) {
    return { ok: false, reason: "pathSeparator" };
  }
  if (displayName.endsWith(".")) {
    return { ok: false, reason: "trailingPeriod" };
  }
  if (RESERVED_DEVICE_NAME_PATTERN.test(displayName)) {
    return { ok: false, reason: "reservedName" };
  }
  return {
    ok: true,
    displayName,
    normalizedName: normalizeAssetDisplayName(displayName),
  };
}

export function validateAssetDisplayName(
  candidate: string,
): AssetDisplayNameValidation {
  return validateName(candidate, MAXIMUM_DISPLAY_NAME_CODE_POINTS);
}

export function validateAssetVisibleName(
  candidate: string,
): AssetDisplayNameValidation {
  return validateName(candidate, MAXIMUM_VISIBLE_NAME_CODE_POINTS);
}

export interface QualifiedAssetDisplayName {
  installationCode: string;
  visibleName: string;
  ordinal: number;
}

export function parseQualifiedAssetDisplayName(
  displayName: string,
): QualifiedAssetDisplayName | undefined {
  const match = QUALIFIED_ASSET_NAME_PATTERN.exec(displayName);
  const installationCode = match?.groups?.["installationCode"];
  const visibleName = match?.groups?.["visibleName"];
  const ordinalText = match?.groups?.["ordinal"];
  const ordinal = ordinalText === undefined ? Number.NaN : Number(ordinalText);
  return installationCode !== undefined &&
    visibleName !== undefined &&
    isInstallationCode(installationCode) &&
    Number.isSafeInteger(ordinal) &&
    ordinal > 0
    ? { installationCode, visibleName, ordinal }
    : undefined;
}

export function visibleAssetDisplayName(displayName: string): string {
  return (
    parseQualifiedAssetDisplayName(displayName)?.visibleName ?? displayName
  );
}

export function replaceQualifiedAssetVisibleName(
  currentDisplayName: string,
  nextVisibleName: string,
): string {
  const qualified = parseQualifiedAssetDisplayName(currentDisplayName);
  if (qualified === undefined) {
    return nextVisibleName;
  }
  return `${qualified.installationCode}_${nextVisibleName}_${qualified.ordinal
    .toString()
    .padStart(2, "0")}`;
}

export function createAvailableQualifiedAssetDisplayName(
  installationCode: string,
  visibleName: string,
  assets: readonly ImageAssetV1[],
  minimumOrdinal = 1,
): string {
  if (!isInstallationCode(installationCode)) {
    throw new Error("A valid installation code is required for an asset name.");
  }
  const validation = validateAssetVisibleName(visibleName);
  if (!validation.ok) {
    throw new Error("A valid visible asset name is required.");
  }
  if (!Number.isSafeInteger(minimumOrdinal) || minimumOrdinal < 1) {
    throw new RangeError("The minimum asset name ordinal must be positive.");
  }
  const normalizedVisibleName = normalizeAssetDisplayName(
    validation.displayName,
  );
  const largestExistingOrdinal = assets.reduce((largest, asset) => {
    const qualified = parseQualifiedAssetDisplayName(asset.displayName);
    return qualified?.installationCode === installationCode &&
      normalizeAssetDisplayName(qualified.visibleName) === normalizedVisibleName
      ? Math.max(largest, qualified.ordinal)
      : largest;
  }, 0);
  const firstOrdinal = Math.max(minimumOrdinal, largestExistingOrdinal + 1);
  for (
    let ordinal = firstOrdinal;
    ordinal <= firstOrdinal + assets.length;
    ordinal += 1
  ) {
    const suffix = ordinal.toString().padStart(2, "0");
    const candidate = `${installationCode}_${validation.displayName}_${suffix}`;
    if (isAssetDisplayNameAvailable(candidate, assets)) {
      return candidate;
    }
  }
  throw new Error("No qualified asset display name is available.");
}

export function findDuplicateAssetDisplayName(
  assets: readonly ImageAssetV1[],
): string | undefined {
  const seen = new Set<string>();
  for (const asset of assets) {
    const normalized = normalizeAssetDisplayName(asset.displayName);
    if (seen.has(normalized)) {
      return asset.displayName;
    }
    seen.add(normalized);
  }
  return undefined;
}

export function isAssetDisplayNameAvailable(
  displayName: string,
  assets: readonly ImageAssetV1[],
  exemptAssetId?: string,
): boolean {
  const validation = validateAssetDisplayName(displayName);
  if (!validation.ok) {
    return false;
  }
  return !assets.some(
    (asset) =>
      asset.assetId !== exemptAssetId &&
      normalizeAssetDisplayName(asset.displayName) ===
        validation.normalizedName,
  );
}

export function suggestAvailableAssetDisplayName(
  desiredDisplayName: string,
  assets: readonly ImageAssetV1[],
): string {
  const validation = validateAssetDisplayName(desiredDisplayName);
  const base = validation.ok ? validation.displayName : "capture";
  if (isAssetDisplayNameAvailable(base, assets)) {
    return base;
  }
  for (let ordinal = 2; ordinal <= assets.length + 2; ordinal += 1) {
    const suffix = ` (${ordinal.toString()})`;
    const availableCodePoints =
      MAXIMUM_DISPLAY_NAME_CODE_POINTS - suffix.length;
    const candidate = `${Array.from(base).slice(0, availableCodePoints).join("")}${suffix}`;
    if (isAssetDisplayNameAvailable(candidate, assets)) {
      return candidate;
    }
  }
  throw new Error("No asset display name is available in this project.");
}

export function findAssetDisplayNameConflict(
  displayName: string,
  assets: readonly ImageAssetV1[],
  exemptAssetId?: string,
): AssetDisplayNameConflict | undefined {
  const validation = validateAssetDisplayName(displayName);
  if (!validation.ok) {
    return undefined;
  }
  const conflict = assets.find(
    (asset) =>
      asset.assetId !== exemptAssetId &&
      normalizeAssetDisplayName(asset.displayName) ===
        validation.normalizedName,
  );
  return conflict === undefined
    ? undefined
    : {
        reason: "collision",
        conflictingAssetId: conflict.assetId,
        suggestion: suggestAvailableAssetDisplayName(
          validation.displayName,
          assets,
        ),
      };
}

function padded(value: number, width: number): string {
  return value.toString().padStart(width, "0");
}

export function createCaptureDisplayName(
  capturedAt: Date,
  ordinal: number,
): string {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 999) {
    throw new RangeError("Capture name ordinals must be between 1 and 999.");
  }
  return [
    "capture-",
    padded(capturedAt.getFullYear(), 4),
    padded(capturedAt.getMonth() + 1, 2),
    padded(capturedAt.getDate(), 2),
    "-",
    padded(capturedAt.getHours(), 2),
    padded(capturedAt.getMinutes(), 2),
    padded(capturedAt.getSeconds(), 2),
    "-",
    padded(ordinal, 3),
  ].join("");
}

export function createAvailableCaptureDisplayName(
  capturedAt: Date,
  assets: readonly ImageAssetV1[],
): string {
  for (let ordinal = 1; ordinal <= 999; ordinal += 1) {
    const candidate = createCaptureDisplayName(capturedAt, ordinal);
    const normalizedCandidate = normalizeAssetDisplayName(candidate);
    if (
      !assets.some(
        (asset) =>
          normalizeAssetDisplayName(
            visibleAssetDisplayName(asset.displayName),
          ) === normalizedCandidate,
      )
    ) {
      return candidate;
    }
  }
  throw new Error("No capture display name is available for this second.");
}
