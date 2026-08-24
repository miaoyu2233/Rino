"""Bounded arithmetic expression parsing for numeric workflow nodes."""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass

MAXIMUM_NUMERIC_EXPRESSION_LENGTH = 256


class NumericExpressionError(ValueError):
    """Raised when an authored numeric expression is invalid or unsafe."""


@dataclass(frozen=True, slots=True)
class _Token:
    kind: str
    text: str


def evaluate_numeric_expression(
    expression: str,
    variables: Mapping[str, float],
) -> float:
    """Evaluate the allowlisted arithmetic grammar and require a finite result."""

    if not expression or len(expression) > MAXIMUM_NUMERIC_EXPRESSION_LENGTH:
        raise NumericExpressionError("expressionLength")
    parser = _ExpressionParser(_tokenize(expression), variables)
    result = parser.parse()
    if not math.isfinite(result):
        raise NumericExpressionError("nonFiniteResult")
    return result


def _tokenize(expression: str) -> tuple[_Token, ...]:
    tokens: list[_Token] = []
    index = 0
    while index < len(expression):
        character = expression[index]
        if character.isspace():
            index += 1
            continue
        if character in "+-*/()":
            tokens.append(_Token(character, character))
            index += 1
            continue
        if character.isalpha():
            end = index + 1
            while end < len(expression) and expression[end].isalnum():
                end += 1
            tokens.append(_Token("identifier", expression[index:end]))
            index = end
            continue
        if character.isdigit() or character == ".":
            end = index + 1
            decimal_points = 1 if character == "." else 0
            while end < len(expression):
                candidate = expression[end]
                if candidate.isdigit():
                    end += 1
                    continue
                if candidate == "." and decimal_points == 0:
                    decimal_points += 1
                    end += 1
                    continue
                break
            text = expression[index:end]
            if text == ".":
                raise NumericExpressionError("number")
            tokens.append(_Token("number", text))
            index = end
            continue
        raise NumericExpressionError("character")
    tokens.append(_Token("end", ""))
    return tuple(tokens)


class _ExpressionParser:
    def __init__(
        self,
        tokens: tuple[_Token, ...],
        variables: Mapping[str, float],
    ) -> None:
        self._tokens = tokens
        self._variables = variables
        self._index = 0

    def parse(self) -> float:
        value = self._expression()
        if self._current.kind != "end":
            raise NumericExpressionError("trailingToken")
        return value

    @property
    def _current(self) -> _Token:
        return self._tokens[self._index]

    def _take(self, kind: str) -> _Token:
        token = self._current
        if token.kind != kind:
            raise NumericExpressionError("token")
        self._index += 1
        return token

    def _expression(self) -> float:
        value = self._term()
        while self._current.kind in ("+", "-"):
            operator = self._current.kind
            self._index += 1
            operand = self._term()
            value = value + operand if operator == "+" else value - operand
            self._require_finite(value)
        return value

    def _term(self) -> float:
        value = self._factor()
        while self._current.kind in ("*", "/"):
            operator = self._current.kind
            self._index += 1
            operand = self._factor()
            if operator == "/" and operand == 0:
                raise NumericExpressionError("divisionByZero")
            value = value * operand if operator == "*" else value / operand
            self._require_finite(value)
        return value

    def _factor(self) -> float:
        token = self._current
        if token.kind in ("+", "-"):
            self._index += 1
            value = self._factor()
            return value if token.kind == "+" else -value
        if token.kind == "number":
            self._index += 1
            try:
                value = float(token.text)
            except ValueError as error:
                raise NumericExpressionError("number") from error
            self._require_finite(value)
            return value
        if token.kind == "identifier":
            self._index += 1
            value = self._variables.get(token.text)
            if value is None:
                raise NumericExpressionError("identifier")
            self._require_finite(value)
            return value
        if token.kind == "(":
            self._index += 1
            value = self._expression()
            self._take(")")
            return value
        raise NumericExpressionError("factor")

    @staticmethod
    def _require_finite(value: float) -> None:
        if not math.isfinite(value):
            raise NumericExpressionError("nonFiniteResult")
