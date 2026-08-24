"""Authoritative semantic validation for typed Rino graphs."""

from __future__ import annotations

import unicodedata
from collections.abc import Iterable, Mapping, Set
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from rino_runtime.contracts.generated.rino_diagnostics_v1 import (
    DiagnosticLocationV1,
    DiagnosticSeverityV1,
    GraphDiagnosticCodeV1,
    GraphDiagnosticV1,
    RinoGraphDiagnosticReportV1,
)
from rino_runtime.contracts.generated.rino_graph_v1 import (
    EdgeV1,
    GraphKindV1,
    GraphV1,
    JsonObject,
    JsonValue,
    JsonValue1,
    JsonValue2,
    NodeV1,
    RinoProjectDocumentV1,
    VariableDefinitionV1,
)
from rino_runtime.contracts.generated.rino_registry_v1 import (
    CollectionTypeV1,
    NodeDefinitionV1,
    OptionalTypeV1,
    PortDefinitionV1,
    PortDirectionV1,
    PortKindV1,
    PrimitiveTypeKindV1,
    PrimitiveTypeV1,
    RinoNodeRegistrySnapshotV1,
    RuntimeKindV1,
    TypeDescriptorV1,
)
from rino_runtime.graph.function_semantics import (
    FUNCTION_CALL_NODE_TYPE,
    FUNCTION_INPUT_NODE_TYPE,
    FUNCTION_RETURN_NODE_TYPE,
    InternalNodeDefinition,
    resolve_function_node_definition,
)
from rino_runtime.graph.migrations import (
    NodeMigrationCatalog,
    NodeResolutionStatus,
)

MAXIMUM_GRAPH_DIAGNOSTICS: Final[int] = 2000
_WARNING_CODES: Final[frozenset[GraphDiagnosticCodeV1]] = frozenset(
    {
        GraphDiagnosticCodeV1.node_type_deprecated,
        GraphDiagnosticCodeV1.node_capability_unavailable,
    }
)
_VARIABLE_NODE_VALUE_KINDS: Final[dict[str, str]] = {
    "core.variable.getBool": "bool",
    "core.variable.setBool": "bool",
    "core.variable.getNumber": "number",
    "core.variable.setNumber": "number",
    "core.variable.getString": "string",
    "core.variable.setString": "string",
    "core.variable.getPoint": "point",
    "core.variable.setPoint": "point",
    "core.variable.getRect": "rect",
    "core.variable.setRect": "rect",
    "core.variable.getImageRef": "imageRef",
    "core.variable.setImageRef": "imageRef",
}
_PARALLEL_NODE_TYPE_KEY: Final[str] = "core.flow.parallel"


def _required_click_point_input_ports(input_mode: str | None) -> tuple[str, ...]:
    if input_mode == "coordinates":
        return ("image", "x", "y", "referenceWidth", "referenceHeight")
    if input_mode in {"randomPoints", "sequentialPoints"}:
        return ("points",)
    if input_mode in {"rectCenter", "rectRandom"}:
        return ("rect",)
    return ("point",)


@dataclass(frozen=True, slots=True)
class GraphValidationReport:
    diagnostics: tuple[GraphDiagnosticV1, ...]
    executable: bool

    def to_contract(self) -> RinoGraphDiagnosticReportV1:
        return RinoGraphDiagnosticReportV1.model_validate(
            {
                "schemaVersion": 1,
                "diagnostics": list(self.diagnostics),
            }
        )


@dataclass(frozen=True, slots=True)
class _IndexedNodeDefinition:
    definition: NodeDefinitionV1 | InternalNodeDefinition
    ports: Mapping[str, PortDefinitionV1]


@dataclass(frozen=True, slots=True)
class _FunctionCallReference:
    graph_id: UUID
    node_id: UUID
    target_graph_id: UUID


class _NodeDefinitionIndex:
    def __init__(self, snapshot: RinoNodeRegistrySnapshotV1) -> None:
        definitions: dict[str, _IndexedNodeDefinition] = {}
        for definition in snapshot.definitions:
            type_key = definition.type_key.root
            if type_key in definitions:
                raise ValueError("Duplicate node definition type key.")
            ports: dict[str, PortDefinitionV1] = {}
            for port in definition.ports:
                port_id = port.port_id.root
                if port_id in ports:
                    raise ValueError("Duplicate port identifier in node definition.")
                ports[port_id] = port
            definitions[type_key] = _IndexedNodeDefinition(definition, ports)
        self._definitions = definitions

    def find(self, type_key: str) -> _IndexedNodeDefinition | None:
        return self._definitions.get(type_key)


def _json_string_value(properties: JsonObject, key: str) -> str | None:
    value = properties.root.get(key)
    if value is not None and isinstance(value.root, JsonValue1):
        return value.root.root
    return None


def _json_string_array_value(
    properties: JsonObject,
    key: str,
) -> tuple[str, ...] | None:
    value = properties.root.get(key)
    if value is None or not isinstance(value.root, JsonValue2):
        return None
    values: list[str] = []
    for item in value.root.root:
        if not isinstance(item, JsonValue) or not isinstance(item.root, JsonValue1):
            return None
        values.append(item.root.root)
    return tuple(values)


