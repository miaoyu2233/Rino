"""Generate the desktop development registry from the Python MVP authority."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path


def repository_root() -> Path:
    root = Path(__file__).resolve().parents[1]
    if not (root / "services" / "runtime" / "pyproject.toml").is_file():
        raise RuntimeError("Unable to locate the repository root from this script.")
    return root


def snapshot_payload() -> dict[str, object]:
    root = repository_root()
    runtime_source = root / "services" / "runtime" / "src"
    sys.path.insert(0, str(runtime_source))

    from rino_runtime.nodes import build_mvp_production_registry

    snapshot = build_mvp_production_registry().snapshot()
    payload = snapshot.model_dump(mode="json", by_alias=True, exclude_none=True)
    if not isinstance(payload, dict):
        raise TypeError("The registry snapshot must serialize to a JSON object.")
    return payload


def serialized_payload(payload: dict[str, object]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def fixture_path() -> Path:
    return (
        repository_root()
        / "contracts"
        / "fixtures"
        / "registry"
        / "valid"
        / "core-definitions.json"
    )


def check_fixture(payload: dict[str, object]) -> int:
    path = fixture_path()
    try:
        current = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"Registry fixture is missing: {path}")
        return 1
    if current != payload:
        print(f"Registry fixture is out of date: {path}")
        return 1
    print(f"Registry fixture is up to date: {path}")
    return 0


def write_fixture(payload: dict[str, object]) -> int:
    path = fixture_path()
    path.write_text(serialized_payload(payload), encoding="utf-8", newline="\n")
    print(f"Wrote registry fixture: {path}")
    return 0


def parse_arguments(arguments: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="check the fixture without writing it",
    )
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    options = parse_arguments(arguments)
    payload = snapshot_payload()
    return check_fixture(payload) if options.check else write_fixture(payload)


if __name__ == "__main__":
    raise SystemExit(main())
