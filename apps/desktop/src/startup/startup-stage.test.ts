import { beforeEach, describe, expect, it, vi } from "vitest";

const { listen } = vi.hoisted(() => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen }));

import {
  getSplashscreenCopy,
  parseStartupStagePayload,
  resolveSplashLocale,
  STARTUP_STAGE_EVENT_NAME,
} from "./startup-stage";
import { mountSplashscreen, renderSplashscreenStage } from "./splashscreen";

beforeEach(() => {
  listen.mockReset();
  document.body.innerHTML =
    '<span id="startup-context"></span><span id="startup-status" aria-live="polite"></span><span id="startup-subtitle"></span>';
  document.documentElement.lang = "zh-CN";
});

describe("startup stage payloads and splash localization", () => {
  it("accepts only the fixed startup stage allowlist", () => {
    expect(parseStartupStagePayload("runtime")).toBe("runtime");
    expect(parseStartupStagePayload("deviceDiscovery")).toBeUndefined();
    expect(parseStartupStagePayload({ stage: "runtime" })).toBeUndefined();
    expect(parseStartupStagePayload(null)).toBeUndefined();
  });

  it("resolves Chinese and English splash locales", () => {
    expect(resolveSplashLocale("zh-CN")).toBe("zh-CN");
    expect(resolveSplashLocale("zh-TW")).toBe("zh-CN");
    expect(resolveSplashLocale("en-US")).toBe("en-US");
    expect(resolveSplashLocale(undefined)).toBe("en-US");
  });

  it("updates localized status text and stage metadata", () => {
    renderSplashscreenStage(document, "registry", "zh-CN");

    expect(document.getElementById("startup-status")?.textContent).toBe(
      getSplashscreenCopy("zh-CN").stages.registry.status,
    );
    expect(document.getElementById("startup-status")?.dataset["stage"]).toBe(
      "registry",
    );
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("keeps the current stage when an event payload is unknown", async () => {
    await mountSplashscreen(document, "en-US");
    const listener = listen.mock.calls[0]?.[1] as
      ((event: { payload: unknown }) => void) | undefined;

    expect(listen).toHaveBeenCalledWith(
      STARTUP_STAGE_EVENT_NAME,
      expect.any(Function),
    );
    expect(document.getElementById("startup-status")?.dataset["stage"]).toBe(
      "initializing",
    );

    listener?.({ payload: "runtime" });
    expect(document.getElementById("startup-status")?.dataset["stage"]).toBe(
      "runtime",
    );
    listener?.({ payload: { stage: "opening" } });
    expect(document.getElementById("startup-status")?.dataset["stage"]).toBe(
      "runtime",
    );
  });
});
