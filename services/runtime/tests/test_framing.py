from __future__ import annotations

import pytest

from rino_runtime.ipc import FrameDecoder, FrameError, FrameErrorKind, encode_frame

FRAME_LIMIT = 1024


def test_every_fragmentation_boundary_decodes_the_same_body() -> None:
    frame = encode_frame('{"value":1}', FRAME_LIMIT)

    for split in range(len(frame) + 1):
        decoder = FrameDecoder(FRAME_LIMIT)
        bodies = decoder.push(frame[:split])
        bodies.extend(decoder.push(frame[split:]))

        assert bodies == ['{"value":1}']
        decoder.finish()


def test_multiple_frames_in_one_chunk_decode_in_order() -> None:
    combined = encode_frame('{"n":1}', FRAME_LIMIT) + encode_frame(
        '{"n":2}', FRAME_LIMIT
    )
    decoder = FrameDecoder(FRAME_LIMIT)

    assert decoder.push(combined) == ['{"n":1}', '{"n":2}']
    decoder.finish()


def test_non_ascii_body_length_counts_bytes_not_characters() -> None:
    body = '{"text":"识别数值"}'
    frame = encode_frame(body, FRAME_LIMIT)
    decoder = FrameDecoder(FRAME_LIMIT)

    assert b"Content-Length: " + str(len(body.encode("utf-8"))).encode() in frame
    assert decoder.push(frame) == [body]


def test_malformed_header_poisons_the_decoder() -> None:
    decoder = FrameDecoder(FRAME_LIMIT)

    with pytest.raises(FrameError) as first:
        decoder.push(b"Content-Length: notanumber\r\n\r\n")
    assert first.value.kind is FrameErrorKind.MALFORMED_HEADER

    with pytest.raises(FrameError) as second:
        decoder.push(b"ignored")
    assert second.value.kind is FrameErrorKind.DECODER_POISONED


def test_missing_content_length_prefix_is_rejected() -> None:
    decoder = FrameDecoder(FRAME_LIMIT)

    with pytest.raises(FrameError) as error:
        decoder.push(b"X-Other: 3\r\n\r\nabc")
    assert error.value.kind is FrameErrorKind.MALFORMED_HEADER


def test_oversized_declared_length_is_rejected_before_the_body_arrives() -> None:
    decoder = FrameDecoder(FRAME_LIMIT)

    with pytest.raises(FrameError) as error:
        decoder.push(f"Content-Length: {FRAME_LIMIT + 1}\r\n\r\n".encode("ascii"))
    assert error.value.kind is FrameErrorKind.FRAME_TOO_LARGE


def test_oversized_header_without_terminator_is_rejected() -> None:
    decoder = FrameDecoder(FRAME_LIMIT)

    with pytest.raises(FrameError) as error:
        decoder.push(b"Content-Length: " + b"0" * 200)
    assert error.value.kind is FrameErrorKind.HEADER_TOO_LARGE


def test_invalid_utf8_body_is_rejected() -> None:
    decoder = FrameDecoder(FRAME_LIMIT)

    with pytest.raises(FrameError) as error:
        decoder.push(b"Content-Length: 1\r\n\r\n\xff")
    assert error.value.kind is FrameErrorKind.INVALID_UTF8


def test_stream_ending_mid_frame_is_reported_as_truncated() -> None:
    decoder = FrameDecoder(FRAME_LIMIT)

    assert decoder.push(b"Content-Length: 5\r\n\r\nabc") == []
    with pytest.raises(FrameError) as error:
        decoder.finish()
    assert error.value.kind is FrameErrorKind.TRUNCATED_FRAME


def test_encoding_a_body_larger_than_the_limit_is_rejected() -> None:
    with pytest.raises(FrameError) as error:
        encode_frame("x" * (FRAME_LIMIT + 1), FRAME_LIMIT)
    assert error.value.kind is FrameErrorKind.FRAME_TOO_LARGE


def test_frame_errors_never_include_peer_bytes() -> None:
    decoder = FrameDecoder(FRAME_LIMIT)

    with pytest.raises(FrameError) as error:
        decoder.push(b"Content-Length: secret-token-value\r\n\r\n")

    assert "secret-token-value" not in error.value.detail
