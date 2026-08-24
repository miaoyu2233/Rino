# ADR-0001: Rust-Supervised Framed Stdio Sidecar

- Status: Accepted for the initial local transport
- Date: 2026-07-24
- Decision owner: Rino desktop/runtime boundary
- Evidence: `P0-T03`

## Context

Rino needs a local boundary between its Tauri desktop process and the authoritative Python graph runtime. The boundary must support request correlation, ordered events, bounded failure handling, clean shutdown, and future replacement by a secure remote transport without changing domain messages.

Unframed JSON lines are not sufficient because process output delivery does not preserve message boundaries and JSON strings may contain line breaks. Giving the frontend a generic process API would also violate least privilege. A local HTTP server would add port discovery, local-network policy, authentication, and another exposed parser without solving the process-lifecycle problem.

## Decision

The initial local transport is UTF-8 JSON over the Sidecar's stdin and stdout, supervised by trusted Rust code.

Each frame is:

```text
Content-Length: <decimal UTF-8 byte length>\r\n
\r\n
<exact JSON body bytes>
```

The decoder is incremental and must accept partial frames and multiple frames per read. It validates the header before allocating the body, enforces a negotiated frame limit, validates UTF-8 and JSON, and then validates envelope semantics. A malformed, oversized, truncated, or invalid frame invalidates the current Sidecar generation.

Rust owns process creation, stdin, stdout, stderr, request IDs, response correlation, timeouts, shutdown, crash handling, and event forwarding. Sidecar stdout contains protocol bytes only. Human-readable or structured diagnostics use stderr and must follow the project's redaction policy.

The webview receives typed application commands and events only. The JavaScript shell API is not part of the frontend dependency surface, and no `shell:*` capability is granted. Tauri packaging declares exactly one known external binary identifier. Rust may use Tauri's Rust-side Sidecar API for that fixed identifier after the production shell is scaffolded; user-controlled program names, executable paths, and arbitrary arguments are not accepted.

Windows process ownership uses a Job Object configured with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Graceful shutdown has a bounded deadline; timeout or crash closes the process tree boundary and waits for exit. Other platforms require an equivalent process-group adapter before they become supported release targets.

Protocol envelopes remain independent of Tauri and stdio. Request/response/event schemas, generation identifiers, feature negotiation, and production limits will be established by `P0-T04` and Phase 2 contracts.

## Consequences

Positive consequences:

- No listening socket or local network service is required.
- Process ownership and protocol correlation have one Rust authority.
- The frontend cannot select or launch operating-system commands.
- Fragmentation and combined reads are handled deterministically.
- The transport can later be replaced without redefining graph-runtime messages.

Costs and constraints:

- Rust must continuously drain both stdout and stderr.
- Large images cannot travel repeatedly through this JSON channel; they require bounded opaque preview handles.
- A frozen Python executable and Tauri external-binary packaging still need separate clean-machine verification.
- Cross-platform process-tree termination requires platform-specific adapters.

## Rejected alternatives

### JSON lines

Rejected because line delivery is not a process-message boundary and creates avoidable escaping and buffering assumptions.

### Frontend shell plugin access

Rejected because it exposes process-launch authority to the webview and makes program/argument scope part of the frontend attack surface.

### Local HTTP or WebSocket server

Rejected for the initial local transport because it introduces port, authentication, origin, firewall, and lifecycle concerns without a current remote requirement.

### Tauri event payloads as the Python transport

Rejected because Python is a separate process. Tauri events remain the Rust-to-frontend boundary, not the Rust-to-Python byte transport.

## Validation

The isolated spike proves:

- Partial-frame and combined-frame decoding.
- Malformed header, oversized frame, invalid UTF-8, and truncated EOF rejection.
- UUID v4 request correlation even when an unrelated response arrives first.
- Handshake response and streamed `system.ready` event delivery.
- Graceful shutdown, startup timeout cleanup, crash handling, and pending-request failure.
- Windows Sidecar and descendant-process termination through the Job Object.
- A Tauri capability fixture with one fixed external binary and no `shell:*` permission.

## References

- [Tauri external binary and Rust Sidecar documentation](https://v2.tauri.app/develop/sidecar/)
- [Tauri capabilities documentation](https://v2.tauri.app/security/capabilities/)
- [Tauri permissions documentation](https://v2.tauri.app/security/permissions/)
