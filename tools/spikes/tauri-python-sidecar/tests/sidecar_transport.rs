#![cfg_attr(windows, allow(unsafe_code))]

use std::error::Error;
use std::path::PathBuf;
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use rino_sidecar_transport_spike::{MessageKind, SidecarConfig, SidecarSupervisor, TransportError};
use serde_json::{Value, json};
use uuid::{Uuid, Version};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);

fn python_executable() -> Result<PathBuf, Box<dyn Error>> {
    let output = Command::new("python")
        .args(["-I", "-c", "import sys; print(sys.executable)"])
        .output()?;
    if !output.status.success() {
        return Err("Python executable discovery failed".into());
    }
    let executable = String::from_utf8(output.stdout)?.trim().to_owned();
    if executable.is_empty() {
        return Err("Python executable discovery returned no path".into());
    }
    Ok(PathBuf::from(executable).canonicalize()?)
}

fn sidecar_script() -> Result<PathBuf, Box<dyn Error>> {
    Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("sidecar")
        .join("runtime_sidecar.py")
        .canonicalize()?)
}

fn spawn(mode: &str) -> Result<SidecarSupervisor, Box<dyn Error>> {
    let config = SidecarConfig::new(python_executable()?, sidecar_script()?).with_mode(mode);
    Ok(SidecarSupervisor::spawn(&config)?)
}

#[test]
fn correlates_handshake_and_streams_ready_event() -> Result<(), Box<dyn Error>> {
    let mut supervisor = spawn("normal")?;
    let response = supervisor.handshake(REQUEST_TIMEOUT)?;
    assert_eq!(response.message_kind, MessageKind::Response);
    assert_eq!(response.message_type, "system.handshake");
    let request_id = response.request_id.ok_or("response request ID missing")?;
    assert_eq!(
        Uuid::parse_str(&request_id)?.get_version(),
        Some(Version::Random)
    );
    assert_eq!(
        response.result,
        Some(json!({
            "accepted": true,
            "maximumFrameBytes": 65536,
            "pathEnvironmentPresent": false,
            "protocolVersion": 1,
            "pythonHomeEnvironmentPresent": false,
            "runtimeMode": "source",
            "runtimeVersion": "0.0.0-spike"
        }))
    );

    let ready = supervisor.next_event(REQUEST_TIMEOUT)?;
    assert_eq!(ready.message_kind, MessageKind::Event);
    assert_eq!(ready.message_type, "system.ready");
    assert_eq!(ready.sequence, Some(1));

    let echo = supervisor.request(
        "system.echo",
        json!({"value": "correlated"}),
        REQUEST_TIMEOUT,
    )?;
    assert_eq!(echo.message_type, "system.echo");
    assert!(echo.error.is_none());
    supervisor.shutdown(REQUEST_TIMEOUT)?;
    assert!(!supervisor.is_running()?);
    Ok(())
}

#[test]
fn accepts_fragmented_sidecar_output() -> Result<(), Box<dyn Error>> {
    let mut supervisor = spawn("fragmented")?;
    let response = supervisor.handshake(REQUEST_TIMEOUT)?;
    assert_eq!(response.message_type, "system.handshake");
    let ready = supervisor.next_event(REQUEST_TIMEOUT)?;
    assert_eq!(ready.message_type, "system.ready");
    supervisor.shutdown(REQUEST_TIMEOUT)?;
    Ok(())
}

#[test]
fn times_out_slow_start_and_cleans_up_process() -> Result<(), Box<dyn Error>> {
    let mut supervisor = spawn("slow-start")?;
    assert!(matches!(
        supervisor.handshake(Duration::from_millis(50)),
        Err(TransportError::RequestTimeout)
    ));
    supervisor.force_stop(REQUEST_TIMEOUT)?;
    assert!(!supervisor.is_running()?);
    Ok(())
}

