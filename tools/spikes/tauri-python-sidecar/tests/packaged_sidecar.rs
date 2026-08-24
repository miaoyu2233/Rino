use std::error::Error;
use std::path::PathBuf;
use std::time::Duration;

use rino_sidecar_transport_spike::{MessageKind, SidecarConfig, SidecarSupervisor};
use serde_json::json;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

#[test]
#[ignore = "requires the locally built frozen Sidecar artifact"]
fn packaged_sidecar_runs_without_system_python_environment() -> Result<(), Box<dyn Error>> {
    let executable = PathBuf::from(
        std::env::var_os("RINO_PACKAGED_SIDECAR")
            .ok_or("RINO_PACKAGED_SIDECAR must name the absolute frozen Sidecar executable")?,
    )
    .canonicalize()?;
    assert!(executable.is_absolute());
    assert_eq!(
        executable.file_name().and_then(|name| name.to_str()),
        Some("rino-runtime-sidecar-x86_64-pc-windows-msvc.exe")
    );
    assert!(
        executable
            .parent()
            .ok_or("packaged Sidecar parent directory is unavailable")?
            .join("rino-runtime-sidecar-support")
            .is_dir()
    );

    let mut supervisor = SidecarSupervisor::spawn(&SidecarConfig::standalone(executable))?;
    let handshake = supervisor.handshake(REQUEST_TIMEOUT)?;
    assert_eq!(handshake.message_kind, MessageKind::Response);
    assert_eq!(
        handshake.result,
        Some(json!({
            "accepted": true,
            "maximumFrameBytes": 65536,
            "pathEnvironmentPresent": false,
            "protocolVersion": 1,
            "pythonHomeEnvironmentPresent": false,
            "runtimeMode": "frozen",
            "runtimeVersion": "0.0.0-spike"
        }))
    );
    let ready = supervisor.next_event(REQUEST_TIMEOUT)?;
    assert_eq!(ready.message_type, "system.ready");
    let echo = supervisor.request("system.echo", json!({"value": "packaged"}), REQUEST_TIMEOUT)?;
    assert_eq!(echo.result, Some(json!({"echo": {"value": "packaged"}})));
    supervisor.shutdown(REQUEST_TIMEOUT)?;
    assert!(!supervisor.is_running()?);
    Ok(())
}
