mod app_directories;
pub mod commands;
mod device_preview;
mod preview;
pub mod project;
pub mod publishing;
pub mod sidecar;
mod startup;

use std::sync::mpsc::{Receiver, channel};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use app_directories::ApplicationDirectories;
use commands::{RuntimePreviewState, RuntimeSupervisorState};
use device_preview::DevicePreviewState;
use preview::PreviewCache;
use project::{ProjectWorkspace, ProjectWorkspaceState};
use sidecar::{
    ForwardedDiagnostic, ForwardedEvent, SidecarSupervisor,
    development_adb_executable_from_environment, resolve_launch,
};
pub use startup::{StartupError, report_startup_failure};
use tauri::{AppHandle, Emitter, Manager, RunEvent};

/// The event name the frontend subscribes to for runtime protocol events.
pub const RUNTIME_EVENT_NAME: &str = "rino://runtime-event";
/// The event name the frontend subscribes to for redacted runtime diagnostics.
pub const RUNTIME_DIAGNOSTIC_EVENT_NAME: &str = "rino://runtime-diagnostic";

/// Starts the desktop runtime.
///
/// Application directories and the runtime supervisor are initialized inside the setup
/// hook so managed state exists before the configured window and webview are created, and
/// so an initialization failure aborts startup without flashing a window.
///
/// # Errors
///
/// Returns a structured startup error when the desktop runtime, its private application
/// directories, or the runtime supervisor cannot be initialized.
pub fn run() -> Result<(), StartupError> {
    let setup_failure: Arc<OnceLock<StartupError>> = Arc::new(OnceLock::new());
    let reported_failure = Arc::clone(&setup_failure);

    let build_result = tauri::Builder::default()
        // The dialog plugin is initialized for its Rust interface only. No dialog
        // permission is granted to the webview, so the frontend reaches a native dialog
        // exclusively through the project commands below.
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::runtime_status,
            commands::runtime_start,
            commands::runtime_restart,
            commands::runtime_shutdown,
            commands::runtime_request,
            commands::runtime_preview_read,
            commands::runtime_capture_read,
            device_preview::device_preview_open,
            device_preview::device_preview_publish,
            device_preview::device_preview_current,
            device_preview::device_preview_close,
            device_preview::device_preview_focus,
            project::commands::project_choose_location,
            project::commands::project_open,
            project::commands::project_create,
            project::commands::project_save,
            project::commands::project_store_capture,
            project::commands::project_read_image_asset,
            project::commands::project_cleanup_orphan_assets,
            project::commands::project_cleanup_orphan_graphs,
            project::commands::project_save_as,
            project::commands::project_close,
            project::commands::project_write_autosave,
            project::commands::project_discard_recovery,
            publishing::commands::publishing_status,
            publishing::commands::publishing_login,
            publishing::commands::publishing_logout,
            publishing::commands::publishing_export,
            publishing::commands::publishing_publish,
        ])
        .setup(move |app| match initialize_application(app) {
            Ok(()) => Ok(()),
            Err(error) => {
                let _ignored = reported_failure.set(error);
                Err(Box::new(std::io::Error::other("application initialization failed")).into())
            }
        })
        .build(tauri::generate_context!());

    let app = match build_result {
        Ok(app) => app,
        Err(build_error) => {
            return Err(Arc::try_unwrap(setup_failure)
                .ok()
                .and_then(OnceLock::into_inner)
                .unwrap_or_else(|| StartupError::desktop_runtime(build_error)));
        }
    };

    app.run(|handle, event| {
        // The runtime holds a device and a process tree, so it is stopped before the event
        // loop tears down rather than being left to process cleanup.
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            device_preview::close_on_application_exit(handle);
            stop_runtime(handle);
        }
    });

    Ok(())
}

fn initialize_application(app: &tauri::App) -> Result<(), StartupError> {
    let directories = ApplicationDirectories::initialize(app.path())?;
    let preview_cache_root = directories.preview_cache_root();
    let maa_user_data_root = directories.maa_user_data_root();
    let publishing_cache_root = directories.publishing_cache_root();
    publishing::prepare_cache(&publishing_cache_root).map_err(|error| {
        StartupError::io(
            "PUBLISHING_CACHE_CLEANUP_FAILED",
            startup::StartupStage::CleanPublishingCache,
            error,
        )
    })?;
    let preview_cache = PreviewCache::initialize(preview_cache_root.clone())?;
    app.manage(RuntimePreviewState {
        cache: Mutex::new(preview_cache),
    });
    app.manage(DevicePreviewState::default());
    app.manage(ProjectWorkspaceState {
        workspace: Mutex::new(ProjectWorkspace::new(directories.recovery_root())),
    });
    app.manage(publishing::PublishingState::new(publishing_cache_root));
    app.manage(directories);

    let executable_directory = app
        .path()
        .resolve("", tauri::path::BaseDirectory::Resource)
        .map_err(|error| {
            StartupError::tauri(
                "RUNTIME_RESOURCE_PATH_UNAVAILABLE",
                startup::StartupStage::ResolveRuntimeExecutable,
                error,
            )
        })?;

    let (event_sender, event_receiver) = channel();
    let (diagnostic_sender, diagnostic_receiver) = channel();

    // A missing runtime executable is reported through the runtime status rather than
    // aborting startup, so the user still gets a window that can explain the failure.
    let development_adb_executable = development_adb_executable_from_environment();
    let supervisor = resolve_launch(
        &executable_directory,
        &preview_cache_root,
        &maa_user_data_root,
        development_adb_executable.as_deref(),
    )
    .ok()
    .map(|resolved| {
        SidecarSupervisor::new(
            resolved.launch,
            app.package_info().version.to_string(),
            event_sender,
            diagnostic_sender,
        )
    });

    if let Some(supervisor) = supervisor {
        app.manage(RuntimeSupervisorState {
            supervisor: Mutex::new(supervisor),
        });
        forward_runtime_messages(app.handle().clone(), event_receiver, diagnostic_receiver);
    }

    Ok(())
}

/// Forwards runtime events and diagnostics to the main window.
///
/// Messages are emitted to the one known window rather than broadcast, so a future window
/// cannot receive runtime state it was never granted.
fn forward_runtime_messages(
    handle: AppHandle,
    events: Receiver<ForwardedEvent>,
    diagnostics: Receiver<ForwardedDiagnostic>,
) {
    let event_handle = handle.clone();
    thread::spawn(move || {
        while let Ok(event) = events.recv() {
            let _ignored = event_handle.emit_to("main", RUNTIME_EVENT_NAME, event);
        }
    });
    thread::spawn(move || {
        while let Ok(diagnostic) = diagnostics.recv() {
            let _ignored = handle.emit_to("main", RUNTIME_DIAGNOSTIC_EVENT_NAME, diagnostic);
        }
    });
}

fn stop_runtime(handle: &AppHandle) {
    if let Some(state) = handle.try_state::<RuntimeSupervisorState>() {
        let mut supervisor = state
            .supervisor
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let _ignored = supervisor.shutdown();
    }
    if let Some(state) = handle.try_state::<RuntimePreviewState>() {
        state
            .cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }
}
