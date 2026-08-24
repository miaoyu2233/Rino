# Runtime Boundary

> Tasks: P1-T06, P2-T01, P2-T02, P2-T03, P2-T04, P2-T05, P4-T05
> Status: Implemented and verified, with the open items listed in section 7
> Last reviewed: 2026-07-26

This document records what the contract, transport, supervision, and interface layers
actually do, and what evidence exists for each claim. It is the reference for anyone
changing the boundary between the desktop application and the graph runtime.

## 1. Canonical contract

`contracts/ipc/rino-ipc-v1.schema.json` is the single source of truth for version-one IPC.
`tools/contracts/generate.py` produces four tracked artifacts from it: TypeScript types and
a schema module under `packages/contracts-ts/src/generated/`, and Pydantic models plus a
schema module under `services/runtime/src/rino_runtime/contracts/generated/`. The generator
runs twice into separate temporary roots and compares the output byte for byte, then
compares that output with the tracked files, so a stale or non-deterministic artifact fails
the workspace check.

Two schema decisions are load-bearing:

- `JsonValue` uses `anyOf` and lists `integer` ahead of `number`. A single `number` branch
  made every generated model widen integers to floating point, which put `1.0` on the wire
  where the desktop expected an integer and silently broke version negotiation.
- Absent optional fields are omitted from the wire rather than serialized as `null`, because
  the canonical schema types those fields by their present form. `dump_model` in
  `services/runtime/src/rino_runtime/contracts/models.py` is the single place that enforces
  this for nested models.

Shared fixtures under `contracts/fixtures/` are validated by all three languages.
The `payload-invalid` group exists because an envelope can be valid while the body inside it
is not; the envelope schema types payloads as generic JSON objects.

## 2. Framing

Both ends implement the same Content-Length framing with the same limits. A framing failure
poisons the decoder rather than attempting to resynchronize: after a malformed header the
position in the byte stream is unknown, so continuing would reinterpret payload bytes as
protocol.

The runtime reads with `read1` rather than `read`. A buffered `read(n)` blocks until it has
exactly `n` bytes or the peer closes the pipe, which stalls a streaming protocol until
disconnect.

## 3. Runtime service

`services/runtime/src/rino_runtime/service.py` owns protocol state: it requires a successful
handshake before any other request, negotiates the protocol version and frame limit, answers
health, exposes registry, validation, run, and cancellation methods, and stops on shutdown or
end of input. End of input is also how a parent-process exit is observed.

`RuntimeApplication` owns one immutable registry and at most one active run. The graph runs
on a dedicated event-loop thread. A single bounded protocol-writer thread owns stdout, so
node, edge, log, and terminal events continue to stream while the input thread waits for the
next request. Immediate responses are queued before a run is launched or cancellation is
signalled. Detailed method, ordering, limit, and privacy contracts are in
`RUNTIME_IPC_METHODS.md`.

Standard output carries only protocol frames. Diagnostics go to standard error as one JSON
object per line through an allowlist of fields, so payload content, project data, and
absolute paths cannot reach a log. A rotating file sink is available when the desktop passes
`--log-directory`.

## 4. Desktop supervision

`apps/desktop/src-tauri/src/sidecar/` owns the runtime process. The desktop always chooses
the program: a release build accepts only the bundled runtime beside the application
executable, and the workspace-interpreter fallback is compiled out of release builds.

A dedicated dispatcher thread drains the runtime's output. Events are forwarded as they
arrive rather than only while a request happens to be waiting, and responses are parked in a
mailbox that request callers wait on. An earlier design pumped events opportunistically
during a request wait, which meant the readiness event was never delivered when no request
was pending.

Rust validates the envelope — identifier format, message-type shape, member presence, and
every size limit — and forwards message bodies opaquely. Body validation belongs to the two
validating ends. `sidecar_protocol.rs` names the two shared fixtures whose only defect lives
inside an error body, so a fixture that should have been caught at the envelope layer cannot
be excused by accident.

The Windows Job Object in `process.rs` carries the only `unsafe` in the desktop crate. The
workspace denies `unsafe_code`; the carve-out is one module, and every call documents why it
is sound.

## 5. Interface

`apps/desktop/src/ipc/` holds the runtime client. It is written against a `RuntimeTransport`
interface rather than the desktop framework, so the local transport can be replaced later and
so tests exercise the real client against a substitutable boundary.

The client owns two invariants. A lifecycle command never runs concurrently with itself, so a
repeated click cannot start two runtimes. An event is applied only when it belongs to the
current runtime generation and advances its sequence, so output from a previous instance
cannot rewrite visible state.

Failures reach the user through two channels. A transient notification reports a non-blocking
outcome and disappears. A persistent problem stays in the Problems panel until dismissed.
Error boundaries wrap the application root and each shell region separately, so a failure in
one region leaves the rest usable, and neither boundary records the caught error message.

## 6. Command surface

Application commands are allowed by default in this desktop framework; only plugin commands
are gated by capabilities. The reviewed allowlist is therefore enforced by test:
`the_registered_command_surface_matches_its_allowlist` fails when a command is registered or
defined outside it. The frontend has no shell or process capability, and lint forbids
importing a shell or child-process module.

## 7. Verification and open items

Verified by automated test on every workspace check:

- 84 Python tests, including 8 fault-injection cases at the runtime's transport boundary.
- 31 Rust tests, including 7 supervisor lifecycle cases and 8 fault-injection cases that each
  drive a real process scripted to misbehave in one specific way.
- 104 frontend tests across the desktop application (75) and the shared contracts package
  (29), including runtime client, event acceptance, and shell integration.
- Deterministic contract generation and tracked-artifact freshness.

Open items:

- Packaging. The runtime starts from the workspace interpreter in development builds. The
  bundled external-binary path depends on the Phase 9 bundler decision (D-005), so the
  packaged-start gate is not met.
- Descendant cleanup. The Job Object covers the process tree, but this crate proves cleanup
  only for the runtime process itself. The Phase 0 spike covered descendants.
- Automatic restart after a crash during an active run is implemented and bounded, but is not
  yet exercised end to end; only explicit restart is covered by test.
- Visual review at 100–200 percent Windows scaling remains a Phase 1 acceptance gate and is
  not satisfied by any automated check here.
