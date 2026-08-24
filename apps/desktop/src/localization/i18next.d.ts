import "i18next";

import type { zhCNTranslation } from "./catalogs/zh-CN";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    returnNull: false;
    resources: {
      translation: typeof zhCNTranslation;
    };
  }
}
