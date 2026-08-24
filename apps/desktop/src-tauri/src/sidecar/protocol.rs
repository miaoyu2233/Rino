//! Envelope types and Content-Length framing for the local runtime protocol.
//!
//! Rust is the transport between two validating ends: the frontend and the Python runtime
//! each validate payloads against the canonical schema. This layer therefore validates the
//! envelope structure and every size limit, and forwards payload bodies opaquely so a
//! contract change does not require a Rust change.

use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::io;
use std::str;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const PROTOCOL_VERSION: u16 = 1;
pub const DEFAULT_MAXIMUM_FRAME_BYTES: usize = 1024 * 1024;
pub const MAXIMUM_SUPPORTED_FRAME_BYTES: usize = 16 * 1024 * 1024;
const MAXIMUM_HEADER_BYTES: usize = 128;
const HEADER_TERMINATOR: &[u8] = b"\r\n\r\n";
const HEADER_PREFIX: &str = "Content-Length: ";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageKind {
    Request,
    Response,
    Event,
}

/// A structured error as defined by the canonical contract.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolError {
    pub code: String,
    pub message_key: String,
    pub parameters: Value,
    pub technical_detail: String,
    pub retryability: Retryability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Retryability {
    Never,
    Safe,
    ExplicitConfirmation,
}

impl ProtocolError {
    #[must_use]
    pub fn new(
        code: &str,
        message_key: &str,
        technical_detail: String,
        retryability: Retryability,
    ) -> Self {
        Self {
            code: code.to_owned(),
            message_key: message_key.to_owned(),
            parameters: json!({}),
            technical_detail,
            retryability,
            request_id: None,
        }
    }

    #[must_use]
    pub fn sidecar_unavailable(technical_detail: String) -> Self {
        Self::new(
            "SIDECAR_UNAVAILABLE",
            "runtime.error.sidecarUnavailable",
            technical_detail,
            Retryability::Safe,
        )
    }

    #[must_use]
    pub fn request_timeout(technical_detail: String) -> Self {
        Self::new(
            "REQUEST_TIMEOUT",
            "runtime.error.requestTimeout",
            technical_detail,
            Retryability::Safe,
        )
    }

    #[must_use]
    pub fn transport_failure(technical_detail: String) -> Self {
        Self::new(
            "TRANSPORT_FAILURE",
            "runtime.error.transportFailure",
            technical_detail,
            Retryability::Never,
        )
    }

    #[must_use]
    pub fn with_request_id(mut self, request_id: &str) -> Self {
        self.request_id = Some(request_id.to_owned());
        self
    }
}

/// One decoded protocol message.
///
/// Unknown envelope fields are rejected so a peer cannot smuggle data past the transport,
/// while `payload`, `result`, and `error` bodies stay opaque to this layer.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtocolEnvelope {
    pub protocol_version: u16,
    pub message_kind: MessageKind,
    pub message_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

