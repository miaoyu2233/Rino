"""Shared validation for the deliberately narrow Android action boundary."""

from __future__ import annotations

import re
from enum import StrEnum
from typing import Final, TypeGuard

MAXIMUM_ANDROID_INTENT_LENGTH: Final[int] = 255

_PACKAGE_COMPONENT = r"[A-Za-z][A-Za-z0-9_]*"
_PACKAGE_PATTERN = rf"{_PACKAGE_COMPONENT}(?:\.{_PACKAGE_COMPONENT})+"
_ACTIVITY_COMPONENT = r"[A-Za-z_$][A-Za-z0-9_$]*"
_ACTIVITY_PATTERN = (
    rf"(?:\.{_ACTIVITY_COMPONENT}|{_ACTIVITY_COMPONENT}"
    rf"(?:\.{_ACTIVITY_COMPONENT})*)"
)
_ANDROID_INTENT_BODY = rf"(?:{_PACKAGE_PATTERN})(?:/{_ACTIVITY_PATTERN})?"
ANDROID_INTENT_PATTERN: Final[str] = rf"^(?:{_ANDROID_INTENT_BODY})$"
_ANDROID_INTENT_PATTERN = re.compile(_ANDROID_INTENT_BODY)


class AndroidKey(StrEnum):
    """Semantic Android keys approved for graph execution."""

    ESCAPE = "escape"


ANDROID_KEY_CODES: Final[dict[AndroidKey, int]] = {
    AndroidKey.ESCAPE: 111,
}


def is_valid_android_intent(value: object) -> TypeGuard[str]:
    if not isinstance(value, str):
        return False
    if not 1 <= len(value) <= MAXIMUM_ANDROID_INTENT_LENGTH:
        return False
    return _ANDROID_INTENT_PATTERN.fullmatch(value) is not None


def validate_android_intent(value: object) -> str:
    if not is_valid_android_intent(value):
        raise ValueError("The Android application intent is not allowlisted.")
    return value


def android_key_code(key: AndroidKey) -> int:
    try:
        return ANDROID_KEY_CODES[key]
    except KeyError as error:
        raise ValueError("The Android key is not allowlisted.") from error
