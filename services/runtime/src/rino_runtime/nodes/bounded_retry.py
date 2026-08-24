"""Shared safety bounds for visible bounded-retry control flow."""

from __future__ import annotations

from typing import Final

BOUNDED_RETRY_MINIMUM_TIMEOUT_MILLISECONDS: Final[int] = 1
BOUNDED_RETRY_MAXIMUM_TIMEOUT_MILLISECONDS: Final[int] = 18_000_000
BOUNDED_RETRY_MINIMUM_RATE_LIMIT_MILLISECONDS: Final[int] = 1
BOUNDED_RETRY_MAXIMUM_RATE_LIMIT_MILLISECONDS: Final[int] = 60_000
BOUNDED_RETRY_MAXIMUM_ATTEMPTS: Final[int] = 20_000


def calculate_bounded_retry_attempts(
    timeout_milliseconds: int,
    rate_limit_milliseconds: int,
) -> int | None:
    """Returns an exact bounded round count, or None when timing is unsupported."""

    if (
        isinstance(timeout_milliseconds, bool)
        or isinstance(rate_limit_milliseconds, bool)
        or not BOUNDED_RETRY_MINIMUM_TIMEOUT_MILLISECONDS
        <= timeout_milliseconds
        <= BOUNDED_RETRY_MAXIMUM_TIMEOUT_MILLISECONDS
        or not BOUNDED_RETRY_MINIMUM_RATE_LIMIT_MILLISECONDS
        <= rate_limit_milliseconds
        <= BOUNDED_RETRY_MAXIMUM_RATE_LIMIT_MILLISECONDS
    ):
        return None
    attempts = (
        timeout_milliseconds + rate_limit_milliseconds - 1
    ) // rate_limit_milliseconds
    if attempts > BOUNDED_RETRY_MAXIMUM_ATTEMPTS:
        return None
    return attempts
