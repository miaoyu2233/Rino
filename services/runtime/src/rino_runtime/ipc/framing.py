"""Content-Length framing for the local stdio protocol.

The decoder is incremental because a pipe read can deliver a partial header, several
frames at once, or a frame split at any byte boundary. Every limit is checked before
allocation so a malicious or defective peer cannot force unbounded buffering.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Final

HEADER_TERMINATOR: Final[bytes] = b"\r\n\r\n"
HEADER_PREFIX: Final[bytes] = b"Content-Length: "
MAXIMUM_HEADER_BYTES: Final[int] = 128


class FrameErrorKind(StrEnum):
    MALFORMED_HEADER = "malformedHeader"
    HEADER_TOO_LARGE = "headerTooLarge"
    FRAME_TOO_LARGE = "frameTooLarge"
    INVALID_UTF8 = "invalidUtf8"
    TRUNCATED_FRAME = "truncatedFrame"
    DECODER_POISONED = "decoderPoisoned"


class FrameError(Exception):
    """A transport-level framing failure.

    The message is a fixed technical string; peer bytes are never interpolated, so a
    diagnostic can be logged without leaking payload content.
    """

    def __init__(self, kind: FrameErrorKind, detail: str) -> None:
        super().__init__(detail)
        self.kind = kind
        self.detail = detail


def encode_frame(body: str, maximum_frame_bytes: int) -> bytes:
    """Encodes one message body into a length-prefixed frame."""
    encoded = body.encode("utf-8")
    if len(encoded) > maximum_frame_bytes:
        raise FrameError(
            FrameErrorKind.FRAME_TOO_LARGE,
            "The encoded frame exceeds the negotiated frame limit.",
        )
    return (
        HEADER_PREFIX + str(len(encoded)).encode("ascii") + HEADER_TERMINATOR + encoded
    )


class FrameDecoder:
    """Incremental decoder that yields complete frame bodies.

    A framing failure poisons the decoder: the byte stream position is no longer known,
    so continuing to parse could silently reinterpret payload bytes as headers.
    """

    def __init__(self, maximum_frame_bytes: int) -> None:
        self._maximum_frame_bytes = maximum_frame_bytes
        self._buffer = bytearray()
        self._expected_body_bytes: int | None = None
        self._poisoned = False

    @property
    def poisoned(self) -> bool:
        return self._poisoned

    @property
    def maximum_frame_bytes(self) -> int:
        return self._maximum_frame_bytes

    @maximum_frame_bytes.setter
    def maximum_frame_bytes(self, value: int) -> None:
        """Adopts a frame limit negotiated after the decoder was created.

        A frame already accepted under the previous limit is unaffected; the new limit
        applies to every header parsed from this point on.
        """
        self._maximum_frame_bytes = value

    def push(self, chunk: bytes) -> list[str]:
        """Adds received bytes and returns every complete frame body they produced."""
        if self._poisoned:
            raise FrameError(
                FrameErrorKind.DECODER_POISONED,
                "The frame decoder rejected an earlier frame and cannot resynchronize.",
            )
        self._buffer.extend(chunk)
        try:
            return self._decode_available()
        except FrameError:
            self._poisoned = True
            raise

    def finish(self) -> None:
        """Asserts that the stream ended on a frame boundary."""
        if self._poisoned:
            raise FrameError(
                FrameErrorKind.DECODER_POISONED,
                "The frame decoder rejected an earlier frame and cannot resynchronize.",
            )
        if self._buffer or self._expected_body_bytes is not None:
            self._poisoned = True
            raise FrameError(
                FrameErrorKind.TRUNCATED_FRAME,
                "The input stream ended in the middle of a frame.",
            )

    def _decode_available(self) -> list[str]:
        bodies: list[str] = []
        while True:
            if self._expected_body_bytes is None:
                parsed_length = self._parse_header()
                if parsed_length is None:
                    return bodies
                self._expected_body_bytes = parsed_length
            body_bytes = self._expected_body_bytes
            if len(self._buffer) < body_bytes:
                return bodies
            body = bytes(self._buffer[:body_bytes])
            del self._buffer[:body_bytes]
            self._expected_body_bytes = None
            try:
                bodies.append(body.decode("utf-8", errors="strict"))
            except UnicodeDecodeError as error:
                raise FrameError(
                    FrameErrorKind.INVALID_UTF8,
                    "The frame body is not valid UTF-8.",
                ) from error

    def _parse_header(self) -> int | None:
        terminator_index = self._buffer.find(HEADER_TERMINATOR)
        if terminator_index < 0:
            if len(self._buffer) > MAXIMUM_HEADER_BYTES:
                raise FrameError(
                    FrameErrorKind.HEADER_TOO_LARGE,
                    "The frame header exceeds its byte limit.",
                )
            return None
        if terminator_index > MAXIMUM_HEADER_BYTES:
            raise FrameError(
                FrameErrorKind.HEADER_TOO_LARGE,
                "The frame header exceeds its byte limit.",
            )

        header = bytes(self._buffer[:terminator_index])
        if not header.startswith(HEADER_PREFIX):
            raise FrameError(
                FrameErrorKind.MALFORMED_HEADER,
                "The frame header is missing its Content-Length prefix.",
            )
        length_text = header[len(HEADER_PREFIX) :]
        if not length_text or not length_text.isdigit():
            raise FrameError(
                FrameErrorKind.MALFORMED_HEADER,
                "The frame header length is not a decimal byte count.",
            )
        body_bytes = int(length_text)
        if body_bytes > self._maximum_frame_bytes:
            raise FrameError(
                FrameErrorKind.FRAME_TOO_LARGE,
                "The declared frame length exceeds the negotiated frame limit.",
            )

        del self._buffer[: terminator_index + len(HEADER_TERMINATOR)]
        return body_bytes
