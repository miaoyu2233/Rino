"""Explicit node-configuration migration resolution."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import StrEnum

from rino_runtime.contracts.generated.rino_graph_v1 import NodeV1
from rino_runtime.contracts.generated.rino_registry_v1 import NodeDefinitionV1

type NodeMigrationTransform = Callable[[NodeV1], NodeV1]


class NodeResolutionStatus(StrEnum):
    CURRENT = "current"
    MIGRATED = "migrated"
    UNSUPPORTED = "unsupported"


@dataclass(frozen=True, slots=True)
class NodeMigrationStep:
    """One reviewed migration between consecutive versions of one node type."""

    type_key: str
    from_version: int
    to_version: int
    transform: NodeMigrationTransform


@dataclass(frozen=True, slots=True)
class NodeResolution:
    status: NodeResolutionStatus
    node: NodeV1 | None
    definition: NodeDefinitionV1


class NodeMigrationCatalog:
    """Resolves only complete, explicitly registered node migration chains."""

    def __init__(self, steps: Iterable[NodeMigrationStep] = ()) -> None:
        indexed: dict[tuple[str, int], NodeMigrationStep] = {}
        for step in steps:
            if step.from_version < 1 or step.to_version != step.from_version + 1:
                raise ValueError("Node migrations must advance exactly one version.")
            key = (step.type_key, step.from_version)
            if key in indexed:
                raise ValueError("Duplicate node migration step.")
            indexed[key] = step
        self._steps = indexed

    def resolve(
        self,
        node: NodeV1,
        definition: NodeDefinitionV1,
    ) -> NodeResolution:
        type_key = node.type_key.root
        definition_type_key = definition.type_key.root
        if type_key != definition_type_key:
            raise ValueError("Node and definition type keys must match.")
        if node.type_version == definition.type_version:
            return NodeResolution(NodeResolutionStatus.CURRENT, node, definition)
        if node.type_version > definition.type_version:
            return NodeResolution(NodeResolutionStatus.UNSUPPORTED, None, definition)

        migrated = node.model_copy(deep=True)
        original_node_id = migrated.node_id
        while migrated.type_version < definition.type_version:
            step = self._steps.get((type_key, migrated.type_version))
            if step is None:
                return NodeResolution(
                    NodeResolutionStatus.UNSUPPORTED,
                    None,
                    definition,
                )
            transformed = step.transform(migrated.model_copy(deep=True))
            migrated = NodeV1.model_validate(
                transformed.model_dump(
                    mode="python",
                    by_alias=True,
                    exclude_none=True,
                ),
                strict=True,
            )
            if (
                migrated.node_id != original_node_id
                or migrated.type_key.root != type_key
                or migrated.type_version != step.to_version
            ):
                raise ValueError(
                    "Node migration changed identity or produced a wrong version."
                )

        return NodeResolution(NodeResolutionStatus.MIGRATED, migrated, definition)
