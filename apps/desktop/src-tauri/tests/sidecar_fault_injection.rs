//! Fault-injection tests for the runtime transport boundary.
//!
//! Each case drives a real process that misbehaves in one specific way, because these are
//! the failures the supervisor exists to contain: a pending request must fail with a
//! meaningful classification rather than hanging, and no failure may leave the desktop
//! without a usable state.

//! Test assertions panic by design and report skips on standard error, so the workspace
//! lints that forbid those in production code are relaxed for this integration test.
#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::print_stderr,
    clippy::unwrap_used,
    reason = "an integration test reports failures by panicking and skips on stderr"
)]

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, channel};
use std::time::{Duration, Instant};

use rino_desktop_lib::sidecar::{
    ForwardedDiagnostic, ForwardedEvent, SidecarLaunch, SidecarSupervisor, SupervisorState,
};
use serde_json::json;

const DESKTOP_VERSION: &str = "0.1.0";

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}

fn workspace_interpreter() -> Option<PathBuf> {
    let interpreter = if cfg!(windows) {
        repository_root().join(".venv/Scripts/python.exe")
    } else {
        repository_root().join(".venv/bin/python")
    };
    interpreter.is_file().then_some(interpreter)
}

struct Harness {
    supervisor: SidecarSupervisor,
    events: Receiver<ForwardedEvent>,
    #[expect(
        dead_code,
        reason = "kept alive so forwarded diagnostics are not discarded"
    )]
    diagnostics: Receiver<ForwardedDiagnostic>,
}

/// Builds a supervisor whose runtime is a one-line Python program with a scripted fault.
fn harness_running(program: &str) -> Option<Harness> {
    let interpreter = workspace_interpreter()?;
    let arguments = vec![
        OsString::from("-I"),
        OsString::from("-c"),
        OsString::from(program),
    ];
    let launch = SidecarLaunch::new(interpreter, arguments).ok()?;
    let (event_sender, events) = channel();
    let (diagnostic_sender, diagnostics) = channel();
    Some(Harness {
        supervisor: SidecarSupervisor::new(
            launch,
            DESKTOP_VERSION.to_owned(),
            event_sender,
            diagnostic_sender,
        ),
        events,
        diagnostics,
    })
}

/// A runtime that answers the handshake correctly, then applies one scripted fault.
const HANDSHAKE_PRELUDE: &str = r"
import json, sys, uuid

def read_frame():
    header = b''
    while not header.endswith(b'\r\n\r\n'):
        byte = sys.stdin.buffer.read(1)
        if not byte:
            raise SystemExit(0)
        header += byte
    length = int(header[len(b'Content-Length: '):-4])
    return json.loads(sys.stdin.buffer.read(length).decode('utf-8'))

def write(message):
    body = json.dumps(message, separators=(',', ':')).encode('utf-8')
    sys.stdout.buffer.write(b'Content-Length: ' + str(len(body)).encode() + b'\r\n\r\n' + body)
    sys.stdout.buffer.flush()

def write_raw(data):
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()

handshake = read_frame()
write({
    'protocolVersion': 1,
    'messageKind': 'response',
    'messageType': 'system.handshake',
    'requestId': handshake['requestId'],
    'result': {
        'runtimeVersion': '0.1.0',
        'protocolVersion': 1,
        'maximumFrameBytes': 1048576,
        'runtimeMode': 'source',
        'maaRuntime': {'state': 'unavailable'},
        'featureFlags': ['runtime.graphExecution'],
    },
})
";

fn scripted_runtime(fault: &str) -> String {
    format!("{HANDSHAKE_PRELUDE}\n{fault}")
}

#[test]
fn a_duplicate_response_does_not_disturb_the_next_request() {
    let fault = r"
request = read_frame()
response = {
    'protocolVersion': 1,
    'messageKind': 'response',
    'messageType': request['messageType'],
    'requestId': request['requestId'],
    'result': {'state': 'ok', 'uptimeMilliseconds': 1},
}
write(response)
write(response)
request = read_frame()
write({
    'protocolVersion': 1,
    'messageKind': 'response',
    'messageType': request['messageType'],
    'requestId': request['requestId'],
    'result': {'state': 'ok', 'uptimeMilliseconds': 2},
})
";
    let Some(mut harness) = harness_running(&scripted_runtime(fault)) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the scripted runtime should complete its handshake");

    let first = harness
        .supervisor
        .request("system.health", json!({}), Duration::from_secs(5))
        .expect("the first request should answer");
    let second = harness
        .supervisor
        .request("system.health", json!({}), Duration::from_secs(5))
        .expect("the second request should answer despite the duplicate");

    assert_eq!(first.get("uptimeMilliseconds"), Some(&json!(1)));
    assert_eq!(second.get("uptimeMilliseconds"), Some(&json!(2)));
}

