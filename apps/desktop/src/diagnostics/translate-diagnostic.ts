import type { TFunction, TOptions } from "i18next";

import type { DiagnosticParameters, LocalizationKey } from "./diagnostic-model";

/** Translates a diagnostic message with its interpolation parameters.
 *
 * Diagnostic parameters are a general bag of safe scalars, while the localization
 * function types its options per key. This is the single place that bridges the two, so
 * the narrowing is stated once instead of repeated at every call site.
 */
export function translateDiagnostic(
  translate: TFunction,
  key: LocalizationKey,
  parameters: DiagnosticParameters | undefined,
): string {
  const options = {
    ...parameters,
    // The catalogs are bundled and key-parity is enforced by test, so a missing key means
    // a development mistake. Showing the key makes that visible instead of blank text.
    defaultValue: key,
  } as TOptions & { defaultValue: string };

  return translate(key, options);
}
