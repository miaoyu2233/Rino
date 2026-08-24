"""Bounded in-memory ownership for captured runtime images."""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Final, cast
from uuid import uuid4

import numpy as np
from numpy.typing import NDArray

from rino_runtime.nodes.execution import RuntimeImageReference

MAXIMUM_IMAGE_DIMENSION: Final[int] = 16_384


class ImageArtifactErrorCode(StrEnum):
    INVALID_IMAGE = "IMAGE_ARTIFACT_INVALID"
    IMAGE_TOO_LARGE = "IMAGE_ARTIFACT_TOO_LARGE"
    NOT_FOUND = "IMAGE_ARTIFACT_NOT_FOUND"
    EXPIRED = "IMAGE_ARTIFACT_EXPIRED"
    REFERENCE_MISMATCH = "IMAGE_ARTIFACT_REFERENCE_MISMATCH"
    SCOPE_CLOSED = "IMAGE_ARTIFACT_SCOPE_CLOSED"


class ImageArtifactError(RuntimeError):
    def __init__(self, code: ImageArtifactErrorCode) -> None:
        super().__init__(code.value)
        self.code = code


@dataclass(frozen=True, slots=True)
class ImageArtifactLimits:
    maximum_artifacts: int
    maximum_total_bytes: int
    maximum_single_image_bytes: int
    lifetime_seconds: float

    def __post_init__(self) -> None:
        if self.maximum_artifacts <= 0:
            raise ValueError("The image artifact count limit must be positive.")
        if self.maximum_total_bytes <= 0:
            raise ValueError("The image artifact memory limit must be positive.")
        if self.maximum_single_image_bytes <= 0:
            raise ValueError("The single-image memory limit must be positive.")
        if self.maximum_single_image_bytes > self.maximum_total_bytes:
            raise ValueError("The single-image limit cannot exceed the scope limit.")
        if self.lifetime_seconds <= 0:
            raise ValueError("The image artifact lifetime must be positive.")


DEFAULT_IMAGE_ARTIFACT_LIMITS: Final[ImageArtifactLimits] = ImageArtifactLimits(
    maximum_artifacts=8,
    maximum_total_bytes=192 * 1024 * 1024,
    maximum_single_image_bytes=64 * 1024 * 1024,
    lifetime_seconds=300.0,
)


@dataclass(frozen=True, slots=True)
class ImageArtifact:
    reference: RuntimeImageReference
    pixels: NDArray[np.uint8]
    byte_length: int


@dataclass(slots=True)
class _StoredImage:
    artifact: ImageArtifact
    expires_at: float


