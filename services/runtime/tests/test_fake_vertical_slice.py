"""Numeric-recognition flow through production nodes and a deterministic backend."""

from __future__ import annotations

from uuid import UUID

import pytest

from rino_runtime.backends.fake import FakeAutomationBackend, FakeAutomationScenario
from rino_runtime.contracts.generated.rino_graph_v1 import GraphV1
from rino_runtime.nodes import (
    RuntimeOcrCandidate,
    RuntimeRect,
    build_phase_4_fake_backend_registry,
)
from rino_runtime.scheduler import GraphScheduler, RunStatus, SchedulerLimits

GRAPH_ID = UUID("51000000-0000-4000-8000-000000000001")
RUN_ID = UUID("51000000-0000-4000-8000-000000000002")
START_ID = UUID("51000000-0000-4000-8000-000000000010")
CAPTURE_ID = UUID("51000000-0000-4000-8000-000000000011")
OCR_ID = UUID("51000000-0000-4000-8000-000000000012")
MATCHED_BRANCH_ID = UUID("51000000-0000-4000-8000-000000000013")
PARSE_ID = UUID("51000000-0000-4000-8000-000000000014")
COMPARE_ID = UUID("51000000-0000-4000-8000-000000000015")
RESULT_BRANCH_ID = UUID("51000000-0000-4000-8000-000000000016")
GREATER_CLICK_ID = UUID("51000000-0000-4000-8000-000000000017")
OTHER_CLICK_ID = UUID("51000000-0000-4000-8000-000000000018")
NO_MATCH_LOG_ID = UUID("51000000-0000-4000-8000-000000000019")
INVALID_LOG_ID = UUID("51000000-0000-4000-8000-000000000020")
POINT_ID = UUID("51000000-0000-4000-8000-000000000021")
POINT_CLICK_ID = UUID("51000000-0000-4000-8000-000000000022")


def _node(
    node_id: UUID,
    type_key: str,
    *,
    properties: dict[str, object] | None = None,
    input_values: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "nodeId": str(node_id),
        "typeKey": type_key,
        "typeVersion": 1,
        "position": {"x": 0, "y": 0},
        "properties": properties or {},
        "inputValues": input_values or {},
    }


def _edge(
    number: int,
    kind: str,
    source_node_id: UUID,
    source_port_id: str,
    target_node_id: UUID,
    target_port_id: str,
) -> dict[str, object]:
    return {
        "edgeId": str(UUID(f"52000000-0000-4000-8000-{number:012d}")),
        "edgeKind": kind,
        "sourceNodeId": str(source_node_id),
        "sourcePortId": source_port_id,
        "targetNodeId": str(target_node_id),
        "targetPortId": target_port_id,
    }


def _reference_graph(
    threshold: float = 40,
    *,
    parse_properties: dict[str, object] | None = None,
) -> GraphV1:
    nodes = [
        _node(START_ID, "core.flow.start"),
        _node(CAPTURE_ID, "automation.captureScreen"),
        _node(OCR_ID, "vision.ocr"),
        _node(MATCHED_BRANCH_ID, "core.logic.branch"),
        _node(PARSE_ID, "text.parseNumber", properties=parse_properties),
        _node(
            COMPARE_ID,
            "core.logic.numberCompare",
            properties={"operator": "greaterThan"},
            input_values={"right": threshold},
        ),
        _node(RESULT_BRANCH_ID, "core.logic.branch"),
        _node(GREATER_CLICK_ID, "automation.clickRectCenter"),
        _node(OTHER_CLICK_ID, "automation.clickRectCenter"),
        _node(
            NO_MATCH_LOG_ID,
            "core.diagnostic.log",
            input_values={"message": "No OCR match"},
        ),
        _node(
            INVALID_LOG_ID,
            "core.diagnostic.log",
            input_values={"message": "Invalid number"},
        ),
    ]
    edges = [
        _edge(1, "execution", START_ID, "next", CAPTURE_ID, "run"),
        _edge(2, "execution", CAPTURE_ID, "next", OCR_ID, "run"),
        _edge(3, "execution", OCR_ID, "next", MATCHED_BRANCH_ID, "run"),
        _edge(
            4,
            "execution",
            MATCHED_BRANCH_ID,
            "whenTrue",
            PARSE_ID,
            "run",
        ),
        _edge(
            5,
            "execution",
            MATCHED_BRANCH_ID,
            "whenFalse",
            NO_MATCH_LOG_ID,
            "run",
        ),
        _edge(6, "execution", PARSE_ID, "parsed", RESULT_BRANCH_ID, "run"),
        _edge(7, "execution", PARSE_ID, "invalid", INVALID_LOG_ID, "run"),
        _edge(
            8,
            "execution",
            RESULT_BRANCH_ID,
            "whenTrue",
            GREATER_CLICK_ID,
            "run",
        ),
        _edge(
            9,
            "execution",
            RESULT_BRANCH_ID,
            "whenFalse",
            OTHER_CLICK_ID,
            "run",
        ),
        _edge(10, "data", CAPTURE_ID, "image", OCR_ID, "image"),
        _edge(11, "data", OCR_ID, "matched", MATCHED_BRANCH_ID, "condition"),
        _edge(12, "data", OCR_ID, "bestText", PARSE_ID, "text"),
        _edge(13, "data", PARSE_ID, "number", COMPARE_ID, "left"),
        _edge(14, "data", COMPARE_ID, "result", RESULT_BRANCH_ID, "condition"),
        _edge(15, "data", OCR_ID, "bestRect", GREATER_CLICK_ID, "rect"),
        _edge(16, "data", OCR_ID, "bestRect", OTHER_CLICK_ID, "rect"),
    ]
    return GraphV1.model_validate(
        {
            "graphId": str(GRAPH_ID),
            "name": "Numeric recognition",
            "kind": "entry",
            "nodes": nodes,
            "edges": edges,
        }
    )


