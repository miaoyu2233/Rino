# Node Registry and Executor API

## Purpose

The Python runtime owns the authoritative registry of node definitions and their executor implementations. The registry is immutable after construction, publishes a deterministic snapshot for the desktop client, and rejects executor results that do not match the registered definition.

This boundary is intentionally independent of MaaFramework. Device capture, recognition, and actions can be added later through reviewed adapters without changing graph execution semantics or allowing a backend to invent user-visible node types.

## Product composition rule

OCR, clicking, delays, logging, comparisons, and other operations are independent nodes. A node performs the behavior named by its type and does not conceal unrelated follow-up actions.

The node library groups independent nodes by category. Workflow templates are the convenience layer: selecting a template inserts several ordinary nodes and edges in one operation. The inserted nodes remain visible, editable, reconnectable, and removable. Templates do not introduce a second runtime format or a hidden compound executor.

The Phase 4 template `template.compareNumbersAndBranch` demonstrates this rule by inserting separate Start, Compare Numbers, and Branch nodes. Later OCR-and-action templates must follow the same expansion model.

## Registry construction

`NodeRegistryBuilder` accepts an explicit type-key allowlist. Registration fails when:

- the definition type key is not in that allowlist;
- a type key is registered more than once;
- the executor and definition type keys differ;
- a definition has invalid port, property, runtime-kind, or side-effect metadata;
- a workflow template refers to a node type or port that is not registered.

`build_phase_4_production_registry()` exposes only reviewed backend-independent production nodes. `build_phase_4_test_registry()` adds explicit fault-injection nodes. `build_phase_4_fake_backend_registry()` instead registers reviewed automation nodes under stable production type keys and injects a deterministic backend. Production code cannot discover or select either test composition accidentally.

The serialized `RinoNodeRegistrySnapshotV1` is sorted before hashing. Equal registry content therefore produces the same registry version independent of insertion order. `snapshot()` returns a deep copy so callers cannot mutate registry state.

## Executor contract

Every executor implements an asynchronous `execute(context)` operation and declares the exact `type_key` it handles.

`NodeExecutionContext` contains:

- the stable node ID and type key;
- immutable input values;
- immutable property values;
- a cancellation probe checked before work and after awaited side effects where relevant.

Boundary accessors reject missing, wrong-type, boolean-as-number, infinite, and non-finite values with stable `NodeExecutionFailureCode` values. Error details contain only a bounded parameter name and localization key; raw input values are not copied into the error.

`NodeExecutionResult` may contain immutable data outputs, selected execution output IDs, bounded log records, or a terminal marker. Before a result reaches the scheduler, the registry verifies that:

- every data output is declared and has the declared runtime type;
- every selected execution output is declared and is an execution output;
- execution outputs are unique;
- a terminal result does not also select an execution output;
- log records remain within registry limits.

This validation creates an atomic boundary for the scheduler: invalid executor output is rejected before any value generation or execution-token state can be committed.

## Phase 4 production nodes

