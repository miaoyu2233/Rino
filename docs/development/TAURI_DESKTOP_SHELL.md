# Tauri Desktop Shell

> Task: P1-T02  
> Status: Implemented and verified  
> Scope: Main desktop window, WebView security boundary, private application directories, and startup failure diagnostics

## 1. Ownership

The Rust crate under `apps/desktop/src-tauri` owns the native desktop process. It creates the only production WebView window, resolves private operating-system directories, retains native application state, and enforces the boundary between bundled frontend code and native capabilities.

This task does not add application layout, theme behavior, project persistence, a Python Sidecar, MaaFramework, graph execution, device access, network services, or arbitrary frontend-to-Rust commands.

## 2. Main-window contract

`tauri.conf.json` declares exactly one startup window:

| Setting                   | Value                                                     | Reason                                                                            |
| ------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Label                     | `main`                                                    | Stable capability and future state-restoration identity                           |
| Initial size              | 1280 by 800 logical pixels                                | Comfortable editor baseline without assuming a physical display resolution        |
| Minimum size              | 1100 by 700 logical pixels                                | Matches the minimum usable workspace defined by the frontend style guide          |
| Native frame              | Decorated, resizable, minimizable, maximizable, closable  | Preserves standard desktop behavior and operating-system accessibility            |
| Initial placement         | Centered, visible, focused, not maximized, not fullscreen | Predictable first launch without taking over the display                          |
| Transparency and stacking | Opaque, normal stacking, present in the taskbar           | Avoids fragile composition effects and surprising window behavior                 |
| Browser extensions        | Disabled                                                  | Prevents extension installation in the application WebView                        |
| General autofill          | Disabled                                                  | Avoids unrelated browser suggestions in editor fields                             |
| Zoom hotkeys              | Disabled                                                  | Prevents accidental WebView zoom from breaking the editor's measured layout       |
| Native file drag/drop     | Disabled                                                  | Enables controlled HTML5 drag interactions on Windows for the future node palette |

The frontend remains responsible for responsive layout inside this native window. No browser tab or external browser is used as the product surface.

## 3. Frontend capability boundary

The enabled `main-local` capability applies only to bundled local content in the `main` window and has no remote URL association. It grants exactly four read-only permissions consumed by the responsive layout hook: `core:window:allow-inner-size`, `core:window:allow-scale-factor`, `core:event:allow-listen`, and `core:event:allow-unlisten`. It deliberately exposes no shell operation, filesystem operation, process operation, custom invoke command, or state-mutating window command to frontend JavaScript.

The following controls make that boundary explicit:

- `withGlobalTauri` is false, so no `window.__TAURI__` bridge is injected.
- The capability permission list contains only the four reviewed read-only permissions above and is explicitly selected by identifier in `tauri.conf.json`.
- The Rust builder registers no invoke handler.
- Neither the Rust manifest nor the frontend manifest contains a shell plugin.
- The Tauri dependency enables only the `wry` runtime feature; release WebView developer tools are not enabled.
- Browser-extension support and the asset protocol are disabled.
- Tauri's build-time CSP modification remains enabled.

The bundled frontend executes as normal browser JavaScript inside the system WebView. It has no Node.js runtime, Node.js module loader, or direct operating-system command surface. Later tasks must grant each required native operation through a reviewed, narrowly scoped capability rather than broadening `main-local` by default.

## 4. Content Security Policy

The production policy accepts bundled content and Tauri's local IPC transport only. It rejects remote HTTP and WebSocket sources, plugins, embedded frames, form submission targets, and object content. Scripts and styles remain subject to Tauri's generated nonce and hash processing.

Development has a separate policy. It permits only the fixed local Vite origin and its local WebSocket endpoint in addition to the production transport. The development-only inline-style exception supports Vite hot replacement and does not enter the production policy.

Remote scripts, styles, fonts, images, frames, Markdown resources, analytics, and content-delivery networks remain prohibited.

## 5. Private application directories

Rust resolves the following locations through Tauri's `PathResolver`; no operating-system path is hard-coded and no resolved path is sent to the frontend:

| Logical directory | Resolver        | Intended ownership                                         |
| ----------------- | --------------- | ---------------------------------------------------------- |
| Application data  | `app_data_dir`  | Durable application-owned state and future local databases |
| Application cache | `app_cache_dir` | Rebuildable, bounded cache content                         |
| Application logs  | `app_log_dir`   | Local-only diagnostic output                               |

All three directories are created before the event loop starts. Resolution and creation have distinct startup stages and stable error codes. The resolved `ApplicationDirectories` value is stored as Rust application state for later native services; it is not a frontend API.

Future owners must define retention, size limits, file permissions, migration, and deletion behavior before writing content. User projects and screenshots must not be placed in these directories implicitly.

## 6. Structured startup diagnostics

Desktop construction, path resolution, and directory creation return `StartupError`. The original native error remains available through Rust's error source chain, but its message and path are deliberately excluded from normal debug, display, and serialized output.

The process emits one compact JSON object with this stable shape:

```json
{
  "schemaVersion": 1,
  "application": "rino-desktop",
  "severity": "error",
  "code": "APP_DATA_DIRECTORY_CREATE_FAILED",
  "stage": "createAppData",
  "failureKind": "io",
  "osErrorCode": 5
}
```

`osErrorCode` is present only when the source is an operating-system I/O error. Source messages, absolute paths, user names, environment values, and arbitrary error text are never serialized.

On startup failure, the JSON is written to standard error and best-effort persisted as `rino-startup-error-v1.json` in the operating system's temporary directory. The fixed file is overwritten by the next startup failure and is private diagnostic material. Failure to persist it produces a separate redacted diagnostic on standard error. This fallback exists because the normal application log directory may itself be the failing resource.

Release builds use the Windows GUI subsystem so the application does not open a console window. The temporary diagnostic remains available to a future recovery UI or support workflow without exposing native error detail to the WebView.

## 7. Verification

Rust tests cover:

- exactly one safe `main` window and its minimum dimensions;
- disabled global Tauri injection, browser extensions, autofill, and native drag/drop;
- a local-only, main-window-only capability whose permission list contains exactly the four reviewed read-only window-metrics and event permissions;
- a production CSP with no remote HTTPS or WebSocket source;
- absence of the shell plugin and custom invoke handlers;
- redaction of native source messages from JSON, `Debug`, and `Display` output.

The Tauri no-bundle release build validates `tauri.conf.json`, the generated capability schema, the frontend production build, the Rust application, and Windows resources together. The unified workspace check runs the same Rust unit and integration tests under the locked dependency graph.

## 8. Change rules

Any later change to windows, WebViews, CSP, capabilities, plugins, invoke handlers, application directories, startup reporting, or release runtime features must:

1. State the user-visible or native requirement that needs the new authority.
2. Add the narrowest permission to the narrowest window or WebView.
3. Add a regression test for the exact new boundary.
4. Review local data, privacy, logging, and publication impact.
5. Update this document and the dependency inventory when the native dependency graph changes.

The empty P1-T02 capability is a secure baseline, not a placeholder for later broad permissions.
