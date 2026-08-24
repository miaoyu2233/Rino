# Dependency and License Inventory

> Task: P0-T05
> Status: Engineering baseline; public binary distribution is blocked by the gates in this document
> Reviewed: 2026-08-24
> Scope: Current spikes, approved architecture candidates, native payloads, reference projects, and release notice policy

## 1. Purpose and legal boundary

This document records the dependency and provenance facts needed to implement Rino without accidentally publishing incompatible, unattributed, or unaudited material. It is an engineering control, not legal advice. A qualified reviewer must confirm the final distribution design and notice bundle before any public binary release.

Rino now has initial application manifests and frozen lockfiles from `P1-T01`, but it does not have a production installer or a release-approved dependency graph. Therefore this inventory distinguishes scaffold dependencies, verified spike dependencies, planned production dependencies, and release-blocked payloads. A dependency is not approved for public redistribution merely because it appears in a manifest, lockfile, spike, or this document.

The user resolved D-003 on 2026-08-24 by selecting `AGPL-3.0-only` for Rino source. The root `LICENSE` and production package metadata carry that decision. This permits an audited source-repository publication; it does not approve an installer, bundled native payload, model, or other binary release.

## 2. Inventory status vocabulary

| Status              | Meaning                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `verified-spike`    | Exact version and local package metadata were inspected in a disposable technical spike.                            |
| `candidate-runtime` | Needed by the approved architecture or resolved by a runtime spike, but not yet approved for public redistribution. |
| `planned-unpinned`  | Architecture choice is approved, but an exact version and full transitive inventory do not exist yet.               |
| `development-only`  | Used to build, generate, lint, type-check, or test; not intended for the shipped runtime.                           |
| `reference-only`    | May inform requirements or independent design; no source code or assets are imported.                               |
| `release-blocked`   | Must not enter a public package until the listed evidence and obligations are resolved.                             |

License expressions in this document describe the evidence found at the reviewed source or package version. They do not replace the license texts shipped by the dependency.

## 3. Current runtime candidates

### 3.1 Python and Maa integration spike

The following versions are the exact environment resolved by `tools/spikes/maa-python/uv.lock`. Only `MaaFw` is a direct dependency of the spike; the remaining packages are resolved runtime dependencies.

