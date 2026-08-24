"""Deterministic single-run scheduler for validated Rino graphs."""

from __future__ import annotations

import asyncio
import math
import time
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Protocol, cast
from uuid import UUID, uuid4, uuid5

from pydantic import BaseModel

from rino_runtime.contracts.generated.rino_graph_v1 import (
    EdgeV1,
    GraphV1,
    NodeV1,
    RinoProjectDocumentV1,
    VariableValueKindV1,
)
from rino_runtime.contracts.generated.rino_registry_v1 import (
    NodeDefinitionV1,
    PortDefinitionV1,
    PortDirectionV1,
    PortKindV1,
    RuntimeKindV1,
)
from rino_runtime.execution_control import RuntimeCancellationError
from rino_runtime.graph.function_semantics import (
    FUNCTION_CALL_NODE_TYPE,
    FUNCTION_INPUT_NODE_TYPE,
    FUNCTION_RETURN_NODE_TYPE,
    ResolvedFunctionNodeDefinition,
    resolve_function_node_definition,
)
from rino_runtime.nodes import (
    CancellationProbe,
    NeverCancelled,
    NodeActivationTiming,
    NodeExecutionContext,
    NodeExecutionFailure,
    NodeExecutionFailureCode,
    NodeExecutionResult,
    NodeRegistry,
    RuntimeImageReference,
    RuntimeLogEntry,
    RuntimePoint,
    RuntimeRect,
    RuntimeValue,
    SuccessorDispatchMode,
)
from rino_runtime.nodes.variables import RuntimeVariableFrame
from rino_runtime.scheduler.models import (
    ExecutionToken,
    NodeActivation,
    NullSchedulerObserver,
    ResolvedInputs,
    RunSnapshot,
    RunStatus,
    SchedulerEvent,
    SchedulerEventKind,
    SchedulerFailure,
    SchedulerFailureCode,
    SchedulerLimits,
    SchedulerObserver,
    SchedulerTerminalError,
    StoredLog,
    StoredValue,
)


class MonotonicClock(Protocol):
    def now(self) -> float: ...


class SystemMonotonicClock:
    def now(self) -> float:
        return time.monotonic()


@dataclass(frozen=True, slots=True)
class _PureCacheEntry:
    dependency_signature: tuple[tuple[str, UUID, str, int], ...]
    variable_revision: int
    output_records: tuple[StoredValue, ...]


type EffectiveNodeDefinition = NodeDefinitionV1 | ResolvedFunctionNodeDefinition


def _runtime_kind(
    definition: EffectiveNodeDefinition | None,
) -> RuntimeKindV1 | None:
    if definition is None:
        return None
    if isinstance(definition, ResolvedFunctionNodeDefinition):
        return definition.definition.runtime_kind
    return definition.runtime_kind


def _ports(definition: EffectiveNodeDefinition) -> tuple[PortDefinitionV1, ...]:
    if isinstance(definition, ResolvedFunctionNodeDefinition):
        return tuple(definition.ports.values())
    return tuple(definition.ports)


class _GraphIndex:
    def __init__(
        self,
        graph: GraphV1,
        registry: NodeRegistry,
        document: RinoProjectDocumentV1 | None,
    ) -> None:
        nodes = {node.node_id: node for node in graph.nodes}
        if len(nodes) != len(graph.nodes):
            raise ValueError("Validated graph contains duplicate node identifiers.")
        self.nodes: Mapping[UUID, NodeV1] = MappingProxyType(nodes)
        self.data_inputs: dict[tuple[UUID, str], EdgeV1] = {}
        self.execution_outputs: dict[tuple[UUID, str], list[EdgeV1]] = {}
        for edge in graph.edges:
            if edge.edge_kind.value == "data":
                key = (edge.target_node_id, edge.target_port_id.root)
                if key in self.data_inputs:
                    raise ValueError("Validated graph exceeds data-input cardinality.")
                self.data_inputs[key] = edge
            else:
                key = (edge.source_node_id, edge.source_port_id.root)
                self.execution_outputs.setdefault(key, []).append(edge)
        if graph.kind.value == "function":
            entry_nodes = [
                node
                for node in graph.nodes
                if node.type_key.root == FUNCTION_INPUT_NODE_TYPE
            ]
        else:
            entry_nodes = [
                node
                for node in graph.nodes
                if _runtime_kind(
                    resolve_function_node_definition(node, graph, document)
                    or registry.definition(node.type_key.root)
                )
                is RuntimeKindV1.entry
            ]
        self.entry_nodes = tuple(entry_nodes)
        self.entry_node = entry_nodes[0] if len(entry_nodes) == 1 else None
        self.breakpoint_node = next(
            (node for node in graph.nodes if node.breakpoint is True), None
        )


