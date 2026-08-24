"""Authoritative graph parsing and semantic-validation parity tests."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any, Final, cast

import pytest
from pydantic import TypeAdapter

from rino_runtime.contracts.generated.rino_diagnostics_v1 import (
    DiagnosticSeverityV1,
    GraphDiagnosticCodeV1,
    RinoGraphDiagnosticReportV1,
)
from rino_runtime.contracts.generated.rino_graph_v1 import (
    NodeV1,
    RinoProjectDocumentV1,
    VariableDefinitionV1,
)
from rino_runtime.contracts.generated.rino_registry_v1 import (
    RinoNodeRegistrySnapshotV1,
)
from rino_runtime.graph import (
    GraphDocumentParseError,
    NodeMigrationCatalog,
    NodeMigrationStep,
    parse_project_document_json,
    validate_project_document,
)
from rino_runtime.nodes import (
    build_mvp_production_registry,
    build_phase_4_production_registry,
)

REPOSITORY_ROOT: Final[Path] = Path(__file__).resolve().parents[3]
REGISTRY_ADAPTER: Final[TypeAdapter[RinoNodeRegistrySnapshotV1]] = TypeAdapter(
    RinoNodeRegistrySnapshotV1
)
DIAGNOSTIC_REPORT_ADAPTER: Final[TypeAdapter[RinoGraphDiagnosticReportV1]] = (
    TypeAdapter(RinoGraphDiagnosticReportV1)
)

NODE_START: Final[str] = "3d2f6e5c-7081-4c9d-8eb0-2a3b4c5d6e7f"
NODE_LITERAL: Final[str] = "4e3a7f6d-8192-4dae-9fc1-3b4c5d6e7f80"
NODE_COMPARE: Final[str] = "5f4b8a7e-92a3-4ebf-8ad2-4c5d6e7f8091"
NODE_BRANCH: Final[str] = "6a5c9b8f-a3b4-4fc0-9be3-5d6e7f809102"
NODE_OCR: Final[str] = "7b6dac90-b4c5-40d1-8cf4-6e7f80910213"
NODE_CAPTURE: Final[str] = "9d8fceb2-d6e7-42f3-8e16-80910213245a"
NODE_CLICK: Final[str] = "ae90dfc3-e7f8-4304-9f27-910213245f60"
NODE_TASK_CHOICE: Final[str] = "bf01e2d4-f8a9-4415-a038-a0213245f607"
NODE_OVERLAY: Final[str] = "c012f3e5-a9b0-4526-b149-b1324567f809"
NODE_OVERLAY_COMPARE: Final[str] = "d12304f6-b0c1-4637-c25a-c2435678f90a"
NODE_PARALLEL_ONE: Final[str] = "e23415a7-c1d2-4748-d36a-d3546789f01b"
NODE_PARALLEL_TWO: Final[str] = "f34526b8-d2e3-4859-e47b-e4657890a12c"
NODE_SEQUENCE: Final[str] = "a45637c9-e3f4-496a-f58c-f5768901b23d"
GRAPH_ID: Final[str] = "2c1e5d4b-6f70-4b8c-9daf-1f2a3b4c5d6e"
FUNCTION_GRAPH_ID: Final[str] = "01234567-89ab-4cde-8fab-0123456789ab"
FUNCTION_PARAMETER_A: Final[str] = "12345678-9abc-4def-8012-123456789abc"
FUNCTION_PARAMETER_B: Final[str] = "23456789-abcd-4ef0-8123-23456789abcd"
FUNCTION_PARAMETER_C: Final[str] = "3456789a-bcde-4f01-8234-3456789abcde"
CLICK_POINT_INPUT_CASES: Final[tuple[tuple[str, tuple[str, ...]], ...]] = (
    ("point", ("point",)),
    ("coordinates", ("image", "x", "y", "referenceWidth", "referenceHeight")),
    ("randomPoints", ("points",)),
    ("sequentialPoints", ("points",)),
    ("rectCenter", ("rect",)),
    ("rectRandom", ("rect",)),
)
CLICK_POINT_MISSING_CASES: Final[tuple[tuple[str, tuple[str, ...], str], ...]] = tuple(
    (mode, ports, port) for mode, ports in CLICK_POINT_INPUT_CASES for port in ports
)


def _registry() -> RinoNodeRegistrySnapshotV1:
    path = (
        REPOSITORY_ROOT
        / "contracts"
        / "fixtures"
        / "registry"
        / "valid"
        / "core-definitions.json"
    )
    return REGISTRY_ADAPTER.validate_json(path.read_bytes(), strict=True)


def _node(
    node_id: str,
    type_key: str,
    *,
    input_values: dict[str, object] | None = None,
    properties: dict[str, object] | None = None,
    dynamic_port_state: dict[str, object] | None = None,
    type_version: int = 1,
) -> dict[str, object]:
    return {
        "nodeId": node_id,
        "typeKey": type_key,
        "typeVersion": type_version,
        "position": {"x": 0, "y": 0},
        "properties": properties or {},
        "inputValues": input_values or {},
        **(
            {"dynamicPortState": dynamic_port_state}
            if dynamic_port_state is not None
            else {}
        ),
    }


def _edge(
    edge_id: str,
    edge_kind: str,
    source_node_id: str,
    source_port_id: str,
    target_node_id: str,
    target_port_id: str,
) -> dict[str, object]:
    return {
        "edgeId": edge_id,
        "edgeKind": edge_kind,
        "sourceNodeId": source_node_id,
        "sourcePortId": source_port_id,
        "targetNodeId": target_node_id,
        "targetPortId": target_port_id,
    }


def _document(
    nodes: list[dict[str, object]],
    edges: list[dict[str, object]],
    variables: list[dict[str, object]] | None = None,
) -> dict[str, Any]:
    graph: dict[str, object] = {
        "graphId": GRAPH_ID,
        "name": "Main",
        "kind": "entry",
        "nodes": nodes,
        "edges": edges,
    }
    if variables is not None:
        graph["variables"] = variables
    return {
        "schemaVersion": 1,
        "documentId": "1b0d4c3a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        "metadata": {
            "name": "Test project",
            "createdAt": "2026-07-26T10:00:00Z",
            "updatedAt": "2026-07-26T10:00:00Z",
        },
        "entryGraphId": GRAPH_ID,
        "graphs": [graph],
        "assets": [],
        "requiredCapabilities": [],
    }


def _entry_graph() -> dict[str, object]:
    graph = _document([], [])["graphs"][0]
    assert isinstance(graph, dict)
    return cast("dict[str, object]", graph)


def _function_parameter(
    parameter_id: str,
    port_id: str,
    name: str,
    value_kind: str = "string",
) -> dict[str, str]:
    return {
        "parameterId": parameter_id,
        "portId": port_id,
        "name": name,
        "valueKind": value_kind,
    }


def _function_graph(
    graph_id: str = FUNCTION_GRAPH_ID,
    signature: dict[str, object] | None = None,
    nodes: list[dict[str, object]] | None = None,
    edges: list[dict[str, object]] | None = None,
    variables: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    graph: dict[str, object] = {
        "graphId": graph_id,
        "name": "Function",
        "kind": "function",
        "functionSignature": signature or {"inputs": [], "outputs": []},
        "nodes": nodes or [],
        "edges": edges or [],
    }
    if variables is not None:
        graph["variables"] = variables
    return graph


def _document_with_graphs(
    graphs: list[dict[str, object]],
    entry_graph_id: str = GRAPH_ID,
) -> dict[str, Any]:
    value = _document([], [])
    value["entryGraphId"] = entry_graph_id
    value["graphs"] = graphs
    return value


def _valid_document_value() -> dict[str, Any]:
    return _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(NODE_LITERAL, "core.value.numberLiteral"),
            _node(
                NODE_COMPARE,
                "core.logic.numberCompare",
                input_values={"left": 0},
            ),
            _node(NODE_BRANCH, "core.logic.branch"),
        ],
        [
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000001",
                "execution",
                NODE_START,
                "next",
                NODE_BRANCH,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000002",
                "data",
                NODE_LITERAL,
                "value",
                NODE_COMPARE,
                "right",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000003",
                "data",
                NODE_COMPARE,
                "result",
                NODE_BRANCH,
                "condition",
            ),
        ],
    )


def _recognition_document_value() -> dict[str, Any]:
    return _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(NODE_CAPTURE, "automation.captureScreen"),
            _node(NODE_OCR, "vision.ocr"),
        ],
        [
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000004",
                "execution",
                NODE_START,
                "next",
                NODE_CAPTURE,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000005",
                "execution",
                NODE_CAPTURE,
                "next",
                NODE_OCR,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000006",
                "data",
                NODE_CAPTURE,
                "image",
                NODE_OCR,
                "image",
            ),
        ],
    )


def _parse(value: dict[str, Any]) -> RinoProjectDocumentV1:
    return parse_project_document_json(json.dumps(value, separators=(",", ":")))


def _codes(
    value: dict[str, Any],
    *,
    available_capabilities: list[str] | None = None,
    registry: RinoNodeRegistrySnapshotV1 | None = None,
) -> list[GraphDiagnosticCodeV1]:
    report = validate_project_document(
        _parse(value),
        registry or _registry(),
        available_capabilities=available_capabilities,
    )
    contract = report.to_contract()
    DIAGNOSTIC_REPORT_ADAPTER.validate_python(contract, strict=True)
    return [diagnostic.code for diagnostic in report.diagnostics]


def _click_point_validation_registry() -> RinoNodeRegistrySnapshotV1:
    registry = build_mvp_production_registry().snapshot()
    definitions = list(registry.definitions)
    click_index = next(
        index
        for index, definition in enumerate(definitions)
        if definition.type_key.root == "automation.clickPoint"
    )
    click_definition = definitions[click_index]
    literal_ports = {"point", "image", "points", "rect"}
    definitions[click_index] = click_definition.model_copy(
        update={
            "ports": [
                port.model_copy(update={"accepts_literal": True})
                if port.port_id.root in literal_ports
                else port
                for port in click_definition.ports
            ]
        }
    )
    return registry.model_copy(update={"definitions": definitions})


def _click_point_input_values(ports: tuple[str, ...]) -> dict[str, object]:
    values: dict[str, object] = {}
    for port in ports:
        values[port] = (
            {"source": "capture"}
            if port == "image"
            else {"x": 120, "y": 340}
            if port in {"point", "points"}
            else {"x": 0, "y": 0, "width": 100, "height": 100}
            if port == "rect"
            else 120
        )
        if port == "points":
            values[port] = [{"x": 120, "y": 340}]
    return values


def _click_point_document(
    mode: str | None,
    input_values: dict[str, object],
) -> dict[str, Any]:
    return _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(
                NODE_CLICK,
                "automation.clickPoint",
                properties={} if mode is None else {"inputMode": mode},
                input_values=input_values,
            ),
        ],
        [],
    )


def _production_registry() -> RinoNodeRegistrySnapshotV1:
    return build_phase_4_production_registry().snapshot()


def test_parser_accepts_a_canonical_document_without_rewriting_it() -> None:
    source = json.dumps(_valid_document_value(), separators=(",", ":"))

    parsed = parse_project_document_json(source)

    assert json.loads(parsed.model_dump_json(by_alias=True, exclude_none=True)) == (
        json.loads(source)
    )


def test_parser_reports_only_bounded_paths_and_error_kinds() -> None:
    secret = "private-project-content"

    with pytest.raises(GraphDocumentParseError) as caught:
        parse_project_document_json(
            json.dumps({"schemaVersion": 1, "metadata": {"name": secret}})
        )

    assert caught.value.technical_detail
    assert secret not in caught.value.technical_detail
    assert len(caught.value.technical_detail) <= 512


def test_valid_document_matches_the_editor_baseline() -> None:
    report = validate_project_document(_parse(_valid_document_value()), _registry())

    assert report.diagnostics == ()
    assert report.executable


def test_function_graph_semantics_match_editor_order_and_normalization() -> None:
    invalid_non_entry = _entry_graph()
    invalid_non_entry["graphId"] = FUNCTION_GRAPH_ID
    kind_codes = _codes(
        _document_with_graphs([_function_graph(graph_id=GRAPH_ID), invalid_non_entry])
    )
    assert kind_codes == [
        GraphDiagnosticCodeV1.graph_entry_kind_invalid,
        GraphDiagnosticCodeV1.graph_non_entry_kind_invalid,
        GraphDiagnosticCodeV1.function_entry_node_missing,
        GraphDiagnosticCodeV1.function_return_node_missing,
    ]

    function_value = _document_with_graphs(
        [
            _entry_graph(),
            _function_graph(
                signature={
                    "inputs": [
                        _function_parameter(FUNCTION_PARAMETER_A, "inputPort", " Foo "),
                        _function_parameter(
                            FUNCTION_PARAMETER_A, "inputPort", "\uff26\uff2f\uff2f"
                        ),
                    ],
                    "outputs": [
                        _function_parameter(FUNCTION_PARAMETER_B, "outputPort", "foo"),
                        _function_parameter(
                            FUNCTION_PARAMETER_C, "resultPort", "Result"
                        ),
                        _function_parameter(
                            FUNCTION_PARAMETER_C,
                            "resultPort",
                            " \uff52\uff45\uff53\uff55\uff4c\uff54 ",
                        ),
                    ],
                },
                nodes=[
                    _node(NODE_START, "core.flow.start"),
                    _node(NODE_PARALLEL_ONE, "core.flow.parallel"),
                    _node(NODE_PARALLEL_TWO, "core.flow.parallel"),
                ],
            ),
        ]
    )
    assert _codes(function_value) == [
        GraphDiagnosticCodeV1.function_duplicate_parameter_id,
        GraphDiagnosticCodeV1.function_duplicate_parameter_id,
        GraphDiagnosticCodeV1.function_duplicate_port_id,
        GraphDiagnosticCodeV1.function_duplicate_port_id,
        GraphDiagnosticCodeV1.function_duplicate_parameter_name,
        GraphDiagnosticCodeV1.function_duplicate_parameter_name,
        GraphDiagnosticCodeV1.function_parallel_forbidden,
        GraphDiagnosticCodeV1.function_parallel_forbidden,
        GraphDiagnosticCodeV1.function_entry_node_missing,
        GraphDiagnosticCodeV1.function_return_node_missing,
    ]

    report = validate_project_document(_parse(function_value), _registry())
    diagnostics = json.loads(report.to_contract().model_dump_json(by_alias=True))[
        "diagnostics"
    ]
    assert diagnostics[0]["parameters"] == {"parameterId": FUNCTION_PARAMETER_A}
    assert diagnostics[4]["parameters"] == {
        "name": "\uff26\uff2f\uff2f",
        "direction": "input",
    }
    assert diagnostics[5]["parameters"] == {
        "name": " \uff52\uff45\uff53\uff55\uff4c\uff54 ",
        "direction": "output",
    }


def test_function_persistent_variables_are_local_and_report_in_graph_order() -> None:
    entry = _entry_graph()
    entry["variables"] = [
        {
            "variableId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000120",
            "name": "Entry image",
            "valueKind": "imageRef",
            "persistent": True,
        }
    ]
    first_function = _function_graph(
        _test_uuid(120),
        nodes=[
            _node(_test_uuid(121), "core.function.input"),
            _node(_test_uuid(122), "core.function.return"),
        ],
        variables=[
            {
                "variableId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000123",
                "name": "Local bool",
                "valueKind": "bool",
                "persistent": True,
            },
            {
                "variableId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000124",
                "name": "Local image",
                "valueKind": "imageRef",
                "persistent": True,
            },
        ],
    )
    second_function = _function_graph(
        _test_uuid(125),
        nodes=[
            _node(_test_uuid(126), "core.function.input"),
            _node(_test_uuid(127), "core.function.return"),
        ],
        variables=[
            {
                "variableId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000128",
                "name": "Local number",
                "valueKind": "number",
                "persistent": True,
            }
        ],
    )
    value = _document_with_graphs([entry, first_function, second_function])
    report = validate_project_document(_parse(value), _registry())
    diagnostics = json.loads(report.to_contract().model_dump_json(by_alias=True))[
        "diagnostics"
    ]

    assert [diagnostic["code"] for diagnostic in diagnostics] == [
        "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED",
        "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN",
        "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED",
        "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN",
        "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN",
    ]
    assert diagnostics[1]["parameters"] == {
        "variableId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000123",
        "name": "Local bool",
    }
    assert diagnostics[2]["parameters"] == {
        "variableId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000124",
        "name": "Local image",
        "valueKind": "imageRef",
    }
    assert all(
        diagnostic["code"] != "FUNCTION_PERSISTENT_VARIABLE_FORBIDDEN"
        for diagnostic in diagnostics[:1]
    )


def test_project_variables_are_globally_unique_and_reject_persistent_images() -> None:
    document = _parse(_document([], []))
    document = document.model_copy(
        update={
            "variables": [
                VariableDefinitionV1.model_validate(
                    {
                        "variableId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000130",
                        "name": "Shared value",
                        "valueKind": "bool",
                        "persistent": False,
                    }
                ),
                VariableDefinitionV1.model_validate(
                    {
                        "variableId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000130",
                        "name": "  shared value  ",
                        "valueKind": "number",
                        "persistent": False,
                    }
                ),
                VariableDefinitionV1.model_validate(
                    {
                        "variableId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000131",
                        "name": "Screenshot",
                        "valueKind": "imageRef",
                        "persistent": True,
                    }
                ),
            ]
        }
    )

    report = validate_project_document(document, _production_registry())
    semantic = [
        diagnostic
        for diagnostic in report.diagnostics
        if diagnostic.code.value
        in {
            "GRAPH_DUPLICATE_VARIABLE_ID",
            "GRAPH_DUPLICATE_VARIABLE_NAME",
            "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED",
        }
    ]

    assert [diagnostic.code.value for diagnostic in semantic] == [
        "GRAPH_DUPLICATE_VARIABLE_ID",
        "GRAPH_DUPLICATE_VARIABLE_NAME",
        "GRAPH_VARIABLE_PERSISTENCE_UNSUPPORTED",
    ]
    assert all(diagnostic.location.root.scope == "document" for diagnostic in semantic)


def test_function_variable_nodes_resolve_project_scoped_definition() -> None:
    variable_id = "aaaaaaaa-bbbb-4ccc-8ddd-000000000132"
    function = _function_graph(
        signature={
            "inputs": [],
            "outputs": [
                {
                    "parameterId": FUNCTION_PARAMETER_A,
                    "portId": "result",
                    "name": "result",
                    "valueKind": "number",
                }
            ],
        },
        nodes=[
            _node(NODE_START, "core.function.input"),
            _node(
                NODE_LITERAL,
                "core.variable.getNumber",
                properties={"variableId": variable_id},
            ),
            _node(NODE_COMPARE, "core.function.return"),
        ],
        edges=[
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000133",
                "execution",
                NODE_START,
                "next",
                NODE_COMPARE,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000134",
                "data",
                NODE_LITERAL,
                "value",
                NODE_COMPARE,
                "result",
            ),
        ],
    )
    value = _valid_document_value()
    value["graphs"] = [value["graphs"][0], function]
    value["variables"] = [
        {
            "variableId": variable_id,
            "name": "Project number",
            "valueKind": "number",
            "persistent": True,
        }
    ]

    report = validate_project_document(_parse(value), _production_registry())

    assert not any(
        diagnostic.code
        in {
            GraphDiagnosticCodeV1.node_variable_unknown,
            GraphDiagnosticCodeV1.node_variable_type_mismatch,
            GraphDiagnosticCodeV1.function_persistent_variable_forbidden,
        }
        for diagnostic in report.diagnostics
    )
    assert report.executable


def test_editor_repeat_hint_is_parsed_and_ignored_by_runtime_validation() -> None:
    document = _valid_document_value()
    graph = document["graphs"][0]
    assert isinstance(graph, dict)
    graph["editorMetadata"] = {
        "repeatHints": [
            {
                "hintId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000099",
                "edgeId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000098",
                "position": {"x": 80, "y": 120},
            }
        ]
    }

    parsed = _parse(document)
    report = validate_project_document(parsed, _registry())

    assert report.diagnostics == ()
    assert report.executable


def test_variable_definitions_report_all_graph_level_semantic_errors() -> None:
    duplicate_id = "aaaaaaaa-bbbb-4ccc-8ddd-000000000010"
    document = _document(
        [],
        [],
        variables=[
            {
                "variableId": duplicate_id,
                "name": "Alpha",
                "valueKind": "bool",
                "persistent": False,
            },
            {
                "variableId": duplicate_id,
                "name": "  \uff21lpha  ",
                "valueKind": "number",
                "persistent": False,
            },
            {
                "variableId": "aaaaaaaa-bbbb-4ccc-8ddd-000000000011",
                "name": "Image",
                "valueKind": "imageRef",
                "persistent": True,
            },
        ],
    )

    report = validate_project_document(_parse(document), _production_registry())
    codes = {diagnostic.code for diagnostic in report.diagnostics}

    assert {
        GraphDiagnosticCodeV1.graph_duplicate_variable_id,
        GraphDiagnosticCodeV1.graph_duplicate_variable_name,
        GraphDiagnosticCodeV1.graph_variable_persistence_unsupported,
    } <= codes
    semantic = [
        diagnostic
        for diagnostic in report.diagnostics
        if diagnostic.code
        in {
            GraphDiagnosticCodeV1.graph_duplicate_variable_id,
            GraphDiagnosticCodeV1.graph_duplicate_variable_name,
            GraphDiagnosticCodeV1.graph_variable_persistence_unsupported,
        }
    ]
    assert all(
        diagnostic.severity is DiagnosticSeverityV1.error for diagnostic in semantic
    )
    assert all(diagnostic.location.root.scope == "graph" for diagnostic in semantic)


def test_variable_nodes_report_unknown_and_static_type_mismatch_without_crashing() -> (
    None
):
    known_id = "aaaaaaaa-bbbb-4ccc-8ddd-000000000020"
    unknown_id = "aaaaaaaa-bbbb-4ccc-8ddd-000000000021"
    document = _document(
        [
            _node(
                NODE_LITERAL,
                "core.variable.getBool",
                properties={"variableId": known_id},
            ),
            _node(
                NODE_COMPARE,
                "core.variable.getString",
                properties={"variableId": unknown_id},
            ),
            _node(
                NODE_BRANCH,
                "core.variable.getBool",
                properties={"variableId": "not-a-uuid"},
            ),
        ],
        [],
        variables=[
            {
                "variableId": known_id,
                "name": "Amount",
                "valueKind": "number",
                "persistent": False,
            }
        ],
    )

    report = validate_project_document(_parse(document), _production_registry())
    variable_diagnostics = [
        diagnostic
        for diagnostic in report.diagnostics
        if diagnostic.code
        in {
            GraphDiagnosticCodeV1.node_variable_unknown,
            GraphDiagnosticCodeV1.node_variable_type_mismatch,
        }
    ]
    assert [diagnostic.code for diagnostic in variable_diagnostics] == [
        GraphDiagnosticCodeV1.node_variable_type_mismatch,
        GraphDiagnosticCodeV1.node_variable_unknown,
    ]
    assert all(
        diagnostic.severity is DiagnosticSeverityV1.error
        for diagnostic in variable_diagnostics
    )
    assert all(
        diagnostic.location.root.scope == "node" for diagnostic in variable_diagnostics
    )


def test_case_overlay_accepts_task_choice_data_and_typed_fallback_edges() -> None:
    subject = _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(
                NODE_TASK_CHOICE,
                "core.logic.taskChoice",
                properties={
                    "selectedCaseId": "one",
                    "settingKey": "choice",
                    "exposeInTaskSettings": True,
                },
            ),
            _node(
                NODE_LITERAL,
                "core.value.numberLiteral",
                properties={"value": 0},
            ),
            _node(
                NODE_OVERLAY,
                "core.logic.caseOverlayNumber",
                dynamic_port_state={
                    "taskChoiceCases": [
                        {"caseId": "one", "portId": "case1", "label": "One"},
                        {"caseId": "two", "portId": "case2", "label": "Two"},
                    ]
                },
            ),
            _node(
                NODE_OVERLAY_COMPARE,
                "core.logic.numberCompare",
                input_values={"right": 0},
                properties={"operator": "greaterThanOrEqual"},
            ),
            _node(NODE_BRANCH, "core.logic.branch"),
        ],
        [
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000020",
                "data",
                NODE_TASK_CHOICE,
                "selectedCaseId",
                NODE_OVERLAY,
                "selectedCaseId",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000021",
                "data",
                NODE_LITERAL,
                "value",
                NODE_OVERLAY,
                "fallback",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000022",
                "data",
                NODE_OVERLAY,
                "value",
                NODE_OVERLAY_COMPARE,
                "left",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000023",
                "data",
                NODE_OVERLAY_COMPARE,
                "result",
                NODE_BRANCH,
                "condition",
            ),
        ],
    )

    report = validate_project_document(_parse(subject), _registry())

    assert report.diagnostics == ()
    assert report.executable


def test_document_and_node_structure_diagnostics_match_the_editor() -> None:
    missing_entry = _valid_document_value()
    missing_entry["entryGraphId"] = "00000000-0000-4000-8000-000000000000"
    duplicate_identifiers = _valid_document_value()
    graph = cast("dict[str, Any]", duplicate_identifiers["graphs"][0])
    graph["nodes"].append(deepcopy(graph["nodes"][0]))
    graph["edges"].append(deepcopy(graph["edges"][0]))
    newer_node = _valid_document_value()
    newer_graph = cast("dict[str, Any]", newer_node["graphs"][0])
    newer_graph["nodes"][0]["typeVersion"] = 2

    assert GraphDiagnosticCodeV1.graph_entry_graph_missing in _codes(missing_entry)
    duplicate_codes = _codes(duplicate_identifiers)
    assert GraphDiagnosticCodeV1.graph_duplicate_node_id in duplicate_codes
    assert GraphDiagnosticCodeV1.graph_duplicate_edge_id in duplicate_codes
    assert GraphDiagnosticCodeV1.node_type_version_unsupported in _codes(newer_node)


def test_unknown_nodes_and_required_inputs_do_not_cascade() -> None:
    unknown = _document([_node(NODE_START, "future.unknownNode")], [])
    missing_required = _valid_document_value()
    graph = cast("dict[str, Any]", missing_required["graphs"][0])
    compare = cast(
        "dict[str, Any]",
        next(node for node in graph["nodes"] if node["nodeId"] == NODE_COMPARE),
    )
    compare["inputValues"] = {}

    unknown_codes = _codes(unknown)
    assert GraphDiagnosticCodeV1.node_type_unknown in unknown_codes
    assert GraphDiagnosticCodeV1.node_required_input_missing not in unknown_codes
    assert GraphDiagnosticCodeV1.node_required_input_missing in _codes(missing_required)


@pytest.mark.parametrize("mode,ports", CLICK_POINT_INPUT_CASES)
def test_click_modes_accept_only_the_selected_input_family(
    mode: str,
    ports: tuple[str, ...],
) -> None:
    codes = _codes(
        _click_point_document(mode, _click_point_input_values(ports)),
        registry=_click_point_validation_registry(),
    )

    assert GraphDiagnosticCodeV1.node_required_input_missing not in codes
    assert GraphDiagnosticCodeV1.node_input_value_not_accepted not in codes


@pytest.mark.parametrize("mode,ports,missing_port", CLICK_POINT_MISSING_CASES)
def test_click_modes_report_each_missing_selected_input(
    mode: str,
    ports: tuple[str, ...],
    missing_port: str,
) -> None:
    input_values = _click_point_input_values(
        tuple(port for port in ports if port != missing_port)
    )
    codes = _codes(
        _click_point_document(mode, input_values),
        registry=_click_point_validation_registry(),
    )

    assert GraphDiagnosticCodeV1.node_required_input_missing in codes
    assert GraphDiagnosticCodeV1.node_input_value_not_accepted not in codes


@pytest.mark.parametrize("mode", [None, "legacy-mode"])
def test_click_input_mode_falls_back_to_point_for_old_or_unknown_values(
    mode: str | None,
) -> None:
    codes = _codes(
        _click_point_document(mode, {}),
        registry=_click_point_validation_registry(),
    )

    assert GraphDiagnosticCodeV1.node_required_input_missing in codes
    assert GraphDiagnosticCodeV1.node_input_value_not_accepted not in codes


def test_capability_diagnostics_wait_until_capabilities_are_known() -> None:
    subject = _recognition_document_value()

    unknown_report = validate_project_document(_parse(subject), _registry())
    unavailable_report = validate_project_document(
        _parse(subject), _registry(), available_capabilities=[]
    )
    available_report = validate_project_document(
        _parse(subject),
        _registry(),
        available_capabilities=["automation.captureScreen", "vision.ocr"],
    )

    assert all(
        diagnostic.code is not GraphDiagnosticCodeV1.node_capability_unavailable
        for diagnostic in unknown_report.diagnostics
    )
    assert unavailable_report.diagnostics
    assert all(
        diagnostic.severity is DiagnosticSeverityV1.warning
        for diagnostic in unavailable_report.diagnostics
    )
    assert unavailable_report.executable
    assert available_report.diagnostics == ()


def test_edge_diagnostics_match_direction_kind_type_and_cardinality_rules() -> None:
    missing_node = _valid_document_value()
    graph = cast("dict[str, Any]", missing_node["graphs"][0])
    graph["edges"].append(
        _edge(
            "aaaaaaaa-bbbb-4ccc-8ddd-000000000007",
            "execution",
            "00000000-0000-4000-8000-00000000dead",
            "next",
            NODE_BRANCH,
            "whenTrue",
        )
    )

    wrong_kind = _valid_document_value()
    wrong_kind_graph = cast("dict[str, Any]", wrong_kind["graphs"][0])
    wrong_kind_graph["edges"][0]["edgeKind"] = "data"

    wrong_type = _valid_document_value()
    wrong_type_graph = cast("dict[str, Any]", wrong_type["graphs"][0])
    wrong_type_graph["nodes"].append(_node(NODE_OCR, "vision.ocr"))
    wrong_type_graph["edges"].append(
        _edge(
            "aaaaaaaa-bbbb-4ccc-8ddd-000000000008",
            "data",
            NODE_OCR,
            "matched",
            NODE_COMPARE,
            "left",
        )
    )

    duplicate_input = _valid_document_value()
    duplicate_graph = cast("dict[str, Any]", duplicate_input["graphs"][0])
    second_literal = "ae90dfc3-e7f8-4304-9f27-910213245f60"
    duplicate_graph["nodes"].append(_node(second_literal, "core.value.numberLiteral"))
    duplicate_graph["edges"].append(
        _edge(
            "aaaaaaaa-bbbb-4ccc-8ddd-000000000009",
            "data",
            second_literal,
            "value",
            NODE_COMPARE,
            "right",
        )
    )

    assert GraphDiagnosticCodeV1.edge_source_node_missing in _codes(missing_node)
    assert GraphDiagnosticCodeV1.edge_kind_mismatch in _codes(wrong_kind)
    assert GraphDiagnosticCodeV1.edge_type_incompatible in _codes(wrong_type)
    assert GraphDiagnosticCodeV1.edge_cardinality_exceeded in _codes(duplicate_input)


def test_pure_cycles_and_multiple_entry_nodes_match_the_editor() -> None:
    first = "ae90dfc3-e7f8-4304-9f27-910213245f60"
    second = "bfa1e0d4-f809-4415-8038-0213245f6071"
    cycle = _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(
                first,
                "core.logic.numberCompare",
                input_values={"left": 0},
            ),
            _node(
                second,
                "core.logic.numberCompare",
                input_values={"left": 0},
            ),
        ],
        [
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-00000000000a",
                "data",
                first,
                "result",
                second,
                "right",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-00000000000b",
                "data",
                second,
                "result",
                first,
                "right",
            ),
        ],
    )
    multiple_entries = _valid_document_value()
    graph = cast("dict[str, Any]", multiple_entries["graphs"][0])
    graph["nodes"].append(_node(first, "core.flow.start"))

    assert GraphDiagnosticCodeV1.graph_pure_data_cycle in _codes(cycle)
    assert GraphDiagnosticCodeV1.graph_multiple_entry_nodes in _codes(multiple_entries)


def test_multiple_parallel_path_reports_the_second_parallel_node() -> None:
    serial = _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(NODE_PARALLEL_ONE, "core.flow.parallel"),
            _node(NODE_PARALLEL_TWO, "core.flow.parallel"),
        ],
        [
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000030",
                "execution",
                NODE_START,
                "next",
                NODE_PARALLEL_ONE,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000031",
                "execution",
                NODE_PARALLEL_ONE,
                "branch1",
                NODE_PARALLEL_TWO,
                "run",
            ),
        ],
    )

    report = validate_project_document(_parse(serial), _registry())
    matching = [
        diagnostic
        for diagnostic in report.diagnostics
        if diagnostic.code is GraphDiagnosticCodeV1.graph_multiple_parallel_on_path
    ]

    assert len(matching) == 1
    assert matching[0].severity is DiagnosticSeverityV1.error
    assert matching[0].location.root.scope == "node"
    assert matching[0].location.root.node_id.hex == NODE_PARALLEL_TWO.replace("-", "")
    assert not report.executable


def test_parallel_path_rule_handles_branches_loops_and_unreachable_nodes() -> None:
    branch_paths = _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(NODE_SEQUENCE, "core.flow.sequence"),
            _node(NODE_PARALLEL_ONE, "core.flow.parallel"),
            _node(NODE_PARALLEL_TWO, "core.flow.parallel"),
        ],
        [
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000032",
                "execution",
                NODE_START,
                "next",
                NODE_SEQUENCE,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000033",
                "execution",
                NODE_SEQUENCE,
                "step1",
                NODE_PARALLEL_ONE,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000034",
                "execution",
                NODE_SEQUENCE,
                "step2",
                NODE_PARALLEL_TWO,
                "run",
            ),
        ],
    )
    unreachable = _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(NODE_PARALLEL_ONE, "core.flow.parallel"),
            _node(NODE_PARALLEL_TWO, "core.flow.parallel"),
        ],
        [
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000035",
                "execution",
                NODE_START,
                "next",
                NODE_PARALLEL_ONE,
                "run",
            )
        ],
    )

    assert GraphDiagnosticCodeV1.graph_multiple_parallel_on_path not in _codes(
        branch_paths
    )
    assert GraphDiagnosticCodeV1.graph_multiple_parallel_on_path not in _codes(
        unreachable
    )

    loop = _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(NODE_PARALLEL_ONE, "core.flow.parallel"),
            _node(NODE_BRANCH, "core.logic.branch"),
        ],
        [
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000036",
                "execution",
                NODE_START,
                "next",
                NODE_BRANCH,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000037",
                "execution",
                NODE_BRANCH,
                "whenTrue",
                NODE_PARALLEL_ONE,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000038",
                "execution",
                NODE_PARALLEL_ONE,
                "branch1",
                NODE_BRANCH,
                "run",
            ),
        ],
    )

    loop_codes = _codes(loop)
    assert GraphDiagnosticCodeV1.graph_multiple_parallel_on_path in loop_codes


def test_parallel_path_traversal_ignores_data_and_malformed_execution_edges() -> None:
    subject = _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(NODE_PARALLEL_ONE, "core.flow.parallel"),
            _node(NODE_PARALLEL_TWO, "core.flow.parallel"),
        ],
        [
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-000000000039",
                "execution",
                NODE_START,
                "next",
                NODE_PARALLEL_ONE,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-00000000003a",
                "data",
                NODE_PARALLEL_ONE,
                "branch1",
                NODE_PARALLEL_TWO,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-00000000003b",
                "execution",
                NODE_PARALLEL_ONE,
                "missing",
                NODE_PARALLEL_TWO,
                "run",
            ),
        ],
    )

    assert GraphDiagnosticCodeV1.graph_multiple_parallel_on_path not in _codes(subject)


def test_each_entry_is_checked_for_a_second_parallel() -> None:
    second_start = "b56748da-f4a5-4a7b-069c-a6879012c34e"
    subject = _document(
        [
            _node(NODE_START, "core.flow.start"),
            _node(second_start, "core.flow.start"),
            _node(NODE_PARALLEL_ONE, "core.flow.parallel"),
            _node(NODE_PARALLEL_TWO, "core.flow.parallel"),
        ],
        [
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-00000000003c",
                "execution",
                NODE_START,
                "next",
                NODE_PARALLEL_ONE,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-00000000003d",
                "execution",
                second_start,
                "next",
                NODE_PARALLEL_TWO,
                "run",
            ),
            _edge(
                "aaaaaaaa-bbbb-4ccc-8ddd-00000000003e",
                "execution",
                NODE_PARALLEL_ONE,
                "branch1",
                NODE_PARALLEL_TWO,
                "run",
            ),
        ],
    )

    assert GraphDiagnosticCodeV1.graph_multiple_parallel_on_path in _codes(subject)


def test_registered_node_migration_is_applied_without_mutating_the_document() -> None:
    registry = _registry()
    definitions = list(registry.definitions)
    compare_index = next(
        index
        for index, definition in enumerate(definitions)
        if definition.type_key.root == "core.logic.numberCompare"
    )
    definitions[compare_index] = definitions[compare_index].model_copy(
        update={"type_version": 2}
    )
    version_two_registry = registry.model_copy(update={"definitions": definitions})
    document = _parse(_valid_document_value())

    def migrate_compare(node: NodeV1) -> NodeV1:
        return node.model_copy(update={"type_version": 2})

    migrations = NodeMigrationCatalog(
        [
            NodeMigrationStep(
                type_key="core.logic.numberCompare",
                from_version=1,
                to_version=2,
                transform=migrate_compare,
            )
        ]
    )

    report = validate_project_document(
        document,
        version_two_registry,
        migrations=migrations,
    )

    assert report.diagnostics == ()
    original_compare = next(
        node
        for node in document.graphs[0].nodes
        if node.node_id.hex == NODE_COMPARE.replace("-", "")
    )
    assert original_compare.type_version == 1


def test_missing_migration_chain_is_reported_as_unsupported() -> None:
    registry = _registry()
    definitions = list(registry.definitions)
    start_index = next(
        index
        for index, definition in enumerate(definitions)
        if definition.type_key.root == "core.flow.start"
    )
    definitions[start_index] = definitions[start_index].model_copy(
        update={"type_version": 2}
    )
    version_two_registry = registry.model_copy(update={"definitions": definitions})

    report = validate_project_document(
        _parse(_valid_document_value()),
        version_two_registry,
    )

    assert GraphDiagnosticCodeV1.node_type_version_unsupported in {
        diagnostic.code for diagnostic in report.diagnostics
    }


def test_migration_catalog_rejects_gaps_and_duplicate_steps() -> None:
    def no_change(node: NodeV1) -> NodeV1:
        return node

    first = NodeMigrationStep("core.flow.start", 1, 2, no_change)

    with pytest.raises(ValueError, match="exactly one version"):
        NodeMigrationCatalog([NodeMigrationStep("core.flow.start", 1, 3, no_change)])
    with pytest.raises(ValueError, match="Duplicate"):
        NodeMigrationCatalog([first, first])


def test_diagnostics_never_include_project_content() -> None:
    subject = _valid_document_value()
    subject["metadata"]["name"] = "private-project-content"
    graph = cast("dict[str, Any]", subject["graphs"][0])
    graph["nodes"][2]["displayAlias"] = "private-node-content"
    graph["nodes"][2]["inputValues"] = {}

    report = validate_project_document(_parse(subject), _registry())
    serialized = report.to_contract().model_dump_json(by_alias=True)

    assert "private-project-content" not in serialized
    assert "private-node-content" not in serialized


def _test_uuid(number: int) -> str:
    return f"{number:08x}-1111-4111-8111-111111111111"


def _function_call_node(
    node_id: str,
    target_graph_id: object,
    *,
    input_values: dict[str, object] | None = None,
) -> dict[str, object]:
    return _node(
        node_id,
        "core.function.call",
        properties={"functionGraphId": target_graph_id},
        input_values=input_values,
    )


def _empty_function_graph(
    graph_id: str,
    *,
    extra_nodes: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return _function_graph(
        graph_id,
        nodes=[
            _node(_test_uuid(int(graph_id[:8], 16) + 1), "core.function.input"),
            _node(_test_uuid(int(graph_id[:8], 16) + 2), "core.function.return"),
            *(extra_nodes or []),
        ],
    )


def test_function_nodes_use_all_effective_value_ports_and_valid_edges() -> None:
    value_kinds = ("bool", "number", "string", "point", "rect", "imageRef")
    inputs = [
        _function_parameter(
            _test_uuid(index + 10),
            f"input{kind[0].upper()}{kind[1:]}",
            kind,
            kind,
        )
        for index, kind in enumerate(value_kinds)
    ]
    outputs = [
        _function_parameter(
            _test_uuid(index + 30),
            f"output{kind[0].upper()}{kind[1:]}",
            kind,
            kind,
        )
        for index, kind in enumerate(value_kinds)
    ]
    input_node_id = _test_uuid(100)
    return_node_id = _test_uuid(101)
    edges = [
        _edge(
            _test_uuid(index + 110),
            "data",
            input_node_id,
            inputs[index]["portId"],
            return_node_id,
            outputs[index]["portId"],
        )
        for index in range(len(value_kinds))
    ]
    edges.insert(
        0,
        _edge(
            _test_uuid(109),
            "execution",
            input_node_id,
            "next",
            return_node_id,
            "run",
        ),
    )
    function_graph = _function_graph(
        _test_uuid(1),
        signature={"inputs": inputs, "outputs": outputs},
        nodes=[
            _node(input_node_id, "core.function.input"),
            _node(return_node_id, "core.function.return"),
        ],
        edges=edges,
    )
    entry = _entry_graph()
    entry["nodes"] = [_node(NODE_START, "core.flow.start")]

    report = validate_project_document(
        _parse(_document_with_graphs([entry, function_graph])),
        _registry(),
    )

    assert report.diagnostics == ()


def test_function_call_literal_policy_and_wrong_edge_type_use_effective_ports() -> None:
    target_id = _test_uuid(2)
    parameters = [
        _function_parameter(_test_uuid(index + 50), f"{kind}Input", kind, kind)
        for index, kind in enumerate(
            ("bool", "number", "string", "point", "rect", "imageRef")
        )
    ]
    target = _function_graph(
        target_id,
        signature={"inputs": parameters, "outputs": []},
        nodes=[
            _node(_test_uuid(200), "core.function.input"),
            _node(_test_uuid(201), "core.function.return"),
        ],
    )
    call_id = _test_uuid(202)
    entry = _entry_graph()
    entry["nodes"] = [
        _node(NODE_START, "core.flow.start"),
        _function_call_node(
            call_id,
            target_id,
            input_values={
                "boolInput": True,
                "numberInput": 1,
                "stringInput": "value",
                "pointInput": {"x": 1, "y": 2},
                "rectInput": {"x": 1, "y": 2, "width": 3, "height": 4},
                "imageRefInput": {"assetId": "asset"},
            },
        ),
    ]
    report = validate_project_document(
        _parse(_document_with_graphs([entry, target])),
        _registry(),
    )
    assert [diagnostic.code for diagnostic in report.diagnostics] == [
        GraphDiagnosticCodeV1.node_input_value_not_accepted,
        GraphDiagnosticCodeV1.node_input_value_not_accepted,
        GraphDiagnosticCodeV1.node_input_value_not_accepted,
    ]

    wrong_target_id = _test_uuid(3)
    wrong_target = _function_graph(
        wrong_target_id,
        signature={
            "inputs": [
                _function_parameter(_test_uuid(70), "boolInput", "bool", "bool")
            ],
            "outputs": [],
        },
        nodes=[
            _node(_test_uuid(300), "core.function.input"),
            _node(_test_uuid(301), "core.function.return"),
        ],
    )
    wrong_entry = _entry_graph()
    wrong_entry["nodes"] = [
        _node(NODE_START, "core.flow.start"),
        _node(NODE_LITERAL, "core.value.numberLiteral"),
        _function_call_node(NODE_COMPARE, wrong_target_id),
    ]
    wrong_entry["edges"] = [
        _edge(
            _test_uuid(302),
            "data",
            NODE_LITERAL,
            "value",
            NODE_COMPARE,
            "boolInput",
        )
    ]
    wrong_report = validate_project_document(
        _parse(_document_with_graphs([wrong_entry, wrong_target])),
        _registry(),
    )
    assert [diagnostic.code for diagnostic in wrong_report.diagnostics] == [
        GraphDiagnosticCodeV1.edge_type_incompatible
    ]


def test_function_roles_reserved_ports_and_multiple_returns() -> None:
    missing = _function_graph(_test_uuid(4), nodes=[])
    missing_report = validate_project_document(
        _parse(_document_with_graphs([_entry_graph(), missing])),
        _registry(),
    )
    assert [diagnostic.code for diagnostic in missing_report.diagnostics] == [
        GraphDiagnosticCodeV1.function_entry_node_missing,
        GraphDiagnosticCodeV1.function_return_node_missing,
    ]

    multiple = _function_graph(
        _test_uuid(5),
        nodes=[
            _node(_test_uuid(501), "core.function.input"),
            _node(_test_uuid(502), "core.function.input"),
            _node(_test_uuid(503), "core.function.return"),
            _node(_test_uuid(504), "core.function.return"),
        ],
    )
    multiple_report = validate_project_document(
        _parse(_document_with_graphs([_entry_graph(), multiple])),
        _registry(),
    )
    assert [diagnostic.code for diagnostic in multiple_report.diagnostics] == [
        GraphDiagnosticCodeV1.function_multiple_entry_nodes
    ]

    outside = _entry_graph()
    outside["nodes"] = [
        _node(NODE_START, "core.flow.start"),
        _node(_test_uuid(505), "core.function.input"),
        _node(_test_uuid(506), "core.function.return"),
    ]
    outside_report = validate_project_document(
        _parse(_document_with_graphs([outside])),
        _registry(),
    )
    assert [diagnostic.code for diagnostic in outside_report.diagnostics] == [
        GraphDiagnosticCodeV1.function_node_outside_function,
        GraphDiagnosticCodeV1.function_node_outside_function,
    ]

    reserved = _function_graph(
        _test_uuid(6),
        signature={
            "inputs": [_function_parameter(_test_uuid(60), "run", "run", "bool")],
            "outputs": [_function_parameter(_test_uuid(61), "next", "next", "point")],
        },
        nodes=[
            _node(_test_uuid(601), "core.function.input"),
            _node(_test_uuid(602), "core.function.return"),
        ],
    )
    reserved_report = validate_project_document(
        _parse(_document_with_graphs([_entry_graph(), reserved])),
        _registry(),
    )
    assert [diagnostic.code for diagnostic in reserved_report.diagnostics] == [
        GraphDiagnosticCodeV1.function_parameter_port_reserved,
        GraphDiagnosticCodeV1.function_parameter_port_reserved,
    ]


def test_function_call_targets_have_stable_diagnostics_and_recursion_is_rejected() -> (
    None
):
    entry = _entry_graph()
    entry["nodes"] = [
        _node(NODE_START, "core.flow.start"),
        _function_call_node(_test_uuid(701), 1),
        _function_call_node(_test_uuid(702), "not-a-uuid"),
        _function_call_node(_test_uuid(703), _test_uuid(999)),
        _function_call_node(_test_uuid(704), GRAPH_ID),
    ]
    target = _empty_function_graph(_test_uuid(7))
    report = validate_project_document(
        _parse(_document_with_graphs([entry, target])),
        _registry(),
    )
    assert [diagnostic.code for diagnostic in report.diagnostics] == [
        GraphDiagnosticCodeV1.function_call_target_missing,
        GraphDiagnosticCodeV1.function_call_target_missing,
        GraphDiagnosticCodeV1.function_call_target_missing,
        GraphDiagnosticCodeV1.function_call_target_not_function,
    ]

    direct_id = _test_uuid(8)
    direct = _empty_function_graph(
        direct_id,
        extra_nodes=[
            _function_call_node(_test_uuid(801), direct_id),
        ],
    )
    direct_report = validate_project_document(
        _parse(_document_with_graphs([_entry_graph(), direct])),
        _registry(),
    )
    assert [diagnostic.code for diagnostic in direct_report.diagnostics] == [
        GraphDiagnosticCodeV1.function_recursion_forbidden
    ]

    first_id = _test_uuid(9)
    second_id = _test_uuid(10)
    first = _empty_function_graph(
        first_id,
        extra_nodes=[_function_call_node(_test_uuid(901), second_id)],
    )
    second = _empty_function_graph(
        second_id,
        extra_nodes=[_function_call_node(_test_uuid(1001), first_id)],
    )
    indirect_report = validate_project_document(
        _parse(_document_with_graphs([_entry_graph(), first, second])),
        _registry(),
    )
    assert [diagnostic.code for diagnostic in indirect_report.diagnostics] == [
        GraphDiagnosticCodeV1.function_recursion_forbidden,
        GraphDiagnosticCodeV1.function_recursion_forbidden,
    ]


@pytest.mark.parametrize("count, expected", [(16, ()), (17, ("depth",))])
def test_function_call_depth_starts_after_entry_and_caps_at_sixteen(
    count: int,
    expected: tuple[str, ...],
) -> None:
    function_ids = [_test_uuid(1000 + index) for index in range(count)]
    entry = _entry_graph()
    entry["nodes"] = [
        _node(NODE_START, "core.flow.start"),
        _function_call_node(_test_uuid(2000), function_ids[0]),
    ]
    graphs: list[dict[str, object]] = [_entry_graph()]
    graphs[0] = entry
    for index, graph_id in enumerate(function_ids):
        extra_nodes = (
            [_function_call_node(_test_uuid(3000 + index), function_ids[index + 1])]
            if index + 1 < len(function_ids)
            else []
        )
        graphs.append(_empty_function_graph(graph_id, extra_nodes=extra_nodes))

    report = validate_project_document(
        _parse(_document_with_graphs(graphs)), _registry()
    )
    depth_codes = [
        diagnostic.code
        for diagnostic in report.diagnostics
        if diagnostic.code is GraphDiagnosticCodeV1.function_call_depth_exceeded
    ]
    assert (("depth",) if depth_codes else ()) == expected
