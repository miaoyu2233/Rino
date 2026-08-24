//! Framing and envelope-validation tests for the local runtime transport.

//! Test assertions panic by design and report skips on standard error, so the workspace
//! lints that forbid those in production code are relaxed for this integration test.
#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::print_stderr,
    clippy::unwrap_used,
    reason = "an integration test reports failures by panicking and skips on stderr"
)]

use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};

use rino_desktop_lib::sidecar::protocol::{
    DEFAULT_MAXIMUM_FRAME_BYTES, FrameDecoder, MessageKind, PROTOCOL_VERSION, ProtocolEnvelope,
    TransportError, encode_frame,
};
use serde_json::{Value, json};

const FIRST_REQUEST_ID: &str = "5f0c2e9a-1c2b-4f6e-9d3a-8b7c6d5e4f30";
const SECOND_REQUEST_ID: &str = "0b9d4a77-6c3f-4d2e-8a1b-2c3d4e5f6a70";

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}

fn response(request_id: &str) -> ProtocolEnvelope {
    ProtocolEnvelope {
        protocol_version: PROTOCOL_VERSION,
        message_kind: MessageKind::Response,
        message_type: "system.handshake".to_owned(),
        request_id: Some(request_id.to_owned()),
        event_id: None,
        sequence: None,
        run_id: None,
        node_id: None,
        payload: None,
        result: Some(json!({"accepted": true})),
        error: None,
    }
}

#[test]
fn every_fragmentation_boundary_decodes_the_same_envelope() -> Result<(), TransportError> {
    let frame = encode_frame(&response(FIRST_REQUEST_ID), DEFAULT_MAXIMUM_FRAME_BYTES)?;

    for split in 0..=frame.len() {
        let mut decoder = FrameDecoder::new(DEFAULT_MAXIMUM_FRAME_BYTES);
        let mut messages = decoder.push(&frame[..split])?;
        messages.extend(decoder.push(&frame[split..])?);

        assert_eq!(messages, vec![response(FIRST_REQUEST_ID)]);
        decoder.finish()?;
    }
    Ok(())
}

#[test]
fn multiple_frames_in_one_chunk_decode_in_order() -> Result<(), TransportError> {
    let mut combined = encode_frame(&response(FIRST_REQUEST_ID), DEFAULT_MAXIMUM_FRAME_BYTES)?;
    combined.extend(encode_frame(
        &response(SECOND_REQUEST_ID),
        DEFAULT_MAXIMUM_FRAME_BYTES,
    )?);
    let mut decoder = FrameDecoder::new(DEFAULT_MAXIMUM_FRAME_BYTES);

    let messages = decoder.push(&combined)?;

    assert_eq!(
        messages,
        vec![response(FIRST_REQUEST_ID), response(SECOND_REQUEST_ID)]
    );
    decoder.finish()?;
    Ok(())
}

