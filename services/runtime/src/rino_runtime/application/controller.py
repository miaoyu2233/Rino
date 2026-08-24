"""Authoritative registry, validation, run, and cancellation application service."""

from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Final
from uuid import UUID, uuid4

from rino_runtime.application.persistent_variables import (
    PersistentVariableError,
    decode_initial_persistent_variables,
    encode_persistent_variable_updates,
)
from rino_runtime.application.value_summary import summarize_stored_value
from rino_runtime.contracts import dump_model
from rino_runtime.contracts.generated.rino_graph_v1 import (
    GraphV1,
    RinoProjectDocumentV1,
)
from rino_runtime.errors import RuntimeErrorCode
from rino_runtime.execution_control import CancellationScope
from rino_runtime.graph import (
    GraphDocumentParseError,
    parse_project_document_json,
    validate_project_document,
)
from rino_runtime.nodes import (
    NodeRegistry,
    RuntimeImageReference,
    RuntimeValue,
    build_phase_4_production_registry,
)
from rino_runtime.scheduler import (
    GraphScheduler,
    RunSnapshot,
    RunStatus,
    SchedulerEvent,
    SchedulerEventKind,
    SchedulerLimits,
    SchedulerObserver,
    StoredLog,
    StoredValue,
)

DEFAULT_SCHEDULER_LIMITS: Final[SchedulerLimits] = SchedulerLimits(
    max_node_steps=250_000,
    max_duration_seconds=21_600,
    max_queue_size=4_096,
    max_stored_values=500_000,
    max_stored_logs=50_000,
    max_events=1_000_000,
    max_pure_depth=128,
    max_retained_tokens=20_000,
    max_retained_activations=20_000,
    max_retained_events=50_000,
    max_retained_values=20_000,
    max_retained_logs=10_000,
)
RUNTIME_SHUTDOWN_WAIT_SECONDS: Final[float] = 5.0


@dataclass(frozen=True, slots=True)
class RuntimeApplicationEvent:
    message_type: str
    payload: Mapping[str, object]
    run_id: UUID
    node_id: UUID | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "payload", MappingProxyType(dict(self.payload)))


type RuntimeApplicationEventSink = Callable[[RuntimeApplicationEvent], None]


