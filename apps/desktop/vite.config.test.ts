import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import tauriConfig from "./src-tauri/tauri.conf.json";
import viteConfig, { resolveManualChunk } from "./vite.config";

const applicationFrameCss = readFileSync(
  resolve(process.cwd(), "src/app-shell/application-frame.css"),
  "utf8",
);

describe("desktop development server contract", () => {
  it("runs package scripts through the pinned Corepack pnpm", () => {
    expect(tauriConfig.build.beforeDevCommand).toBe("corepack pnpm dev");
    expect(tauriConfig.build.beforeBuildCommand).toBe("corepack pnpm build");
  });

  it("matches the fixed local Tauri development URL", () => {
    const devUrl = new URL(tauriConfig.build.devUrl);

    expect(viteConfig.server).toMatchObject({
      host: devUrl.hostname,
      port: Number(devUrl.port),
      strictPort: true,
    });
    expect(devUrl.protocol).toBe("http:");
    expect(devUrl.hostname).toBe("127.0.0.1");
    expect(tauriConfig.app.security.devCsp).toContain(
      "http://127.0.0.1:1420",
    );
    expect(tauriConfig.app.security.devCsp).toContain(
      "ws://127.0.0.1:1420",
    );
  });
});

describe("desktop frame layout contract", () => {
  it("fills the viewport and reserves explicit application rows", () => {
    expect(applicationFrameCss).toMatch(
      /\.application-frame\s*\{[^}]*height:\s*100vh;[^}]*height:\s*100dvh;[^}]*grid-template-rows:\s*40px minmax\(0, 1fr\);/s,
    );
  });
});

describe("desktop production chunk boundaries", () => {
  it.each([
    ["react", "react-core"],
    ["react-dom", "react-core"],
    ["@xyflow/react", "graph-runtime"],
    ["zustand", "graph-runtime"],
    ["@radix-ui/react-dialog", "ui-primitives"],
    ["motion", "motion"],
    ["react-i18next", "localization"],
    ["lucide-react", "icons"],
    ["@tauri-apps/api", "tauri-api"],
  ])("assigns %s to the stable %s chunk", (packageName, expectedChunk) => {
    expect(
      resolveManualChunk(
        `C:/workspace/node_modules/.pnpm/example/node_modules/${packageName}/index.js`,
      ),
    ).toBe(expectedChunk);
  });

  it("separates generated runtime contracts from application code", () => {
    expect(
      resolveManualChunk(
        "C:/workspace/packages/contracts-ts/src/generated/rino-ipc-v1.schema.ts",
      ),
    ).toBe("rino-contracts");
    expect(
      resolveManualChunk("C:/workspace/apps/desktop/src/app/App.tsx"),
    ).toBeUndefined();
  });

  it("normalizes Windows module paths before matching packages", () => {
    expect(
      resolveManualChunk(
        "C:\\workspace\\node_modules\\.pnpm\\lucide-react@1.25.0\\node_modules\\lucide-react\\dist\\cjs\\lucide-react.js",
      ),
    ).toBe("icons");
  });
});
