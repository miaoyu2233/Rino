"""Typed message union over the generated envelope models.

The generator emits one model per canonical definition. This module composes the four
envelope models into the single union the transport layer parses, so generated artifacts
stay untouched while the runtime works with one message type.
"""

from typing import Any, Final

from pydantic import BaseModel, TypeAdapter

from rino_runtime.contracts.generated.rino_ipc_v1 import (
    ErrorResponseEnvelopeV1,
    EventEnvelopeV1,
    ProtocolErrorV1,
    RequestEnvelopeV1,
    SuccessResponseEnvelopeV1,
)

type IpcMessageV1 = (
    RequestEnvelopeV1
    | SuccessResponseEnvelopeV1
    | ErrorResponseEnvelopeV1
    | EventEnvelopeV1
)
type ResponseEnvelopeV1 = SuccessResponseEnvelopeV1 | ErrorResponseEnvelopeV1

IPC_MESSAGE_ADAPTER: Final[TypeAdapter[IpcMessageV1]] = TypeAdapter(IpcMessageV1)


def parse_message(frame_body: bytes | str) -> IpcMessageV1:
    """Parses one wire frame body into a validated envelope.

    Wire text is parsed rather than Python objects so strict validation still
    accepts the JSON string forms of identifiers, and so the trust boundary sees
    exactly the bytes the peer sent.
    """
    return IPC_MESSAGE_ADAPTER.validate_json(frame_body, strict=True)


def dump_model(model: BaseModel) -> dict[str, Any]:
    """Dumps a nested contract model to its canonical JSON shape.

    Absent optional fields are omitted rather than emitted as null. A nested model is
    materialized into an envelope before the envelope itself is serialized, so omitting
    them here is what keeps the embedded object schema-valid.
    """
    return model.model_dump(mode="json", by_alias=True, exclude_none=True)


def serialize_message(message: IpcMessageV1) -> str:
    """Serializes one envelope to canonical wire text.

    Absent optional fields are omitted rather than emitted as null, because the
    canonical schema types them by their present form and rejects null.
    """
    return IPC_MESSAGE_ADAPTER.dump_json(
        message,
        by_alias=True,
        exclude_none=True,
    ).decode("utf-8")


__all__ = [
    "IPC_MESSAGE_ADAPTER",
    "ErrorResponseEnvelopeV1",
    "EventEnvelopeV1",
    "IpcMessageV1",
    "ProtocolErrorV1",
    "RequestEnvelopeV1",
    "ResponseEnvelopeV1",
    "SuccessResponseEnvelopeV1",
    "dump_model",
    "parse_message",
    "serialize_message",
]