class GraphScheduler:
    """Executes one frozen graph revision with a deterministic token queue."""

    def __init__(
        self,
        graph: GraphV1,
        registry: NodeRegistry,
        limits: SchedulerLimits,
        *,
        request_id: UUID | None = None,
        run_id: UUID | None = None,
        device_key: str | None = None,
        cancellation: CancellationProbe | None = None,
        clock: MonotonicClock | None = None,
        observer: SchedulerObserver | None = None,
        project_assets: Mapping[str, RuntimeImageReference] | None = None,
        initial_variable_values: Mapping[UUID, RuntimeValue] | None = None,
        document: RinoProjectDocumentV1 | None = None,
        variable_frame: RuntimeVariableFrame | None = None,
        function_inputs: Mapping[str, RuntimeValue] | None = None,
        function_depth: int = 0,
        call_chain: tuple[UUID, ...] | None = None,
        absolute_deadline: float | None = None,
    ) -> None:
        self._graph = graph.model_copy(deep=True)
        self._document = (
            document.model_copy(deep=True) if document is not None else None
        )
        self._registry = registry
        self._limits = limits
        self._request_id = request_id
        self._run_id = run_id or uuid4()
        self._device_key = device_key
        self._frame_id = uuid5(self._run_id, f"frame:{graph.graph_id}")
        self._function_inputs = MappingProxyType(dict(function_inputs or {}))
        self._function_depth = function_depth
        self._call_chain = call_chain or (self._graph.graph_id,)
        if self._graph.graph_id not in self._call_chain:
            self._call_chain = (*self._call_chain, self._graph.graph_id)
        self._absolute_deadline = absolute_deadline
        if variable_frame is not None:
            if initial_variable_values:
                raise ValueError(
                    "A shared variable frame cannot receive initial values."
                )
            self._variables = variable_frame
        else:
            variable_definitions = (
                self._document.variables
                if self._document is not None and self._document.variables is not None
                else self._graph.variables or ()
            )
            self._variables = RuntimeVariableFrame(
                variable_definitions,
                initial_values=initial_variable_values,
            )
        self._cancellation = cancellation or NeverCancelled()
        self._clock = clock or SystemMonotonicClock()
        self._observer = observer or NullSchedulerObserver()
        self._project_assets = MappingProxyType(dict(project_assets or {}))
        self._index = _GraphIndex(self._graph, registry, self._document)
        self._queue: deque[ExecutionToken] = deque()
        self._token_history: deque[ExecutionToken] = deque(
            maxlen=limits.retained_token_limit
        )
        self._activation_history: deque[NodeActivation] = deque(
            maxlen=limits.retained_activation_limit
        )
        self._events: deque[SchedulerEvent] = deque(maxlen=limits.retained_event_limit)
        self._value_history: deque[StoredValue] = deque(
            maxlen=limits.retained_value_limit
        )
        self._logs: deque[StoredLog] = deque(maxlen=limits.retained_log_limit)
        self._current_values: dict[tuple[UUID, str], StoredValue] = {}
        self._generations: dict[tuple[UUID, str], int] = {}
        self._pure_cache: dict[UUID, _PureCacheEntry] = {}
        self._step_count = 0
        self._tokens_created = 0
        self._activation_count = 0
        self._pure_cache_hits = 0
        self._event_count = 0
        self._stored_value_count = 0
        self._stored_log_count = 0
        self._node_activation_counts: dict[UUID, int] = {}
        self._node_first_activation_started_at: dict[UUID, float] = {}
        self._node_previous_activation_started_at: dict[UUID, float] = {}
        self._deadline = 0.0
        self._has_run = False
        self._last_failure_node_id: UUID | None = None
        self._function_return_values: dict[str, RuntimeValue] = {}
        self._return_reached = False

    @property
    def _is_function_graph(self) -> bool:
        return self._graph.kind.value == "function"

    async def run(self) -> RunSnapshot:
        if self._has_run:
            raise RuntimeError("A graph scheduler instance can run only once.")
        self._has_run = True
        self._deadline = (
            self._absolute_deadline
            if self._absolute_deadline is not None
            else self._clock.now() + self._limits.max_duration_seconds
        )
        self._emit(SchedulerEventKind.RUN_STARTED)
        try:
            remaining_duration = max(0.0, self._deadline - self._clock.now())
            async with asyncio.timeout(remaining_duration):
                self._check_pre_dispatch()
                if not self._index.entry_nodes:
                    code = (
                        SchedulerFailureCode.FUNCTION_ENTRY_NODE_MISSING
                        if self._is_function_graph
                        else SchedulerFailureCode.ENTRY_NODE_MISSING
                    )
                    raise SchedulerFailure(code)
                if len(self._index.entry_nodes) > 1:
                    code = (
                        SchedulerFailureCode.FUNCTION_ENTRY_NODE_MULTIPLE
                        if self._is_function_graph
                        else SchedulerFailureCode.ENTRY_NODE_MISSING
                    )
                    raise SchedulerFailure(code)
                entry = self._index.entry_nodes[0]
                if self._index.breakpoint_node is not None:
                    raise SchedulerFailure(
                        SchedulerFailureCode.BREAKPOINT_UNSUPPORTED,
                        node_id=self._index.breakpoint_node.node_id,
                    )
                self._enqueue_initial(entry.node_id)
                terminal = False
                while self._queue and not terminal:
                    self._check_pre_dispatch()
                    token = self._queue.popleft()
                    result = await self._execute_execution_node(token)
                    if result.terminal:
                        terminal = True
                        self._queue.clear()
                        continue
                    if result.successor_dispatch is SuccessorDispatchMode.CONCURRENT:
                        terminal = await self._execute_concurrent_successors(
                            token, result
                        )
                        if terminal:
                            self._queue.clear()
                    else:
                        self._enqueue_successors(token, result)
                if self._is_function_graph and not self._return_reached:
                    raise SchedulerFailure(SchedulerFailureCode.FUNCTION_RETURN_MISSING)
            return self._finish(RunStatus.SUCCEEDED)
        except TimeoutError:
            return self._finish(
                RunStatus.FAILED,
                SchedulerFailure(SchedulerFailureCode.TIME_LIMIT).terminal_error(),
            )
        except NodeExecutionFailure as error:
            terminal_error = SchedulerTerminalError(
                code=error.code.value,
                message_key=error.message_key,
                node_id=self._last_failure_node_id,
            )
            status = (
                RunStatus.CANCELLED
                if error.code is NodeExecutionFailureCode.CANCELLED
                else RunStatus.FAILED
            )
            return self._finish(status, terminal_error)
        except RuntimeCancellationError as error:
            return self._finish(
                RunStatus.CANCELLED,
                SchedulerTerminalError(
                    code=error.code,
                    message_key=error.message_key,
                    node_id=self._last_failure_node_id,
                ),
            )
        except SchedulerFailure as error:
            return self._finish(RunStatus.FAILED, error.terminal_error())

    async def _execute_execution_node(
        self, token: ExecutionToken
    ) -> NodeExecutionResult:
        node = self._index.nodes.get(token.target_node_id)
        if node is None:
            raise SchedulerFailure(
                SchedulerFailureCode.NODE_DEFINITION_MISSING,
                node_id=token.target_node_id,
            )
        definition = self._definition(node)
        if _runtime_kind(definition) not in (
            RuntimeKindV1.entry,
            RuntimeKindV1.execution,
        ):
            raise SchedulerFailure(
                SchedulerFailureCode.NODE_NOT_EXECUTABLE,
                node_id=node.node_id,
            )
        resolved = await self._resolve_inputs(node, definition, (), 0, token.token_id)
        if isinstance(definition, ResolvedFunctionNodeDefinition):
            return await self._execute_function_node(
                node,
                definition,
                resolved,
                token.token_id,
            )
        try:
            result, _ = await self._execute_registered(
                node,
                definition,
                resolved,
                token.token_id,
                pure=False,
            )
        except NodeExecutionFailure as error:
            if (
                error.code is NodeExecutionFailureCode.ACTION_FAILED
                and error.can_follow_failure_output
                and self._index.execution_outputs.get((node.node_id, "failed"))
            ):
                return NodeExecutionResult(
                    selected_execution_outputs=("failed",),
                )
            raise
        return result

    async def _evaluate_pure(
        self,
        node: NodeV1,
        stack: tuple[UUID, ...],
        depth: int,
        token_id: int,
    ) -> None:
        if depth > self._limits.max_pure_depth:
            raise SchedulerFailure(
                SchedulerFailureCode.PURE_DEPTH_LIMIT,
                node_id=node.node_id,
            )
        if node.node_id in stack:
            raise SchedulerFailure(
                SchedulerFailureCode.PURE_DEPENDENCY_CYCLE,
                node_id=node.node_id,
            )
        definition = self._definition(node)
        if _runtime_kind(definition) is not RuntimeKindV1.pure:
            return
        resolved = await self._resolve_inputs(
            node,
            definition,
            (*stack, node.node_id),
            depth,
            token_id,
        )
        cached = self._pure_cache.get(node.node_id)
        if (
            cached is not None
            and cached.dependency_signature == resolved.dependency_signature
            and cached.variable_revision == self._variables.revision
        ):
            self._pure_cache_hits += 1
            return
        _, records = await self._execute_registered(
            node,
            definition,
            resolved,
            token_id,
            pure=True,
        )
        self._pure_cache[node.node_id] = _PureCacheEntry(
            resolved.dependency_signature,
            self._variables.revision,
            records,
        )

    async def _resolve_inputs(
        self,
        node: NodeV1,
        definition: EffectiveNodeDefinition,
        stack: tuple[UUID, ...],
        depth: int,
        token_id: int,
    ) -> ResolvedInputs:
        values: dict[str, RuntimeValue] = {}
        signature: list[tuple[str, UUID, str, int]] = []
        for port in _ports(definition):
            if (
                port.direction is not PortDirectionV1.input
                or port.port_kind is not PortKindV1.data
            ):
                continue
            port_id = port.port_id.root
            edge = self._index.data_inputs.get((node.node_id, port_id))
            if edge is not None:
                source = self._index.nodes.get(edge.source_node_id)
                if source is None:
                    raise SchedulerFailure(
                        SchedulerFailureCode.INPUT_UNAVAILABLE,
                        node_id=node.node_id,
                        port_id=port_id,
                    )
                source_definition = self._definition(source)
                if _runtime_kind(source_definition) is RuntimeKindV1.pure:
                    await self._evaluate_pure(source, stack, depth + 1, token_id)
                source_port_id = edge.source_port_id.root
                record = self._current_values.get((edge.source_node_id, source_port_id))
                if record is None:
                    raise SchedulerFailure(
                        SchedulerFailureCode.INPUT_UNAVAILABLE,
                        node_id=node.node_id,
                        port_id=port_id,
                    )
                values[port_id] = record.value
                signature.append(
                    (
                        port_id,
                        edge.source_node_id,
                        source_port_id,
                        record.generation,
                    )
                )
                continue
            if port_id in node.input_values:
                if port.accepts_literal is not True:
                    raise SchedulerFailure(
                        SchedulerFailureCode.LITERAL_UNSUPPORTED,
                        node_id=node.node_id,
                        port_id=port_id,
                    )
                values[port_id] = _runtime_value_from_json(node.input_values[port_id])
                continue
            if port.required is True:
                raise SchedulerFailure(
                    SchedulerFailureCode.INPUT_UNAVAILABLE,
                    node_id=node.node_id,
                    port_id=port_id,
                )
        return ResolvedInputs(values, tuple(signature))

    async def _execute_registered(
        self,
        node: NodeV1,
        definition: NodeDefinitionV1,
        resolved: ResolvedInputs,
        token_id: int,
        *,
        pure: bool,
    ) -> tuple[NodeExecutionResult, tuple[StoredValue, ...]]:
        if node.disabled is True:
            raise SchedulerFailure(
                SchedulerFailureCode.NODE_DISABLED_UNSUPPORTED,
                node_id=node.node_id,
            )
        self._check_pre_dispatch()
        activation, activation_timing = self._new_activation(
            node,
            token_id,
            pure=pure,
        )
        self._emit(
            SchedulerEventKind.NODE_STARTED,
            token_id=token_id,
            activation=activation,
        )
        try:
            result = await self._registry.execute(
                node.type_key.root,
                NodeExecutionContext(
                    node_id=node.node_id,
                    type_key=node.type_key.root,
                    request_id=self._request_id,
                    run_id=self._run_id,
                    activation_id=activation.activation_id,
                    device_key=self._device_key,
                    inputs=resolved.values,
                    properties=self._properties(node, definition),
                    dynamic_port_state=self._dynamic_port_state(node),
                    project_assets=self._project_assets,
                    variable_access=self._variables,
                    cancellation=self._cancellation,
                    activation_timing=activation_timing,
                    monotonic_now=self._clock.now,
                ),
            )
            self._check_time()
            records = self._commit_result(node, definition, activation, result)
        except NodeExecutionFailure as error:
            self._last_failure_node_id = node.node_id
            self._emit(
                SchedulerEventKind.NODE_FAILED,
                token_id=token_id,
                activation=activation,
                error_code=error.code.value,
            )
            raise
        except RuntimeCancellationError as error:
            self._last_failure_node_id = node.node_id
            self._emit(
                SchedulerEventKind.NODE_FAILED,
                token_id=token_id,
                activation=activation,
                error_code=error.code,
            )
            raise
        except SchedulerFailure as error:
            self._last_failure_node_id = node.node_id
            self._emit(
                SchedulerEventKind.NODE_FAILED,
                token_id=token_id,
                activation=activation,
                error_code=error.code.value,
            )
            raise
        except (LookupError, ValueError) as error:
            self._last_failure_node_id = node.node_id
            self._emit(
                SchedulerEventKind.NODE_FAILED,
                token_id=token_id,
                activation=activation,
                error_code=SchedulerFailureCode.EXECUTOR_CONTRACT_VIOLATION.value,
            )
            raise SchedulerFailure(
                SchedulerFailureCode.EXECUTOR_CONTRACT_VIOLATION,
                node_id=node.node_id,
            ) from error
        except Exception as error:
            self._last_failure_node_id = node.node_id
            self._emit(
                SchedulerEventKind.NODE_FAILED,
                token_id=token_id,
                activation=activation,
                error_code=SchedulerFailureCode.EXECUTOR_FAILED.value,
            )
            raise SchedulerFailure(
                SchedulerFailureCode.EXECUTOR_FAILED,
                node_id=node.node_id,
            ) from error
        self._emit(
            SchedulerEventKind.NODE_COMPLETED,
            token_id=token_id,
            activation=activation,
            output_port_ids=tuple(record.port_id for record in records),
        )
        return result, records

    async def _execute_function_node(
        self,
        node: NodeV1,
        definition: ResolvedFunctionNodeDefinition,
        resolved: ResolvedInputs,
        token_id: int,
    ) -> NodeExecutionResult:
        if node.disabled is True:
            raise SchedulerFailure(
                SchedulerFailureCode.NODE_DISABLED_UNSUPPORTED,
                node_id=node.node_id,
            )
        self._check_pre_dispatch()
        activation, _ = self._new_activation(node, token_id, pure=False)
        self._emit(
            SchedulerEventKind.NODE_STARTED,
            token_id=token_id,
            activation=activation,
        )
        try:
            type_key = node.type_key.root
            if type_key == FUNCTION_INPUT_NODE_TYPE:
                result = self._execute_function_input(node)
            elif type_key == FUNCTION_RETURN_NODE_TYPE:
                result = self._execute_function_return(resolved, node)
            elif type_key == FUNCTION_CALL_NODE_TYPE:
                result = await self._execute_function_call(
                    node,
                    resolved,
                    activation.activation_id,
                )
            else:
                raise SchedulerFailure(
                    SchedulerFailureCode.NODE_DEFINITION_MISSING,
                    node_id=node.node_id,
                )
            self._check_time()
            records = self._commit_result(node, definition, activation, result)
        except RuntimeCancellationError as error:
            self._last_failure_node_id = node.node_id
            self._emit(
                SchedulerEventKind.NODE_FAILED,
                token_id=token_id,
                activation=activation,
                error_code=error.code,
            )
            raise
        except SchedulerFailure as error:
            self._last_failure_node_id = node.node_id
            self._emit(
                SchedulerEventKind.NODE_FAILED,
                token_id=token_id,
                activation=activation,
                error_code=error.code.value,
            )
            raise
        self._emit(
            SchedulerEventKind.NODE_COMPLETED,
            token_id=token_id,
            activation=activation,
            output_port_ids=tuple(record.port_id for record in records),
        )
        return result

    def _execute_function_input(self, node: NodeV1) -> NodeExecutionResult:
        signature = self._graph.function_signature
        if signature is None:
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_INPUT_INVALID,
                node_id=node.node_id,
            )
        expected = {parameter.port_id.root: parameter for parameter in signature.inputs}
        actual = dict(self._function_inputs)
        if set(actual) != set(expected):
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_INPUT_INVALID,
                node_id=node.node_id,
            )
        outputs: dict[str, RuntimeValue] = {}
        for parameter in signature.inputs:
            value = actual[parameter.port_id.root]
            if not _runtime_value_matches_kind(parameter.value_kind, value):
                raise SchedulerFailure(
                    SchedulerFailureCode.FUNCTION_INPUT_INVALID,
                    node_id=node.node_id,
                    port_id=parameter.port_id.root,
                )
            outputs[parameter.port_id.root] = value
        return NodeExecutionResult(
            outputs=outputs,
            selected_execution_outputs=("next",),
        )

    def _execute_function_return(
        self,
        resolved: ResolvedInputs,
        node: NodeV1,
    ) -> NodeExecutionResult:
        signature = self._graph.function_signature
        if signature is None:
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_RETURN_INVALID,
                node_id=node.node_id,
            )
        expected = tuple(parameter.port_id.root for parameter in signature.outputs)
        if set(resolved.values) != set(expected):
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_RETURN_INVALID,
                node_id=node.node_id,
            )
        self._function_return_values = {
            port_id: resolved.values[port_id] for port_id in expected
        }
        self._return_reached = True
        return NodeExecutionResult(terminal=True)

    async def _execute_function_call(
        self,
        node: NodeV1,
        resolved: ResolvedInputs,
        activation_id: int,
    ) -> NodeExecutionResult:
        if self._document is None:
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_DOCUMENT_REQUIRED,
                node_id=node.node_id,
            )
        properties = self._properties(node, None)
        target_value = properties.get("functionGraphId")
        if not isinstance(target_value, str):
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_TARGET_INVALID,
                node_id=node.node_id,
            )
        try:
            target_id = UUID(target_value)
        except ValueError as error:
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_TARGET_INVALID,
                node_id=node.node_id,
            ) from error
        target = next(
            (graph for graph in self._document.graphs if graph.graph_id == target_id),
            None,
        )
        if target is None or target.kind.value != "function":
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_TARGET_INVALID,
                node_id=node.node_id,
            )
        if target_id in self._call_chain:
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_RECURSION,
                node_id=node.node_id,
            )
        if self._function_depth >= 16:
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_DEPTH_LIMIT,
                node_id=node.node_id,
            )
        signature = target.function_signature
        if signature is None:
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_TARGET_INVALID,
                node_id=node.node_id,
            )
        expected_inputs = {
            parameter.port_id.root: parameter for parameter in signature.inputs
        }
        if set(resolved.values) != set(expected_inputs):
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_INPUT_INVALID,
                node_id=node.node_id,
            )
        for parameter in signature.inputs:
            if not _runtime_value_matches_kind(
                parameter.value_kind,
                resolved.values[parameter.port_id.root],
            ):
                raise SchedulerFailure(
                    SchedulerFailureCode.FUNCTION_INPUT_INVALID,
                    node_id=node.node_id,
                    port_id=parameter.port_id.root,
                )
        child_limits = self._function_child_limits(node)
        child_run_id = uuid5(
            self._run_id,
            f"function-call:{node.node_id}:{activation_id}:{target_id}",
        )
        child = GraphScheduler(
            target,
            self._registry,
            child_limits,
            request_id=self._request_id,
            run_id=child_run_id,
            device_key=self._device_key,
            cancellation=self._cancellation,
            clock=self._clock,
            observer=NullSchedulerObserver(),
            project_assets=self._project_assets,
            document=self._document,
            variable_frame=(
                self._variables
                if self._document is not None and self._document.variables is not None
                else None
            ),
            function_inputs=resolved.values,
            function_depth=self._function_depth + 1,
            call_chain=(*self._call_chain, target_id),
            absolute_deadline=self._deadline,
        )
        snapshot = await child.run()
        self._merge_child_snapshot(snapshot)
        if snapshot.status is RunStatus.CANCELLED:
            raise RuntimeCancellationError
        if snapshot.status is not RunStatus.SUCCEEDED:
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_CALL_FAILED,
                node_id=node.node_id,
            )

        outputs = dict(snapshot.function_return_values)
        expected_outputs = tuple(
            parameter.port_id.root for parameter in signature.outputs
        )
        if set(outputs) != set(expected_outputs):
            raise SchedulerFailure(
                SchedulerFailureCode.FUNCTION_RETURN_INVALID,
                node_id=node.node_id,
            )
        logs = tuple(RuntimeLogEntry(log.level, log.message) for log in snapshot.logs)
        return NodeExecutionResult(
            outputs={port_id: outputs[port_id] for port_id in expected_outputs},
            selected_execution_outputs=("next",),
            logs=logs,
        )

    def _function_child_limits(self, node: NodeV1) -> SchedulerLimits:
        remaining_steps = self._limits.max_node_steps - self._step_count
        remaining_values = self._limits.max_stored_values - self._stored_value_count
        remaining_logs = self._limits.max_stored_logs - self._stored_log_count
        if remaining_steps < 1:
            raise SchedulerFailure(
                SchedulerFailureCode.STEP_LIMIT,
                node_id=node.node_id,
            )
        if remaining_values < 1:
            raise SchedulerFailure(
                SchedulerFailureCode.VALUE_LIMIT,
                node_id=node.node_id,
            )
        return SchedulerLimits(
            max_node_steps=remaining_steps,
            max_duration_seconds=max(0.000001, self._deadline - self._clock.now()),
            max_queue_size=self._limits.max_queue_size,
            max_stored_values=remaining_values,
            max_stored_logs=max(0, remaining_logs),
            max_events=self._limits.max_events,
            max_pure_depth=self._limits.max_pure_depth,
            max_retained_tokens=min(
                self._limits.retained_token_limit,
                remaining_steps,
            ),
            max_retained_activations=min(
                self._limits.retained_activation_limit,
                remaining_steps,
            ),
            max_retained_events=min(
                self._limits.retained_event_limit,
                self._limits.max_events,
            ),
            max_retained_values=min(
                self._limits.retained_value_limit,
                remaining_values,
            ),
            max_retained_logs=min(
                self._limits.retained_log_limit,
                max(0, remaining_logs),
            ),
        )

    def _merge_child_snapshot(self, snapshot: RunSnapshot) -> None:
        self._step_count += snapshot.step_count
        self._tokens_created += snapshot.tokens_created
        self._pure_cache_hits += snapshot.pure_cache_hits
        self._stored_value_count += snapshot.stored_value_count

    def _properties(
        self,
        node: NodeV1,
        definition: EffectiveNodeDefinition | None,
    ) -> Mapping[str, RuntimeValue]:
        values: dict[str, RuntimeValue] = {}
        property_defaults = (
            definition.property_defaults
            if isinstance(definition, NodeDefinitionV1)
            else None
        )
        if property_defaults is not None:
            defaults = _unwrap_json(property_defaults)
            if isinstance(defaults, dict):
                for name, value in cast("dict[str, object]", defaults).items():
                    values[name] = _runtime_value_from_json(value)
        properties = _unwrap_json(node.properties)
        if not isinstance(properties, dict):
            raise SchedulerFailure(
                SchedulerFailureCode.LITERAL_UNSUPPORTED,
                node_id=node.node_id,
            )
        for name, value in cast("dict[str, object]", properties).items():
            values[name] = _runtime_value_from_json(value)
        return MappingProxyType(values)

    def _dynamic_port_state(self, node: NodeV1) -> Mapping[str, object]:
        state = _unwrap_json(node.dynamic_port_state)
        return (
            MappingProxyType(cast("dict[str, object]", state))
            if isinstance(state, dict)
            else MappingProxyType({})
        )

    def _commit_result(
        self,
        node: NodeV1,
        definition: EffectiveNodeDefinition,
        activation: NodeActivation,
        result: NodeExecutionResult,
    ) -> tuple[StoredValue, ...]:
        if (
            self._stored_value_count + len(result.outputs)
            > self._limits.max_stored_values
        ):
            raise SchedulerFailure(
                SchedulerFailureCode.VALUE_LIMIT,
                node_id=node.node_id,
            )
        if self._stored_log_count + len(result.logs) > self._limits.max_stored_logs:
            raise SchedulerFailure(
                SchedulerFailureCode.LOG_LIMIT,
                node_id=node.node_id,
            )
        ordered_port_ids = [
            port.port_id.root
            for port in _ports(definition)
            if port.port_id.root in result.outputs
        ]
        records: list[StoredValue] = []
        for port_id in ordered_port_ids:
            key = (node.node_id, port_id)
            generation = self._generations.get(key, 0) + 1
            records.append(
                StoredValue(
                    run_id=self._run_id,
                    frame_id=self._frame_id,
                    node_id=node.node_id,
                    port_id=port_id,
                    generation=generation,
                    value=result.outputs[port_id],
                )
            )
        for record in records:
            key = (record.node_id, record.port_id)
            self._generations[key] = record.generation
            self._current_values[key] = record
            self._value_history.append(record)
        self._stored_value_count += len(records)
        log_records = tuple(
            StoredLog(
                sequence=self._stored_log_count + index + 1,
                run_id=self._run_id,
                activation_id=activation.activation_id,
                node_id=node.node_id,
                level=entry.level,
                message=entry.message,
            )
            for index, entry in enumerate(result.logs)
        )
        self._logs.extend(log_records)
        self._stored_log_count += len(log_records)
        if records:
            self._observer.on_values_committed(tuple(records))
        if log_records:
            self._observer.on_logs_committed(log_records)
        return tuple(records)

    def _enqueue_initial(self, node_id: UUID) -> None:
        self._tokens_created = 1
        token = ExecutionToken(1, node_id)
        self._token_history.append(token)
        self._queue.append(token)

    def _enqueue_successors(
        self, parent: ExecutionToken, result: NodeExecutionResult
    ) -> None:
        self._queue.extend(self._create_successor_tokens(parent, result))

    def _create_successor_tokens(
        self, parent: ExecutionToken, result: NodeExecutionResult
    ) -> list[ExecutionToken]:
        edges = [
            edge
            for output_port_id in result.selected_execution_outputs
            for edge in self._index.execution_outputs.get(
                (parent.target_node_id, output_port_id),
                (),
            )
        ]
        if len(self._queue) + len(edges) > self._limits.max_queue_size:
            raise SchedulerFailure(
                SchedulerFailureCode.QUEUE_LIMIT,
                node_id=parent.target_node_id,
            )
        self._reserve_events(len(edges))
        new_tokens: list[ExecutionToken] = []
        for edge in edges:
            self._tokens_created += 1
            token = ExecutionToken(
                token_id=self._tokens_created,
                target_node_id=edge.target_node_id,
                parent_token_id=parent.token_id,
                source_edge_id=edge.edge_id,
            )
            new_tokens.append(token)
            self._token_history.append(token)
            self._emit(
                SchedulerEventKind.EDGE_TRAVERSED,
                token_id=token.token_id,
                node_id=parent.target_node_id,
                edge_id=edge.edge_id,
                output_port_id=edge.source_port_id.root,
            )
        return new_tokens

    async def _execute_concurrent_successors(
        self, parent: ExecutionToken, result: NodeExecutionResult
    ) -> bool:
        tokens = self._create_successor_tokens(parent, result)
        if not tokens:
            return False
        tasks = [
            asyncio.create_task(self._execute_execution_node(token)) for token in tokens
        ]
        try:
            child_results = await asyncio.gather(*tasks)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        terminal = False
        for token, child_result in zip(tokens, child_results, strict=True):
            if child_result.terminal:
                terminal = True
            elif child_result.successor_dispatch is SuccessorDispatchMode.CONCURRENT:
                terminal = (
                    await self._execute_concurrent_successors(token, child_result)
                    or terminal
                )
            else:
                self._enqueue_successors(token, child_result)
        return terminal

    def _new_activation(
        self, node: NodeV1, token_id: int, *, pure: bool
    ) -> tuple[NodeActivation, NodeActivationTiming]:
        self._check_step_limit(node.node_id)
        started_at = self._clock.now()
        activation_count = self._node_activation_counts.get(node.node_id, 0) + 1
        first_started_at = self._node_first_activation_started_at.setdefault(
            node.node_id,
            started_at,
        )
        previous_started_at = self._node_previous_activation_started_at.get(
            node.node_id
        )
        self._node_activation_counts[node.node_id] = activation_count
        self._node_previous_activation_started_at[node.node_id] = started_at
        self._step_count += 1
        self._activation_count += 1
        activation = NodeActivation(
            activation_id=self._activation_count,
            token_id=token_id,
            frame_id=self._frame_id,
            node_id=node.node_id,
            type_key=node.type_key.root,
            pure=pure,
        )
        self._activation_history.append(activation)
        return activation, NodeActivationTiming(
            activation_count=activation_count,
            first_started_at_monotonic=first_started_at,
            previous_started_at_monotonic=previous_started_at,
            current_started_at_monotonic=started_at,
        )

    def _definition(self, node: NodeV1) -> EffectiveNodeDefinition:
        function_definition = resolve_function_node_definition(
            node,
            self._graph,
            self._document,
        )
        if function_definition is not None:
            return function_definition
        definition = self._registry.definition(node.type_key.root)
        if definition is None:
            raise SchedulerFailure(
                SchedulerFailureCode.NODE_DEFINITION_MISSING,
                node_id=node.node_id,
            )
        return definition

    def _check_pre_dispatch(self) -> None:
        self._cancellation.raise_if_cancelled()
        self._check_time()

    def _check_time(self) -> None:
        if self._clock.now() >= self._deadline:
            raise SchedulerFailure(SchedulerFailureCode.TIME_LIMIT)

    def _check_step_limit(self, node_id: UUID) -> None:
        if self._step_count >= self._limits.max_node_steps:
            raise SchedulerFailure(
                SchedulerFailureCode.STEP_LIMIT,
                node_id=node_id,
            )

    def _reserve_events(self, count: int) -> None:
        if self._event_count + count > self._limits.max_events - 1:
            raise SchedulerFailure(SchedulerFailureCode.EVENT_LIMIT)

    def _emit(
        self,
        kind: SchedulerEventKind,
        *,
        token_id: int | None = None,
        activation: NodeActivation | None = None,
        node_id: UUID | None = None,
        edge_id: UUID | None = None,
        output_port_id: str | None = None,
        output_port_ids: tuple[str, ...] = (),
        error_code: str | None = None,
    ) -> None:
        self._reserve_events(1)
        event = SchedulerEvent(
            sequence=self._event_count + 1,
            kind=kind,
            run_id=self._run_id,
            token_id=token_id,
            activation_id=(
                activation.activation_id if activation is not None else None
            ),
            node_id=activation.node_id if activation is not None else node_id,
            edge_id=edge_id,
            output_port_id=output_port_id,
            output_port_ids=output_port_ids,
            error_code=error_code,
        )
        self._events.append(event)
        self._event_count += 1
        self._observer.on_event(event)

    def _finish(
        self,
        status: RunStatus,
        terminal_error: SchedulerTerminalError | None = None,
    ) -> RunSnapshot:
        kind = {
            RunStatus.SUCCEEDED: SchedulerEventKind.RUN_SUCCEEDED,
            RunStatus.FAILED: SchedulerEventKind.RUN_FAILED,
            RunStatus.CANCELLED: SchedulerEventKind.RUN_CANCELLED,
        }[status]
        if self._event_count >= self._limits.max_events:
            raise RuntimeError("Scheduler terminal event capacity was not reserved.")
        event = SchedulerEvent(
            sequence=self._event_count + 1,
            kind=kind,
            run_id=self._run_id,
            error_code=(terminal_error.code if terminal_error is not None else None),
        )
        self._events.append(event)
        self._event_count += 1
        self._observer.on_event(event)
        return RunSnapshot(
            run_id=self._run_id,
            graph_id=self._graph.graph_id,
            frame_id=self._frame_id,
            status=status,
            step_count=self._step_count,
            tokens_created=self._tokens_created,
            tokens=tuple(self._token_history),
            activations=tuple(self._activation_history),
            events=tuple(self._events),
            values=tuple(self._value_history),
            logs=tuple(self._logs),
            pure_cache_hits=self._pure_cache_hits,
            terminal_error=terminal_error,
            persistent_variable_updates=(
                () if self._is_function_graph else self._variables.persistent_updates()
            ),
            function_return_values=tuple(self._function_return_values.items()),
            stored_value_count=self._stored_value_count,
            stored_log_count=self._stored_log_count,
        )


