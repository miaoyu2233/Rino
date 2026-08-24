//! The complete set of commands the frontend may invoke.
//!
//! This module is the entire native surface exposed to the webview. Every command takes
//! typed arguments and returns typed data or a structured error; none of them accepts an
//! executable path, a program argument, a filesystem path, or a free-form request type, so
//! the frontend cannot widen the boundary by choosing what to run.
//!
//! Command signatures are dictated by the desktop framework: managed state arrives by
//! value and return values are consumed by the framework rather than by a Rust caller. The
//! two lint exemptions below cover exactly that and apply to no other module.
#![allow(
    clippy::needless_pass_by_value,
    reason = "command handlers receive managed state by value as the framework requires"
)]
#![allow(
    clippy::must_use_candidate,
    reason = "command results are serialized by the framework, never dropped by a caller"
)]

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{State, WebviewWindow};

use crate::device_preview::is_allowed_preview_reader_label;
use crate::preview::PreviewCache;
use crate::project::ProjectWorkspaceState;
use crate::sidecar::{
    ProtocolError, REQUEST_TIMEOUT, Retryability, RuntimeStatus, SidecarSupervisor,
};

/// The runtime request types the frontend may send.
///
/// The runtime rejects unknown types as well, but keeping the allowlist here means the
/// webview cannot reach a request family the desktop has not deliberately exposed.
#[derive(Clone, Copy, Debug, serde::Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeRequest {
    CapturePrepare,
    CaptureRelease,
    DeviceConnect,
    DeviceDisconnect,
    DeviceInteract,
    DeviceList,
    GraphValidate,
    Health,
    PreviewCapture,
    PreviewRelease,
    RegistryGet,
    RunCancel,
    RunStart,
}

impl RuntimeRequest {
    const fn message_type(self) -> &'static str {
        match self {
            Self::CapturePrepare => "capture.prepare",
            Self::CaptureRelease => "capture.release",
            Self::DeviceConnect => "device.connect",
            Self::DeviceDisconnect => "device.disconnect",
            Self::DeviceInteract => "device.interact",
            Self::DeviceList => "device.list",
            Self::GraphValidate => "graph.validate",
            Self::Health => "system.health",
            Self::PreviewCapture => "preview.capture",
            Self::PreviewRelease => "preview.release",
            Self::RegistryGet => "registry.get",
            Self::RunCancel => "run.cancel",
            Self::RunStart => "run.start",
        }
    }
}

/// Shared supervisor state managed by the desktop shell.
pub struct RuntimeSupervisorState {
    pub supervisor: Mutex<SidecarSupervisor>,
}

