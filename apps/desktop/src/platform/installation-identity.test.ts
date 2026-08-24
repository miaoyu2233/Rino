import { describe, expect, it } from "vitest";

import {
  generateInstallationCode,
  INSTALLATION_CODE_LENGTH,
  isInstallationCode,
} from "./installation-identity";

describe("installation identity", () => {
  it("accepts exactly eight uppercase alphanumeric characters containing both classes", () => {
    expect(isInstallationCode("ABC12DEF")).toBe(true);
    expect(isInstallationCode("ABCDEFGH")).toBe(false);
    expect(isInstallationCode("12345678")).toBe(false);
    expect(isInstallationCode("abc12def")).toBe(false);
    expect(isInstallationCode("ABC12DEFG")).toBe(false);
  });

  it("generates a valid code from unbiased random bytes", () => {
    const code = generateInstallationCode(() =>
      Uint8Array.from([
        0, 1, 2, 3, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 4, 5,
      ]),
    );

    expect(code).toHaveLength(INSTALLATION_CODE_LENGTH);
    expect(code).toBe("ABCD0123");
    expect(isInstallationCode(code)).toBe(true);
  });

  it("retries a candidate that does not contain a number", () => {
    let attempt = 0;
    const code = generateInstallationCode(() => {
      attempt += 1;
      return attempt === 1
        ? Uint8Array.from({ length: 16 }, (_, index) => index % 20)
        : Uint8Array.from([0, 1, 2, 3, 26, 27, 28, 29, 0, 1, 2, 3, 4, 5, 6, 7]);
    });

    expect(attempt).toBe(2);
    expect(code).toBe("ABCD0123");
  });
});
