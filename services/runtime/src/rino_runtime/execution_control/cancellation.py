"""Loop-affine cooperative cancellation primitives for runtime operations."""

from __future__ import annotations

import asyncio
import math
from contextlib import suppress
from typing import Protocol, runtime_checkable


class RuntimeCancellationError(RuntimeError):
    code = "NODE_CANCELLED"
    message_key = "runtime.nodeError.nodeCancelled"

    def __init__(self) -> None:
        super().__init__(self.code)


class CancellationProbe(Protocol):
    def raise_if_cancelled(self) -> None: ...


class NeverCancelled:
    def raise_if_cancelled(self) -> None:
        return


@runtime_checkable
class CancellationSignal(CancellationProbe, Protocol):
    async def wait_cancelled(self) -> None: ...


class CancellationScope:
    """An idempotent cancellation signal owned by one runtime event loop."""

    def __init__(self) -> None:
        self._event = asyncio.Event()

    @property
    def is_cancelled(self) -> bool:
        return self._event.is_set()

    def cancel(self) -> bool:
        if self._event.is_set():
            return False
        self._event.set()
        return True

    def raise_if_cancelled(self) -> None:
        if self._event.is_set():
            raise RuntimeCancellationError

    async def wait_cancelled(self) -> None:
        await self._event.wait()


async def cancellable_delay(
    duration_seconds: float,
    cancellation: CancellationProbe,
) -> None:
    """Wait for a bounded duration while reacting promptly to cancellation."""

    if not math.isfinite(duration_seconds) or duration_seconds < 0:
        raise ValueError("Delay duration must be finite and non-negative.")
    cancellation.raise_if_cancelled()
    if duration_seconds == 0:
        await asyncio.sleep(0)
        cancellation.raise_if_cancelled()
        return
    if not isinstance(cancellation, CancellationSignal):
        await asyncio.sleep(duration_seconds)
        cancellation.raise_if_cancelled()
        return

    delay_task = asyncio.create_task(asyncio.sleep(duration_seconds))
    cancellation_task = asyncio.create_task(cancellation.wait_cancelled())
    try:
        completed, _ = await asyncio.wait(
            (delay_task, cancellation_task),
            return_when=asyncio.FIRST_COMPLETED,
        )
        if cancellation_task in completed:
            cancellation.raise_if_cancelled()
            raise RuntimeError("Cancellation signal completed without cancellation.")
        await delay_task
        cancellation.raise_if_cancelled()
    finally:
        await _cancel_and_settle(delay_task)
        await _cancel_and_settle(cancellation_task)


async def _cancel_and_settle(task: asyncio.Task[None]) -> None:
    if not task.done():
        task.cancel()
    with suppress(asyncio.CancelledError):
        await task
