import type { TFunction } from "i18next";

/** Looks up a translation whose key comes from data rather than from source.
 *
 * Node definitions carry localization keys, so the key cannot be a literal the catalog
 * types know about. This is the single place where that narrowing happens, and it falls
 * back to the key itself so a missing translation is visible during development instead
 * of rendering as blank text.
 */
type DataKeyLookup = (key: string, options: { defaultValue: string }) => string;

export function translateDataKey(
  translate: TFunction,
  key: string,
  fallback: string = key,
): string {
  const lookup = translate as unknown as DataKeyLookup;
  return lookup(key, { defaultValue: fallback });
}

type DataMessageLookup = (
  key: string,
  options: Record<string, string | number | boolean>,
) => string;

/** Looks up a data-supplied key whose message interpolates values.
 *
 * Validation diagnostics carry a key and a bounded set of scalars rather than translated
 * text, so the message reads in the user's language whether it was produced by the editor
 * or by the runtime. */
export function translateDataMessage(
  translate: TFunction,
  key: string,
  parameters: Record<string, string | number | boolean>,
  fallback: string,
): string {
  const lookup = translate as unknown as DataMessageLookup;
  return lookup(key, { ...parameters, defaultValue: fallback });
}
