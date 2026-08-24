//! The project commands the frontend may invoke.
//!
//! No command accepts a path. The user chooses a directory or a manifest through a native
//! dialog, Rust keeps that location, and later commands name only files inside the format
//! the project directory defines.
#![allow(
    clippy::needless_pass_by_value,
    reason = "command handlers receive managed state by value as the framework requires"
)]

use std::{
    path::PathBuf,
    sync::{Mutex, MutexGuard, PoisonError},
};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::commands::{RuntimePreviewState, RuntimeSupervisorState};
use crate::preview::CaptureSourceKind;
use crate::sidecar::REQUEST_TIMEOUT;

use super::{
    error::{ProjectError, ProjectErrorCode},
    layout::PROJECT_MANIFEST_FILE_NAME,
    workspace::{
        ImageCaptureSourceKind, OpenedProject, ProjectFileSet, ProjectLocation, ProjectWorkspace,
        StoredImageObject,
    },
};

/// The longest dialog caption the frontend may supply.
///
/// Dialog captions are localized text and therefore arrive from the frontend, so they are
/// bounded here rather than trusted.
const MAXIMUM_CAPTION_LENGTH: usize = 120;

pub struct ProjectWorkspaceState {
    pub workspace: Mutex<ProjectWorkspace>,
}

/// The localized captions one native dialog needs.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DialogCaptions {
    pub title: String,
    /// The file-type label shown beside the manifest filter. Absent for a folder dialog.
    pub file_type_label: Option<String>,
}

impl DialogCaptions {
    fn title(&self) -> &str {
        truncate_caption(&self.title)
    }
}

fn truncate_caption(caption: &str) -> &str {
    match caption.char_indices().nth(MAXIMUM_CAPTION_LENGTH) {
        Some((index, _)) => &caption[..index],
        None => caption,
    }
}

fn locked<'state>(
    state: &'state State<'_, ProjectWorkspaceState>,
) -> MutexGuard<'state, ProjectWorkspace> {
    state
        .workspace
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

/// Presents a native dialog on the platform's own thread and awaits the user's answer.
///
/// The dialog is driven by a callback, so the result travels back through a one-message
/// channel rather than by blocking the command's thread.
async fn await_selection<F>(present: F) -> Result<Option<PathBuf>, Box<ProjectError>>
where
    F: FnOnce(tauri::async_runtime::Sender<Option<PathBuf>>),
{
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    present(sender);
    receiver
        .recv()
        .await
        .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::DialogUnavailable, "selection"))
}

/// Asks the user for an empty directory to hold a new project.
///
/// # Errors
///
/// Returns a structured error when the chosen directory is unreadable, already holds a
/// project, or holds unrelated files.
#[tauri::command]
pub async fn project_choose_location(
    app: AppHandle,
    state: State<'_, ProjectWorkspaceState>,
    captions: DialogCaptions,
) -> Result<Option<ProjectLocation>, Box<ProjectError>> {
    let title = captions.title().to_owned();
    let selected = await_selection(move |sender| {
        app.dialog()
            .file()
            .set_title(&title)
            .pick_folder(move |picked| {
                let _ignored = sender.blocking_send(picked.and_then(|path| path.into_path().ok()));
            });
    })
    .await?;

    let Some(directory) = selected else {
        return Ok(None);
    };
    locked(&state).choose_location(&directory).map(Some)
}

/// Asks the user for a project manifest and opens the project that owns it.
///
/// # Errors
///
/// Returns a structured error when the selection is not a project manifest or the project
/// directory cannot be read.
#[tauri::command]
pub async fn project_open(
    app: AppHandle,
    state: State<'_, ProjectWorkspaceState>,
    captions: DialogCaptions,
) -> Result<Option<OpenedProject>, Box<ProjectError>> {
    let title = captions.title().to_owned();
    let file_type_label = captions.file_type_label.as_deref().map_or_else(
        || PROJECT_MANIFEST_FILE_NAME.to_owned(),
        |label| truncate_caption(label).to_owned(),
    );
    let selected = await_selection(move |sender| {
        app.dialog()
            .file()
            .set_title(&title)
            .add_filter(&file_type_label, &["rino.json"])
            .pick_file(move |picked| {
                let _ignored = sender.blocking_send(picked.and_then(|path| path.into_path().ok()));
            });
    })
    .await?;

    let Some(manifest_path) = selected else {
        return Ok(None);
    };
    locked(&state).open(&manifest_path).map(Some)
}

/// Writes the first files of a new project into the directory the user chose.
///
/// # Errors
///
/// Returns a structured error when no location was chosen or the files cannot be written.
#[tauri::command]
pub fn project_create(
    state: State<'_, ProjectWorkspaceState>,
    files: ProjectFileSet,
) -> Result<ProjectLocation, Box<ProjectError>> {
    locked(&state).create(&files)
}

