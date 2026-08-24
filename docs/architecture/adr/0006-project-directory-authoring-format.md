# ADR-0006: Project Directory as the Provisional Authoring Format

- Status: Accepted provisionally for MVP authoring
- Date: 2026-07-24
- Decision owner: Rino project persistence boundary
- Evidence: Product requirements and persistence plan

## Context

Rino projects contain graphs, captured images, optional OCR resources, metadata, and future package capability declarations. A single large JSON document would duplicate binary data or require fragile external paths. An always-packed archive would make incremental edits, recovery, source review, and asset replacement harder. A local database would hide user-authored project state and complicate portable publication.

Users also need stable references when a screenshot is renamed, normalized collision protection for display names, explicit local recovery, and a future deterministic publication package. Authoring and distribution therefore have different requirements.

## Decision

The MVP authoring unit is a user-selected project directory.

The directory contains a versioned `project.rino.json` manifest, separate versioned graph documents under `graphs/`, and project assets under `assets/`. The illustrative directory names in the master plan communicate ownership, not the final schema. Exact object paths, file names, hashes, and manifest fields become normative only when Phase 3 canonical schemas and project I/O tests are accepted.

The following rules are accepted now:

- The manifest identifies the project, schema version, entry graph, graph records, asset records, and required capabilities defined by its canonical schema.
- Graph references use stable graph IDs rather than display names or incidental file order.
- Asset references use stable asset IDs rather than display names or relative object paths.
- Captured image bytes use content-addressed storage in the final schema; equal bytes may share an object while distinct asset records retain independent identity.
- Display-name uniqueness is enforced after Unicode NFKC normalization, trimming, and invariant case folding.
- Renaming an asset does not alter graph references or overwrite another asset.
- Local autosaves, panel layout, recent files, device history, logs, previews, caches, and diagnostics remain outside the publishable project directory.
- A physical device identifier is runtime binding state and is not persisted as a project requirement.
- Rust owns scoped file access after the user chooses a root. Every path is normalized and contained within that root.
- User-authored files are never overwritten from stale frontend validation. Name uniqueness and path safety are rechecked in the committing operation.
- Persistent documents use deterministic formatting and explicit sequential migrations.

Screenshot capture first writes to a bounded application-owned temporary location. Only explicit user confirmation creates or reuses the content-addressed object and commits a validated asset record. A collision blocks the operation and preserves the proposed name; it never overwrites or silently renames existing content.

## Provisional boundaries

This ADR does not finalize:

- the public project or package extension under D-007;
- the exact content-addressed graph and asset object layout;
- multi-file transaction journal and commit-point mechanics;
- concurrent-process writer exclusion and stale external-change policy;
- orphan-object collection and retention;
- maximum project, graph, asset, or recovery sizes;
- public package signing, permissions, or update behavior.

Phase 3 must resolve these items before project I/O is considered production-ready. The multi-file save design must preserve the last complete valid project across process failure and cannot rely on a sequence of independent in-place writes. A dedicated persistence ADR may amend this provisional record when executable recovery and fault-injection evidence exists.

A future `.rino-package` may be a deterministic archive for distribution, with a manifest, hashes, capabilities, signatures, and safe rollback metadata. It is not the live authoring format and is not implemented during MVP persistence work.

## Save and migration constraints

- Reject traversal, unsafe absolute paths, reserved device names, and symlink or reparse-point escapes.
- Write new content through sibling temporary files or immutable objects, flush it, read it back, and validate before committing a reference.
- Preserve the previous complete valid state when a commit fails.
- Update semantic timestamps only for semantic changes.
- Do not rewrite files only because of formatting or key order.
- Keep recovery records in application data, bounded by count and total bytes.
- Offer recovery after an abnormal exit; never overwrite a project automatically.
- Migrate one known schema version at a time and create a rollback copy before changing user data.
- Open an unsupported newer major version read-only at most and never save over it.

## Consequences

Positive consequences:

- Graphs and assets remain inspectable and independently replaceable.
- Large binary data does not enter graph JSON or broad reactive state.
- Stable IDs make display-name changes safe.
- Deterministic files support review, backup, and future source control.
- Authoring can remain simple while a future signed package format evolves separately.

Costs and constraints:

- Saving a project is a multi-file consistency problem.
- External modifications and multiple application instances require explicit conflict handling.
- Content-addressed objects require orphan cleanup and integrity verification.
- Moving or partially copying directories can produce recoverable missing-object diagnostics.
- The final object layout cannot be inferred from the illustrative tree alone.

## Rejected alternatives

### One JSON file containing all graphs and binary assets

Rejected because binary growth, memory use, diffs, and asset updates become unnecessarily expensive.

### Packed archive as the editable working format

Rejected because routine changes require archive replacement and make incremental recovery and inspection harder.

### Embedded database as the only authoring format

Rejected because it hides project structure, complicates portable review, and creates a larger migration and corruption boundary.

### Arbitrary external asset paths

Rejected because projects would not be portable and path traversal, missing files, and privacy leakage would become normal behavior.

## Validation

Phase 3 acceptance must include canonical manifest, graph, and asset schemas; deterministic save/load/reopen; normalized name-collision tests; path-containment tests; failure injection at every save step; recovery after interrupted writes; migration golden fixtures; external-change detection; multiple-writer behavior; and content-addressed duplicate-byte handling.

The numeric-recognition project must save, close, reopen, and rerun without changed graph semantics or broken asset references.

## References

- `docs/architecture/adr/0002-canonical-json-schema-contracts.md`
- `docs/MASTER_DEVELOPMENT_PLAN.md`, sections 8, 9, and 14
- Decision gates D-003 and D-007
