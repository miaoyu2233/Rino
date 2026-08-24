# Rino Development Prerequisites

> Task: P0-T01  
> Baseline captured: 2026-07-24  
> Primary host: Windows 11 x86-64  
> Status: Ready for P0-T02 with one non-blocking optional tool missing

## Purpose

This document defines the initial local toolchain contract for Rino development. It records version ranges and a sanitized snapshot of the current machine without storing user names, installation paths, environment variables, device identifiers, credentials, or other private data.

P0-T01 does not install, upgrade, download, or configure any dependency. Exact dependency versions and lockfiles are introduced only when the corresponding implementation task requires them.

## Required baseline

| Capability | Supported range or requirement | Preferred baseline | Current machine | Status |
|---|---|---|---|---|
| Development OS | Windows 10 x86-64 build 19045 or a supported Windows 11 x86-64 build | Windows 11 x86-64 | Windows 11 Pro x86-64, build 26200 | Ready |
| PowerShell | PowerShell 7.4 or newer, below 8.0 | Latest supported PowerShell 7 | 7.6.3 | Ready |
| Node.js | `>=24.0.0 <25.0.0` | Current Node.js 24 LTS patch | 24.13.0 | Ready |
| Corepack | Available through the selected Node.js installation | Version shipped with Node.js 24 | 0.34.5 | Ready |
| pnpm | `>=11.0.0 <12.0.0` | Exact version pinned later through `packageManager` | 11.9.0 | Ready |
| Rust compiler | Stable `>=1.77.2 <2.0.0` | Exact stable version pinned later by `rust-toolchain.toml` | 1.96.1 | Ready |
| Cargo | Same stable toolchain as `rustc` | Managed by rustup | 1.96.1 | Ready |
| Rust host target | `x86_64-pc-windows-msvc` installed and active | `stable-x86_64-pc-windows-msvc` | Active and installed | Ready |
| Python | `>=3.11.0 <3.14.0`, x86-64 | 3.13 for the initial Maa compatibility spike | 3.13.5 | Provisional; verify in P0-T02 |
| uv | `>=0.10.0 <0.11.0` | Exact version recorded with the Python lock workflow | 0.10.9 | Ready |
| Git | `>=2.45.0 <3.0.0` | Current supported Git for Windows | 2.50.0 | Ready |
| C++ build tools | A complete Visual Studio installation or Build Tools with Desktop development with C++ and x86/x64 compiler tools | Current supported release | Visual Studio 18.7.4 with required C++ component | Ready |
| Windows SDK | `>=10.0.19041.0` | 10.0.26100.0 | 10.0.19041.0, 10.0.22621.0, 10.0.26100.0 | Ready |
| WebView2 | Evergreen Runtime available | Current serviced runtime | 150.0.4078.83 | Ready |
| CMake | Optional for P0-T01 and prebuilt Maa consumption | Install only if a later approved task builds native dependencies from source | Not detected | Non-blocking |

## Version policy

### Node.js and pnpm

Rino standardizes on Node.js 24 LTS for the initial workspace. Node.js 22 remains an upstream-supported LTS release, but accepting two majors before dependency scaffolding would weaken reproducibility. pnpm 11 requires Node.js 22 or newer; Rino uses Node.js 24 and later pins the exact pnpm version in the root package manifest.

Do not use odd-numbered or Current-only Node.js releases for the project baseline. Do not rely on a globally installed frontend dependency beyond the selected Node.js, Corepack, and pnpm entry points.

### Rust and Tauri

The Windows desktop build uses the MSVC Rust host target. Rust is managed through rustup and must not resolve to GNU, WSL, or an unpinned nightly toolchain. The initial minimum covers Tauri 2's established MSRV, but the exact compiler is pinned only after the Tauri dependency version is selected.

Tauri development requires the C++ desktop workload and WebView2. MSI-only VBSCRIPT support is not required because the current release plan selects an NSIS installer. Android mobile application targets are not required: Rino controls Android devices through ADB from the Windows desktop application.

### Python, uv, and MaaFramework

MaaFramework's Python package metadata declares Python 3.9 or newer. Rino narrows development to Python 3.11 through 3.13 to keep typing, packaging, and dependency behavior manageable. The current Python 3.13 installation is accepted for P0-T01 only.

P0-T02 must verify that the selected MaaFramework Python binding, native binaries, NumPy dependency, callbacks, direct recognition/action APIs, and packaging path work together on Python 3.13. If that spike fails for a native compatibility reason, changing the reference Python minor requires evidence and a recorded decision; the implementation must not silently install another interpreter.

uv owns the project virtual environment and Python lock workflow after scaffolding. Global pip installs are not part of the supported development workflow.

## Supported Windows shell behavior

- Run project commands from the repository root in PowerShell 7 using `pwsh -NoProfile`.
- Normal development and verification commands must not require an elevated shell.
- Scripts must use explicit paths relative to the repository root and must not depend on the caller's current user profile, global Python packages, global Node packages, or shell aliases.
- Do not mix PowerShell path discovery with another shell for file deletion, moving, or cleanup.
- Verification scripts are read-only. They do not install tools, enable Windows features, edit execution policy, update `PATH`, create environments, or contact the network.
- If local execution policy blocks a script, report the condition. Do not bypass or change policy automatically.
- Console output may report product names and versions but must not print executable locations, user directories, environment variables, device identifiers, or credentials.
- A readiness exit code of `0` means every required check passed. Exit code `1` means at least one required tool is missing or incompatible. Warnings do not fail readiness.

## Verification command

Run the sanitized read-only check from the repository root:

```powershell
pwsh -NoProfile -File .\tools\verify-environment.ps1
```

Machine-readable output is available without changing the checks:

```powershell
pwsh -NoProfile -File .\tools\verify-environment.ps1 -AsJson
```

The acceptance-only simulation proves that missing required tools produce actionable output without modifying the machine:

```powershell
pwsh -NoProfile -File .\tools\verify-environment.ps1 -SimulateMissingTool pnpm
```

The simulation option must never be used as evidence that the real environment passed.

## Current readiness result

The current machine satisfies all P0-T01 required checks. CMake is absent but is optional because Rino has not approved building MaaFramework or other native dependencies from source. Python 3.13 remains a documented compatibility risk for P0-T02 rather than a P0-T01 failure.

## Official references

- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Node.js release status](https://nodejs.org/en/about/previous-releases)
- [pnpm 11 installation prerequisites](https://pnpm.io/installation)
- [Rust installation guidance](https://doc.rust-lang.org/book/ch01-01-installation.html)
- [MaaFramework Python package metadata](https://github.com/MaaXYZ/MaaFramework/blob/main/source/binding/Python/pyproject.toml)

## P0-T01 boundary

This task intentionally does not create the pnpm workspace, Python project, Rust project, Tauri application, dependency lockfiles, MaaFramework environment, Git repository, remote, CI configuration, or application source. Those changes belong to later approved tasks.
