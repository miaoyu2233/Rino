# Production Workspace Scaffolding

## Status

- Task: `P1-T01`
- Scaffold date: 2026-07-24
- Host: Windows x86-64
- Result: Passed

This document records the initial production workspace boundary. It is not the product UI, the final Tauri security configuration, or the Python graph runtime implementation.

## Scope

P1-T01 establishes:

- a root pnpm workspace with exact direct dependency versions and a frozen lockfile;
- strict TypeScript, ESLint, Prettier, Vitest, and Vite entry points;
- a minimal React mount boundary with no product behavior;
- a root Cargo workspace containing the initial Tauri package and frozen lockfile;
- a root uv workspace containing the typed Python runtime package and frozen lockfile;
- one offline-first validation command covering all three ecosystems;
- publication-safe ignore rules for local caches, dependencies, builds, tests, and packaging artifacts.

The following work remains outside this task:

- main-window policy, capabilities, application paths, and structured startup errors in `P1-T02`;
- semantic design tokens, themes, fonts, motion, and final icon mapping in `P1-T03`;
- localization catalogs in `P1-T04`;
- the full application frame in `P1-T05`;
- Sidecar lifecycle and production IPC in Phase 2;
- graph editing and execution in later phases.

## Repository structure created

```text
apps/desktop/
├─ src/
│  ├─ app/
│  └─ test/
└─ src-tauri/
   ├─ icons/
   └─ src/
services/runtime/
├─ src/rino_runtime/
└─ tests/
```

The root owns shared package-manager and quality configuration. Feature code remains in its owning application or service. No shared UI package was created because there is no second consumer.

## Toolchain and direct versions

| Boundary | Pinned baseline |
| --- | --- |
| Node.js | 24.x; verified with 24.13.0 |
| pnpm | 11.9.0 |
| TypeScript | 6.0.3 |
| React and React DOM | 19.2.8 |
| Vite | 8.1.5 |
| Vitest | 4.1.10 |
| Tauri JavaScript API and CLI | 2.11.1 and 2.11.4 |
| Rust | 1.96.1, edition 2024 |
| Tauri Rust crate | 2.11.5 |
| Tauri build crate | 2.6.3 |
| Python | 3.13.x; verified with 3.13.5 |
| uv | 0.10.x; verified with 0.10.9 |
| Ruff, Pyright, and pytest | 0.16.0, 1.1.411, and 9.1.1 |

TypeScript 7.0.2 was not selected because the pinned typescript-eslint 8.65.0 release declares support below TypeScript 6.1. The workspace uses the newest compatible TypeScript 6 release instead of suppressing peer constraints.

## Bootstrap and checks

Initial dependency acquisition requires explicit network access:

```powershell
pnpm install
uv sync --all-packages --group dev
cargo fetch --locked
```

After bootstrap, the routine full check is offline-first:

```powershell
pwsh -NoProfile -File tools/check-workspace.ps1
```

The command verifies frozen pnpm and uv environments, frontend formatting/linting/types/tests/build, Rust formatting/linting/tests, and Python formatting/linting/types/tests.

The Tauri compilation acceptance command is intentionally separate because a release build is substantially slower:

```powershell
pnpm --filter @rino/desktop run tauri build --no-bundle
```

This produces a local executable under the ignored Cargo target directory. It does not create an installer, sign an artifact, publish a release, or contact a remote service at runtime.

## Scaffold application boundary

The React application currently renders only an empty semantic `main` root. This is intentional scaffolding, not a simulated editor. It contains no graph, device, Sidecar, runtime, network, update, catalog, or publication behavior.

The Tauri configuration declares no windows and no capabilities during P1-T01. P1-T02 must define the actual main window and least-privilege authority before development launch is accepted.

Tauri's Windows resource compiler requires an `.ico` during Rust compilation. `scaffold-source.svg` is an original local geometric source used only to satisfy this build requirement. It is not the final product identity and contains no copied third-party artwork. The UI icon system remains a later static Lucide mapping.

## Validation evidence

The final P1-T01 run passed:

- frozen offline pnpm install;
- Prettier, ESLint, strict TypeScript, one React mount-boundary test, and Vite production build;
- Cargo formatting, Clippy with warnings denied, tests, and all-target checks;
- uv lock verification and offline sync;
- Ruff formatting and linting, Pyright strict mode, one Python package-boundary test, and wheel/source-package build;
- Tauri CLI release compilation with `--no-bundle`.

No Git repository, commit, push, browser launch, installer, remote publication, telemetry, or product network behavior was created.
