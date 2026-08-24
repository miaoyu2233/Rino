import { useTranslation } from "react-i18next";

import { Button } from "../components/ui/Button";
import { useTheme } from "../design-system/theme/useTheme";
import { THEME_PREFERENCES } from "../design-system/theme/theme-state";
import { LOCALE_PREFERENCES } from "../localization/locale-state";
import { useLocale } from "../localization/useLocale";

const THEME_LABEL_KEYS = {
  system: "theme.preferences.system",
  light: "theme.preferences.light",
  dark: "theme.preferences.dark",
} as const;

const LOCALE_LABEL_KEYS = {
  system: "locale.preferences.system",
  "zh-CN": "locale.preferences.zhCN",
  "en-US": "locale.preferences.enUS",
} as const;

/** Theme and display-language overrides.
 *
 * Both preferences follow the operating system by default; these controls make the
 * explicit override required by the visual and localization contracts reachable.
 */
export function AppearanceSettings() {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useLocale();

  return (
    <section className="appearance-settings">
      <div className="appearance-settings__group" role="group">
        <h3 id="appearance-theme-label">{t("theme.label")}</h3>
        <p>{t("theme.description")}</p>
        <div
          className="appearance-settings__options"
          role="radiogroup"
          aria-labelledby="appearance-theme-label"
        >
          {THEME_PREFERENCES.map((preference) => (
            <Button
              key={preference}
              role="radio"
              size="compact"
              aria-checked={theme.preference === preference}
              variant={theme.preference === preference ? "primary" : "ghost"}
              onClick={() => {
                theme.setPreference(preference);
              }}
            >
              {t(THEME_LABEL_KEYS[preference])}
            </Button>
          ))}
        </div>
      </div>

      <div className="appearance-settings__group" role="group">
        <h3 id="appearance-locale-label">{t("locale.languageLabel")}</h3>
        <p>{t("locale.description")}</p>
        <div
          className="appearance-settings__options"
          role="radiogroup"
          aria-labelledby="appearance-locale-label"
        >
          {LOCALE_PREFERENCES.map((preference) => (
            <Button
              key={preference}
              role="radio"
              size="compact"
              aria-checked={locale.preference === preference}
              variant={locale.preference === preference ? "primary" : "ghost"}
              onClick={() => {
                locale.setPreference(preference);
              }}
            >
              {t(LOCALE_LABEL_KEYS[preference])}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}
