import { describe, expect, it } from "vitest";

import {
  APPLICATION_DATA_VERSION,
  createApplicationDataDocument,
  parseApplicationDataDocument,
} from "./application-data";

describe("application data document", () => {
  it("parses only the current version with a valid installation code", () => {
    expect(
      parseApplicationDataDocument(
        JSON.stringify({ version: 1, installationCode: "ABCD1234" }),
      ),
    ).toEqual({
      version: 1,
      installationCode: "ABCD1234",
      assetNameOrdinals: {},
      persistentVariablesByDocument: {},
    });
    expect(
      parseApplicationDataDocument(
        JSON.stringify({ version: 2, installationCode: "ABCD1234" }),
      ),
    ).toBeUndefined();
    expect(
      parseApplicationDataDocument(
        JSON.stringify({ version: 1, installationCode: "abcdefgh" }),
      ),
    ).toBeUndefined();
  });

  it("creates a versioned document", () => {
    const document = createApplicationDataDocument(() =>
      Uint8Array.from([0, 1, 2, 3, 26, 27, 28, 29, 0, 1, 2, 3, 4, 5, 6, 7]),
    );

    expect(document).toEqual({
      version: APPLICATION_DATA_VERSION,
      installationCode: "ABCD0123",
      assetNameOrdinals: {},
      persistentVariablesByDocument: {},
    });
  });
});
