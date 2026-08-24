import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  resolveBilingualTitle,
  type BilingualTitle,
} from "../../localization/bilingual-title";
import { translateDataKey } from "../../localization/data-keys";
import { SUPPORTED_LOCALES } from "../../localization/locales";
import { useNodeRegistry } from "../registry/registry-store";
import {
  buildPaletteEntries,
  type PaletteEntry,
  type PaletteEntryText,
  type PaletteTextLookup,
} from "./palette-model";

/** One entry rendered in the user's language, with the other language kept as a secondary
 * line by the shared bilingual-title boundary, plus its description. */
export interface PaletteEntryLabels extends BilingualTitle {
  description: string;
}

export interface PaletteCatalog {
  entries: readonly PaletteEntry[];
  /** Searchable text covering every display language. */
  lookup: PaletteTextLookup;
  describe: (entry: PaletteEntry) => PaletteEntryLabels;
}

export function usePaletteCatalog(): PaletteCatalog | undefined {
  const registry = useNodeRegistry();
  const { i18n, t } = useTranslation();
  const language = i18n.language;

  return useMemo(() => {
    if (!registry) {
      return undefined;
    }
    const entries = buildPaletteEntries(registry);

    const inEveryLanguage = (key: string): string[] =>
      SUPPORTED_LOCALES.map((locale) =>
        i18n.getFixedT(locale)(key, { defaultValue: key }),
      );

    const lookup: PaletteTextLookup = (entry): PaletteEntryText => ({
      titles: inEveryLanguage(entry.titleKey),
      keywords: entry.keywordKeys.flatMap(inEveryLanguage),
      descriptions: inEveryLanguage(entry.descriptionKey),
    });

    const describe = (entry: PaletteEntry): PaletteEntryLabels => ({
      ...resolveBilingualTitle(t, i18n, language, entry.titleKey),
      description: translateDataKey(t, entry.descriptionKey, ""),
    });

    return { entries, lookup, describe };
  }, [i18n, language, registry, t]);
}
