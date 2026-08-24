# Design System Foundation

> Task: P1-T03  
> Status: Implementation and automated verification complete; multi-scale visual inspection pending  
> Scope: Semantic tokens, light and dark themes, typography, motion, icon mapping, and theme preference infrastructure

## 1. Design direction

The Rino design system is professional, calm, precise, and responsive. It uses softly warm neutral surfaces in light mode and low-chroma graphite surfaces in dark mode. Accent and type colors are moderated so the graph can remain readable for long sessions without becoming neon or visually noisy.

Feature components consume semantic CSS variables or their Tailwind aliases. Raw palette values remain confined to the authoritative theme layer in `src/styles.css`.

P1-T03 does not add the application frame, node canvas, settings interface, project controls, or device preview. Those features consume this foundation in their owning tasks.

## 2. Theme contract

The supported preferences are:

| Preference | Behavior                                                  |
| ---------- | --------------------------------------------------------- |
| `system`   | Follow the live operating-system color-scheme preference  |
| `light`    | Use the Rino light theme regardless of the system setting |
| `dark`     | Use the Rino dark theme regardless of the system setting  |

`system` is the default. The current preference is stored under the versioned local key `rino.theme-preference.v1`. Invalid or inaccessible storage falls back to `system`; a storage failure never prevents application startup. The root element always receives both `data-theme` and `data-theme-preference`.

`initializeTheme` applies the initial state before React mounts. `ThemeProvider` then tracks operating-system changes, explicit overrides, and storage events from another application view. `useTheme` is the only component-facing preference API.

The preference is local user data. It remains inside the WebView data directory and is never logged, synchronized, published, or sent to a service.

## 3. Semantic color layers

The base semantic families are:

- background, primary surface, elevated surface, and interactive surface;
- normal and strong borders;
- primary, secondary, and muted text;
- accent, focus, success, warning, danger, and information states;
- subtle state backgrounds for readable non-color reinforcement.

Dark mode uses graphite surfaces with very low chroma. It does not use a saturated blue-black background. Light mode uses warm off-white surfaces instead of pure white across every layer.

Tailwind 4 maps the shared tokens through `@theme inline`, including semantic colors, UI and code fonts, and standard radii. Future feature code uses names such as `bg-background`, `bg-surface`, `text-text-primary`, and `border-border` rather than literal palette colors.

## 4. Graph token contract

Typed ports have fixed semantic hues:

| Port family | Token               | Meaning reinforcement                                   |
| ----------- | ------------------- | ------------------------------------------------------- |
| Execution   | `--port-exec`       | Neutral port with an execution-specific shape and label |
| Boolean     | `--port-boolean`    | Red family plus Boolean label or icon                   |
| Number      | `--port-number`     | Cyan family plus numeric label                          |
| String      | `--port-string`     | Violet family plus string label                         |
| Image       | `--port-image`      | Amber family plus image icon                            |
| Spatial     | `--port-spatial`    | Green family for rectangle and point values             |
| Collection  | `--port-collection` | Blue family plus collection marker                      |
| Unknown     | `--port-unknown`    | Neutral family plus explicit unknown marker             |

Category colors exist for flow, recognition, action, logic, data, and utility nodes. Node status tokens cover idle, hovered, selected, running, succeeded, failed, disabled, and breakpoint states. Color never becomes the only status indicator; later nodes must also use icons, labels, shapes, or badges.

## 5. Typography

The application self-hosts exact assets from:

- `@fontsource-variable/inter 5.3.0`, font source version v20, OFL-1.1;
- `@fontsource-variable/jetbrains-mono 5.3.0`, font source version v24, OFL-1.1.

Only normal Latin and Latin Extended variable WOFF2 files enter the frontend build. Chinese text falls through to the installed Windows UI font and then the system sans-serif family; it is not rendered with an incomplete Latin font. Technical text falls through to an installed system monospace when it contains unsupported glyphs.

The base UI size is 14 logical pixels. Metadata may use 12 pixels only when its contrast and context remain clear. UI uses tabular numerals for stable changing values. Code and protocol content disables font ligatures to keep characters unambiguous.

Fonts are bundled with the application and use `font-display: swap`. No remote font, stylesheet, content-delivery network, or runtime font request is permitted.

## 6. Spacing, geometry, and density

The spacing scale follows 4-pixel half steps and an 8-pixel primary grid. Compact controls are 32 logical pixels high and standard controls are 36. Icons use 14, 16, and 20 logical pixel tiers. Graph ports render at approximately 11 pixels with a 24-pixel interaction target.

