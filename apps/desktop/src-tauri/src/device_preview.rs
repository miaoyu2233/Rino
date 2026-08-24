use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::{
    commands::CommandError,
    sidecar::{ProtocolError, Retryability},
};

pub const DEVICE_PREVIEW_WINDOW_LABEL: &str = "device-preview";
pub const MAIN_WINDOW_LABEL: &str = "main";
pub const DEVICE_PREVIEW_EVENT_NAME: &str = "rino://device-preview-snapshot";

const DEVICE_PREVIEW_URL: &str = "index.html?window=device-preview";
const DEFAULT_PREVIEW_WIDTH: f64 = 960.0;
const DEFAULT_PREVIEW_HEIGHT: f64 = 720.0;
const MINIMUM_PREVIEW_WIDTH: f64 = 640.0;
const MINIMUM_PREVIEW_HEIGHT: f64 = 480.0;
const MAXIMUM_PREVIEW_DIMENSION: u32 = 16_384;
const ARTIFACT_TOKEN_LENGTH: usize = 32;

/// The small, non-sensitive state published to the native preview window.
///
/// This deliberately contains no image bytes, local paths, device identifiers, or
/// diagnostic details. The child reads image data only through the existing opaque-token
/// preview command.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePreviewSnapshot {
    pub generation: u64,
    pub phase: DevicePreviewPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    pub interaction_available: bool,
}

impl DevicePreviewSnapshot {
    pub(crate) fn validate(&self) -> Result<(), CommandError> {
        if self
            .preview_token
            .as_deref()
            .is_some_and(|token| !is_artifact_token(token))
        {
            return Err(invalid_snapshot("The preview token is invalid."));
        }

        match (self.width, self.height) {
            (Some(width), Some(height))
                if (1..=MAXIMUM_PREVIEW_DIMENSION).contains(&width)
                    && (1..=MAXIMUM_PREVIEW_DIMENSION).contains(&height) => {}
            (None, None) => {}
            _ => return Err(invalid_snapshot("The preview dimensions are invalid.")),
        }

        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DevicePreviewPhase {
    Unavailable,
    LoadingDevices,
    Disconnected,
    Connecting,
    Ready,
    Capturing,
    Error,
}

/// Native state for the one optional device preview child window.
///
/// The snapshot is retained after the window is closed so reopening it can immediately
/// request the current image token. Closing the child never releases the token or touches
/// the runtime/device lifecycle.
#[derive(Clone, Default)]
pub struct DevicePreviewState {
    snapshot: Arc<Mutex<Option<DevicePreviewSnapshot>>>,
    visible: Arc<AtomicBool>,
}

impl DevicePreviewState {
    pub(crate) fn publish(&self, snapshot: DevicePreviewSnapshot) {
        *self
            .snapshot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(snapshot);
    }

    pub(crate) fn current(&self) -> Option<DevicePreviewSnapshot> {
        self.snapshot
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub(crate) fn mark_visible(&self) {
        self.visible.store(true, Ordering::Release);
    }

    pub(crate) fn mark_closed(&self) {
        self.visible.store(false, Ordering::Release);
    }

    #[cfg(test)]
    fn is_visible(&self) -> bool {
        self.visible.load(Ordering::Acquire)
    }
}

/// Opens the single native preview window from the main window.
///
/// Existing windows are shown and focused instead of creating a second session. The
/// query parameter selects the child-window route while keeping the same local bundle.
#[tauri::command]
pub fn device_preview_open(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DevicePreviewState>,
) -> Result<(), CommandError> {
    ensure_main_window(&window)?;

    if let Some(existing) = app.get_webview_window(DEVICE_PREVIEW_WINDOW_LABEL) {
        existing
            .show()
            .map_err(|_| window_error("The preview window could not be shown."))?;
        existing
            .set_focus()
            .map_err(|_| window_error("The preview window could not be focused."))?;
        state.mark_visible();
        return Ok(());
    }

    let child = WebviewWindowBuilder::new(
        &app,
        DEVICE_PREVIEW_WINDOW_LABEL,
        WebviewUrl::App(DEVICE_PREVIEW_URL.into()),
    )
    .title("Rino")
    .inner_size(DEFAULT_PREVIEW_WIDTH, DEFAULT_PREVIEW_HEIGHT)
    .min_inner_size(MINIMUM_PREVIEW_WIDTH, MINIMUM_PREVIEW_HEIGHT)
    .resizable(true)
    .decorations(true)
    .center()
    .visible(true)
    .build()
    .map_err(|_| window_error("The preview window could not be created."))?;

    let child_state = state.inner().clone();
    child.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            child_state.mark_closed();
        }
    });
    state.mark_visible();
    Ok(())
}

/// Publishes a restricted preview snapshot from the main window to the fixed child label.
#[tauri::command]
pub fn device_preview_publish(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DevicePreviewState>,
    snapshot: DevicePreviewSnapshot,
) -> Result<(), CommandError> {
    ensure_main_window(&window)?;
    snapshot.validate()?;
    state.publish(snapshot.clone());
    let _ignored = app.emit_to(
        DEVICE_PREVIEW_WINDOW_LABEL,
        DEVICE_PREVIEW_EVENT_NAME,
        snapshot,
    );
    Ok(())
}

/// Returns the latest restricted snapshot to the preview child only.
#[tauri::command]
pub fn device_preview_current(
    window: WebviewWindow,
    state: State<'_, DevicePreviewState>,
) -> Result<Option<DevicePreviewSnapshot>, CommandError> {
    ensure_preview_window(&window)?;
    Ok(state.current())
}