def _runtime_value_from_json(value: object) -> RuntimeValue:
    unwrapped = _unwrap_json(value)
    if unwrapped is None or isinstance(unwrapped, bool | int | float | str):
        if isinstance(unwrapped, float) and not math.isfinite(unwrapped):
            raise SchedulerFailure(SchedulerFailureCode.LITERAL_UNSUPPORTED)
        return unwrapped
    if isinstance(unwrapped, list):
        source = cast("list[object]", unwrapped)
        return tuple(_runtime_value_from_json(item) for item in source)
    raise SchedulerFailure(SchedulerFailureCode.LITERAL_UNSUPPORTED)


def _runtime_value_matches_kind(
    value_kind: VariableValueKindV1,
    value: RuntimeValue,
) -> bool:
    if value_kind is VariableValueKindV1.bool:
        return isinstance(value, bool)
    if value_kind is VariableValueKindV1.number:
        if isinstance(value, bool) or not isinstance(value, int | float):
            return False
        try:
            return math.isfinite(float(value))
        except OverflowError:
            return False
    if value_kind is VariableValueKindV1.string:
        return isinstance(value, str)
    if value_kind is VariableValueKindV1.point:
        return isinstance(value, RuntimePoint)
    if value_kind is VariableValueKindV1.rect:
        return isinstance(value, RuntimeRect)
    if value_kind is VariableValueKindV1.image_ref:
        return isinstance(value, RuntimeImageReference)
    return False


def _unwrap_json(value: object) -> object:
    if isinstance(value, BaseModel):
        return _unwrap_json(value.model_dump(mode="python", by_alias=True))
    if isinstance(value, dict):
        source = cast("dict[object, object]", value)
        result: dict[str, object] = {}
        for key, item in source.items():
            if not isinstance(key, str):
                raise SchedulerFailure(SchedulerFailureCode.LITERAL_UNSUPPORTED)
            result[key] = _unwrap_json(item)
        return result
    if isinstance(value, list | tuple):
        source = cast("list[object] | tuple[object, ...]", value)
        return [_unwrap_json(item) for item in source]
    return value
