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
    manifest::{PackageOptions, PublishingContent},
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
    extension: &str,
) -> PublishingResult<Option<PathBuf>> {
    let title = captions.title().to_owned();
    let file_type_label = captions.file_type_label().to_owned();
    let asset_name = asset_name.to_owned();
    let extension = extension.to_owned();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .set_title(&title)
        .set_file_name(&asset_name)
        .add_filter(&file_type_label, &[&extension])
        .save_file(move |picked| {
            let _ignored = sender.blocking_send(picked.and_then(|path| path.into_path().ok()));
        });
    receiver.recv().await.ok_or_else(|| {
        PublishingError::new(PublishingErrorCode::DialogUnavailable, "saveSelection")
    })
}

async fn await_directory_selection(
    app: &AppHandle,
    captions: PublishingDialogCaptions,
) -> PublishingResult<Option<PathBuf>> {
    let title = captions.title().to_owned();
    let (sender, mut receiver) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .set_title(&title)
        .pick_folder(move |picked| {
            let _ignored = sender.blocking_send(picked.and_then(|path| path.into_path().ok()));
        });
    receiver.recv().await.ok_or_else(|| {
        PublishingError::new(PublishingErrorCode::DialogUnavailable, "directorySelection")
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

fn temporary_package_path(cache_root: &Path) -> PathBuf {
    cache_root.join(format!("{}.rino-package", Uuid::new_v4().simple()))
}

fn temporary_application_path(cache_root: &Path) -> PathBuf {
    cache_root.join(format!("{}.rino-app.zip", Uuid::new_v4().simple()))
}

fn ensure_application_suffix(target: &mut PathBuf) {
    let expected = ".rino-app.zip";
    let matches = target
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(expected));
    if !matches {
        target.set_extension(expected.trim_start_matches('.'));
    }
}

fn write_local_resources(
    app: &AppHandle,
    target: &Path,
    options: &PackageOptions,
    package_cache_root: &Path,
) -> PublishingResult<PackageOutput> {
    super::cache::prepare(package_cache_root)?;
    let package_path = temporary_package_path(package_cache_root);
    let result = (|| {
        let package = write_package_to(app, &package_path, options)?;
        super::application::write_resource_directory(target, &package_path, &package, options)
    })();
    let cleanup = super::cache::remove_artifact(&package_path, result.is_ok());
    match (result, cleanup) {
        (Ok(output), Ok(())) => Ok(output),
        (Err(error), Ok(())) | (_, Err(error)) => Err(error),
    }
}

fn write_local_application(
    app: &AppHandle,
    target: &Path,
    options: &PackageOptions,
    package_cache_root: &Path,
    template_cache_root: &Path,
) -> PublishingResult<PackageOutput> {
    super::cache::prepare(package_cache_root)?;
    let template = super::application::resolve_template(template_cache_root, options.update_wfp)?;
    let package_path = temporary_package_path(package_cache_root);
    let result = (|| {
        let package = write_package_to(app, &package_path, options)?;
        super::application::write_application(target, &template, &package_path, &package, options)
    })();
    let cleanup = super::cache::remove_artifact(&package_path, result.is_ok());
    match (result, cleanup) {
        (Ok(output), Ok(())) => Ok(output),
        (Err(error), Ok(())) | (_, Err(error)) => Err(error),
    }
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
/// Exports the committed project as a signed WFP resource directory or runnable application.
///
/// # Errors
///
/// Returns a structured failure for invalid metadata, unavailable credentials or assets,
/// a failed dialog, an unavailable WFP template, or an archive write that cannot complete safely.
pub async fn publishing_export(
    app: AppHandle,
    state: State<'_, PublishingState>,
    captions: PublishingDialogCaptions,
    options: PackageOptions,
) -> PublishingResult<Option<PackageOutput>> {
    options.validate()?;
    let selected = match options.content {
        PublishingContent::Resource => await_directory_selection(&app, captions).await?,
        PublishingContent::Application => {
            await_save_selection(&app, captions, &options.asset_name(), "zip").await?
        }
    };
    let Some(selected) = selected else {
        return Ok(None);
    };
    let target = match options.content {
        PublishingContent::Resource => selected.join(super::application::RESOURCE_DIRECTORY_NAME),
        PublishingContent::Application => {
            let mut target = selected;
            ensure_application_suffix(&mut target);
            target
        }
    };
    let Some(_operation) = state.acquire_operation() else {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidInput,
            "operationBusy",
        ));
    };
    let package_cache_root = state.cache_root.clone();
    let template_cache_root = state.template_cache_root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || match options.content {
        PublishingContent::Resource => {
            write_local_resources(&app, &target, &options, &package_cache_root)
        }
        PublishingContent::Application => write_local_application(
            &app,
            &target,
            &options,
            &package_cache_root,
            &template_cache_root,
        ),
    })
    .await
    .map_err(|_| PublishingError::new(PublishingErrorCode::PackageWriteFailed, "exportTask"));
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
/// Creates the selected artifact and publishes it through the authenticated GitHub CLI.
///
/// Application publishing always synchronizes the newest stable `Rino_WFP` template and uploads
/// only the runnable application archive. Resource publishing uploads only the signed package.
///
/// # Errors
///
/// Returns a structured failure when packaging, template synchronization, or the fixed GitHub
/// workflow cannot authenticate, verify public visibility, or create the Release asset.
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
    let package_cache_root = state.cache_root.clone();
    let template_cache_root = state.template_cache_root.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        super::cache::prepare(&package_cache_root)?;
        let package_path = temporary_package_path(&package_cache_root);
        let application_path = temporary_application_path(&package_cache_root);
        let result = (|| -> PublishingResult<PublishOutput> {
            let package = write_package_to(&app, &package_path, &options)?;
            let (artifact_path, artifact) = match options.content {
                PublishingContent::Resource => (package_path.as_path(), package),
                PublishingContent::Application => {
                    let template =
                        super::application::resolve_template(&template_cache_root, true)?;
                    let application = super::application::write_application(
                        &application_path,
                        &template,
                        &package_path,
                        &package,
                        &options,
                    )?;
                    (application_path.as_path(), application)
                }
            };
            let github = super::github::publish(artifact_path, &artifact.asset_name, &options)?;
            Ok(PublishOutput {
                package: artifact,
                github,
            })
        })();
        let package_cleanup = super::cache::remove_artifact(&package_path, result.is_ok());
        let application_cleanup = super::cache::remove_artifact(&application_path, result.is_ok());
        match (result, package_cleanup, application_cleanup) {
            (Ok(output), Ok(()), Ok(())) => Ok(output),
            (Err(error), Ok(()), Ok(())) | (_, Err(error), _) | (_, _, Err(error)) => Err(error),
        }
    })
    .await
    .map_err(|_| PublishingError::new(PublishingErrorCode::GithubCommandFailed, "publishTask"));
    result?
}
