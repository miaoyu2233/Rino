# Runtime IPC Methods

> Tasks: P4-T05 and P5-T02
> Status: Implemented and verified
> Last reviewed: 2026-07-27

This document defines the implemented desktop-to-runtime methods for registry and device
discovery, device sessions, authoritative graph validation, graph execution, cancellation,
and live runtime events. The canonical wire shapes remain owned by
`contracts/ipc/rino-ipc-v1.schema.json`.

## 1. Ownership and concurrency

`RuntimeApplication` owns the immutable node registry, authoritative validator, active run,
and latest completed run. One Sidecar generation accepts at most one active graph run. A run
executes on its own event-loop thread so the input thread remains able to receive
`run.cancel`, health, and shutdown requests.

When Maa device management is configured, `MaaDeviceServiceHost` owns one separate event-loop
thread. Discovery, connection, reconnect, health checks, device operations, and deactivation
all run on that loop. Operations using the same opaque device key share one lease and cannot
overlap. Maa callbacks and Maa job waits never execute on the protocol input thread; the
request handler performs only a bounded wait for the device-loop result.

A single bounded writer queue is the only component allowed to write protocol frames to
stdout. Immediate responses and events are placed in that queue before deferred work starts:

1. `run.start` response;
2. initial `run.stateChanged` event with state `running`;
3. graph thread launch;
4. live node, edge, log, and terminal events.

Cancellation follows the same rule:

1. `run.cancel` response;
2. `run.stateChanged` event with state `cancelling` for the first request;
3. cancellation signal delivery;
4. terminal run event.

The protocol writer queue holds at most 2,048 messages. Enqueue and shutdown waits are
bounded. A stalled or failed writer makes the transport fail rather than allowing unbounded
memory growth or concurrent stdout writes.

## 2. Method contract

Every method requires a completed `system.handshake` except the handshake itself. The
handshake advertises graph schema version 1, the current registry content hash, and the
`runtime.graphExecution` feature flag. An initialized Maa device service additionally reports
its verified binding/native versions and advertises `runtime.deviceManagement`. When the
reviewed capture executor is registered, the handshake also advertises
`runtime.screenCapture`; otherwise the handshake reports only the capabilities backed by the
active registry and runtime composition.

| Method | Request | Result | Important failures | Side effects |
| --- | --- | --- | --- | --- |
| `device.list` | Empty object | Up to 64 safe device descriptors | Backend unavailable, discovery failure, timeout | Refreshes process-local discovery state |
| `device.connect` | Opaque device key | Connected safe device descriptor | Unknown key, connection failure, timeout | Creates or reuses one serialized device session |
| `device.disconnect` | Opaque device key | Available safe device descriptor | Unknown key, deactivation failure, timeout | Releases the session and controller resources |
| `registry.get` | Empty object | Authoritative registry snapshot | Handshake or internal failure | None |
| `graph.validate` | Project document | Executable flag and diagnostic report | Structurally invalid document | None |
| `run.start` | Project document, graph ID, optional device key | Run ID, graph ID, registry version | Invalid document, non-executable graph, missing graph, active run, closing runtime | Reserves and starts one run |
| `run.cancel` | Run ID | Accepted flag, current state, idempotency flag | Unknown or no-longer-retained run | Requests cooperative cancellation once |

`graph.validate` returns semantic diagnostics for a structurally valid document. Structural
parse failures use `GRAPH_DOCUMENT_INVALID`. `run.start` rejects any document whose
authoritative validation report is not executable, even when the selected graph itself looks
runnable.

The runtime deep-copies the selected graph before launch. Later editor mutations cannot
change the active run. The optional device key is opaque, run-bound state; it is never added
to the graph, value store, events, logs, or terminal errors.

A device descriptor contains only `deviceKey`, a generic `displayName`, `controllerFamily`,
and connection `state`. The key is valid only for one Sidecar generation. Physical serials,
ADB addresses, ADB executable paths, agent paths, controller configuration, and Maa details
are forbidden in request and response schemas. Connection and disconnection emit their
response before the matching state event.

The Sidecar accepts Maa configuration only through the paired
`--maa-user-data-directory` and `--adb-executable` launch arguments, with an optional
`--maa-agent-directory`. Relative values are resolved before the binding boundary. The
packaged desktop launch intentionally omits these arguments until an audited ADB payload is
bundled; that build reports Maa and device management as unavailable instead of searching
the host `PATH` or accepting a webview-selected executable.

A debug workspace launch may opt into local device development by defining
`RINO_DEV_ADB_EXECUTABLE` as the absolute path of an existing `adb` executable before
starting `tauri dev`. Rust validates that explicit path and pairs it with a Maa user-data
directory derived from the application's private data directory. Invalid, missing, or
relative values leave the device backend unavailable. The environment lookup and variable
name are compiled out of release builds, and the bundled-runtime branch ignores this
development setting.

For PowerShell development sessions:

