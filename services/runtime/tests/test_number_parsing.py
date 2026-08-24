"""Explicit locale and rejection behavior for the Parse Number node."""

import pytest

from rino_runtime.nodes.number_parsing import (
    NumberParsingOptions,
    parse_number,
    parse_typed_number,
)


@pytest.mark.parametrize(
    ("text", "options", "expected"),
    [
        ("42", NumberParsingOptions(), 42.0),
        (" -1,234.50 ", NumberParsingOptions(), -1234.5),
        (
            "1.234,5",
            NumberParsingOptions(decimal_separator=",", grouping_separator="."),
            1234.5,
        ),
        (
            "\uff0b\uff11\uff12\uff13\uff0e\uff15",
            NumberParsingOptions(normalize_full_width=True),
            123.5,
        ),
    ],
)
def test_explicit_formats_parse_to_finite_numbers(
    text: str,
    options: NumberParsingOptions,
    expected: float,
) -> None:
    parsed = parse_number(text, options)

    assert parsed is not None
    assert parsed.value == expected


@pytest.mark.parametrize(
    "text",
    ["", "1,23", "12 34", "1.2.3", "42%", "$42", "1 2", "1e309"],
)
def test_ambiguous_or_implicit_formats_are_rejected(text: str) -> None:
    assert parse_number(text, NumberParsingOptions()) is None


def test_sign_full_width_and_bounds_are_opt_in_and_enforced() -> None:
    assert parse_number("-1", NumberParsingOptions(allow_sign=False)) is None
    assert parse_number("\uff11\uff12", NumberParsingOptions()) is None
    assert parse_number("12", NumberParsingOptions(minimum=20, maximum=30)) is None


def test_invalid_separator_and_bound_options_fail_before_execution() -> None:
    with pytest.raises(ValueError, match="must differ"):
        NumberParsingOptions(decimal_separator=".", grouping_separator=".")
    with pytest.raises(ValueError, match="Minimum"):
        NumberParsingOptions(minimum=2, maximum=1)


@pytest.mark.parametrize(
    ("text", "number_type", "expected"),
    [
        ("12", "integer", 12.0),
        ("12.5", "float", 12.5),
        ("42%", "percentage", 0.42),
        ("42\uff05", "percentage", 0.42),
        ("3", "positive", 3.0),
        ("3", "unsignedInteger", 3.0),
    ],
)
def test_typed_numbers_enforce_the_read_value_contract(
    text: str,
    number_type: str,
    expected: float,
) -> None:
    parsed = parse_typed_number(text, NumberParsingOptions(), number_type)

    assert parsed is not None
    assert parsed.value == expected


@pytest.mark.parametrize(
    ("text", "number_type"),
    [
        ("12.5", "integer"),
        ("0", "positive"),
        ("-1", "unsignedInteger"),
        ("42", "percentage"),
        ("NaN", "float"),
    ],
)
def test_typed_numbers_reject_invalid_type_values(text: str, number_type: str) -> None:
    assert parse_typed_number(text, NumberParsingOptions(), number_type) is None
