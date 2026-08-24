"""Blocking stdio transport loop.

Standard input is read in bounded chunks and decoded incrementally; standard output
carries only protocol frames. The loop terminates on an accepted shutdown request, on
end of input (which is how a parent process exit is observed), or on an unrecoverable
framing failure.
"""

from __future__ import annotations

from queue import Full, Queue
from threading import Thread
from typing import Final, Protocol

from rino_runtime.contracts import IpcMessageV1
from rino_runtime.diagnostics import DiagnosticLog, DiagnosticSeverity
from rino_runtime.errors import RuntimeErrorCode
from rino_runtime.ipc.framing import FrameDecoder, FrameError, encode_frame
from rino_runtime.service import RuntimeService, encode_outgoing

READ_CHUNK_BYTES: Final[int] = 8192

EXIT_SUCCESS: Final[int] = 0
EXIT_TRANSPORT_FAILURE: Final[int] = 2
WRITER_SHUTDOWN_WAIT_SECONDS: Final[float] = 5.0
WRITER_QUEUE_WAIT_SECONDS: Final[float] = 5.0


class _WriterSentinel:
    pass


_WRITER_SENTINEL: Final[_WriterSentinel] = _WriterSentinel()


class ByteReader(Protocol):
    """A source that returns whatever bytes have arrived, up to a bound.

    The transport requires a partial read. A buffered stream's ``read`` blocks until it
    has the full requested count or the peer closes the pipe, which would stall the
    protocol until the desktop disconnected; ``read1`` returns as soon as any bytes are
    available.
    """

    def read1(self, size: int, /) -> bytes: ...


class ByteWriter(Protocol):
    def write(self, data: bytes, /) -> int: ...

    def flush(self) -> None: ...


class _ProtocolWriter:
    def __init__(
        self,
        service: RuntimeService,
        diagnostics: DiagnosticLog,
        target: ByteWriter,
    ) -> None:
        self._service = service
        self._diagnostics = diagnostics
        self._target = target
        self._queue: Queue[IpcMessageV1 | _WriterSentinel] = Queue(maxsize=2_048)
        self._failure: Exception | None = None
        self._thread = Thread(
            target=self._write_loop,
            name="rino-protocol-writer",
            daemon=True,
        )

    @property
    def failed(self) -> bool:
        return self._failure is not None

    def start(self) -> None:
        self._thread.start()

    def enqueue(self, message: IpcMessageV1) -> None:
        if self._failure is not None:
            raise OSError("The protocol writer is unavailable.")
        try:
            self._queue.put(message, timeout=WRITER_QUEUE_WAIT_SECONDS)
        except Full as error:
            raise OSError("The protocol writer queue is full.") from error

    def close(self) -> None:
        if self._failure is None:
            try:
                self._queue.put(
                    _WRITER_SENTINEL,
                    timeout=WRITER_QUEUE_WAIT_SECONDS,
                )
            except Full:
                self._diagnostics.record(
                    DiagnosticSeverity.ERROR,
                    "RUNTIME_WRITER_QUEUE_DRAIN_TIMEOUT",
                )
        self._thread.join(WRITER_SHUTDOWN_WAIT_SECONDS)
        if self._thread.is_alive():
            self._diagnostics.record(
                DiagnosticSeverity.ERROR,
                "RUNTIME_WRITER_SHUTDOWN_TIMEOUT",
            )

    def _write_loop(self) -> None:
        try:
            while True:
                message = self._queue.get()
                if isinstance(message, _WriterSentinel):
                    return
                body = encode_outgoing(message)
                self._target.write(
                    encode_frame(body, self._service.negotiated_frame_bytes)
                )
                self._target.flush()
        except Exception as error:
            self._failure = error
            self._diagnostics.record(
                DiagnosticSeverity.ERROR,
                "RUNTIME_PROTOCOL_WRITE_FAILURE",
                detail=type(error).__name__,
            )


class StdioTransport:
    """Drives one runtime service over a pair of binary streams."""

    def __init__(
        self,
        service: RuntimeService,
        diagnostics: DiagnosticLog,
    ) -> None:
        self._service = service
        self._diagnostics = diagnostics

    def serve(self, source: ByteReader, target: ByteWriter) -> int:
        writer = _ProtocolWriter(self._service, self._diagnostics, target)
        writer.start()
        self._service.set_async_message_sink(writer.enqueue)
        runtime_closed = True
        try:
            exit_code = self._serve_input(source, writer)
        finally:
            runtime_closed = self._service.close()
            self._service.set_async_message_sink(None)
            writer.close()
        if writer.failed or not runtime_closed:
            return EXIT_TRANSPORT_FAILURE
        return exit_code

    def _serve_input(self, source: ByteReader, writer: _ProtocolWriter) -> int:
        decoder = FrameDecoder(self._service.negotiated_frame_bytes)
        self._diagnostics.record(DiagnosticSeverity.INFO, "RUNTIME_STARTED")

        while True:
            chunk = source.read1(READ_CHUNK_BYTES)
            if not chunk:
                return self._finish(decoder)

            try:
                bodies = decoder.push(chunk)
            except FrameError as error:
                self._report_framing_failure(writer, error)
                return EXIT_TRANSPORT_FAILURE

            for body in bodies:
                outgoing = self._service.handle_frame_body(body)
                for message in outgoing.messages:
                    writer.enqueue(message)
                outgoing.notify_messages_queued()
                if outgoing.stop_requested:
                    self._diagnostics.record(
                        DiagnosticSeverity.INFO, "RUNTIME_SHUTDOWN_ACCEPTED"
                    )
                    return EXIT_SUCCESS

            # The frame limit is negotiated during the handshake, so the decoder adopts
            # the agreed value as soon as the handshake completes.
            decoder.maximum_frame_bytes = self._service.negotiated_frame_bytes

    def _finish(self, decoder: FrameDecoder) -> int:
        try:
            decoder.finish()
        except FrameError as error:
            self._diagnostics.record(
                DiagnosticSeverity.ERROR,
                "RUNTIME_INPUT_TRUNCATED",
                detail=error.kind.value,
            )
            return EXIT_TRANSPORT_FAILURE
        self._diagnostics.record(DiagnosticSeverity.INFO, "RUNTIME_INPUT_CLOSED")
        return EXIT_SUCCESS

    def _report_framing_failure(
        self, writer: _ProtocolWriter, error: FrameError
    ) -> None:
        self._diagnostics.record(
            DiagnosticSeverity.ERROR,
            "RUNTIME_FRAMING_FAILURE",
            detail=error.kind.value,
        )
        event = self._service.build_protocol_error_event(
            RuntimeErrorCode.TRANSPORT_FAILURE,
            error.detail,
        )
        writer.enqueue(event)