```powershell
$env:RINO_DEV_ADB_EXECUTABLE = "C:\absolute\path\to\adb.exe"
corepack pnpm --filter @rino/desktop tauri dev
```

The desktop application must be restarted after changing this setting because Sidecar
arguments are fixed when the process starts.

## 3. Run and cancellation behavior

The Sidecar retains only the latest completed run for cancellation idempotency. A repeated
cancel for the active run reports `alreadyRequested: true` and does not signal twice. A
cancel for the latest completed run also succeeds and reports its terminal state. Any other
run ID fails with `RUN_NOT_FOUND`.

Cancellation is cooperative. It is checked before node dispatch and can interrupt the delay
executor. The runtime distinguishes `cancelled` from `failed`; cancellation never becomes a
generic execution error.

Shutdown marks the application as closing, requests cancellation for an active run, closes
all device sessions, and waits up to five seconds for both graph and device workers. A run
prepared but not launched is released without creating a worker thread. A Sidecar that
cannot stop its runtime or device worker within the bound exits with a transport failure.

## 4. Events

All event envelopes use one monotonically increasing sequence per Sidecar generation. The
desktop additionally rejects stale generations. Scheduler-derived events include
`runSequence`, where applicable, so execution order remains visible independently of
connection-level events.

| Event | Purpose | Key payload fields |
| --- | --- | --- |
| `device.stateChanged` | A requested connection change or detected connection loss | Safe device descriptor and reason |
| `run.stateChanged` | Initial, cancelling, and terminal run state | State, graph ID, terminal statistics, bounded terminal error |
| `node.stateChanged` | Node running, succeeded, or failed | Scheduler sequence, token ID, activation ID, output ports, value summaries, error code |
| `edge.traversed` | One execution token traversed an edge | Edge ID, scheduler sequence, token ID, source output port |
| `runtime.logCreated` | One executor-created log entry | Log sequence, activation ID, level, bounded message |

The scheduler commits all outputs and logs for a node before emitting that node's completed
event. The runtime observer therefore never exposes a completed node whose advertised output
summary has not been committed.

## 5. Bounded value summaries

Runtime values remain owned by the Python process. Events expose display summaries only:

- strings and OCR previews are limited to 256 characters and include a truncation flag;
- images expose dimensions only, never handles, bytes, file paths, or pixels;
- collections and OCR results expose bounded item counts, never collection contents;
- scalar, point, and rectangle previews are compact text plus their stable kind;
- every summary identifies its port and value generation.

The frontend must treat summaries as transient runtime presentation data. They are not a
project persistence format and cannot be used as executor inputs.

## 6. Runtime limits

P4-T05 supplies the first reviewed application defaults required by the scheduler boundary:

| Limit | Default |
| --- | ---: |
| Node steps | 10,000 |
| Run duration | 3,600 seconds |
| Pending execution tokens | 4,096 |
| Stored values | 20,000 |
| Stored logs | 10,000 |
| Scheduler events | 50,000 |
| Pure dependency depth | 128 |

These limits are runtime authority. A frontend request cannot increase them. IPC also retains
the negotiated frame limit and the canonical JSON collection and string bounds.

## 7. Structured errors

The new request failures use stable codes and localization keys:

- `AUTOMATION_BACKEND_UNAVAILABLE`
- `DEVICE_DISCOVERY_FAILED`
- `DEVICE_NOT_FOUND`
- `DEVICE_NOT_CONNECTED`
- `DEVICE_CONNECTION_FAILED`
- `DEVICE_CONNECTION_LOST`
- `DEVICE_DEACTIVATION_FAILED`
- `DEVICE_OPERATION_TIMEOUT`
- `DEVICE_SERVICE_CLOSED`
- `GRAPH_DOCUMENT_INVALID`
- `GRAPH_NOT_EXECUTABLE`
- `GRAPH_NOT_FOUND`
- `RUN_ALREADY_ACTIVE`
- `RUN_NOT_FOUND`
- `RUNTIME_CLOSING`

Error technical details are bounded and never echo project content, device keys, node input
values, or third-party diagnostics. Unexpected trusted-handler failures become
`INTERNAL_ERROR` without exposing exception text.

## 8. Verification

Automated coverage includes:

- shared device list, connect, disconnect, and state-event contract fixtures;
- rejection of physical identifiers and addresses at the typed payload boundary;
- available and unavailable Maa handshake states;
- response-before-device-event ordering and opaque metadata output;
- one dedicated Maa event-loop thread, same-device serialization, reconnect, connection
  loss, deactivation, and Sidecar shutdown release;
- authoritative registry and diagnostics results;
- structural and executable graph failure separation;
- response-before-launch and response-before-cancel ordering;
- one-active-run enforcement;
- live node, edge, log, and terminal events;
- atomic value and log observation before node completion;
- cancellation during a 60-second delay and repeated cancellation after completion;
- event streaming while the input thread waits for the next request;
- bounded string previews and image-summary privacy;
- shared Python and TypeScript fixtures for every new message family;
- desktop rejection of invalid runtime event payloads.
