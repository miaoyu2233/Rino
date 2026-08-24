"""Encoding, lifetime, and filesystem tests for bounded preview artifacts."""

from __future__ import annotations

import struct
import zlib
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest

from rino_runtime.artifacts import (
    ImageArtifact,
    PreviewArtifactError,
    PreviewArtifactErrorCode,
    PreviewArtifactLimits,
    PreviewArtifactScope,
)
from rino_runtime.nodes import RuntimeImageReference


class _Clock:
    def __init__(self) -> None:
        self.value = 20.0

    def __call__(self) -> float:
        return self.value


def _tokens() -> Iterator[str]:
    for index in range(1, 10):
        yield f"{index:032x}"


def _source(pixels: np.ndarray[tuple[int, ...], np.dtype[np.uint8]]) -> ImageArtifact:
    height, width = pixels.shape[:2]
    reference = RuntimeImageReference(
        handle_id="image-source",
        width=width,
        height=height,
        coordinate_space_id="coordinate-source",
        generation=4,
        expires_at_monotonic=300.0,
    )
    return ImageArtifact(reference, pixels, int(pixels.nbytes))


def _scope(
    root: Path,
    *,
    clock: _Clock | None = None,
    maximum_artifacts: int = 2,
    maximum_encoded_bytes: int = 1024,
) -> PreviewArtifactScope:
    tokens = _tokens()
    return PreviewArtifactScope(
        root,
        limits=PreviewArtifactLimits(
            maximum_artifacts=maximum_artifacts,
            maximum_encoded_bytes=maximum_encoded_bytes,
            maximum_total_bytes=maximum_encoded_bytes * maximum_artifacts,
            lifetime_seconds=5.0,
        ),
        monotonic=clock or _Clock(),
        token_factory=lambda: next(tokens),
    )


def _decoded_scanline(encoded: bytes) -> bytes:
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


def test_preview_is_token_named_bounded_png_with_bgr_converted_to_rgb(
    tmp_path: Path,
) -> None:
    cache = tmp_path / "preview-cache"
    scope = _scope(cache)
    pixels = np.array([[[1, 2, 3], [4, 5, 6]]], dtype=np.uint8)

    descriptor = scope.create(
        _source(pixels),
        maximum_width=160,
        maximum_height=120,
    )
    encoded = (cache / f"{descriptor.preview_token}.png").read_bytes()

    assert descriptor.preview_token == "00000000000000000000000000000001"
    assert descriptor.media_type == "image/png"
    assert descriptor.width == 2
    assert descriptor.height == 1
    assert descriptor.source_width == 2
    assert descriptor.source_height == 1
    assert descriptor.source_coordinate_space_id == "coordinate-source"
    assert descriptor.source_generation == 4
    assert descriptor.byte_length == len(encoded)
    assert descriptor.expires_in_milliseconds == 5000
    assert encoded.startswith(b"\x89PNG\r\n\x1a\n")
    assert _decoded_scanline(encoded) == b"\x00\x03\x02\x01\x06\x05\x04"
    assert scope.resolve_source(descriptor.preview_token) == _source(pixels).reference
    assert "preview-cache" not in repr(descriptor)


