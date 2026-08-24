# Cross-Language Contract Generation Spike

## Status

- Task: `P0-T04`
- Probe date: 2026-07-24
- Host coverage: Windows x86-64, Node.js 24.13.0, pnpm 11.9.0, CPython 3.13.5, uv 0.10.9
- Schema dialect: JSON Schema Draft 2020-12
- Result: One canonical Schema with deterministic strict TypeScript/Python generation is feasible.
- Decision: [ADR-0002](../architecture/adr/0002-canonical-json-schema-contracts.md)

This spike proves the generation and validation workflow. Its minimal envelope is not the complete production IPC contract planned for Phase 2.

## Reproducible environment

The isolated spike is under `tools/spikes/contract-generation`. Exact JavaScript and Python resolution is stored in `pnpm-lock.yaml` and `uv.lock`.

```powershell
pnpm install --frozen-lockfile
uv sync --frozen
uv run --frozen python scripts/generate.py --check
pnpm run typecheck
pnpm run validate:typescript
uv run --frozen python -m src.validate_fixtures
uv run --frozen ruff format --check .
uv run --frozen ruff check .
uv run --frozen pyright --project pyproject.toml
```

## Locked direct toolchain

| Package | Version | Purpose |
| --- | --- | --- |
| `json-schema-to-typescript` | `15.0.4` | Generate the TypeScript declaration |
| `ajv` | `8.20.0` | Strict Draft 2020-12 validation in TypeScript |
| `ajv-formats` | `3.0.1` | UUID format validation for Ajv |
| `typescript` | `7.0.2` | Strict compilation of generated and consuming TypeScript |
| `@types/node` | `26.1.1` | Typed local fixture runner APIs |
| `datamodel-code-generator` | `0.70.0` | Generate the Pydantic v2 model |
| `pydantic` | `2.13.4` | Strict JSON parsing into the generated Python model |
| `jsonschema` | `4.26.0` | Authoritative Draft 2020-12 validation in Python |
| `ruff` | `0.16.0` | Python format and lint verification |
| `pyright` | `1.1.411` | Strict Python type verification |

These are spike choices, not an authorization to upgrade unrelated future application dependencies. License consolidation belongs to `P0-T05`.

## Canonical source and outputs

The only contract source is:

```text
schemas/protocol-envelope-v1.schema.json
```

It generates:

```text
generated/typescript/protocol-envelope-v1.d.ts
generated/python/protocol_envelope_v1.py
```

The generated TypeScript model is a union of request, success response, error response, and event interfaces. The generated Python model is a Pydantic root union with snake-case properties and aliases for camel-case protocol fields. Both preserve the message-kind and protocol-version literals.

No generated artifact is an authority. The Schema defines accepted JSON, both runtime validators execute that Schema, and generated models are checked against the same fixtures.

## Fixture evidence

One manifest drives both language runners. The final set contains four valid and eight invalid messages.

Valid coverage:

- Request with nested payload values.
- Successful response.
- Structured error response.
- Ordered event with run and node correlation.

Invalid coverage:

- Response containing both result and error.
- Unknown envelope property.
- Negative event sequence.
- Invalid UUID.
- Unsupported protocol version.
- Unknown message kind.
- Non-canonical structured-error code.
- Missing event sequence.

Both runtimes also explicitly prove that non-standard `NaN` input fails during JSON parsing.

The TypeScript runner uses strict Ajv 2020 compilation and returns the generated union only after Schema validation. The Python runner uses `Draft202012Validator` with format checking, then parses the same JSON through a strict generated Pydantic adapter. Valid values are serialized and validated again after round-trip.

## Determinism evidence

`scripts/generate.py --check` creates two independent temporary output roots. For each generated file it requires:

1. First output equals second output byte-for-byte.
2. Fresh output equals the tracked generated artifact byte-for-byte.
3. The generated artifact exists and has a stable SHA-256 report.

Reference result:

| Artifact | Lines | Bytes |
| --- | ---: | ---: |
| TypeScript declaration | 53 | 1,296 |
| Python model | 160 | 4,585 |

Any Schema, configuration, generator, or formatting change that alters output must update the generated artifacts through the generator and receive an explicit diff review.

## Complexity and maintenance cost

The spike contains:

- One 168-line canonical Schema.
- Twelve shared message fixtures plus one manifest.
- Two generated files totaling 213 lines.
- Approximately 446 lines of generation and cross-language validation code.
- Five direct Node development dependencies.
- Five direct Python runtime/development dependencies and 31 installed Python packages.

The installed Node dependency graph exposes 44 unique parseable entries in the reference environment. The generators remain development-only; application packaging must not include them.

Maintenance cost is moderate rather than trivial. The main cost is testing generator support for each Schema feature, not authoring duplicate models. The shared-fixture and deterministic gates make that cost visible and bounded.

## Verified generator limitation

`datamodel-code-generator 0.70.0` generates an invalid recursive expression when its default PEP 604 union output combines a quoted forward reference with `None`. The generated module fails during import before any model can be used.

The authoritative generation command explicitly uses `--no-use-union-operator`, which produces valid `Optional` and `Union` forward references. Ruff rule `UP045` is ignored only for the generated Python artifact because applying that modernization would recreate the generator defect. No generated file is patched manually.

This workaround is a required compatibility test for any generator upgrade. It may be removed only after a new pinned version generates, imports, validates, and reproduces the recursive model without it.

## Compatibility policy proven by the spike

- Version one rejects unknown envelope and structured-error fields.
- Payload and result objects may contain bounded recursive JSON values.
- Responses are structurally exclusive: success or error, never both.
- Unsupported versions fail before dispatch.
- UUID formats are validated in both languages.
- Event order is represented by a bounded integer sequence, not timestamps.
- Parser/frame depth, aggregate message size, and validation-work limits remain outside this minimal Schema and must be added in the production limits registry.

## Remaining gates

- Expand the minimal envelope into canonical common IDs, handshake, health, structured errors, requests, responses, and events during Phase 2.
- Define explicit minor-version and unknown-field evolution rules before independent desktop/Sidecar upgrades are supported.
- Generate or derive the Rust contract boundary in the production contract task.
- Add request/event fixtures for every production message family.
- Add depth, aggregate collection, frame-size, and validation-work limits.
- Decide whether production Python performs canonical validation plus model parsing on every message or uses an equivalent precompiled adapter after performance measurement.

No application source, graph schema, remote service, Git repository, commit, push, or publication was created by this spike.
