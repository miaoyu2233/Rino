"""Memory, lifetime, and ownership tests for runtime image artifacts."""

from __future__ import annotations

from collections.abc import Iterator
from typing import cast

import numpy as np
import pytest
from numpy.typing import NDArray

from rino_runtime.artifacts import (
    ImageArtifactError,
    ImageArtifactErrorCode,
    ImageArtifactLimits,
    ImageArtifactScope,
)
from rino_runtime.nodes import RuntimeImageReference


class _Clock:
    def __init__(self) -> None:
        self.value = 100.0

    def __call__(self) -> float:
        return self.value


def _handles() -> Iterator[str]:
    for index in range(1, 20):
        yield f"image-{index}"


def _scope(
    *,
    clock: _Clock | None = None,
    maximum_artifacts: int = 2,
    maximum_total_bytes: int = 256,
    maximum_single_image_bytes: int = 128,
    lifetime_seconds: float = 10.0,
) -> ImageArtifactScope:
    handles = _handles()
    return ImageArtifactScope(
        limits=ImageArtifactLimits(
            maximum_artifacts=maximum_artifacts,
            maximum_total_bytes=maximum_total_bytes,
            maximum_single_image_bytes=maximum_single_image_bytes,
            lifetime_seconds=lifetime_seconds,
        ),
        monotonic=clock or _Clock(),
        handle_factory=lambda: next(handles),
    )


def test_store_copies_pixels_and_returns_read_only_owned_artifact() -> None:
    scope = _scope()
    source = np.arange(18, dtype=np.uint8).reshape((2, 3, 3))

    reference = scope.store(source, coordinate_space_id="device-frame")
    source.fill(0)
    artifact = scope.resolve(reference)

    assert reference.handle_id == "image-1"
    assert reference.width == 3
    assert reference.height == 2
    assert reference.coordinate_space_id == "device-frame"
    assert reference.generation == 1
    assert reference.expires_at_monotonic == 110.0
    assert artifact.byte_length == 18
    assert int(artifact.pixels.sum()) == sum(range(18))
    assert not artifact.pixels.flags.writeable


def test_scope_evicts_least_recently_used_artifact_with_bounded_memory() -> None:
    scope = _scope(maximum_artifacts=2)
    pixels = np.zeros((2, 3, 3), dtype=np.uint8)
    first = scope.store(pixels, coordinate_space_id="device-frame")
    second = scope.store(pixels, coordinate_space_id="device-frame")
    scope.resolve(first)

    third = scope.store(pixels, coordinate_space_id="device-frame")

    assert scope.resolve(first).reference == first
    assert scope.resolve(third).reference == third
    with pytest.raises(ImageArtifactError) as caught:
        scope.resolve(second)
    assert caught.value.code is ImageArtifactErrorCode.NOT_FOUND
    assert scope.artifact_count == 2
    assert scope.total_bytes == 36


def test_expired_release_and_closed_scope_fail_safely() -> None:
    clock = _Clock()
    scope = _scope(clock=clock)
    pixels = np.zeros((2, 3, 3), dtype=np.uint8)
    expired = scope.store(pixels, coordinate_space_id="device-frame")
    clock.value = expired.expires_at_monotonic

    with pytest.raises(ImageArtifactError) as caught:
        scope.resolve(expired)
    assert caught.value.code is ImageArtifactErrorCode.EXPIRED

    active = scope.store(pixels, coordinate_space_id="device-frame")
    assert scope.release(active.handle_id)
    assert not scope.release(active.handle_id)
    scope.close()
    assert scope.artifact_count == 0
    assert scope.total_bytes == 0
    with pytest.raises(ImageArtifactError) as closed:
        scope.store(pixels, coordinate_space_id="device-frame")
    assert closed.value.code is ImageArtifactErrorCode.SCOPE_CLOSED


def test_scope_rejects_invalid_oversized_and_forged_images() -> None:
    scope = _scope(maximum_single_image_bytes=16)
    with pytest.raises(ImageArtifactError) as wrong_dtype:
        scope.store(
            cast(
                "NDArray[np.uint8]",
                np.zeros((2, 2, 3), dtype=np.float32),
            ),
            coordinate_space_id="device-frame",
        )
    assert wrong_dtype.value.code is ImageArtifactErrorCode.INVALID_IMAGE

    with pytest.raises(ImageArtifactError) as too_large:
        scope.store(
            np.zeros((2, 3, 3), dtype=np.uint8),
            coordinate_space_id="device-frame",
        )
    assert too_large.value.code is ImageArtifactErrorCode.IMAGE_TOO_LARGE

    valid_scope = _scope()
    reference = valid_scope.store(
        np.zeros((2, 3, 3), dtype=np.uint8),
        coordinate_space_id="device-frame",
    )
    forged = RuntimeImageReference(
        handle_id=reference.handle_id,
        width=reference.width + 1,
        height=reference.height,
        coordinate_space_id=reference.coordinate_space_id,
        generation=reference.generation,
        expires_at_monotonic=reference.expires_at_monotonic,
    )
    with pytest.raises(ImageArtifactError) as mismatch:
        valid_scope.resolve(forged)
    assert mismatch.value.code is ImageArtifactErrorCode.REFERENCE_MISMATCH