def test_preview_downscales_evicts_expires_releases_and_closes(tmp_path: Path) -> None:
    clock = _Clock()
    cache = tmp_path / "preview-cache"
    scope = _scope(cache, clock=clock, maximum_artifacts=1)
    pixels = np.zeros((240, 320, 3), dtype=np.uint8)

    first = scope.create(
        _source(pixels),
        maximum_width=160,
        maximum_height=120,
    )
    assert first.width == 160
    assert first.height == 120
    first_path = cache / f"{first.preview_token}.png"
    assert first_path.is_file()

    second = scope.create(
        _source(pixels),
        maximum_width=160,
        maximum_height=120,
    )
    assert not first_path.exists()
    second_path = cache / f"{second.preview_token}.png"
    assert scope.release(second.preview_token)
    assert not second_path.exists()

    expiring = scope.create(
        _source(pixels),
        maximum_width=160,
        maximum_height=120,
    )
    expiring_path = cache / f"{expiring.preview_token}.png"
    clock.value += 5.0
    replacement = scope.create(
        _source(pixels),
        maximum_width=160,
        maximum_height=120,
    )
    assert not expiring_path.exists()
    replacement_path = cache / f"{replacement.preview_token}.png"
    scope.close()
    assert not replacement_path.exists()

    with pytest.raises(PreviewArtifactError) as expired:
        scope.resolve_source(expiring.preview_token)
    assert expired.value.code is PreviewArtifactErrorCode.SCOPE_CLOSED


def test_preview_accepts_portrait_native_resolution_within_contract_limit(
    tmp_path: Path,
) -> None:
    scope = _scope(
        tmp_path / "preview-cache",
        maximum_encoded_bytes=1024 * 1024,
    )
    pixels = np.zeros((1280, 720, 3), dtype=np.uint8)

    descriptor = scope.create(
        _source(pixels),
        maximum_width=1920,
        maximum_height=1920,
    )

    assert descriptor.width == 720
    assert descriptor.height == 1280


def test_preview_scope_rejects_invalid_or_oversized_requests(tmp_path: Path) -> None:
    scope = _scope(tmp_path / "preview-cache", maximum_encoded_bytes=32)
    pixels = np.arange(300, dtype=np.uint8).reshape((10, 10, 3))

    with pytest.raises(PreviewArtifactError) as invalid:
        scope.create(_source(pixels), maximum_width=159, maximum_height=120)
    assert invalid.value.code is PreviewArtifactErrorCode.INVALID_REQUEST

    with pytest.raises(PreviewArtifactError) as too_tall:
        scope.create(_source(pixels), maximum_width=1920, maximum_height=1921)
    assert too_tall.value.code is PreviewArtifactErrorCode.INVALID_REQUEST

    with pytest.raises(PreviewArtifactError) as oversized:
        scope.create(_source(pixels), maximum_width=160, maximum_height=120)
    assert oversized.value.code is PreviewArtifactErrorCode.TOO_LARGE


def test_startup_cleanup_removes_only_owned_token_files(tmp_path: Path) -> None:
    cache = tmp_path / "preview-cache"
    cache.mkdir()
    owned = cache / "0123456789abcdef0123456789abcdef.png"
    unrelated_png = cache / "not-a-preview.png"
    unrelated_file = cache / "keep.txt"
    owned.write_bytes(b"private")
    unrelated_png.write_bytes(b"keep")
    unrelated_file.write_bytes(b"keep")

    scope = _scope(cache)

    assert not owned.exists()
    assert unrelated_png.read_bytes() == b"keep"
    assert unrelated_file.read_bytes() == b"keep"
    scope.close()


def test_release_reports_storage_failure_without_forgetting_artifact(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache = tmp_path / "preview-cache"
    scope = _scope(cache)
    descriptor = scope.create(
        _source(np.zeros((1, 1, 3), dtype=np.uint8)),
        maximum_width=160,
        maximum_height=120,
    )
    preview_path = cache / f"{descriptor.preview_token}.png"
    original_unlink = Path.unlink

    def fail_owned_unlink(path: Path, *, missing_ok: bool = False) -> None:
        if path == preview_path:
            raise OSError("simulated storage failure")
        original_unlink(path, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", fail_owned_unlink)
    with pytest.raises(PreviewArtifactError) as failure:
        scope.release(descriptor.preview_token)
    assert failure.value.code is PreviewArtifactErrorCode.STORAGE_FAILED
    assert preview_path.exists()

    monkeypatch.setattr(Path, "unlink", original_unlink)
    assert scope.release(descriptor.preview_token)
    assert not preview_path.exists()
