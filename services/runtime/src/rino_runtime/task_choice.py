"""Bounded task-choice state shared by graph validation and the executor."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final, cast

TASK_CHOICE_TYPE_KEY: Final[str] = "core.logic.taskChoice"
MAXIMUM_TASK_CHOICE_CASES: Final[int] = 16
TASK_CHOICE_UNMATCHED_PORT_ID: Final[str] = "unmatched"
_CASE_ID_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[a-z][a-zA-Z0-9]{0,63}$")
_CASE_PORT_PATTERN: Final[re.Pattern[str]] = re.compile(r"^case([1-9]|1[0-6])$")
_MAXIMUM_LABEL_LENGTH: Final[int] = 80


@dataclass(frozen=True, slots=True)
class TaskChoiceCase:
    case_id: str
    port_id: str
    label: str


def _string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def parse_task_choice_cases(value: object) -> tuple[TaskChoiceCase, ...] | None:
    """Parse untrusted dynamic state without accepting partial or duplicate catalogs."""

    if not isinstance(value, Mapping):
        return None
    raw_mapping = cast("Mapping[object, object]", value)
    raw_cases = raw_mapping.get("taskChoiceCases")
    if not isinstance(raw_cases, list) or not raw_cases:
        return None
    raw_case_values = cast("list[object]", raw_cases)
    if len(raw_case_values) > MAXIMUM_TASK_CHOICE_CASES:
        return None

    cases: list[TaskChoiceCase] = []
    case_ids: set[str] = set()
    port_ids: set[str] = set()
    for raw_case in raw_case_values:
        if not isinstance(raw_case, Mapping):
            return None
        case_mapping = cast("Mapping[object, object]", raw_case)
        case_id = _string(case_mapping.get("caseId"))
        port_id = _string(case_mapping.get("portId"))
        raw_label = _string(case_mapping.get("label"))
        if (
            case_id is None
            or not _CASE_ID_PATTERN.fullmatch(case_id)
            or port_id is None
            or not _CASE_PORT_PATTERN.fullmatch(port_id)
            or raw_label is None
        ):
            return None
        label = raw_label.strip()
        if not label or len(label) > _MAXIMUM_LABEL_LENGTH:
            return None
        if case_id in case_ids or port_id in port_ids:
            return None
        case_ids.add(case_id)
        port_ids.add(port_id)
        cases.append(TaskChoiceCase(case_id, port_id, label))
    return tuple(cases)


def task_choice_case_for_id(
    cases: tuple[TaskChoiceCase, ...], case_id: str
) -> TaskChoiceCase | None:
    return next((case for case in cases if case.case_id == case_id), None)
