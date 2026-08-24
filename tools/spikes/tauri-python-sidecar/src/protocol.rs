use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::io;
use std::str;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME_BYTES: usize = 64 * 1024;
const MAX_HEADER_BYTES: usize = 128;
const HEADER_TERMINATOR: &[u8] = b"\r\n\r\n";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageKind {
    Request,
    Response,
    Event,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolErrorBody {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
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
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ProtocolErrorBody>,
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
            payload: Some(payload),
            result: None,
            error: None,
        }
    }

    const fn validate(&self) -> Result<(), TransportError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(TransportError::UnsupportedProtocolVersion(
                self.protocol_version,
            ));
        }
        if self.message_type.is_empty() {
            return Err(TransportError::ProtocolViolation(
                "messageType must not be empty",
            ));
        }
        match self.message_kind {
            MessageKind::Request => {
                if self.request_id.is_none() || self.payload.is_none() {
                    return Err(TransportError::ProtocolViolation(
                        "request requires requestId and payload",
                    ));
                }
                if self.result.is_some() || self.error.is_some() {
                    return Err(TransportError::ProtocolViolation(
                        "request cannot contain result or error",
                    ));
                }
            }
            MessageKind::Response => {
                if self.request_id.is_none() || (self.result.is_some() == self.error.is_some()) {
                    return Err(TransportError::ProtocolViolation(
                        "response requires requestId and exactly one of result or error",
                    ));
                }
            }
            MessageKind::Event => {
                if self.event_id.is_none() || self.sequence.is_none() || self.payload.is_none() {
                    return Err(TransportError::ProtocolViolation(
                        "event requires eventId, sequence, and payload",
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
    FrameTooLarge { actual: usize, maximum: usize },
    TruncatedFrame,
    DecoderPoisoned,
    UnsupportedProtocolVersion(u16),
    ProtocolViolation(&'static str),
    RequestTimeout,
    SidecarExited(Option<i32>),
    OutputChannelClosed,
    ProcessCleanupFailed,
}

impl Display for TransportError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "I/O failure: {error}"),
            Self::InvalidUtf8 => formatter.write_str("frame body is not valid UTF-8"),
            Self::InvalidJson(error) => write!(formatter, "frame JSON is invalid: {error}"),
            Self::MalformedHeader => formatter.write_str("frame header is malformed"),
            Self::HeaderTooLarge => formatter.write_str("frame header exceeds its limit"),
            Self::FrameTooLarge { actual, maximum } => {
                write!(formatter, "frame size {actual} exceeds limit {maximum}")
            }
            Self::TruncatedFrame => formatter.write_str("stream ended during a frame"),
            Self::DecoderPoisoned => formatter.write_str("frame decoder is no longer usable"),
            Self::UnsupportedProtocolVersion(version) => {
                write!(formatter, "protocol version {version} is unsupported")
            }
            Self::ProtocolViolation(message) => write!(formatter, "protocol violation: {message}"),
            Self::RequestTimeout => formatter.write_str("request timed out"),
            Self::SidecarExited(code) => write!(formatter, "sidecar exited with code {code:?}"),
            Self::OutputChannelClosed => formatter.write_str("sidecar output channel closed"),
            Self::ProcessCleanupFailed => formatter.write_str("sidecar cleanup did not complete"),
        }
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

/// Encodes one validated envelope using the bounded Content-Length frame.
///
/// # Errors
///
/// Returns an error when envelope semantics are invalid, JSON encoding fails, or the
/// encoded body exceeds the configured frame limit.
pub fn encode_frame(envelope: &ProtocolEnvelope) -> Result<Vec<u8>, TransportError> {
    envelope.validate()?;
    let body = serde_json::to_vec(envelope).map_err(TransportError::InvalidJson)?;
    if body.len() > MAX_FRAME_BYTES {
        return Err(TransportError::FrameTooLarge {
            actual: body.len(),
            maximum: MAX_FRAME_BYTES,
        });
    }
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut frame = Vec::with_capacity(header.len() + body.len());
    frame.extend_from_slice(header.as_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

pub struct FrameDecoder {
    buffer: Vec<u8>,
    expected_body_bytes: Option<usize>,
    poisoned: bool,
}

impl FrameDecoder {
    pub const fn new() -> Self {
        Self {
            buffer: Vec::new(),
            expected_body_bytes: None,
            poisoned: false,
        }
    }

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
            if self.buffer.len() > MAX_HEADER_BYTES {
                return Err(TransportError::HeaderTooLarge);
            }
            return Ok(None);
        };
        if terminator_index > MAX_HEADER_BYTES {
            return Err(TransportError::HeaderTooLarge);
        }
        let header = str::from_utf8(&self.buffer[..terminator_index])
            .map_err(|_| TransportError::MalformedHeader)?;
        let Some(length_text) = header.strip_prefix("Content-Length: ") else {
            return Err(TransportError::MalformedHeader);
        };
        if length_text.is_empty() || !length_text.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(TransportError::MalformedHeader);
        }
        let body_bytes = length_text
            .parse::<usize>()
            .map_err(|_| TransportError::MalformedHeader)?;
        if body_bytes > MAX_FRAME_BYTES {
            return Err(TransportError::FrameTooLarge {
                actual: body_bytes,
                maximum: MAX_FRAME_BYTES,
            });
        }
        self.buffer
            .drain(..terminator_index + HEADER_TERMINATOR.len());
        self.expected_body_bytes = Some(body_bytes);
        Ok(Some(body_bytes))
    }
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn response(request_id: &str) -> ProtocolEnvelope {
        ProtocolEnvelope {
            protocol_version: PROTOCOL_VERSION,
            message_kind: MessageKind::Response,
            message_type: "system.handshake".to_owned(),
            request_id: Some(request_id.to_owned()),
            event_id: None,
            sequence: None,
            payload: None,
            result: Some(json!({"accepted": true})),
            error: None,
        }
    }

    #[test]
    fn decodes_every_fragmentation_boundary() -> Result<(), TransportError> {
        let frame = encode_frame(&response("request-1"))?;
        for split in 0..=frame.len() {
            let mut decoder = FrameDecoder::new();
            let mut messages = decoder.push(&frame[..split])?;
            messages.extend(decoder.push(&frame[split..])?);
            assert_eq!(messages, vec![response("request-1")]);
            decoder.finish()?;
        }
        Ok(())
    }

    #[test]
    fn decodes_multiple_frames_from_one_chunk() -> Result<(), TransportError> {
        let mut combined = encode_frame(&response("request-1"))?;
        combined.extend(encode_frame(&response("request-2"))?);
        let mut decoder = FrameDecoder::new();
        let messages = decoder.push(&combined)?;
        assert_eq!(messages, vec![response("request-1"), response("request-2")]);
        decoder.finish()?;
        Ok(())
    }

    #[test]
    fn rejects_malformed_header_and_poisoned_reuse() {
        let mut decoder = FrameDecoder::new();
        assert!(matches!(
            decoder.push(b"Content-Length: invalid\r\n\r\n"),
            Err(TransportError::MalformedHeader)
        ));
        assert!(matches!(
            decoder.push(b"ignored"),
            Err(TransportError::DecoderPoisoned)
        ));
    }

    #[test]
    fn rejects_oversized_frame_before_body_arrives() {
        let mut decoder = FrameDecoder::new();
        let header = format!("Content-Length: {}\r\n\r\n", MAX_FRAME_BYTES + 1);
        assert!(matches!(
            decoder.push(header.as_bytes()),
            Err(TransportError::FrameTooLarge { .. })
        ));
    }

    #[test]
    fn rejects_invalid_utf8() {
        let mut decoder = FrameDecoder::new();
        assert!(matches!(
            decoder.push(b"Content-Length: 1\r\n\r\n\xff"),
            Err(TransportError::InvalidUtf8)
        ));
    }

    #[test]
    fn rejects_truncated_stream() -> Result<(), TransportError> {
        let mut decoder = FrameDecoder::new();
        assert!(decoder.push(b"Content-Length: 5\r\n\r\nabc")?.is_empty());
        assert!(matches!(
            decoder.finish(),
            Err(TransportError::TruncatedFrame)
        ));
        Ok(())
    }
}
