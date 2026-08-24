"""Canonical schema validation for IPC messages, project documents, and the registry.

Validation is format aware so identifiers and timestamps are enforced, and diagnostics
are bounded so no document or payload content reaches logs or error responses.
"""

from __future__ import annotations

from typing import Any, Final, Protocol, cast

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import ValidationError

from rino_runtime.contracts.generated.rino_graph_v1_schema import RINO_GRAPH_V1_SCHEMA
from rino_runtime.contracts.generated.rino_ipc_v1_schema import RINO_IPC_V1_SCHEMA
from rino_runtime.contracts.generated.rino_registry_v1_schema import (
    RINO_REGISTRY_V1_SCHEMA,
)

MAXIMUM_DIAGNOSTIC_LENGTH: Final[int] = 512
_MAXIMUM_REPORTED_ERRORS: Final[int] = 4


class _SchemaValidator(Protocol):
    def is_valid(self, instance: object) -> bool: ...

    def iter_errors(self, instance: object) -> object: ...


def _build_validator(schema: dict[str, Any]) -> _SchemaValidator:
    Draft202012Validator.check_schema(schema)
    return cast(
        "_SchemaValidator",
        Draft202012Validator(schema, format_checker=FormatChecker()),
    )


_MESSAGE_VALIDATOR: Final[_SchemaValidator] = _build_validator(RINO_IPC_V1_SCHEMA)
_DOCUMENT_VALIDATOR: Final[_SchemaValidator] = _build_validator(RINO_GRAPH_V1_SCHEMA)
_REGISTRY_VALIDATOR: Final[_SchemaValidator] = _build_validator(RINO_REGISTRY_V1_SCHEMA)
_DEFINITION_VALIDATORS: Final[dict[tuple[str, str], _SchemaValidator]] = {}


def _definition_validator(
    contract: str, schema: dict[str, Any], definition: str
) -> _SchemaValidator:
    cached = _DEFINITION_VALIDATORS.get((contract, definition))
    if cached is not None:
        return cached
    if definition not in schema["$defs"]:
        raise KeyError(f"Unknown canonical definition: {contract}.{definition}.")
    definition_schema: dict[str, Any] = {
        "$schema": schema["$schema"],
        "$ref": f"#/$defs/{definition}",
        "$defs": schema["$defs"],
    }
    validator = _build_validator(definition_schema)
    _DEFINITION_VALIDATORS[(contract, definition)] = validator
    return validator


def _describe(validator: _SchemaValidator, value: object) -> str:
    errors = cast(
        "list[ValidationError]",
        list(validator.iter_errors(value)),  # type: ignore[arg-type]
    )
    if not errors:
        return ""
    described = "; ".join(
        f"{_instance_path(error)} {error.validator}"
        for error in errors[:_MAXIMUM_REPORTED_ERRORS]
    )
    return described[:MAXIMUM_DIAGNOSTIC_LENGTH]


def is_valid_message(value: object) -> bool:
    """Reports whether a decoded JSON value satisfies the canonical envelope schema."""
    return _MESSAGE_VALIDATOR.is_valid(value)


def is_valid_payload(definition: str, value: object) -> bool:
    """Reports whether a payload or result satisfies one named canonical definition."""
    return _definition_validator("ipc", RINO_IPC_V1_SCHEMA, definition).is_valid(value)


def describe_message_errors(value: object) -> str:
    """Returns a bounded structural diagnostic that never echoes payload content."""
    return _describe(_MESSAGE_VALIDATOR, value)


def is_valid_project_document(value: object) -> bool:
    """Reports whether a value satisfies the canonical project document schema."""
    return _DOCUMENT_VALIDATOR.is_valid(value)


def describe_project_document_errors(value: object) -> str:
    """Returns a bounded structural diagnostic that never echoes document content."""
    return _describe(_DOCUMENT_VALIDATOR, value)


def is_valid_graph_definition(definition: str, value: object) -> bool:
    """Reports whether a value satisfies one named definition of the graph schema."""
    return _definition_validator("graph", RINO_GRAPH_V1_SCHEMA, definition).is_valid(
        value
    )


def is_valid_registry_snapshot(value: object) -> bool:
    """Reports whether a value satisfies the canonical registry snapshot schema."""
    return _REGISTRY_VALIDATOR.is_valid(value)


def describe_registry_snapshot_errors(value: object) -> str:
    """Returns a bounded structural diagnostic that never echoes registry content."""
    return _describe(_REGISTRY_VALIDATOR, value)


def is_valid_registry_definition(definition: str, value: object) -> bool:
    """Reports whether a value satisfies one named definition of the registry schema."""
    return _definition_validator(
        "registry", RINO_REGISTRY_V1_SCHEMA, definition
    ).is_valid(value)


def _instance_path(error: ValidationError) -> str:
    if not error.absolute_path:
        return "/"
    return "/" + "/".join(str(part) for part in error.absolute_path)
