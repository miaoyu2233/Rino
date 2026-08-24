import {
  rinoDiagnosticsV1Schema,
  type GraphDiagnosticCodeV1,
} from "@rino/contracts";
import { describe, expect, it } from "vitest";

import { applicationI18n } from "../localization/i18n";
import { buildDiagnostic, documentLocation } from "./graph-diagnostics";

const diagnosticCodes = rinoDiagnosticsV1Schema.$defs.GraphDiagnosticCodeV1
  .enum as readonly GraphDiagnosticCodeV1[];

describe("diagnostic message keys", () => {
  it("covers every canonical code in both catalogs", () => {
    // The key is derived from the code, so a new code that ships without a message would
    // otherwise surface as a raw key in the Problems panel.
    for (const locale of ["zh-CN", "en-US"] as const) {
      for (const code of diagnosticCodes) {
        const { messageKey } = buildDiagnostic(code, documentLocation());
        // The key is derived at run time, so the catalog is queried by resource lookup
        // rather than through the key-typed translation function.
        const message: unknown = applicationI18n.getResource(
          locale,
          "translation",
          messageKey,
        );

        expect(
          typeof message,
          `${code} has no ${locale} message for ${messageKey}`,
        ).toBe("string");
        expect(String(message).length).toBeGreaterThan(0);
      }
    }
  });

  it("classifies severity so only advisory codes are warnings", () => {
    const warnings = diagnosticCodes.filter(
      (code) =>
        buildDiagnostic(code, documentLocation()).severity === "warning",
    );

    expect(warnings).toEqual([
      "NODE_TYPE_DEPRECATED",
      "NODE_CAPABILITY_UNAVAILABLE",
    ]);
  });
});