#[test]
fn a_malformed_header_poisons_the_decoder() {
    let mut decoder = FrameDecoder::new(DEFAULT_MAXIMUM_FRAME_BYTES);

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
fn an_oversized_frame_is_rejected_before_its_body_arrives() {
    let mut decoder = FrameDecoder::new(DEFAULT_MAXIMUM_FRAME_BYTES);
    let header = format!(
        "Content-Length: {}\r\n\r\n",
        DEFAULT_MAXIMUM_FRAME_BYTES + 1
    );

    assert!(matches!(
        decoder.push(header.as_bytes()),
        Err(TransportError::FrameTooLarge { .. })
    ));
}

#[test]
fn a_negotiated_frame_limit_applies_to_later_frames() {
    let mut decoder = FrameDecoder::new(DEFAULT_MAXIMUM_FRAME_BYTES);
    decoder.set_maximum_frame_bytes(4096);

    assert!(matches!(
        decoder.push(b"Content-Length: 4097\r\n\r\n"),
        Err(TransportError::FrameTooLarge { .. })
    ));
}

#[test]
fn invalid_utf8_and_truncated_streams_are_rejected() {
    let mut invalid = FrameDecoder::new(DEFAULT_MAXIMUM_FRAME_BYTES);
    assert!(matches!(
        invalid.push(b"Content-Length: 1\r\n\r\n\xff"),
        Err(TransportError::InvalidUtf8)
    ));

    let mut truncated = FrameDecoder::new(DEFAULT_MAXIMUM_FRAME_BYTES);
    assert!(
        truncated
            .push(b"Content-Length: 5\r\n\r\nabc")
            .is_ok_and(|messages| messages.is_empty())
    );
    assert!(matches!(
        truncated.finish(),
        Err(TransportError::TruncatedFrame)
    ));
}

#[test]
fn an_unknown_envelope_field_is_rejected() {
    let body = r#"{"protocolVersion":1,"messageKind":"event","messageType":"system.ready","eventId":"3c2b1a09-8f7e-4d6c-b5a4-938271605af0","sequence":1,"payload":{},"smuggled":true}"#;
    let frame = format!("Content-Length: {}\r\n\r\n{body}", body.len());
    let mut decoder = FrameDecoder::new(DEFAULT_MAXIMUM_FRAME_BYTES);

    assert!(matches!(
        decoder.push(frame.as_bytes()),
        Err(TransportError::InvalidJson(_))
    ));
}

#[test]
fn a_response_carrying_both_result_and_error_is_rejected() {
    let mut envelope = response(FIRST_REQUEST_ID);
    envelope.error = Some(json!({"code": "X"}));

    assert!(matches!(
        encode_frame(&envelope, DEFAULT_MAXIMUM_FRAME_BYTES),
        Err(TransportError::ProtocolViolation(_))
    ));
}

#[test]
fn an_unsupported_protocol_version_is_rejected() {
    let mut envelope = response(FIRST_REQUEST_ID);
    envelope.protocol_version = 2;

    assert!(matches!(
        encode_frame(&envelope, DEFAULT_MAXIMUM_FRAME_BYTES),
        Err(TransportError::UnsupportedProtocolVersion(2))
    ));
}

/// Fixtures whose only defect lives inside an `error` body.
///
/// The transport forwards message bodies opaquely, so these are rejected by the runtime
/// and by the frontend rather than here. They are named explicitly so a fixture that
/// should have been caught at the envelope layer cannot be excused by accident.
const BODY_LEVEL_INVALID_FIXTURES: [&str; 2] =
    ["error-code-lowercase.json", "error-causes-too-many.json"];

fn decode_fixture(path: &Path) -> Result<Result<usize, TransportError>, Box<dyn Error>> {
    let compact: Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    let body = serde_json::to_string(&compact)?;
    let frame = format!("Content-Length: {}\r\n\r\n{body}", body.len());
    let mut decoder = FrameDecoder::new(DEFAULT_MAXIMUM_FRAME_BYTES);
    Ok(decoder
        .push(frame.as_bytes())
        .map(|messages| messages.len()))
}

/// The desktop transport must agree with the runtime and the frontend on the same shared
/// fixtures, so an envelope one language accepts is not rejected by another.
#[test]
fn shared_contract_fixtures_are_decoded_consistently() -> Result<(), Box<dyn Error>> {
    let fixtures_root = repository_root().join("contracts/fixtures");

    for entry in fs::read_dir(fixtures_root.join("valid"))? {
        let path = entry?.path();
        assert_eq!(
            decode_fixture(&path)?.ok(),
            Some(1),
            "the transport rejected the shared valid fixture {}",
            path.display()
        );
    }

    for entry in fs::read_dir(fixtures_root.join("invalid"))? {
        let path = entry?.path();
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_owned();
        let accepted = decode_fixture(&path)?.is_ok();

        if BODY_LEVEL_INVALID_FIXTURES.contains(&file_name.as_str()) {
            assert!(
                accepted,
                "{file_name} is recorded as body-level but the envelope layer rejected it"
            );
        } else {
            assert!(
                !accepted,
                "the transport accepted the shared invalid fixture {file_name}"
            );
        }
    }

    Ok(())
}
