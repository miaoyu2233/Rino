"""Allowlist tests for the explicit Android action boundary."""

from __future__ import annotations

import pytest

from rino_runtime.backends.android_actions import (
    AndroidKey,
    android_key_code,
    is_valid_android_intent,
    validate_android_intent,
)


@pytest.mark.parametrize(
    "intent",
    [
        "com.example.app",
        "com.example.app/MainActivity",
        "com.example.app/.MainActivity",
        "com.example.app/MainActivity$Inner",
    ],
)
def test_android_intent_allowlist_accepts_package_and_component_forms(
    intent: str,
) -> None:
    assert is_valid_android_intent(intent)
    assert validate_android_intent(intent) == intent


@pytest.mark.parametrize(
    "intent",
    [
        "",
        "com",
        "com.example.app/Main Activity",
        "com.example.app?extra=1",
        "com.example.app;shell-command",
        "com.example.app/../OtherActivity",
        " com.example.app",
    ],
)
def test_android_intent_allowlist_rejects_ambiguous_or_command_like_values(
    intent: str,
) -> None:
    assert not is_valid_android_intent(intent)
    with pytest.raises(ValueError):
        validate_android_intent(intent)


def test_android_intent_allowlist_has_a_bounded_length() -> None:
    intent = "com.example." + ("a" * 245)

    assert len(intent) > 255
    assert not is_valid_android_intent(intent)


def test_escape_is_the_only_graph_key_and_maps_to_android_keycode() -> None:
    assert tuple(AndroidKey) == (AndroidKey.ESCAPE,)
    assert android_key_code(AndroidKey.ESCAPE) == 111
