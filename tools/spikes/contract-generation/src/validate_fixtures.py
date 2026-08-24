from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Never, Protocol, cast

from jsonschema import Draft202012Validator, FormatChecker
from pydantic import TypeAdapter, ValidationError

from generated.python.protocol_envelope_v1 import RinoProtocolEnvelopeV1

PROJECT_ROOT = Path(__file__).resolve().parents[1]
type JsonValue = (
    bool | int | float | str | list[JsonValue] | dict[str, JsonValue] | None
)


class JsonValueValidator(Protocol):
    def is_valid(self, instance: JsonValue) -> bool: ...


@dataclass(frozen=True)
class FixtureCase:
    file: str
    valid: bool


def reject_non_finite_constant(value: str) -> Never:
    raise ValueError(f"Non-finite JSON number is not allowed: {value}.")


def parse_json(content: str) -> JsonValue:
    return cast(
        JsonValue,
        json.loads(content, parse_constant=reject_non_finite_constant),
    )


def read_object(path: Path) -> dict[str, JsonValue]:
    value = parse_json(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"Expected a JSON object in {path.name}.")
    mapping = cast(dict[object, JsonValue], value)
    if not all(isinstance(key, str) for key in mapping):
        raise RuntimeError(f"Expected string keys in {path.name}.")
    return {cast(str, key): item for key, item in mapping.items()}


def read_manifest() -> tuple[FixtureCase, ...]:
    manifest = read_object(PROJECT_ROOT / "fixtures" / "manifest.json")
    raw_cases = manifest.get("cases")
    if not isinstance(raw_cases, list):
        raise RuntimeError("Fixture manifest cases must be an array.")
    cases: list[FixtureCase] = []
    for raw_case in cast(list[JsonValue], raw_cases):
        if not isinstance(raw_case, dict):
            raise RuntimeError("Fixture case must be an object.")
        case_mapping = cast(dict[object, JsonValue], raw_case)
        file = case_mapping.get("file")
        valid = case_mapping.get("valid")
        if not isinstance(file, str) or not isinstance(valid, bool):
            raise RuntimeError("Fixture case fields are invalid.")
        cases.append(FixtureCase(file=file, valid=valid))
    return tuple(cases)


def main() -> int:
    try:
        parse_json('{"value":NaN}')
    except ValueError:
        pass
    else:
        raise RuntimeError("Python JSON parsing accepted a non-finite number.")

    schema = read_object(PROJECT_ROOT / "schemas" / "protocol-envelope-v1.schema.json")
    Draft202012Validator.check_schema(schema)
    schema_validator = cast(
        JsonValueValidator,
        Draft202012Validator(
            schema,
            format_checker=FormatChecker(),
        ),
    )
    model_adapter = TypeAdapter(RinoProtocolEnvelopeV1)
    valid_case_count = 0
    invalid_case_count = 0

    for fixture_case in read_manifest():
        fixture = read_object(PROJECT_ROOT / "fixtures" / fixture_case.file)
        schema_accepted = schema_validator.is_valid(fixture)
        try:
            model = model_adapter.validate_json(
                json.dumps(fixture, separators=(",", ":")),
                strict=True,
            )
        except ValidationError:
            model_accepted = False
        else:
            model_accepted = True
            round_trip = parse_json(
                json.dumps(
                    model_adapter.dump_python(
                        model,
                        mode="json",
                        by_alias=True,
                    ),
                    separators=(",", ":"),
                )
            )
            if not schema_validator.is_valid(round_trip):
                raise RuntimeError(f"Python round trip failed for {fixture_case.file}.")

        if schema_accepted != fixture_case.valid:
            raise RuntimeError(
                f"Python schema validation disagreed for {fixture_case.file}."
            )
        if model_accepted != fixture_case.valid:
            raise RuntimeError(
                f"Generated Python model disagreed for {fixture_case.file}."
            )
        if fixture_case.valid:
            valid_case_count += 1
        else:
            invalid_case_count += 1

    print(
        json.dumps(
            {
                "invalidCaseCount": invalid_case_count,
                "language": "python",
                "totalCaseCount": valid_case_count + invalid_case_count,
                "validCaseCount": valid_case_count,
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
