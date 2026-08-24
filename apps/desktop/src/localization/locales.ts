export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const PRIMARY_LOCALE: SupportedLocale = "zh-CN";
export const FALLBACK_LOCALE: SupportedLocale = "en-US";

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return SUPPORTED_LOCALES.some((locale) => locale === value);
}
