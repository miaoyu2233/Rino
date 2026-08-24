# ADR-0003: Rino-Owned Typed Graph Runtime

- Status: Accepted
- Date: 2026-07-24
- Decision owner: Rino graph language and runtime
- Evidence: Product requirements and `P0-T02`

## Context

Rino must let users express typed values, numeric parsing and comparison, branching, variables, loops, cancellation, debugging, and future reusable subgraphs through a visual graph. MaaFramework provides capture, recognition, control, and related automation primitives, but its Pipeline protocol is not a complete match for Rino's intended language or debugger.

Making Maa Pipeline the canonical representation would expose backend-specific fields in the editor, couple persistence to one automation provider, and force Rino control-flow semantics to follow a protocol that Rino does not own. It would also make capabilities such as typed numeric ports, value inspection, execution frames, and future backend replacement dependent on translation behavior.

The P0-T02 spike verified that the pinned MaaFramework Python binding exposes direct recognition and action operations. Rino can therefore use MaaFramework capabilities without first compiling an entire Rino graph into a Maa Pipeline graph.

## Decision

Rino owns its visual graph language and all execution semantics.

The canonical Rino graph consists of versioned Rino documents, stable node type keys, typed execution and data ports, validated properties, explicit control-flow topology, and Rino-defined runtime values and diagnostics. Maa Pipeline JSON is neither the persistence format nor the execution contract.

The authoritative runtime executes the Rino graph directly. It owns:

- node definitions and port compatibility;
- graph validation that affects execution;
- deterministic scheduling and token order;
- pure-value evaluation and frame-local caching;
- value ownership and bounded inspection summaries;
- branching, parsing, comparison, variables, loops, retries, and future subgraphs;
- cancellation, limits, breakpoints, stepping, and terminal run states;
- structured errors and ordered runtime events.

MaaFramework is one automation backend behind Rino-owned interfaces. General graph code and node executors depend on Rino concepts such as screen capture, recognition, and actions. They do not import Maa types or expose Maa task objects, option structures, Pipeline fields, or callback payloads.

If a required capability in a pinned MaaFramework version is available only through a Pipeline entry, the exception must remain inside the Maa adapter. It must not alter the Rino graph schema or editor model. The implementation must document the limitation and migration path, and the user must explicitly approve any proposal to make Pipeline translation a lasting architecture.

## Invariants

- A saved Rino graph can be understood and validated without loading MaaFramework.
- The same graph-domain contracts can target a fake backend and a supported real backend.
- Backend-specific objects stop at the adapter boundary.
- The frontend may preview diagnostics but cannot define conflicting execution behavior.
- React Flow render objects never become executable or persistent graph authority.
- A backend replacement does not require redefining core control-flow or value semantics.

## Consequences

Positive consequences:

- Rino can support typed numeric and control-flow features independent of Maa Pipeline limitations.
- Persistence, debugging, and tests have stable product-owned semantics.
- MaaFramework remains replaceable behind narrow interfaces.
- The same runtime can execute deterministic fake automation before device integration.
- Backend upgrades are isolated from most graph and UI code.

Costs and constraints:

- Rino must implement and test its own scheduler, validator, value model, limits, debugger, and migrations.
- Node definitions require stable compatibility policy across releases.
- Backend adapters must normalize differing operation and error models.
- Importing external workflow formats will be intentionally lossy unless explicitly specified.
- Feature requests cannot bypass the type system through hidden raw Pipeline fragments.

## Rejected alternatives

### Compile every Rino graph to Maa Pipeline

Rejected because it makes a replaceable backend protocol the effective language runtime and persistence model.

### Persist both a Rino graph and a canonical Maa Pipeline graph

Rejected because two authorities can disagree and create migration, debugging, and round-trip ambiguity.

### Execute graph semantics in the React frontend

Rejected because a webview is not the trusted device-operation boundary and would duplicate Python runtime behavior.

### Expose a raw Maa node for unsupported capabilities

Rejected for the normal product because it bypasses validation, capability review, portability, and safe migration. A narrowly specified future adapter is possible only after explicit review.

## Validation

The P0-T02 spike established that `MaaFw 5.10.5` can perform direct recognition and action operations, controlled capture, cancellation-related stop calls, callback delivery, and result-detail lookup without a Rino graph compiler targeting Maa Pipeline.

Later acceptance requires:

- Phase 4 scheduler and fake-backend tests with no Maa import;
- shared graph validation and runtime fixtures;
- Phase 5 execution of the same production node semantics through Maa direct operations;
- rejection tests proving that raw Maa or Pipeline fields cannot enter persisted Rino graph contracts;
- an adapter contract suite that remains valid for fake and Maa backends.

## References

- [MaaFramework integrated interface overview](https://maafw.com/en/docs/2.2-IntegratedInterfaceOverview/)
- [MaaFramework repository](https://github.com/MaaXYZ/MaaFramework)
- `docs/development/MAA_PYTHON_DIRECT_OPERATION_SPIKE.md`
- `docs/MASTER_DEVELOPMENT_PLAN.md`, sections 5, 9, 10, and 12
