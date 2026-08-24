"""Explicit finite-number parsing for OCR and text automation flows."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, replace

_FULL_WIDTH_TRANSLATION = {
    **{0xFF10 + offset: ord("0") + offset for offset in range(10)},
    0xFF0B: ord("+"),
    0xFF0D: ord("-"),
    0xFF0E: ord("."),
    0xFF0C: ord(","),
}
_UNSUPPORTED_MARKERS = frozenset({"%", chr(0xFF05), "$", "€", "£", "¥", chr(0xFFE5)})


@dataclass(frozen=True, slots=True)
class NumberParsingOptions:
    decimal_separator: str = "."
    grouping_separator: str = ","
    normalize_full_width: bool = False
    allow_sign: bool = True
    minimum: float | None = None
    maximum: float | None = None

    def __post_init__(self) -> None:
        if self.decimal_separator not in {".", ","}:
            raise ValueError("Decimal separator must be a period or comma.")
        if self.grouping_separator not in {"", ".", ",", " "}:
            raise ValueError("Grouping separator is unsupported.")
        if self.grouping_separator == self.decimal_separator:
            raise ValueError("Decimal and grouping separators must differ.")
        for bound in (self.minimum, self.maximum):
            if bound is not None and not math.isfinite(bound):
                raise ValueError("Number bounds must be finite.")
        if (
            self.minimum is not None
            and self.maximum is not None
            and self.minimum > self.maximum
        ):
            raise ValueError("Minimum cannot exceed maximum.")


@dataclass(frozen=True, slots=True)
class ParsedNumber:
    value: float
    normalized_text: str


def parse_number(text: str, options: NumberParsingOptions) -> ParsedNumber | None:
    normalized = text.strip()
    if options.normalize_full_width:
        normalized = normalized.translate(_FULL_WIDTH_TRANSLATION)
    if not normalized or any(marker in normalized for marker in _UNSUPPORTED_MARKERS):
        return None
    if not options.allow_sign and normalized[:1] in {"+", "-"}:
        return None

    sign = r"[+-]?" if options.allow_sign else ""
    decimal = re.escape(options.decimal_separator)
    grouping = re.escape(options.grouping_separator)
    if options.grouping_separator:
        integer = rf"(?:[0-9]{{1,3}}(?:{grouping}[0-9]{{3}})+|[0-9]+)"
    else:
        integer = r"[0-9]+"
    pattern = rf"{sign}{integer}(?:{decimal}[0-9]+)?"
    if re.fullmatch(pattern, normalized) is None:
        return None

    canonical = normalized
    if options.grouping_separator:
        canonical = canonical.replace(options.grouping_separator, "")
    if options.decimal_separator != ".":
        canonical = canonical.replace(options.decimal_separator, ".")
    try:
        value = float(canonical)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None
    if options.minimum is not None and value < options.minimum:
        return None
    if options.maximum is not None and value > options.maximum:
        return None
    return ParsedNumber(value=value, normalized_text=canonical)


NUMBER_VALUE_TYPES = frozenset(
    {"integer", "float", "percentage", "positive", "unsignedInteger"}
)


def parse_typed_number(
    text: str,
    options: NumberParsingOptions,
    number_type: str,
) -> ParsedNumber | None:
    """Parse one finite OCR value under the read-value number contract."""

    if number_type not in NUMBER_VALUE_TYPES:
        return None
    parse_text = text
    parse_options = options
    if number_type == "percentage":
        stripped = text.strip()
        if not stripped.endswith(("%", "\uff05")):
            return None
        parse_text = stripped[:-1].rstrip()
        if not parse_text:
            return None
        # Bounds describe the emitted ratio, not the percentage's inner integer.
        parse_options = replace(options, minimum=None, maximum=None)
    parsed = parse_number(parse_text, parse_options)
    if parsed is None:
        return None

    value = parsed.value / 100 if number_type == "percentage" else parsed.value
    if not math.isfinite(value):
        return None
    if number_type == "integer" and not value.is_integer():
        return None
    if number_type == "positive" and value <= 0:
        return None
    if number_type == "unsignedInteger" and (value < 0 or not value.is_integer()):
        return None
    if options.minimum is not None and value < options.minimum:
        return None
    if options.maximum is not None and value > options.maximum:
        return None
    return ParsedNumber(
        value=value,
        normalized_text=(
            format(value, ".15g")
            if number_type == "percentage"
            else parsed.normalized_text
        ),
    )
