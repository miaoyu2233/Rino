"""Deterministic cross-language contract artifact generation.

Every canonical schema under contracts/ generates one TypeScript type module, one
TypeScript schema module, one Python model module, and one Python schema module. Running
with --check generates twice into separate temporary roots, compares the two outputs byte
for byte, and compares them with the tracked files, so a stale or non-deterministic
artifact fails the workspace check.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
TYPESCRIPT_PACKAGE_ROOT = REPOSITORY_ROOT / "packages" / "contracts-ts"
TYPESCRIPT_GENERATOR = TYPESCRIPT_PACKAGE_ROOT / "scripts" / "generate-artifacts.mjs"
TYPESCRIPT_GENERATED_ROOT = Path("packages/contracts-ts/src/generated")
PYTHON_GENERATED_ROOT = Path("services/runtime/src/rino_runtime/contracts/generated")


@dataclass(frozen=True)
class Contract:
    """One canonical schema and the artifact names generated from it."""

    schema_path: str
    basename: str
    python_module: str
    root_type: str
    schema_constant: str

    @property
    def typescript_types(self) -> Path:
        return TYPESCRIPT_GENERATED_ROOT / f"{self.basename}.types.ts"

    @property
    def typescript_schema(self) -> Path:
        return TYPESCRIPT_GENERATED_ROOT / f"{self.basename}.schema.ts"

    @property
    def python_models(self) -> Path:
        return PYTHON_GENERATED_ROOT / f"{self.python_module}.py"

    @property
    def python_schema(self) -> Path:
        return PYTHON_GENERATED_ROOT / f"{self.python_module}_schema.py"

    @property
    def generated_paths(self) -> tuple[Path, ...]:
        return (
            self.typescript_types,
            self.typescript_schema,
            self.python_models,
            self.python_schema,
        )


CONTRACTS: tuple[Contract, ...] = (
    Contract(
        schema_path="contracts/ipc/rino-ipc-v1.schema.json",
        basename="rino-ipc-v1",
        python_module="rino_ipc_v1",
        root_type="RinoIpc",
        schema_constant="RINO_IPC_V1_SCHEMA",
    ),
    Contract(
        schema_path="contracts/graph/rino-graph-v1.schema.json",
        basename="rino-graph-v1",
        python_module="rino_graph_v1",
        root_type="RinoGraph",
        schema_constant="RINO_GRAPH_V1_SCHEMA",
    ),
    Contract(
        schema_path="contracts/registry/rino-registry-v1.schema.json",
        basename="rino-registry-v1",
        python_module="rino_registry_v1",
        root_type="RinoRegistry",
        schema_constant="RINO_REGISTRY_V1_SCHEMA",
    ),
    Contract(
        schema_path="contracts/diagnostics/rino-diagnostics-v1.schema.json",
        basename="rino-diagnostics-v1",
        python_module="rino_diagnostics_v1",
        root_type="RinoDiagnostics",
        schema_constant="RINO_DIAGNOSTICS_V1_SCHEMA",
    ),
)

GENERATED_PATHS: tuple[Path, ...] = tuple(
    path for contract in CONTRACTS for path in contract.generated_paths
)


def run_command(arguments: Sequence[str], working_directory: Path) -> None:
    subprocess.run(
        arguments,
        cwd=working_directory,
        check=True,
        stdin=subprocess.DEVNULL,
    )


def python_file_header(contract: Contract) -> str:
    return f"# Generated from {contract.schema_path}. Do not edit directly."


def write_python_schema_module(contract: Contract, output_path: Path) -> None:
    schema_text = (
        (REPOSITORY_ROOT / contract.schema_path)
        .read_text(encoding="utf-8")
        .replace("\r\n", "\n")
    )
    if '"""' in schema_text:
        raise RuntimeError("A canonical schema must not contain a triple quote.")
    module_source = "\n".join(
        (
            python_file_header(contract),
            "",
            "import json",
            "from typing import Any, Final, cast",
            "",
            '_SCHEMA_TEXT: Final[str] = r"""',
            schema_text.rstrip("\n"),
            '"""',
            "",
            f"{contract.schema_constant}: Final[dict[str, Any]] = cast(",
            '    "dict[str, Any]", json.loads(_SCHEMA_TEXT)',
            ")",
            "",
        )
    )
    output_path.write_text(module_source, encoding="utf-8", newline="\n")


def format_python_model(path: Path) -> None:
    run_command(
        (
            sys.executable,
            "-m",
            "ruff",
            "check",
            "--fix",
            "--select",
            "I001,UP037",
            str(path),
        ),
        working_directory=REPOSITORY_ROOT,
    )
    run_command(
        (
            sys.executable,
            "-m",
            "ruff",
            "format",
            "--config",
            str(REPOSITORY_ROOT / "services" / "runtime" / "pyproject.toml"),
            str(path),
        ),
        working_directory=REPOSITORY_ROOT,
    )


def generate_contract(contract: Contract, output_root: Path) -> None:
    for generated_path in contract.generated_paths:
        (output_root / generated_path).parent.mkdir(parents=True, exist_ok=True)

    artifact_schema_path = (
        output_root / "artifact-schema" / f"{contract.basename}.artifacts.json"
    )
    run_command(
        (
            "node",
            str(TYPESCRIPT_GENERATOR),
            "--schema",
            contract.schema_path,
            "--basename",
            contract.basename,
            "--root-type",
            contract.root_type,
            "--output-root",
            str(output_root / "packages" / "contracts-ts"),
            "--emit-artifact-schema",
            str(artifact_schema_path),
        ),
        working_directory=TYPESCRIPT_PACKAGE_ROOT,
    )

    run_command(
        (
            sys.executable,
            "-m",
            "datamodel_code_generator",
            "--input",
            str(artifact_schema_path),
            "--input-file-type",
            "jsonschema",
            "--output",
            str(output_root / contract.python_models),
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
            python_file_header(contract),
        ),
        working_directory=REPOSITORY_ROOT,
    )
    format_python_model(output_root / contract.python_models)

    write_python_schema_module(contract, output_root / contract.python_schema)

    for generated_path in contract.generated_paths:
        path = output_root / generated_path
        content = path.read_text(encoding="utf-8").replace("\r\n", "\n")
        path.write_text(content, encoding="utf-8", newline="\n")


def generate(output_root: Path) -> None:
    for contract in CONTRACTS:
        generate_contract(contract, output_root)


def compare_generated(first_root: Path, second_root: Path) -> dict[str, object]:
    report: dict[str, object] = {}
    for generated_path in GENERATED_PATHS:
        first_path = first_root / generated_path
        second_path = second_root / generated_path
        tracked_path = REPOSITORY_ROOT / generated_path
        if first_path.read_bytes() != second_path.read_bytes():
            raise RuntimeError(f"Generator output is unstable for {generated_path}.")
        if not tracked_path.is_file():
            raise RuntimeError(f"Tracked generated file is missing: {generated_path}.")
        if first_path.read_bytes() != tracked_path.read_bytes():
            raise RuntimeError(f"Tracked generated file is stale: {generated_path}.")
        report[generated_path.as_posix()] = {
            "bytes": first_path.stat().st_size,
            "sha256": hashlib.sha256(first_path.read_bytes()).hexdigest(),
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
        "contractCount": len(CONTRACTS),
        "generatedFileCount": len(GENERATED_PATHS),
        "files": files,
    }


def main(arguments: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args(arguments)
    if options.check:
        print(json.dumps(check_generated(), indent=2, sort_keys=True))
    else:
        generate(REPOSITORY_ROOT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
