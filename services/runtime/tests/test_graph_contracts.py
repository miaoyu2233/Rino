"""Cross-language contract parity for the project document and registry schemas.

The runtime validates the same shared fixtures as the editor, so a document one side
accepts is never rejected by the other.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Final, cast

import pytest
from pydantic import TypeAdapter, ValidationError

from rino_runtime.contracts import (
    describe_project_document_errors,
    describe_registry_snapshot_errors,
    is_valid_project_document,
    is_valid_registry_snapshot,
)
from rino_runtime.contracts.generated.rino_graph_v1 import RinoProjectDocumentV1
from rino_runtime.contracts.generated.rino_graph_v1_schema import RINO_GRAPH_V1_SCHEMA
from rino_runtime.contracts.generated.rino_ipc_v1_schema import RINO_IPC_V1_SCHEMA
from rino_runtime.contracts.generated.rino_registry_v1 import (
    RinoNodeRegistrySnapshotV1,
)
from rino_runtime.contracts.generated.rino_registry_v1_schema import (
    RINO_REGISTRY_V1_SCHEMA,
)
from rino_runtime.contracts.validation import MAXIMUM_DIAGNOSTIC_LENGTH

REPOSITORY_ROOT: Final[Path] = Path(__file__).resolve().parents[3]
FIXTURES_ROOT: Final[Path] = REPOSITORY_ROOT / "contracts" / "fixtures"
DOCUMENT_ADAPTER: Final[TypeAdapter[RinoProjectDocumentV1]] = TypeAdapter(
    RinoProjectDocumentV1
)
REGISTRY_ADAPTER: Final[TypeAdapter[RinoNodeRegistrySnapshotV1]] = TypeAdapter(
    RinoNodeRegistrySnapshotV1
)
VARIABLE_KINDS: Final[tuple[str, ...]] = (
    "bool",
    "number",
    "string",
    "point",
    "rect",
    "imageRef",
)


def read_fixture(directory: str, name: str) -> dict[str, Any]:
    value = json.loads((FIXTURES_ROOT / directory / name).read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return cast("dict[str, Any]", value)


def fixture_names(directory: str) -> list[str]:
    return sorted(path.name for path in (FIXTURES_ROOT / directory).glob("*.json"))


def read_canonical(relative_path: str) -> object:
    return json.loads((REPOSITORY_ROOT / relative_path).read_text(encoding="utf-8"))


def variable_definition(index: int, value_kind: str) -> dict[str, Any]:
    return {
        "variableId": f"00000000-0000-4000-8000-{index:012x}",
        "name": f"variable-{index}",
        "valueKind": value_kind,
        "persistent": index % 2 == 0,
    }


def graph_document(variables: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    graph: dict[str, Any] = {
        "graphId": "1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea",
        "name": "主图",
        "kind": "entry",
        "nodes": [],
        "edges": [],
    }
    if variables is not None:
        graph["variables"] = variables
    return {
        "schemaVersion": 1,
        "documentId": "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
        "metadata": {
            "name": "新建项目",
            "createdAt": "2026-07-26T09:00:00Z",
            "updatedAt": "2026-07-26T09:00:00Z",
        },
        "entryGraphId": graph["graphId"],
        "graphs": [graph],
        "assets": [],
        "requiredCapabilities": [],
    }


def function_graph_document(
    signature: dict[str, Any] | None = None,
    *,
    include_signature: bool = True,
    kind: str = "function",
) -> dict[str, Any]:
    document = graph_document()
    graph = document["graphs"][0]
    assert isinstance(graph, dict)
    graph["kind"] = kind
    if include_signature:
        graph["functionSignature"] = (
            {"inputs": [], "outputs": []} if signature is None else signature
        )
    return document


def function_parameter(index: int, prefix: str) -> dict[str, Any]:
    return {
        "parameterId": f"00000000-0000-4000-8000-{index:012x}",
        "portId": f"{prefix}{index}",
        "name": f"{prefix} {index}",
        "valueKind": "number" if index % 2 == 0 else "string",
    }


def test_generated_schema_modules_match_their_canonical_sources() -> None:
    assert read_canonical("contracts/graph/rino-graph-v1.schema.json") == (
        RINO_GRAPH_V1_SCHEMA
    )
    assert read_canonical("contracts/registry/rino-registry-v1.schema.json") == (
        RINO_REGISTRY_V1_SCHEMA
    )


def test_shared_json_value_definition_is_identical_across_contracts() -> None:
    """The definition is duplicated per contract so every schema stays self-contained
    for the generators; this is what keeps the copies from drifting apart."""
    schemas = (RINO_IPC_V1_SCHEMA, RINO_GRAPH_V1_SCHEMA, RINO_REGISTRY_V1_SCHEMA)

    for schema in schemas[1:]:
        assert schema["$defs"]["JsonValue"] == schemas[0]["$defs"]["JsonValue"]
        assert schema["$defs"]["JsonObject"] == schemas[0]["$defs"]["JsonObject"]


@pytest.mark.parametrize("name", fixture_names("graph/valid"))
def test_valid_project_document_is_accepted_and_round_trips(name: str) -> None:
    fixture = read_fixture("graph/valid", name)

    assert is_valid_project_document(fixture)

    model = DOCUMENT_ADAPTER.validate_json(
        json.dumps(fixture, separators=(",", ":")), strict=True
    )
    round_trip = json.loads(
        DOCUMENT_ADAPTER.dump_json(model, by_alias=True, exclude_none=True)
    )
    assert is_valid_project_document(round_trip)
    assert round_trip == fixture


@pytest.mark.parametrize("name", fixture_names("graph/invalid"))
def test_invalid_project_document_is_rejected(name: str) -> None:
    fixture = read_fixture("graph/invalid", name)

    assert not is_valid_project_document(fixture)

    diagnostic = describe_project_document_errors(fixture)
    assert diagnostic
    assert len(diagnostic) <= MAXIMUM_DIAGNOSTIC_LENGTH

    with pytest.raises(ValidationError):
        DOCUMENT_ADAPTER.validate_json(
            json.dumps(fixture, separators=(",", ":")), strict=True
        )


@pytest.mark.parametrize("name", fixture_names("registry/valid"))
def test_valid_registry_snapshot_is_accepted_and_round_trips(name: str) -> None:
    fixture = read_fixture("registry/valid", name)

    assert is_valid_registry_snapshot(fixture)

    model = REGISTRY_ADAPTER.validate_json(
        json.dumps(fixture, separators=(",", ":")), strict=True
    )
    round_trip = json.loads(
        REGISTRY_ADAPTER.dump_json(model, by_alias=True, exclude_none=True)
    )
    assert is_valid_registry_snapshot(round_trip)
    assert round_trip == fixture


@pytest.mark.parametrize("name", fixture_names("registry/invalid"))
def test_invalid_registry_snapshot_is_rejected(name: str) -> None:
    fixture = read_fixture("registry/invalid", name)

    assert not is_valid_registry_snapshot(fixture)

    diagnostic = describe_registry_snapshot_errors(fixture)
    assert diagnostic
    assert len(diagnostic) <= MAXIMUM_DIAGNOSTIC_LENGTH


def test_document_diagnostics_never_echo_project_content() -> None:
    fixture = read_fixture("graph/valid", "empty-project.json")
    fixture["metadata"]["name"] = "s3cret-project-name"
    fixture["unexpected"] = "s3cret-value"

    diagnostic = describe_project_document_errors(fixture)

    assert "s3cret-project-name" not in diagnostic
    assert "s3cret-value" not in diagnostic


def test_graph_without_variables_remains_valid() -> None:
    document = graph_document()

    assert is_valid_project_document(document)

    model = DOCUMENT_ADAPTER.validate_json(
        json.dumps(document, separators=(",", ":")), strict=True
    )
    round_trip = json.loads(
        DOCUMENT_ADAPTER.dump_json(model, by_alias=True, exclude_none=True)
    )
    assert round_trip == document


def test_repeat_hint_metadata_round_trips_without_runtime_shape_changes() -> None:
    document = graph_document()
    graph = document["graphs"][0]
    assert isinstance(graph, dict)
    graph["edges"] = [
        {
            "edgeId": "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb",
            "edgeKind": "execution",
            "sourceNodeId": "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f",
            "sourcePortId": "next",
            "targetNodeId": "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80",
            "targetPortId": "run",
        }
    ]
    graph["editorMetadata"] = {
        "repeatHints": [
            {
                "hintId": "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091",
                "edgeId": "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb",
                "position": {"x": 32, "y": -48},
            }
        ]
    }

    assert is_valid_project_document(document)
    model = DOCUMENT_ADAPTER.validate_json(
        json.dumps(document, separators=(",", ":")), strict=True
    )
    round_trip = json.loads(
        DOCUMENT_ADAPTER.dump_json(model, by_alias=True, exclude_none=True)
    )
    assert round_trip == document


def test_repeat_hint_shape_and_bounds_are_rejected() -> None:
    document = graph_document()
    graph = document["graphs"][0]
    assert isinstance(graph, dict)
    hint = {
        "hintId": "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091",
        "edgeId": "2c3d4e5f-6071-4283-9495-a6b7c8d9eafb",
        "position": {"x": 0, "y": 0},
    }

    graph["editorMetadata"] = {"repeatHints": [{**hint, "unexpected": True}]}
    assert not is_valid_project_document(document)

    graph["editorMetadata"] = {"repeatHints": [{**hint, "hintId": "not-a-uuid"}]}
    assert not is_valid_project_document(document)

    graph["editorMetadata"] = {
        "repeatHints": [{**hint, "position": {"x": 1000001, "y": 0}}]
    }
    assert not is_valid_project_document(document)

    graph["editorMetadata"] = {
        "repeatHints": [
            {
                **hint,
                "hintId": f"5f4b8a7e-92a3-4ebf-8ad2-{index + 1:012x}",
            }
            for index in range(501)
        ]
    }
    assert not is_valid_project_document(document)


def test_all_variable_kinds_round_trip() -> None:
    variables = [
        variable_definition(index + 1, value_kind)
        for index, value_kind in enumerate(VARIABLE_KINDS)
    ]
    document = graph_document(variables)

    assert is_valid_project_document(document)
    model = DOCUMENT_ADAPTER.validate_json(
        json.dumps(document, separators=(",", ":")), strict=True
    )
    round_trip = json.loads(
        DOCUMENT_ADAPTER.dump_json(model, by_alias=True, exclude_none=True)
    )
    assert round_trip == document


def test_function_signature_schema_rules_and_author_order() -> None:
    assert RINO_GRAPH_V1_SCHEMA["$defs"]["GraphKindV1"]["enum"] == [
        "entry",
        "function",
    ]
    assert RINO_GRAPH_V1_SCHEMA["$defs"]["FunctionParameterV1"]["required"] == [
        "parameterId",
        "portId",
        "name",
        "valueKind",
    ]
    assert RINO_GRAPH_V1_SCHEMA["$defs"]["FunctionSignatureV1"]["required"] == [
        "inputs",
        "outputs",
    ]

    empty = function_graph_document()
    assert is_valid_project_document(empty)
    model = DOCUMENT_ADAPTER.validate_json(
        json.dumps(empty, separators=(",", ":")), strict=True
    )
    assert (
        json.loads(DOCUMENT_ADAPTER.dump_json(model, by_alias=True, exclude_none=True))
        == empty
    )

    signature = {
        "inputs": [function_parameter(index + 1, "input") for index in range(16)],
        "outputs": [function_parameter(index + 17, "output") for index in range(16)],
    }
    full = function_graph_document(signature)
    assert is_valid_project_document(full)
    assert [
        parameter["parameterId"]
        for parameter in full["graphs"][0]["functionSignature"]["inputs"]
    ] == [parameter["parameterId"] for parameter in signature["inputs"]]

    missing = function_graph_document(include_signature=False)
    assert not is_valid_project_document(missing)
    assert not is_valid_project_document(function_graph_document(kind="entry"))

    too_many = function_graph_document(
        {
            "inputs": [function_parameter(index + 1, "input") for index in range(17)],
            "outputs": [],
        }
    )
    assert not is_valid_project_document(too_many)
    with pytest.raises(ValidationError):
        DOCUMENT_ADAPTER.validate_json(
            json.dumps(too_many, separators=(",", ":")), strict=True
        )


def test_variable_shape_and_bounds_are_rejected() -> None:
    too_many = graph_document(
        [variable_definition(index + 1, "number") for index in range(129)]
    )
    assert not is_valid_project_document(too_many)
    with pytest.raises(ValidationError):
        DOCUMENT_ADAPTER.validate_json(
            json.dumps(too_many, separators=(",", ":")), strict=True
        )

    unknown_field = graph_document(
        [{**variable_definition(1, "string"), "unexpected": True}]
    )
    assert not is_valid_project_document(unknown_field)
    with pytest.raises(ValidationError):
        DOCUMENT_ADAPTER.validate_json(
            json.dumps(unknown_field, separators=(",", ":")), strict=True
        )

    blank_name = graph_document([{**variable_definition(1, "bool"), "name": " \t\n"}])
    assert not is_valid_project_document(blank_name)
    with pytest.raises(ValidationError):
        DOCUMENT_ADAPTER.validate_json(
            json.dumps(blank_name, separators=(",", ":")), strict=True
        )
