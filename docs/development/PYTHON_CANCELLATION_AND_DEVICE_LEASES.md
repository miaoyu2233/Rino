# Python Cancellation and Device Leases

## Scope

P4-T04 implements cooperative runtime cancellation and per-device operation serialization under `services/runtime/src/rino_runtime/execution_control`. These primitives are independent of React, Tauri, IPC transport, MaaFramework, and graph persistence.

The scheduler receives cancellation and device binding from the future `run.start` boundary. A graph never stores a physical device identifier. Executors receive only the opaque device key bound to the active run.

## Cancellation model

`CancellationProbe` is the minimum synchronous contract used at dispatch boundaries. `CancellationSignal` adds an awaitable notification for operations that must stop while suspended.

`CancellationScope` is the normal mutable implementation. It is owned and mutated by one runtime event loop. Cancellation is monotonic and idempotent:

- the first `cancel()` call returns `True` and wakes all waiters;
- later calls return `False`;
- `raise_if_cancelled()` raises `RuntimeCancellationError` after cancellation;
- `wait_cancelled()` lets delays and resource waits react without polling.

`RuntimeCancellationError` is separate from node input and property failures. The scheduler maps it to stable code `NODE_CANCELLED` and terminal run state `cancelled`. A cancellation raised while a node is active records a bounded node failure event before the terminal run event.

`NeverCancelled` remains available for pure tests and operations whose caller has no mutable cancellation source. It implements only the synchronous probe, so it must not be used for user-started runs that require prompt interruption.

## Cancellable delay

`cancellable_delay()` races the requested timer against the scope notification. It cancels and settles the losing internal task before returning or raising, including when its own caller task is cancelled.

Cancellation wins when the timer and cancellation signal become ready in the same event-loop turn. The final cancellation check prevents a completed timer from hiding a concurrent user cancellation.

`core.time.delay` uses this primitive. A long delay therefore ends promptly after the run scope is cancelled instead of waiting for the original duration. Durations remain finite, non-negative, and bounded by the node executor.

## Device binding

`NodeExecutionContext.device_key` carries an opaque run-bound identifier. `GraphScheduler` receives this value from its caller and passes the same value to every activation. It does not derive the key from graph properties, node inputs, UI labels, operating-system paths, or MaaFramework payloads.

The key is intentionally absent from `GraphV1`, stored values, scheduler events, terminal errors, and runtime logs. Device resolution and validation belong to `run.start` in P4-T05. The lease layer performs a defensive non-empty and length check but does not interpret or normalize the identifier.

## Lease semantics

`DeviceLeaseProvider` is the executor-facing interface. `DeviceLeaseManager` is the in-process implementation used by the Phase 4 fake action path.

- Operations using the same device key are mutually exclusive.
- Operations using different device keys may proceed concurrently.
- Cancellation is checked before waiting and immediately after acquisition.
- A waiter cancelled while blocked never enters the protected operation.
- If acquisition and cancellation race, cancellation wins and any acquired lock is released.
- Cancellation of the caller task also cleans up a pending acquisition.
- Unused device entries are removed after the final holder or waiter exits.

The runtime composition root must share one lease manager across every executor that can affect devices. Creating one manager per action would not provide serialization. The test-registry factory creates a private manager only as a safe default for isolated tests and accepts an injected shared provider for integration tests.

Leases serialize controller-affecting work; they do not authorize it. Capability allowlists, run binding, device availability, timeouts, and backend-specific validation remain separate checks.

## Fake action integration

`test.fake.action` remains test-only. It now requires a run-bound device key, enters the injected device lease, checks cancellation again, and then calls its recorder. A missing binding fails with `NODE_DEVICE_NOT_BOUND`.

The fake path demonstrates the production ordering expected for future click and controller executors:

1. validate bounded inputs;
2. require the run-bound device;
3. wait for the device lease with cancellation;
4. recheck cancellation inside the lease;
5. perform the device operation;
6. return a typed result after the backend outcome is known.

No arbitrary command, shell, raw Maa action document, plugin, or model capability is introduced by this abstraction.

## Backend interruption boundary

Cooperative cancellation can stop a delay or a lease waiter immediately. A backend operation already executing must expose and implement its own safe stop contract. P4-T04 does not pretend that task cancellation alone can establish the outcome of a non-idempotent device action.

Future Maa-backed executors must classify an interrupted non-idempotent operation as outcome unknown unless the backend provides a verified result. They must not retry it automatically.

## Verification

Focused checks:

```powershell
uv run --frozen --project services/runtime ruff check services/runtime/src/rino_runtime/execution_control services/runtime/src/rino_runtime/nodes services/runtime/src/rino_runtime/scheduler services/runtime/tests/test_cancellation.py services/runtime/tests/test_device_lease.py services/runtime/tests/test_node_executors.py services/runtime/tests/test_scheduler.py
uv run --frozen --project services/runtime pyright --project services/runtime/pyproject.toml
uv run --frozen --project services/runtime pytest -c services/runtime/pyproject.toml services/runtime/tests/test_cancellation.py services/runtime/tests/test_device_lease.py services/runtime/tests/test_node_executors.py services/runtime/tests/test_scheduler.py
```

The regression suite covers idempotent cancellation, waiter wake-up, cancellation during a long delay, scheduler terminal mapping, same-device exclusion, cross-device parallelism, cancellation while waiting, repeated cancellation/acquisition races, lock cleanup, invalid keys, missing run binding, fake-action lease use, and scheduler propagation of the run-bound device key.
