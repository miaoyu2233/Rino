"""Determinism, caching, limits, and terminal-state tests for P4-T03."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from uuid import UUID

import pytest

from rino_runtime.contracts.generated.rino_graph_v1 import (
    GraphV1,
    RinoProjectDocumentV1,
)
from rino_runtime.contracts.generated.rino_registry_v1 import NodeDefinitionV1
from rino_runtime.execution_control import CancellationScope
from rino_runtime.nodes import (
    InMemoryFakeActionRecorder,
    NodeExecutionContext,
    NodeExecutionFailure,
    NodeExecutionFailureCode,
    NodeExecutionResult,
    NodeRegistration,
    NodeRegistry,
    NodeRegistryBuilder,
    RuntimeImageReference,
    RuntimePoint,
    RuntimeRect,
    build_phase_4_production_registry,
    build_phase_4_test_registry,
)
from rino_runtime.scheduler import (
    GraphScheduler,
    RunStatus,
    SchedulerEvent,
    SchedulerEventKind,
    SchedulerFailureCode,
    SchedulerLimits,
    StoredLog,
    StoredValue,
)

GRAPH_ID = UUID("11111111-1111-4111-8111-111111111111")
REQUEST_ID = UUID("21111111-1111-4111-8111-111111111111")
RUN_ID = UUID("22222222-2222-4222-8222-222222222222")
START_ID = UUID("30000000-0000-4000-8000-000000000001")
SEQUENCE_ID = UUID("30000000-0000-4000-8000-000000000002")
BRANCH_A_ID = UUID("30000000-0000-4000-8000-000000000003")
BRANCH_B_ID = UUID("30000000-0000-4000-8000-000000000004")
LEFT_ID = UUID("30000000-0000-4000-8000-000000000005")
RIGHT_ID = UUID("30000000-0000-4000-8000-000000000006")
COMPARE_ID = UUID("30000000-0000-4000-8000-000000000007")
STOP_ID = UUID("30000000-0000-4000-8000-000000000008")
ACTION_ID = UUID("30000000-0000-4000-8000-000000000009")
TASK_CHOICE_ID = UUID("30000000-0000-4000-8000-000000000010")
TASK_CHOICE_STOP_ID = UUID("30000000-0000-4000-8000-000000000011")
RETRY_GATE_ID = UUID("30000000-0000-4000-8000-000000000012")
POLLING_PROBE_ID = UUID("30000000-0000-4000-8000-000000000013")
POLLING_HIT_STOP_ID = UUID("30000000-0000-4000-8000-000000000014")
POLLING_EXHAUSTED_STOP_ID = UUID("30000000-0000-4000-8000-000000000015")
OVERLAY_ID = UUID("30000000-0000-4000-8000-000000000016")
OVERLAY_FALLBACK_ID = UUID("30000000-0000-4000-8000-000000000017")
OVERLAY_CASE_ID = UUID("30000000-0000-4000-8000-000000000018")
OVERLAY_COMPARE_ID = UUID("30000000-0000-4000-8000-000000000019")
OVERLAY_BRANCH_ID = UUID("30000000-0000-4000-8000-00000000001a")
OVERLAY_STOP_ID = UUID("30000000-0000-4000-8000-00000000001b")
VARIABLE_GET_ID = UUID("30000000-0000-4000-8000-00000000001c")
VARIABLE_SET_ID = UUID("30000000-0000-4000-8000-00000000001d")
VARIABLE_FIRST_BRANCH_ID = UUID("30000000-0000-4000-8000-00000000001e")
VARIABLE_SECOND_BRANCH_ID = UUID("30000000-0000-4000-8000-00000000001f")
VARIABLE_STOP_ID = UUID("30000000-0000-4000-8000-000000000020")
VARIABLE_BOOL_ID = UUID("60000000-0000-4000-8000-000000000001")
VARIABLE_NUMBER_ID = UUID("60000000-0000-4000-8000-000000000002")


class _RecordingObserver:
    def __init__(self) -> None:
        self.records: list[tuple[str, UUID | None]] = []

    def on_event(self, event: SchedulerEvent) -> None:
        self.records.append((event.kind.value, event.node_id))

    def on_values_committed(self, values: tuple[StoredValue, ...]) -> None:
        self.records.append(("values.committed", values[0].node_id))

    def on_logs_committed(self, logs: tuple[StoredLog, ...]) -> None:
        self.records.append(("logs.committed", logs[0].node_id))


def _limits(**overrides: int | float) -> SchedulerLimits:
    values: dict[str, int | float] = {
        "max_node_steps": 100,
        "max_duration_seconds": 30.0,
        "max_queue_size": 32,
        "max_stored_values": 100,
        "max_stored_logs": 100,
        "max_events": 200,
        "max_pure_depth": 16,
        "max_retained_tokens": 100,
        "max_retained_activations": 100,
        "max_retained_events": 200,
        "max_retained_values": 100,
        "max_retained_logs": 100,
    }
    values.update(overrides)
    if "max_retained_tokens" not in overrides:
        values["max_retained_tokens"] = min(
            values["max_retained_tokens"], values["max_node_steps"]
        )
    if "max_retained_activations" not in overrides:
        values["max_retained_activations"] = min(
            values["max_retained_activations"], values["max_node_steps"]
        )
    if "max_retained_events" not in overrides:
        values["max_retained_events"] = min(
            values["max_retained_events"], values["max_events"]
        )
    if "max_retained_values" not in overrides:
        values["max_retained_values"] = min(
            values["max_retained_values"], values["max_stored_values"]
        )
    if "max_retained_logs" not in overrides:
        values["max_retained_logs"] = min(
            values["max_retained_logs"], values["max_stored_logs"]
        )
    return SchedulerLimits(
        max_node_steps=int(values["max_node_steps"]),
        max_duration_seconds=float(values["max_duration_seconds"]),
        max_queue_size=int(values["max_queue_size"]),
        max_stored_values=int(values["max_stored_values"]),
        max_stored_logs=int(values["max_stored_logs"]),
        max_events=int(values["max_events"]),
        max_pure_depth=int(values["max_pure_depth"]),
        max_retained_tokens=int(values["max_retained_tokens"]),
        max_retained_activations=int(values["max_retained_activations"]),
        max_retained_events=int(values["max_retained_events"]),
        max_retained_values=int(values["max_retained_values"]),
        max_retained_logs=int(values["max_retained_logs"]),
    )


def _node(
    node_id: UUID,
    type_key: str,
    *,
    properties: dict[str, object] | None = None,
    input_values: dict[str, object] | None = None,
    dynamic_port_state: dict[str, object] | None = None,
    breakpoint: bool = False,
) -> dict[str, object]:
    return {
        "nodeId": str(node_id),
        "typeKey": type_key,
        "typeVersion": 1,
        "position": {"x": 0, "y": 0},
        "properties": properties or {},
        "inputValues": input_values or {},
        **(
            {"dynamicPortState": dynamic_port_state}
            if dynamic_port_state is not None
            else {}
        ),
        **({"breakpoint": True} if breakpoint else {}),
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
        "edgeId": str(UUID(f"40000000-0000-4000-8000-{number:012d}")),
        "edgeKind": kind,
        "sourceNodeId": str(source_node_id),
        "sourcePortId": source_port_id,
        "targetNodeId": str(target_node_id),
        "targetPortId": target_port_id,
    }


def _graph(
    nodes: list[dict[str, object]],
    edges: list[dict[str, object]],
    *,
    variables: list[dict[str, object]] | None = None,
) -> GraphV1:
    graph: dict[str, object] = {
        "graphId": str(GRAPH_ID),
        "name": "Scheduler test",
        "kind": "entry",
        "nodes": nodes,
        "edges": edges,
    }
    if variables is not None:
        graph["variables"] = variables
    return GraphV1.model_validate(graph)


def _function_id(number: int) -> UUID:
    return UUID(f"70000000-0000-4000-8000-{number:012d}")


def _function_graph(
    graph_id: UUID,
    nodes: list[dict[str, object]],
    edges: list[dict[str, object]],
    *,
    inputs: list[tuple[str, str]] = (),
    outputs: list[tuple[str, str]] = (),
    variables: list[dict[str, object]] | None = None,
) -> GraphV1:
    def parameter(number: int, port_id: str, value_kind: str) -> dict[str, object]:
        return {
            "parameterId": str(_function_id(number)),
            "portId": port_id,
            "name": port_id,
            "valueKind": value_kind,
        }

    graph: dict[str, object] = {
        "graphId": str(graph_id),
        "name": f"Function {graph_id.hex[-4:]}",
        "kind": "function",
        "functionSignature": {
            "inputs": [
                parameter(index + 1, port, kind)
                for index, (port, kind) in enumerate(inputs)
            ],
            "outputs": [
                parameter(index + 101, port, kind)
                for index, (port, kind) in enumerate(outputs)
            ],
        },
        "nodes": nodes,
        "edges": edges,
    }
    if variables is not None:
        graph["variables"] = variables
    return GraphV1.model_validate(graph)


def _function_document(
    entry_graph: GraphV1,
    function_graphs: list[GraphV1],
    *,
    variables: list[dict[str, object]] | None = None,
) -> RinoProjectDocumentV1:
    return RinoProjectDocumentV1.model_validate(
        {
            "schemaVersion": 1,
            "documentId": str(_function_id(900)),
            "metadata": {
                "name": "Function scheduler test",
                "createdAt": "2026-08-22T00:00:00Z",
                "updatedAt": "2026-08-22T00:00:00Z",
            },
            "entryGraphId": str(entry_graph.graph_id),
            "graphs": [entry_graph, *function_graphs],
            **({"variables": variables} if variables is not None else {}),
            "assets": [],
            "requiredCapabilities": [],
        }
    )


def _entry_graph(
    graph_id: UUID,
    nodes: list[dict[str, object]],
    edges: list[dict[str, object]],
) -> GraphV1:
    return GraphV1.model_validate(
        {
            "graphId": str(graph_id),
            "name": "Entry function caller",
            "kind": "entry",
            "nodes": nodes,
            "edges": edges,
        }
    )


def _caller_graph(
    graph_id: UUID,
    call_id: UUID,
    target_id: UUID,
    stop_id: UUID,
    *,
    input_values: dict[str, object] | None = None,
) -> GraphV1:
    call = _node(
        call_id,
        "core.function.call",
        properties={"functionGraphId": str(target_id)},
        input_values=input_values,
    )
    return _entry_graph(
        graph_id,
        [
            _node(_function_id(901), "core.flow.start"),
            call,
            _node(stop_id, "core.flow.stop"),
        ],
        [
            _edge(901, "execution", _function_id(901), "next", call_id, "run"),
            _edge(902, "execution", call_id, "next", stop_id, "run"),
        ],
    )


def _empty_function_chain(count: int) -> list[GraphV1]:
    functions: list[GraphV1] = []
    for index in range(count):
        graph_id = _function_id(3000 + index)
        input_id = _function_id(4000 + index)
        return_id = _function_id(5000 + index)
        nodes = [_node(input_id, "core.function.input")]
        edges: list[dict[str, object]] = []
        if index + 1 < count:
            call_id = _function_id(6000 + index)
            target_id = _function_id(3000 + index + 1)
            nodes.extend(
                [
                    _node(
                        call_id,
                        "core.function.call",
                        properties={"functionGraphId": str(target_id)},
                    ),
                ]
            )
            edges.extend(
                [
                    _edge(
                        3000 + index * 3,
                        "execution",
                        input_id,
                        "next",
                        call_id,
                        "run",
                    ),
                    _edge(
                        3001 + index * 3,
                        "execution",
                        call_id,
                        "next",
                        return_id,
                        "run",
                    ),
                ]
            )
        else:
            edges.append(
                _edge(
                    3000 + index * 3,
                    "execution",
                    input_id,
                    "next",
                    return_id,
                    "run",
                )
            )
        nodes.append(_node(return_id, "core.function.return"))
        functions.append(_function_graph(graph_id, nodes, edges))
    return functions


def _cached_branch_graph() -> GraphV1:
    return _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(SEQUENCE_ID, "core.flow.sequence"),
            _node(BRANCH_A_ID, "core.logic.branch"),
            _node(BRANCH_B_ID, "core.logic.branch"),
            _node(LEFT_ID, "core.value.numberLiteral", properties={"value": 5}),
            _node(RIGHT_ID, "core.value.numberLiteral", properties={"value": 3}),
            _node(
                COMPARE_ID,
                "core.logic.numberCompare",
                properties={"operator": "greaterThan"},
            ),
        ],
        [
            _edge(1, "execution", START_ID, "next", SEQUENCE_ID, "run"),
            _edge(2, "execution", SEQUENCE_ID, "steps", BRANCH_A_ID, "run"),
            _edge(3, "execution", SEQUENCE_ID, "steps", BRANCH_B_ID, "run"),
            _edge(4, "data", LEFT_ID, "value", COMPARE_ID, "left"),
            _edge(5, "data", RIGHT_ID, "value", COMPARE_ID, "right"),
            _edge(6, "data", COMPARE_ID, "result", BRANCH_A_ID, "condition"),
            _edge(7, "data", COMPARE_ID, "result", BRANCH_B_ID, "condition"),
        ],
    )


def _custom_definition(
    type_key: str,
    runtime_kind: str,
    side_effect: str,
    ports: list[dict[str, object]],
) -> NodeDefinitionV1:
    return NodeDefinitionV1.model_validate(
        {
            "typeKey": type_key,
            "typeVersion": 1,
            "titleKey": f"node.{type_key}.title",
            "descriptionKey": f"node.{type_key}.description",
            "category": "diagnostics",
            "iconKey": "node.variable",
            "runtimeKind": runtime_kind,
            "sideEffect": side_effect,
            "ports": ports,
        }
    )


def _exec_port(port_id: str, direction: str, type_key: str) -> dict[str, object]:
    return {
        "portId": port_id,
        "direction": direction,
        "portKind": "execution",
        "type": {"kind": "exec"},
        "labelKey": f"node.{type_key}.port.{port_id}",
    }


class _FailureRoutingProbeExecutor:
    type_key = "test.failureRoutingProbe"

    def __init__(
        self,
        code: NodeExecutionFailureCode,
        *,
        can_follow_failure_output: bool,
    ) -> None:
        self._code = code
        self._can_follow_failure_output = can_follow_failure_output

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        raise NodeExecutionFailure(
            self._code,
            can_follow_failure_output=self._can_follow_failure_output,
        )


def _failure_routing_registry(
    code: NodeExecutionFailureCode,
    *,
    can_follow_failure_output: bool = False,
    include_persistent_setter: bool = False,
) -> NodeRegistry:
    source = build_phase_4_production_registry()
    type_keys = {
        "core.flow.start",
        "core.flow.stop",
        _FailureRoutingProbeExecutor.type_key,
    }
    if include_persistent_setter:
        type_keys.add("core.variable.setNumber")
    builder = NodeRegistryBuilder(type_keys)
    source_type_keys = ["core.flow.start", "core.flow.stop"]
    if include_persistent_setter:
        source_type_keys.append("core.variable.setNumber")
    for type_key in source_type_keys:
        definition = source.definition(type_key)
        executor = source.executor(type_key)
        assert definition is not None
        assert executor is not None
        builder.register(NodeRegistration(definition, executor))
    builder.register(
        NodeRegistration(
            _custom_definition(
                _FailureRoutingProbeExecutor.type_key,
                "execution",
                "deviceWrite",
                [
                    _exec_port("run", "input", _FailureRoutingProbeExecutor.type_key),
                    _exec_port(
                        "failed", "output", _FailureRoutingProbeExecutor.type_key
                    ),
                ],
            ),
            _FailureRoutingProbeExecutor(
                code,
                can_follow_failure_output=can_follow_failure_output,
            ),
        )
    )
    return builder.build()


def _failure_routing_graph(*, connect_failed: bool) -> GraphV1:
    edges = [_edge(1, "execution", START_ID, "next", ACTION_ID, "run")]
    nodes = [
        _node(START_ID, "core.flow.start"),
        _node(ACTION_ID, _FailureRoutingProbeExecutor.type_key),
    ]
    if connect_failed:
        nodes.append(_node(STOP_ID, "core.flow.stop"))
        edges.append(_edge(2, "execution", ACTION_ID, "failed", STOP_ID, "run"))
    return _graph(nodes, edges)


def _persistent_failure_graph() -> GraphV1:
    return _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(
                VARIABLE_SET_ID,
                "core.variable.setNumber",
                properties={"variableId": str(VARIABLE_NUMBER_ID)},
                input_values={"value": 7.25},
            ),
            _node(ACTION_ID, _FailureRoutingProbeExecutor.type_key),
        ],
        [
            _edge(70, "execution", START_ID, "next", VARIABLE_SET_ID, "run"),
            _edge(71, "execution", VARIABLE_SET_ID, "next", ACTION_ID, "run"),
        ],
        variables=[
            {
                "variableId": str(VARIABLE_NUMBER_ID),
                "name": "persistent-number",
                "valueKind": "number",
                "persistent": True,
            }
        ],
    )


def _persistent_cancellation_graph() -> GraphV1:
    return _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(
                VARIABLE_SET_ID,
                "core.variable.setNumber",
                properties={"variableId": str(VARIABLE_NUMBER_ID)},
                input_values={"value": 8.5},
            ),
            _node(
                VARIABLE_STOP_ID,
                "core.time.delay",
                input_values={"durationMilliseconds": 60_000},
            ),
        ],
        [
            _edge(72, "execution", START_ID, "next", VARIABLE_SET_ID, "run"),
            _edge(73, "execution", VARIABLE_SET_ID, "next", VARIABLE_STOP_ID, "run"),
        ],
        variables=[
            {
                "variableId": str(VARIABLE_NUMBER_ID),
                "name": "persistent-number",
                "valueKind": "number",
                "persistent": True,
            }
        ],
    )


@pytest.mark.asyncio
async def test_confirmed_action_failure_follows_connected_visible_edge() -> None:
    result = await GraphScheduler(
        _failure_routing_graph(connect_failed=True),
        _failure_routing_registry(
            NodeExecutionFailureCode.ACTION_FAILED,
            can_follow_failure_output=True,
        ),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert any(
        event.kind is SchedulerEventKind.NODE_FAILED and event.node_id == ACTION_ID
        for event in result.events
    )
    assert any(
        event.kind is SchedulerEventKind.NODE_COMPLETED and event.node_id == STOP_ID
        for event in result.events
    )


@pytest.mark.asyncio
async def test_confirmed_action_failure_without_edge_remains_terminal() -> None:
    result = await GraphScheduler(
        _failure_routing_graph(connect_failed=False),
        _failure_routing_registry(
            NodeExecutionFailureCode.ACTION_FAILED,
            can_follow_failure_output=True,
        ),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == NodeExecutionFailureCode.ACTION_FAILED.value


@pytest.mark.asyncio
async def test_failed_scheduler_snapshot_retains_dirty_persistent_values() -> None:
    result = await GraphScheduler(
        _persistent_failure_graph(),
        _failure_routing_registry(
            NodeExecutionFailureCode.ACTION_FAILED,
            include_persistent_setter=True,
        ),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert [update.value for update in result.persistent_variable_updates] == [7.25]


@pytest.mark.asyncio
async def test_cancelled_scheduler_snapshot_retains_dirty_persistent_values() -> None:
    cancellation = CancellationScope()
    observer = _RecordingObserver()
    task = asyncio.create_task(
        GraphScheduler(
            _persistent_cancellation_graph(),
            build_phase_4_production_registry(),
            _limits(),
            run_id=RUN_ID,
            cancellation=cancellation,
            observer=observer,
        ).run()
    )
    for _ in range(100):
        await asyncio.sleep(0)
        if ("node.completed", VARIABLE_SET_ID) in observer.records:
            break
    assert ("node.completed", VARIABLE_SET_ID) in observer.records
    cancellation.cancel()
    result = await task

    assert result.status is RunStatus.CANCELLED
    assert [update.value for update in result.persistent_variable_updates] == [8.5]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("code", "expected_status"),
    [
        (NodeExecutionFailureCode.ACTION_FAILED, RunStatus.FAILED),
        (NodeExecutionFailureCode.ACTION_OUTCOME_UNKNOWN, RunStatus.FAILED),
        (NodeExecutionFailureCode.CANCELLED, RunStatus.CANCELLED),
        (NodeExecutionFailureCode.PROPERTY_INVALID, RunStatus.FAILED),
    ],
)
async def test_nonrecoverable_failures_never_follow_failed_edge(
    code: NodeExecutionFailureCode,
    expected_status: RunStatus,
) -> None:
    result = await GraphScheduler(
        _failure_routing_graph(connect_failed=True),
        _failure_routing_registry(code),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is expected_status
    assert result.terminal_error is not None
    assert result.terminal_error.code == code.value
    assert not any(
        event.kind is SchedulerEventKind.NODE_STARTED and event.node_id == STOP_ID
        for event in result.events
    )


def _number_port(port_id: str, direction: str, type_key: str) -> dict[str, object]:
    return {
        "portId": port_id,
        "direction": direction,
        "portKind": "data",
        "type": {"kind": "number"},
        "labelKey": f"node.{type_key}.port.{port_id}",
        **({"required": True} if direction == "input" else {}),
    }


@dataclass
class _ManualClock:
    value: float = 0.0

    def now(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


class _PollingProbeExecutor:
    type_key = "test.pollingProbe"

    def __init__(
        self,
        clock: _ManualClock,
        *,
        match_on_attempt: int | None,
    ) -> None:
        self._clock = clock
        self._match_on_attempt = match_on_attempt
        self.attempts = 0

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        self.attempts += 1
        self._clock.advance(1.0)
        return NodeExecutionResult(
            selected_execution_outputs=(
                "hit" if self.attempts == self._match_on_attempt else "miss",
            )
        )


def _polling_registry(probe: _PollingProbeExecutor) -> NodeRegistry:
    production = build_phase_4_production_registry()
    type_keys = {
        "core.flow.start",
        "core.flow.stop",
        "core.flow.boundedRetry",
        probe.type_key,
    }
    builder = NodeRegistryBuilder(type_keys)
    for type_key in (
        "core.flow.start",
        "core.flow.stop",
        "core.flow.boundedRetry",
    ):
        definition = production.definition(type_key)
        executor = production.executor(type_key)
        assert definition is not None
        assert executor is not None
        builder.register(NodeRegistration(definition, executor))
    builder.register(
        NodeRegistration(
            _custom_definition(
                probe.type_key,
                "execution",
                "none",
                [
                    _exec_port("run", "input", probe.type_key),
                    _exec_port("hit", "output", probe.type_key),
                    _exec_port("miss", "output", probe.type_key),
                ],
            ),
            probe,
        )
    )
    return builder.build()


def _polling_graph() -> GraphV1:
    return _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(
                RETRY_GATE_ID,
                "core.flow.boundedRetry",
                properties={
                    "timeoutMilliseconds": 20_000,
                    "rateLimitMilliseconds": 1_000,
                    "maximumAttempts": 20,
                },
            ),
            _node(POLLING_PROBE_ID, "test.pollingProbe"),
            _node(POLLING_HIT_STOP_ID, "core.flow.stop"),
            _node(POLLING_EXHAUSTED_STOP_ID, "core.flow.stop"),
        ],
        [
            _edge(40, "execution", START_ID, "next", RETRY_GATE_ID, "run"),
            _edge(
                41,
                "execution",
                RETRY_GATE_ID,
                "attempt",
                POLLING_PROBE_ID,
                "run",
            ),
            _edge(
                42,
                "execution",
                RETRY_GATE_ID,
                "exhausted",
                POLLING_EXHAUSTED_STOP_ID,
                "run",
            ),
            _edge(
                43,
                "execution",
                POLLING_PROBE_ID,
                "miss",
                RETRY_GATE_ID,
                "run",
            ),
            _edge(
                44,
                "execution",
                POLLING_PROBE_ID,
                "hit",
                POLLING_HIT_STOP_ID,
                "run",
            ),
        ],
    )


def _variable_cache_graph(*, include_setter: bool) -> GraphV1:
    nodes = [
        _node(START_ID, "core.flow.start"),
        _node(
            VARIABLE_GET_ID,
            "core.variable.getBool",
            properties={"variableId": str(VARIABLE_BOOL_ID)},
        ),
        _node(VARIABLE_FIRST_BRANCH_ID, "core.logic.branch"),
        _node(VARIABLE_SECOND_BRANCH_ID, "core.logic.branch"),
        _node(VARIABLE_STOP_ID, "core.flow.stop"),
    ]
    edges = [
        _edge(50, "execution", START_ID, "next", VARIABLE_FIRST_BRANCH_ID, "run"),
        _edge(
            51,
            "execution",
            VARIABLE_FIRST_BRANCH_ID,
            "whenFalse",
            VARIABLE_SECOND_BRANCH_ID if not include_setter else VARIABLE_SET_ID,
            "run",
        ),
        _edge(
            52,
            "execution",
            VARIABLE_SET_ID if include_setter else VARIABLE_SECOND_BRANCH_ID,
            "next" if include_setter else "whenFalse",
            VARIABLE_SECOND_BRANCH_ID if include_setter else VARIABLE_STOP_ID,
            "run",
        ),
        _edge(
            53,
            "data",
            VARIABLE_GET_ID,
            "value",
            VARIABLE_FIRST_BRANCH_ID,
            "condition",
        ),
        _edge(
            54,
            "data",
            VARIABLE_GET_ID,
            "value",
            VARIABLE_SECOND_BRANCH_ID,
            "condition",
        ),
    ]
    if include_setter:
        nodes.append(
            _node(
                VARIABLE_SET_ID,
                "core.variable.setBool",
                properties={"variableId": str(VARIABLE_BOOL_ID)},
                input_values={"value": True},
            )
        )
        edges.append(
            _edge(
                55,
                "execution",
                VARIABLE_SECOND_BRANCH_ID,
                "whenTrue",
                VARIABLE_STOP_ID,
                "run",
            )
        )
    return _graph(
        nodes,
        edges,
        variables=[
            {
                "variableId": str(VARIABLE_BOOL_ID),
                "name": "ready",
                "valueKind": "bool",
                "persistent": False,
            }
        ],
    )


@pytest.mark.asyncio
async def test_variable_frame_revision_invalidates_pure_getter_cache() -> None:
    registry = build_phase_4_production_registry()
    result = await GraphScheduler(
        _variable_cache_graph(include_setter=True),
        registry,
        _limits(),
        run_id=RUN_ID,
    ).run()

    getter_values = [
        value.value
        for value in result.values
        if value.node_id == VARIABLE_GET_ID and value.port_id == "value"
    ]
    assert result.status is RunStatus.SUCCEEDED
    assert getter_values == [False, True]
    assert result.pure_cache_hits == 0

    fresh_frame_result = await GraphScheduler(
        _variable_cache_graph(include_setter=False),
        registry,
        _limits(),
        run_id=RUN_ID,
    ).run()
    assert fresh_frame_result.status is RunStatus.SUCCEEDED
    assert [
        value.value
        for value in fresh_frame_result.values
        if value.node_id == VARIABLE_GET_ID and value.port_id == "value"
    ] == [False]


@pytest.mark.asyncio
async def test_scheduler_snapshot_contains_dirty_persistent_values_in_graph_order() -> (
    None
):
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(
                VARIABLE_SET_ID,
                "core.variable.setNumber",
                properties={"variableId": str(VARIABLE_NUMBER_ID)},
                input_values={"value": 9.5},
            ),
            _node(VARIABLE_STOP_ID, "core.flow.stop"),
        ],
        [
            _edge(60, "execution", START_ID, "next", VARIABLE_SET_ID, "run"),
            _edge(61, "execution", VARIABLE_SET_ID, "next", VARIABLE_STOP_ID, "run"),
        ],
        variables=[
            {
                "variableId": str(VARIABLE_NUMBER_ID),
                "name": "persistent-number",
                "valueKind": "number",
                "persistent": True,
            }
        ],
    )

    result = await GraphScheduler(
        graph,
        build_phase_4_production_registry(),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert [
        (update.variable_id, update.value_kind.value, update.value)
        for update in result.persistent_variable_updates
    ] == [(VARIABLE_NUMBER_ID, "number", 9.5)]


@pytest.mark.asyncio
async def test_scheduler_order_is_deterministic_and_pure_values_are_cached() -> None:
    graph = _cached_branch_graph()
    registry = build_phase_4_production_registry()

    first = await GraphScheduler(graph, registry, _limits(), run_id=RUN_ID).run()
    second = await GraphScheduler(graph, registry, _limits(), run_id=RUN_ID).run()

    assert first == second
    assert first.status is RunStatus.SUCCEEDED
    assert first.step_count == 7
    assert first.tokens_created == 4
    assert [token.token_id for token in first.tokens] == [1, 2, 3, 4]
    assert [token.parent_token_id for token in first.tokens] == [None, 1, 2, 2]
    assert len(first.activations) == first.step_count
    assert first.pure_cache_hits == 3
    assert [event.sequence for event in first.events] == list(
        range(1, len(first.events) + 1)
    )
    assert [
        event.node_id
        for event in first.events
        if event.kind is SchedulerEventKind.NODE_STARTED
    ] == [
        START_ID,
        SEQUENCE_ID,
        LEFT_ID,
        RIGHT_ID,
        COMPARE_ID,
        BRANCH_A_ID,
        BRANCH_B_ID,
    ]
    assert [
        event.edge_id
        for event in first.events
        if event.kind is SchedulerEventKind.EDGE_TRAVERSED
    ] == [
        UUID("40000000-0000-4000-8000-000000000001"),
        UUID("40000000-0000-4000-8000-000000000002"),
        UUID("40000000-0000-4000-8000-000000000003"),
    ]
    assert [
        (value.node_id, value.port_id, value.generation) for value in first.values
    ] == [
        (LEFT_ID, "value", 1),
        (RIGHT_ID, "value", 1),
        (COMPARE_ID, "result", 1),
        (COMPARE_ID, "relation", 1),
    ]
    assert first.events[-1].kind is SchedulerEventKind.RUN_SUCCEEDED


@pytest.mark.asyncio
async def test_scheduler_supplies_pure_sequence_order_and_runs_that_order() -> None:
    order_node_id = UUID("30000000-0000-4000-8000-000000000021")
    first_node_id = UUID("30000000-0000-4000-8000-000000000022")
    second_node_id = UUID("30000000-0000-4000-8000-000000000023")
    third_node_id = UUID("30000000-0000-4000-8000-000000000024")
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(
                order_node_id,
                "core.flow.sequenceOrder",
                dynamic_port_state={
                    "sequenceStepCount": 3,
                    "sequenceOrder": ["step3", "step1", "step2"],
                },
            ),
            _node(
                SEQUENCE_ID,
                "core.flow.sequence",
                dynamic_port_state={
                    "sequenceStepCount": 3,
                    "sequenceOrder": ["step1", "step2", "step3"],
                },
            ),
            _node(first_node_id, "test.fake.action", input_values={"label": "first"}),
            _node(
                second_node_id,
                "test.fake.action",
                input_values={"label": "second"},
            ),
            _node(third_node_id, "test.fake.action", input_values={"label": "third"}),
        ],
        [
            _edge(1, "execution", START_ID, "next", SEQUENCE_ID, "run"),
            _edge(2, "data", order_node_id, "order", SEQUENCE_ID, "order"),
            _edge(3, "execution", SEQUENCE_ID, "step1", first_node_id, "run"),
            _edge(4, "execution", SEQUENCE_ID, "step2", second_node_id, "run"),
            _edge(5, "execution", SEQUENCE_ID, "step3", third_node_id, "run"),
        ],
    )
    recorder = InMemoryFakeActionRecorder()

    result = await GraphScheduler(
        graph,
        build_phase_4_test_registry(recorder),
        _limits(),
        run_id=RUN_ID,
        device_key="scheduler-device",
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert [record.label for record in recorder.records] == ["third", "first", "second"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("match_on_attempt", "expected_stop", "expected_steps"),
    [
        (None, POLLING_EXHAUSTED_STOP_ID, 43),
        (20, POLLING_HIT_STOP_ID, 42),
    ],
)
async def test_scheduler_runs_bounded_polling_until_timeout_or_boundary_match(
    match_on_attempt: int | None,
    expected_stop: UUID,
    expected_steps: int,
) -> None:
    clock = _ManualClock()
    probe = _PollingProbeExecutor(clock, match_on_attempt=match_on_attempt)

    result = await GraphScheduler(
        _polling_graph(),
        _polling_registry(probe),
        _limits(max_node_steps=100),
        run_id=RUN_ID,
        clock=clock,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert result.step_count == expected_steps
    assert probe.attempts == 20
    started_nodes = [
        event.node_id
        for event in result.events
        if event.kind is SchedulerEventKind.NODE_STARTED
    ]
    assert started_nodes[-1] == expected_stop
    gate_attempt_values = [
        value.value
        for value in result.values
        if value.node_id == RETRY_GATE_ID and value.port_id == "attemptNumber"
    ]
    assert gate_attempt_values[:2] == [1, 2]
    assert gate_attempt_values[-1] == 20
    assert clock.now() == 20.0


@pytest.mark.asyncio
async def test_scheduler_retains_bounded_history_with_global_sequences() -> None:
    clock = _ManualClock()
    probe = _PollingProbeExecutor(clock, match_on_attempt=None)

    result = await GraphScheduler(
        _polling_graph(),
        _polling_registry(probe),
        _limits(
            max_retained_tokens=3,
            max_retained_activations=3,
            max_retained_events=5,
            max_retained_values=4,
        ),
        run_id=RUN_ID,
        clock=clock,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert result.step_count == result.tokens_created == 43
    assert [token.token_id for token in result.tokens] == [41, 42, 43]
    assert [activation.activation_id for activation in result.activations] == [
        41,
        42,
        43,
    ]
    assert len(result.events) == 5
    assert result.events[0].sequence > 1
    assert result.events[-1].kind is SchedulerEventKind.RUN_SUCCEEDED
    assert [value.generation for value in result.values] == [20, 20, 21, 21]


@pytest.mark.asyncio
async def test_scheduler_forwards_task_choice_state_and_traverses_selected_case() -> (
    None
):
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(
                TASK_CHOICE_ID,
                "core.logic.taskChoice",
                properties={"selectedCaseId": "diamond"},
                dynamic_port_state={
                    "taskChoiceCases": [
                        {"caseId": "gold", "portId": "case1", "label": "刷金币"},
                        {
                            "caseId": "diamond",
                            "portId": "case2",
                            "label": "刷钻石",
                        },
                    ]
                },
            ),
            _node(TASK_CHOICE_STOP_ID, "core.flow.stop"),
        ],
        [
            _edge(30, "execution", START_ID, "next", TASK_CHOICE_ID, "run"),
            _edge(
                31,
                "execution",
                TASK_CHOICE_ID,
                "case2",
                TASK_CHOICE_STOP_ID,
                "run",
            ),
        ],
    )

    result = await GraphScheduler(
        graph, build_phase_4_production_registry(), _limits(), run_id=RUN_ID
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert [
        event.node_id
        for event in result.events
        if event.kind is SchedulerEventKind.NODE_STARTED
    ] == [START_ID, TASK_CHOICE_ID, TASK_CHOICE_STOP_ID]
    assert [
        event.edge_id
        for event in result.events
        if event.kind is SchedulerEventKind.EDGE_TRAVERSED
    ] == [
        UUID("40000000-0000-4000-8000-000000000030"),
        UUID("40000000-0000-4000-8000-000000000031"),
    ]


@pytest.mark.asyncio
async def test_scheduler_routes_task_choice_selected_case_into_number_overlay() -> None:
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(
                TASK_CHOICE_ID,
                "core.logic.taskChoice",
                properties={"selectedCaseId": "gold"},
                dynamic_port_state={
                    "taskChoiceCases": [
                        {"caseId": "gold", "portId": "case1", "label": "Gold"},
                        {"caseId": "silver", "portId": "case2", "label": "Silver"},
                    ]
                },
            ),
            _node(
                OVERLAY_ID,
                "core.logic.caseOverlayNumber",
                dynamic_port_state={
                    "taskChoiceCases": [
                        {"caseId": "gold", "portId": "case1", "label": "Gold"},
                        {"caseId": "silver", "portId": "case2", "label": "Silver"},
                    ]
                },
            ),
            _node(
                OVERLAY_FALLBACK_ID,
                "core.value.numberLiteral",
                properties={"value": 1},
            ),
            _node(
                OVERLAY_CASE_ID,
                "core.value.numberLiteral",
                properties={"value": 5},
            ),
            _node(
                OVERLAY_COMPARE_ID,
                "core.logic.numberCompare",
                properties={"operator": "greaterThanOrEqual"},
            ),
            _node(OVERLAY_BRANCH_ID, "core.logic.branch"),
            _node(OVERLAY_STOP_ID, "core.flow.stop"),
        ],
        [
            _edge(50, "execution", START_ID, "next", TASK_CHOICE_ID, "run"),
            _edge(51, "execution", TASK_CHOICE_ID, "case1", OVERLAY_BRANCH_ID, "run"),
            _edge(
                52,
                "execution",
                OVERLAY_BRANCH_ID,
                "whenTrue",
                OVERLAY_STOP_ID,
                "run",
            ),
            _edge(
                53,
                "data",
                TASK_CHOICE_ID,
                "selectedCaseId",
                OVERLAY_ID,
                "selectedCaseId",
            ),
            _edge(54, "data", OVERLAY_FALLBACK_ID, "value", OVERLAY_ID, "fallback"),
            _edge(55, "data", OVERLAY_CASE_ID, "value", OVERLAY_ID, "case1"),
            _edge(56, "data", OVERLAY_ID, "value", OVERLAY_COMPARE_ID, "left"),
            _edge(
                57,
                "data",
                OVERLAY_FALLBACK_ID,
                "value",
                OVERLAY_COMPARE_ID,
                "right",
            ),
            _edge(
                58,
                "data",
                OVERLAY_COMPARE_ID,
                "result",
                OVERLAY_BRANCH_ID,
                "condition",
            ),
        ],
    )

    result = await GraphScheduler(
        graph, build_phase_4_production_registry(), _limits(), run_id=RUN_ID
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert any(
        value.node_id == OVERLAY_ID and value.port_id == "value" and value.value == 5
        for value in result.values
    )
    assert any(
        event.kind is SchedulerEventKind.NODE_COMPLETED
        and event.node_id == OVERLAY_STOP_ID
        for event in result.events
    )


class _CounterProducerExecutor:
    type_key = "test.counter.producer"

    def __init__(self) -> None:
        self.count = 0

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        self.count += 1
        return NodeExecutionResult(
            outputs={"value": self.count},
            selected_execution_outputs=("next",),
        )


class _DoubleExecutor:
    type_key = "test.counter.double"

    def __init__(self) -> None:
        self.count = 0

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        self.count += 1
        return NodeExecutionResult(
            outputs={"doubled": context.require_number("value") * 2}
        )


class _ValueConsumerExecutor:
    type_key = "test.counter.consumer"

    def __init__(self) -> None:
        self.values: list[float] = []

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        self.values.append(context.require_number("value"))
        return NodeExecutionResult()


class _ConcurrentProbeExecutor:
    type_key = "test.concurrent.probe"

    def __init__(self) -> None:
        self.active = 0
        self.maximum_active = 0
        self.both_started = asyncio.Event()

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        self.active += 1
        self.maximum_active = max(self.maximum_active, self.active)
        if self.active == 2:
            self.both_started.set()
        await asyncio.wait_for(self.both_started.wait(), timeout=1)
        self.active -= 1
        return NodeExecutionResult()


@pytest.mark.asyncio
async def test_parallel_node_starts_two_direct_successors_concurrently() -> None:
    probe_type = _ConcurrentProbeExecutor.type_key
    source = build_phase_4_production_registry()
    builder = NodeRegistryBuilder({"core.flow.start", "core.flow.parallel", probe_type})
    for type_key in ("core.flow.start", "core.flow.parallel"):
        definition = source.definition(type_key)
        executor = source.executor(type_key)
        assert definition is not None
        assert executor is not None
        builder.register(NodeRegistration(definition, executor))
    probe = _ConcurrentProbeExecutor()
    builder.register(
        NodeRegistration(
            _custom_definition(
                probe_type,
                "execution",
                "runtime",
                [_exec_port("run", "input", probe_type)],
            ),
            probe,
        )
    )
    parallel_id = UUID("30000000-0000-4000-8000-000000000020")
    first_id = UUID("30000000-0000-4000-8000-000000000021")
    second_id = UUID("30000000-0000-4000-8000-000000000022")
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(parallel_id, "core.flow.parallel"),
            _node(first_id, probe_type),
            _node(second_id, probe_type),
        ],
        [
            _edge(1, "execution", START_ID, "next", parallel_id, "run"),
            _edge(2, "execution", parallel_id, "branch1", first_id, "run"),
            _edge(3, "execution", parallel_id, "branch2", second_id, "run"),
        ],
    )

    result = await GraphScheduler(
        graph,
        builder.build(),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert probe.maximum_active == 2


class _EndPathSiblingProbeExecutor:
    type_key = "test.endPath.siblingProbe"

    def __init__(self) -> None:
        self.calls: list[UUID] = []

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        self.calls.append(context.node_id)
        return NodeExecutionResult(selected_execution_outputs=("next",))


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("scope", "expected_probe_calls"),
    [("current", 2), ("all", 1)],
)
async def test_end_path_scope_controls_parallel_sibling_successors(
    scope: str, expected_probe_calls: int
) -> None:
    source = build_phase_4_production_registry()
    probe = _EndPathSiblingProbeExecutor()
    allowed = {
        "core.flow.start",
        "core.flow.parallel",
        "core.flow.endPath",
        probe.type_key,
    }
    builder = NodeRegistryBuilder(allowed)
    for type_key in ("core.flow.start", "core.flow.parallel", "core.flow.endPath"):
        definition = source.definition(type_key)
        executor = source.executor(type_key)
        assert definition is not None
        assert executor is not None
        builder.register(NodeRegistration(definition, executor))
    builder.register(
        NodeRegistration(
            _custom_definition(
                probe.type_key,
                "execution",
                "runtime",
                [
                    _exec_port("run", "input", probe.type_key),
                    _exec_port("next", "output", probe.type_key),
                ],
            ),
            probe,
        )
    )

    parallel_id = UUID("30000000-0000-4000-8000-000000000030")
    end_path_id = UUID("30000000-0000-4000-8000-000000000031")
    first_probe_id = UUID("30000000-0000-4000-8000-000000000032")
    second_probe_id = UUID("30000000-0000-4000-8000-000000000033")
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(parallel_id, "core.flow.parallel"),
            _node(end_path_id, "core.flow.endPath", properties={"scope": scope}),
            _node(first_probe_id, probe.type_key),
            _node(second_probe_id, probe.type_key),
        ],
        [
            _edge(10, "execution", START_ID, "next", parallel_id, "run"),
            _edge(11, "execution", parallel_id, "branch1", end_path_id, "run"),
            _edge(12, "execution", parallel_id, "branch2", first_probe_id, "run"),
            _edge(13, "execution", first_probe_id, "next", second_probe_id, "run"),
        ],
    )

    result = await GraphScheduler(
        graph,
        builder.build(),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    expected_calls = (
        [first_probe_id, second_probe_id] if scope == "current" else [first_probe_id]
    )
    assert probe.calls == expected_calls
    assert len(probe.calls) == expected_probe_calls


@pytest.mark.asyncio
async def test_pure_cache_invalidates_when_upstream_generation_changes() -> None:
    producer_type = "test.counter.producer"
    double_type = "test.counter.double"
    consumer_type = "test.counter.consumer"
    source = build_phase_4_production_registry()
    producer = _CounterProducerExecutor()
    double = _DoubleExecutor()
    consumer = _ValueConsumerExecutor()
    allowed = {
        "core.flow.start",
        "core.flow.sequence",
        "core.diagnostic.log",
        producer_type,
        double_type,
        consumer_type,
    }
    builder = NodeRegistryBuilder(allowed)
    for type_key in (
        "core.flow.start",
        "core.flow.sequence",
        "core.diagnostic.log",
    ):
        definition = source.definition(type_key)
        executor = source.executor(type_key)
        assert definition is not None
        assert executor is not None
        builder.register(NodeRegistration(definition, executor))
    builder.register(
        NodeRegistration(
            _custom_definition(
                producer_type,
                "execution",
                "runtime",
                [
                    _exec_port("run", "input", producer_type),
                    _number_port("value", "output", producer_type),
                    _exec_port("next", "output", producer_type),
                ],
            ),
            producer,
        )
    )
    builder.register(
        NodeRegistration(
            _custom_definition(
                double_type,
                "pure",
                "none",
                [
                    _number_port("value", "input", double_type),
                    _number_port("doubled", "output", double_type),
                ],
            ),
            double,
        )
    )
    builder.register(
        NodeRegistration(
            _custom_definition(
                consumer_type,
                "execution",
                "diagnostic",
                [
                    _exec_port("run", "input", consumer_type),
                    _number_port("value", "input", consumer_type),
                ],
            ),
            consumer,
        )
    )
    intermediate_id = UUID("30000000-0000-4000-8000-000000000010")
    producer_id = UUID("30000000-0000-4000-8000-000000000011")
    double_id = UUID("30000000-0000-4000-8000-000000000012")
    consumer_id = UUID("30000000-0000-4000-8000-000000000013")
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(SEQUENCE_ID, "core.flow.sequence"),
            _node(
                intermediate_id,
                "core.diagnostic.log",
                input_values={"message": "second path"},
            ),
            _node(producer_id, producer_type),
            _node(double_id, double_type),
            _node(consumer_id, consumer_type),
        ],
        [
            _edge(1, "execution", START_ID, "next", SEQUENCE_ID, "run"),
            _edge(2, "execution", SEQUENCE_ID, "steps", producer_id, "run"),
            _edge(3, "execution", SEQUENCE_ID, "steps", intermediate_id, "run"),
            _edge(4, "execution", intermediate_id, "next", producer_id, "run"),
            _edge(5, "execution", producer_id, "next", consumer_id, "run"),
            _edge(6, "data", producer_id, "value", double_id, "value"),
            _edge(7, "data", double_id, "doubled", consumer_id, "value"),
        ],
    )

    observer = _RecordingObserver()
    result = await GraphScheduler(
        graph,
        builder.build(),
        _limits(max_retained_values=2, max_retained_logs=0),
        run_id=RUN_ID,
        observer=observer,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert producer.count == 2
    assert double.count == 2
    assert consumer.values == [2.0, 4.0]
    assert [(value.node_id, value.generation) for value in result.values] == [
        (producer_id, 2),
        (double_id, 2),
    ]
    assert result.logs == ()
    assert ("logs.committed", intermediate_id) in observer.records


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("limits", "expected_code"),
    [
        (_limits(max_node_steps=2), SchedulerFailureCode.STEP_LIMIT),
        (_limits(max_queue_size=1), SchedulerFailureCode.QUEUE_LIMIT),
        (_limits(max_stored_values=1), SchedulerFailureCode.VALUE_LIMIT),
        (_limits(max_events=4), SchedulerFailureCode.EVENT_LIMIT),
    ],
)
async def test_scheduler_limits_fail_with_stable_terminal_codes(
    limits: SchedulerLimits, expected_code: SchedulerFailureCode
) -> None:
    result = await GraphScheduler(
        _cached_branch_graph(),
        build_phase_4_production_registry(),
        limits,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == expected_code.value
    assert result.events[-1].kind is SchedulerEventKind.RUN_FAILED
    assert len(result.events) <= limits.max_events


@pytest.mark.asyncio
async def test_value_limit_does_not_partially_commit_one_node_result() -> None:
    result = await GraphScheduler(
        _cached_branch_graph(),
        build_phase_4_production_registry(),
        _limits(max_stored_values=3),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.VALUE_LIMIT.value
    assert [(value.node_id, value.port_id) for value in result.values] == [
        (LEFT_ID, "value"),
        (RIGHT_ID, "value"),
    ]


class _CancelledProbe:
    def raise_if_cancelled(self) -> None:
        raise NodeExecutionFailure(NodeExecutionFailureCode.CANCELLED)


@pytest.mark.asyncio
async def test_pre_dispatch_cancellation_is_a_distinct_terminal_state() -> None:
    result = await GraphScheduler(
        _cached_branch_graph(),
        build_phase_4_production_registry(),
        _limits(),
        run_id=RUN_ID,
        cancellation=_CancelledProbe(),
    ).run()

    assert result.status is RunStatus.CANCELLED
    assert result.step_count == 0
    assert result.tokens_created == 0
    assert result.terminal_error is not None
    assert result.terminal_error.code == NodeExecutionFailureCode.CANCELLED.value
    assert [event.kind for event in result.events] == [
        SchedulerEventKind.RUN_STARTED,
        SchedulerEventKind.RUN_CANCELLED,
    ]


@pytest.mark.asyncio
async def test_cancellation_during_delay_is_a_distinct_terminal_state() -> None:
    delay_id = UUID("30000000-0000-4000-8000-000000000020")
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(
                delay_id,
                "core.time.delay",
                input_values={"durationMilliseconds": 60_000},
            ),
        ],
        [_edge(1, "execution", START_ID, "next", delay_id, "run")],
    )
    scope = CancellationScope()
    run_task = asyncio.create_task(
        GraphScheduler(
            graph,
            build_phase_4_production_registry(),
            _limits(),
            run_id=RUN_ID,
            cancellation=scope,
        ).run()
    )
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    scope.cancel()
    result = await asyncio.wait_for(run_task, timeout=0.5)

    assert result.status is RunStatus.CANCELLED
    assert result.terminal_error is not None
    assert result.terminal_error.code == NodeExecutionFailureCode.CANCELLED.value
    assert result.events[-1].kind is SchedulerEventKind.RUN_CANCELLED


@dataclass(slots=True)
class _FakeClock:
    value: float = 100.0

    def now(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


class _AdvancingStartExecutor:
    type_key = "core.flow.start"

    def __init__(self, clock: _FakeClock) -> None:
        self._clock = clock

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        self._clock.advance(2.0)
        return NodeExecutionResult()


class _CancellingFunctionExecutor:
    type_key = "test.function.cancel"

    def __init__(self, scope: CancellationScope, clock: _FakeClock) -> None:
        self._scope = scope
        self._clock = clock

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        self._clock.advance(1.0)
        self._scope.cancel()
        context.cancellation.raise_if_cancelled()
        return NodeExecutionResult()


class _AdvancingFunctionExecutor:
    type_key = "test.function.advance"

    def __init__(self, clock: _FakeClock) -> None:
        self._clock = clock

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        self._clock.advance(3.0)
        return NodeExecutionResult(selected_execution_outputs=("next",))


def _two_call_entry(
    entry_id: UUID,
    first_call_id: UUID,
    second_call_id: UUID,
    target_id: UUID,
    stop_id: UUID,
) -> GraphV1:
    start_id = _function_id(entry_id.int % 100_000 + 7000)
    return _entry_graph(
        entry_id,
        [
            _node(start_id, "core.flow.start"),
            _node(
                first_call_id,
                "core.function.call",
                properties={"functionGraphId": str(target_id)},
            ),
            _node(
                second_call_id,
                "core.function.call",
                properties={"functionGraphId": str(target_id)},
            ),
            _node(stop_id, "core.flow.stop"),
        ],
        [
            _edge(7001, "execution", start_id, "next", first_call_id, "run"),
            _edge(7002, "execution", first_call_id, "next", second_call_id, "run"),
            _edge(7003, "execution", second_call_id, "next", stop_id, "run"),
        ],
    )


def _number_return_function(function_id: UUID) -> GraphV1:
    input_id = _function_id(function_id.int % 100_000 + 7100)
    literal_id = _function_id(function_id.int % 100_000 + 7200)
    return_id = _function_id(function_id.int % 100_000 + 7300)
    return _function_graph(
        function_id,
        [
            _node(input_id, "core.function.input"),
            _node(literal_id, "core.value.numberLiteral", properties={"value": 8}),
            _node(return_id, "core.function.return"),
        ],
        [
            _edge(7101, "execution", input_id, "next", return_id, "run"),
            _edge(7102, "data", literal_id, "value", return_id, "result"),
        ],
        outputs=[("result", "number")],
    )


def _logged_function(function_id: UUID) -> GraphV1:
    input_id = _function_id(function_id.int % 100_000 + 7400)
    literal_id = _function_id(function_id.int % 100_000 + 7500)
    log_id = _function_id(function_id.int % 100_000 + 7600)
    return_id = _function_id(function_id.int % 100_000 + 7700)
    return _function_graph(
        function_id,
        [
            _node(input_id, "core.function.input"),
            _node(log_id, "core.diagnostic.log", input_values={"message": "child"}),
            _node(literal_id, "core.value.numberLiteral", properties={"value": 8}),
            _node(return_id, "core.function.return"),
        ],
        [
            _edge(7401, "execution", input_id, "next", log_id, "run"),
            _edge(7402, "execution", log_id, "next", return_id, "run"),
            _edge(7403, "data", literal_id, "value", return_id, "result"),
        ],
        outputs=[("result", "number")],
    )


@pytest.mark.asyncio
async def test_wall_clock_limit_is_checked_after_executor_return() -> None:
    clock = _FakeClock()
    source_registry = build_phase_4_production_registry()
    start_definition = source_registry.definition("core.flow.start")
    assert start_definition is not None
    builder = NodeRegistryBuilder({"core.flow.start"})
    builder.register(NodeRegistration(start_definition, _AdvancingStartExecutor(clock)))
    graph = _graph([_node(START_ID, "core.flow.start")], [])

    result = await GraphScheduler(
        graph,
        builder.build(),
        _limits(max_duration_seconds=1.0),
        run_id=RUN_ID,
        clock=clock,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.TIME_LIMIT.value
    assert any(event.kind is SchedulerEventKind.NODE_FAILED for event in result.events)


@pytest.mark.asyncio
async def test_terminal_node_clears_already_queued_sibling_tokens() -> None:
    recorder = InMemoryFakeActionRecorder()
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(SEQUENCE_ID, "core.flow.sequence"),
            _node(STOP_ID, "core.flow.stop"),
            _node(ACTION_ID, "test.fake.action", input_values={"label": "late"}),
        ],
        [
            _edge(1, "execution", START_ID, "next", SEQUENCE_ID, "run"),
            _edge(2, "execution", SEQUENCE_ID, "steps", STOP_ID, "run"),
            _edge(3, "execution", SEQUENCE_ID, "steps", ACTION_ID, "run"),
        ],
    )

    result = await GraphScheduler(
        graph,
        build_phase_4_test_registry(recorder),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert result.tokens_created == 4
    assert result.step_count == 3
    assert recorder.records == ()


@pytest.mark.asyncio
async def test_scheduler_passes_run_bound_device_to_action_executor() -> None:
    recorder = InMemoryFakeActionRecorder()
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(ACTION_ID, "test.fake.action", input_values={"label": "bound"}),
        ],
        [_edge(1, "execution", START_ID, "next", ACTION_ID, "run")],
    )

    result = await GraphScheduler(
        graph,
        build_phase_4_test_registry(recorder),
        _limits(),
        run_id=RUN_ID,
        device_key="run-device",
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert len(recorder.records) == 1
    assert recorder.records[0].device_key == "run-device"


class _CorrelationExecutor:
    type_key = "test.operation.correlation"

    def __init__(self) -> None:
        self.context: NodeExecutionContext | None = None

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        self.context = context
        return NodeExecutionResult()


@pytest.mark.asyncio
async def test_scheduler_passes_request_run_node_and_activation_correlation() -> None:
    executor = _CorrelationExecutor()
    production = build_phase_4_production_registry()
    start_definition = production.definition("core.flow.start")
    start_executor = production.executor("core.flow.start")
    assert start_definition is not None
    assert start_executor is not None
    builder = NodeRegistryBuilder({"core.flow.start", executor.type_key})
    builder.register(NodeRegistration(start_definition, start_executor))
    builder.register(
        NodeRegistration(
            _custom_definition(
                executor.type_key,
                "execution",
                "runtime",
                [_exec_port("run", "input", executor.type_key)],
            ),
            executor,
        )
    )
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(ACTION_ID, executor.type_key),
        ],
        [_edge(1, "execution", START_ID, "next", ACTION_ID, "run")],
    )

    result = await GraphScheduler(
        graph,
        builder.build(),
        _limits(),
        request_id=REQUEST_ID,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert executor.context is not None
    correlation = executor.context.operation_correlation()
    assert correlation.request_id == REQUEST_ID
    assert correlation.run_id == RUN_ID
    assert correlation.node_id == ACTION_ID
    assert correlation.activation_id is not None
    assert correlation.activation_id > 0


class _LoopProbeExecutor:
    type_key = "test.loop.probe"

    def __init__(self, match_on_attempt: int) -> None:
        self.match_on_attempt = match_on_attempt
        self.attempts = 0

    async def execute(self, context: NodeExecutionContext) -> NodeExecutionResult:
        context.cancellation.raise_if_cancelled()
        self.attempts += 1
        return NodeExecutionResult(
            outputs={"matched": self.attempts >= self.match_on_attempt},
            selected_execution_outputs=("next",),
        )


def _loop_registry(probe: _LoopProbeExecutor) -> NodeRegistry:
    production = build_phase_4_production_registry()
    type_keys = {
        "core.flow.start",
        "core.flow.stop",
        "core.logic.branch",
        probe.type_key,
    }
    builder = NodeRegistryBuilder(type_keys)
    for type_key in type_keys - {probe.type_key}:
        definition = production.definition(type_key)
        executor = production.executor(type_key)
        assert definition is not None
        assert executor is not None
        builder.register(NodeRegistration(definition, executor))
    builder.register(
        NodeRegistration(
            _custom_definition(
                probe.type_key,
                "execution",
                "runtime",
                [
                    _exec_port("run", "input", probe.type_key),
                    {
                        "portId": "matched",
                        "direction": "output",
                        "portKind": "data",
                        "type": {"kind": "bool"},
                        "labelKey": f"node.{probe.type_key}.port.matched",
                    },
                    _exec_port("next", "output", probe.type_key),
                ],
            ),
            probe,
        )
    )
    return builder.build()


def _loop_graph() -> GraphV1:
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(ACTION_ID, _LoopProbeExecutor.type_key),
            _node(BRANCH_A_ID, "core.logic.branch"),
            _node(STOP_ID, "core.flow.stop"),
        ],
        [
            _edge(1, "execution", START_ID, "next", ACTION_ID, "run"),
            _edge(2, "execution", ACTION_ID, "next", BRANCH_A_ID, "run"),
            _edge(3, "data", ACTION_ID, "matched", BRANCH_A_ID, "condition"),
            _edge(4, "execution", BRANCH_A_ID, "whenFalse", ACTION_ID, "run"),
            _edge(5, "execution", BRANCH_A_ID, "whenTrue", STOP_ID, "run"),
        ],
    )
    return graph


@pytest.mark.asyncio
async def test_execution_loop_repeats_until_the_condition_selects_its_exit() -> None:
    probe = _LoopProbeExecutor(match_on_attempt=3)

    result = await GraphScheduler(
        _loop_graph(),
        _loop_registry(probe),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert probe.attempts == 3
    assert result.step_count == 8
    assert result.terminal_error is None


@pytest.mark.asyncio
async def test_non_terminating_execution_loop_is_stopped_by_the_step_limit() -> None:
    probe = _LoopProbeExecutor(match_on_attempt=100)

    result = await GraphScheduler(
        _loop_graph(),
        _loop_registry(probe),
        _limits(max_node_steps=7),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.STEP_LIMIT.value


@pytest.mark.asyncio
async def test_breakpoints_fail_explicitly_until_debug_control_is_connected() -> None:
    graph = _graph([_node(START_ID, "core.flow.start", breakpoint=True)], [])

    result = await GraphScheduler(
        graph,
        build_phase_4_production_registry(),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert (
        result.terminal_error.code == SchedulerFailureCode.BREAKPOINT_UNSUPPORTED.value
    )
    assert result.terminal_error.node_id == START_ID


@pytest.mark.asyncio
async def test_log_results_are_ordered_and_bounded() -> None:
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(
                ACTION_ID,
                "core.diagnostic.log",
                input_values={"message": "scheduler message"},
            ),
        ],
        [_edge(1, "execution", START_ID, "next", ACTION_ID, "run")],
    )
    result = await GraphScheduler(
        graph,
        build_phase_4_production_registry(),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert len(result.logs) == 1
    assert result.logs[0].sequence == 1
    assert result.logs[0].node_id == ACTION_ID
    assert result.logs[0].message == "scheduler message"

    limited = await GraphScheduler(
        graph,
        build_phase_4_production_registry(),
        _limits(max_stored_logs=0),
        run_id=RUN_ID,
    ).run()
    assert limited.status is RunStatus.FAILED
    assert limited.terminal_error is not None
    assert limited.terminal_error.code == SchedulerFailureCode.LOG_LIMIT.value


@pytest.mark.asyncio
async def test_observer_sees_atomic_commits_before_completion_and_terminal_last() -> (
    None
):
    value_observer = _RecordingObserver()

    value_result = await GraphScheduler(
        _cached_branch_graph(),
        build_phase_4_production_registry(),
        _limits(),
        run_id=RUN_ID,
        observer=value_observer,
    ).run()

    assert value_result.status is RunStatus.SUCCEEDED
    left_values = value_observer.records.index(("values.committed", LEFT_ID))
    left_completed = value_observer.records.index(("node.completed", LEFT_ID))
    assert left_values < left_completed
    assert value_observer.records[-1] == ("run.succeeded", None)

    log_observer = _RecordingObserver()
    log_graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(
                ACTION_ID,
                "core.diagnostic.log",
                input_values={"message": "observer message"},
            ),
        ],
        [_edge(1, "execution", START_ID, "next", ACTION_ID, "run")],
    )

    log_result = await GraphScheduler(
        log_graph,
        build_phase_4_production_registry(),
        _limits(),
        run_id=RUN_ID,
        observer=log_observer,
    ).run()

    assert log_result.status is RunStatus.SUCCEEDED
    logs_committed = log_observer.records.index(("logs.committed", ACTION_ID))
    log_completed = log_observer.records.index(("node.completed", ACTION_ID))
    assert logs_committed < log_completed
    assert log_observer.records[-1] == ("run.succeeded", None)


@pytest.mark.asyncio
async def test_missing_required_input_fails_before_executor_dispatch() -> None:
    graph = _graph(
        [
            _node(START_ID, "core.flow.start"),
            _node(BRANCH_A_ID, "core.logic.branch"),
        ],
        [_edge(1, "execution", START_ID, "next", BRANCH_A_ID, "run")],
    )

    result = await GraphScheduler(
        graph,
        build_phase_4_production_registry(),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.INPUT_UNAVAILABLE.value
    assert result.terminal_error.node_id == BRANCH_A_ID
    assert result.terminal_error.port_id == "condition"
    assert not any(
        event.kind is SchedulerEventKind.NODE_STARTED and event.node_id == BRANCH_A_ID
        for event in result.events
    )


def test_limits_reject_zero_non_finite_and_missing_terminal_capacity() -> None:
    with pytest.raises(ValueError, match="positive"):
        _limits(max_node_steps=0)
    with pytest.raises(ValueError, match="finite"):
        _limits(max_duration_seconds=float("inf"))
    with pytest.raises(ValueError, match="terminal"):
        _limits(max_events=1)
    with pytest.raises(ValueError, match="retained-history"):
        _limits(max_retained_events=0)
    with pytest.raises(ValueError, match="cannot exceed"):
        _limits(max_events=10, max_retained_events=11)


@pytest.mark.parametrize(
    ("value_kind", "value"),
    [
        ("bool", True),
        ("number", 12.5),
        ("string", "function value"),
        ("point", RuntimePoint(3, 4)),
        ("rect", RuntimeRect(1, 2, 30, 40)),
        (
            "imageRef",
            RuntimeImageReference("function-image", 100, 80, "screen", 1, 999.0),
        ),
    ],
)
@pytest.mark.asyncio
async def test_function_input_and_return_preserve_all_value_kinds(
    value_kind: str,
    value: object,
) -> None:
    function_id = _function_id(1000)
    input_node_id = _function_id(1001)
    return_node_id = _function_id(1002)
    function = _function_graph(
        function_id,
        [
            _node(input_node_id, "core.function.input"),
            _node(return_node_id, "core.function.return"),
        ],
        [
            _edge(1001, "execution", input_node_id, "next", return_node_id, "run"),
            _edge(1002, "data", input_node_id, "arg", return_node_id, "result"),
        ],
        inputs=[("arg", value_kind)],
        outputs=[("result", value_kind)],
    )
    entry = _caller_graph(
        _function_id(1003),
        _function_id(1004),
        function_id,
        _function_id(1005),
    )
    document = _function_document(entry, [function])

    result = await GraphScheduler(
        function,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        function_inputs={"arg": value},
        function_depth=1,
        call_chain=(function_id,),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert result.function_return_values == (("result", value),)


@pytest.mark.asyncio
async def test_function_call_is_atomic_and_returns_to_parent_next() -> None:
    function_id = _function_id(1100)
    function_input_id = _function_id(1101)
    function_return_id = _function_id(1102)
    call_id = _function_id(1103)
    stop_id = _function_id(1104)
    function = _function_graph(
        function_id,
        [
            _node(function_input_id, "core.function.input"),
            _node(function_return_id, "core.function.return"),
        ],
        [
            _edge(
                1101, "execution", function_input_id, "next", function_return_id, "run"
            ),
            _edge(1102, "data", function_input_id, "arg", function_return_id, "result"),
        ],
        inputs=[("arg", "bool")],
        outputs=[("result", "bool")],
    )
    entry = _caller_graph(
        _function_id(1105),
        call_id,
        function_id,
        stop_id,
        input_values={"arg": True},
    )
    document = _function_document(entry, [function])

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert [
        event.node_id
        for event in result.events
        if event.kind is SchedulerEventKind.NODE_STARTED
    ] == [_function_id(901), call_id, stop_id]
    assert [value.value for value in result.values if value.node_id == call_id] == [
        True
    ]


@pytest.mark.asyncio
async def test_function_empty_signature_and_nested_call_accumulate_snapshot_usage() -> (
    None
):
    function_b_id = _function_id(1200)
    function_a_id = _function_id(1210)
    b_input_id = _function_id(1201)
    b_literal_id = _function_id(1202)
    b_return_id = _function_id(1203)
    a_input_id = _function_id(1211)
    a_call_id = _function_id(1212)
    a_return_id = _function_id(1213)
    entry_call_id = _function_id(1220)
    entry_stop_id = _function_id(1221)
    function_b = _function_graph(
        function_b_id,
        [
            _node(b_input_id, "core.function.input"),
            _node(b_literal_id, "core.value.numberLiteral", properties={"value": 8}),
            _node(b_return_id, "core.function.return"),
        ],
        [
            _edge(1201, "execution", b_input_id, "next", b_return_id, "run"),
            _edge(1202, "data", b_literal_id, "value", b_return_id, "result"),
        ],
        outputs=[("result", "number")],
    )
    function_a = _function_graph(
        function_a_id,
        [
            _node(a_input_id, "core.function.input"),
            _node(
                a_call_id,
                "core.function.call",
                properties={"functionGraphId": str(function_b_id)},
            ),
            _node(a_return_id, "core.function.return"),
        ],
        [
            _edge(1211, "execution", a_input_id, "next", a_call_id, "run"),
            _edge(1212, "execution", a_call_id, "next", a_return_id, "run"),
            _edge(1213, "data", a_call_id, "result", a_return_id, "result"),
        ],
        outputs=[("result", "number")],
    )
    entry = _caller_graph(
        _function_id(1230),
        entry_call_id,
        function_a_id,
        entry_stop_id,
    )
    document = _function_document(entry, [function_a, function_b])

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert [
        value.value for value in result.values if value.node_id == entry_call_id
    ] == [8.0]
    assert result.step_count >= 8
    assert result.tokens_created >= 8
    assert result.stored_value_count == 3
    assert result.stored_value_count > len(result.values)


@pytest.mark.asyncio
async def test_function_local_variable_frame_is_fresh_for_each_call() -> None:
    function_id = _function_id(1300)
    input_id = _function_id(1301)
    setter_id = _function_id(1302)
    getter_id = _function_id(1303)
    return_id = _function_id(1304)
    call_one_id = _function_id(1310)
    call_two_id = _function_id(1311)
    stop_id = _function_id(1312)
    variable_id = _function_id(1320)
    function = _function_graph(
        function_id,
        [
            _node(input_id, "core.function.input"),
            _node(
                setter_id,
                "core.variable.setNumber",
                properties={"variableId": str(variable_id)},
                input_values={"value": 7},
            ),
            _node(
                getter_id,
                "core.variable.getNumber",
                properties={"variableId": str(variable_id)},
            ),
            _node(return_id, "core.function.return"),
        ],
        [
            _edge(1301, "execution", input_id, "next", setter_id, "run"),
            _edge(1302, "execution", setter_id, "next", return_id, "run"),
            _edge(1303, "data", getter_id, "value", return_id, "result"),
        ],
        outputs=[("result", "number")],
        variables=[
            {
                "variableId": str(variable_id),
                "name": "local-number",
                "valueKind": "number",
                "persistent": False,
            }
        ],
    )
    entry = _entry_graph(
        _function_id(1330),
        [
            _node(_function_id(1331), "core.flow.start"),
            _node(
                call_one_id,
                "core.function.call",
                properties={"functionGraphId": str(function_id)},
            ),
            _node(
                call_two_id,
                "core.function.call",
                properties={"functionGraphId": str(function_id)},
            ),
            _node(stop_id, "core.flow.stop"),
        ],
        [
            _edge(1331, "execution", _function_id(1331), "next", call_one_id, "run"),
            _edge(1332, "execution", call_one_id, "next", call_two_id, "run"),
            _edge(1333, "execution", call_two_id, "next", stop_id, "run"),
        ],
    )
    document = _function_document(entry, [function])

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert [
        value.value
        for value in result.values
        if value.node_id in {call_one_id, call_two_id}
    ] == [7.0, 7.0]


@pytest.mark.asyncio
async def test_function_log_is_attached_once_to_parent_call() -> None:
    function_id = _function_id(1400)
    input_id = _function_id(1401)
    log_id = _function_id(1402)
    return_id = _function_id(1403)
    call_id = _function_id(1410)
    stop_id = _function_id(1411)
    function = _function_graph(
        function_id,
        [
            _node(input_id, "core.function.input"),
            _node(log_id, "core.diagnostic.log", input_values={"message": "child log"}),
            _node(return_id, "core.function.return"),
        ],
        [
            _edge(1401, "execution", input_id, "next", log_id, "run"),
            _edge(1402, "execution", log_id, "next", return_id, "run"),
        ],
    )
    entry = _caller_graph(_function_id(1412), call_id, function_id, stop_id)
    document = _function_document(entry, [function])

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert len(result.logs) == 1
    assert result.logs[0].node_id == call_id
    assert result.logs[0].message == "child log"
    assert all(value.node_id != log_id for value in result.values)
    assert all(event.node_id != log_id for event in result.events)


@pytest.mark.asyncio
async def test_project_variable_write_in_entry_is_visible_to_function() -> None:
    function_id = _function_id(1530)
    function_input_id = _function_id(1531)
    function_getter_id = _function_id(1532)
    function_return_id = _function_id(1533)
    call_id = _function_id(1534)
    entry_start_id = _function_id(1535)
    entry_setter_id = _function_id(1536)
    entry_stop_id = _function_id(1537)
    variable_id = _function_id(1538)
    function = _function_graph(
        function_id,
        [
            _node(function_input_id, "core.function.input"),
            _node(
                function_getter_id,
                "core.variable.getNumber",
                properties={"variableId": str(variable_id)},
            ),
            _node(function_return_id, "core.function.return"),
        ],
        [
            _edge(
                1531,
                "execution",
                function_input_id,
                "next",
                function_return_id,
                "run",
            ),
            _edge(
                1532,
                "data",
                function_getter_id,
                "value",
                function_return_id,
                "result",
            ),
        ],
        outputs=[("result", "number")],
    )
    entry = _entry_graph(
        _function_id(1539),
        [
            _node(entry_start_id, "core.flow.start"),
            _node(
                entry_setter_id,
                "core.variable.setNumber",
                properties={"variableId": str(variable_id)},
                input_values={"value": 42},
            ),
            _node(
                call_id,
                "core.function.call",
                properties={"functionGraphId": str(function_id)},
            ),
            _node(entry_stop_id, "core.flow.stop"),
        ],
        [
            _edge(1533, "execution", entry_start_id, "next", entry_setter_id, "run"),
            _edge(1534, "execution", entry_setter_id, "next", call_id, "run"),
            _edge(1535, "execution", call_id, "next", entry_stop_id, "run"),
        ],
    )
    document = _function_document(
        entry,
        [function],
        variables=[
            {
                "variableId": str(variable_id),
                "name": "shared-number",
                "valueKind": "number",
                "persistent": False,
            }
        ],
    )

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert [value.value for value in result.values if value.node_id == call_id] == [
        42.0
    ]


@pytest.mark.asyncio
async def test_function_write_is_visible_to_entry_after_return() -> None:
    function_id = _function_id(1540)
    function_input_id = _function_id(1541)
    function_setter_id = _function_id(1542)
    function_return_id = _function_id(1543)
    call_id = _function_id(1544)
    entry_start_id = _function_id(1545)
    entry_getter_id = _function_id(1546)
    entry_setter_id = _function_id(1547)
    entry_stop_id = _function_id(1548)
    variable_id = _function_id(1549)
    function = _function_graph(
        function_id,
        [
            _node(function_input_id, "core.function.input"),
            _node(
                function_setter_id,
                "core.variable.setNumber",
                properties={"variableId": str(variable_id)},
                input_values={"value": 7},
            ),
            _node(function_return_id, "core.function.return"),
        ],
        [
            _edge(
                1541,
                "execution",
                function_input_id,
                "next",
                function_setter_id,
                "run",
            ),
            _edge(
                1542,
                "execution",
                function_setter_id,
                "next",
                function_return_id,
                "run",
            ),
        ],
    )
    entry = _entry_graph(
        _function_id(1550),
        [
            _node(entry_start_id, "core.flow.start"),
            _node(
                call_id,
                "core.function.call",
                properties={"functionGraphId": str(function_id)},
            ),
            _node(
                entry_getter_id,
                "core.variable.getNumber",
                properties={"variableId": str(variable_id)},
            ),
            _node(
                entry_setter_id,
                "core.variable.setNumber",
                properties={"variableId": str(variable_id)},
            ),
            _node(entry_stop_id, "core.flow.stop"),
        ],
        [
            _edge(1543, "execution", entry_start_id, "next", call_id, "run"),
            _edge(1544, "execution", call_id, "next", entry_setter_id, "run"),
            _edge(1545, "data", entry_getter_id, "value", entry_setter_id, "value"),
            _edge(1546, "execution", entry_setter_id, "next", entry_stop_id, "run"),
        ],
    )
    document = _function_document(
        entry,
        [function],
        variables=[
            {
                "variableId": str(variable_id),
                "name": "shared-number",
                "valueKind": "number",
                "persistent": False,
            }
        ],
    )

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert [
        value.value
        for value in result.values
        if value.node_id == entry_setter_id and value.port_id == "storedValue"
    ] == [7.0]


@pytest.mark.asyncio
async def test_persistent_project_variable_update_is_reported_by_root() -> None:
    function_id = _function_id(1560)
    function_input_id = _function_id(1561)
    function_setter_id = _function_id(1562)
    function_return_id = _function_id(1563)
    call_id = _function_id(1564)
    entry_stop_id = _function_id(1565)
    variable_id = _function_id(1566)
    function = _function_graph(
        function_id,
        [
            _node(function_input_id, "core.function.input"),
            _node(
                function_setter_id,
                "core.variable.setNumber",
                properties={"variableId": str(variable_id)},
                input_values={"value": 11},
            ),
            _node(function_return_id, "core.function.return"),
        ],
        [
            _edge(
                1561,
                "execution",
                function_input_id,
                "next",
                function_setter_id,
                "run",
            ),
            _edge(
                1562,
                "execution",
                function_setter_id,
                "next",
                function_return_id,
                "run",
            ),
        ],
    )
    entry = _caller_graph(_function_id(1567), call_id, function_id, entry_stop_id)
    document = _function_document(
        entry,
        [function],
        variables=[
            {
                "variableId": str(variable_id),
                "name": "shared-persistent-number",
                "valueKind": "number",
                "persistent": True,
            }
        ],
    )

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert [update.value for update in result.persistent_variable_updates] == [11.0]


@pytest.mark.asyncio
async def test_function_persistent_update_is_allowed_without_prevalidation() -> None:
    function_id = _function_id(1500)
    input_id = _function_id(1501)
    setter_id = _function_id(1502)
    return_id = _function_id(1503)
    call_id = _function_id(1510)
    stop_id = _function_id(1511)
    variable_id = _function_id(1520)
    function = _function_graph(
        function_id,
        [
            _node(input_id, "core.function.input"),
            _node(
                setter_id,
                "core.variable.setNumber",
                properties={"variableId": str(variable_id)},
                input_values={"value": 1},
            ),
            _node(return_id, "core.function.return"),
        ],
        [
            _edge(1501, "execution", input_id, "next", setter_id, "run"),
            _edge(1502, "execution", setter_id, "next", return_id, "run"),
        ],
        variables=[
            {
                "variableId": str(variable_id),
                "name": "persistent-local",
                "valueKind": "number",
                "persistent": True,
            }
        ],
    )
    entry = _caller_graph(_function_id(1512), call_id, function_id, stop_id)
    document = _function_document(entry, [function])

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.SUCCEEDED
    assert result.terminal_error is None
    assert result.persistent_variable_updates == ()


@pytest.mark.asyncio
async def test_function_call_without_document_fails_with_required_document() -> None:
    call_id = _function_id(1601)
    entry = _caller_graph(
        _function_id(1600),
        call_id,
        _function_id(1602),
        _function_id(1603),
    )

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == (
        SchedulerFailureCode.FUNCTION_DOCUMENT_REQUIRED.value
    )
    assert result.terminal_error.node_id == call_id


@pytest.mark.asyncio
@pytest.mark.parametrize("target_kind", ["missing", "entry"])
async def test_function_call_rejects_missing_or_non_function_target(
    target_kind: str,
) -> None:
    target_id = _function_id(1610)
    call_id = _function_id(1611)
    entry = _caller_graph(_function_id(1612), call_id, target_id, _function_id(1613))
    if target_kind == "missing":
        document = _function_document(entry, [])
    else:
        document = _function_document(
            entry,
            [
                _entry_graph(
                    target_id,
                    [_node(_function_id(1614), "core.flow.start")],
                    [],
                )
            ],
        )

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert (
        result.terminal_error.code == SchedulerFailureCode.FUNCTION_TARGET_INVALID.value
    )
    assert result.terminal_error.node_id == call_id


@pytest.mark.asyncio
async def test_function_direct_recursion_is_rejected_at_recursive_edge() -> None:
    function_id = _function_id(1620)
    input_id = _function_id(1621)
    call_id = _function_id(1622)
    return_id = _function_id(1623)
    function = _function_graph(
        function_id,
        [
            _node(input_id, "core.function.input"),
            _node(
                call_id,
                "core.function.call",
                properties={"functionGraphId": str(function_id)},
            ),
            _node(return_id, "core.function.return"),
        ],
        [
            _edge(1621, "execution", input_id, "next", call_id, "run"),
            _edge(1622, "execution", call_id, "next", return_id, "run"),
        ],
    )
    entry = _caller_graph(
        _function_id(1624), _function_id(1625), function_id, _function_id(1626)
    )
    document = _function_document(entry, [function])

    result = await GraphScheduler(
        function,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.FUNCTION_RECURSION.value
    assert result.terminal_error.node_id == call_id


@pytest.mark.asyncio
async def test_function_indirect_recursion_fails_without_depth_error() -> None:
    function_a_id = _function_id(1630)
    function_b_id = _function_id(1631)
    a_input_id = _function_id(1632)
    a_call_id = _function_id(1633)
    a_return_id = _function_id(1634)
    b_input_id = _function_id(1635)
    b_call_id = _function_id(1636)
    b_return_id = _function_id(1637)
    function_a = _function_graph(
        function_a_id,
        [
            _node(a_input_id, "core.function.input"),
            _node(
                a_call_id,
                "core.function.call",
                properties={"functionGraphId": str(function_b_id)},
            ),
            _node(a_return_id, "core.function.return"),
        ],
        [
            _edge(1631, "execution", a_input_id, "next", a_call_id, "run"),
            _edge(1632, "execution", a_call_id, "next", a_return_id, "run"),
        ],
    )
    function_b = _function_graph(
        function_b_id,
        [
            _node(b_input_id, "core.function.input"),
            _node(
                b_call_id,
                "core.function.call",
                properties={"functionGraphId": str(function_a_id)},
            ),
            _node(b_return_id, "core.function.return"),
        ],
        [
            _edge(1633, "execution", b_input_id, "next", b_call_id, "run"),
            _edge(1634, "execution", b_call_id, "next", b_return_id, "run"),
        ],
    )
    entry = _caller_graph(
        _function_id(1638), _function_id(1639), function_a_id, _function_id(1640)
    )
    document = _function_document(entry, [function_a, function_b])

    result = await GraphScheduler(
        function_a,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.FUNCTION_CALL_FAILED.value
    assert result.terminal_error.code != SchedulerFailureCode.FUNCTION_DEPTH_LIMIT.value


@pytest.mark.asyncio
async def test_function_depth_limit_rejects_seventeenth_call_and_allows_sixteen() -> (
    None
):
    functions = _empty_function_chain(17)
    entry = _caller_graph(
        _function_id(1641),
        _function_id(1642),
        functions[0].graph_id,
        _function_id(1643),
    )
    document = _function_document(entry, functions)

    depth_limited = await GraphScheduler(
        functions[15],
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        function_depth=16,
        call_chain=tuple(function.graph_id for function in functions[:16]),
        run_id=RUN_ID,
    ).run()
    assert depth_limited.status is RunStatus.FAILED
    assert depth_limited.terminal_error is not None
    assert (
        depth_limited.terminal_error.code
        == SchedulerFailureCode.FUNCTION_DEPTH_LIMIT.value
    )

    successful_functions = _empty_function_chain(16)
    successful_entry = _caller_graph(
        _function_id(1644),
        _function_id(1645),
        successful_functions[0].graph_id,
        _function_id(1646),
    )
    successful = await GraphScheduler(
        successful_entry,
        build_phase_4_production_registry(),
        _limits(max_node_steps=200),
        document=_function_document(successful_entry, successful_functions),
        run_id=RUN_ID,
    ).run()
    assert successful.status is RunStatus.SUCCEEDED


@pytest.mark.asyncio
async def test_function_path_without_return_fails_at_function_boundary() -> None:
    function_id = _function_id(1650)
    input_id = _function_id(1651)
    function = _function_graph(
        function_id,
        [_node(input_id, "core.function.input")],
        [],
    )
    entry = _caller_graph(
        _function_id(1652), _function_id(1653), function_id, _function_id(1654)
    )
    document = _function_document(entry, [function])

    result = await GraphScheduler(
        function,
        build_phase_4_production_registry(),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert (
        result.terminal_error.code == SchedulerFailureCode.FUNCTION_RETURN_MISSING.value
    )


@pytest.mark.asyncio
async def test_function_child_node_failure_is_returned_as_call_failure() -> None:
    function_id = _function_id(1660)
    input_id = _function_id(1661)
    failure_id = _function_id(1662)
    return_id = _function_id(1663)
    call_id = _function_id(1664)
    function = _function_graph(
        function_id,
        [
            _node(input_id, "core.function.input"),
            _node(failure_id, "test.fake.action", input_values={"label": "child"}),
            _node(return_id, "core.function.return"),
        ],
        [
            _edge(1661, "execution", input_id, "next", failure_id, "run"),
            _edge(1662, "execution", failure_id, "next", return_id, "run"),
        ],
    )
    entry = _caller_graph(_function_id(1665), call_id, function_id, _function_id(1666))
    document = _function_document(entry, [function])

    result = await GraphScheduler(
        entry,
        build_phase_4_test_registry(InMemoryFakeActionRecorder()),
        _limits(),
        document=document,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.FUNCTION_CALL_FAILED.value
    assert result.terminal_error.node_id == call_id


@pytest.mark.asyncio
async def test_function_calls_share_step_budget_across_two_calls() -> None:
    function_id = _function_id(1700)
    function = _number_return_function(function_id)
    first_call_id = _function_id(1701)
    second_call_id = _function_id(1702)
    entry = _two_call_entry(
        _function_id(1703),
        first_call_id,
        second_call_id,
        function_id,
        _function_id(1704),
    )

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(max_node_steps=9),
        document=_function_document(entry, [function]),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.STEP_LIMIT.value
    assert result.step_count == 9


@pytest.mark.asyncio
async def test_function_calls_share_value_budget_across_two_calls() -> None:
    function_id = _function_id(1710)
    function = _number_return_function(function_id)
    first_call_id = _function_id(1711)
    second_call_id = _function_id(1712)
    entry = _two_call_entry(
        _function_id(1713),
        first_call_id,
        second_call_id,
        function_id,
        _function_id(1714),
    )

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(max_stored_values=2),
        document=_function_document(entry, [function]),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.VALUE_LIMIT.value
    assert result.terminal_error.node_id == second_call_id
    assert result.stored_value_count == 2


@pytest.mark.asyncio
async def test_function_calls_share_log_budget_across_two_calls() -> None:
    function_id = _function_id(1720)
    function = _logged_function(function_id)
    first_call_id = _function_id(1721)
    second_call_id = _function_id(1722)
    entry = _two_call_entry(
        _function_id(1723),
        first_call_id,
        second_call_id,
        function_id,
        _function_id(1724),
    )

    result = await GraphScheduler(
        entry,
        build_phase_4_production_registry(),
        _limits(max_stored_logs=1),
        document=_function_document(entry, [function]),
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.FUNCTION_CALL_FAILED.value
    assert result.stored_log_count == 1
    assert len(result.logs) == 1


@pytest.mark.asyncio
async def test_function_calls_share_absolute_deadline() -> None:
    clock = _FakeClock()
    source = build_phase_4_production_registry()
    start_definition = source.definition("core.flow.start")
    stop_definition = source.definition("core.flow.stop")
    start_executor = source.executor("core.flow.start")
    stop_executor = source.executor("core.flow.stop")
    assert start_definition is not None
    assert stop_definition is not None
    assert start_executor is not None
    assert stop_executor is not None
    advancing_executor = _AdvancingFunctionExecutor(clock)
    builder = NodeRegistryBuilder(
        {"core.flow.start", "core.flow.stop", advancing_executor.type_key}
    )
    builder.register(NodeRegistration(start_definition, start_executor))
    builder.register(NodeRegistration(stop_definition, stop_executor))
    builder.register(
        NodeRegistration(
            _custom_definition(
                advancing_executor.type_key,
                "execution",
                "runtime",
                [
                    _exec_port("run", "input", advancing_executor.type_key),
                    _exec_port("next", "output", advancing_executor.type_key),
                ],
            ),
            advancing_executor,
        )
    )

    function_id = _function_id(1730)
    input_id = _function_id(1731)
    advance_id = _function_id(1732)
    return_id = _function_id(1733)
    function = _function_graph(
        function_id,
        [
            _node(input_id, "core.function.input"),
            _node(advance_id, advancing_executor.type_key),
            _node(return_id, "core.function.return"),
        ],
        [
            _edge(1731, "execution", input_id, "next", advance_id, "run"),
            _edge(1732, "execution", advance_id, "next", return_id, "run"),
        ],
    )
    first_call_id = _function_id(1734)
    second_call_id = _function_id(1735)
    entry = _two_call_entry(
        _function_id(1736),
        first_call_id,
        second_call_id,
        function_id,
        _function_id(1737),
    )

    result = await GraphScheduler(
        entry,
        builder.build(),
        _limits(max_duration_seconds=5.0),
        document=_function_document(entry, [function]),
        clock=clock,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.FAILED
    assert result.terminal_error is not None
    assert result.terminal_error.code == SchedulerFailureCode.FUNCTION_CALL_FAILED.value
    assert result.terminal_error.node_id == second_call_id
    assert clock.value == 106.0


@pytest.mark.asyncio
async def test_function_calls_share_cancellation_scope_without_sleep() -> None:
    clock = _FakeClock()
    scope = CancellationScope()
    source = build_phase_4_production_registry()
    start_definition = source.definition("core.flow.start")
    stop_definition = source.definition("core.flow.stop")
    start_executor = source.executor("core.flow.start")
    stop_executor = source.executor("core.flow.stop")
    assert start_definition is not None
    assert stop_definition is not None
    assert start_executor is not None
    assert stop_executor is not None
    cancel_executor = _CancellingFunctionExecutor(scope, clock)
    builder = NodeRegistryBuilder(
        {"core.flow.start", "core.flow.stop", cancel_executor.type_key}
    )
    builder.register(NodeRegistration(start_definition, start_executor))
    builder.register(NodeRegistration(stop_definition, stop_executor))
    builder.register(
        NodeRegistration(
            _custom_definition(
                cancel_executor.type_key,
                "execution",
                "runtime",
                [
                    _exec_port("run", "input", cancel_executor.type_key),
                    _exec_port("next", "output", cancel_executor.type_key),
                ],
            ),
            cancel_executor,
        )
    )

    function_id = _function_id(1740)
    input_id = _function_id(1741)
    cancel_id = _function_id(1742)
    return_id = _function_id(1743)
    function = _function_graph(
        function_id,
        [
            _node(input_id, "core.function.input"),
            _node(cancel_id, cancel_executor.type_key),
            _node(return_id, "core.function.return"),
        ],
        [
            _edge(1741, "execution", input_id, "next", cancel_id, "run"),
            _edge(1742, "execution", cancel_id, "next", return_id, "run"),
        ],
    )
    entry = _caller_graph(
        _function_id(1744),
        _function_id(1745),
        function_id,
        _function_id(1746),
    )

    result = await GraphScheduler(
        entry,
        builder.build(),
        _limits(),
        document=_function_document(entry, [function]),
        cancellation=scope,
        clock=clock,
        run_id=RUN_ID,
    ).run()

    assert result.status is RunStatus.CANCELLED
    assert result.terminal_error is not None
    assert result.terminal_error.code == NodeExecutionFailureCode.CANCELLED.value
    assert clock.value == 101.0
