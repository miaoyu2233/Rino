"""Strict parsing for canonical Rino graph documents."""

from __future__ import annotations

from typing import Final

from pydantic import TypeAdapter, ValidationError

from rino_runtime.contracts.generated.rino_graph_v1 import RinoProjectDocumentV1

MAXIMUM_PARSE_DETAIL_LENGTH: Final[int] = 512
_MAXIMUM_REPORTED_ERRORS: Final[int] = 4
_DOCUMENT_ADAPTER: Final[TypeAdapter[RinoProjectDocumentV1]] = TypeAdapter(
    RinoProjectDocumentV1
)


class GraphDocumentParseError(ValueError):
    """Reports a bounded structural failure without echoing project content."""

    def __init__(self, technical_detail: str) -> None:
        super().__init__(technical_detail)
        self.technical_detail = technical_detail


def parse_project_document_json(source: bytes | str) -> RinoProjectDocumentV1:
    """Parse one canonical project document from its exact JSON wire representation."""
    try:
        return _DOCUMENT_ADAPTER.validate_json(source, strict=True)
    except ValidationError as error:
        raise GraphDocumentParseError(_describe_validation_error(error)) from None


def _describe_validation_error(error: ValidationError) -> str:
    descriptions: list[str] = []
    for entry in error.errors(
        include_url=False,
        include_context=False,
        include_input=False,
    )[:_MAXIMUM_REPORTED_ERRORS]:
        location = entry.get("loc", ())
        path = "/" + "/".join(str(part) for part in location)
        descriptions.append(f"{path} {entry.get('type', 'invalid')}")
    detail = "; ".join(descriptions) or "/ invalid"
    return detail[:MAXIMUM_PARSE_DETAIL_LENGTH]
