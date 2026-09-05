use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::{
    commands::CommandError,
    device_preview::MAIN_WINDOW_LABEL,
    sidecar::{ProtocolError, Retryability},
};

pub(crate) const SPLASHSCREEN_WINDOW_LABEL: &str = "splashscreen";
pub(crate) const STARTUP_STAGE_EVENT_NAME: &str = "rino://startup-stage";

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StartupStage {
    Initializing,
    Runtime,
    Registry,
    Workspace,
    Opening,
}

/// The maximum amount of time the desktop shell waits for background cleanup before it
/// requests process exit. Cleanup is best effort once this deadline has elapsed.
pub(crate) const SHUTDOWN_DEADLINE: std::time::Duration = std::time::Duration::from_secs(12);

/// Reveals the prepared main window and removes the native splash window.
///
/// The caller's native label is checked before any window is changed. Destroying the
/// splash avoids sending another close request through the application shutdown path, and
/// repeating this command is safe once the splash has already been destroyed.
#[tauri::command]
pub fn complete_startup(window: WebviewWindow, app: AppHandle) -> Result<(), CommandError> {
    ensure_main_window(&window)?;

    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| lifecycle_error("STARTUP_MAIN_WINDOW_UNAVAILABLE"))?;
    main.show()
        .map_err(|_| lifecycle_error("STARTUP_MAIN_WINDOW_UNAVAILABLE"))?;

    if let Some(splash) = app.get_webview_window(SPLASHSCREEN_WINDOW_LABEL) {
        splash
            .destroy()
            .map_err(|_| lifecycle_error("STARTUP_SPLASH_WINDOW_UNAVAILABLE"))?;
    }

    Ok(())
}

/// Sends one allowlisted startup stage to the native splash window.
#[tauri::command]
pub fn update_startup_stage(
    window: WebviewWindow,
    app: AppHandle,
    stage: StartupStage,
) -> Result<(), CommandError> {
    ensure_main_window(&window)?;
    app.emit_to(SPLASHSCREEN_WINDOW_LABEL, STARTUP_STAGE_EVENT_NAME, stage)
        .map_err(|_| lifecycle_error("STARTUP_SPLASH_WINDOW_UNAVAILABLE"))?;
    Ok(())
}

fn ensure_main_window(window: &WebviewWindow) -> Result<(), CommandError> {
    (window.label() == MAIN_WINDOW_LABEL)
        .then_some(())
        .ok_or_else(|| lifecycle_error("STARTUP_UNAUTHORIZED_WINDOW"))
}

fn lifecycle_error(code: &'static str) -> CommandError {
    CommandError {
        error: Box::new(ProtocolError::new(
            code,
            "runtime.error.desktopCommandFailed",
            "The current window is not allowed to complete desktop startup.".to_owned(),
            Retryability::Safe,
        )),
    }
}

/// Coordinates the one application-wide shutdown request.
///
/// Window close events and OS exit requests can arrive more than once while cleanup is in
/// progress. The two flags keep those events idempotent without holding a lock on the event
/// loop thread.
#[derive(Debug, Default)]
pub(crate) struct ShutdownCoordinator {
    started: AtomicBool,
    exit_requested: AtomicBool,
}

impl ShutdownCoordinator {
    /// Marks cleanup as started and returns whether this caller owns the cleanup job.
    pub(crate) fn begin(&self) -> bool {
        self.started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    /// Marks process exit as requested and returns whether the caller should request it.
    pub(crate) fn request_exit(&self) -> bool {
        self.exit_requested
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    #[cfg(test)]
    pub(crate) fn has_started(&self) -> bool {
        self.started.load(Ordering::Acquire)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::sync_channel;
    use std::time::Duration;

    use super::{SHUTDOWN_DEADLINE, ShutdownCoordinator, StartupStage};

    #[test]
    fn startup_stages_serialize_to_the_fixed_wire_values() {
        for (stage, expected) in [
            (StartupStage::Initializing, "\"initializing\""),
            (StartupStage::Runtime, "\"runtime\""),
            (StartupStage::Registry, "\"registry\""),
            (StartupStage::Workspace, "\"workspace\""),
            (StartupStage::Opening, "\"opening\""),
        ] {
            assert!(matches!(
                serde_json::to_string(&stage),
                Ok(value) if value == expected
            ));
        }
    }

    #[test]
    fn shutdown_is_owned_by_one_caller_and_exit_is_idempotent() {
        let coordinator = ShutdownCoordinator::default();

        assert!(coordinator.begin());
        assert!(coordinator.has_started());
        assert!(!coordinator.begin());
        assert!(coordinator.request_exit());
        assert!(!coordinator.request_exit());
    }

    #[test]
    fn shutdown_deadline_is_bounded() {
        assert_eq!(SHUTDOWN_DEADLINE, Duration::from_secs(12));

        let (_sender, receiver) = sync_channel::<()>(1);
        assert!(receiver.recv_timeout(Duration::from_millis(1)).is_err());
    }
}