class RuntimeRequestFailure(RuntimeError):
    def __init__(
        self,
        code: RuntimeErrorCode,
        technical_detail: str,
        *,
        parameters: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(code.value)
        self.code = code
        self.technical_detail = technical_detail
        self.parameters = MappingProxyType(dict(parameters or {}))


@dataclass(frozen=True, slots=True)
class PreparedRun:
    run_id: UUID
    graph_id: UUID
    registry_version: str
    launch: Callable[[], None] = field(repr=False, compare=False)


@dataclass(frozen=True, slots=True)
class PreparedCancellation:
    run_id: UUID
    graph_id: UUID
    already_requested: bool
    state: str
    signal: Callable[[], None] | None = field(
        default=None,
        repr=False,
        compare=False,
    )


@dataclass(slots=True)
class _ActiveRun:
    run_id: UUID
    request_id: UUID | None
    document: RinoProjectDocumentV1
    graph: GraphV1
    device_key: str | None
    project_assets: Mapping[str, RuntimeImageReference]
    initial_variable_values: Mapping[UUID, RuntimeValue]
    thread: threading.Thread | None = None
    loop: asyncio.AbstractEventLoop | None = None
    cancellation: CancellationScope | None = None
    cancel_requested: bool = False
    launched: bool = False


@dataclass(frozen=True, slots=True)
class _CompletedRun:
    run_id: UUID
    graph_id: UUID
    status: RunStatus


class RuntimeApplication:
    """Owns one immutable registry and at most one active graph run."""

    def __init__(
        self,
        event_sink: RuntimeApplicationEventSink,
        *,
        registry: NodeRegistry | None = None,
        scheduler_limits: SchedulerLimits = DEFAULT_SCHEDULER_LIMITS,
        run_id_factory: Callable[[], UUID] = uuid4,
    ) -> None:
        self._event_sink = event_sink
        self._registry = registry or build_phase_4_production_registry()
        self._registry_snapshot = self._registry.snapshot()
        self._scheduler_limits = scheduler_limits
        self._run_id_factory = run_id_factory
        self._lock = threading.Lock()
        self._active: _ActiveRun | None = None
        self._last_completed: _CompletedRun | None = None
        self._closing = False

    @property
    def registry_version(self) -> str:
        return self._registry_snapshot.registry_version

    @property
    def registered_type_keys(self) -> frozenset[str]:
        return self._registry.type_keys

    @property
    def is_run_active(self) -> bool:
        with self._lock:
            return self._active is not None

    def registry_result(self) -> dict[str, object]:
        return {"registry": dump_model(self._registry_snapshot)}

    def validate_document(self, document_value: object) -> dict[str, object]:
        document = self._parse_document(document_value)
        report = validate_project_document(document, self._registry_snapshot)
        return {
            "executable": report.executable,
            "report": dump_model(report.to_contract()),
        }

    def prepare_run(
        self,
        document_value: object,
        graph_id: UUID,
        device_key: str | None,
        request_id: UUID | None = None,
        project_assets: Mapping[str, RuntimeImageReference] | None = None,
        initial_persistent_variables: object = None,
    ) -> PreparedRun:
        document = self._parse_document(document_value)
        available_asset_ids = {str(asset.asset_id) for asset in document.assets}
        supplied_project_assets = dict(project_assets or {})
        if not set(supplied_project_assets) <= available_asset_ids:
            raise RuntimeRequestFailure(
                RuntimeErrorCode.GRAPH_DOCUMENT_INVALID,
                "A prepared project asset is not declared by the project document.",
            )
        report = validate_project_document(document, self._registry_snapshot)
        if not report.executable:
            raise RuntimeRequestFailure(
                RuntimeErrorCode.GRAPH_NOT_EXECUTABLE,
                "The graph document has execution-blocking diagnostics.",
                parameters={"diagnosticCount": len(report.diagnostics)},
            )
        graph = next(
            (
                candidate
                for candidate in document.graphs
                if candidate.graph_id == graph_id
            ),
            None,
        )
        if graph is None:
            raise RuntimeRequestFailure(
                RuntimeErrorCode.GRAPH_NOT_FOUND,
                "The requested graph identifier is not present in the document.",
            )
        if graph.graph_id != document.entry_graph_id or graph.kind.value != "entry":
            raise RuntimeRequestFailure(
                RuntimeErrorCode.GRAPH_NOT_EXECUTABLE,
                "Only the document entry graph can be executed directly.",
            )
        try:
            variable_definitions = (
                document.variables
                if document.variables is not None
                else graph.variables or ()
            )
            initial_variable_values = decode_initial_persistent_variables(
                initial_persistent_variables,
                variable_definitions,
            )
        except PersistentVariableError as error:
            raise RuntimeRequestFailure(
                RuntimeErrorCode.GRAPH_DOCUMENT_INVALID,
                "The run request contains invalid persistent variable values.",
            ) from error

        with self._lock:
            if self._closing:
                raise RuntimeRequestFailure(
                    RuntimeErrorCode.RUNTIME_CLOSING,
                    "The runtime application is closing.",
                )
            if self._active is not None:
                raise RuntimeRequestFailure(
                    RuntimeErrorCode.RUN_ALREADY_ACTIVE,
                    "Only one graph run may be active in the Sidecar.",
                )
            active = _ActiveRun(
                run_id=self._run_id_factory(),
                request_id=request_id,
                document=document.model_copy(deep=True),
                graph=graph.model_copy(deep=True),
                device_key=device_key,
                project_assets=MappingProxyType(supplied_project_assets),
                initial_variable_values=MappingProxyType(initial_variable_values),
            )
            self._active = active

        return PreparedRun(
            run_id=active.run_id,
            graph_id=graph.graph_id,
            registry_version=self.registry_version,
            launch=lambda: self._launch(active),
        )

    def prepare_cancellation(self, run_id: UUID) -> PreparedCancellation:
        with self._lock:
            active = self._active
            if active is not None and active.run_id == run_id:
                already_requested = active.cancel_requested
                active.cancel_requested = True
                return PreparedCancellation(
                    run_id=run_id,
                    graph_id=active.graph.graph_id,
                    already_requested=already_requested,
                    state="cancelling",
                    signal=None if already_requested else lambda: self._signal(active),
                )
            completed = self._last_completed
            if completed is not None and completed.run_id == run_id:
                return PreparedCancellation(
                    run_id=run_id,
                    graph_id=completed.graph_id,
                    already_requested=True,
                    state=completed.status.value,
                )
        raise RuntimeRequestFailure(
            RuntimeErrorCode.RUN_NOT_FOUND,
            "The requested run is not active or retained as the latest completed run.",
        )

    def close(self) -> bool:
        with self._lock:
            if self._closing and self._active is None:
                return True
            self._closing = True
            active = self._active
            if active is not None:
                active.cancel_requested = True
                thread = active.thread
                if thread is None:
                    self._active = None
            else:
                thread = None
        if active is not None and thread is not None:
            self._signal(active)
        if thread is not None and thread is not threading.current_thread():
            thread.join(RUNTIME_SHUTDOWN_WAIT_SECONDS)
        with self._lock:
            current = self._active
            return (
                current is None
                or current.thread is None
                or not current.thread.is_alive()
            )

    def _parse_document(self, document_value: object) -> RinoProjectDocumentV1:
        try:
            source = json.dumps(
                document_value,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            )
            return parse_project_document_json(source)
        except (GraphDocumentParseError, TypeError, ValueError) as error:
            detail = (
                error.technical_detail
                if isinstance(error, GraphDocumentParseError)
                else "/ invalid"
            )
            raise RuntimeRequestFailure(
                RuntimeErrorCode.GRAPH_DOCUMENT_INVALID,
                f"The graph document is structurally invalid: {detail}",
            ) from None

    def _launch(self, active: _ActiveRun) -> None:
        with self._lock:
            if self._active is not active or active.launched:
                return
            active.launched = True
            thread = threading.Thread(
                target=self._run_worker,
                args=(active,),
                name="rino-graph-run",
                daemon=True,
            )
            active.thread = thread
            thread.start()

    def _signal(self, active: _ActiveRun) -> None:
        with self._lock:
            if self._active is not active:
                return
            loop = active.loop
            cancellation = active.cancellation
        if loop is not None and cancellation is not None and loop.is_running():
            loop.call_soon_threadsafe(cancellation.cancel)

    def _run_worker(self, active: _ActiveRun) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        cancellation = CancellationScope()
        with self._lock:
            if self._active is not active:
                loop.close()
                return
            active.loop = loop
            active.cancellation = cancellation
            cancel_requested = active.cancel_requested
        if cancel_requested:
            cancellation.cancel()

        observer = _RuntimeSchedulerObserver(self._event_sink)
        try:
            snapshot = loop.run_until_complete(
                GraphScheduler(
                    active.graph,
                    self._registry,
                    self._scheduler_limits,
                    request_id=active.request_id,
                    run_id=active.run_id,
                    device_key=active.device_key,
                    project_assets=active.project_assets,
                    initial_variable_values=active.initial_variable_values,
                    document=active.document,
                    cancellation=cancellation,
                    observer=observer,
                ).run()
            )
        except Exception:
            self._complete_with_internal_failure(active)
        else:
            self._complete(active, snapshot)
        finally:
            loop.run_until_complete(loop.shutdown_asyncgens())
            asyncio.set_event_loop(None)
            loop.close()

    def _complete(self, active: _ActiveRun, snapshot: RunSnapshot) -> None:
        payload: dict[str, object] = {
            "state": snapshot.status.value,
            "graphId": str(snapshot.graph_id),
            "runSequence": snapshot.events[-1].sequence,
            "stepCount": snapshot.step_count,
            "tokensCreated": snapshot.tokens_created,
            "pureCacheHits": snapshot.pure_cache_hits,
        }
        if snapshot.terminal_error is not None:
            payload["terminalError"] = {
                "code": snapshot.terminal_error.code,
                "messageKey": snapshot.terminal_error.message_key,
                **(
                    {"nodeId": str(snapshot.terminal_error.node_id)}
                    if snapshot.terminal_error.node_id is not None
                    else {}
                ),
                **(
                    {"portId": snapshot.terminal_error.port_id}
                    if snapshot.terminal_error.port_id is not None
                    else {}
                ),
            }
        try:
            payload["persistentVariableUpdates"] = encode_persistent_variable_updates(
                snapshot.persistent_variable_updates
            )
        except PersistentVariableError:
            # The scheduler validates persistent values before marking them dirty. If
            # that invariant ever regresses, do not emit a terminal state that hides
            # the invalid update behind a successful or ordinary failure result.
            self._complete_with_internal_failure(active)
            return
        self._record_completion(active, snapshot.status)
        self._event_sink(
            RuntimeApplicationEvent(
                "run.stateChanged",
                payload,
                active.run_id,
            )
        )

    def _complete_with_internal_failure(self, active: _ActiveRun) -> None:
        self._record_completion(active, RunStatus.FAILED)
        self._event_sink(
            RuntimeApplicationEvent(
                "run.stateChanged",
                {
                    "state": "failed",
                    "graphId": str(active.graph.graph_id),
                    "terminalError": {
                        "code": RuntimeErrorCode.INTERNAL_ERROR.value,
                        "messageKey": "runtime.error.internalError",
                    },
                },
                active.run_id,
            )
        )

    def _record_completion(self, active: _ActiveRun, status: RunStatus) -> None:
        with self._lock:
            if self._active is active:
                self._last_completed = _CompletedRun(
                    active.run_id,
                    active.graph.graph_id,
                    status,
                )
                self._active = None


class _RuntimeSchedulerObserver(SchedulerObserver):
    def __init__(
        self,
        event_sink: RuntimeApplicationEventSink,
    ) -> None:
        self._event_sink = event_sink
        self._summaries: dict[tuple[UUID, str], dict[str, object]] = {}

    def on_values_committed(self, values: tuple[StoredValue, ...]) -> None:
        for value in values:
            self._summaries[(value.node_id, value.port_id)] = summarize_stored_value(
                value
            )

    def on_logs_committed(self, logs: tuple[StoredLog, ...]) -> None:
        for log in logs:
            self._event_sink(
                RuntimeApplicationEvent(
                    "runtime.logCreated",
                    {
                        "logSequence": log.sequence,
                        "activationId": log.activation_id,
                        "level": log.level.value,
                        "message": log.message,
                    },
                    log.run_id,
                    log.node_id,
                )
            )

    def on_event(self, event: SchedulerEvent) -> None:
        if event.kind in {
            SchedulerEventKind.RUN_STARTED,
            SchedulerEventKind.RUN_SUCCEEDED,
            SchedulerEventKind.RUN_FAILED,
            SchedulerEventKind.RUN_CANCELLED,
        }:
            return
        if event.kind is SchedulerEventKind.EDGE_TRAVERSED:
            self._emit_edge(event)
            return
        self._emit_node(event)

    def _emit_edge(self, event: SchedulerEvent) -> None:
        if (
            event.edge_id is None
            or event.token_id is None
            or event.output_port_id is None
        ):
            raise RuntimeError("Scheduler edge event is incomplete.")
        self._event_sink(
            RuntimeApplicationEvent(
                "edge.traversed",
                {
                    "edgeId": str(event.edge_id),
                    "runSequence": event.sequence,
                    "tokenId": event.token_id,
                    "outputPortId": event.output_port_id,
                },
                event.run_id,
                event.node_id,
            )
        )

    def _emit_node(self, event: SchedulerEvent) -> None:
        if (
            event.node_id is None
            or event.token_id is None
            or event.activation_id is None
        ):
            raise RuntimeError("Scheduler node event is incomplete.")
        state = {
            SchedulerEventKind.NODE_STARTED: "running",
            SchedulerEventKind.NODE_COMPLETED: "succeeded",
            SchedulerEventKind.NODE_FAILED: "failed",
        }[event.kind]
        payload: dict[str, object] = {
            "state": state,
            "runSequence": event.sequence,
            "tokenId": event.token_id,
            "activationId": event.activation_id,
        }
        if event.output_port_ids:
            payload["outputPortIds"] = list(event.output_port_ids)
            payload["valueSummaries"] = [
                self._summaries[(event.node_id, port_id)]
                for port_id in event.output_port_ids
            ]
        if event.error_code is not None:
            payload["errorCode"] = event.error_code
        self._event_sink(
            RuntimeApplicationEvent(
                "node.stateChanged",
                payload,
                event.run_id,
                event.node_id,
            )
        )
