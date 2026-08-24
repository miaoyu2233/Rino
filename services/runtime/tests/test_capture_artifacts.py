"""Full-resolution confirmed capture artifact tests."""

from __future__ import annotations

import struct
import zlib
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest

from rino_runtime.artifacts import (
    CaptureArtifactError,
    CaptureArtifactErrorCode,
    CaptureArtifactLimits,
    CaptureArtifactScope,
    CaptureRegion,
    CaptureSourceKind,
    ImageArtifact,
)
from rino_runtime.nodes import RuntimeImageReference


def _tokens() -> Iterator[str]:
    for index in range(1, 10):
        yield f"{index:032x}"


def _source() -> ImageArtifact:
    pixels = np.arange(36, dtype=np.uint8).reshape((3, 4, 3))
    reference = RuntimeImageReference(
        handle_id="source-handle",
        width=4,
        height=3,
        coordinate_space_id="source-space",
        generation=5,
        expires_at_monotonic=300.0,
    )
    return ImageArtifact(reference, pixels, int(pixels.nbytes))


def _scope(root: Path, maximum_bytes: int = 4096) -> CaptureArtifactScope:
    tokens = _tokens()
    return CaptureArtifactScope(
        root,
        limits=CaptureArtifactLimits(
            maximum_artifacts=2,
            maximum_encoded_bytes=maximum_bytes,
            maximum_total_bytes=maximum_bytes * 2,
            lifetime_seconds=5.0,
        ),
        token_factory=lambda: next(tokens),
        coordinate_space_factory=lambda: "capture-space",
    )


def _decoded_scanlines(encoded: bytes) -> bytes:
    offset = 8
    compressed = bytearray()
    while offset < len(encoded):
        length = struct.unpack(">I", encoded[offset : offset + 4])[0]
        kind = encoded[offset + 4 : offset + 8]
        payload = encoded[offset + 8 : offset + 8 + length]
        if kind == b"IDAT":
            compressed.extend(payload)
        offset += 12 + length
    return zlib.decompress(compressed)


def test_full_frame_capture_preserves_resolution_and_private_token_path(
    tmp_path: Path,
) -> None:
    root = tmp_path / "captures"
    scope = _scope(root)

    descriptor = scope.create(_source(), region=None)
    encoded = (root / f"{descriptor.capture_token}.png").read_bytes()

    assert descriptor.width == 4
    assert descriptor.height == 3
    assert descriptor.coordinate_space_id == "capture-space"
    assert descriptor.source_kind is CaptureSourceKind.DEVICE_CAPTURE
    assert descriptor.byte_length == len(encoded)
    assert str(root) not in repr(descriptor)
    assert encoded.startswith(b"\x89PNG\r\n\x1a\n")
    scope.close()


def test_region_capture_crops_exact_source_pixels_and_rebases_coordinates(
    tmp_path: Path,
) -> None:
    root = tmp_path / "captures"
    scope = _scope(root)
    descriptor = scope.create(
        _source(),
        region=CaptureRegion(1, 1, 2, 2, "source-space", 5),
    )
    encoded = (root / f"{descriptor.capture_token}.png").read_bytes()

    assert descriptor.width == 2
    assert descriptor.height == 2
    assert descriptor.source_kind is CaptureSourceKind.REGION_CAPTURE
    assert _decoded_scanlines(encoded) == bytes(
        [0, 17, 16, 15, 20, 19, 18, 0, 29, 28, 27, 32, 31, 30]
    )
    scope.close()


@pytest.mark.parametrize(
    "region",
    [
        CaptureRegion(0, 0, 1, 1, "stale-space", 5),
        CaptureRegion(0, 0, 1, 1, "source-space", 4),
        CaptureRegion(3, 2, 2, 2, "source-space", 5),
        CaptureRegion(0, 0, 0, 1, "source-space", 5),
    ],
)
def test_region_capture_rejects_stale_or_out_of_bounds_selection(
    tmp_path: Path,
    region: CaptureRegion,
) -> None:
    scope = _scope(tmp_path / "captures")
    with pytest.raises(CaptureArtifactError) as caught:
        scope.create(_source(), region=region)
    assert caught.value.code is CaptureArtifactErrorCode.INVALID_REQUEST
    scope.close()


def test_capture_scope_enforces_size_release_and_owned_file_cleanup(
    tmp_path: Path,
) -> None:
    root = tmp_path / "captures"
    root.mkdir()
    owned = root / "abcdef0123456789abcdef0123456789.png"
    unrelated = root / "keep.png"
    owned.write_bytes(b"private")
    unrelated.write_bytes(b"keep")
    scope = _scope(root, maximum_bytes=16)
    assert not owned.exists()
    assert unrelated.read_bytes() == b"keep"

    with pytest.raises(CaptureArtifactError) as caught:
        scope.create(_source(), region=None)
    assert caught.value.code is CaptureArtifactErrorCode.TOO_LARGE
    scope.close()
