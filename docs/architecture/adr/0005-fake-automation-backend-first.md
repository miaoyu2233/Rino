# ADR-0005: Deterministic Fake Automation Backend Before Maa Integration

- Status: Accepted
- Date: 2026-07-24
- Decision owner: Rino automation backend boundary
- Evidence: MVP acceptance criteria and `P0-T02`

## Context

The graph language, scheduler, debugger, cancellation model, and frontend runtime visualization must be proven before they depend on a physical device, emulator state, OCR model behavior, ADB stability, or native MaaFramework packaging. Hardware-first integration would make failures difficult to attribute and would leave core runtime behavior without deterministic automated tests.

A fake implementation can remove external variability, but only if it exercises the same Rino-owned interfaces and production node semantics. A separate fake graph language or a collection of fake-only product nodes would produce misleading coverage and require the reference graph to be rewritten for real devices.

## Decision

Rino implements a deterministic fake automation backend before integrating the real Maa automation backend.

The fake backend implements the same Rino-owned backend protocols used by `MaaAutomationBackend`, including the relevant device, capture, recognition, action, and health boundaries. Production node executors depend on those protocols and do not branch on concrete backend classes.

Backend selection occurs in trusted runtime composition or an explicit validated run configuration. It is not encoded as arbitrary executable code, a Python module path, or backend-specific properties in the persisted graph.

The numeric-recognition reference graph uses stable production node type keys and production port contracts. Tests may run that graph with deterministic capture, OCR, and action results from the fake backend, then run the same graph semantics with Maa once the real adapter is available.

`test.fake.*` node keys are reserved for explicit test-only fixtures such as fault injection or isolated scheduler tests. They are not substitutes for production-node contract tests, are not exposed in the normal production registry or palette, and must not appear in publishable user projects. References in the Phase 4 task list to fake OCR or fake action are implemented primarily as fake backend capabilities behind production executors; any fake-only node remains inside the test boundary.

The fake backend must support deterministic scenarios for:

- configured capture dimensions and image handles;
- OCR hit, no-hit, candidates, text, confidence, rectangles, and structured failure;
- action success, failure, cancellation race, and recorded invocation order;
- connection and health state;
- bounded delay and controllable completion;
- backend crash or protocol-fault simulation at explicit test seams.

Fixtures use sanitized synthetic data. The fake backend does not silently activate in production after a Maa initialization or device failure. Production failure remains visible and actionable.

## Contract-test policy

Each automation backend must pass a shared behavioral suite covering:

- normalized request validation;
- typed result and error shape;
- coordinate-space preservation;
- cancellation before dispatch and during supported work;
- per-device write serialization;
- resource and image-handle lifetime;
- event ordering and correlation;
- no screenshot persistence or logging by default;
- bounded outputs and safe diagnostics.

Backend-specific suites supplement rather than replace this shared suite. Fake results cannot be hard-coded inside production node executors.

## Consequences

Positive consequences:

- Scheduler and debugger tests are deterministic and fast.
- Runtime, IPC, and frontend visualization can progress without hardware.
- The same production node contract is exercised before and after Maa integration.
- Cancellation and failure races can be reproduced precisely.
- Maa-specific defects are easier to distinguish from graph-runtime defects.

Costs and constraints:

- The fake backend is maintained as a real contract implementation rather than an ad hoc mock.
- Shared tests must avoid assuming fake-only timing or implementation details.
- Device and OCR compatibility still require controlled real-backend testing.
- Test-only registries and fixtures must be impossible to select accidentally in production.
- Synthetic success does not satisfy packaging, license, native, or real-device gates.

## Rejected alternatives

### Integrate Maa before implementing the scheduler

Rejected because external variability would obscure core runtime and cancellation defects.

### Use fake-only graphs and rewrite them for Maa

Rejected because it fails to prove production node compatibility and permits semantic drift.

### Mock Maa binding classes directly in every node test

Rejected because Maa object shapes would leak beyond the adapter and tests would couple to third-party implementation details.

### Fall back to fake results when Maa fails

Rejected because it would conceal production failures and could cause unsafe or misleading automation behavior.

## Validation

Phase 4 must prove the numeric-recognition vertical slice with deterministic scenarios for greater, equal, lower, no match, parse failure, cancellation, and executor failure. The runtime must have no Maa import in this phase.

Phase 5 must run the shared backend contract suite unchanged against the Maa adapter, retain the fake suite, and demonstrate that the reference graph does not need backend-specific topology or port changes.

Production builds must include an automated assertion that test-only backend selection and `test.fake.*` palette registration are disabled.

## References

- `docs/architecture/adr/0003-rino-owned-typed-graph-runtime.md`
- `docs/architecture/adr/0004-python-sidecar-authoritative-executor.md`
- `docs/development/MAA_PYTHON_DIRECT_OPERATION_SPIKE.md`
- `docs/MASTER_DEVELOPMENT_PLAN.md`, sections 2.3, 11, 12, and Phase 4