/// Rewrites the open project in place.
///
/// # Errors
///
/// Returns a structured error when no project is open or a file cannot be committed.
#[tauri::command]
pub fn project_save(
    state: State<'_, ProjectWorkspaceState>,
    files: ProjectFileSet,
) -> Result<ProjectLocation, Box<ProjectError>> {
    locked(&state).save(&files)
}

/// Commits one runtime-owned capture into the open project's immutable image objects.
///
/// The token is released only after the object has committed. A failed write therefore
/// leaves the short-lived capture available for an explicit retry.
///
/// # Errors
///
/// Returns a structured error when the token is unavailable, no project is open, the
/// image metadata is inconsistent, or the object cannot be committed.
#[tauri::command]
pub fn project_store_capture(
    state: State<'_, ProjectWorkspaceState>,
    runtime_state: State<'_, RuntimeSupervisorState>,
    preview_state: State<'_, RuntimePreviewState>,
    capture_token: String,
) -> Result<StoredImageObject, Box<ProjectError>> {
    let generation = runtime_state
        .supervisor
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .generation();
    let capture = preview_state
        .cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .read_capture(&capture_token, generation)
        .map_err(|_| ProjectError::boxed(ProjectErrorCode::CaptureUnavailable, "captureToken"))?;
    let source_kind = match capture.source_kind {
        CaptureSourceKind::DeviceCapture => ImageCaptureSourceKind::DeviceCapture,
        CaptureSourceKind::RegionCapture => ImageCaptureSourceKind::RegionCapture,
    };
    let stored = locked(&state).store_capture(
        &capture.bytes,
        capture.width,
        capture.height,
        &capture.coordinate_space_id,
        source_kind,
    )?;

    preview_state
        .cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .release_capture(&capture_token);
    let mut supervisor = runtime_state
        .supervisor
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if supervisor.generation() == generation {
        let _ignored = supervisor.request(
            "capture.release",
            serde_json::json!({ "captureToken": capture_token }),
            REQUEST_TIMEOUT,
        );
    }
    drop(supervisor);
    Ok(stored)
}

/// Reads one verified image object from the currently open project.
///
/// The command accepts only a content hash and declared byte length. The workspace keeps
/// the project root private, reconstructs the fixed object path, and verifies both length
/// and hash before returning bytes to the webview.
///
/// # Errors
///
/// Returns a structured error when no project is open or the requested image fails its
/// path, size, or integrity checks.
#[tauri::command]
pub fn project_read_image_asset(
    state: State<'_, ProjectWorkspaceState>,
    content_hash: String,
    expected_byte_length: u64,
) -> Result<tauri::ipc::Response, Box<ProjectError>> {
    let bytes = locked(&state).read_image_object(&content_hash, expected_byte_length)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Removes content-addressed images not referenced by the committed manifest.
///
/// # Errors
///
/// Returns a structured error when no project is open, the manifest is not safe to use as
/// cleanup authority, or a file cannot be removed.
#[tauri::command]
pub fn project_cleanup_orphan_assets(
    state: State<'_, ProjectWorkspaceState>,
) -> Result<usize, Box<ProjectError>> {
    locked(&state).cleanup_orphan_assets()
}

/// Removes graph files absent from the committed manifest.
///
/// # Errors
///
/// Returns a structured error when no project is open, the manifest is not safe to use as
/// cleanup authority, or a file cannot be removed.
#[tauri::command]
pub fn project_cleanup_orphan_graphs(
    state: State<'_, ProjectWorkspaceState>,
) -> Result<usize, Box<ProjectError>> {
    locked(&state).cleanup_orphan_graphs()
}

/// Writes the open project into the directory the user chose and follows it there.
///
/// # Errors
///
/// Returns a structured error when no location was chosen or a file cannot be committed.
#[tauri::command]
pub fn project_save_as(
    state: State<'_, ProjectWorkspaceState>,
    files: ProjectFileSet,
) -> Result<ProjectLocation, Box<ProjectError>> {
    locked(&state).save_as(&files)
}

/// Forgets the open project and clears its recovery slot.
#[tauri::command]
pub fn project_close(state: State<'_, ProjectWorkspaceState>) {
    locked(&state).close();
}

/// Writes unsaved work to the application-owned recovery slot.
///
/// # Errors
///
/// Returns a structured error when no project is open or the slot cannot be written.
#[tauri::command]
pub fn project_write_autosave(
    state: State<'_, ProjectWorkspaceState>,
    files: ProjectFileSet,
) -> Result<(), Box<ProjectError>> {
    locked(&state).write_autosave(&files)
}

/// Removes the recovery slot after the user accepted or refused the recovered work.
#[tauri::command]
pub fn project_discard_recovery(state: State<'_, ProjectWorkspaceState>) {
    locked(&state).discard_recovery();
}
