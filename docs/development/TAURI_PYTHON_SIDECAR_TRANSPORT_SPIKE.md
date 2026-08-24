# Tauri-to-Python Sidecar Transport Spike

## Status

- Task: `P0-T03`
- Probe date: 2026-07-24
- Host coverage: Windows x86-64, Rust 1.96.1, CPython 3.13.5
- Result: The Rust-supervised framed-stdio transport is viable in source and frozen onedir forms.
- Packaging supplement: PyInstaller 6.21.0 onedir artifact passed isolated launch and protocol verification.
- Decision: [ADR-0001](../architecture/adr/0001-rust-supervised-framed-stdio-sidecar.md)

This spike validates the risky byte-transport and process-lifecycle assumptions. It is isolated under `tools/spikes/tauri-python-sidecar` and is not the production desktop shell or runtime service.

## Reproducible commands

Run from the spike directory:

```powershell
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --all-targets --locked
uv run --frozen --project ../maa-python ruff format --check .
uv run --frozen --project ../maa-python ruff check .
uv run --frozen --project ../maa-python pyright --project pyproject.toml
./packaging/build-packaged-sidecar.ps1
$env:RINO_PACKAGED_SIDECAR = (Resolve-Path "../../../release-local/sidecar-packaging-spike/tauri-boundary-fixture/binaries/rino-runtime-sidecar-x86_64-pc-windows-msvc.exe").Path
cargo test --test packaged_sidecar --locked -- --ignored --exact packaged_sidecar_runs_without_system_python_environment
```

The local `rust-toolchain.toml` pins compiler, rustfmt, Clippy, and the Windows MSVC target to Rust 1.96.1 without changing the user's default toolchain.

## Spike structure

```text
tools/spikes/tauri-python-sidecar/
├─ Cargo.toml
├─ Cargo.lock
├─ rust-toolchain.toml
├─ pyproject.toml
├─ uv.lock
├─ packaging/
│  └─ build-packaged-sidecar.ps1
├─ sidecar/
│  └─ runtime_sidecar.py
├─ src/
│  ├─ lib.rs
│  ├─ process.rs
│  └─ protocol.rs
├─ tauri-boundary-fixture/
│  ├─ tauri.conf.json
│  └─ capabilities/main.json
└─ tests/
   ├─ packaged_sidecar.rs
   └─ sidecar_transport.rs
```

The Sidecar source uses only the Python standard library. PyInstaller 6.21.0 and its build-only dependencies are isolated and locked by `uv.lock`; they are not application runtime imports. Rust dependencies are exact direct versions and are transitively locked by `Cargo.lock`.

## Transport evidence

### Framing

Frames use one ASCII `Content-Length` header, a CRLF header terminator, and an exact UTF-8 JSON body. The spike limit is 64 KiB. Production must source its limit from the unified Limits Registry and advertise it during the handshake.

The Rust decoder passed tests for every split boundary of a valid frame, multiple frames in one read, malformed decimal length, oversized length before body allocation, invalid UTF-8, and truncated EOF. A decoder becomes poisoned after a protocol failure so later bytes cannot accidentally revive the invalid Sidecar generation.

### Correlation and events

Rust generates UUID v4 request IDs. During the handshake the test Sidecar deliberately sends a valid response with an unrelated request ID before the correct response. The supervisor retains the unrelated response and returns only the response correlated to the active request.

The Sidecar then sends `system.ready` with an event ID and sequence number. The event remains available even when it shares one output write with preceding response frames. A separate mode writes every output byte individually and proves fragmented event/response delivery.

### Startup and shutdown

The slow-start mode exceeds a 50 ms acceptance timeout. Rust reports a structured timeout and then performs bounded forced cleanup. Graceful `system.shutdown` returns a correlated response, closes stdin, and exits with no live process.

The crash mode exits while a request is pending. The request fails as Sidecar unavailable instead of hanging or being treated as successful.

### Windows process tree

Rust creates a Job Object before using the Sidecar and enables kill-on-close. The process-tree test asks the test Sidecar to create a descendant Python process, confirms it is active, force-stops the Sidecar, and confirms both the Sidecar and descendant exit within the deadline.

The supervisor passes only a minimal allowlist of inherited Windows environment values plus fixed Python isolation settings. It never forwards the complete development environment.

## Tauri authority boundary

The fixture declares one external binary base name, `binaries/rino-runtime-sidecar`, the onedir support resource `binaries/rino-runtime-sidecar-support/`, and one local main-window capability. Its permissions contain no `shell:*` entry. The integration test parses both files and enforces those properties.

The packaging script creates a local-only Tauri source-layout fixture containing `rino-runtime-sidecar-x86_64-pc-windows-msvc.exe` and its bounded support directory. This proves the target-triple filename and relative resource layout expected by the configuration. The fixture intentionally does not create a runnable Tauri application or installer because the production shell does not exist yet. When that shell is scaffolded, Rust will start the fixed packaged Sidecar and expose typed Rino commands/events. The frontend must not install or call the JavaScript shell API, accept an executable path, or supply arbitrary process arguments.

## Packaged-spike evidence

The local build used PyInstaller 6.21.0 in onedir mode with CPython 3.13.5. The staged executable was 1,792,199 bytes and its 58 support files totaled 16,819,141 bytes. The observed executable SHA-256 for this run was `94FA91AA976EA9EA46CE9982C6881E3E9E80736947B653FE9BF82390D8F97DC9`; it is evidence for this build, not a reproducibility guarantee.

Rust launched the staged executable by absolute path through the same supervisor used by the source-form tests. The supervisor cleared the inherited environment and supplied no `PATH` or `PYTHONHOME`. The frozen process reported `runtimeMode: frozen`, completed the correlated handshake, emitted `system.ready`, echoed a request, and shut down cleanly. This establishes packaging-equivalent operation without discovering or launching system Python. A later clean-VM installer test is still required because the host machine does contain a development Python installation.

## Test result

The final Windows run passed:

- 6 protocol unit tests.
- 7 process, transport, and capability integration tests.
- 1 explicit frozen-Sidecar packaging integration test.
- Rust formatting and Clippy with warnings denied.
- Python Ruff formatting and lint checks.
- Python Pyright strict mode with zero errors.

No network service, real device operation, external browser, Tauri window, Git operation, or remote publication was performed. The packaging tool was downloaded from the public Python package index into the project-isolated environment; no project file or user data was uploaded.

## Remaining gates

The following items remain intentionally open:

- Build and launch the Sidecar from the actual Tauri application once the Phase 1 shell exists.
- Compare PyInstaller with Nuitka and resolve D-005 from measured Maa compatibility, size, startup, reproducibility, diagnostics, and antivirus behavior in Phase 9.
- Run installer and clean-VM tests with no system Python during release hardening.
- Add Sidecar generation IDs, restart policy, request cancellation, backpressure, and resynchronization in Phase 2.
- Implement a process-group cleanup adapter before non-Windows platforms become release targets.
- Replace discarded spike stderr with bounded, redacted structured diagnostics in the production runtime.

These gates do not invalidate the selected local transport. They define the next contract and packaging work.