class ImageArtifactScope:
    """Owns copied, read-only image buffers for one runtime process scope."""

    def __init__(
        self,
        *,
        limits: ImageArtifactLimits = DEFAULT_IMAGE_ARTIFACT_LIMITS,
        monotonic: Callable[[], float] = time.monotonic,
        handle_factory: Callable[[], str] = lambda: f"image-{uuid4()}",
    ) -> None:
        self._limits = limits
        self._monotonic = monotonic
        self._handle_factory = handle_factory
        self._images: OrderedDict[str, _StoredImage] = OrderedDict()
        self._total_bytes = 0
        self._generation = 0
        self._closed = False
        self._lock = threading.Lock()

    @property
    def artifact_count(self) -> int:
        with self._lock:
            self._purge_expired(self._monotonic())
            return len(self._images)

    @property
    def total_bytes(self) -> int:
        with self._lock:
            self._purge_expired(self._monotonic())
            return self._total_bytes

    def store(
        self,
        pixels: object,
        *,
        coordinate_space_id: str,
    ) -> RuntimeImageReference:
        owned = self._copy_valid_pixels(pixels)
        byte_length = int(owned.nbytes)
        if byte_length > self._limits.maximum_single_image_bytes:
            raise ImageArtifactError(ImageArtifactErrorCode.IMAGE_TOO_LARGE)
        coordinate_space = coordinate_space_id.strip()
        if not coordinate_space or len(coordinate_space) > 256:
            raise ImageArtifactError(ImageArtifactErrorCode.INVALID_IMAGE)

        with self._lock:
            self._ensure_open()
            now = self._monotonic()
            self._purge_expired(now)
            while self._images and (
                len(self._images) >= self._limits.maximum_artifacts
                or self._total_bytes + byte_length > self._limits.maximum_total_bytes
            ):
                self._remove_oldest()
            if self._total_bytes + byte_length > self._limits.maximum_total_bytes:
                raise ImageArtifactError(ImageArtifactErrorCode.IMAGE_TOO_LARGE)

            handle_id = self._new_handle()
            self._generation += 1
            expires_at = now + self._limits.lifetime_seconds
            reference = RuntimeImageReference(
                handle_id=handle_id,
                width=int(owned.shape[1]),
                height=int(owned.shape[0]),
                coordinate_space_id=coordinate_space,
                generation=self._generation,
                expires_at_monotonic=expires_at,
            )
            artifact = ImageArtifact(reference, owned, byte_length)
            self._images[handle_id] = _StoredImage(artifact, expires_at)
            self._total_bytes += byte_length
            return reference

    def resolve(self, reference: RuntimeImageReference) -> ImageArtifact:
        with self._lock:
            self._ensure_open()
            now = self._monotonic()
            stored = self._images.get(reference.handle_id)
            if stored is None:
                self._purge_expired(now)
                raise ImageArtifactError(ImageArtifactErrorCode.NOT_FOUND)
            if stored.expires_at <= now:
                self._remove(reference.handle_id)
                raise ImageArtifactError(ImageArtifactErrorCode.EXPIRED)
            if stored.artifact.reference != reference:
                raise ImageArtifactError(ImageArtifactErrorCode.REFERENCE_MISMATCH)
            self._images.move_to_end(reference.handle_id)
            return stored.artifact

    def release(self, handle_id: str) -> bool:
        with self._lock:
            self._ensure_open()
            return self._remove(handle_id)

    def clear(self) -> None:
        with self._lock:
            self._images.clear()
            self._total_bytes = 0

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._images.clear()
            self._total_bytes = 0

    def _copy_valid_pixels(self, pixels: object) -> NDArray[np.uint8]:
        if not isinstance(pixels, np.ndarray):
            raise ImageArtifactError(ImageArtifactErrorCode.INVALID_IMAGE)
        array = cast("NDArray[np.generic]", pixels)
        if array.dtype != np.dtype(np.uint8):
            raise ImageArtifactError(ImageArtifactErrorCode.INVALID_IMAGE)
        if array.ndim not in {2, 3}:
            raise ImageArtifactError(ImageArtifactErrorCode.INVALID_IMAGE)
        height = int(array.shape[0])
        width = int(array.shape[1])
        if (
            height <= 0
            or width <= 0
            or height > MAXIMUM_IMAGE_DIMENSION
            or width > MAXIMUM_IMAGE_DIMENSION
        ):
            raise ImageArtifactError(ImageArtifactErrorCode.INVALID_IMAGE)
        if array.ndim == 3 and int(array.shape[2]) not in {1, 3, 4}:
            raise ImageArtifactError(ImageArtifactErrorCode.INVALID_IMAGE)
        owned = np.array(
            cast("NDArray[np.uint8]", array),
            dtype=np.uint8,
            order="C",
            copy=True,
        )
        owned.flags.writeable = False
        return owned

    def _purge_expired(self, now: float) -> None:
        expired = [
            handle_id
            for handle_id, stored in self._images.items()
            if stored.expires_at <= now
        ]
        for handle_id in expired:
            self._remove(handle_id)

    def _remove_oldest(self) -> None:
        handle_id = next(iter(self._images))
        self._remove(handle_id)

    def _remove(self, handle_id: str) -> bool:
        stored = self._images.pop(handle_id, None)
        if stored is None:
            return False
        self._total_bytes -= stored.artifact.byte_length
        return True

    def _new_handle(self) -> str:
        handle_id = self._handle_factory()
        if not handle_id.strip() or len(handle_id) > 256:
            raise ValueError("Image handle factories must return bounded keys.")
        if handle_id in self._images:
            raise ValueError("Image handle factories must return unique keys.")
        return handle_id

    def _ensure_open(self) -> None:
        if self._closed:
            raise ImageArtifactError(ImageArtifactErrorCode.SCOPE_CLOSED)
