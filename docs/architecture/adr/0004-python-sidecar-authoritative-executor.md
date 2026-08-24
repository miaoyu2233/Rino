# ADR-0004: Python Sidecar as the Authoritative Executor

- Status: Accepted
- Date: 2026-07-24
- Decision owner: Rino runtime boundary
- Evidence: Architecture baseline, `P0-T02`, `P0-T03`, and `P0-T04`

## Context

Rino has three execution-capable environments: a React frontend, a trusted Tauri Rust process, and a Python process that can use the official MaaFramework binding. Without one clear authority, graph validation, scheduling, cancellation, runtime values, and failure behavior could diverge across languages.

The frontend must remain responsive and optimized for editing. Rust must remain a small least-privilege desktop and process boundary. Python has the strongest direct fit for the graph scheduler, typed node executors, asynchronous coordination, and the selected automation binding.

The runtime must also be restartable independently of the desktop window. A crash or incompatible protocol must not require placing automation authority in the webview or granting the frontend process-launch capabilities.

## Decision

The supervised Python Sidecar is the sole authoritative graph executor.

Python owns:

- execution-relevant graph validation;
- node registry definitions and executor dispatch;
- type compatibility at runtime boundaries;
- deterministic token scheduling and pure dependency resolution;
- execution frames, values, artifacts, limits, and device leases;
- cancellation, breakpoints, continue, step-over, and terminal states;
- backend selection and coordination through Rino-owned interfaces;
- ordered runtime events, value summaries, diagnostics, and structured errors.

The frontend owns editing interactions, presentation, localization, command dispatch, and runtime visualization. It may run fast validation previews using generated contracts and shared rules, but a preview never authorizes execution and cannot override a Sidecar diagnostic.

Rust owns window integration, scoped project I/O, capability enforcement, Sidecar supervision, fixed-binary launch, safe message transport, request correlation, timeouts, crash detection, and process-tree cleanup. Rust does not implement graph scheduling or automation node semantics.

All cross-process messages use the versioned canonical contracts established by ADR-0002 and the supervised transport established by ADR-0001. The Sidecar never trusts a graph merely because the frontend validated it. It validates the submitted run input against the canonical schema and current registry before any device-affecting operation.

The runtime process is restartable. Sidecar generation identifiers separate events and responses across restarts. A crash during an active run fails that run; non-idempotent device actions are never automatically retried merely because the Sidecar restarted.

Packaging uses a frozen, project-controlled Python runtime. Production must not depend on the user's system Python, global packages, `PATH` order, or a global MaaFramework installation.

## Boundary rules

- Sidecar stdout contains protocol frames only; diagnostics use redacted stderr.
- Blocking native waits do not block the Python event loop.
- Device writes are serialized per device and recheck cancellation immediately before dispatch.
- Large images remain in bounded runtime-owned storage and cross IPC through lifecycle-managed handles or bounded previews.
- Maa callback threads enqueue normalized events and return quickly; they never call frontend IPC directly.
- The frontend cannot choose executable paths, module names, arbitrary process arguments, or backend implementation classes.
- Runtime state is identified by run and Sidecar generation so stale results can be discarded safely.

The exact active-run concurrency limit, run snapshot representation, production resource limits, and forced-shutdown deadlines remain contract and implementation decisions for Phases 2 and 4. They must preserve this authority boundary.

## Consequences

Positive consequences:

- Execution semantics have one implementation authority.
- MaaFramework can be integrated through its official Python binding without exposing Maa objects to UI or Rust code.
- The desktop can restart a failed runtime without restarting the whole application when safe.
- Frontend and Rust responsibilities remain smaller and easier to secure.
- Fake and real backends exercise the same scheduler and node executors.

Costs and constraints:

- The product ships and supervises an additional executable.
- IPC compatibility, process startup, cancellation, crash recovery, and packaging require dedicated tests.
- Python runtime size and antivirus behavior must be measured.
- Cross-language diagnostics and IDs require disciplined generated contracts.
- A Sidecar crash cannot reconstruct an uncertain non-idempotent action outcome automatically.

## Rejected alternatives

### Frontend as executor

Rejected because it puts trusted automation behavior in the webview, duplicates runtime rules, and increases graph-wide UI work during execution.

### Rust as executor with Python only as a Maa helper

Rejected because it divides scheduling and backend failure semantics across two authorities and duplicates typed runtime logic.

### Embed Python inside the Tauri process

Rejected for the initial architecture because native faults and interpreter lifecycle would share the desktop process, weakening restart and cleanup isolation.

### Run unsupervised Python scripts

Rejected because arbitrary scripts, inherited environments, uncontrolled paths, and missing lifecycle ownership violate the security model.

## Validation

Existing evidence:

- P0-T02 verifies the selected Maa binding can be isolated behind Python-owned typed boundaries.
- P0-T03 verifies Rust supervision, framed transport, request correlation, startup failure, crash handling, graceful shutdown, and Windows descendant cleanup.
- P0-T04 verifies one canonical schema can generate and validate strict TypeScript and Python contracts.

Later acceptance requires packaged clean-machine startup without system Python, parity tests for frontend previews and authoritative diagnostics, stale-generation rejection, cancellation races, crash-with-pending-request tests, and an end-to-end graph that runs through fake and real backends.

## References

- `docs/architecture/adr/0001-rust-supervised-framed-stdio-sidecar.md`
- `docs/architecture/adr/0002-canonical-json-schema-contracts.md`
- `docs/architecture/adr/0003-rino-owned-typed-graph-runtime.md`
- `docs/development/TAURI_PYTHON_SIDECAR_TRANSPORT_SPIKE.md`
- `docs/MASTER_DEVELOPMENT_PLAN.md`, sections 5, 10, 13, and 19
