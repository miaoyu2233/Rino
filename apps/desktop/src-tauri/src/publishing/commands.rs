use std::{
    path::{Path, PathBuf},
    sync::PoisonError,
};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::project::ProjectWorkspaceState;

use super::{
    PublishingState,
    error::{PublishingError, PublishingErrorCode, PublishingResult},
    github::{GithubPublishOutput, GithubStatus},
    manifest::PackageOptions,
    package::PackageOutput,
    signing::PublisherSigningKey,
};

const MAXIMUM_CAPTION_LENGTH: usize = 120;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishingDialogCaptions {
    pub title: String,
    pub file_type_label: String,
}

impl PublishingDialogCaptions {
    fn title(&self) -> &str {
        truncate_caption(&self.title)
    }

    fn file_type_label(&self) -> &str {
        truncate_caption(&self.file_type_label)
    }
}

fn truncate_caption(caption: &str) -> &str {
    match caption.char_indices().nth(MAXIMUM_CAPTION_LENGTH) {
        Some((index, _)) => &caption[..index],
        None => caption,
    }
}

async fn await_save_selection(
    app: &AppHandle,
    captions: PublishingDialogCaptions,
    asset_name: &str,
) -> PublishingResult<Option<PathBuf>> {
    let title = captions.title().to_owned();
    let file_type_label = captions.file_type_label().to_owned();
    let asset_name = asset_name.to_owned();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .set_title(&title)
        .set_file_name(&asset_name)
        .add_filter(&file_type_label, &["rino-package"])
        .save_file(move |picked| {
            let _ignored = sender.blocking_send(picked.and_then(|path| path.into_path().ok()));
        });
    receiver.recv().await.ok_or_else(|| {
        PublishingError::new(PublishingErrorCode::DialogUnavailable, "saveSelection")
    })
}

fn write_package_to(
    app: &AppHandle,
    target: &Path,
    options: &PackageOptions,
) -> PublishingResult<PackageOutput> {
    let project_state = app.state::<ProjectWorkspaceState>();
    let workspace = project_state
        .workspace
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let signing_key = PublisherSigningKey::load_or_create()?;
    super::package::write_package(target, &workspace, options, &signing_key)
}

#[tauri::command]
pub async fn publishing_status() -> GithubStatus {
    tauri::async_runtime::spawn_blocking(super::github::status)
        .await
        .unwrap_or(GithubStatus {
            available: false,
            authenticated: false,
        })
}

#[tauri::command]
/// Starts the fixed GitHub CLI browser authentication flow without returning account data.
///
/// # Errors
///
/// Returns a structured failure when the CLI is missing, another publishing operation is
/// active, the browser authorization is cancelled, or the resulting session is invalid.
pub async fn publishing_login(state: State<'_, PublishingState>) -> PublishingResult<GithubStatus> {
    let Some(_operation) = state.acquire_operation() else {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidInput,
            "operationBusy",
        ));
    };
    tauri::async_runtime::spawn_blocking(super::github::login)
        .await
        .map_err(|_| {
            PublishingError::new(
                PublishingErrorCode::GithubAuthenticationFailed,
                "githubAuthenticationTask",
            )
        })?
}

#[tauri::command]
/// Removes the locally stored GitHub CLI authentication configuration.
///
/// # Errors
///
/// Returns a structured failure when the CLI is missing, another publishing operation is
/// active, or the active local authentication cannot be removed safely.
pub async fn publishing_logout(
    state: State<'_, PublishingState>,
) -> PublishingResult<GithubStatus> {
    let Some(_operation) = state.acquire_operation() else {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidInput,
            "operationBusy",
        ));
    };
    tauri::async_runtime::spawn_blocking(super::github::logout)
        .await
        .map_err(|_| {
            PublishingError::new(PublishingErrorCode::GithubLogoutFailed, "githubLogoutTask")
        })?
}

#[tauri::command]
/// Exports the committed project to a user-selected `.rino-package` path.
///
/// # Errors
///
/// Returns a structured failure for invalid metadata, unavailable credentials or assets,
/// a failed dialog, or a package write that could not complete safely.
pub async fn publishing_export(
    app: AppHandle,
    state: State<'_, PublishingState>,
    captions: PublishingDialogCaptions,
    options: PackageOptions,
) -> PublishingResult<Option<PackageOutput>> {
    options.validate()?;
    let selected = await_save_selection(&app, captions, &options.asset_name()).await?;
    let Some(mut target) = selected else {
        return Ok(None);
    };
    if target
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("rino-package"))
    {
        target.set_extension("rino-package");
    }
    let Some(_operation) = state.acquire_operation() else {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidInput,
            "operationBusy",
        ));
    };
    let result =
        tauri::async_runtime::spawn_blocking(move || write_package_to(&app, &target, &options))
            .await
            .map_err(|_| {
                PublishingError::new(PublishingErrorCode::PackageWriteFailed, "exportTask")
            });
    result?.map(Some)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishOutput {
    #[serde(flatten)]
    pub package: PackageOutput,
    #[serde(flatten)]
    pub github: GithubPublishOutput,
}

#[tauri::command]
/// Creates a signed temporary package and publishes it through the authenticated GitHub CLI.
///
/// # Errors
///
/// Returns a structured failure when packaging fails or the fixed GitHub workflow cannot
/// authenticate, verify public repository visibility, or create the Release asset.
pub async fn publishing_publish(
    app: AppHandle,
    state: State<'_, PublishingState>,
    options: PackageOptions,
) -> PublishingResult<PublishOutput> {
    options.validate()?;
    let Some(_operation) = state.acquire_operation() else {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidInput,
            "operationBusy",
        ));
    };
    let cache_root = state.cache_root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        super::cache::prepare(&cache_root)?;
        let package_path = cache_root.join(format!("{}.rino-package", Uuid::new_v4().simple()));
        let result = (|| -> PublishingResult<PublishOutput> {
            let package = write_package_to(&app, &package_path, &options)?;
            let github = super::github::publish(&package_path, &options)?;
            Ok(PublishOutput { package, github })
        })();
        let cleanup = super::cache::remove_package(&package_path, result.is_ok());
        match (result, cleanup) {
            (Ok(output), Ok(())) => Ok(output),
            (Err(error), Ok(())) => Err(error),
            (_, Err(cleanup_error)) => Err(cleanup_error),
        }
    })
    .await
    .map_err(|_| PublishingError::new(PublishingErrorCode::GithubCommandFailed, "publishTask"));
    result?
}
