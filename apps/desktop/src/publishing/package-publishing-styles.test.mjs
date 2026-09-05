import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const applicationFrameStyles = readFileSync(
  resolve(process.cwd(), "src/app-shell/application-frame.css"),
  "utf8",
);

describe("package publishing dialog styles", () => {
  it("keeps package settings vertically scrollable in short windows", () => {
    const dialogBodyRule = applicationFrameStyles.match(
      /^\.publishing-dialog > \.ui-dialog__body\s*\{([^}]*)\}/m,
    )?.[1];

    expect(dialogBodyRule).toContain("overflow-y: auto");
    expect(dialogBodyRule).toContain("overscroll-behavior: contain");
  });
});