#[test]
fn malformed_frame_invalidates_sidecar_generation() -> Result<(), Box<dyn Error>> {
    let mut supervisor = spawn("malformed")?;
    assert!(matches!(
        supervisor.handshake(REQUEST_TIMEOUT),
        Err(TransportError::MalformedHeader)
    ));
    supervisor.force_stop(REQUEST_TIMEOUT)?;
    assert!(!supervisor.is_running()?);
    Ok(())
}

#[test]
fn crash_fails_pending_request_and_leaves_no_live_process() -> Result<(), Box<dyn Error>> {
    let mut supervisor = spawn("normal")?;
    supervisor.handshake(REQUEST_TIMEOUT)?;
    let request_id = supervisor.send_request("test.crash", json!({}))?;
    assert!(matches!(
        supervisor.wait_for_response(&request_id, REQUEST_TIMEOUT),
        Err(TransportError::SidecarExited(Some(17) | None) | TransportError::OutputChannelClosed)
    ));
    supervisor.force_stop(REQUEST_TIMEOUT)?;
    assert!(!supervisor.is_running()?);
    Ok(())
}

#[test]
fn forced_stop_terminates_sidecar_process_tree() -> Result<(), Box<dyn Error>> {
    let mut supervisor = spawn("normal")?;
    supervisor.handshake(REQUEST_TIMEOUT)?;
    let ready = supervisor.next_event(REQUEST_TIMEOUT)?;
    assert_eq!(ready.message_type, "system.ready");
    supervisor.request("test.spawnChild", json!({}), REQUEST_TIMEOUT)?;
    let child_event = supervisor.next_event(REQUEST_TIMEOUT)?;
    let child_process_id = child_event
        .payload
        .as_ref()
        .and_then(|payload| payload.get("processId"))
        .and_then(Value::as_u64)
        .and_then(|process_id| u32::try_from(process_id).ok())
        .ok_or("child process ID missing")?;
    assert!(process_is_running(child_process_id));

    supervisor.force_stop(REQUEST_TIMEOUT)?;
    let deadline = Instant::now() + REQUEST_TIMEOUT;
    while process_is_running(child_process_id) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    assert!(!process_is_running(child_process_id));
    assert!(!supervisor.is_running()?);
    Ok(())
}

#[test]
fn tauri_boundary_has_one_fixed_sidecar_and_no_shell_permission() -> Result<(), Box<dyn Error>> {
    let manifest_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let config: Value = serde_json::from_slice(&std::fs::read(
        manifest_directory.join("tauri-boundary-fixture/tauri.conf.json"),
    )?)?;
    assert_eq!(
        config.pointer("/bundle/externalBin"),
        Some(&json!(["binaries/rino-runtime-sidecar"]))
    );
    assert_eq!(
        config.pointer("/bundle/resources"),
        Some(&json!(["binaries/rino-runtime-sidecar-support/"]))
    );
    assert_eq!(
        config.pointer("/app/security/capabilities"),
        Some(&json!(["main"]))
    );

    let capability: Value = serde_json::from_slice(&std::fs::read(
        manifest_directory.join("tauri-boundary-fixture/capabilities/main.json"),
    )?)?;
    let permissions = capability
        .get("permissions")
        .and_then(Value::as_array)
        .ok_or("capability permissions missing")?;
    assert!(!permissions.iter().any(|permission| {
        permission
            .as_str()
            .is_some_and(|identifier| identifier.starts_with("shell:"))
    }));
    Ok(())
}

#[cfg(windows)]
fn process_is_running(process_id: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if handle.is_null() {
        return false;
    }
    let mut exit_code = 0_u32;
    let query_succeeded = unsafe { GetExitCodeProcess(handle, &raw mut exit_code) } != 0;
    unsafe { CloseHandle(handle) };
    query_succeeded && exit_code == STILL_ACTIVE.cast_unsigned()
}

#[cfg(not(windows))]
fn process_is_running(_process_id: u32) -> bool {
    false
}
