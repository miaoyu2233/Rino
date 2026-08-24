"""Confirmed full-resolution captures stored as short-lived private PNG artifacts."""

from __future__ import annotations

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

from rino_runtime.artifacts.images import ImageArtifact
from rino_runtime.artifacts.previews import (
    PREVIEW_MEDIA_TYPE,
    _bgr_to_rgb,
    _encode_rgb_png,
)


class CaptureArtifactErrorCode(StrEnum):
    INVALID_REQUEST = "CAPTURE_REQUEST_INVALID"
    ENCODE_FAILED = "CAPTURE_ENCODE_FAILED"
    TOO_LARGE = "CAPTURE_ARTIFACT_TOO_LARGE"
    STORAGE_FAILED = "CAPTURE_STORAGE_FAILED"
    SCOPE_CLOSED = "CAPTURE_SCOPE_CLOSED"


class CaptureArtifactError(RuntimeError):
    def __init__(self, code: CaptureArtifactErrorCode) -> None:
        super().__init__(code.value)
        self.code = code


class CaptureSourceKind(StrEnum):
    DEVICE_CAPTURE = "deviceCapture"
    REGION_CAPTURE = "regionCapture"


@dataclass(frozen=True, slots=True)
class CaptureRegion:
    x: int
    y: int
    width: int
    height: int
    coordinate_space_id: str
    source_generation: int


@dataclass(frozen=True, slots=True)
class CaptureArtifactLimits:
    maximum_artifacts: int
    maximum_encoded_bytes: int
    maximum_total_bytes: int
    lifetime_seconds: float

    def __post_init__(self) -> None:
        if self.maximum_artifacts <= 0:
            raise ValueError("The capture artifact count limit must be positive.")
        if self.maximum_encoded_bytes <= 0:
            raise ValueError("The capture encoded-size limit must be positive.")
        if self.maximum_total_bytes < self.maximum_encoded_bytes:
            raise ValueError("The capture scope limit must hold at least one artifact.")
        if not 1.0 <= self.lifetime_seconds <= 120.0:
            raise ValueError("The capture lifetime must be between 1 and 120 seconds.")


DEFAULT_CAPTURE_ARTIFACT_LIMITS: Final[CaptureArtifactLimits] = CaptureArtifactLimits(
    maximum_artifacts=2,
    maximum_encoded_bytes=64 * 1024 * 1024,
    maximum_total_bytes=128 * 1024 * 1024,
    lifetime_seconds=60.0,
)


@dataclass(frozen=True, slots=True)
class CaptureArtifactDescriptor:
    capture_token: str
    media_type: str
    width: int
    height: int
    coordinate_space_id: str
    source_kind: CaptureSourceKind
    byte_length: int
    expires_in_milliseconds: int


@dataclass(slots=True)
class _StoredCapture:
    descriptor: CaptureArtifactDescriptor
    path: Path
    expires_at: float


