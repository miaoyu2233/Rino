from __future__ import annotations

import hashlib
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from rino_runtime.artifacts import (
    ProjectAssetDescriptor,
    ProjectAssetError,
    ProjectAssetErrorCode,
    ProjectAssetScope,
)
from rino_runtime.artifacts.previews import _encode_rgb_png


def descriptor(token: str, encoded: bytes) -> ProjectAssetDescriptor:
    return ProjectAssetDescriptor(
        asset_token=token,
        content_hash=hashlib.sha256(encoded).hexdigest(),
        byte_length=len(encoded),
        width=2,
        height=1,
        coordinate_space_id="device-space",
    )


def test_project_asset_scope_consumes_verified_owned_png_as_bgr(
    tmp_path: Path,
) -> None:
    scope = ProjectAssetScope(tmp_path)
    rgb = np.array([[[1, 2, 3], [10, 20, 30]]], dtype=np.uint8)
    encoded = _encode_rgb_png(rgb)
    token = "0123456789abcdef0123456789abcdef"
    path = tmp_path / f"{token}.png"
    path.write_bytes(encoded)

    pixels = scope.consume(descriptor(token, encoded))

    assert pixels.tolist() == [[[3, 2, 1], [30, 20, 10]]]
    assert pixels.flags.c_contiguous
    assert not path.exists()


def test_project_asset_scope_rejects_content_mismatch_and_removes_handoff(
    tmp_path: Path,
) -> None:
    scope = ProjectAssetScope(tmp_path)
    rgb = np.array([[[1, 2, 3], [10, 20, 30]]], dtype=np.uint8)
    encoded = _encode_rgb_png(rgb)
    token = "abcdef0123456789abcdef0123456789"
    path = tmp_path / f"{token}.png"
    path.write_bytes(encoded)
    invalid = replace(descriptor(token, encoded), content_hash="0" * 64)

    with pytest.raises(ProjectAssetError) as raised:
        scope.consume(invalid)

    assert raised.value.code is ProjectAssetErrorCode.CONTENT_MISMATCH
    assert not path.exists()
