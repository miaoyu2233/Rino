from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Final, Never, cast

import pytest
from pydantic import ValidationError

from rino_runtime.contracts import (
    EVENT_FAMILIES,
    REQUEST_FAMILIES,
    describe_message_errors,
    is_valid_message,
    is_valid_payload,
    parse_message,
    serialize_message,
)
from rino_runtime.contracts.generated.rino_ipc_v1_schema import RINO_IPC_V1_SCHEMA
from rino_runtime.contracts.validation import MAXIMUM_DIAGNOSTIC_LENGTH

REPOSITORY_ROOT: Final[Path] = Path(__file__).resolve().parents[3]
FIXTURES_ROOT: Final[Path] = REPOSITORY_ROOT / "contracts" / "fixtures"
CANONICAL_SCHEMA_PATH: Final[Path] = (
    REPOSITORY_ROOT / "contracts" / "ipc" / "rino-ipc-v1.schema.json"
)


def _reject_non_finite(value: str) -> Never:
    raise ValueError(f"Non-finite JSON number is not allowed: {value}.")


def parse_json(content: str) -> object:
    return json.loads(content, parse_constant=_reject_non_finite)


def read_fixture(directory: str, name: str) -> dict[str, Any]:
    value = parse_json((FIXTURES_ROOT / directory / name).read_text(encoding="utf-8"))
    assert isinstance(value, dict)
    return cast("dict[str, Any]", value)


def fixture_names(directory: str) -> list[str]:
    return sorted(path.name for path in (FIXTURES_ROOT / directory).glob("*.json"))


def bound_payload_definition(envelope: dict[str, Any]) -> tuple[bool, str, object]:
    """Resolves the canonical payload definition bound to one envelope."""
    message_kind = envelope.get("messageKind")
    message_type = envelope.get("messageType")
    if not isinstance(message_type, str):
        return (False, "", None)
    if message_kind == "request" and message_type in REQUEST_FAMILIES:
        family = REQUEST_FAMILIES[message_type]
        return (True, family.request_payload, envelope.get("payload"))
    if (
        message_kind == "response"
        and message_type in REQUEST_FAMILIES
        and "result" in envelope
    ):
        family = REQUEST_FAMILIES[message_type]
        return (True, family.result, envelope.get("result"))
    if message_kind == "event" and message_type in EVENT_FAMILIES:
        return (True, EVENT_FAMILIES[message_type], envelope.get("payload"))
    return (False, "", None)


def test_generated_schema_module_matches_canonical_source() -> None:
    canonical = parse_json(CANONICAL_SCHEMA_PATH.read_text(encoding="utf-8"))
    assert canonical == RINO_IPC_V1_SCHEMA


def test_non_finite_numbers_are_rejected_before_schema_validation() -> None:
    with pytest.raises(ValueError, match="Non-finite"):
        parse_json('{"value":NaN}')
    with pytest.raises(ValueError, match="Non-finite"):
        parse_json('{"value":Infinity}')


@pytest.mark.parametrize("name", fixture_names("valid"))
def test_valid_fixture_is_accepted_and_round_trips(name: str) -> None:
    fixture = read_fixture("valid", name)

    assert is_valid_message(fixture)

    definition_known, definition, payload = bound_payload_definition(fixture)
    if definition_known:
        assert is_valid_payload(definition, payload)

    model = parse_message(json.dumps(fixture, separators=(",", ":")))
    round_trip = parse_json(serialize_message(model))
    assert is_valid_message(round_trip)
    assert round_trip == fixture


@pytest.mark.parametrize("name", fixture_names("invalid"))
def test_invalid_fixture_is_rejected_with_bounded_diagnostic(name: str) -> None:
    fixture = read_fixture("invalid", name)

    assert not is_valid_message(fixture)

    diagnostic = describe_message_errors(fixture)
    assert diagnostic
    assert len(diagnostic) <= MAXIMUM_DIAGNOSTIC_LENGTH

    with pytest.raises(ValidationError):
        parse_message(json.dumps(fixture, separators=(",", ":")))


@pytest.mark.parametrize("name", fixture_names("payload-invalid"))
def test_payload_invalid_fixture_passes_envelope_and_fails_payload(name: str) -> None:
    fixture = read_fixture("payload-invalid", name)

    assert is_valid_message(fixture)

    definition_known, definition, payload = bound_payload_definition(fixture)
    assert definition_known
    assert not is_valid_payload(definition, payload)


def test_diagnostics_never_echo_payload_content() -> None:
    fixture = read_fixture("invalid", "request-extra-property.json")
    fixture["payload"] = {"secretToken": "s3cret-value-never-logged"}

    diagnostic = describe_message_errors(fixture)

    assert "s3cret-value-never-logged" not in diagnostic
    assert "secretToken" not in diagnostic
