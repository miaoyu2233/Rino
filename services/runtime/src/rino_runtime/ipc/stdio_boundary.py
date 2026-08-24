"""Reserve the inherited output pipe for framed protocol bytes only."""

from __future__ import annotations

import os
import sys
from typing import BinaryIO


def reserve_protocol_stdout() -> BinaryIO:
    """Return a duplicate of stdout and quarantine subsequent native writes.

    Native libraries can write directly to file descriptor 1 without going through
    Python logging. The desktop protocol keeps a duplicate of the inherited pipe while
    descriptor 1 is redirected to the null device before any native backend starts.
    """

    stdout_descriptor = sys.stdout.fileno()
    sys.stdout.flush()
    protocol_descriptor = os.dup(stdout_descriptor)
    try:
        null_descriptor = os.open(os.devnull, os.O_WRONLY)
        try:
            os.dup2(null_descriptor, stdout_descriptor)
        finally:
            os.close(null_descriptor)
        return os.fdopen(protocol_descriptor, "wb", buffering=0)
    except OSError:
        os.close(protocol_descriptor)
        raise