impl ProtocolEnvelope {
    #[must_use]
    pub fn request(message_type: &str, request_id: String, payload: Value) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            message_kind: MessageKind::Request,
            message_type: message_type.to_owned(),
            request_id: Some(request_id),
            event_id: None,
            sequence: None,
            run_id: None,
            node_id: None,
            payload: Some(payload),
            result: None,
            error: None,
        }
    }

    /// Validates the envelope this layer is responsible for.
    ///
    /// Identifier format, message-type shape, and the presence and kind of each envelope
    /// member are enforced here because correlation and routing depend on them. The bodies
    /// inside `payload`, `result`, and `error` are validated against the canonical schema
    /// by the two ends, so they stay opaque to the transport.
    fn validate(&self) -> Result<(), TransportError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(TransportError::UnsupportedProtocolVersion(
                self.protocol_version,
            ));
        }
        if !is_valid_message_type(&self.message_type) {
            return Err(TransportError::ProtocolViolation(
                "messageType must be a dotted lower-camel-case identifier",
            ));
        }
        if let Some(request_id) = &self.request_id
            && !is_valid_identifier(request_id)
        {
            return Err(TransportError::ProtocolViolation(
                "requestId must be a UUID",
            ));
        }
        if let Some(event_id) = &self.event_id
            && !is_valid_identifier(event_id)
        {
            return Err(TransportError::ProtocolViolation("eventId must be a UUID"));
        }
        if let Some(payload) = &self.payload
            && !payload.is_object()
        {
            return Err(TransportError::ProtocolViolation(
                "payload must be a JSON object",
            ));
        }
        if let Some(result) = &self.result
            && !result.is_object()
        {
            return Err(TransportError::ProtocolViolation(
                "result must be a JSON object",
            ));
        }
        match self.message_kind {
            MessageKind::Request => {
                if self.request_id.is_none() || self.payload.is_none() {
                    return Err(TransportError::ProtocolViolation(
                        "a request requires requestId and payload",
                    ));
                }
                if self.result.is_some() || self.error.is_some() {
                    return Err(TransportError::ProtocolViolation(
                        "a request cannot carry result or error",
                    ));
                }
            }
            MessageKind::Response => {
                if self.request_id.is_none() {
                    return Err(TransportError::ProtocolViolation(
                        "a response requires requestId",
                    ));
                }
                if self.result.is_some() == self.error.is_some() {
                    return Err(TransportError::ProtocolViolation(
                        "a response requires exactly one of result or error",
                    ));
                }
            }
            MessageKind::Event => {
                if self.event_id.is_none() || self.sequence.is_none() || self.payload.is_none() {
                    return Err(TransportError::ProtocolViolation(
                        "an event requires eventId, sequence, and payload",
                    ));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug)]
pub enum TransportError {
    Io(io::Error),
    InvalidUtf8,
    InvalidJson(serde_json::Error),
    MalformedHeader,
    HeaderTooLarge,
    FrameTooLarge {
        actual: usize,
        maximum: usize,
    },
    TruncatedFrame,
    DecoderPoisoned,
    UnsupportedProtocolVersion(u16),
    ProtocolViolation(&'static str),
    RequestTimeout,
    SidecarExited(Option<i32>),
    SidecarUnavailable,
    OutputChannelClosed,
    ProcessCleanupFailed,
    /// A failure that already ended the runtime's output stream, carrying the
    /// classification captured when it happened.
    Terminal {
        code: &'static str,
        detail: String,
    },
}

impl TransportError {
    /// Maps a transport failure onto the stable error code the frontend receives.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::RequestTimeout => "REQUEST_TIMEOUT",
            Self::SidecarExited(_) | Self::SidecarUnavailable | Self::OutputChannelClosed => {
                "SIDECAR_UNAVAILABLE"
            }
            Self::Terminal { code, .. } => code,
            _ => "TRANSPORT_FAILURE",
        }
    }

    /// Returns a technical detail that never contains peer payload bytes or paths.
    #[must_use]
    pub fn safe_detail(&self) -> String {
        match self {
            Self::Io(_) => "A transport input or output operation failed.".to_owned(),
            Self::InvalidUtf8 => "A frame body was not valid UTF-8.".to_owned(),
            Self::InvalidJson(_) => "A frame body was not valid JSON.".to_owned(),
            Self::MalformedHeader => "A frame header was malformed.".to_owned(),
            Self::HeaderTooLarge => "A frame header exceeded its byte limit.".to_owned(),
            Self::FrameTooLarge { maximum, .. } => {
                format!("A frame exceeded the negotiated limit of {maximum} bytes.")
            }
            Self::TruncatedFrame => "The runtime output ended mid-frame.".to_owned(),
            Self::DecoderPoisoned => {
                "The frame decoder cannot resynchronize after a framing failure.".to_owned()
            }
            Self::UnsupportedProtocolVersion(version) => {
                format!("The runtime reported unsupported protocol version {version}.")
            }
            Self::ProtocolViolation(message) => (*message).to_owned(),
            Self::RequestTimeout => "The runtime did not answer within the timeout.".to_owned(),
            Self::SidecarExited(_) => "The runtime process exited.".to_owned(),
            Self::SidecarUnavailable => "The runtime process is not running.".to_owned(),
            Self::OutputChannelClosed => "The runtime output channel closed.".to_owned(),
            Self::ProcessCleanupFailed => {
                "The runtime process did not stop within its cleanup timeout.".to_owned()
            }
            Self::Terminal { detail, .. } => detail.clone(),
        }
    }
}

impl Display for TransportError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.safe_detail())
    }
}

impl Error for TransportError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::InvalidJson(error) => Some(error),
            _ => None,
        }
    }
}

