import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const applicationFrameStyles = readFileSync(
  resolve(process.cwd(), "src/app-shell/application-frame.css"),
  "utf8",
);

function readRule(selector) {
  return applicationFrameStyles.match(
    new RegExp(`^${selector}\\s*\\{([^}]*)\\}`, "m"),
  )?.[1];
}

describe("application frame performance styles", () => {
  it("keeps persistent application chrome out of opacity animation layers", () => {
    const topBarRule = readRule("\\.top-application-bar");
    const panelRule = readRule("\\.application-panel");

    expect(topBarRule).toBeDefined();
    expect(panelRule).toBeDefined();
    expect(topBarRule).not.toMatch(/\\banimation\\s*:/);
    expect(panelRule).not.toMatch(/\\banimation\\s*:/);
    expect(applicationFrameStyles).not.toContain("application-bar-enter");
    expect(applicationFrameStyles).not.toContain("application-panel-enter");
  });

  it("keeps the node palette flyout compact", () => {
    const flyoutRule = readRule("\\.node-palette__flyout");

    expect(flyoutRule).toBeDefined();
    expect(flyoutRule).toContain("width: min(260px, calc(100vw - 16px))");
  });
});