class GraphValidator:
    """Validates document structure and individual graphs in stable traversal order."""

    def __init__(
        self,
        registry: RinoNodeRegistrySnapshotV1,
        *,
        available_capabilities: Iterable[str] | None = None,
        migrations: NodeMigrationCatalog | None = None,
    ) -> None:
        self._registry = _NodeDefinitionIndex(registry)
        self._available_capabilities: Set[str] | None = (
            frozenset(available_capabilities)
            if available_capabilities is not None
            else None
        )
        self._migrations = migrations or NodeMigrationCatalog()
        self._diagnostics: list[GraphDiagnosticV1] = []

    def validate_structure(
        self, document: RinoProjectDocumentV1
    ) -> tuple[GraphDiagnosticV1, ...]:
        self._diagnostics = []
        self._check_document_structure(document)
        return self._take_diagnostics()

    def validate_graph(
        self,
        graph: GraphV1,
        document: RinoProjectDocumentV1 | None = None,
    ) -> tuple[GraphDiagnosticV1, ...]:
        self._diagnostics = []
        self._check_graph(graph, document)
        return self._take_diagnostics()

    def _take_diagnostics(self) -> tuple[GraphDiagnosticV1, ...]:
        reported = tuple(self._diagnostics)
        self._diagnostics = []
        return reported

    def _report(
        self,
        code: GraphDiagnosticCodeV1,
        location: Mapping[str, object],
        parameters: Mapping[str, str | int] | None = None,
    ) -> None:
        if len(self._diagnostics) >= MAXIMUM_GRAPH_DIAGNOSTICS:
            return
        self._diagnostics.append(_build_diagnostic(code, location, parameters))

    def _check_document_structure(self, document: RinoProjectDocumentV1) -> None:
        if document.variables is not None:
            self._validate_project_variable_definitions(document)

        graph_ids: set[UUID] = set()
        for graph in document.graphs:
            if graph.graph_id in graph_ids:
                self._report(
                    GraphDiagnosticCodeV1.graph_duplicate_graph_id,
                    _graph_location(graph.graph_id),
                )
            graph_ids.add(graph.graph_id)

        if document.entry_graph_id not in graph_ids:
            self._report(
                GraphDiagnosticCodeV1.graph_entry_graph_missing,
                _document_location(),
                {"entryGraphId": str(document.entry_graph_id)},
            )

        for graph in document.graphs:
            self._validate_function_semantics(document, graph)
        self._validate_function_node_semantics(document)

        asset_ids: set[UUID] = set()
        normalized_names: set[str] = set()
        for asset in document.assets:
            if asset.asset_id in asset_ids:
                self._report(
                    GraphDiagnosticCodeV1.document_duplicate_asset_id,
                    _asset_location(asset.asset_id),
                )
            asset_ids.add(asset.asset_id)

            normalized = normalize_asset_name(asset.display_name)
            if normalized in normalized_names:
                self._report(
                    GraphDiagnosticCodeV1.document_duplicate_asset_name,
                    _asset_location(asset.asset_id),
                )
            normalized_names.add(normalized)

    def _validate_function_semantics(
        self,
        document: RinoProjectDocumentV1,
        graph: GraphV1,
    ) -> None:
        is_entry_graph = graph.graph_id == document.entry_graph_id
        if is_entry_graph:
            if graph.kind is not GraphKindV1.entry:
                self._report(
                    GraphDiagnosticCodeV1.graph_entry_kind_invalid,
                    _graph_location(graph.graph_id),
                )
        elif graph.kind is not GraphKindV1.function:
            self._report(
                GraphDiagnosticCodeV1.graph_non_entry_kind_invalid,
                _graph_location(graph.graph_id),
            )

        signature = graph.function_signature
        if graph.kind is GraphKindV1.function and signature is not None:
            parameters = [*signature.inputs, *signature.outputs]

            parameter_ids: set[UUID] = set()
            for parameter in parameters:
                if parameter.parameter_id in parameter_ids:
                    self._report(
                        GraphDiagnosticCodeV1.function_duplicate_parameter_id,
                        _graph_location(graph.graph_id),
                        {"parameterId": str(parameter.parameter_id)},
                    )
                parameter_ids.add(parameter.parameter_id)

            port_ids: set[str] = set()
            for parameter in parameters:
                port_id = parameter.port_id.root
                if port_id in port_ids:
                    self._report(
                        GraphDiagnosticCodeV1.function_duplicate_port_id,
                        _graph_location(graph.graph_id),
                        {"portId": port_id},
                    )
                port_ids.add(port_id)

            for direction, direction_parameters in (
                ("input", signature.inputs),
                ("output", signature.outputs),
            ):
                names: set[str] = set()
                for parameter in direction_parameters:
                    normalized_name = normalize_variable_name(parameter.name)
                    if normalized_name in names:
                        self._report(
                            GraphDiagnosticCodeV1.function_duplicate_parameter_name,
                            _graph_location(graph.graph_id),
                            {"name": parameter.name, "direction": direction},
                        )
                    names.add(normalized_name)

            for parameter in parameters:
                if parameter.port_id.root in {"run", "next"}:
                    self._report(
                        GraphDiagnosticCodeV1.function_parameter_port_reserved,
                        _graph_location(graph.graph_id),
                        {"portId": parameter.port_id.root},
                    )

        if graph.kind is GraphKindV1.function:
            for node in graph.nodes:
                if node.type_key.root == _PARALLEL_NODE_TYPE_KEY:
                    self._report(
                        GraphDiagnosticCodeV1.function_parallel_forbidden,
                        _node_location(graph.graph_id, node.node_id),
                        {"typeKey": node.type_key.root},
                    )

    def _validate_function_node_semantics(
        self,
        document: RinoProjectDocumentV1,
    ) -> None:
        graphs_by_id = {graph.graph_id: graph for graph in document.graphs}
        calls_by_graph: dict[UUID, list[_FunctionCallReference]] = {}

        for graph in document.graphs:
            input_nodes = [
                node
                for node in graph.nodes
                if node.type_key.root == FUNCTION_INPUT_NODE_TYPE
            ]
            return_nodes = [
                node
                for node in graph.nodes
                if node.type_key.root == FUNCTION_RETURN_NODE_TYPE
            ]
            if graph.kind is GraphKindV1.function:
                if not input_nodes:
                    self._report(
                        GraphDiagnosticCodeV1.function_entry_node_missing,
                        _graph_location(graph.graph_id),
                    )
                elif len(input_nodes) > 1:
                    self._report(
                        GraphDiagnosticCodeV1.function_multiple_entry_nodes,
                        _graph_location(graph.graph_id),
                    )
                if not return_nodes:
                    self._report(
                        GraphDiagnosticCodeV1.function_return_node_missing,
                        _graph_location(graph.graph_id),
                    )
            else:
                for node in [*input_nodes, *return_nodes]:
                    self._report(
                        GraphDiagnosticCodeV1.function_node_outside_function,
                        _node_location(graph.graph_id, node.node_id),
                        {"typeKey": node.type_key.root},
                    )

            for node in graph.nodes:
                if node.type_key.root != FUNCTION_CALL_NODE_TYPE:
                    continue
                raw_target = _json_string_value(node.properties, "functionGraphId")
                target_graph_id: UUID | None = None
                if raw_target is not None:
                    try:
                        target_graph_id = UUID(raw_target)
                    except ValueError:
                        target_graph_id = None
                if target_graph_id is None:
                    self._report(
                        GraphDiagnosticCodeV1.function_call_target_missing,
                        _node_location(graph.graph_id, node.node_id),
                    )
                    continue
                target_graph = graphs_by_id.get(target_graph_id)
                if target_graph is None:
                    self._report(
                        GraphDiagnosticCodeV1.function_call_target_missing,
                        _node_location(graph.graph_id, node.node_id),
                    )
                    continue
                if target_graph.kind is not GraphKindV1.function:
                    self._report(
                        GraphDiagnosticCodeV1.function_call_target_not_function,
                        _node_location(graph.graph_id, node.node_id),
                    )
                    continue
                calls_by_graph.setdefault(graph.graph_id, []).append(
                    _FunctionCallReference(
                        graph.graph_id,
                        node.node_id,
                        target_graph_id,
                    )
                )

        def can_reach(
            start_graph_id: UUID,
            target_graph_id: UUID,
            visited: set[UUID],
        ) -> bool:
            if start_graph_id == target_graph_id:
                return True
            if start_graph_id in visited:
                return False
            visited.add(start_graph_id)
            return any(
                can_reach(call.target_graph_id, target_graph_id, visited)
                for call in calls_by_graph.get(start_graph_id, ())
            )

        recursive_calls: set[tuple[UUID, UUID]] = set()
        for graph in document.graphs:
            for call in calls_by_graph.get(graph.graph_id, ()):
                if can_reach(call.target_graph_id, call.graph_id, set()):
                    recursive_calls.add((call.graph_id, call.node_id))
                    self._report(
                        GraphDiagnosticCodeV1.function_recursion_forbidden,
                        _node_location(call.graph_id, call.node_id),
                    )

        entry_graph = graphs_by_id.get(document.entry_graph_id)
        if entry_graph is None:
            return
        visited_depth_states: set[tuple[UUID, int]] = set()
        reported_depth_calls: set[tuple[UUID, UUID]] = set()

        def visit_depth(graph_id: UUID, function_depth: int) -> None:
            state = (graph_id, function_depth)
            if state in visited_depth_states:
                return
            visited_depth_states.add(state)
            for call in calls_by_graph.get(graph_id, ()):
                call_key = (call.graph_id, call.node_id)
                if call_key in recursive_calls:
                    continue
                next_depth = function_depth + 1
                if next_depth > 16:
                    if call_key not in reported_depth_calls:
                        reported_depth_calls.add(call_key)
                        self._report(
                            GraphDiagnosticCodeV1.function_call_depth_exceeded,
                            _node_location(call.graph_id, call.node_id),
                        )
                    continue
                visit_depth(call.target_graph_id, next_depth)

        visit_depth(entry_graph.graph_id, 0)

    def _check_graph(
        self,
        graph: GraphV1,
        document: RinoProjectDocumentV1 | None = None,
    ) -> None:
        if document is not None and document.variables is not None:
            variable_definitions = {
                variable.variable_id: variable for variable in document.variables
            }
        else:
            variable_definitions = self._validate_variable_definitions(graph)
        nodes_by_id: dict[UUID, NodeV1] = {}
        for node in graph.nodes:
            if node.node_id in nodes_by_id:
                self._report(
                    GraphDiagnosticCodeV1.graph_duplicate_node_id,
                    _node_location(graph.graph_id, node.node_id),
                )
            nodes_by_id[node.node_id] = node

        edge_ids: set[UUID] = set()
        for edge in graph.edges:
            if edge.edge_id in edge_ids:
                self._report(
                    GraphDiagnosticCodeV1.graph_duplicate_edge_id,
                    _edge_location(graph.graph_id, edge.edge_id),
                )
            edge_ids.add(edge.edge_id)

        resolved_nodes: dict[UUID, NodeV1] = {}
        for node in graph.nodes:
            resolved = self._validate_node(
                graph,
                node,
                variable_definitions,
                document,
            )
            if resolved is not None:
                resolved_nodes[node.node_id] = resolved

        connection_counts: dict[tuple[UUID, str], int] = {}
        for edge in graph.edges:
            self._validate_edge(
                graph,
                edge,
                nodes_by_id,
                connection_counts,
                document,
            )

        self._detect_multiple_parallel_on_path(graph, nodes_by_id, document)
        self._validate_entry_nodes(graph, nodes_by_id)
        self._validate_required_inputs(
            graph,
            nodes_by_id,
            resolved_nodes,
            document,
        )
        self._detect_pure_data_cycles(graph, nodes_by_id, document)

    def _validate_variable_definitions(
        self,
        graph: GraphV1,
    ) -> dict[UUID, VariableDefinitionV1]:
        definitions: dict[UUID, VariableDefinitionV1] = {}
        normalized_names: set[str] = set()
        for variable in graph.variables or ():
            variable_id = variable.variable_id
            if variable_id in definitions:
                self._report(
                    GraphDiagnosticCodeV1.graph_duplicate_variable_id,
                    _graph_location(graph.graph_id),
                    {"variableId": str(variable_id)},
                )
            else:
                definitions[variable_id] = variable

            normalized_name = normalize_variable_name(variable.name)
            if normalized_name in normalized_names:
                self._report(
                    GraphDiagnosticCodeV1.graph_duplicate_variable_name,
                    _graph_location(graph.graph_id),
                    {"name": variable.name},
                )
            normalized_names.add(normalized_name)

            if variable.value_kind.value == "imageRef" and variable.persistent is True:
                self._report(
                    GraphDiagnosticCodeV1.graph_variable_persistence_unsupported,
                    _graph_location(graph.graph_id),
                    {
                        "variableId": str(variable_id),
                        "name": variable.name,
                        "valueKind": variable.value_kind.value,
                    },
                )
            if graph.kind is GraphKindV1.function and variable.persistent is True:
                self._report(
                    GraphDiagnosticCodeV1.function_persistent_variable_forbidden,
                    _graph_location(graph.graph_id),
                    {
                        "variableId": str(variable_id),
                        "name": variable.name,
                    },
                )
        return definitions

    def _validate_project_variable_definitions(
        self,
        document: RinoProjectDocumentV1,
    ) -> dict[UUID, VariableDefinitionV1]:
        definitions: dict[UUID, VariableDefinitionV1] = {}
        normalized_names: set[str] = set()
        for variable in document.variables or ():
            variable_id = variable.variable_id
            if variable_id in definitions:
                self._report(
                    GraphDiagnosticCodeV1.graph_duplicate_variable_id,
                    _document_location(),
                    {"variableId": str(variable_id)},
                )
            else:
                definitions[variable_id] = variable

            normalized_name = normalize_variable_name(variable.name)
            if normalized_name in normalized_names:
                self._report(
                    GraphDiagnosticCodeV1.graph_duplicate_variable_name,
                    _document_location(),
                    {"name": variable.name},
                )
            normalized_names.add(normalized_name)

            if variable.value_kind.value == "imageRef" and variable.persistent is True:
                self._report(
                    GraphDiagnosticCodeV1.graph_variable_persistence_unsupported,
                    _document_location(),
                    {
                        "variableId": str(variable_id),
                        "name": variable.name,
                        "valueKind": variable.value_kind.value,
                    },
                )
        return definitions

    def _resolve_node_definition(
        self,
        graph: GraphV1,
        node: NodeV1,
        document: RinoProjectDocumentV1 | None,
    ) -> _IndexedNodeDefinition | None:
        internal = resolve_function_node_definition(node, graph, document)
        if internal is not None:
            return _IndexedNodeDefinition(internal.definition, internal.ports)
        return self._registry.find(node.type_key.root)

    def _validate_node(
        self,
        graph: GraphV1,
        node: NodeV1,
        variable_definitions: Mapping[UUID, VariableDefinitionV1],
        document: RinoProjectDocumentV1 | None,
    ) -> NodeV1 | None:
        type_key = node.type_key.root
        function_definition = resolve_function_node_definition(node, graph, document)
        indexed = (
            _IndexedNodeDefinition(
                function_definition.definition,
                function_definition.ports,
            )
            if function_definition is not None
            else self._registry.find(type_key)
        )
        if indexed is None:
            self._report(
                GraphDiagnosticCodeV1.node_type_unknown,
                _node_location(graph.graph_id, node.node_id),
                {"typeKey": type_key},
            )
            return None

        if function_definition is not None:
            resolved = node
        else:
            resolution = self._migrations.resolve(node, indexed.definition)
            if resolution.status is NodeResolutionStatus.UNSUPPORTED:
                self._report(
                    GraphDiagnosticCodeV1.node_type_version_unsupported,
                    _node_location(graph.graph_id, node.node_id),
                    {
                        "typeKey": type_key,
                        "documentVersion": node.type_version,
                        "registryVersion": indexed.definition.type_version,
                    },
                )
                return None
            resolved = resolution.node
            if resolved is None:
                raise AssertionError("A supported node resolution must include a node.")

        if indexed.definition.deprecation is not None:
            self._report(
                GraphDiagnosticCodeV1.node_type_deprecated,
                _node_location(graph.graph_id, node.node_id),
                {"typeKey": type_key},
            )

        self._validate_capabilities(graph, resolved, indexed)
        self._validate_input_values(graph, resolved, indexed)
        self._validate_variable_reference(graph, resolved, variable_definitions)
        return resolved

    def _validate_variable_reference(
        self,
        graph: GraphV1,
        node: NodeV1,
        variable_definitions: Mapping[UUID, VariableDefinitionV1],
    ) -> None:
        expected_kind = _VARIABLE_NODE_VALUE_KINDS.get(node.type_key.root)
        if expected_kind is None:
            return
        raw_variable_id = _json_string_value(node.properties, "variableId")
        if raw_variable_id is None:
            return
        try:
            variable_id = UUID(raw_variable_id)
        except ValueError:
            return
        variable = variable_definitions.get(variable_id)
        if variable is None:
            self._report(
                GraphDiagnosticCodeV1.node_variable_unknown,
                _node_location(graph.graph_id, node.node_id),
                {"variableId": str(variable_id)},
            )
            return
        if variable.value_kind.value != expected_kind:
            self._report(
                GraphDiagnosticCodeV1.node_variable_type_mismatch,
                _node_location(graph.graph_id, node.node_id),
                {
                    "variableId": str(variable_id),
                    "name": variable.name,
                    "valueKind": variable.value_kind.value,
                },
            )

    def _validate_capabilities(
        self,
        graph: GraphV1,
        node: NodeV1,
        indexed: _IndexedNodeDefinition,
    ) -> None:
        if self._available_capabilities is None:
            return
        for capability in indexed.definition.required_capabilities or []:
            capability_name = (
                capability if isinstance(capability, str) else capability.root
            )
            if capability_name not in self._available_capabilities:
                self._report(
                    GraphDiagnosticCodeV1.node_capability_unavailable,
                    _node_location(graph.graph_id, node.node_id),
                    {"typeKey": node.type_key.root, "capability": capability_name},
                )

    def _validate_input_values(
        self,
        graph: GraphV1,
        node: NodeV1,
        indexed: _IndexedNodeDefinition,
    ) -> None:
        for port_id in node.input_values:
            port = indexed.ports.get(port_id)
            if port is None:
                self._report(
                    GraphDiagnosticCodeV1.node_input_value_unknown_port,
                    _port_location(graph.graph_id, node.node_id, port_id),
                    {"typeKey": node.type_key.root},
                )
                continue
            accepts_literal = (
                port.direction is PortDirectionV1.input
                and port.port_kind is PortKindV1.data
                and port.accepts_literal is True
            )
            if not accepts_literal:
                self._report(
                    GraphDiagnosticCodeV1.node_input_value_not_accepted,
                    _port_location(graph.graph_id, node.node_id, port_id),
                    {"typeKey": node.type_key.root},
                )

    def _validate_edge(
        self,
        graph: GraphV1,
        edge: EdgeV1,
        nodes_by_id: Mapping[UUID, NodeV1],
        connection_counts: dict[tuple[UUID, str], int],
        document: RinoProjectDocumentV1 | None,
    ) -> None:
        if edge.source_node_id == edge.target_node_id:
            self._report(
                GraphDiagnosticCodeV1.edge_self_connection,
                _edge_location(graph.graph_id, edge.edge_id),
            )
            return

        source_node = nodes_by_id.get(edge.source_node_id)
        target_node = nodes_by_id.get(edge.target_node_id)
        if source_node is None:
            self._report(
                GraphDiagnosticCodeV1.edge_source_node_missing,
                _edge_location(graph.graph_id, edge.edge_id),
                {"nodeId": str(edge.source_node_id)},
            )
        if target_node is None:
            self._report(
                GraphDiagnosticCodeV1.edge_target_node_missing,
                _edge_location(graph.graph_id, edge.edge_id),
                {"nodeId": str(edge.target_node_id)},
            )
        if source_node is None or target_node is None:
            return

        source_indexed = self._resolve_node_definition(graph, source_node, document)
        target_indexed = self._resolve_node_definition(graph, target_node, document)
        source_port_id = edge.source_port_id.root
        target_port_id = edge.target_port_id.root
        source_port = (
            source_indexed.ports.get(source_port_id)
            if source_indexed is not None
            else None
        )
        target_port = (
            target_indexed.ports.get(target_port_id)
            if target_indexed is not None
            else None
        )

        if source_port is None:
            self._report(
                GraphDiagnosticCodeV1.edge_source_port_missing,
                _edge_location(graph.graph_id, edge.edge_id),
                {"typeKey": source_node.type_key.root, "portId": source_port_id},
            )
        if target_port is None:
            self._report(
                GraphDiagnosticCodeV1.edge_target_port_missing,
                _edge_location(graph.graph_id, edge.edge_id),
                {"typeKey": target_node.type_key.root, "portId": target_port_id},
            )
        if source_port is None or target_port is None:
            return

        if (
            source_port.direction is not PortDirectionV1.output
            or target_port.direction is not PortDirectionV1.input
        ):
            self._report(
                GraphDiagnosticCodeV1.edge_direction_invalid,
                _edge_location(graph.graph_id, edge.edge_id),
            )
            return

        if (
            source_port.port_kind is not target_port.port_kind
            or source_port.port_kind.value != edge.edge_kind.value
        ):
            self._report(
                GraphDiagnosticCodeV1.edge_kind_mismatch,
                _edge_location(graph.graph_id, edge.edge_id),
                {"edgeKind": edge.edge_kind.value},
            )
            return

        if not is_assignable(source_port.type, target_port.type):
            self._report(
                GraphDiagnosticCodeV1.edge_type_incompatible,
                _edge_location(graph.graph_id, edge.edge_id),
                {
                    "sourceType": describe_type(source_port.type),
                    "targetType": describe_type(target_port.type),
                },
            )
            return

        self._count_connection(
            graph,
            edge,
            connection_counts,
            (edge.source_node_id, source_port_id),
            source_port,
        )
        self._count_connection(
            graph,
            edge,
            connection_counts,
            (edge.target_node_id, target_port_id),
            target_port,
        )

    def _count_connection(
        self,
        graph: GraphV1,
        edge: EdgeV1,
        connection_counts: dict[tuple[UUID, str], int],
        key: tuple[UUID, str],
        port: PortDefinitionV1,
    ) -> None:
        used = connection_counts.get(key, 0) + 1
        connection_counts[key] = used
        maximum = maximum_connections(port)
        if maximum is not None and used > maximum:
            self._report(
                GraphDiagnosticCodeV1.edge_cardinality_exceeded,
                _edge_location(graph.graph_id, edge.edge_id),
                {"portId": port.port_id.root, "maximum": maximum},
            )

    def _detect_multiple_parallel_on_path(
        self,
        graph: GraphV1,
        nodes_by_id: Mapping[UUID, NodeV1],
        document: RinoProjectDocumentV1 | None,
    ) -> None:
        execution_adjacency: dict[UUID, list[UUID]] = {}
        for edge in graph.edges:
            if not self._is_valid_execution_edge(edge, nodes_by_id, graph, document):
                continue
            execution_adjacency.setdefault(edge.source_node_id, []).append(
                edge.target_node_id
            )

        entry_nodes = [
            node
            for node in graph.nodes
            if (
                (indexed := self._resolve_node_definition(graph, node, document))
                is not None
                and indexed.definition.runtime_kind is RuntimeKindV1.entry
            )
        ]
        pending: list[tuple[UUID, bool]] = [
            (node.node_id, False) for node in entry_nodes
        ]
        visited: set[tuple[UUID, bool]] = set()
        reported: set[UUID] = set()
        cursor = 0
        while cursor < len(pending):
            node_id, has_seen_parallel = pending[cursor]
            cursor += 1
            state = (node_id, has_seen_parallel)
            if state in visited:
                continue
            visited.add(state)

            node = nodes_by_id.get(node_id)
            if node is None:
                continue
            is_parallel = node.type_key.root == _PARALLEL_NODE_TYPE_KEY
            if is_parallel and has_seen_parallel and node_id not in reported:
                reported.add(node_id)
                self._report(
                    GraphDiagnosticCodeV1.graph_multiple_parallel_on_path,
                    _node_location(graph.graph_id, node_id),
                    {"typeKey": node.type_key.root},
                )

            next_has_seen_parallel = has_seen_parallel or is_parallel
            pending.extend(
                (target_node_id, next_has_seen_parallel)
                for target_node_id in execution_adjacency.get(node_id, ())
            )

    def _is_valid_execution_edge(
        self,
        edge: EdgeV1,
        nodes_by_id: Mapping[UUID, NodeV1],
        graph: GraphV1,
        document: RinoProjectDocumentV1 | None,
    ) -> bool:
        if edge.edge_kind.value != "execution":
            return False
        if edge.source_node_id == edge.target_node_id:
            return False
        source_node = nodes_by_id.get(edge.source_node_id)
        target_node = nodes_by_id.get(edge.target_node_id)
        if source_node is None or target_node is None:
            return False
        source_indexed = self._resolve_node_definition(graph, source_node, document)
        target_indexed = self._resolve_node_definition(graph, target_node, document)
        if source_indexed is None or target_indexed is None:
            return False
        source_port = source_indexed.ports.get(edge.source_port_id.root)
        target_port = target_indexed.ports.get(edge.target_port_id.root)
        if source_port is None or target_port is None:
            return False
        return (
            source_port.direction is PortDirectionV1.output
            and target_port.direction is PortDirectionV1.input
            and source_port.port_kind is PortKindV1.execution
            and target_port.port_kind is PortKindV1.execution
            and is_assignable(source_port.type, target_port.type)
        )

    def _validate_entry_nodes(
        self, graph: GraphV1, nodes_by_id: Mapping[UUID, NodeV1]
    ) -> None:
        if graph.kind is GraphKindV1.function:
            return
        if not nodes_by_id:
            return
        entry_nodes = [
            node
            for node in nodes_by_id.values()
            if (
                (indexed := self._registry.find(node.type_key.root)) is not None
                and indexed.definition.runtime_kind is RuntimeKindV1.entry
            )
        ]
        if not entry_nodes:
            self._report(
                GraphDiagnosticCodeV1.graph_entry_node_missing,
                _graph_location(graph.graph_id),
            )
            return
        for node in entry_nodes[1:]:
            self._report(
                GraphDiagnosticCodeV1.graph_multiple_entry_nodes,
                _node_location(graph.graph_id, node.node_id),
            )

    def _validate_required_inputs(
        self,
        graph: GraphV1,
        nodes_by_id: Mapping[UUID, NodeV1],
        resolved_nodes: Mapping[UUID, NodeV1],
        document: RinoProjectDocumentV1 | None,
    ) -> None:
        satisfied_by_edge = {
            (edge.target_node_id, edge.target_port_id.root) for edge in graph.edges
        }
        for node_id, original_node in nodes_by_id.items():
            node = resolved_nodes.get(node_id)
            indexed = self._resolve_node_definition(graph, original_node, document)
            if node is None or indexed is None:
                continue
            required_port_ids = {
                port.port_id.root
                for port in indexed.ports.values()
                if (
                    port.direction is PortDirectionV1.input
                    and port.port_kind is PortKindV1.data
                    and port.required is True
                )
            }
            if node.type_key.root == "automation.clickPoint":
                input_mode = _json_string_value(node.properties, "inputMode")
                required_port_ids.update(_required_click_point_input_ports(input_mode))
            if node.type_key.root == "core.diagnostic.log":
                segment_kinds = _json_string_array_value(
                    node.properties,
                    "segmentKinds",
                )
                if segment_kinds is None:
                    required_port_ids.add("message")
                else:
                    required_port_ids.update(
                        f"{kind}Part{index}"
                        for index, kind in enumerate(segment_kinds, start=1)
                        if kind in {"text", "number"}
                    )
            for port in indexed.ports.values():
                if (
                    port.direction is not PortDirectionV1.input
                    or port.port_kind is not PortKindV1.data
                    or port.port_id.root not in required_port_ids
                ):
                    continue
                port_id = port.port_id.root
                if (
                    node.node_id,
                    port_id,
                ) not in satisfied_by_edge and port_id not in node.input_values:
                    self._report(
                        GraphDiagnosticCodeV1.node_required_input_missing,
                        _port_location(graph.graph_id, node.node_id, port_id),
                        {"typeKey": node.type_key.root},
                    )

    def _detect_pure_data_cycles(
        self,
        graph: GraphV1,
        nodes_by_id: Mapping[UUID, NodeV1],
        document: RinoProjectDocumentV1 | None,
    ) -> None:
        dependencies: dict[UUID, list[UUID]] = {}
        for edge in graph.edges:
            if edge.edge_kind.value != "data":
                continue
            source = nodes_by_id.get(edge.source_node_id)
            indexed = (
                self._resolve_node_definition(graph, source, document)
                if source is not None
                else None
            )
            if (
                indexed is None
                or indexed.definition.runtime_kind is not RuntimeKindV1.pure
            ):
                continue
            dependencies.setdefault(edge.target_node_id, []).append(edge.source_node_id)

        visiting: set[UUID] = set()
        settled: set[UUID] = set()
        reported: set[UUID] = set()

        def visit(node_id: UUID) -> None:
            if node_id in settled:
                return
            if node_id in visiting:
                if node_id not in reported:
                    reported.add(node_id)
                    self._report(
                        GraphDiagnosticCodeV1.graph_pure_data_cycle,
                        _node_location(graph.graph_id, node_id),
                    )
                return
            visiting.add(node_id)
            for dependency in dependencies.get(node_id, []):
                visit(dependency)
            visiting.remove(node_id)
            settled.add(node_id)

        for node_id in nodes_by_id:
            visit(node_id)


