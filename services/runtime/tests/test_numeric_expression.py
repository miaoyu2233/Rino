"""Unit tests for the bounded numeric-expression grammar."""

from __future__ import annotations

import pytest

from rino_runtime.nodes.numeric_expression import (
    NumericExpressionError,
    evaluate_numeric_expression,
)


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("a + b * c", 8.0),
        ("(a + b) * c", 12.0),
        ("-a + +b", -2.0),
    ],
)
def test_evaluate_numeric_expression_obeys_bounded_grammar(
    expression: str,
    expected: float,
) -> None:
    assert (
        evaluate_numeric_expression(
            expression,
            {"a": 4.0, "b": 2.0, "c": 2.0},
        )
        == expected
    )


@pytest.mark.parametrize(
    "expression",
    [
        "a / 0",
        "missing + 1",
        "a ** b",
        "__import__(a)",
        "(" * 257,
    ],
)
def test_evaluate_numeric_expression_rejects_unsafe_or_invalid_input(
    expression: str,
) -> None:
    with pytest.raises(NumericExpressionError):
        evaluate_numeric_expression(expression, {"a": 4.0, "b": 2.0})
