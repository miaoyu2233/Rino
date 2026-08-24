"""Framed local transport and request dispatch for the Rino runtime sidecar."""

from rino_runtime.ipc.framing import (
    HEADER_TERMINATOR,
    MAXIMUM_HEADER_BYTES,
    FrameDecoder,
    FrameError,
    FrameErrorKind,
    encode_frame,
)

__all__ = [
    "HEADER_TERMINATOR",
    "MAXIMUM_HEADER_BYTES",
    "FrameDecoder",
    "FrameError",
    "FrameErrorKind",
    "encode_frame",
]