def normalize_asset_name(display_name: str) -> str:
    return unicodedata.normalize("NFKC", display_name).strip().lower()


def normalize_variable_name(name: str) -> str:
    return unicodedata.normalize("NFKC", name).strip().casefold()


def validate_project_document(
    document: RinoProjectDocumentV1,
    registry: RinoNodeRegistrySnapshotV1,
    *,
    available_capabilities: Iterable[str] | None = None,
    migrations: NodeMigrationCatalog | None = None,
) -> GraphValidationReport:
    validator = GraphValidator(
        registry,
        available_capabilities=available_capabilities,
        migrations=migrations,
    )
    diagnostics = [*validator.validate_structure(document)]
    for graph in document.graphs:
        remaining = MAXIMUM_GRAPH_DIAGNOSTICS - len(diagnostics)
        if remaining <= 0:
            break
        diagnostics.extend(validator.validate_graph(graph, document)[:remaining])
    frozen = tuple(diagnostics)
    return GraphValidationReport(
        diagnostics=frozen,
        executable=all(
            diagnostic.severity is not DiagnosticSeverityV1.error
            for diagnostic in frozen
        ),
    )


def maximum_connections(port: PortDefinitionV1) -> int | None:
    if port.port_kind is PortKindV1.data:
        return 1 if port.direction is PortDirectionV1.input else None
    if port.direction is PortDirectionV1.input:
        return None
    return None if port.allows_fan_out is True else 1