def _limits() -> SchedulerLimits:
    return SchedulerLimits(
        max_node_steps=100,
        max_duration_seconds=5,
        max_queue_size=32,
        max_stored_values=100,
        max_stored_logs=20,
        max_events=200,
        max_pure_depth=16,
    )


def _candidate(
    text: str,
    confidence: float = 0.95,
    *,
    x: int = 10,
) -> RuntimeOcrCandidate:
    return RuntimeOcrCandidate(
        text=text,
        confidence=confidence,
        rect=RuntimeRect(x=x, y=20, width=40, height=20),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    (
        "scenario",
        "threshold",
        "parse_properties",
        "expected_click_node",
        "expected_click_x",
        "expected_log",
    ),
    [
        pytest.param(
            FakeAutomationScenario(candidates=(_candidate("41"),)),
            40,
            None,
            GREATER_CLICK_ID,
            30,
            None,
            id="greater",
        ),
        pytest.param(
            FakeAutomationScenario(candidates=(_candidate("40"),)),
            40,
            None,
            OTHER_CLICK_ID,
            30,
            None,
            id="equal",
        ),
        pytest.param(
            FakeAutomationScenario(candidates=(_candidate("39"),)),
            40,
            None,
            OTHER_CLICK_ID,
            30,
            None,
            id="lower",
        ),
        pytest.param(
            FakeAutomationScenario(candidates=(_candidate("-2"),)),
            -1,
            None,
            OTHER_CLICK_ID,
            30,
            None,
            id="negative",
        ),
        pytest.param(
            FakeAutomationScenario(candidates=(_candidate("40.5"),)),
            40,
            None,
            GREATER_CLICK_ID,
            30,
            None,
            id="decimal",
        ),
        pytest.param(
            FakeAutomationScenario(candidates=(_candidate("\uff14\uff11"),)),
            40,
            {"normalizeFullWidth": True},
            GREATER_CLICK_ID,
            30,
            None,
            id="full-width-opt-in",
        ),
        pytest.param(
            FakeAutomationScenario(
                candidates=(
                    _candidate("999", 0.7),
                    _candidate("39", x=100),
                    _candidate("41", x=200),
                )
            ),
            40,
            None,
            OTHER_CLICK_ID,
            120,
            None,
            id="multiple-candidates-confidence-then-reading-order",
        ),
        pytest.param(
            FakeAutomationScenario(),
            40,
            None,
            None,
            None,
            "No OCR match",
            id="no-match",
        ),
        pytest.param(
            FakeAutomationScenario(candidates=(_candidate("not a number"),)),
            40,
            None,
            None,
            None,
            "Invalid number",
            id="invalid-number",
        ),
    ],
)
async def test_numeric_recognition_acceptance_matrix(
    scenario: FakeAutomationScenario,
    threshold: float,
    parse_properties: dict[str, object] | None,
    expected_click_node: UUID | None,
    expected_click_x: int | None,
    expected_log: str | None,
) -> None:
    backend = FakeAutomationBackend(scenario)
    graph = _reference_graph(
        threshold,
        parse_properties=parse_properties,
    )

    snapshot = await GraphScheduler(
        graph,
        build_phase_4_fake_backend_registry(backend),
        _limits(),
        run_id=RUN_ID,
        device_key="fake-device",
    ).run()

    assert snapshot.status is RunStatus.SUCCEEDED
    assert all(not node.type_key.root.startswith("test.") for node in graph.nodes)
    activation_ids = {activation.node_id for activation in snapshot.activations}
    if expected_click_node is None:
        assert backend.clicks == ()
        assert [log.message for log in snapshot.logs] == [expected_log]
        assert GREATER_CLICK_ID not in activation_ids
        assert OTHER_CLICK_ID not in activation_ids
        return

    unexpected_click_node = (
        OTHER_CLICK_ID if expected_click_node == GREATER_CLICK_ID else GREATER_CLICK_ID
    )
    assert expected_click_node in activation_ids
    assert unexpected_click_node not in activation_ids
    assert snapshot.logs == ()
    assert len(backend.clicks) == 1
    assert expected_click_x is not None
    assert backend.clicks[0].point.x == expected_click_x
    assert backend.clicks[0].point.y == 30


