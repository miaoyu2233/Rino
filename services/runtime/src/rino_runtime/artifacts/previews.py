"""Short-lived PNG previews stored under one application-owned cache root."""

from __future__ import annotations

import binascii
import struct
import threading
import time
import zlib
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final
from uuid import uuid4

import numpy as np
from numpy.typing import NDArray

from rino_runtime.artifacts.images import ImageArtifact
from rino_runtime.nodes import RuntimeImageReference

PNG_SIGNATURE: Final[bytes] = b"\x89PNG\r\n\x1a\n"
PREVIEW_MEDIA_TYPE: Final[str] = "image/png"


class PreviewArtifactErrorCode(StrEnum):
    INVALID_REQUEST = "PREVIEW_REQUEST_INVALID"
    ENCODE_FAILED = "PREVIEW_ENCODE_FAILED"
    TOO_LARGE = "PREVIEW_ARTIFACT_TOO_LARGE"
    NOT_FOUND = "PREVIEW_ARTIFACT_NOT_FOUND"
    EXPIRED = "PREVIEW_ARTIFACT_EXPIRED"
    STORAGE_FAILED = "PREVIEW_STORAGE_FAILED"
    SCOPE_CLOSED = "PREVIEW_SCOPE_CLOSED"


class PreviewArtifactError(RuntimeError):
    def __init__(self, code: PreviewArtifactErrorCode) -> None:
        super().__init__(code.value)
        self.code = code


@dataclass(frozen=True, slots=True)
class PreviewArtifactLimits:
    maximum_artifacts: int
    maximum_encoded_bytes: int
    maximum_total_bytes: int
    lifetime_seconds: float

    def __post_init__(self) -> None:
        if self.maximum_artifacts <= 0:
            raise ValueError("The preview artifact count limit must be positive.")
        if self.maximum_encoded_bytes <= 0:
            raise ValueError("The preview encoded-size limit must be positive.")
        if self.maximum_total_bytes < self.maximum_encoded_bytes:
            raise ValueError("The preview scope limit must hold at least one preview.")
        if not 1.0 <= self.lifetime_seconds <= 60.0:
            raise ValueError("The preview lifetime must be between 1 and 60 seconds.")


DEFAULT_PREVIEW_ARTIFACT_LIMITS: Final[PreviewArtifactLimits] = PreviewArtifactLimits(
    maximum_artifacts=4,
    maximum_encoded_bytes=3 * 1024 * 1024,
    maximum_total_bytes=12 * 1024 * 1024,
    lifetime_seconds=30.0,
)


@dataclass(frozen=True, slots=True)
class PreviewArtifactDescriptor:
    preview_token: str
    media_type: str
    width: int
    height: int
    source_width: int
    source_height: int
    source_coordinate_space_id: str
    source_generation: int
    byte_length: int
    expires_in_milliseconds: int


@dataclass(slots=True)
class _StoredPreview:
    descriptor: PreviewArtifactDescriptor
    path: Path
    expires_at: float
    source_reference: RuntimeImageReference


