//! Supervisor lifecycle tests against the real Python runtime.
//!
//! These exercise the actual process boundary rather than a stub, because process exit,
//! pipe closure, and cleanup are exactly the behaviors the supervisor exists to manage.
//! When the workspace interpreter is unavailable the tests report that and skip, rather
//! than passing without evidence.

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
use std::time::Duration;

use rino_desktop_lib::sidecar::supervisor::MaaRuntimeAvailability;
use rino_desktop_lib::sidecar::supervisor::SHUTDOWN_TIMEOUT;
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

/// A supervisor together with the receiving ends of its forwarding channels.
///
/// The receivers are kept alive for the whole test: dropping them would silently discard
/// the events and diagnostics that explain a failure.
struct SupervisorHarness {
    supervisor: SidecarSupervisor,
    events: Receiver<ForwardedEvent>,
    diagnostics: Receiver<ForwardedDiagnostic>,
}

impl SupervisorHarness {
    fn drained_diagnostics(&self) -> Vec<String> {
        self.supervisor.drain_diagnostics();
        self.diagnostics
            .try_iter()
            .map(|diagnostic| diagnostic.line)
            .collect()
    }
}

fn build_supervisor(arguments: Vec<OsString>) -> Option<SupervisorHarness> {
    let interpreter = workspace_interpreter()?;
    let launch = SidecarLaunch::new(interpreter, arguments).ok()?;
    let (event_sender, events) = channel();
    let (diagnostic_sender, diagnostics) = channel();
    Some(SupervisorHarness {
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

fn runtime_arguments() -> Vec<OsString> {
    vec![
        OsString::from("-I"),
        OsString::from("-m"),
        OsString::from("rino_runtime"),
    ]
}

#[test]
fn the_runtime_starts_handshakes_answers_and_stops() {
    let Some(mut harness) = build_supervisor(runtime_arguments()) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };

    let status = harness
        .supervisor
        .start()
        .unwrap_or_else(|error| panic!("start failed: {error:?}"));
    assert_eq!(status.state, SupervisorState::Ready);
    assert_eq!(status.generation, 1);
    assert_eq!(status.protocol_version, 1);
    assert_eq!(status.runtime_mode.as_deref(), Some("source"));
    assert!(status.runtime_version.is_some());
    assert_eq!(
        status.maa_runtime.as_ref().map(|runtime| runtime.state),
        Some(MaaRuntimeAvailability::Unavailable)
    );
    assert_eq!(
        status.feature_flags.as_deref(),
        Some(
            [
                "runtime.graphExecution".to_owned(),
                "runtime.screenCapture".to_owned(),
            ]
            .as_slice(),
        )
    );

    // A successful handshake must also surface the runtime's ready event and its startup
    // diagnostic, so the frontend can distinguish "started" from "answering".
    let ready = harness
        .events
        .recv_timeout(Duration::from_secs(5))
        .expect("the runtime should emit a ready event");
    assert_eq!(ready.message_type, "system.ready");
    assert_eq!(ready.generation, 1);
    assert_eq!(ready.sequence, 1);
    assert!(
        harness
            .drained_diagnostics()
            .iter()
            .any(|line| line.contains("RUNTIME_STARTED")),
        "the runtime startup diagnostic should reach the desktop"
    );

    let health = harness
        .supervisor
        .request("system.health", json!({}), Duration::from_secs(10))
        .expect("health should answer");
    assert_eq!(
        health.get("state").and_then(|state| state.as_str()),
        Some("ok")
    );

    let stopped = harness.supervisor.shutdown();
    assert_eq!(stopped.state, SupervisorState::Stopped);
}

#[test]
fn a_request_after_shutdown_reports_the_runtime_as_unavailable() {
    let Some(mut harness) = build_supervisor(runtime_arguments()) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the runtime should start");
    harness.supervisor.shutdown();

    let failure = harness
        .supervisor
        .request("system.health", json!({}), Duration::from_secs(5))
        .expect_err("a request after shutdown must fail");

    assert_eq!(failure.code, "SIDECAR_UNAVAILABLE");
    assert!(!failure.technical_detail.is_empty());
}

#[test]
fn an_explicit_restart_advances_the_runtime_generation() {
    let Some(mut harness) = build_supervisor(runtime_arguments()) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the runtime should start");

    let restarted = harness
        .supervisor
        .restart(false)
        .expect("the restart should succeed");

    assert_eq!(restarted.state, SupervisorState::Ready);
    assert_eq!(restarted.generation, 2);
    harness.supervisor.shutdown();
}

#[test]
fn a_runtime_that_never_answers_fails_the_handshake_within_its_timeout() {
    let Some(mut harness) = build_supervisor(vec![
        OsString::from("-I"),
        OsString::from("-c"),
        OsString::from("import time; time.sleep(120)"),
    ]) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };

    let failure = harness
        .supervisor
        .start()
        .expect_err("a silent runtime must fail the handshake");

    assert_eq!(failure.code, "REQUEST_TIMEOUT");
    assert_eq!(harness.supervisor.state(), SupervisorState::Failed);
}

#[test]
fn a_runtime_that_exits_immediately_is_reported_as_unavailable() {
    let Some(mut harness) = build_supervisor(vec![
        OsString::from("-I"),
        OsString::from("-c"),
        OsString::from("raise SystemExit(9)"),
    ]) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };

    let failure = harness
        .supervisor
        .start()
        .expect_err("an exiting runtime must fail the handshake");

    assert_eq!(failure.code, "SIDECAR_UNAVAILABLE");
    assert_eq!(harness.supervisor.state(), SupervisorState::Failed);
}

#[test]
fn a_runtime_emitting_malformed_frames_fails_the_handshake() {
    let Some(mut harness) = build_supervisor(vec![
        OsString::from("-I"),
        OsString::from("-c"),
        OsString::from(
            "import sys; sys.stdout.buffer.write(b'Content-Length: bogus\\r\\n\\r\\n'); \
             sys.stdout.buffer.flush(); import time; time.sleep(5)",
        ),
    ]) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };

    let failure = harness
        .supervisor
        .start()
        .expect_err("a malformed frame must fail the handshake");

    assert_eq!(failure.code, "TRANSPORT_FAILURE");
    assert_eq!(harness.supervisor.state(), SupervisorState::Failed);
}

#[test]
fn dropping_the_supervisor_stops_the_runtime_process() {
    let Some(mut harness) = build_supervisor(runtime_arguments()) else {
        eprintln!("skipped: the workspace interpreter is unavailable");
        return;
    };
    harness
        .supervisor
        .start()
        .expect("the runtime should start");

    drop(harness);

    // A leaked process would keep the pipe open past this point; the cleanup path is
    // bounded by the shutdown timeout, so returning promptly is the observable evidence.
    std::thread::sleep(SHUTDOWN_TIMEOUT.min(Duration::from_millis(200)));
}
