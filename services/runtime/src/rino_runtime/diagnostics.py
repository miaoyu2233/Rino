"""Local structured diagnostics.

Standard output is reserved for protocol frames, so every human-readable diagnostic goes
to standard error as one JSON object per line. Fields are an explicit allowlist: only
stable codes, identifiers, and bounded technical details are emitted, never payload
content, project data, or absolute paths.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from enum import StrEnum
from logging import Formatter, Handler, LogRecord, StreamHandler, getLogger
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Final, TextIO, cast

LOGGER_NAME: Final[str] = "rino.runtime"
LOG_FILE_NAME: Final[str] = "rino-runtime.log"
MAXIMUM_LOG_FILE_BYTES: Final[int] = 10 * 1024 * 1024
LOG_FILE_BACKUP_COUNT: Final[int] = 5
MAXIMUM_DETAIL_LENGTH: Final[int] = 1024

_ALLOWED_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "code",
        "stage",
        "requestId",
        "runId",
        "nodeId",
        "messageType",
        "messageKind",
        "durationMilliseconds",
        "detail",
        "sequence",
    }
)


class DiagnosticSeverity(StrEnum):
    DEBUG = "debug"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


_SEVERITY_LEVELS: Final[dict[DiagnosticSeverity, int]] = {
    DiagnosticSeverity.DEBUG: 10,
    DiagnosticSeverity.INFO: 20,
    DiagnosticSeverity.WARNING: 30,
    DiagnosticSeverity.ERROR: 40,
}


def _sanitize_value(value: object) -> str | int | bool | None:
    if value is None or isinstance(value, bool | int):
        return value
    return str(value)[:MAXIMUM_DETAIL_LENGTH]


class RedactingJsonFormatter(Formatter):
    """Serializes one record as a bounded JSON object with allowlisted fields only."""

    def format(self, record: LogRecord) -> str:
        raw_fields = getattr(record, "diagnostic_fields", None)
        entry: dict[str, Any] = {
            "schemaVersion": 1,
            "component": "rino-runtime",
            "severity": record.levelname.lower(),
        }
        if isinstance(raw_fields, Mapping):
            fields = cast("Mapping[object, object]", raw_fields)
            for name in sorted(str(key) for key in fields):
                if name in _ALLOWED_FIELDS:
                    entry[name] = _sanitize_value(fields[name])
        return json.dumps(entry, separators=(",", ":"), sort_keys=True)


class DiagnosticLog:
    """Emits allowlisted diagnostics to standard error and an optional rotating file."""

    def __init__(
        self,
        *,
        stream: TextIO | None = None,
        log_directory: Path | None = None,
        minimum_severity: DiagnosticSeverity = DiagnosticSeverity.INFO,
    ) -> None:
        self._logger = getLogger(LOGGER_NAME)
        self._logger.setLevel(_SEVERITY_LEVELS[minimum_severity])
        self._logger.propagate = False
        for existing in list(self._logger.handlers):
            self._logger.removeHandler(existing)
            existing.close()

        formatter = RedactingJsonFormatter()
        stream_handler: Handler = StreamHandler(stream if stream else sys.stderr)
        stream_handler.setFormatter(formatter)
        self._logger.addHandler(stream_handler)

        if log_directory is not None:
            log_directory.mkdir(parents=True, exist_ok=True)
            file_handler = RotatingFileHandler(
                log_directory / LOG_FILE_NAME,
                maxBytes=MAXIMUM_LOG_FILE_BYTES,
                backupCount=LOG_FILE_BACKUP_COUNT,
                encoding="utf-8",
            )
            file_handler.setFormatter(formatter)
            self._logger.addHandler(file_handler)

    def record(
        self,
        severity: DiagnosticSeverity,
        code: str,
        **fields: object,
    ) -> None:
        self._logger.log(
            _SEVERITY_LEVELS[severity],
            code,
            extra={"diagnostic_fields": {"code": code, **fields}},
        )

    def close(self) -> None:
        for handler in list(self._logger.handlers):
            self._logger.removeHandler(handler)
            handler.close()