impl From<io::Error> for TransportError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Encodes one validated envelope as a bounded Content-Length frame.
///
/// # Errors
///
/// Returns an error when the envelope is structurally invalid, JSON encoding fails, or the
/// encoded body exceeds the frame limit.
pub fn encode_frame(
    envelope: &ProtocolEnvelope,
    maximum_frame_bytes: usize,
) -> Result<Vec<u8>, TransportError> {
    envelope.validate()?;
    let body = serde_json::to_vec(envelope).map_err(TransportError::InvalidJson)?;
    if body.len() > maximum_frame_bytes {
        return Err(TransportError::FrameTooLarge {
            actual: body.len(),
            maximum: maximum_frame_bytes,
        });
    }
    let header = format!("{HEADER_PREFIX}{}\r\n\r\n", body.len());
    let mut frame = Vec::with_capacity(header.len() + body.len());
    frame.extend_from_slice(header.as_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

/// Incremental decoder for the Content-Length framing.
pub struct FrameDecoder {
    buffer: Vec<u8>,
    expected_body_bytes: Option<usize>,
    maximum_frame_bytes: usize,
    poisoned: bool,
}

impl FrameDecoder {
    #[must_use]
    pub const fn new(maximum_frame_bytes: usize) -> Self {
        Self {
            buffer: Vec::new(),
            expected_body_bytes: None,
            maximum_frame_bytes,
            poisoned: false,
        }
    }

    /// Adopts a frame limit agreed during the handshake.
    pub const fn set_maximum_frame_bytes(&mut self, maximum_frame_bytes: usize) {
        self.maximum_frame_bytes = maximum_frame_bytes;
    }

    /// Adds received bytes and returns every complete envelope they produced.
    ///
    /// # Errors
    ///
    /// Returns an error on a malformed header, an oversized frame, invalid UTF-8, invalid
    /// JSON, or an envelope that violates the protocol.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<ProtocolEnvelope>, TransportError> {
        if self.poisoned {
            return Err(TransportError::DecoderPoisoned);
        }
        self.buffer.extend_from_slice(bytes);
        let result = self.decode_available();
        if result.is_err() {
            self.poisoned = true;
        }
        result
    }

    /// Asserts that the stream ended on a frame boundary.
    ///
    /// # Errors
    ///
    /// Returns an error when the decoder is poisoned or a partial frame remains buffered.
    pub const fn finish(&mut self) -> Result<(), TransportError> {
        if self.poisoned {
            return Err(TransportError::DecoderPoisoned);
        }
        if self.buffer.is_empty() && self.expected_body_bytes.is_none() {
            Ok(())
        } else {
            self.poisoned = true;
            Err(TransportError::TruncatedFrame)
        }
    }

    fn decode_available(&mut self) -> Result<Vec<ProtocolEnvelope>, TransportError> {
        let mut messages = Vec::new();
        loop {
            let body_bytes = match self.expected_body_bytes {
                Some(length) => length,
                None => match self.parse_header()? {
                    Some(length) => length,
                    None => break,
                },
            };
            if self.buffer.len() < body_bytes {
                break;
            }
            let body = self.buffer.drain(..body_bytes).collect::<Vec<_>>();
            self.expected_body_bytes = None;
            let body_text = str::from_utf8(&body).map_err(|_| TransportError::InvalidUtf8)?;
            let envelope: ProtocolEnvelope =
                serde_json::from_str(body_text).map_err(TransportError::InvalidJson)?;
            envelope.validate()?;
            messages.push(envelope);
        }
        Ok(messages)
    }

    fn parse_header(&mut self) -> Result<Option<usize>, TransportError> {
        let Some(terminator_index) = find_subsequence(&self.buffer, HEADER_TERMINATOR) else {
            if self.buffer.len() > MAXIMUM_HEADER_BYTES {
                return Err(TransportError::HeaderTooLarge);
            }
            return Ok(None);
        };
        if terminator_index > MAXIMUM_HEADER_BYTES {
            return Err(TransportError::HeaderTooLarge);
        }
        let header = str::from_utf8(&self.buffer[..terminator_index])
            .map_err(|_| TransportError::MalformedHeader)?;
        let Some(length_text) = header.strip_prefix(HEADER_PREFIX) else {
            return Err(TransportError::MalformedHeader);
        };
        if length_text.is_empty() || !length_text.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(TransportError::MalformedHeader);
        }
        let body_bytes = length_text
            .parse::<usize>()
            .map_err(|_| TransportError::MalformedHeader)?;
        if body_bytes > self.maximum_frame_bytes {
            return Err(TransportError::FrameTooLarge {
                actual: body_bytes,
                maximum: self.maximum_frame_bytes,
            });
        }
        self.buffer
            .drain(..terminator_index + HEADER_TERMINATOR.len());
        self.expected_body_bytes = Some(body_bytes);
        Ok(Some(body_bytes))
    }
}

/// Matches the canonical UUID form without pulling parsing into the transport.
fn is_valid_identifier(value: &str) -> bool {
    const GROUP_LENGTHS: [usize; 5] = [8, 4, 4, 4, 12];

    let mut groups = value.split('-');
    for expected in GROUP_LENGTHS {
        let Some(group) = groups.next() else {
            return false;
        };
        if group.len() != expected || !group.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return false;
        }
    }
    groups.next().is_none()
}

/// Matches the canonical dotted lower-camel-case message-type form.
fn is_valid_message_type(value: &str) -> bool {
    if value.len() > 128 || !value.contains('.') {
        return false;
    }
    value.split('.').all(|segment| {
        segment
            .as_bytes()
            .split_first()
            .is_some_and(|(first, rest)| {
                first.is_ascii_lowercase() && rest.iter().all(u8::is_ascii_alphanumeric)
            })
    })
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}
