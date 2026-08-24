# Python Graph Parsing and Validation

## 1. Scope

P4-T01 establishes the authoritative Python boundary for canonical graph documents. It
does not execute nodes and does not define the production node registry; those remain
P4-T02 and later work.

The implementation is under `services/runtime/src/rino_runtime/graph/`:

- `parser.py` parses exact JSON bytes or text into the generated
  `RinoProjectDocumentV1` model with strict validation.
- `migrations.py` resolves explicit consecutive node-configuration migrations without
  mutating the loaded document.
- `validation.py` resolves node definitions from a validated registry snapshot and
  performs authoritative semantic validation.
- `__init__.py` exposes the supported graph-runtime API.

## 2. Structural parsing boundary

`parse_project_document_json` accepts only JSON that satisfies the canonical graph
contract. It uses the generated Pydantic model rather than a handwritten second schema.
Unknown properties, unsupported schema versions, invalid identifiers, invalid timestamps,
and contract limits are rejected before semantic validation.

`GraphDocumentParseError.technical_detail` contains at most four bounded JSON locations
and validator error kinds. It never echoes graph values, project names, aliases, comments,
or other user-authored content.

## 3. Node definition and migration resolution

The validator indexes definitions and ports from a validated
`RinoNodeRegistrySnapshotV1`. Duplicate type keys or duplicate port IDs are rejected
instead of being resolved by registration order.

Every migration is a `NodeMigrationStep` owned by one node type. A step must advance
exactly one version, and a complete chain must exist from the stored version to the active
definition version. Each transformed node is revalidated against `NodeV1`, and migrations
must preserve the node ID and type key while producing the declared next version. The
original document is never mutated.

A document created by a newer node definition, or an older document without a complete
migration chain, receives `NODE_TYPE_VERSION_UNSUPPORTED`. Version one is currently the
only production node version, so the default migration catalog is intentionally empty.

## 4. Semantic validation

The Python validator follows the editor preview's traversal order and stable diagnostic
contract. It checks:

- Duplicate graph, node, edge, asset ID, and normalized asset-name conflicts.
- Entry graph and entry node requirements.
- Unknown, unsupported, deprecated, and unavailable-capability node definitions.
- Literal input ownership and required data inputs.
- Edge endpoints, ports, direction, kind, type compatibility, and cardinality.
- Pure-node data dependency cycles.

Capability checks are omitted until the caller provides an availability snapshot. Once
provided, unavailable required capabilities produce warnings and do not alone block
execution. Structural and semantic errors block execution. Reports are bounded to 2,000
diagnostics and serialize as the canonical `RinoGraphDiagnosticReportV1` contract.

Diagnostic parameters contain only stable identifiers, type keys, port IDs, capability
keys, type descriptions, versions, and counts. Project names, aliases, comments, literal
values, and asset display names are never interpolated.

## 5. Type compatibility

Execution tokens connect only to execution tokens. Data values require exact primitive
types except for two lossless widenings already used by the editor:

- A required value may flow into an optional input of the same type.
- Collections are covariant in their element type.

An optional source cannot satisfy a required input, and there is no implicit numeric,
text, or generic-value conversion.

## 6. Verification evidence

The P4-T01 implementation is covered by parser, semantic validation, capability,
diagnostic privacy, edge cardinality, pure-cycle, migration, and canonical report tests.
The Python cases mirror the established editor validation cases and use the same generated
graph, registry, and diagnostic contracts.

Validated commands:

```text
uv run --project services/runtime ruff check services/runtime/src services/runtime/tests
uv run --project services/runtime ruff format --check services/runtime/src services/runtime/tests
uv run --project services/runtime pyright services/runtime/src services/runtime/tests
uv run --project services/runtime pytest services/runtime/tests -q
pnpm --filter @rino/desktop exec vitest run src/graph/validate-graph.test.ts
```

P4-T02 must reuse this parser, migration catalog, and validator. It must provide the
reviewed production/test registry split and executor API without introducing a second
definition-resolution path.
