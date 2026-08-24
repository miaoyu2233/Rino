import type { ImageAssetV1, RinoProjectDocumentV1 } from "@rino/contracts";

import type { GraphCommand } from "../commands/graph-commands";
import {
  createAvailableQualifiedAssetDisplayName,
  findAssetDisplayNameConflict,
  parseQualifiedAssetDisplayName,
  validateAssetVisibleName,
  type AssetDisplayNameConflict,
  type AssetDisplayNameValidation,
} from "./asset-names";

/** Everything an image asset record needs except the name it will be listed under. */
export interface CapturedImageRecord {
  assetId: string;
  /** The name the capture would like to be listed under. */
  desiredDisplayName: string;
  installationCode: string;
  minimumOrdinal: number;
  contentHash: string;
  byteLength: number;
  coordinateSpace: ImageAssetV1["coordinateSpace"];
  sourceKind: ImageAssetV1["sourceKind"];
  createdAt: string;
}

/** Builds the command that files a captured or imported image in the project.
 *
 * The visible name is validated before it is combined with the installation code and a
 * monotonic ordinal. The returned ordinal is committed to local application data only
 * after the graph command succeeds.
 */
export type BuildImageAssetCommandResult =
  | { ok: true; command: GraphCommand; ordinal: number }
  | {
      ok: false;
      failure:
        | Extract<AssetDisplayNameValidation, { ok: false }>
        | AssetDisplayNameConflict;
    };

export function buildAddImageAssetCommand(
  document: RinoProjectDocumentV1,
  record: CapturedImageRecord,
): BuildImageAssetCommandResult {
  const validation = validateAssetVisibleName(record.desiredDisplayName);
  if (!validation.ok) {
    return { ok: false, failure: validation };
  }
  const qualifiedDisplayName = createAvailableQualifiedAssetDisplayName(
    record.installationCode,
    validation.displayName,
    document.assets,
    record.minimumOrdinal,
  );
  const conflict = findAssetDisplayNameConflict(
    qualifiedDisplayName,
    document.assets,
  );
  if (conflict !== undefined) {
    return { ok: false, failure: conflict };
  }
  const asset: ImageAssetV1 = {
    assetId: record.assetId,
    displayName: qualifiedDisplayName,
    contentHash: record.contentHash,
    mediaType: "image/png",
    byteLength: record.byteLength,
    coordinateSpace: record.coordinateSpace,
    sourceKind: record.sourceKind,
    createdAt: record.createdAt,
  };
  const qualified = parseQualifiedAssetDisplayName(qualifiedDisplayName);
  if (qualified === undefined) {
    throw new Error("The generated asset name is not qualified.");
  }
  return {
    ok: true,
    command: { kind: "addAsset", asset },
    ordinal: qualified.ordinal,
  };
}

/** Builds the command that renames one asset without moving its stored bytes.
 *
 * Storage is content-addressed and graphs reference the asset identifier, so a rename
 * touches the manifest record alone.
 */
export function buildRenameImageAssetCommand(
  assetId: string,
  displayName: string,
): GraphCommand {
  return {
    kind: "setAssetDisplayName",
    assetId,
    displayName: displayName.trim(),
  };
}