| Component        | Version                        | Relationship               | Purpose                                                | Source                                                     | Observed license evidence                                                                                      | Status                                 |
| ---------------- | ------------------------------ | -------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| CPython          | `3.13.5` in the verified spike | Runtime host               | Python sidecar interpreter                             | [CPython](https://github.com/python/cpython)               | PSF License Version 2 plus incorporated-component notices                                                      | `candidate-runtime`                    |
| `MaaFw`          | `5.10.5`                       | Direct                     | Official Python binding and Windows native Maa runtime | [MaaFramework](https://github.com/MaaXYZ/MaaFramework)     | Upstream declares LGPL-3.0; wheel metadata has no SPDX license field but includes `LICENSE.md`                 | `candidate-runtime`, `release-blocked` |
| `MaaAgentBinary` | `1.0.1`                        | Transitive through `MaaFw` | Android-side capture and input agents                  | [MaaAgentBinary](https://github.com/MaaXYZ/MaaAgentBinary) | Installed distribution contains the GNU AGPL version 3 text; upstream identifies AGPL-3.0                      | `release-blocked`                      |
| `numpy`          | `2.5.1`                        | Transitive through `MaaFw` | Image-array boundary used by the Python binding        | [NumPy](https://github.com/numpy/numpy)                    | Package expression: `BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0`; multiple bundled notices are present | `candidate-runtime`                    |
| `StrEnum`        | `0.4.15`                       | Transitive through `MaaFw` | Enum compatibility dependency of the binding           | [StrEnum](https://github.com/irgeek/StrEnum)               | Installed distribution contains the MIT license                                                                | `candidate-runtime`                    |

The exact Python patch version must be pinned again when the production sidecar is scaffolded. Its complete license directory, including incorporated components, must be copied into the release notice bundle.

### 3.2 Contract-validation candidates

These packages were verified in the contract-generation spike. Their production role is not final until the sidecar package is scaffolded.

| Component    | Version  | Intended role                                                      | Source                                                               | License evidence         | Status              |
| ------------ | -------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------ | ------------------- |
| `pydantic`   | `2.13.4` | Parse validated IPC and persistent models into strict Python types | [Pydantic](https://github.com/pydantic/pydantic)                     | Package expression `MIT` | `candidate-runtime` |
| `jsonschema` | `4.26.0` | Authoritative Draft 2020-12 validation in Python                   | [python-jsonschema](https://github.com/python-jsonschema/jsonschema) | Package expression `MIT` | `candidate-runtime` |

If production code can rely only on Pydantic's generated validators without weakening the canonical schema checks, `jsonschema` may remain a test dependency. That choice must be proven with shared invalid-fixture tests rather than assumed to reduce package size.

### 3.3 P1-T04 application foundation

The initial application manifests use exact direct versions. Complete transitive resolutions are frozen in the root `pnpm-lock.yaml`, `Cargo.lock`, and `uv.lock`. These tables record direct ownership only; release review must inspect every transitive package and generated binary.

| Component                          | Version   | Boundary                                                   | License evidence  | Status              |
| ---------------------------------- | --------- | ---------------------------------------------------------- | ----------------- | ------------------- |
| React                              | `19.2.8`  | Desktop UI runtime                                         | MIT               | `candidate-runtime` |
| React DOM                          | `19.2.8`  | Desktop DOM renderer                                       | MIT               | `candidate-runtime` |
| `i18next`                          | `26.3.6`  | Bundled catalog resolution and language fallback           | MIT               | `candidate-runtime` |
| `react-i18next`                    | `17.0.11` | React localization subscription and provider               | MIT               | `candidate-runtime` |
| Motion                             | `12.42.2` | Purposeful React animation and reduced-motion root         | MIT               | `candidate-runtime` |
| `lucide-react`                     | `1.25.0`  | Static production icon components                          | ISC               | `candidate-runtime` |
| Fontsource Inter Variable          | `5.3.0`   | Self-hosted Latin and Latin Extended UI font assets        | OFL-1.1           | `candidate-runtime` |
| Fontsource JetBrains Mono Variable | `5.3.0`   | Self-hosted Latin and Latin Extended technical font assets | OFL-1.1           | `candidate-runtime` |
| `@tauri-apps/api`                  | `2.11.1`  | Typed frontend desktop API                                 | MIT OR Apache-2.0 | `candidate-runtime` |
| Tauri                              | `2.11.5`  | Rust desktop runtime                                       | MIT OR Apache-2.0 | `candidate-runtime` |
| Serde                              | `1.0.229` | Typed serialization of redacted startup diagnostics        | MIT OR Apache-2.0 | `candidate-runtime` |
| `serde_json`                       | `1.0.151` | Versioned JSON startup diagnostic encoding                 | MIT OR Apache-2.0 | `candidate-runtime` |
| `jsonschema`                       | `0.49.2`  | Offline Draft 2020-12 validation before package signing    | MIT               | `candidate-runtime` |
| `tauri-plugin-dialog`              | `2.7.2`   | Native folder and file selection for project I/O           | MIT OR Apache-2.0 | `candidate-runtime` |
| Tailwind CSS                       | `4.3.3`   | Compile semantic theme tokens and utilities                | MIT               | `development-only`  |
| `@tailwindcss/vite`                | `4.3.3`   | Official Vite integration for Tailwind CSS                 | MIT               | `development-only`  |
| `tauri-build`                      | `2.6.3`   | Rust build-time code generation                            | MIT OR Apache-2.0 | `development-only`  |
| `uv-build`                         | `0.11.32` | Python package build backend                               | MIT OR Apache-2.0 | `development-only`  |

The Python runtime package has no direct runtime dependency through P1-T04. MaaFramework is intentionally not added to the production workspace before its adapter phase and distribution gates. Serde and `serde_json` became direct Rust dependencies in P1-T02; both were already present transitively in the frozen Tauri graph, and the lockfile records their direct ownership by `rino-desktop`.

Project publishing adds `jsonschema 0.49.2` with default features disabled. It validates the
embedded canonical graph schema entirely in memory before signing and enables format validation;
HTTP, file, and asynchronous schema retrieval are not compiled, so this boundary introduces no
network access or runtime schema loading. The upstream crate declares MIT. Its transitive graph
remains subject to the normal release SBOM and notice review.

P1-T03 adds four shipped frontend families and two build-only Tailwind packages. Motion resolves `framer-motion 12.42.2`, `motion-dom 12.42.2`, `motion-utils 12.39.0`, and `tslib 2.8.1`; their installed metadata reports MIT or 0BSD. Lucide and both font packages have no package dependencies. The Tailwind Vite build path resolves Tailwind's Node and Oxide packages at 4.3.3, plus build-only resolver and CSS transformation packages. The installed license report includes MIT, ISC, BSD, and MPL-2.0 build-time components; these build tools and platform binaries must not be copied into the application installer.

P1-T04 adds `i18next 26.3.6` and `react-i18next 17.0.11`. The React adapter resolves `@babel/runtime 7.29.7`, `html-parse-stringify 4.0.1`, and `use-sync-external-store 1.6.0`; all five packages report MIT in the installed production license report. Rino does not install an HTTP backend, remote catalog loader, browser detector plugin, or localization service client. Only the two reviewed in-bundle catalogs enter the runtime.

P3-T09 adds the official `tauri-plugin-dialog 2.7.2` as the only supported way to present a
native folder or file dialog under Tauri 2. It is initialized for its Rust interface alone:
no dialog permission is granted to the webview, so the frontend reaches a dialog only
through Rino's own project commands. The plugin resolves `rfd 0.16.0` (MIT) and
`tauri-plugin-fs 2.5.1` (MIT OR Apache-2.0), and the build-time `tauri-plugin 2.6.3`
(MIT OR Apache-2.0). The `fs` plugin arrives as a scope dependency of the dialog plugin and
is not registered, so it exposes no command.

Adding the plugin forced offline dependency resolution to re-select a set of transitive
crates that are present in the workspace's local package cache. `Cargo.lock` therefore
records lower versions for crates that are locked but not compiled on this target
(`futures-*` 0.3.32, `hyper` 1.10.1, `http-body` 1.0.1, `http-body-util` 0.1.3, `tokio-util`
0.7.18, `toml_edit` 0.25.12) and higher versions for the Windows target crates `rfd` needs
(`windows-targets` 0.53.5 and its `windows_*` platform packages, with `windows-core` 0.61.2,
`windows-result` 0.3.4, and `windows-strings` 0.4.2). No direct dependency version changed.
Release review must re-resolve this graph with network access and re-inspect it.

Direct frontend development and test tools are TypeScript 6.0.3, Vite 8.1.5, Vitest 4.1.10, ESLint 10.7.0, typescript-eslint 8.65.0, Prettier 3.9.6, jsdom 29.1.1, Testing Library packages, React type packages, the Vite React plugin, and Tauri CLI 2.11.4. Their installed package metadata reports permissive project licenses, but their complete transitive graph remains subject to release SBOM and notice review.

Direct Python development and test tools are Ruff 0.16.0, Pyright 1.1.411, pytest 9.1.1, pytest-asyncio 1.4.0, and Hypothesis 6.161.2. Hypothesis is MPL-2.0; it is development-only and must not be copied into the frozen runtime. The remaining direct tools report MIT or Apache-2.0 project licenses in their package metadata or upstream source.

The compile-required `apps/desktop/src-tauri/icons/scaffold-source.svg` is an original local geometric source, and `icon.ico` is generated from it by the pinned Tauri CLI. It is provisional scaffolding rather than copied artwork or final branding.

## 4. Production stack status

Initial JavaScript, Rust, and Python manifests now exist, and the P1-T04 localization dependencies are pinned. Components already listed in section 3.3 are pinned; later component, graph, state, runtime, installer, and packaging families remain unpinned until their owning task introduces them. The listed licenses are baseline evidence only, not a substitute for auditing the selected release.

| Component family             | Purpose                                                          | Official source                                                                      | Upstream baseline                                                                                | Required action before use                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| React                        | UI component runtime                                             | [react/react](https://github.com/react/react)                                        | MIT                                                                                              | Pin exact version and audit runtime transitives.                                                                                              |
| i18next and react-i18next    | Bundled catalog resolution and React localization boundary       | [i18next/i18next](https://github.com/i18next/i18next)                                | MIT                                                                                              | Keep catalogs local, preserve exact pins, and do not add remote loading or collection without explicit approval.                              |
| React Flow (`@xyflow/react`) | Graph canvas renderer and interaction adapter                    | [xyflow/xyflow](https://github.com/xyflow/xyflow)                                    | MIT                                                                                              | Pin exact version; keep its model out of the persistent contract.                                                                             |
| shadcn/ui source components  | Composable UI primitives copied into the application source tree | [shadcn-ui/ui](https://github.com/shadcn-ui/ui)                                      | MIT                                                                                              | Record the exact CLI/template revision and preserve required copyright and permission notices for copied substantial portions.                |
| Tailwind CSS                 | Semantic theme tokens and compiled styling                       | [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss)              | MIT                                                                                              | Pin build dependency and audit plugins separately.                                                                                            |
| Motion for React             | Purposeful UI transitions and runtime-path feedback              | [motiondivision/motion](https://github.com/motiondivision/motion)                    | MIT                                                                                              | Pin exact package; do not import paid or separately licensed examples/assets.                                                                 |
| Zustand                      | Narrow shared client state                                       | [pmndrs/zustand](https://github.com/pmndrs/zustand)                                  | MIT                                                                                              | Pin exact version and audit transitives.                                                                                                      |
| Lucide                       | Bundled static production icon mapping                           | [lucide-icons/lucide](https://github.com/lucide-icons/lucide)                        | ISC, with listed Feather-derived icons under MIT                                                 | Preserve both applicable notices and record which icon package/version generated the bundle.                                                  |
| Tauri 2                      | Desktop shell, capability boundary, and installer                | [tauri-apps/tauri](https://github.com/tauri-apps/tauri)                              | MIT or Apache-2.0 where applicable; logo licensing is separate                                   | Pin exact Rust and JavaScript packages; do not copy project branding.                                                                         |
| WebView2 runtime             | Windows webview runtime                                          | [WebView2 documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/) | Separate redistributable terms                                                                   | Record whether evergreen or fixed distribution is used and preserve installer terms.                                                          |
| NSIS                         | Windows per-user installer generated by Tauri                    | [NSIS](https://nsis.sourceforge.io/)                                                 | zlib/libpng-style license, subject to bundled plugins                                            | Audit the exact Tauri bundler output and every included plugin.                                                                               |
| Python bundler               | Produce an onedir sidecar without requiring system Python        | [PyInstaller](https://pyinstaller.org/) or [Nuitka](https://nuitka.net/)             | Tool-specific; PyInstaller documents GPLv2 with a bootloader exception and some Apache-2.0 files | PyInstaller 6.21.0 passed the Phase 0 transport packaging spike; D-005 remains open until the measured Phase 9 comparison and release review. |

Shadcn/ui is distributed as source incorporated into the application rather than as a normal runtime package. Its provenance must remain visible in the component inventory even after local modification.

## 5. Verified development and spike dependencies

These packages support Phase 0 evidence. They are not an approval to ship their executables, source, or transitive trees in the Rino installer.

### 5.1 Contract-generation JavaScript tools

| Package                     | Version  | Role                                         | License from installed metadata |
| --------------------------- | -------- | -------------------------------------------- | ------------------------------- |
| `@types/node`               | `26.1.1` | Node API types for the fixture runner        | MIT                             |
| `ajv`                       | `8.20.0` | TypeScript Draft 2020-12 fixture validation  | MIT                             |
| `ajv-formats`               | `3.0.1`  | UUID format support for Ajv                  | MIT                             |
| `json-schema-to-typescript` | `15.0.4` | Deterministic TypeScript contract generation | MIT                             |
| `typescript`                | `7.0.2`  | Strict compilation and type validation       | Apache-2.0                      |

Ajv may later become a production frontend validator. If it moves from tooling to runtime, it must be reclassified and audited from the application lockfile.

### 5.2 Contract-generation Python tools

| Package                    | Version   | Role                                                | License from installed metadata |
| -------------------------- | --------- | --------------------------------------------------- | ------------------------------- |
| `datamodel-code-generator` | `0.70.0`  | Generate Pydantic models from canonical JSON Schema | MIT                             |
| `ruff`                     | `0.16.0`  | Python formatting and lint checks                   | MIT                             |
| `pyright`                  | `1.1.411` | Strict Python type checks                           | MIT                             |

The generator's transitive dependencies belong in a development SBOM, but must not be copied into the sidecar runtime environment.

### 5.3 Sidecar-transport Rust spike

| Crate         | Version   | Role                                | License from cached crate metadata |
| ------------- | --------- | ----------------------------------- | ---------------------------------- |
| `serde`       | `1.0.228` | Typed serialization                 | MIT OR Apache-2.0                  |
| `serde_json`  | `1.0.145` | Framed JSON payload serialization   | MIT OR Apache-2.0                  |
| `uuid`        | `1.18.1`  | Request and generation identifiers  | Apache-2.0 OR MIT                  |
| `windows-sys` | `0.61.2`  | Windows Job Object and process APIs | MIT OR Apache-2.0                  |

### 5.4 Frozen-Sidecar build spike

The following Windows build environment is locked by `tools/spikes/tauri-python-sidecar/uv.lock`. These packages are development-only build inputs. PyInstaller-generated runtime files still require a file-level notice and provenance review before public redistribution.

| Package                     | Version     | Role                                            | License from installed metadata or included license file          |
| --------------------------- | ----------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| `pyinstaller`               | `6.21.0`    | Build the packaging-equivalent onedir Sidecar   | GPL-2.0-or-later with the documented special bootloader exception |
| `altgraph`                  | `0.17.5`    | PyInstaller dependency graph support            | MIT                                                               |
| `packaging`                 | `26.2`      | Version and marker handling                     | Apache-2.0 OR BSD-2-Clause                                        |
| `pefile`                    | `2024.8.26` | Windows PE inspection used by PyInstaller       | MIT                                                               |
| `pyinstaller-hooks-contrib` | `2026.6`    | Community analysis and runtime hooks            | Standard hooks GPL-2.0-or-later; bundled runtime hooks Apache-2.0 |
| `pywin32-ctypes`            | `0.2.3`     | Windows API compatibility used during the build | BSD-3-Clause                                                      |
| `setuptools`                | `83.0.0`    | Build-tool compatibility dependency             | MIT                                                               |

The cross-platform lock also records conditional packages for non-Windows hosts. They were not installed or used in the verified Windows artifact and must be inspected separately before another platform is supported. The Phase 0 result does not select PyInstaller for release, satisfy D-005, or approve its generated files for distribution.

These versions are proven for the spike only. The Tauri application will have a much larger Rust dependency graph and needs a fresh locked inventory.

## 6. MaaFramework distribution analysis

### 6.1 LGPL-covered runtime

MaaFramework identifies itself as LGPL-3.0. Rino intends to use the official Python binding and shared Windows libraries without modifying MaaFramework. That design does not eliminate distribution obligations.

Before conveying any package containing MaaFramework, the release process must:

1. Identify the exact MaaFramework source revision corresponding to every distributed binary and preserve its source URL and cryptographic hash.
2. State prominently that Rino uses MaaFramework and that the covered library is licensed under LGPL version 3.
3. Ship complete copies of GNU GPL version 3 and GNU LGPL version 3 with the installer and installed application.
4. Preserve upstream copyright, license, and third-party notices.
5. Keep MaaFramework as replaceable shared libraries where technically possible and do not prohibit reverse engineering needed to debug a user's compatible modified library.
6. Document whether the distributed library is modified. If it is modified, archive the exact corresponding source and build instructions and make them available by a legally valid distribution method.
7. Verify that code signing, integrity checks, the updater, and installer repair behavior do not make a compatible replacement library impossible without a compliant alternative.
8. Have legal review confirm the selected LGPL section 4 compliance path for the actual combined work.

Do not describe Rino as covered by LGPL merely because it dynamically uses MaaFramework, and do not describe Rino as exempt from LGPL obligations. The final conclusion depends on the actual packaged work and must be reviewed against the shipped artifact.

### 6.2 MaaAgentBinary AGPL gate

`MaaAgentBinary 1.0.1` is installed transitively by the verified `MaaFw` environment. Its installed license is GNU AGPL version 3, and its payload contains prebuilt Android agents from `minitouch`, `maatouch`, and `minicap` sources.

This is a hard release blocker because the current spike does not establish all of the following:

- the exact source revision and build recipe for each conveyed binary;
- the license and notice chain for every upstream prebuilt component;
- the compliant corresponding-source delivery method;
- whether Rino can exclude the aggregate package and acquire only an audited minimal set;
- whether an independently built, better-provenanced agent payload is available;
- the effect of any modifications or network-facing behavior in the final design.

The production installer must not copy `MaaAgentBinary` wholesale until this gate is resolved. Acceptable engineering outcomes include an audited compliant redistribution, an independently built payload with complete provenance, or exclusion in favor of another supported controller path. The choice requires explicit architecture and legal review; P0-T05 does not select one.

### 6.3 Native files observed in the MaaFw Windows wheel

The `MaaFw 5.10.5` wheel contains more native functionality than the Android ADB MVP needs. Packaging must start from an explicit allowlist backed by dependency tracing and clean-machine smoke tests, not by copying the entire `maa/bin` directory.

| Payload group                        | Observed files                                                                                                                             | Default disposition                                         | Unresolved evidence                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Maa core and ADB                     | `MaaFramework.dll`, `MaaUtils.dll`, `MaaToolkit.dll`, `MaaAdbControlUnit.dll`, `MaaAgentClient.dll`, `MaaAgentServer.dll`                  | Candidate only; retain the minimum proven set               | Exact artifact revision, dependency graph, source archive, notices, and hashes                                  |
| OCR runtime                          | `fastdeploy_ppocr_maa.dll`, `onnxruntime_maa.dll`, `opencv_world4_maa.dll`                                                                 | Candidate when OCR is enabled                               | Exact embedded versions, build options, third-party notices, and source mapping                                 |
| Optional GPU acceleration            | `DirectML.dll`                                                                                                                             | Omit from the default MVP package                           | Separate redistributable terms and notice; upstream states it is not part of MaaFramework's LGPL-covered source |
| Non-MVP controllers and capabilities | `MaaCustomControlUnit.dll`, `MaaGamepadControlUnit.dll`, `MaaRecordControlUnit.dll`, `MaaReplayControlUnit.dll`, `MaaWin32ControlUnit.dll` | Omit unless a later feature explicitly needs and audits one | Per-binary purpose, version, dependency, license, and attack-surface review                                     |
| Demo plugin                          | `plugins/MaaPluginDemo.dll`                                                                                                                | Always omit from production                                 | No production purpose; plugin loading is outside the approved capability allowlist                              |
| Virtual gamepad client               | `ViGEmClient.dll`                                                                                                                          | Omit from the Android ADB MVP                               | Exact binary version and provenance; upstream ViGEmClient repository is archived and identifies MIT             |

Official upstream projects identify ONNX Runtime as MIT, OpenCV 4.x as Apache-2.0, and the FastDeploy source project as Apache-2.0. Those repository-level facts are insufficient to license the renamed Maa wheel binaries: exact component versions, patches, build flags, and incorporated third-party notices must be obtained from the Maa artifact build provenance before release.

### 6.4 OCR models and resource assets

Code licenses do not automatically establish permission to redistribute model weights, dictionaries, fonts, screenshots, or training-derived assets. MaaCommonAssets identifies its repository as MIT, but every selected OCR file still needs a path-level provenance record and hash.

The first OCR model bundle must have:

- origin repository and immutable revision;
- file name, hash, size, supported languages, and intended use;
- model or dataset license and required attribution;
- evidence that commercial or public redistribution is permitted;
- a generated manifest included in the installer;
- a replacement and rollback procedure independent of the application binary.

No OCR model may enter a public installer while its provenance is inferred only from a containing repository name.

### 6.5 ADB and platform tools

ADB is not yet bundled. If Rino later ships Android platform tools, the package must use a fixed official source, version, and hash rather than silently loading an arbitrary executable from `PATH`. The release inventory must include the applicable source and binary notices for the exact downloaded archive and must exclude unrelated platform-tool files.

## 7. Reference-only projects and clean implementation

| Project                                                          | Use in Rino                                          | License evidence                                                  | Boundary                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [MaaPipelineEditor](https://github.com/kqcoxn/MaaPipelineEditor) | Requirements and interaction reference only          | Repository identifies MIT and contains an MIT license file        | Do not copy its source, components, layouts, icons, images, templates, or assets casually. Any proposed reuse requires file-level provenance, compatibility review, attribution, and explicit user approval. |
| MaaFramework documentation and examples                          | Verify public integration behavior                   | Covered by the repository's license and any file-specific notices | Prefer independent adapter code against the documented API. Do not paste implementation internals into Rino.                                                                                                 |
| External visual editors mentioned in product discussions         | Vocabulary and high-level interaction reference only | Not a dependency and not audited for reuse                        | Implement original visuals and interactions. Do not copy branding, screenshots, proprietary icons, assets, or source.                                                                                        |

An MIT label permits use only under its conditions; it does not prove that every nested asset was authored by the repository or is free of separate notices. Rino should remain independently designed even when a reference project demonstrates a useful interaction.

## 8. Notice and provenance policy

### 8.1 Authoritative records

Once application manifests exist, each lockfile is the version source for its ecosystem. A release inventory must be generated from the exact clean build, then reviewed rather than copied from this planning baseline.

The release process must produce:

- a machine-readable SBOM in SPDX JSON or CycloneDX JSON;
- a human-readable `THIRD_PARTY_NOTICES.md` generated from reviewed records;
- complete required license texts under a stable `licenses/` directory;
- a native-binary manifest with source, version, SHA-256 hash, architecture, purpose, and inclusion reason;
- a model-and-asset manifest with equivalent provenance fields;
- corresponding-source or source-offer material required by copyleft components;
- an audit record of omitted optional native files.

The SBOM and notices are release artifacts. They must not contain local absolute paths, user names, machine identifiers, package-cache locations, environment variables, private endpoints, credentials, or local archive paths.

### 8.2 Required dependency fields

Every direct production dependency record must contain:

| Field            | Requirement                                                                        |
| ---------------- | ---------------------------------------------------------------------------------- |
| Package identity | Ecosystem-qualified name and exact resolved version                                |
| Purpose          | Narrow production responsibility and owning Rino module                            |
| Source           | Official project URL and immutable source or release revision                      |
| Integrity        | Registry integrity value and release artifact SHA-256 where applicable             |
| License          | SPDX expression when provided by the exact package, plus the original license text |
| Modification     | Unmodified, patched, generated into source, or locally rebuilt                     |
| Distribution     | Runtime, build-only, test-only, optional, or excluded                              |
| Notice action    | Files and UI locations where notices must appear                                   |
| Reviewer         | Human or approved release review record and date                                   |

Unknown values block release. Do not replace them with `N/A` unless the field genuinely does not apply and the reason is recorded.

### 8.3 Dependency-change workflow

For every new or upgraded production dependency:

1. Confirm there is no suitable existing or standard-library capability.
2. Record purpose, exact version, official source, maintenance status, license, security history, size, and Windows impact.
3. Inspect the complete lockfile diff and unexpected transitive additions.
4. Generate ecosystem license reports and compare them with the package's actual license files.
5. Reject packages with missing or contradictory provenance until resolved.
6. Rebuild the SBOM and notice bundle from a clean locked environment.
7. Run capability, security, package-size, and clean-machine smoke tests.
8. Review the exact installer contents, not only source manifests.

## 9. Release-blocking gates

All gates default to blocked until direct evidence is attached to a release candidate.

| Gate      | Requirement                       | Current state                                 | Unblock evidence                                                                                               |
| --------- | --------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `LIC-001` | Rino license decision             | Resolved: `AGPL-3.0-only`                     | Root license text, consistent production package metadata, and a privacy-audited source publication            |
| `LIC-002` | Exact production dependency graph | In progress; initial scaffold manifests exist | Frozen release lockfiles, complete runtime graph, and reviewed SBOM                                            |
| `LIC-003` | MaaFramework LGPL path            | Blocked                                       | Exact source mapping, license bundle, notice, replacement/relinking analysis, and legal review                 |
| `LIC-004` | MaaAgentBinary AGPL path          | Blocked                                       | Complete component provenance and corresponding-source plan, or audited exclusion/replacement                  |
| `LIC-005` | Maa native allowlist              | Blocked                                       | Dependency-traced allowlist, hashes, clean-machine tests, and per-binary notices                               |
| `LIC-006` | OCR models and assets             | Blocked                                       | Path-level provenance, redistribution permission, hashes, and model manifest                                   |
| `LIC-007` | ADB distribution                  | Blocked until bundling is requested           | Fixed official archive, version, hash, minimal file list, and notices                                          |
| `LIC-008` | UI source and icon provenance     | In progress; base React scaffold only         | Exact shadcn/ui revision, Lucide version, copied-source inventory, and notices                                 |
| `LIC-009` | Python bundler                    | Blocked by D-005 and release validation       | Selected pinned bundler, generated-file license review, comparative measurements, and clean-machine validation |
| `LIC-010` | Final installer notice audit      | Blocked; no installer exists                  | File-by-file installer inventory, notices, SBOM, signature, and release review approval                        |

Passing an earlier gate does not waive a later one. A dependency upgrade reopens every gate affected by its code, binaries, models, assets, or transitive graph.

## 10. Verification evidence for this baseline

This baseline was produced from:

- the direct manifests and frozen lockfiles in all three Phase 0 spikes;
- the frozen Sidecar build lock, installed build-tool metadata, packaged file inventory, and isolated packaged protocol run;
- the P1-T01 root pnpm, Cargo, and uv manifests and frozen lockfiles;
- installed Python distribution metadata and license files;
- installed Node package metadata for direct spike tools;
- cached Cargo package metadata for the four direct Rust spike crates;
- the actual native file names present in the installed `MaaFw 5.10.5` wheel;
- the actual GNU AGPL version 3 license file installed with `MaaAgentBinary 1.0.1`;
- official upstream repositories and license pages linked above.

Rino source is licensed under `AGPL-3.0-only` and may be published only after the repository privacy gate passes. This inventory still does not approve any public installer, application package, bundled native payload, model, or other binary release.
