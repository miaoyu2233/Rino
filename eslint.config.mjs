import eslint from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/target/**",
      "**/release-local/**",
      "**/src/generated/**",
      "tools/spikes/**",
    ],
  },
  {
    files: ["apps/desktop/**/*.{ts,tsx}", "packages/contracts-ts/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...typescriptEslint.configs.strictTypeChecked,
      ...typescriptEslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: [
          "./apps/desktop/tsconfig.json",
          "./apps/desktop/tsconfig.node.json",
          "./packages/contracts-ts/tsconfig.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      "react-refresh/only-export-components": [
        "error",
        { allowConstantExport: true },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@tauri-apps/plugin-shell",
              message:
                "The frontend must never gain shell or process execution capability.",
            },
            {
              name: "child_process",
              message:
                "Operating-system process APIs are not available to the webview.",
            },
            {
              name: "node:child_process",
              message:
                "Operating-system process APIs are not available to the webview.",
            },
          ],
        },
      ],
    },
  },
);
