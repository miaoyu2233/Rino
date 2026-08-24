# Python Scheduler

## Scope

P4-T03 implements the authoritative deterministic scheduler under `services/runtime/src/rino_runtime/scheduler`. It executes a frozen `GraphV1` revision against an immutable `NodeRegistry`. It accepts an opaque run-bound device key but has no React, Tauri, MaaFramework, device-backend, IPC, or file-system dependency.

The scheduler is intentionally single-run and single-threaded. Independent execution branches are queued rather than run concurrently. Explicit parallel execution remains outside the MVP until cancellation, value ownership, device serialization, and debugger behavior have a separate specification.

## Preconditions

The caller must first parse, migrate, and validate the complete project document with the authoritative Python graph boundary. The scheduler defensively checks the entry node, registry definitions, required value availability, execution cycles, literal conversion, result contracts, and all configured resource limits, but it does not duplicate project-level validation.

One `GraphScheduler` instance executes exactly once. It deep-copies the supplied graph so editor mutations cannot alter an active run. The registry is already immutable.

## Limits

`SchedulerLimits` requires the caller to provide:

- maximum node activations;
- maximum wall-clock duration;
- maximum queued execution tokens;
- maximum stored value generations;
- maximum stored log entries;
- maximum ordered events;
- maximum pure-dependency depth.

P4-T03 does not invent product-default numbers that the plan has not approved. P4-T05 must supply reviewed application defaults when it exposes `run.start`. All limits are checked inside the Python authority and cannot be relaxed by frontend metadata.

The event limit reserves one slot for the terminal run event. A run therefore always ends with exactly one of `run.succeeded`, `run.failed`, or `run.cancelled`, including when another limit is exhausted.

## Token queue and ordering

The first token targets the sole entry node. Every successor token records:

- a monotonic run-local token ID;
- its target node ID;
- its parent token ID;
- the execution edge that created it.

Selected execution output ports are processed in the order returned by the executor. Edges connected to each selected output retain their order in the frozen graph document. New tokens enter a FIFO queue in that combined order. This makes Sequence fan-out and branch traversal deterministic without deriving behavior from node position, edge styling, UUID sorting, or dictionary ordering.

Initial arbitrary execution cycles are rejected before the first node is dispatched. Future loop nodes must own their iteration and frame semantics explicitly rather than relying on unrestricted graph cycles.

`core.flow.stop` returns a terminal result. It clears already queued sibling tokens and ends the run successfully. User cancellation is a separate terminal state.

## Activations and ordered events

Every actual executor call creates a run-local `NodeActivation`. Pure-cache hits do not create false activations. The final snapshot retains both token lineage and activation history.

Events use one gap-free sequence number across the run:

1. `run.started`;
2. zero or more `node.started`, `node.completed`, `node.failed`, and `edge.traversed` events;
3. one terminal run event.

Node-completion events expose bounded output port IDs rather than copying runtime values. Values remain in the runtime-owned store for later bounded summary requests.

## Input and property resolution

For each declared data input, the scheduler uses exactly one of:

1. the current stored generation from its connected source port;
2. the node's literal fallback when the port permits a literal;
3. no value when the port is optional.

A required input without an available value fails before its executor is dispatched. A connected execution-node output must already have a committed generation. The scheduler never guesses a default for a missing runtime value.

Node properties start from registry defaults and are then replaced by the frozen node instance's properties. Phase 4 accepts bounded JSON primitives and collections. Structured point, rectangle, image, and OCR values enter through typed runtime adapters rather than being guessed from arbitrary JSON objects.

## Pure dependency resolution and cache

Pure dependencies are evaluated recursively on demand. The recursion stack rejects cycles and the configured depth limit prevents hostile or accidental deep chains.

Each pure-node cache entry records the exact generation of every connected upstream value used to resolve its inputs. A later request reuses the outputs only when that dependency signature is unchanged. When any upstream execution output advances generation, the pure node is evaluated again and its output generations advance atomically.

Literal-only pure nodes have no changing runtime dependencies and can remain cached for the frame. Graph and property edits cannot invalidate a running cache because the active graph revision is frozen.

## Atomic result commit

`NodeRegistry.execute` first validates all executor outputs against the registered definition. The scheduler then checks value and log capacity before committing any part of the result.

Each stored value is keyed by run, frame, node, port, and monotonically increasing port generation. The store retains ordered history plus the current generation used for downstream resolution. Logs retain run, activation, node, level, message, and a separate ordered sequence.

If capacity validation fails, no value or log from that node result is committed. The node emits a bounded failure event and the run fails.

## Failure and cancellation behavior

Scheduler failures expose a stable code, localization key, and optional node or port ID. They never echo graph values, log text, exception messages, paths, or backend payloads.

Executor validation failures are mapped to `SCHEDULER_EXECUTOR_CONTRACT_VIOLATION`. Unexpected executor exceptions are mapped to `SCHEDULER_EXECUTOR_FAILED`. Expected domain outcomes remain typed results and do not fail the run.

`NODE_CANCELLED` produces the distinct `cancelled` terminal state. P4-T03 performs cancellation checks before dispatch and passes the same probe into executors. P4-T04 adds the mutable cooperative cancellation scope, cancellation-aware delay, run-bound device context, and per-device lease abstraction described in `PYTHON_CANCELLATION_AND_DEVICE_LEASES.md`.

An already executing backend operation still requires its own verified stop adapter. Cancelling a Python task alone must not be treated as proof that a non-idempotent device action did not occur.

Breakpoint state is rejected explicitly with `SCHEDULER_BREAKPOINT_UNSUPPORTED` until P4-T07 connects pause, continue, and step-over control. The scheduler never silently ignores a saved breakpoint.

## Verification

Focused checks:

```powershell
uv run --frozen --project services/runtime ruff check services/runtime/src/rino_runtime/scheduler services/runtime/tests/test_scheduler.py
uv run --frozen --project services/runtime pyright --project services/runtime/pyproject.toml
uv run --frozen --project services/runtime pytest -c services/runtime/pyproject.toml services/runtime/tests/test_scheduler.py
```

The regression suite covers repeatable event/value snapshots, FIFO token lineage, graph-edge ordering, pure-cache reuse, atomic value limits, step/time/queue/value/log/event limits, pre-dispatch cancellation, terminal-node queue clearing, missing inputs, execution-cycle rejection, explicit breakpoint rejection, and limit-model validation.