def describe_type(type_descriptor: TypeDescriptorV1) -> str:
    value = type_descriptor.root
    if isinstance(value, CollectionTypeV1):
        return f"collection<{describe_type(value.element)}>"
    if isinstance(value, OptionalTypeV1):
        return f"optional<{describe_type(value.value)}>"
    return value.kind.value


def is_assignable(source: TypeDescriptorV1, target: TypeDescriptorV1) -> bool:
    source_value = source.root
    target_value = target.root
    source_is_exec = _is_execution_type(source_value)
    target_is_exec = _is_execution_type(target_value)
    if source_is_exec or target_is_exec:
        return source_is_exec and target_is_exec

    if isinstance(target_value, OptionalTypeV1):
        unwrapped_source = (
            source_value.value if isinstance(source_value, OptionalTypeV1) else source
        )
        return is_assignable(unwrapped_source, target_value.value)
    if isinstance(source_value, OptionalTypeV1):
        return False
    if isinstance(source_value, CollectionTypeV1) and isinstance(
        target_value, CollectionTypeV1
    ):
        return is_assignable(source_value.element, target_value.element)
    return _same_type(source_value, target_value)


def _same_type(
    source: PrimitiveTypeV1 | CollectionTypeV1 | OptionalTypeV1,
    target: PrimitiveTypeV1 | CollectionTypeV1 | OptionalTypeV1,
) -> bool:
    if isinstance(source, CollectionTypeV1) and isinstance(target, CollectionTypeV1):
        return _same_type(source.element.root, target.element.root)
    if isinstance(source, OptionalTypeV1) and isinstance(target, OptionalTypeV1):
        return _same_type(source.value.root, target.value.root)
    if isinstance(source, PrimitiveTypeV1) and isinstance(target, PrimitiveTypeV1):
        return source.kind is target.kind
    return False