/// Closes the child window. Repeating the command is intentionally a no-op.
#[tauri::command]
pub fn device_preview_close(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DevicePreviewState>,
) -> Result<(), CommandError> {
    ensure_main_or_preview_window(&window)?;
    state.mark_closed();
    if let Some(child) = app.get_webview_window(DEVICE_PREVIEW_WINDOW_LABEL) {
        child
            .close()
            .map_err(|_| window_error("The preview window could not be closed."))?;
    }
    Ok(())
}

/// Focuses the child window. Repeating the command or focusing a closed window is a no-op.
#[tauri::command]
pub fn device_preview_focus(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DevicePreviewState>,
) -> Result<(), CommandError> {
    ensure_main_window(&window)?;
    if let Some(child) = app.get_webview_window(DEVICE_PREVIEW_WINDOW_LABEL) {
        child
            .show()
            .map_err(|_| window_error("The preview window could not be shown."))?;
        child
            .set_focus()
            .map_err(|_| window_error("The preview window could not be focused."))?;
        state.mark_visible();
    }
    Ok(())
}

/// Closes the optional child during normal application shutdown.
pub(crate) fn close_on_application_exit(app: &AppHandle) {
    if let Some(state) = app.try_state::<DevicePreviewState>() {
        state.mark_closed();
    }
    if let Some(child) = app.get_webview_window(DEVICE_PREVIEW_WINDOW_LABEL) {
        let _ignored = child.close();
    }
}

pub(crate) fn is_allowed_preview_reader_label(label: &str) -> bool {
    matches!(label, MAIN_WINDOW_LABEL | DEVICE_PREVIEW_WINDOW_LABEL)
}

fn ensure_main_window(window: &WebviewWindow) -> Result<(), CommandError> {
    (window.label() == MAIN_WINDOW_LABEL)
        .then_some(())
        .ok_or_else(unauthorized_window)
}

fn ensure_preview_window(window: &WebviewWindow) -> Result<(), CommandError> {
    (window.label() == DEVICE_PREVIEW_WINDOW_LABEL)
        .then_some(())
        .ok_or_else(unauthorized_window)
}

fn ensure_main_or_preview_window(window: &WebviewWindow) -> Result<(), CommandError> {
    is_allowed_preview_reader_label(window.label())
        .then_some(())
        .ok_or_else(unauthorized_window)
}

fn is_artifact_token(token: &str) -> bool {
    token.len() == ARTIFACT_TOKEN_LENGTH
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn unauthorized_window() -> CommandError {
    command_error(
        "DEVICE_PREVIEW_UNAUTHORIZED",
        "runtime.error.desktopCommandFailed",
        "The current window is not allowed to use the device preview bridge.",
    )
}

fn invalid_snapshot(detail: &'static str) -> CommandError {
    command_error(
        "DEVICE_PREVIEW_SNAPSHOT_INVALID",
        "runtime.error.desktopCommandFailed",
        detail,
    )
}

fn window_error(detail: &'static str) -> CommandError {
    command_error(
        "DEVICE_PREVIEW_WINDOW_UNAVAILABLE",
        "runtime.error.desktopCommandFailed",
        detail,
    )
}

fn command_error(
    code: &'static str,
    message_key: &'static str,
    detail: &'static str,
) -> CommandError {
    CommandError {
        error: Box::new(ProtocolError::new(
            code,
            message_key,
            detail.to_owned(),
            Retryability::Safe,
        )),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        DevicePreviewPhase, DevicePreviewSnapshot, DevicePreviewState, MAXIMUM_PREVIEW_DIMENSION,
        is_artifact_token,
    };

    fn snapshot() -> DevicePreviewSnapshot {
        DevicePreviewSnapshot {
            generation: 7,
            phase: DevicePreviewPhase::Ready,
            preview_token: Some("0123456789abcdef0123456789abcdef".to_owned()),
            width: Some(1_920),
            height: Some(1_080),
            interaction_available: true,
        }
    }

    #[test]
    fn snapshot_validation_accepts_only_bounded_opaque_metadata() {
        assert!(snapshot().validate().is_ok());
        assert!(
            DevicePreviewSnapshot {
                preview_token: Some("../private".to_owned()),
                ..snapshot()
            }
            .validate()
            .is_err()
        );
        assert!(
            DevicePreviewSnapshot {
                width: Some(1),
                height: None,
                ..snapshot()
            }
            .validate()
            .is_err()
        );
        assert!(
            DevicePreviewSnapshot {
                width: Some(MAXIMUM_PREVIEW_DIMENSION + 1),
                ..snapshot()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn serialized_snapshot_contains_no_bytes_paths_or_device_identity() {
        let value = serde_json::to_value(snapshot()).expect("snapshot serializes");
        assert_eq!(
            value,
            json!({
                "generation": 7,
                "phase": "ready",
                "previewToken": "0123456789abcdef0123456789abcdef",
                "width": 1920,
                "height": 1080,
                "interactionAvailable": true
            })
        );
    }

    #[test]
    fn state_retains_snapshot_but_clears_only_visibility_on_close() {
        let state = DevicePreviewState::default();
        state.publish(snapshot());
        state.mark_visible();
        assert!(state.is_visible());
        state.mark_closed();
        assert!(!state.is_visible());
        assert_eq!(state.current(), Some(snapshot()));
    }

    #[test]
    fn artifact_tokens_are_lowercase_hex_only() {
        assert!(is_artifact_token("0123456789abcdef0123456789abcdef"));
        assert!(!is_artifact_token("ABCDEF0123456789ABCDEF0123456789"));
        assert!(!is_artifact_token("0123456789abcdef"));
    }
}
