import type { i18n as I18next, TFunction } from "i18next";

import { translateDataKey } from "./data-keys";
import { SUPPORTED_LOCALES, type SupportedLocale } from "./locales";

export interface BilingualTitle {
  /** The name in the user's display language. */
  title: string;
  /** The name in the other display language, absent when both languages agree. */
  secondaryTitle: string | undefined;
}

/** Translators bound to one locale each.
 *
 * `getFixedT` builds a new function on every call, which a node header drawn several
 * hundred times in one graph cannot afford. A bound translator does not depend on the
 * currently selected language, so keeping it for the lifetime of its i18next instance is
 * safe; the instance is the key so a test that builds its own is not served another's. */
const boundTranslators = new WeakMap<I18next, Map<string, TFunction>>();

function translatorFor(i18next: I18next, locale: SupportedLocale): TFunction {
  let byLocale = boundTranslators.get(i18next);
  if (byLocale === undefined) {
    byLocale = new Map<string, TFunction>();
    boundTranslators.set(i18next, byLocale);
  }
  let translator = byLocale.get(locale);
  if (translator === undefined) {
    translator = i18next.getFixedT(locale);
    byLocale.set(locale, translator);
  }
  return translator;
}

/** Resolves a registry title into the pair the interface shows.
 *
 * Node names appear in the user's language with the other language on a second line,
 * because automation documentation, node type keys, and community material are written in
 * English while the product is Simplified Chinese first. Hiding either name would make the
 * two harder to connect.
 *
 * The palette and the node header both use this, so a node cannot be named one way in the
 * list it is dragged from and another way once it is on the canvas.
 *
 * The display language is passed rather than read from the instance, so a caller that
 * memoizes this result states the value its result actually depends on.
 */
export function resolveBilingualTitle(
  translate: TFunction,
  i18next: I18next,
  displayLanguage: string,
  titleKey: string,
  fallback?: string,
): BilingualTitle {
  const title = translateDataKey(translate, titleKey, fallback);
  const secondaryTitle = SUPPORTED_LOCALES.filter(
    (locale) => locale !== displayLanguage,
  )
    .map((locale) =>
      translateDataKey(translatorFor(i18next, locale), titleKey, ""),
    )
    .find((candidate) => candidate.length > 0 && candidate !== title);

  return { title, secondaryTitle };
}
