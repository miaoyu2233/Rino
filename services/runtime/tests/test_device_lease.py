"""Serialization and cancellation tests for run-bound device leases."""

from __future__ import annotations

import asyncio

import pytest

from rino_runtime.execution_control import (
    CancellationScope,
    DeviceLeaseManager,
    NeverCancelled,
    RuntimeCancellationError,
)


async def _wait_for_event(event: asyncio.Event) -> None:
    await asyncio.wait_for(event.wait(), timeout=0.5)


async def _hold_device_lease(
    manager: DeviceLeaseManager,
    entered: asyncio.Event,
    release: asyncio.Event,
) -> None:
    async with manager.lease("device-a", NeverCancelled()):
        entered.set()
        await release.wait()


async def _enter_cancelled_lease(
    manager: DeviceLeaseManager,
    scope: CancellationScope,
) -> None:
    async with manager.lease("device-a", scope):
        raise AssertionError("Cancelled waiter entered the device lease.")


@pytest.mark.asyncio
async def test_same_device_operations_are_serialized() -> None:
    manager = DeviceLeaseManager()
    first_entered = asyncio.Event()
    second_entered = asyncio.Event()
    release_first = asyncio.Event()
    order: list[str] = []

    async def first() -> None:
        async with manager.lease("device-a", NeverCancelled()):
            order.append("first-enter")
            first_entered.set()
            await release_first.wait()
            order.append("first-exit")

    async def second() -> None:
        async with manager.lease("device-a", NeverCancelled()):
            order.append("second-enter")
            second_entered.set()

    first_task = asyncio.create_task(first())
    await _wait_for_event(first_entered)
    second_task = asyncio.create_task(second())
    await asyncio.sleep(0)

    assert not second_entered.is_set()
    release_first.set()
    await asyncio.gather(first_task, second_task)

    assert order == ["first-enter", "first-exit", "second-enter"]
    assert manager.tracked_device_count == 0


@pytest.mark.asyncio
async def test_different_devices_can_execute_in_parallel() -> None:
    manager = DeviceLeaseManager()
    first_entered = asyncio.Event()
    second_entered = asyncio.Event()
    release = asyncio.Event()

    async def operation(device_key: str, entered: asyncio.Event) -> None:
        async with manager.lease(device_key, NeverCancelled()):
            entered.set()
            await release.wait()

    first_task = asyncio.create_task(operation("device-a", first_entered))
    second_task = asyncio.create_task(operation("device-b", second_entered))
    await asyncio.gather(
        _wait_for_event(first_entered),
        _wait_for_event(second_entered),
    )

    release.set()
    await asyncio.gather(first_task, second_task)
    assert manager.tracked_device_count == 0


@pytest.mark.asyncio
async def test_cancellation_while_waiting_does_not_leak_the_device_lock() -> None:
    manager = DeviceLeaseManager()
    holder_entered = asyncio.Event()
    release_holder = asyncio.Event()
    scope = CancellationScope()

    async def holder() -> None:
        async with manager.lease("device-a", NeverCancelled()):
            holder_entered.set()
            await release_holder.wait()

    async def waiter() -> None:
        async with manager.lease("device-a", scope):
            raise AssertionError("Cancelled waiter entered the device lease.")

    holder_task = asyncio.create_task(holder())
    await _wait_for_event(holder_entered)
    waiter_task = asyncio.create_task(waiter())
    await asyncio.sleep(0)
    scope.cancel()

    with pytest.raises(RuntimeCancellationError):
        await asyncio.wait_for(waiter_task, timeout=0.5)
    release_holder.set()
    await holder_task

    async with manager.lease("device-a", NeverCancelled()):
        pass
    assert manager.tracked_device_count == 0


@pytest.mark.asyncio
async def test_task_cancellation_while_waiting_does_not_leak_the_device_lock() -> None:
    manager = DeviceLeaseManager()
    holder_entered = asyncio.Event()
    release_holder = asyncio.Event()
    holder_task = asyncio.create_task(
        _hold_device_lease(manager, holder_entered, release_holder)
    )
    await _wait_for_event(holder_entered)

    async def waiter() -> None:
        async with manager.lease("device-a", NeverCancelled()):
            raise AssertionError("Cancelled task entered the device lease.")

    waiter_task = asyncio.create_task(waiter())
    await asyncio.sleep(0)
    waiter_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await waiter_task
    release_holder.set()
    await holder_task

    async with manager.lease("device-a", NeverCancelled()):
        pass
    assert manager.tracked_device_count == 0


@pytest.mark.asyncio
async def test_release_and_cancellation_race_never_leaks_a_lease() -> None:
    manager = DeviceLeaseManager()

    for _ in range(25):
        holder_entered = asyncio.Event()
        release_holder = asyncio.Event()
        scope = CancellationScope()

        holder_task = asyncio.create_task(
            _hold_device_lease(manager, holder_entered, release_holder)
        )
        await _wait_for_event(holder_entered)
        waiter_task = asyncio.create_task(_enter_cancelled_lease(manager, scope))
        await asyncio.sleep(0)
        release_holder.set()
        scope.cancel()
        await holder_task
        with pytest.raises(RuntimeCancellationError):
            await asyncio.wait_for(waiter_task, timeout=0.5)

    async with manager.lease("device-a", NeverCancelled()):
        pass
    assert manager.tracked_device_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("device_key", ["", "   ", "x" * 257])
async def test_invalid_device_keys_are_rejected(device_key: str) -> None:
    manager = DeviceLeaseManager()

    with pytest.raises(ValueError, match="Device key"):
        async with manager.lease(device_key, NeverCancelled()):
            pass
