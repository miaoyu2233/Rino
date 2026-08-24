from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = PROJECT_ROOT / "schemas" / "protocol-envelope-v1.schema.json"
TRACKED_GENERATED_ROOT = PROJECT_ROOT / "generated"
GENERATED_PATHS = (
    Path("typescript/protocol-envelope-v1.d.ts"),
    Path("python/protocol_envelope_v1.py"),
)
PYTHON_FILE_HEADER = (
    "# Generated from schemas/protocol-envelope-v1.schema.json. Do not edit directly."
)


def run_command(arguments: Sequence[str]) -> None:
    subprocess.run(
        arguments,
        cwd=PROJECT_ROOT,
        check=True,
        stdin=subprocess.DEVNULL,
    )


def generate(output_root: Path) -> None:
    typescript_output = output_root / GENERATED_PATHS[0]
    python_output = output_root / GENERATED_PATHS[1]
    typescript_output.parent.mkdir(parents=True, exist_ok=True)
    python_output.parent.mkdir(parents=True, exist_ok=True)

    run_command(
        (
            "node",
            "scripts/generate-types.mjs",
            "--output",
            str(typescript_output),
        )
    )
    run_command(
        (
            sys.executable,
            "-m",
            "datamodel_code_generator",
            "--input",
            str(SCHEMA_PATH.relative_to(PROJECT_ROOT)),
            "--input-file-type",
            "jsonschema",
            "--output",
            str(python_output),
            "--output-model-type",
            "pydantic_v2.BaseModel",
            "--target-python-version",
            "3.13",
            "--use-standard-collections",
            "--no-use-union-operator",
            "--use-annotated",
            "--field-constraints",
            "--snake-case-field",
            "--extra-fields",
            "forbid",
            "--disable-timestamp",
            "--use-double-quotes",
            "--formatters",
            "ruff-check",
            "ruff-format",
            "--custom-file-header",
            PYTHON_FILE_HEADER,
        )
    )
    for generated_path in GENERATED_PATHS:
        path = output_root / generated_path
        content = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        path.write_text(content, encoding="utf-8", newline="\n")


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compare_generated(first_root: Path, second_root: Path) -> dict[str, object]:
    report: dict[str, object] = {}
    for generated_path in GENERATED_PATHS:
        first_path = first_root / generated_path
        second_path = second_root / generated_path
        tracked_path = TRACKED_GENERATED_ROOT / generated_path
        if first_path.read_bytes() != second_path.read_bytes():
            raise RuntimeError(f"Generator output is unstable for {generated_path}.")
        if not tracked_path.is_file():
            raise RuntimeError(f"Tracked generated file is missing: {generated_path}.")
        if first_path.read_bytes() != tracked_path.read_bytes():
            raise RuntimeError(f"Tracked generated file is stale: {generated_path}.")
        content = first_path.read_text(encoding="utf-8")
        report[generated_path.as_posix()] = {
            "bytes": first_path.stat().st_size,
            "lines": len(content.splitlines()),
            "sha256": file_digest(first_path),
        }
    return report


def check_generated() -> dict[str, object]:
    with (
        tempfile.TemporaryDirectory() as first_directory,
        tempfile.TemporaryDirectory() as second_directory,
    ):
        first_root = Path(first_directory)
        second_root = Path(second_directory)
        generate(first_root)
        generate(second_root)
        files = compare_generated(first_root, second_root)
    return {
        "deterministic": True,
        "generatedFileCount": len(GENERATED_PATHS),
        "files": files,
    }


def parse_arguments(arguments: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    return parser.parse_args(arguments)


def main(arguments: Sequence[str] | None = None) -> int:
    options = parse_arguments(arguments)
    if options.check:
        print(json.dumps(check_generated(), indent=2, sort_keys=True))
    else:
        generate(TRACKED_GENERATED_ROOT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