@pytest.mark.asyncio
async def test_backend_failure_is_structured_and_never_dispatches_an_action() -> None:
    backend = FakeAutomationBackend(
        FakeAutomationScenario(
            candidates=(_candidate("41"),),
            recognition_failure=True,
        )
    )

    snapshot = await GraphScheduler(
        _reference_graph(),
        build_phase_4_fake_backend_registry(backend),
        _limits(),
        run_id=RUN_ID,
        device_key="fake-device",
    ).run()

    assert snapshot.status is RunStatus.FAILED
    assert snapshot.terminal_error is not None
    assert snapshot.terminal_error.code == "SCHEDULER_EXECUTOR_FAILED"
    assert backend.clicks == ()


def _point_click_graph(reference_width: int, reference_height: int) -> GraphV1:
    return GraphV1.model_validate(
        {
            "graphId": str(GRAPH_ID),
            "name": "Point click",
            "kind": "entry",
            "nodes": [
                _node(START_ID, "core.flow.start"),
                _node(CAPTURE_ID, "automation.captureScreen"),
                _node(
                    POINT_ID,
                    "core.geometry.point",
                    input_values={
                        "x": 120,
                        "y": 340,
                        "referenceWidth": reference_width,
                        "referenceHeight": reference_height,
                    },
                ),
                _node(
                    POINT_CLICK_ID,
                    "automation.clickPoint",
                    properties={"inputMode": "point"},
                ),
            ],
            "edges": [
                _edge(20, "execution", START_ID, "next", CAPTURE_ID, "run"),
                _edge(
                    21,
                    "execution",
                    CAPTURE_ID,
                    "next",
                    POINT_CLICK_ID,
                    "run",
                ),
                _edge(22, "data", CAPTURE_ID, "image", POINT_ID, "image"),
                _edge(23, "data", POINT_ID, "point", POINT_CLICK_ID, "point"),
            ],
        }
    )


@pytest.mark.asyncio
async def test_point_node_binds_coordinates_to_the_captured_frame() -> None:
    backend = FakeAutomationBackend(FakeAutomationScenario())

    snapshot = await GraphScheduler(
        _point_click_graph(1280, 720),
        build_phase_4_fake_backend_registry(backend),
        _limits(),
        run_id=RUN_ID,
        device_key="fake-device",
    ).run()

    assert snapshot.status is RunStatus.SUCCEEDED
    assert len(backend.clicks) == 1
    assert backend.clicks[0].point.x == 120
    assert backend.clicks[0].point.y == 340
    assert backend.clicks[0].point.coordinate_space_id == "fake-device-raw"
    assert backend.clicks[0].point.source_generation == 1


@pytest.mark.asyncio
async def test_resolution_mismatch_fails_before_point_click_dispatch() -> None:
    backend = FakeAutomationBackend(FakeAutomationScenario())

    snapshot = await GraphScheduler(
        _point_click_graph(1080, 1920),
        build_phase_4_fake_backend_registry(backend),
        _limits(),
        run_id=RUN_ID,
        device_key="fake-device",
    ).run()

    assert snapshot.status is RunStatus.FAILED
    assert backend.clicks == ()
