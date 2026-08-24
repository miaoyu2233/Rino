//! Message dispatch for one runtime process instance.
//!
//! A dedicated thread drains the runtime's protocol output as it arrives. Events are
//! forwarded immediately rather than only while a request happens to be waiting, and
//! responses are parked in a mailbox that request callers wait on. When the runtime stops
//! or the stream fails, the terminal condition is recorded once and every waiting caller
//! is released instead of blocking until its own timeout.

use std::collections::HashMap;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::process::ReaderEvent;
use super::protocol::{MessageKind, ProtocolEnvelope, TransportError};
use super::supervisor::ForwardedEvent;

/// Why a runtime instance stopped producing messages.
///
/// The classification is captured where the failure happened, so a caller waiting on a
/// response learns whether the runtime exited, its stream failed, or it violated the
/// protocol, instead of receiving one undifferentiated unavailability.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminalCondition {
    pub code: &'static str,
    pub detail: String,
    pub stream_ended_cleanly: bool,
}

#[derive(Default)]
struct MailboxContents {
    responses: HashMap<String, ProtocolEnvelope>,
    terminal: Option<TerminalCondition>,
}

/// Parked responses and the terminal condition for one runtime instance.
pub struct ResponseMailbox {
    contents: Mutex<MailboxContents>,
    arrival: Condvar,
}

impl ResponseMailbox {
    #[must_use]
    pub fn new() -> Self {
        Self {
            contents: Mutex::new(MailboxContents::default()),
            arrival: Condvar::new(),
        }
    }

    /// Waits for the response correlated to `request_id`.
    ///
    /// # Errors
    ///
    /// Returns an error when the runtime stopped, its stream failed, or the deadline passed.
    pub fn wait_for(
        &self,
        request_id: &str,
        timeout: Duration,
    ) -> Result<ProtocolEnvelope, TransportError> {
        let deadline = Instant::now() + timeout;
        let mut contents = self.lock();
        loop {
            if let Some(response) = contents.responses.remove(request_id) {
                return Ok(response);
            }
            if let Some(terminal) = contents.terminal.clone() {
                return Err(if terminal.stream_ended_cleanly {
                    TransportError::SidecarExited(None)
                } else {
                    TransportError::Terminal {
                        code: terminal.code,
                        detail: terminal.detail,
                    }
                });
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(TransportError::RequestTimeout);
            }
            let (guard, _timeout_result) = self
                .arrival
                .wait_timeout(contents, remaining)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            contents = guard;
        }
    }

    /// Clears parked responses so a new runtime instance starts from an empty mailbox.
    pub fn reset(&self) {
        let mut contents = self.lock();
        contents.responses.clear();
        contents.terminal = None;
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, MailboxContents> {
        self.contents
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn park(&self, request_id: String, response: ProtocolEnvelope) {
        self.lock().responses.insert(request_id, response);
        self.arrival.notify_all();
    }

    fn close(&self, terminal: TerminalCondition) {
        {
            let mut contents = self.lock();
            if contents.terminal.is_none() {
                contents.terminal = Some(terminal);
            }
        }
        self.arrival.notify_all();
    }

    fn close_from_stream_end(&self) {
        self.close(TerminalCondition {
            code: "SIDECAR_UNAVAILABLE",
            detail: "The runtime output stream ended.".to_owned(),
            stream_ended_cleanly: true,
        });
    }

    fn close_from_failure(&self, error: &TransportError) {
        self.close(TerminalCondition {
            code: error.code(),
            detail: error.safe_detail(),
            stream_ended_cleanly: false,
        });
    }
}

impl Default for ResponseMailbox {
    fn default() -> Self {
        Self::new()
    }
}

/// Starts the dispatch thread for one runtime instance.
///
/// The thread ends when the runtime's output stream ends, so a stopped instance never
/// forwards messages attributed to a later generation.
pub fn spawn_dispatcher(
    output: Receiver<ReaderEvent>,
    mailbox: Arc<ResponseMailbox>,
    event_sink: Sender<ForwardedEvent>,
    generation: u64,
) {
    thread::spawn(move || {
        let mut highest_event_sequence = 0_u64;
        while let Ok(message) = output.recv() {
            match message {
                ReaderEvent::Message(envelope) => match envelope.message_kind {
                    MessageKind::Response => {
                        if let Some(request_id) = envelope.request_id.clone() {
                            mailbox.park(request_id, *envelope);
                        }
                    }
                    MessageKind::Event => {
                        forward_event(
                            *envelope,
                            &event_sink,
                            generation,
                            &mut highest_event_sequence,
                        );
                    }
                    MessageKind::Request => {
                        mailbox.close_from_failure(&TransportError::ProtocolViolation(
                            "the runtime sent an unexpected request",
                        ));
                        return;
                    }
                },
                ReaderEvent::Failure(error) => {
                    mailbox.close_from_failure(&error);
                    return;
                }
                ReaderEvent::Eof => {
                    mailbox.close_from_stream_end();
                    return;
                }
            }
        }
        mailbox.close_from_stream_end();
    });
}

/// Forwards one event, dropping any whose sequence repeats or precedes an already
/// forwarded one so a duplicated or reordered frame cannot rewrite runtime history.
fn forward_event(
    envelope: ProtocolEnvelope,
    event_sink: &Sender<ForwardedEvent>,
    generation: u64,
    highest_event_sequence: &mut u64,
) {
    let (Some(event_id), Some(sequence), Some(payload)) =
        (envelope.event_id, envelope.sequence, envelope.payload)
    else {
        return;
    };
    if sequence <= *highest_event_sequence {
        return;
    }
    *highest_event_sequence = sequence;
    let _ignored = event_sink.send(ForwardedEvent {
        generation,
        message_type: envelope.message_type,
        event_id,
        sequence,
        run_id: envelope.run_id,
        node_id: envelope.node_id,
        payload,
    });
}
