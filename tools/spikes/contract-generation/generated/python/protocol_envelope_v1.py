# Generated from schemas/protocol-envelope-v1.schema.json. Do not edit directly.

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, RootModel


class JsonValue1(RootModel[str]):
    root: Annotated[str, Field(max_length=65536, title="JsonValue")]


class Retryability(StrEnum):
    never = "never"
    safe = "safe"
    explicit_confirmation = "explicitConfirmation"


class RinoProtocolEnvelopeV1(
    RootModel[
        Union[
            "RequestEnvelopeV1",
            "SuccessResponseEnvelopeV1",
            "ErrorResponseEnvelopeV1",
            "EventEnvelopeV1",
        ]
    ]
):
    root: Annotated[
        RequestEnvelopeV1
        | SuccessResponseEnvelopeV1
        | ErrorResponseEnvelopeV1
        | EventEnvelopeV1,
        Field(
            description="Version-one local runtime protocol envelope.",
            title="RinoProtocolEnvelopeV1",
        ),
    ]


class ErrorResponseEnvelopeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    protocol_version: Annotated[Literal[1], Field(alias="protocolVersion")]
    message_kind: Annotated[Literal["response"], Field(alias="messageKind")]
    message_type: Annotated[
        str,
        Field(
            alias="messageType",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    request_id: Annotated[UUID, Field(alias="requestId")]
    error: ProtocolErrorV1


class EventEnvelopeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    protocol_version: Annotated[Literal[1], Field(alias="protocolVersion")]
    message_kind: Annotated[Literal["event"], Field(alias="messageKind")]
    message_type: Annotated[
        str,
        Field(
            alias="messageType",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    event_id: Annotated[UUID, Field(alias="eventId")]
    sequence: Annotated[int, Field(ge=0, le=9007199254740991)]
    run_id: Annotated[UUID | None, Field(alias="runId")] = None
    node_id: Annotated[UUID | None, Field(alias="nodeId")] = None
    payload: JsonObject


class JsonObject(RootModel[dict[str, Optional["JsonValue"]]]):
    root: Annotated[dict[str, JsonValue | None], Field(max_length=256)]


class JsonValue(
    RootModel[Optional[Union[bool, float, JsonValue1, "JsonValue2", JsonObject]]]
):
    root: Annotated[
        bool | float | JsonValue1 | JsonValue2 | JsonObject | None,
        Field(title="JsonValue"),
    ]


class JsonValue2(RootModel[list[JsonValue | None]]):
    root: Annotated[list[JsonValue | None], Field(max_length=1024, title="JsonValue")]


class ProtocolErrorV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    code: Annotated[str, Field(pattern="^[A-Z][A-Z0-9_]{2,63}$")]
    message_key: Annotated[
        str,
        Field(
            alias="messageKey",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    parameters: JsonObject
    technical_detail: Annotated[
        str, Field(alias="technicalDetail", max_length=4096, min_length=1)
    ]
    retryability: Retryability


class RequestEnvelopeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    protocol_version: Annotated[Literal[1], Field(alias="protocolVersion")]
    message_kind: Annotated[Literal["request"], Field(alias="messageKind")]
    message_type: Annotated[
        str,
        Field(
            alias="messageType",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    request_id: Annotated[UUID, Field(alias="requestId")]
    payload: JsonObject


class SuccessResponseEnvelopeV1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    protocol_version: Annotated[Literal[1], Field(alias="protocolVersion")]
    message_kind: Annotated[Literal["response"], Field(alias="messageKind")]
    message_type: Annotated[
        str,
        Field(
            alias="messageType",
            max_length=128,
            pattern="^[a-z][a-zA-Z0-9]*(?:\\.[a-z][a-zA-Z0-9]*)+$",
        ),
    ]
    request_id: Annotated[UUID, Field(alias="requestId")]
    result: JsonObject


RinoProtocolEnvelopeV1.model_rebuild()
ErrorResponseEnvelopeV1.model_rebuild()
EventEnvelopeV1.model_rebuild()
JsonObject.model_rebuild()
JsonValue.model_rebuild()
