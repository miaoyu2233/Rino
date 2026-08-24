from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any, cast

from rino_runtime.diagnostics import (
    LOG_FILE_NAME,
    DiagnosticLog,
    DiagnosticSeverity,
)


def read_entries(stream: io.StringIO) -> list[dict[str, Any]]:
    return [
        cast("dict[str, Any]", json.loads(line))
        for line in stream.getvalue().splitlines()
        if line
    ]


def test_entries_are_one_json_object_per_line() -> None:
    stream = io.StringIO()
    log = DiagnosticLog(stream=stream)

    log.record(DiagnosticSeverity.INFO, "RUNTIME_STARTED")
    log.record(DiagnosticSeverity.ERROR, "RUNTIME_FRAMING_FAILURE", detail="malformed")

    entries = read_entries(stream)
    assert [entry["code"] for entry in entries] == [
        "RUNTIME_STARTED",
        "RUNTIME_FRAMING_FAILURE",
    ]
    assert entries[0]["schemaVersion"] == 1
    assert entries[0]["component"] == "rino-runtime"
    assert entries[1]["severity"] == "error"
    assert entries[1]["detail"] == "malformed"


def test_fields_outside_the_allowlist_are_dropped() -> None:
    stream = io.StringIO()
    log = DiagnosticLog(stream=stream)

    log.record(
        DiagnosticSeverity.INFO,
        "RUNTIME_STARTED",
        payload={"screenshot": "bytes"},
        projectPath=r"C:\Users\example\project",
        requestId="5f0c2e9a-1c2b-4f6e-9d3a-8b7c6d5e4f30",
    )

    entry = read_entries(stream)[0]
    assert entry["requestId"] == "5f0c2e9a-1c2b-4f6e-9d3a-8b7c6d5e4f30"
    assert "payload" not in entry
    assert "projectPath" not in entry
    assert "example" not in json.dumps(entry)


def test_detail_values_are_bounded() -> None:
    stream = io.StringIO()
    log = DiagnosticLog(stream=stream)

    log.record(DiagnosticSeverity.WARNING, "RUNTIME_STARTED", detail="x" * 5000)

    assert len(read_entries(stream)[0]["detail"]) == 1024


def test_severity_below_the_threshold_is_not_emitted() -> None:
    stream = io.StringIO()
    log = DiagnosticLog(stream=stream, minimum_severity=DiagnosticSeverity.WARNING)

    log.record(DiagnosticSeverity.INFO, "RUNTIME_STARTED")
    log.record(DiagnosticSeverity.ERROR, "RUNTIME_STREAM_FAILURE")

    assert [entry["code"] for entry in read_entries(stream)] == [
        "RUNTIME_STREAM_FAILURE"
    ]


def test_a_log_directory_receives_a_rotating_file(tmp_path: Path) -> None:
    stream = io.StringIO()
    log = DiagnosticLog(stream=stream, log_directory=tmp_path / "logs")

    log.record(DiagnosticSeverity.INFO, "RUNTIME_STARTED")
    log.close()

    log_file = tmp_path / "logs" / LOG_FILE_NAME
    assert log_file.is_file()
    assert "RUNTIME_STARTED" in log_file.read_text(encoding="utf-8")
