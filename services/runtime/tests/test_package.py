from __future__ import annotations

import rino_runtime


def test_package_version_matches_scaffold() -> None:
    assert rino_runtime.__version__ == "0.0.0"