/// Native ownership of the mapping from preview tokens to private cache files.
pub struct RuntimePreviewState {
    pub cache: Mutex<PreviewCache>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunAssetDocument {
    assets: Vec<RunAssetRecord>,
    graphs: Vec<RunAssetGraph>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunAssetRecord {
    asset_id: String,
    content_hash: String,
    byte_length: u64,
    coordinate_space: RunAssetCoordinateSpace,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunAssetCoordinateSpace {
    space_id: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunAssetGraph {
    graph_id: String,
    nodes: Vec<RunAssetNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunAssetNode {
    type_key: String,
    properties: Value,
}

#[derive(Debug)]
struct PendingRunAsset {
    asset_id: String,
    content_hash: String,
    byte_length: u64,
    coordinate_space_id: String,
    width: u32,
    height: u32,
    bytes: Vec<u8>,
}

fn project_asset_error(detail: &'static str) -> CommandError {
    CommandError {
        error: Box::new(ProtocolError::new(
            "PROJECT_ASSET_UNAVAILABLE",
            "runtime.error.projectAssetUnavailable",
            detail.to_owned(),
            Retryability::Safe,
        )),
    }
}

fn collect_run_assets(
    project_state: &State<'_, ProjectWorkspaceState>,
    payload: &Value,
) -> Result<Vec<PendingRunAsset>, CommandError> {
    let document_value = payload
        .get("document")
        .cloned()
        .ok_or_else(|| project_asset_error("The run document is missing."))?;
    let document: RunAssetDocument = serde_json::from_value(document_value)
        .map_err(|_| project_asset_error("The run document cannot resolve project assets."))?;
    let graph_id = payload
        .get("graphId")
        .and_then(Value::as_str)
        .ok_or_else(|| project_asset_error("The run graph identifier is missing."))?;
    let graph = document
        .graphs
        .iter()
        .find(|graph| graph.graph_id == graph_id)
        .ok_or_else(|| project_asset_error("The run graph is unavailable."))?;
    let mut asset_ids = graph
        .nodes
        .iter()
        .filter(|node| node.type_key == "core.image.projectAsset")
        .filter_map(|node| node.properties.get("assetId").and_then(Value::as_str))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    asset_ids.sort_unstable();
    asset_ids.dedup();
    if asset_ids.len() > 32 {
        return Err(project_asset_error("The run uses too many project images."));
    }

    let workspace = project_state
        .workspace
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    asset_ids
        .into_iter()
        .map(|asset_id| {
            let asset = document
                .assets
                .iter()
                .find(|asset| asset.asset_id == asset_id)
                .ok_or_else(|| project_asset_error("A selected project image is missing."))?;
            let bytes = workspace
                .read_image_object(&asset.content_hash, asset.byte_length)
                .map_err(|_| project_asset_error("A selected project image is unreadable."))?;
            Ok(PendingRunAsset {
                asset_id,
                content_hash: asset.content_hash.clone(),
                byte_length: asset.byte_length,
                coordinate_space_id: asset.coordinate_space.space_id.clone(),
                width: asset.coordinate_space.width,
                height: asset.coordinate_space.height,
                bytes,
            })
        })
        .collect()
}

fn stage_run_assets(
    preview_state: &State<'_, RuntimePreviewState>,
    payload: &mut Value,
    assets: &[PendingRunAsset],
) -> Result<Vec<String>, CommandError> {
    let object = payload
        .as_object_mut()
        .ok_or_else(|| project_asset_error("The run payload is invalid."))?;
    object.remove("assetBindings");
    let cache = locked_preview(preview_state);
    let mut tokens: Vec<String> = Vec::with_capacity(assets.len());
    let mut bindings = Vec::with_capacity(assets.len());
    for asset in assets {
        let token = match cache.stage_project_asset(&asset.bytes) {
            Ok(token) => token,
            Err(error) => {
                for staged in &tokens {
                    cache.release_project_asset(staged);
                }
                return Err(CommandError { error });
            }
        };
        bindings.push(json!({
            "assetId": asset.asset_id,
            "assetToken": token,
            "contentHash": asset.content_hash,
            "byteLength": asset.byte_length,
            "width": asset.width,
            "height": asset.height,
            "coordinateSpaceId": asset.coordinate_space_id,
        }));
        tokens.push(token);
    }
    if !bindings.is_empty() {
        object.insert("assetBindings".to_owned(), Value::Array(bindings));
    }
    drop(cache);
    Ok(tokens)
}

fn release_run_assets(preview_state: &State<'_, RuntimePreviewState>, tokens: &[String]) {
    let cache = locked_preview(preview_state);
    for token in tokens {
        cache.release_project_asset(token);
    }
}

/// A command failure in the shape the frontend already understands.
///
/// The structured error is boxed so a success path does not carry its size.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub error: Box<ProtocolError>,
}

impl From<Box<ProtocolError>> for CommandError {
    fn from(error: Box<ProtocolError>) -> Self {
        Self { error }
    }
}

/// Recovers from a poisoned supervisor lock without panicking.
///
/// A panic while the lock was held cannot corrupt the supervisor's invariants, because the
/// supervisor is rebuilt from the recovered guard on the next lifecycle call.
fn locked<'state>(
    state: &'state State<'_, RuntimeSupervisorState>,
) -> std::sync::MutexGuard<'state, SidecarSupervisor> {
    state
        .supervisor
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn locked_preview<'state>(
    state: &'state State<'_, RuntimePreviewState>,
) -> std::sync::MutexGuard<'state, PreviewCache> {
    state
        .cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Reports the current runtime lifecycle status.
#[tauri::command]
pub fn runtime_status(state: State<'_, RuntimeSupervisorState>) -> RuntimeStatus {
    let supervisor = locked(&state);
    supervisor.drain_diagnostics();
    supervisor.status()
}

/// Starts the runtime and completes the handshake.
///
/// # Errors
///
/// Returns a structured error when the runtime cannot start or the handshake fails.
#[tauri::command]
pub fn runtime_start(
    state: State<'_, RuntimeSupervisorState>,
    preview_state: State<'_, RuntimePreviewState>,
) -> Result<RuntimeStatus, CommandError> {
    let mut supervisor = locked(&state);
    locked_preview(&preview_state).clear();
    supervisor.start().map_err(CommandError::from)
}

/// Restarts the runtime at the user's explicit request.
///
/// # Errors
///
/// Returns a structured error when the new runtime process cannot start.
#[tauri::command]
pub fn runtime_restart(
    state: State<'_, RuntimeSupervisorState>,
    preview_state: State<'_, RuntimePreviewState>,
) -> Result<RuntimeStatus, CommandError> {
    let mut supervisor = locked(&state);
    locked_preview(&preview_state).clear();
    supervisor.restart(false).map_err(CommandError::from)
}

/// Stops the runtime, gracefully when possible.
#[tauri::command]
pub fn runtime_shutdown(
    state: State<'_, RuntimeSupervisorState>,
    preview_state: State<'_, RuntimePreviewState>,
) -> RuntimeStatus {
    let status = locked(&state).shutdown();
    locked_preview(&preview_state).clear();
    status
}

/// Sends one allowlisted request to the runtime and returns its result.
///
/// # Errors
///
/// Returns a structured error when the runtime is unavailable, the request times out, or
/// the runtime answers with an error.
#[tauri::command]
pub fn runtime_request(
    state: State<'_, RuntimeSupervisorState>,
    preview_state: State<'_, RuntimePreviewState>,
    project_state: State<'_, ProjectWorkspaceState>,
    request: RuntimeRequest,
    payload: Option<Value>,
) -> Result<Value, CommandError> {
    let mut payload = payload.unwrap_or_else(|| json!({}));
    let staged_run_tokens = if matches!(request, RuntimeRequest::RunStart) {
        let assets = collect_run_assets(&project_state, &payload)?;
        stage_run_assets(&preview_state, &mut payload, &assets)?
    } else {
        Vec::new()
    };
    let released_preview_token = if matches!(request, RuntimeRequest::PreviewRelease) {
        payload
            .get("previewToken")
            .and_then(Value::as_str)
            .map(str::to_owned)
    } else {
        None
    };
    let released_capture_token = if matches!(request, RuntimeRequest::CaptureRelease) {
        payload
            .get("captureToken")
            .and_then(Value::as_str)
            .map(str::to_owned)
    } else {
        None
    };
    let mut supervisor = locked(&state);
    let generation = supervisor.generation();
    let response = supervisor.request(request.message_type(), payload, REQUEST_TIMEOUT);
    drop(supervisor);
    release_run_assets(&preview_state, &staged_run_tokens);
    let result = response.map_err(CommandError::from)?;

    let mut cache = locked_preview(&preview_state);
    if matches!(request, RuntimeRequest::PreviewCapture) {
        cache
            .register_preview_from_result(&result, generation)
            .map_err(CommandError::from)?;
    } else if matches!(request, RuntimeRequest::CapturePrepare) {
        cache
            .register_capture_from_result(&result, generation)
            .map_err(CommandError::from)?;
    } else if let Some(token) = released_preview_token {
        cache.release_preview(&token);
    } else if let Some(token) = released_capture_token {
        cache.release_capture(&token);
    }
    drop(cache);
    Ok(result)
}

/// Reads one registered, current-generation preview as raw PNG bytes.
///
/// # Errors
///
/// Returns a structured error when the token is forged, stale, expired, or no longer
/// matches its registered file metadata.
#[tauri::command]
pub fn runtime_preview_read(
    window: WebviewWindow,
    state: State<'_, RuntimeSupervisorState>,
    preview_state: State<'_, RuntimePreviewState>,
    preview_token: String,
) -> Result<tauri::ipc::Response, CommandError> {
    if !is_allowed_preview_reader_label(window.label()) {
        return Err(CommandError {
            error: Box::new(ProtocolError::new(
                "DEVICE_PREVIEW_UNAUTHORIZED",
                "runtime.error.desktopCommandFailed",
                "The current window is not allowed to read a preview artifact.".to_owned(),
                Retryability::Safe,
            )),
        });
    }
    let generation = locked(&state).generation();
    let bytes = locked_preview(&preview_state)
        .read_preview(&preview_token, generation)
        .map_err(CommandError::from)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Reads one registered, current-generation confirmed capture as raw PNG bytes.
///
/// # Errors
///
/// Returns a structured error when the token is forged, stale, expired, or its file no
/// longer matches the runtime metadata registered for it.
#[tauri::command]
pub fn runtime_capture_read(
    state: State<'_, RuntimeSupervisorState>,
    preview_state: State<'_, RuntimePreviewState>,
    capture_token: String,
) -> Result<tauri::ipc::Response, CommandError> {
    let generation = locked(&state).generation();
    let capture = locked_preview(&preview_state)
        .read_capture(&capture_token, generation)
        .map_err(CommandError::from)?;
    Ok(tauri::ipc::Response::new(capture.bytes))
}

#[cfg(test)]
mod tests {
    use super::RuntimeRequest;

    #[test]
    fn runtime_request_variants_map_to_the_reviewed_protocol_allowlist() {
        let mappings = [
            (RuntimeRequest::CapturePrepare, "capture.prepare"),
            (RuntimeRequest::CaptureRelease, "capture.release"),
            (RuntimeRequest::DeviceConnect, "device.connect"),
            (RuntimeRequest::DeviceDisconnect, "device.disconnect"),
            (RuntimeRequest::DeviceInteract, "device.interact"),
            (RuntimeRequest::DeviceList, "device.list"),
            (RuntimeRequest::GraphValidate, "graph.validate"),
            (RuntimeRequest::Health, "system.health"),
            (RuntimeRequest::PreviewCapture, "preview.capture"),
            (RuntimeRequest::PreviewRelease, "preview.release"),
            (RuntimeRequest::RegistryGet, "registry.get"),
            (RuntimeRequest::RunCancel, "run.cancel"),
            (RuntimeRequest::RunStart, "run.start"),
        ];

        for (request, expected) in mappings {
            assert_eq!(request.message_type(), expected);
        }
    }
}
