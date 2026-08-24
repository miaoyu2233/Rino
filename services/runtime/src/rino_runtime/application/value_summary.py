"""Bounded display summaries for runtime-owned values."""

from __future__ import annotations

from typing import Final

from rino_runtime.nodes import (
    RuntimeImageReference,
    RuntimeOcrCandidate,
    RuntimeOcrResult,
    RuntimePoint,
    RuntimeRect,
    RuntimeValue,
)
from rino_runtime.scheduler import StoredValue

MAXIMUM_VALUE_PREVIEW_CHARACTERS: Final[int] = 256
MAXIMUM_SUMMARY_ITEM_COUNT: Final[int] = 1_000_000


def summarize_stored_value(record: StoredValue) -> dict[str, object]:
    kind, preview, truncated, details = _summarize_value(record.value)
    return {
        "portId": record.port_id,
        "generation": record.generation,
        "kind": kind,
        "preview": preview,
        "truncated": truncated,
        **details,
    }


def _summarize_value(
    value: RuntimeValue,
) -> tuple[str, str, bool, dict[str, object]]:
    if value is None:
        return ("null", "", False, {})
    if isinstance(value, bool):
        return ("bool", "true" if value else "false", False, {})
    if isinstance(value, int | float):
        preview, truncated = _bounded_preview(str(value))
        return ("number", preview, truncated, {})
    if isinstance(value, str):
        preview, truncated = _bounded_preview(value)
        return ("string", preview, truncated, {})
    if isinstance(value, RuntimePoint):
        return ("point", f"{value.x}, {value.y}", False, {})
    if isinstance(value, RuntimeRect):
        preview = f"{value.x}, {value.y}, {value.width} x {value.height}"
        return ("rect", preview, False, {})
    if isinstance(value, RuntimeImageReference):
        return (
            "image",
            f"{value.width} x {value.height}",
            False,
            {"width": value.width, "height": value.height},
        )
    if isinstance(value, RuntimeOcrCandidate):
        preview, truncated = _bounded_preview(value.text)
        return ("ocrCandidate", preview, truncated, {})
    if isinstance(value, RuntimeOcrResult):
        preview, truncated = _bounded_preview(
            value.candidates[0].text if value.candidates else ""
        )
        return (
            "ocrResult",
            preview,
            truncated,
            {"itemCount": _bounded_item_count(len(value.candidates))},
        )
    return (
        "collection",
        "",
        False,
        {"itemCount": _bounded_item_count(len(value))},
    )


def _bounded_preview(value: str) -> tuple[str, bool]:
    if len(value) <= MAXIMUM_VALUE_PREVIEW_CHARACTERS:
        return (value, False)
    return (value[:MAXIMUM_VALUE_PREVIEW_CHARACTERS], True)


def _bounded_item_count(value: int) -> int:
    return min(value, MAXIMUM_SUMMARY_ITEM_COUNT)
