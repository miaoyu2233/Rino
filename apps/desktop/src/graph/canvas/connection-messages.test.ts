import { describe, expect, it } from "vitest";

import { enUSTranslation, zhCNTranslation } from "../../localization/catalogs";
import { connectionRejectionKeys } from "./connection-messages";

function readCatalogEntry(
  catalog: Readonly<Record<string, unknown>>,
  key: string,
): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (value, segment) =>
        value !== null && typeof value === "object"
          ? (value as Record<string, unknown>)[segment]
          : undefined,
      catalog,
    );
}

describe("connection rejection messages", () => {
  it("has a sentence in both display languages for every refusal", () => {
    for (const key of Object.values(connectionRejectionKeys)) {
      expect(readCatalogEntry(zhCNTranslation, key)).toEqual(
        expect.any(String),
      );
      expect(readCatalogEntry(enUSTranslation, key)).toEqual(
        expect.any(String),
      );
    }
  });
});
