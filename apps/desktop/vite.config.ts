import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const desktopRoot = fileURLToPath(new URL(".", import.meta.url));

const dependencyChunkRules = [
  {
    name: "react-core",
    packages: [
      "react",
      "react-dom",
      "scheduler",
      "react-is",
      "use-sync-external-store",
    ],
  },
  {
    name: "graph-runtime",
    packages: ["@xyflow/react", "@xyflow/system", "zustand"],
  },
  {
    name: "ui-primitives",
    packages: [
      "@radix-ui",
      "@floating-ui",
      "aria-hidden",
      "react-remove-scroll",
      "react-remove-scroll-bar",
      "react-style-singleton",
    ],
  },
  {
    name: "motion",
    packages: ["motion", "motion-dom", "motion-utils"],
  },
  {
    name: "localization",
    packages: ["i18next", "react-i18next"],
  },
  { name: "icons", packages: ["lucide-react"] },
  { name: "tauri-api", packages: ["@tauri-apps/api"] },
] as const;

function containsPackage(moduleId: string, packageName: string): boolean {
  return moduleId.includes(`/node_modules/${packageName}/`);
}

export function resolveManualChunk(moduleId: string): string | undefined {
  const normalizedId = moduleId.replaceAll("\\", "/");

  if (normalizedId.includes("/packages/contracts-ts/")) {
    return "rino-contracts";
  }
  if (!normalizedId.includes("/node_modules/")) {
    return undefined;
  }

  for (const rule of dependencyChunkRules) {
    if (
      rule.packages.some((packageName) =>
        containsPackage(normalizedId, packageName),
      )
    ) {
      return rule.name;
    }
  }

  return undefined;
}

export default defineConfig({
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(desktopRoot, "index.html"),
        splashscreen: resolve(desktopRoot, "splashscreen.html"),
      },
      output: {
        manualChunks: resolveManualChunk,
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    restoreMocks: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
