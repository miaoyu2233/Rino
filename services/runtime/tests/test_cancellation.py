"""Cooperative cancellation behavior for runtime waits."""

from __future__ import annotations

import asyncio

import pytest

from rino_runtime.execution_control import (
    CancellationScope,
    RuntimeCancellationError,
    cancellable_delay,
)


@pytest.mark.asyncio
async def test_cancellation_scope_is_idempotent_and_wakes_waiters() -> None:
    scope = CancellationScope()
    waiter = asyncio.create_task(scope.wait_cancelled())
    await asyncio.sleep(0)

    assert not scope.is_cancelled
    assert scope.cancel()
    assert not scope.cancel()
    await asyncio.wait_for(waiter, timeout=0.5)
    assert scope.is_cancelled

    with pytest.raises(RuntimeCancellationError) as failure:
        scope.raise_if_cancelled()
    assert failure.value.code == "NODE_CANCELLED"


@pytest.mark.asyncio
async def test_cancellable_delay_stops_without_waiting_for_duration() -> None:
    scope = CancellationScope()
    delay_task = asyncio.create_task(cancellable_delay(60, scope))
    await asyncio.sleep(0)

    scope.cancel()

    with pytest.raises(RuntimeCancellationError) as failure:
        await asyncio.wait_for(delay_task, timeout=0.5)
    assert failure.value.code == "NODE_CANCELLED"


@pytest.mark.asyncio
async def test_zero_delay_still_observes_cancellation() -> None:
    scope = CancellationScope()
    scope.cancel()

    with pytest.raises(RuntimeCancellationError) as failure:
        await cancellable_delay(0, scope)
    assert failure.value.code == "NODE_CANCELLED"


@pytest.mark.asyncio
@pytest.mark.parametrize("duration", [-1.0, float("inf"), float("nan")])
async def test_invalid_delay_duration_is_rejected(duration: float) -> None:
    with pytest.raises(ValueError, match="finite and non-negative"):
        await cancellable_delay(duration, CancellationScope())