class CaptureArtifactScope:
    def __init__(
        self,
        root: Path,
        *,
        limits: CaptureArtifactLimits = DEFAULT_CAPTURE_ARTIFACT_LIMITS,
        monotonic: Callable[[], float] = time.monotonic,
        token_factory: Callable[[], str] = lambda: uuid4().hex,
        coordinate_space_factory: Callable[[], str] = (
            lambda: f"capture-space-{uuid4()}"
        ),
    ) -> None:
        if not root.is_absolute():
            raise ValueError("The capture cache root must be absolute.")
        self._root = root.resolve()
        self._limits = limits
        self._monotonic = monotonic
        self._token_factory = token_factory
        self._coordinate_space_factory = coordinate_space_factory
        self._captures: OrderedDict[str, _StoredCapture] = OrderedDict()
        self._total_bytes = 0
        self._closed = False
        self._lock = threading.Lock()
        self._root.mkdir(parents=True, exist_ok=True)
        self._clear_owned_files()

    def create(
        self,
        source: ImageArtifact,
        *,
        region: CaptureRegion | None,
    ) -> CaptureArtifactDescriptor:
        with self._lock:
            return self._create_locked(source, region=region)

    def _create_locked(
        self,
        source: ImageArtifact,
        *,
        region: CaptureRegion | None,
    ) -> CaptureArtifactDescriptor:
        self._ensure_open()
        pixels = source.pixels
        source_kind = CaptureSourceKind.DEVICE_CAPTURE
        if region is not None:
            self._validate_region(source, region)
            pixels = pixels[
                region.y : region.y + region.height,
                region.x : region.x + region.width,
            ]
            source_kind = CaptureSourceKind.REGION_CAPTURE
        try:
            encoded = _encode_rgb_png(_bgr_to_rgb(pixels))
        except (OverflowError, ValueError, zlib.error) as error:
            raise CaptureArtifactError(
                CaptureArtifactErrorCode.ENCODE_FAILED
            ) from error
        byte_length = len(encoded)
        if byte_length > self._limits.maximum_encoded_bytes:
            raise CaptureArtifactError(CaptureArtifactErrorCode.TOO_LARGE)

        now = self._monotonic()
        self._purge_expired(now)
        while self._captures and (
            len(self._captures) >= self._limits.maximum_artifacts
            or self._total_bytes + byte_length > self._limits.maximum_total_bytes
        ):
            self._remove(next(iter(self._captures)))
        if self._total_bytes + byte_length > self._limits.maximum_total_bytes:
            raise CaptureArtifactError(CaptureArtifactErrorCode.TOO_LARGE)

        token = self._new_token()
        path = self._path_for(token)
        try:
            with path.open("xb") as output:
                output.write(encoded)
        except OSError as error:
            path.unlink(missing_ok=True)
            raise CaptureArtifactError(
                CaptureArtifactErrorCode.STORAGE_FAILED
            ) from error
        expires_at = now + self._limits.lifetime_seconds
        descriptor = CaptureArtifactDescriptor(
            capture_token=token,
            media_type=PREVIEW_MEDIA_TYPE,
            width=int(pixels.shape[1]),
            height=int(pixels.shape[0]),
            coordinate_space_id=self._coordinate_space_factory(),
            source_kind=source_kind,
            byte_length=byte_length,
            expires_in_milliseconds=round(self._limits.lifetime_seconds * 1000),
        )
        self._captures[token] = _StoredCapture(descriptor, path, expires_at)
        self._total_bytes += byte_length
        return descriptor

    def release(self, capture_token: str) -> bool:
        with self._lock:
            self._ensure_open()
            return self._remove(capture_token)

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            failure: OSError | None = None
            for token in tuple(self._captures):
                try:
                    self._remove(token)
                except CaptureArtifactError as error:
                    if isinstance(error.__cause__, OSError):
                        failure = error.__cause__
            try:
                self._clear_owned_files()
            except OSError as error:
                failure = error
            if failure is not None:
                raise CaptureArtifactError(
                    CaptureArtifactErrorCode.STORAGE_FAILED
                ) from failure

    def _validate_region(self, source: ImageArtifact, region: CaptureRegion) -> None:
        reference = source.reference
        if (
            region.coordinate_space_id != reference.coordinate_space_id
            or region.source_generation != reference.generation
            or isinstance(region.x, bool)
            or isinstance(region.y, bool)
            or isinstance(region.width, bool)
            or isinstance(region.height, bool)
            or region.x < 0
            or region.y < 0
            or region.width <= 0
            or region.height <= 0
            or region.x + region.width > reference.width
            or region.y + region.height > reference.height
        ):
            raise CaptureArtifactError(CaptureArtifactErrorCode.INVALID_REQUEST)

    def _purge_expired(self, now: float) -> None:
        for token, stored in tuple(self._captures.items()):
            if stored.expires_at <= now:
                self._remove(token)

    def _remove(self, token: str) -> bool:
        stored = self._captures.get(token)
        if stored is None:
            return False
        try:
            stored.path.unlink(missing_ok=True)
        except OSError as error:
            raise CaptureArtifactError(
                CaptureArtifactErrorCode.STORAGE_FAILED
            ) from error
        del self._captures[token]
        self._total_bytes -= stored.descriptor.byte_length
        return True

    def _new_token(self) -> str:
        token = self._token_factory()
        if len(token) != 32 or any(
            character not in "0123456789abcdef" for character in token
        ):
            raise ValueError(
                "Capture token factories must return 32 lowercase hex digits."
            )
        if token in self._captures or self._path_for(token).exists():
            raise ValueError("Capture token factories must return unused tokens.")
        return token

    def _path_for(self, token: str) -> Path:
        return self._root / f"{token}.png"

    def _clear_owned_files(self) -> None:
        for path in self._root.glob("*.png"):
            if len(path.stem) == 32 and all(
                character in "0123456789abcdef" for character in path.stem
            ):
                path.unlink(missing_ok=True)

    def _ensure_open(self) -> None:
        if self._closed:
            raise CaptureArtifactError(CaptureArtifactErrorCode.SCOPE_CLOSED)
