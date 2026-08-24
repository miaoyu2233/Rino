"""Cancellation-aware serialization for operations bound to one device."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from contextlib import AbstractAsyncContextManager, asynccontextmanager, suppress
from dataclasses import dataclass, field
from typing import Protocol

from rino_runtime.execution_control.cancellation import (
    CancellationProbe,
    CancellationSignal,
)

MAX_DEVICE_KEY_LENGTH = 256


class DeviceLeaseProvider(Protocol):
    def lease(
        self,
        device_key: str,
        cancellation: CancellationProbe,
    ) -> AbstractAsyncContextManager[None]: ...


@dataclass(slots=True)
class _LeaseEntry:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    users: int = 0


class DeviceLeaseManager:
    """Serializes one device while allowing independent devices to run in parallel."""

    def __init__(self) -> None:
        self._entries: dict[str, _LeaseEntry] = {}

    @property
    def tracked_device_count(self) -> int:
        return len(self._entries)

    @asynccontextmanager
    async def lease(
        self,
        device_key: str,
        cancellation: CancellationProbe,
    ) -> AsyncGenerator[None]:
        _validate_device_key(device_key)
        cancellation.raise_if_cancelled()
        entry = self._entries.setdefault(device_key, _LeaseEntry())
        entry.users += 1
        acquired = False
        try:
            await _acquire_lock(entry.lock, cancellation)
            acquired = True
            yield
        finally:
            if acquired:
                entry.lock.release()
            entry.users -= 1
            if (
                entry.users == 0
                and not entry.lock.locked()
                and self._entries.get(device_key) is entry
            ):
                del self._entries[device_key]


def _validate_device_key(device_key: str) -> None:
    if not device_key.strip() or len(device_key) > MAX_DEVICE_KEY_LENGTH:
        raise ValueError("Device key must be non-empty and within the size limit.")


async def _acquire_lock(
    lock: asyncio.Lock,
    cancellation: CancellationProbe,
) -> None:
    cancellation.raise_if_cancelled()
    acquire_task = asyncio.create_task(lock.acquire())
    cancellation_task: asyncio.Task[None] | None = None
    acquired = False
    try:
        if isinstance(cancellation, CancellationSignal):
            cancellation_task = asyncio.create_task(cancellation.wait_cancelled())
            completed, _ = await asyncio.wait(
                (acquire_task, cancellation_task),
                return_when=asyncio.FIRST_COMPLETED,
            )
            if acquire_task in completed:
                acquired = acquire_task.result()
            if cancellation_task in completed:
                cancellation.raise_if_cancelled()
                raise RuntimeError(
                    "Cancellation signal completed without cancellation."
                )
        if not acquired:
            acquired = await acquire_task
        cancellation.raise_if_cancelled()
    except BaseException:
        if not acquired:
            acquired = await _cancel_acquire_task(acquire_task)
        if acquired:
            lock.release()
        raise
    finally:
        if cancellation_task is not None:
            await _cancel_and_settle(cancellation_task)


async def _cancel_acquire_task(task: asyncio.Task[bool]) -> bool:
    if not task.done():
        task.cancel()
    try:
        return await task
    except asyncio.CancelledError:
        return False


async def _cancel_and_settle(task: asyncio.Task[None]) -> None:
    if not task.done():
        task.cancel()
    with suppress(asyncio.CancelledError):
        await task