Standard radii are 6 pixels for small controls, 8 for regular controls, 10 for nodes, and 12 for dialogs. Structural separators use one logical pixel. Selection and keyboard focus use a two-pixel ring and never remove the native semantic focus state without replacement.

Shadows communicate only raised or floating elevation. Repeated graph nodes must not use the floating shadow or expensive blur effects.

## 7. Motion and reduced motion

The shared duration tiers are:

| Tier     | Duration | Intended use                              |
| -------- | -------- | ----------------------------------------- |
| Micro    | 120 ms   | Hover, press, focus, and compact feedback |
| Standard | 190 ms   | Ordinary state transitions                |
| Panel    | 250 ms   | Panels, dialogs, and spatial continuity   |

The shared spatial spring uses stiffness 420, damping 34, and mass 0.8. It is interruptible and intentionally restrained.

The root `MotionConfig` uses `reducedMotion="user"`. CSS also collapses shared durations and nonessential animation when the operating system requests reduced motion. Later runtime visualization must replace continuous execution motion with a static state icon under reduced motion.

## 8. Tooltip tiers

Tooltip timing is centralized:

| Tier     | Delay  | Use                                                               |
| -------- | ------ | ----------------------------------------------------------------- |
| Brief    | 300 ms | Unlabeled toolbar icons and immediately useful affordances        |
| Standard | 500 ms | Named controls and ordinary node parameters                       |
| Detailed | 700 ms | Dense graph concepts, validation help, and technical explanations |

All tiers use a maximum width of 20 rem. A tooltip supplements an accessible name and never replaces a required label, error, or instruction. The actual shadcn/ui tooltip primitive is introduced with the application component layer rather than duplicated here.

## 9. Product icon registry

`productIcons` is a static, reviewed map of semantic keys to individually imported Lucide React components. The families cover:

- application and run actions;
- node categories;
- initial node types;
- recognition methods;
- runtime states.

The production bundle imports only selected icon modules. It does not use a dynamic icon loader, icon font, remote SVG, generated artwork, emoji, or AI-generated icon.

`ProductIcon` standardizes 14, 16, and 20 pixel sizes, a 1.75-pixel absolute stroke, geometric SVG rendering, decorative hiding, and optional accessible image labels. Icon-only controls remain responsible for providing a localized accessible label and tooltip.

## 10. Dependency and provenance boundary

P1-T03 pins:

| Package                            | Version | License | Distribution                    |
| ---------------------------------- | ------- | ------- | ------------------------------- |
| Tailwind CSS                       | 4.3.3   | MIT     | Build only                      |
| `@tailwindcss/vite`                | 4.3.3   | MIT     | Build only                      |
| Motion                             | 12.42.2 | MIT     | Runtime JavaScript              |
| `lucide-react`                     | 1.25.0  | ISC     | Selected runtime SVG components |
| Fontsource Inter Variable          | 5.3.0   | OFL-1.1 | Selected WOFF2 assets           |
| Fontsource JetBrains Mono Variable | 5.3.0   | OFL-1.1 | Selected WOFF2 assets           |

The complete resolutions are frozen in `pnpm-lock.yaml`. The dependency inventory records direct and material transitive license evidence. Release tooling must preserve the Lucide, font, and runtime notices and must not copy Tailwind build binaries into the installer.

## 11. Verification contract

Automated tests cover:

- allowed, invalid, system, light, and dark preferences;
- initial root theme state and explicit preference persistence;
- live operating-system theme changes;
- semantic token family registries;
- typed ports, categories, and node statuses;
- bounded motion tiers and the spatial spring;
- static icon-family coverage and accessible/decorative rendering;
- application-root integration.

The production build proves that Tailwind processes the stylesheet, exactly four reviewed font files resolve locally, Motion compiles against React 19, and selected Lucide imports are tree-shaken into the frontend bundle.

Visual verification must inspect light and dark modes, normal and reduced motion, font clarity, one-pixel separators, focus rings, and icon strokes at Windows scale factors 100, 125, 150, 175, and 200 percent. The inspection uses logical-pixel sizing and must not apply a root transform scale workaround.

## 12. Change rules

Any later token change must update both themes and preserve semantic meaning. Adding a new port or node state requires a token-registry update plus a non-color indicator. Adding an icon requires a reviewed static key and license-compatible Lucide component. Adding a font file requires immutable package provenance, a license record, a bounded glyph subset, and a production-build size review.

Feature components must not bypass the theme provider, dynamically load remote design assets, introduce a second icon family, or create decorative permanent animation.