#[test]
fn a_response_for_an_unknown_request_is_ignored() {
    let fault = r"
request = read_frame()
write({
    'protocolVersion': 1,
    'messageKind': 'response',
    'messageType': 'system.health',
    'requestId': '11111111-2222-4333-8444-555555555555',
    'result': {'state': 'ok', 'uptimeMilliseconds': 7},
})
write({
    'protocolVersion': 1,
    'messageKind': 'response',
    'messageType': request['messageType'],
    'requestId': request['requestId'],
    'result': {'state': 'ok', 'uptimeMilliseconds': 8},
})
";
    let Some(mut harness) = harness_running(&scripted_runtime(fault)) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the handshake should pass");

    let result = harness
        .supervisor
        .request("system.health", json!({}), Duration::from_secs(5))
        .expect("the correlated response should still arrive");

    assert_eq!(result.get("uptimeMilliseconds"), Some(&json!(8)));
}

#[test]
fn an_oversized_frame_fails_the_pending_request_instead_of_hanging() {
    let fault = r"
read_frame()
write_raw(b'Content-Length: 99999999\r\n\r\n')
import time; time.sleep(30)
";
    let Some(mut harness) = harness_running(&scripted_runtime(fault)) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the handshake should pass");

    let started = Instant::now();
    let failure = harness
        .supervisor
        .request("system.health", json!({}), Duration::from_secs(20))
        .expect_err("an oversized frame must fail the request");

    assert_eq!(failure.code, "TRANSPORT_FAILURE");
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "the request must fail on the framing error, not wait for its timeout"
    );
}

#[test]
fn a_malformed_frame_mid_session_fails_the_pending_request() {
    let fault = r"
read_frame()
write_raw(b'Content-Length: not-a-number\r\n\r\n')
import time; time.sleep(30)
";
    let Some(mut harness) = harness_running(&scripted_runtime(fault)) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the handshake should pass");

    let failure = harness
        .supervisor
        .request("system.health", json!({}), Duration::from_secs(20))
        .expect_err("a malformed frame must fail the request");

    assert_eq!(failure.code, "TRANSPORT_FAILURE");
}

#[test]
fn a_crash_with_a_pending_request_reports_the_runtime_as_unavailable() {
    let fault = r"
read_frame()
import os; os._exit(17)
";
    let Some(mut harness) = harness_running(&scripted_runtime(fault)) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the handshake should pass");

    let failure = harness
        .supervisor
        .request("system.health", json!({}), Duration::from_secs(20))
        .expect_err("a crash must fail the pending request");

    assert_eq!(failure.code, "SIDECAR_UNAVAILABLE");
    assert_eq!(harness.supervisor.state(), SupervisorState::Degraded);
}

#[test]
fn an_unexpected_request_from_the_runtime_is_a_protocol_violation() {
    let fault = r"
read_frame()
write({
    'protocolVersion': 1,
    'messageKind': 'request',
    'messageType': 'system.health',
    'requestId': '11111111-2222-4333-8444-555555555555',
    'payload': {},
})
import time; time.sleep(30)
";
    let Some(mut harness) = harness_running(&scripted_runtime(fault)) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the handshake should pass");

    let failure = harness
        .supervisor
        .request("system.health", json!({}), Duration::from_secs(20))
        .expect_err("a runtime-issued request must fail the pending request");

    assert_eq!(failure.code, "TRANSPORT_FAILURE");
}

#[test]
fn a_slow_runtime_still_completes_within_the_startup_timeout() {
    let fault = "import time; time.sleep(30)";
    let slow_prelude = format!("import time\ntime.sleep(1.5)\n{HANDSHAKE_PRELUDE}\n{fault}");
    let Some(mut harness) = harness_running(&slow_prelude) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };

    let status = harness
        .supervisor
        .start()
        .expect("a slow but responsive runtime should still start");

    assert_eq!(status.state, SupervisorState::Ready);
}

#[test]
fn a_stale_event_from_a_previous_generation_is_not_forwarded() {
    let fault = r"
write({
    'protocolVersion': 1,
    'messageKind': 'event',
    'messageType': 'system.ready',
    'eventId': '3c2b1a09-8f7e-4d6c-b5a4-938271605af0',
    'sequence': 5,
    'payload': {'state': 'ready'},
})
write({
    'protocolVersion': 1,
    'messageKind': 'event',
    'messageType': 'system.healthChanged',
    'eventId': 'aa11bb22-cc33-4d44-8e55-ff6677889900',
    'sequence': 3,
    'payload': {'state': 'degraded'},
})
import time; time.sleep(30)
";
    let Some(mut harness) = harness_running(&scripted_runtime(fault)) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the handshake should pass");

    let first = harness
        .events
        .recv_timeout(Duration::from_secs(5))
        .expect("the first event should be forwarded");
    assert_eq!(first.sequence, 5);

    // The second event repeats an earlier sequence, so it is dropped rather than
    // rewriting the runtime history the interface already applied.
    assert!(harness.events.recv_timeout(Duration::from_secs(1)).is_err());
}
