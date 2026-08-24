"""Bounded loading of project-owned PNG templates from the private handoff cache."""

from __future__ import annotations

import binascii
import hashlib
import struct
import zlib
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Final

import numpy as np
from numpy.typing import NDArray

from rino_runtime.artifacts.previews import PNG_SIGNATURE

PROJECT_ASSET_DIRECTORY_NAME: Final[str] = "project-assets"
MAXIMUM_PROJECT_ASSET_BYTES: Final[int] = 64 * 1024 * 1024
MAXIMUM_PROJECT_ASSET_DIMENSION: Final[int] = 16_384


class ProjectAssetErrorCode(StrEnum):
    INVALID_REQUEST = "PROJECT_ASSET_REQUEST_INVALID"
    NOT_FOUND = "PROJECT_ASSET_NOT_FOUND"
    CONTENT_MISMATCH = "PROJECT_ASSET_CONTENT_MISMATCH"
    UNSUPPORTED_PNG = "PROJECT_ASSET_PNG_UNSUPPORTED"


class ProjectAssetError(RuntimeError):
    def __init__(self, code: ProjectAssetErrorCode) -> None:
        super().__init__(code.value)
        self.code = code


@dataclass(frozen=True, slots=True)
class ProjectAssetDescriptor:
    asset_token: str
    content_hash: str
    byte_length: int
    width: int
    height: int
    coordinate_space_id: str


class ProjectAssetScope:
    """Consumes token-named project templates from one application-owned directory."""

    def __init__(self, root: Path) -> None:
        if not root.is_absolute():
            raise ValueError("The project asset handoff root must be absolute.")
        self._root = root.resolve()
        self._root.mkdir(parents=True, exist_ok=True)
        self._clear_owned_files()

    def consume(self, descriptor: ProjectAssetDescriptor) -> NDArray[np.uint8]:
        self._validate_descriptor(descriptor)
        path = self._path_for(descriptor.asset_token)
        try:
            encoded = path.read_bytes()
        except OSError as error:
            raise ProjectAssetError(ProjectAssetErrorCode.NOT_FOUND) from error
        finally:
            path.unlink(missing_ok=True)
        if (
            len(encoded) != descriptor.byte_length
            or hashlib.sha256(encoded).hexdigest() != descriptor.content_hash
        ):
            raise ProjectAssetError(ProjectAssetErrorCode.CONTENT_MISMATCH)
        return _decode_owned_rgb_png(
            encoded,
            expected_width=descriptor.width,
            expected_height=descriptor.height,
        )

    def close(self) -> None:
        self._clear_owned_files()

    def _validate_descriptor(self, descriptor: ProjectAssetDescriptor) -> None:
        if (
            len(descriptor.asset_token) != 32
            or any(
                character not in "0123456789abcdef"
                for character in descriptor.asset_token
            )
            or len(descriptor.content_hash) != 64
            or any(
                character not in "0123456789abcdef"
                for character in descriptor.content_hash
            )
            or not 1 <= descriptor.byte_length <= MAXIMUM_PROJECT_ASSET_BYTES
            or not 1 <= descriptor.width <= MAXIMUM_PROJECT_ASSET_DIMENSION
            or not 1 <= descriptor.height <= MAXIMUM_PROJECT_ASSET_DIMENSION
            or not descriptor.coordinate_space_id.strip()
            or len(descriptor.coordinate_space_id) > 128
        ):
            raise ProjectAssetError(ProjectAssetErrorCode.INVALID_REQUEST)

    def _path_for(self, token: str) -> Path:
        return self._root / f"{token}.png"

    def _clear_owned_files(self) -> None:
        for path in self._root.glob("*.png"):
            token = path.stem
            if len(token) == 32 and all(
                character in "0123456789abcdef" for character in token
            ):
                path.unlink(missing_ok=True)


def _decode_owned_rgb_png(
    encoded: bytes,
    *,
    expected_width: int,
    expected_height: int,
) -> NDArray[np.uint8]:
    if not encoded.startswith(PNG_SIGNATURE):
        raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG)
    offset = len(PNG_SIGNATURE)
    header: tuple[int, int] | None = None
    compressed = bytearray()
    ended = False
    while offset + 12 <= len(encoded):
        length = struct.unpack(">I", encoded[offset : offset + 4])[0]
        chunk_type = encoded[offset + 4 : offset + 8]
        payload_start = offset + 8
        payload_end = payload_start + length
        crc_end = payload_end + 4
        if crc_end > len(encoded):
            raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG)
        payload = encoded[payload_start:payload_end]
        expected_crc = struct.unpack(">I", encoded[payload_end:crc_end])[0]
        if (binascii.crc32(chunk_type + payload) & 0xFFFFFFFF) != expected_crc:
            raise ProjectAssetError(ProjectAssetErrorCode.CONTENT_MISMATCH)
        if chunk_type == b"IHDR":
            if header is not None or length != 13:
                raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG)
            width, height, bit_depth, color_type, compression, filtering, interlace = (
                struct.unpack(">IIBBBBB", payload)
            )
            if (
                width != expected_width
                or height != expected_height
                or bit_depth != 8
                or color_type != 2
                or compression != 0
                or filtering != 0
                or interlace != 0
            ):
                raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG)
            header = (width, height)
        elif chunk_type == b"IDAT":
            compressed.extend(payload)
            if len(compressed) > MAXIMUM_PROJECT_ASSET_BYTES:
                raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG)
        elif chunk_type == b"IEND":
            if length != 0:
                raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG)
            ended = True
            offset = crc_end
            break
        elif chunk_type[0] & 0x20 == 0:
            raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG)
        offset = crc_end
    if header is None or not ended or offset != len(encoded) or not compressed:
        raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG)

    row_bytes = expected_width * 3
    expected_raw = expected_height * (row_bytes + 1)
    try:
        decompressor = zlib.decompressobj()
        raw = decompressor.decompress(bytes(compressed), expected_raw + 1)
        raw += decompressor.flush()
    except zlib.error as error:
        raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG) from error
    if len(raw) != expected_raw or not decompressor.eof:
        raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG)
    rows = np.frombuffer(raw, dtype=np.uint8).reshape(expected_height, row_bytes + 1)
    if np.any(rows[:, 0] != 0):
        raise ProjectAssetError(ProjectAssetErrorCode.UNSUPPORTED_PNG)
    rgb = rows[:, 1:].reshape(expected_height, expected_width, 3)
    return np.ascontiguousarray(rgb[:, :, ::-1])
