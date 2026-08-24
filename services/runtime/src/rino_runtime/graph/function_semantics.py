"""Effective ports for function-only nodes that are not runtime registry entries."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from rino_runtime.contracts.generated.rino_graph_v1 import (
    FunctionParameterV1,
    GraphV1,
    JsonValue1,
    NodeV1,
    RinoProjectDocumentV1,
)
from rino_runtime.contracts.generated.rino_registry_v1 import (
    CapabilityKeyV1,
    NodeDefinitionV1,
    PortDefinitionV1,
    PortDirectionV1,
    PortKindV1,
    RuntimeKindV1,
)

FUNCTION_INPUT_NODE_TYPE = "core.function.input"
FUNCTION_RETURN_NODE_TYPE = "core.function.return"
FUNCTION_CALL_NODE_TYPE = "core.function.call"
_FUNCTION_PORT_LABEL_KEY = "graph.port.groupBoundary"


@dataclass(frozen=True, slots=True)
class InternalNodeDefinition:
    type_version: int = 1
    runtime_kind: RuntimeKindV1 = RuntimeKindV1.execution
    required_capabilities: tuple[CapabilityKeyV1, ...] = ()
    deprecation: object | None = None


@dataclass(frozen=True, slots=True)
class ResolvedFunctionNodeDefinition:
    definition: NodeDefinitionV1 | InternalNodeDefinition
    ports: Mapping[str, PortDefinitionV1]


def is_function_internal_node(type_key: str) -> bool:
    return type_key in {
        FUNCTION_INPUT_NODE_TYPE,
        FUNCTION_RETURN_NODE_TYPE,
        FUNCTION_CALL_NODE_TYPE,
    }


def _property_string(node: NodeV1, key: str) -> str | None:
    value = node.properties.root.get(key)
    if value is None or not isinstance(value.root, JsonValue1):
        return None
    return value.root.root


def _port(
    port_id: str,
    direction: PortDirectionV1,
    port_kind: PortKindV1,
    type_kind: str,
    *,
    required: bool | None = None,
    accepts_literal: bool | None = None,
) -> PortDefinitionV1:
    return PortDefinitionV1.model_validate(
        {
            "portId": port_id,
            "direction": direction.value,
            "portKind": port_kind.value,
            "type": {"kind": type_kind},
            "labelKey": _FUNCTION_PORT_LABEL_KEY,
            "required": required,
            "acceptsLiteral": accepts_literal,
        }
    )


def _add_port(
    ports: dict[str, PortDefinitionV1],
    port: PortDefinitionV1,
    *,
    dynamic: bool = False,
) -> None:
    # Reserved names and duplicate signature ports are diagnosed separately. Keeping the
    # fixed execution port wins here prevents a malformed signature from changing its
    # kind.
    if dynamic and port.port_id.root in {"run", "next"}:
        return
    ports.setdefault(port.port_id.root, port)


def _add_inputs(
    ports: dict[str, PortDefinitionV1],
    parameters: list[FunctionParameterV1],
    accepts_literal: bool,
) -> None:
    for parameter in parameters:
        value_kind = parameter.value_kind.value
        literal_allowed = accepts_literal and value_kind in {"bool", "number", "string"}
        _add_port(
            ports,
            _port(
                parameter.port_id.root,
                PortDirectionV1.input,
                PortKindV1.data,
                value_kind,
                required=True,
                accepts_literal=True if literal_allowed else None,
            ),
            dynamic=True,
        )


def _add_outputs(
    ports: dict[str, PortDefinitionV1],
    parameters: list[FunctionParameterV1],
) -> None:
    for parameter in parameters:
        _add_port(
            ports,
            _port(
                parameter.port_id.root,
                PortDirectionV1.output,
                PortKindV1.data,
                parameter.value_kind.value,
            ),
            dynamic=True,
        )


def _target_graph(
    node: NodeV1,
    document: RinoProjectDocumentV1 | None,
) -> GraphV1 | None:
    target_id = _property_string(node, "functionGraphId")
    if target_id is None or document is None:
        return None
    return next(
        (graph for graph in document.graphs if str(graph.graph_id) == target_id),
        None,
    )


def resolve_function_node_definition(
    node: NodeV1,
    graph: GraphV1,
    document: RinoProjectDocumentV1 | None = None,
) -> ResolvedFunctionNodeDefinition | None:
    """Build validator-only definitions with the current function signatures."""
    type_key = node.type_key.root
    if not is_function_internal_node(type_key):
        return None

    ports: dict[str, PortDefinitionV1] = {}
    if type_key != FUNCTION_INPUT_NODE_TYPE:
        _add_port(
            ports,
            _port("run", PortDirectionV1.input, PortKindV1.execution, "exec"),
        )
    if type_key != FUNCTION_RETURN_NODE_TYPE:
        _add_port(
            ports,
            _port("next", PortDirectionV1.output, PortKindV1.execution, "exec"),
        )

    if type_key == FUNCTION_INPUT_NODE_TYPE:
        if graph.function_signature is not None:
            _add_outputs(ports, graph.function_signature.inputs)
        definition = InternalNodeDefinition(runtime_kind=RuntimeKindV1.entry)
    elif type_key == FUNCTION_RETURN_NODE_TYPE:
        if graph.function_signature is not None:
            _add_inputs(ports, graph.function_signature.outputs, False)
        definition = InternalNodeDefinition()
    else:
        target = _target_graph(node, document)
        if (
            target is not None
            and target.kind.value == "function"
            and target.function_signature is not None
        ):
            _add_inputs(ports, target.function_signature.inputs, True)
            _add_outputs(ports, target.function_signature.outputs)
        definition = InternalNodeDefinition()

    return ResolvedFunctionNodeDefinition(definition, ports)
