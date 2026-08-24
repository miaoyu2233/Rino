# Localization Foundation

> Task: P1-T04  
> Status: Implemented and automatically verified  
> Scope: Bundled catalogs, locale detection, explicit preference, React integration, document metadata, fallback, and development diagnostics

## 1. Runtime boundary

Rino uses `i18next 26.3.6` for catalog resolution and `react-i18next 17.0.11` for React subscriptions. Both catalogs are imported into the application bundle. The runtime installs no HTTP backend, remote loader, browser detector plugin, localization service client, or translation extraction service.

The localization layer owns display language only. It does not alter graph semantics, number-parsing rules, OCR language selection, persistent project data, device behavior, or Sidecar execution. Those domains must use explicit configuration rather than inferring behavior from the interface locale.

## 2. Supported locales

The supported display locales are:

| Locale  | Role                                    |
| ------- | --------------------------------------- |
| `zh-CN` | Primary product catalog                 |
| `en-US` | Supported catalog and language fallback |

The stable preference values are `system`, `zh-CN`, and `en-US`. The preference is stored under `rino.locale-preference.v1` and is local user data. Invalid or inaccessible storage falls back to `system` without preventing startup.

System detection reads browser language preferences in priority order. Chinese language tags resolve to `zh-CN`, English tags resolve to `en-US`, and unsupported language lists resolve to the primary `zh-CN` catalog. An explicit preference always overrides system detection. While `system` is active, the provider responds to operating-system language changes.

## 3. Catalog contract

The catalogs live in `apps/desktop/src/localization/catalogs`. The Simplified Chinese catalog defines the authoritative TypeScript shape, and the English catalog must satisfy the same recursive string structure. Automated tests compare every leaf key and reject blank values.

Keys use stable semantic paths such as `common.actions.save`; translated sentences are values, never identifiers. Feature code must not concatenate translated fragments or derive keys from user input. Later namespaces may be introduced only when they establish a clear ownership boundary and preserve deterministic fallback.

Rino is the locale-invariant product name. The initial document title resolves through `app.title`, while the native compile-time window title remains the same product name in both catalogs.

## 4. Initialization and React integration

All resources are synchronous and local. The application initializes i18next with `initAsync: false` before React mounts, then applies the resolved locale to the document `lang`, `dir`, and title metadata. This avoids a startup language flash and gives assistive technology the correct document language.

`LocaleProvider` owns the live preference, detected system locale, cross-view storage updates, operating-system language events, and i18next language changes. Components read locale state through `useLocale` and translated content through `useTranslation`. New user-facing strings must enter a catalog before use.

The provider reports whether explicit preference persistence succeeded. A storage failure still updates the in-memory session; the settings UI and notification policy introduced by later tasks decide how to present persistence failures.

## 5. Fallback and diagnostics

`en-US` is the production language fallback. Empty values are treated as invalid, so a missing or empty `zh-CN` value resolves from English when available. A key missing from both catalogs falls back to its key in production, but catalog parity tests are expected to prevent this for static product strings.

Development builds enable a bounded, deduplicated missing-key handler. The first occurrence emits a local console diagnostic and renders `[missing:key.path]` so the defect is visible. Production builds disable missing-key logging and markers. No missing-key data is uploaded, persisted, or sent to a service.

## 6. Security and privacy

- Catalogs are trusted, reviewed source files bundled at compile time.
- Project files, graph packages, Sidecar messages, and downloaded scripts cannot inject catalog resources.
- Translation values are rendered as text through React; this task does not introduce raw HTML translation rendering.
- Locale preference never leaves the local WebView data directory.
- Locale diagnostics contain catalog identifiers only and are development-only.
- Adding a remote localization backend, telemetry, automatic translation, or catalog synchronization requires explicit user approval and a separate security review.

## 7. Extension rules

- Keep both catalogs complete in the same change that introduces a key.
- Use complete sentences and interpolation parameters rather than concatenated fragments.
- Keep node registry metadata as localization keys, not translated runtime strings.
- Keep Chinese and English node titles separately addressable because node headers later display both languages.
- Format display numbers, dates, units, and lists through an explicit locale formatter boundary.
- Keep numeric parsing and project serialization independent of display locale.
- Do not place logs, protocol fields, identifiers, or persistent enum values behind translated strings.

## 8. Verification evidence

Automated tests cover catalog parity, blank values, supported preference validation, language-family detection, unsupported-language behavior, explicit preference persistence, inaccessible storage, document metadata, English fallback, development missing-key diagnostics, production diagnostic suppression, system-language changes, cross-view storage updates, and application-root integration.

The production build proves that both catalogs and the provider compile into the local desktop bundle without a localization backend. The complete workspace check and Tauri release build remain the acceptance commands for this task.