class PreviewArtifactScope:
    """Writes only bounded, token-named PNG files into a private cache directory."""

    def __init__(
        self,
        root: Path,
        *,
        limits: PreviewArtifactLimits = DEFAULT_PREVIEW_ARTIFACT_LIMITS,
        monotonic: Callable[[], float] = time.monotonic,
        token_factory: Callable[[], str] = lambda: uuid4().hex,
    ) -> None:
        if not root.is_absolute():
            raise ValueError("The preview cache root must be absolute.")
        self._root = root.resolve()
        self._limits = limits
        self._monotonic = monotonic
        self._token_factory = token_factory
        self._previews: OrderedDict[str, _StoredPreview] = OrderedDict()
        self._total_bytes = 0
        self._closed = False
        self._lock = threading.Lock()
        try:
            self._root.mkdir(parents=True, exist_ok=True)
            self._clear_owned_files()
        except OSError as error:
            raise PreviewArtifactError(
                PreviewArtifactErrorCode.STORAGE_FAILED
            ) from error

    def create(
        self,
        source: ImageArtifact,
        *,
        maximum_width: int,
        maximum_height: int,
    ) -> PreviewArtifactDescriptor:
        if not 160 <= maximum_width <= 1920 or not 120 <= maximum_height <= 1920:
            raise PreviewArtifactError(PreviewArtifactErrorCode.INVALID_REQUEST)
        pixels = _resize_for_preview(
            _bgr_to_rgb(source.pixels),
            maximum_width=maximum_width,
            maximum_height=maximum_height,
        )
        try:
            encoded = _encode_rgb_png(pixels)
        except (OverflowError, ValueError, zlib.error) as error:
            raise PreviewArtifactError(
                PreviewArtifactErrorCode.ENCODE_FAILED
            ) from error
        byte_length = len(encoded)
        if byte_length > self._limits.maximum_encoded_bytes:
            raise PreviewArtifactError(PreviewArtifactErrorCode.TOO_LARGE)

        with self._lock:
            self._ensure_open()
            now = self._monotonic()
            self._purge_expired(now)
            while self._previews and (
                len(self._previews) >= self._limits.maximum_artifacts
                or self._total_bytes + byte_length > self._limits.maximum_total_bytes
            ):
                self._remove_oldest()
            if self._total_bytes + byte_length > self._limits.maximum_total_bytes:
                raise PreviewArtifactError(PreviewArtifactErrorCode.TOO_LARGE)

            token = self._new_token()
            path = self._path_for(token)
            try:
                with path.open("xb") as output:
                    output.write(encoded)
            except OSError as error:
                path.unlink(missing_ok=True)
                raise PreviewArtifactError(
                    PreviewArtifactErrorCode.STORAGE_FAILED
                ) from error
            expires_at = now + self._limits.lifetime_seconds
            descriptor = PreviewArtifactDescriptor(
                preview_token=token,
                media_type=PREVIEW_MEDIA_TYPE,
                width=int(pixels.shape[1]),
                height=int(pixels.shape[0]),
                source_width=source.reference.width,
                source_height=source.reference.height,
                source_coordinate_space_id=source.reference.coordinate_space_id,
                source_generation=source.reference.generation,
                byte_length=byte_length,
                expires_in_milliseconds=round(self._limits.lifetime_seconds * 1000),
            )
            self._previews[token] = _StoredPreview(
                descriptor,
                path,
                expires_at,
                source.reference,
            )
            self._total_bytes += byte_length
            return descriptor

    def release(self, preview_token: str) -> bool:
        with self._lock:
            self._ensure_open()
            return self._remove(preview_token)

    def resolve_source(self, preview_token: str) -> RuntimeImageReference:
        with self._lock:
            self._ensure_open()
            self._purge_expired(self._monotonic())
            stored = self._previews.get(preview_token)
            if stored is None:
                raise PreviewArtifactError(PreviewArtifactErrorCode.NOT_FOUND)
            self._previews.move_to_end(preview_token)
            return stored.source_reference

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            storage_failure: OSError | None = None
            for token in tuple(self._previews):
                try:
                    self._remove(token)
                except PreviewArtifactError as error:
                    if isinstance(error.__cause__, OSError):
                        storage_failure = error.__cause__
            try:
                self._clear_owned_files()
            except OSError as error:
                storage_failure = error
            if storage_failure is not None:
                raise PreviewArtifactError(
                    PreviewArtifactErrorCode.STORAGE_FAILED
                ) from storage_failure

    def _purge_expired(self, now: float) -> None:
        for token, stored in tuple(self._previews.items()):
            if stored.expires_at <= now:
                self._remove(token)

    def _remove_oldest(self) -> None:
        self._remove(next(iter(self._previews)))

    def _remove(self, preview_token: str) -> bool:
        stored = self._previews.get(preview_token)
        if stored is None:
            return False
        try:
            stored.path.unlink(missing_ok=True)
        except OSError as error:
            raise PreviewArtifactError(
                PreviewArtifactErrorCode.STORAGE_FAILED
            ) from error
        del self._previews[preview_token]
        self._total_bytes -= stored.descriptor.byte_length
        return True

    def _new_token(self) -> str:
        token = self._token_factory()
        if len(token) != 32 or any(
            character not in "0123456789abcdef" for character in token
        ):
            raise ValueError(
                "Preview token factories must return 32 lowercase hex digits."
            )
        if token in self._previews or self._path_for(token).exists():
            raise ValueError("Preview token factories must return unused tokens.")
        return token

    def _path_for(self, preview_token: str) -> Path:
        return self._root / f"{preview_token}.png"

    def _clear_owned_files(self) -> None:
        for path in self._root.glob("*.png"):
            if len(path.stem) == 32 and all(
                character in "0123456789abcdef" for character in path.stem
            ):
                path.unlink(missing_ok=True)

    def _ensure_open(self) -> None:
        if self._closed:
            raise PreviewArtifactError(PreviewArtifactErrorCode.SCOPE_CLOSED)


def _bgr_to_rgb(pixels: NDArray[np.uint8]) -> NDArray[np.uint8]:
    if pixels.ndim == 2:
        return np.repeat(pixels[:, :, np.newaxis], 3, axis=2)
    channels = int(pixels.shape[2])
    if channels == 1:
        return np.repeat(pixels, 3, axis=2)
    if channels in {3, 4}:
        return np.ascontiguousarray(pixels[:, :, [2, 1, 0]])
    raise PreviewArtifactError(PreviewArtifactErrorCode.ENCODE_FAILED)


def _resize_for_preview(
    pixels: NDArray[np.uint8],
    *,
    maximum_width: int,
    maximum_height: int,
) -> NDArray[np.uint8]:
    source_height = int(pixels.shape[0])
    source_width = int(pixels.shape[1])
    scale = min(1.0, maximum_width / source_width, maximum_height / source_height)
    target_width = max(1, round(source_width * scale))
    target_height = max(1, round(source_height * scale))
    if target_width == source_width and target_height == source_height:
        return np.ascontiguousarray(pixels)
    x_indices = np.minimum(
        source_width - 1,
        np.floor(np.arange(target_width) * source_width / target_width).astype(np.intp),
    )
    y_indices = np.minimum(
        source_height - 1,
        np.floor(np.arange(target_height) * source_height / target_height).astype(
            np.intp
        ),
    )
    return np.ascontiguousarray(pixels[y_indices[:, None], x_indices[None, :]])


def _encode_rgb_png(pixels: NDArray[np.uint8]) -> bytes:
    height = int(pixels.shape[0])
    width = int(pixels.shape[1])
    scanlines = b"".join(
        b"\x00" + pixels[row].tobytes(order="C") for row in range(height)
    )
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"".join(
        (
            PNG_SIGNATURE,
            _png_chunk(b"IHDR", header),
            _png_chunk(b"IDAT", zlib.compress(scanlines, level=6)),
            _png_chunk(b"IEND", b""),
        )
    )


def _png_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    checksum = binascii.crc32(chunk_type)
    checksum = binascii.crc32(payload, checksum) & 0xFFFFFFFF
    return (
        struct.pack(">I", len(payload))
        + chunk_type
        + payload
        + struct.pack(">I", checksum)
    )