| Type key | Category | Runtime kind | Inputs and properties | Outputs | Behavior |
| --- | --- | --- | --- | --- | --- |
| `core.flow.start` | Flow | Entry | None | Exec `next` | Selects the graph entry path. |
| `core.flow.stop` | Flow | Execution | Exec `run` | Terminal result | Ends the current execution path intentionally. |
| `core.flow.sequence` | Flow | Execution | Exec `run` | Fan-out Exec `steps` | Requests ordered execution of connected steps. The scheduler defines the ordering. |
| `core.logic.branch` | Logic | Execution | Exec `run`; Bool `condition` | Exec `whenTrue`; Exec `whenFalse` | Selects exactly one branch. |
| `core.logic.numberCompare` | Logic | Pure | Number `left`; Number `right`; comparison property | Bool `result`; String `relation` | Evaluates the chosen comparison and also reports `lessThan`, `equalTo`, or `greaterThan`. |
| `core.value.numberLiteral` | Values | Pure | Number property `value` | Number `value` | Outputs a finite binary64-compatible number. |
| `core.value.stringLiteral` | Values | Pure | String property `value` | String `value` | Outputs bounded fixed text. |
| `core.geometry.point` | Values | Pure | Image `image`; integer literals `x`, `y`, `referenceWidth`, `referenceHeight` | Point `point` | Requires the current image dimensions to match the saved reference resolution, then binds the fixed coordinate to the image coordinate space and generation. |
| `core.geometry.rectangle` | Values | Pure | Image `image`; integer literals `x`, `y`, `width`, `height`, `referenceWidth`, `referenceHeight` | Rect `rectangle` | Requires an exact reference-resolution match and emits only positive, in-bounds geometry bound to the current image. |
| `core.time.delay` | Timing | Execution | Exec `run`; Number `durationMilliseconds` | Exec `next` | Waits asynchronously from 0 through 86,400,000 milliseconds. |
| `core.diagnostic.log` | Diagnostics | Execution | Exec `run`; String `message` | Exec `next`; log record | Emits one informational message of at most 4,096 characters. |
| `text.parseNumber` | Text | Execution | Exec `run`; String `text`; explicit separator, sign, full-width, and bound properties | Number `number`; String `normalizedText`; Exec `parsed`; Exec `invalid` | Parses a finite number without guessing locale, currency, or percentage semantics. |

The deterministic backend composition additionally registers the production contracts used by the Phase 4 reference flow:

- `automation.captureScreen`;
- `vision.ocr`;
- `automation.clickPoint`;
- `automation.clickRectCenter`.

These definitions call the Rino-owned `AutomationBackend` protocol. The fake implementation supplies synthetic image handles, OCR candidates, and recorded clicks. The production Maa implementation supplies the same operations without changing graph topology or port IDs.

The full fake and Maa registries also publish `template.captureAndClickPoint`. It inserts ordinary editable Start, Capture, Point, and Click nodes with explicit execution and data edges. The Point literals remain incomplete until the user selects or enters coordinates; the template never hides compound execution.

The registry stores categories and localization keys, not rendered labels. The desktop client supplies Simplified Chinese and English text and maps stable icon keys to the existing icon system.

## Test-only nodes

| Type key | Purpose |
| --- | --- |
| `test.fake.ocr` | Returns deterministic matched/text outputs from an explicit fixture string. |
| `test.fake.action` | Records an explicit test action through an injected recorder. |

These types are absent from `PHASE_4_PRODUCTION_NODE_TYPE_KEYS` and cannot appear in a production registry snapshot.

## Backend capability policy

Backend advertisements are treated as untrusted availability input. They can mark a pre-registered node as available only when the capability is also present in `MVP_BACKEND_CAPABILITY_ALLOWLIST`. Advertisements never register a definition or executor.

The MVP backend allowlist is limited to:

- `automation.captureScreen`;
- `vision.ocr`;
- `automation.clickPoint`;
- `automation.clickRectCenter`.

`text.parseNumber` is a Rino runtime node and does not depend on a backend capability. Neural-network model execution, classification, arbitrary model loading, plugin-provided recognition, shell operations, and raw backend actions are not allowlisted. A future capability requires an explicit reviewed definition, executor, security assessment, tests, and allowlist change before it can become user-visible.

The production Maa composition implements these fixed automation type keys with reviewed direct APIs. The normal runtime composition does not expose placeholder implementations or fall back to fake results. A saved authoring coordinate is never dispatched directly: a geometry node first binds it to the exact captured image and rejects a reference-resolution mismatch or out-of-bounds value.

## Verification

Focused validation is performed with:

```powershell
uv run --project services/runtime pytest services/runtime/tests/test_node_registry.py services/runtime/tests/test_node_executors.py
uv run --project services/runtime ruff check services/runtime/src/rino_runtime/nodes services/runtime/tests/test_node_registry.py services/runtime/tests/test_node_executors.py
uv run --project services/runtime pyright services/runtime/src services/runtime/tests
```

The tests cover production/test separation, deterministic snapshots, duplicate and unallowlisted registration, executor/definition mismatch, backend advertisement filtering, independent-node template expansion, immutable snapshots, invalid executor output rejection, every Phase 4 executor, explicit numeric parsing, and a production-node numeric-recognition flow through the deterministic backend.