def _is_execution_type(
    value: PrimitiveTypeV1 | CollectionTypeV1 | OptionalTypeV1,
) -> bool:
    return isinstance(value, PrimitiveTypeV1) and value.kind is PrimitiveTypeKindV1.exec


def _build_diagnostic(
    code: GraphDiagnosticCodeV1,
    location: Mapping[str, object],
    parameters: Mapping[str, str | int] | None,
) -> GraphDiagnosticV1:
    severity = (
        DiagnosticSeverityV1.warning
        if code in _WARNING_CODES
        else DiagnosticSeverityV1.error
    )
    parts = code.value.lower().split("_")
    camel_case = parts[0] + "".join(part.capitalize() for part in parts[1:])
    return GraphDiagnosticV1.model_validate(
        {
            "code": code.value,
            "severity": severity.value,
            "location": DiagnosticLocationV1.model_validate(dict(location)),
            "messageKey": f"graph.diagnostics.{camel_case}",
            "parameters": dict(parameters or {}),
        }
    )


def _document_location() -> Mapping[str, object]:
    return {"scope": "document"}


def _graph_location(graph_id: UUID) -> Mapping[str, object]:
    return {"scope": "graph", "graphId": str(graph_id)}


def _node_location(graph_id: UUID, node_id: UUID) -> Mapping[str, object]:
    return {"scope": "node", "graphId": str(graph_id), "nodeId": str(node_id)}


def _port_location(graph_id: UUID, node_id: UUID, port_id: str) -> Mapping[str, object]:
    return {
        "scope": "port",
        "graphId": str(graph_id),
        "nodeId": str(node_id),
        "portId": port_id,
    }


def _edge_location(graph_id: UUID, edge_id: UUID) -> Mapping[str, object]:
    return {"scope": "edge", "graphId": str(graph_id), "edgeId": str(edge_id)}


def _asset_location(asset_id: UUID) -> Mapping[str, object]:
    return {"scope": "asset", "assetId": str(asset_id)}
