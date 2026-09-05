import { listen } from "@tauri-apps/api/event";

import {
  getSplashscreenCopy,
  parseStartupStagePayload,
  resolveSplashLocale,
  STARTUP_STAGE_EVENT_NAME,
  type SplashLocale,
  type StartupStage,
} from "./startup-stage";

type SplashscreenDocument = Pick<
  Document,
  "documentElement" | "getElementById"
>;

export function renderSplashscreenStage(
  targetDocument: SplashscreenDocument,
  stage: StartupStage,
  locale: SplashLocale,
): void {
  const copy = getSplashscreenCopy(locale);
  const statusElement = targetDocument.getElementById("startup-status");
  if (statusElement !== null) {
    const status = copy.stages[stage].status;
    statusElement.textContent = status;
    statusElement.dataset["stage"] = stage;
    statusElement.setAttribute("aria-label", status);
  }
  const contextElement = targetDocument.getElementById("startup-context");
  if (contextElement !== null) {
    contextElement.textContent = copy.context;
  }
  const subtitleElement = targetDocument.getElementById("startup-subtitle");
  if (subtitleElement !== null) {
    subtitleElement.textContent = copy.subtitle;
  }
  targetDocument.documentElement.lang = locale;
}

/** Starts the lightweight splash listener without loading the application i18n bundle. */
export async function mountSplashscreen(
  targetDocument: SplashscreenDocument = document,
  language = navigator.language,
): Promise<void> {
  const locale = resolveSplashLocale(language);
  renderSplashscreenStage(targetDocument, "initializing", locale);

  try {
    await listen<unknown>(STARTUP_STAGE_EVENT_NAME, ({ payload }) => {
      const stage = parseStartupStagePayload(payload);
      if (stage !== undefined) {
        renderSplashscreenStage(targetDocument, stage, locale);
      }
    });
  } catch {
    // The native listener is unavailable in browser previews; the static splash remains.
  }
}
