from __future__ import annotations

import subprocess
import sys
import textwrap


def test_protocol_stdout_excludes_untrusted_native_writes() -> None:
    script = textwrap.dedent(
        """
        import ctypes
        import os
        import sys

        from rino_runtime.ipc.stdio_boundary import reserve_protocol_stdout

        protocol_target = reserve_protocol_stdout()
        os.write(sys.stdout.fileno(), b"native-file-descriptor-output")
        if sys.platform == "win32":
            runtime = ctypes.CDLL("msvcrt.dll")
            runtime.printf.argtypes = [ctypes.c_char_p]
            runtime.printf.restype = ctypes.c_int
            runtime.printf(b"native-runtime-output")
            runtime.fflush(None)
        protocol_target.write(b"protocol-frame")
        protocol_target.flush()
        protocol_target.close()
        """
    )

    completed = subprocess.run(
        [sys.executable, "-c", script],
        check=False,
        capture_output=True,
        timeout=10,
    )

    assert completed.returncode == 0
    assert completed.stdout == b"protocol-frame"
    assert completed.stderr == b""
