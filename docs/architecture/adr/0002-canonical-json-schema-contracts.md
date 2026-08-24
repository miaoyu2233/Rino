# ADR-0002: Canonical JSON Schema Contracts

- Status: Accepted for versioned Rino contracts
- Date: 2026-07-24
- Decision owner: Rino contract boundary
- Evidence: `P0-T04`

## Context

Rino exchanges persistent and runtime data among strict TypeScript, Python, and Rust components. Hand-maintained language models would inevitably drift, while a TypeScript-first or Python-first format would make one implementation language authoritative over the protocol.

The contract must provide runtime validation at trust boundaries, static types in each language, deterministic generation, explicit compatibility behavior, and actionable rejection of malformed data.

## Decision

JSON Schema Draft 2020-12 is the canonical source for Rino contracts. Language-specific models are generated artifacts and are never edited directly.

The TypeScript path uses a generated declaration model plus strict Ajv 2020 validation of the canonical Schema. The Python path uses a generated Pydantic v2 model plus `jsonschema` Draft 2020-12 validation with format checking. The Schema validator remains authoritative for contract acceptance; generated models provide typed access after the canonical boundary succeeds.

Generated files are tracked so consumers can compile without running generators, but every generated file carries a neutral do-not-edit header. A deterministic check regenerates into two independent temporary directories, compares both results byte-for-byte, and compares them with the tracked artifacts.

Generator versions, validator versions, compilers, and transitive dependencies are locked. Upgrading any generator requires deliberate regeneration, review of the complete generated diff, strict static checks, shared-fixture validation, and a new deterministic comparison.

For the initial envelope contract:

- The dialect is Draft 2020-12.
- `protocolVersion` is an integer constant for the supported major version.
- `messageKind` is a request, response, or event discriminator.
- A response contains exactly one of `result` or `error`.
- Request and event identifiers use UUID format validation.
- Event sequence values are non-negative safe JavaScript integers.
- Unknown envelope and structured-error properties are rejected.
- Payload and result objects contain bounded recursive JSON values.
- Non-standard non-finite JSON numbers are rejected before Schema validation.

Unknown envelope properties are not treated as implicitly compatible in version one. Local desktop and Sidecar components ship as one bundle, so an unsupported envelope shape fails safely and triggers a compatibility diagnostic. Future optional-field compatibility must be explicitly designed in the production schemas rather than inferred from permissive object validation.

## Generated artifact policy

The canonical dependency direction is:

```text
JSON Schema -> TypeScript declaration
            -> Python model
            -> shared valid/invalid fixtures
```

Generated artifacts may import their selected runtime model library, but they must not contain hand-added helpers, patches, aliases, or business behavior. Any required change begins in the Schema or generator configuration.

The current Python generator has a verified recursive-forward-reference defect when PEP 604 union output is enabled. The generation command therefore explicitly disables union-operator output. Ruff's `UP045` modernization rule is ignored only for the generated Python file; runtime import, strict Pyright checking, Pydantic validation, canonical Schema validation, and deterministic comparison remain mandatory.

## Consequences

Positive consequences:

- Contract meaning has one language-neutral source.
- TypeScript and Python consume equivalent discriminated models.
- Runtime validation and static types are both available.
- Schema drift and manual generated-file edits fail deterministic checks.
- Shared fixtures become executable compatibility evidence.

Costs and constraints:

- Two development ecosystems are required for generation.
- JSON Schema features must be tested against both generators before adoption.
- Generated Pydantic models add runtime dependencies to the Python boundary.
- Canonical Schema validation plus model parsing adds bounded duplicate work at IPC boundaries.
- Schema size, JSON nesting depth, raw frame size, and validation work still require limits outside the Schema.

## Rejected alternatives

### Hand-maintained TypeScript and Python models

Rejected because there is no enforceable authority when the definitions disagree.

### TypeScript as the schema source

Rejected because Python and Rust would depend on TypeScript-specific generator semantics and runtime validation would require a second derived format.

### Python models as the schema source

Rejected because Pydantic-specific behavior could become protocol behavior and frontend compatibility would depend on Python implementation details.

### Generated models without canonical runtime validation

Rejected because language generators cannot preserve every JSON Schema constraint with identical semantics.

## Validation

The isolated spike proves:

- One Draft 2020-12 Schema generates strict TypeScript and Python models.
- TypeScript and Python validate the same four valid and eight invalid fixtures.
- Valid fixtures round-trip through both generated model paths.
- Extra fields, response ambiguity, bad IDs, bad sequence values, unsupported versions, unknown kinds, missing fields, and invalid structured-error codes fail.
- Non-finite JSON values fail before Schema validation in both languages.
- Two clean generation runs and the tracked artifacts are byte-identical.
- Generated TypeScript compiles under strict TypeScript settings.
- Generated Python passes strict Pyright and imports successfully at runtime.

## References

- [JSON Schema Draft 2020-12 specification](https://json-schema.org/draft/2020-12/draft-bhutton-json-schema-00)
- [Ajv Draft 2020-12 support](https://ajv.js.org/json-schema.html)
- [Ajv strict mode](https://ajv.js.org/strict-mode.html)
- [json-schema-to-typescript package](https://www.npmjs.com/package/json-schema-to-typescript)
- [datamodel-code-generator documentation](https://datamodel-code-generator.koxudaxi.dev/)
- [Python jsonschema package](https://pypi.org/project/jsonschema/)
