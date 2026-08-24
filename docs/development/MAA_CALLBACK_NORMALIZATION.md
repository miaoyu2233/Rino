# Maa Callback Normalization

## 1. Scope

F-MVP-04 converts the pinned MaaFramework 5.10.5 callback surface into bounded,
Rino-owned operation events. MaaFramework remains an automation backend; callback JSON
does not become a graph format, public error object, log record, or frontend state model.

The reviewed upstream callback shape is `(handle, message, details_json, trans_arg)`.
Controller action and Tasker task callbacks may arrive from native worker threads and the
callback must return quickly. See the official
[MaaFramework callback protocol](https://maafw.com/en/docs/2.3-CallbackProtocol/).

## 2. Allowed callback surface

The normalizer accepts only these exact messages:

- `Controller.Action.Starting`
- `Controller.Action.Succeeded`
- `Controller.Action.Failed`
- `Tasker.Task.Starting`
- `Tasker.Task.Succeeded`
- `Tasker.Task.Failed`

Controller messages must contain a positive bounded integer `ctrl_id`. Tasker messages
must contain a positive bounded integer `task_id`. Every other message, missing field,
boolean identifier, oversized identifier, invalid UTF-8 value, invalid JSON document, or
oversized raw callback is rejected without raising across the native callback boundary.

The following upstream fields are never retained or forwarded:

- controller UUID;
- action name, parameter, and information objects;
- Tasker entry, UUID, and hash;
- arbitrary callback details;
- device address, local path, recognized text, image, or graph value.

Rino derives the operation kind only from the code path that posted the reviewed job. It
never trusts the upstream action or entry string to select a capability.

## 3. Thread and queue model

`MaaCallbackHub.receive` performs only bounded validation, sequence assignment, a short
critical section, queue insertion, and a wake signal. It performs no file access, network
access, event-loop work, frontend IPC, image processing, or user callback invocation.

A dedicated dispatcher thread resolves queued notifications against Rino-owned job
correlations and invokes the runtime event sink. The default hard limits are:

| Resource | Limit |
| --- | ---: |
| Queued callback notifications | 256 |
| Bound job correlations | 1,024 |
| Simultaneously active callback generations | 32 |
| Diagnostic aggregation buckets | 64 |
| Unmatched callback binding grace | 1,000 ms |

When a callback arrives before the Maa posting method returns its job object, it remains
queued during the binding grace period. Binding the job wakes the dispatcher. An expired
unmatched callback becomes one aggregated diagnostic rather than an unbounded record.

Queue overflow drops the oldest callback. Correlation overflow evicts the oldest binding.
Both paths increment bounded diagnostic counters. Diagnostic counters contain only a
stable code, count, generation, and optional latest callback sequence.

## 4. Generation and lifecycle rules

Every reviewed controller callback registration receives a monotonically increasing
backend generation. Its bound Tasker sinks share that generation. A callback is accepted
only while its generation is active.

Disconnect, failed connection cleanup, replacement, and shutdown remove Tasker sinks,
remove the controller sink, retire the generation, and erase its correlations. A callback
from an already retired generation is dropped and summarized as
`AUTOMATION_CALLBACK_GENERATION_STALE`.

Closing the callback hub clears pending callbacks, correlations, diagnostics, active
generations, and the event sink. Calls arriving after close are counted internally and
return without raising. Shutdown never waits on native callback code; the dispatcher has
a bounded join and the production runtime sink is a non-blocking message-queue boundary.

## 5. Correlation contract

Each posted reviewed job may bind these Rino identifiers:

- request ID;
- run ID;
- node ID;
- activation ID;
- Rino operation kind;
- Maa controller or Tasker job ID;
- callback registration generation.

The scheduler adds request, run, node, and activation identity to
`NodeExecutionContext`. Production capture, OCR, and click executors pass the resulting
correlation explicitly through the backend protocol. Manual connect, disconnect, and
preview capture bind the initiating IPC request ID. Optional identifiers remain absent
when an operation has no corresponding scope.

The OCR result's existing recognition-detail ID remains the result identity. Callback
correlation uses the Tasker job ID because that is the identifier carried by
`Tasker.Task.*`; the two values are not conflated.

## 6. IPC events

`automation.operationStateChanged` carries:

- `source`: `controller` or `tasker`;
- `state`: `starting`, `succeeded`, or `failed`;
- an allowlisted `operationKind`;
- decimal-string `backendOperationId`;
- positive `backendGeneration` and `callbackSequence`;
- bounded monotonic `observedAtMilliseconds`;
- optional request and activation IDs.

Run and node IDs use the existing event envelope fields. The backend operation ID is a
decimal string so a native 64-bit identifier cannot lose precision in TypeScript.

`automation.callbackDiagnostic` carries only an allowlisted code, aggregated count,
generation, and optional latest callback sequence. It never carries upstream message
text or details.

Both payloads are canonical JSON Schema Draft 2020-12 definitions. Python and TypeScript
types are generated from the schema and the normal runtime payload validator checks every
event before emission.

## 7. Operation allowlist

The MVP event contract contains only Rino-posted operations:

- device connection;
- device disconnection;
- screen capture;
- OCR;
- OCR stop;
- click.

Callbacks cannot create node types or expose shell, command, custom action, plugin,
arbitrary model, arbitrary Pipeline, or raw action-parameter capabilities.

## 8. B-MVP-04 handoff

B-MVP-04 may consume the two generated event payload types and the existing event
envelope. Presentation code may group an operation by run, node, activation, operation
kind, and backend operation ID. It must tolerate a starting event that is absent because
of overflow, and it must treat diagnostics as aggregate health information rather than
individual backend logs.

B-MVP-04 must not:

- parse Maa callback JSON;
- infer capabilities from an action or entry string;
- change callback limits, correlation, generation, or lifecycle behavior;
- add recognized text, parameters, paths, UUIDs, hashes, or images to operation events;
- block runtime event handling while rendering diagnostics.

## 9. Verification

The automated coverage includes:

- callback-before-binding correlation;
- raw-field redaction;
- malformed and unsupported callback handling;
- queue and correlation overflow;
- stale-generation rejection;
- repeated shutdown and callback-after-close behavior;
- concurrent callback sequence uniqueness;
- dispatcher thread separation;
- native invalid-JSON containment;
- official binding registration and retirement;
- canonical IPC serialization and invalid raw-detail fixtures;
- complete Python runtime and TypeScript contract regression suites.
