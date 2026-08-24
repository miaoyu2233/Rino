# Cross-language and recovery gate

## Purpose

This gate verifies that the MVP workflow remains one coherent system across project
persistence, the Rust desktop boundary, the Python Sidecar, the authoritative scheduler,
and the frontend runtime projection. It does not use Android hardware and does not add a
fake-backend option to the production executable.

The deterministic backend is injected only by the Rust integration test through the
existing Python construction API. The normal Sidecar entry point continues to expose Maa
capabilities only when its audited application-owned runtime configuration is present.

## Automated vertical slice

`apps/desktop/src-tauri/tests/cross_language_recovery_gate.rs` performs the following
workflow against real Rust/Python process and protocol boundaries:

1. Build the production-node numeric-recognition graph.
2. Save its manifest and graph file through `ProjectWorkspace`.
3. Reopen the project from disk and reconstruct the runtime document from the committed
   files.
4. Start the actual Python protocol service through `SidecarSupervisor`.
5. Validate the reopened document through `graph.validate`.
6. Run capture, OCR, number parsing, comparison, branching, and one safe click through the
   deterministic automation backend.
7. Require ordered terminal events and exactly one successful click-node activation.
8. Restart the Sidecar, require a new generation, and rerun the same reopened document
   with the same activation outcome.
9. Start a long delay through the same cross-process boundary, cancel it, and require an
   idempotent repeated cancellation result.

The test intentionally observes public protocol results and events rather than reaching
into Python objects from Rust. Existing Python tests separately verify the exact fake
backend click record and the direct Maa unknown-outcome boundary.

## Recovery and safety matrix

| Requirement | Automated evidence | Result required by this gate |
| --- | --- | --- |
| Save and reopen | Rust project workspace plus the cross-language vertical slice | Reopened committed files reconstruct the same executable graph |
| Deterministic run | Cross-language vertical slice and Python numeric matrix | The expected branch executes one click node; other branches do not execute |
| Sidecar restart | Cross-language vertical slice and supervisor lifecycle tests | Generation advances and the reopened graph produces the same result |
| Stale output | Rust dispatcher, TypeScript runtime client, and integration tests | An older generation or repeated sequence cannot alter current state |
| Cancellation | Cross-language cancellation plus Python scheduler cancellation tests | The run reaches `cancelled`; a repeated request is idempotent |
| Unknown action result | Direct Maa click fault-injection tests | The result is non-retryable and no layer automatically repeats the click |
| Project recovery | Rust autosave ownership and discard tests | Recovery is offered only to its owning project and never enters the project directory |
| Process loss | Rust supervisor fault-injection tests | Pending requests fail in bounded time and an explicit restart creates a new generation |

## Responsiveness and resource audit

### Execution presentation

- Python caps a run at 10,000 node steps and 50,000 scheduler events, with terminal-event
  capacity reserved.
- Rust rejects repeated or reordered event sequences before forwarding them.
- The frontend batches non-terminal execution events to one animation-frame commit and
  flushes terminal state immediately.
- One event frame produces one Zustand notification. Visible activation history is capped
  at 10,000 entries and visible runtime logs at 1,000 entries.
- Large graph images and preview bytes never enter the execution store.

These controls bound a defective or unusually large graph without delaying terminal state.
Packaged-device profiling remains a release-gate measurement; it is not replaced by a
machine-specific timing assertion in the unit suite.

### Image and capture lifetime

- Full-resolution runtime images are in-process references capped at 8 objects, 192 MiB in
  total, 64 MiB per object, and 300 seconds.
- Preview PNG artifacts are capped at 4 objects, 12 MiB in total, 3 MiB per object, and 30
  seconds. The frontend requests at most 960 by 540, prevents overlapping captures,
  releases replaced tokens, and revokes replaced object URLs.
- Prepared capture artifacts are capped at 2 objects, 128 MiB in total, 64 MiB per object,
  and 60 seconds.
- Rust validates token ownership, generation, file size, PNG structure, and cache scope
  before returning bytes.
- Preview refresh pauses while disconnected, hidden, inactive, or explicitly paused. Its
  adaptive interval ranges from 67 to 1,000 milliseconds and never overlaps requests.

### IPC pressure

- Protocol frames are length-bounded and canonical payloads are validated on both sides.
- Runtime value events contain summaries rather than images or collection contents.
- Scheduler event, queue, stored-value, and stored-log limits prevent unbounded per-run
  output.
- Rust diagnostic lines are capped at 4,096 bytes and are forwarded on a channel separate
  from protocol stdout.
- A terminal framing failure invalidates the Sidecar generation instead of retrying an
  action or allowing a request to hang.

No additional production queue, image, or animation mechanism is introduced by this gate.

## Hardware-dependent acceptance

The following items require a user-controlled Android target and remain outside this fake
backend gate:

- Application-owned ADB discovery and connection against the selected device.
- Live capture dimensions, orientation, and coordinate-space rotation.
- OCR accuracy on user-selected content and the packaged model assets.
- Physical click placement and the visible device response.
- Disconnect, reconnect, cancellation, and process restart while the physical target is
  active.

Those checks belong to `C-MVP-03`. They must not retain device identifiers, screenshots,
private paths, OCR text, or user data as evidence.
