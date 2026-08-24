import type { Resource } from "i18next";

import { enUSTranslation } from "./en-US";
import { zhCNTranslation } from "./zh-CN";

export const DEFAULT_NAMESPACE = "translation";

export const localizationResources = {
  "zh-CN": {
    [DEFAULT_NAMESPACE]: zhCNTranslation,
  },
  "en-US": {
    [DEFAULT_NAMESPACE]: enUSTranslation,
  },
} as const satisfies Resource;

export { enUSTranslation, zhCNTranslation };
