use std::{fmt, fs, path::PathBuf};

use tauri::{Runtime, path::PathResolver};

use crate::startup::{StartupError, StartupStage};

pub struct ApplicationDirectories {
    data: PathBuf,
    cache: PathBuf,
    logs: PathBuf,
}

/// The directory fields hold absolute user-profile paths, so the debug output reports only
/// their presence and never the paths themselves.
impl fmt::Debug for ApplicationDirectories {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ApplicationDirectories")
            .field("data", &"<redacted>")
            .field("cache", &"<redacted>")
            .field("logs", &"<redacted>")
            .finish()
    }
}

impl ApplicationDirectories {
    pub(crate) fn initialize<R: Runtime>(resolver: &PathResolver<R>) -> Result<Self, StartupError> {
        let directories = Self {
            data: resolver.app_data_dir().map_err(|error| {
                StartupError::tauri(
                    "APP_DATA_PATH_UNAVAILABLE",
                    StartupStage::ResolveAppData,
                    error,
                )
            })?,
            cache: resolver.app_cache_dir().map_err(|error| {
                StartupError::tauri(
                    "APP_CACHE_PATH_UNAVAILABLE",
                    StartupStage::ResolveAppCache,
                    error,
                )
            })?,
            logs: resolver.app_log_dir().map_err(|error| {
                StartupError::tauri(
                    "APP_LOG_PATH_UNAVAILABLE",
                    StartupStage::ResolveAppLogs,
                    error,
                )
            })?,
        };

        directories.create_all()?;
        Ok(directories)
    }

    /// The application-owned slot that holds unsaved project work.
    ///
    /// Recovery lives in application data rather than inside the project directory,
    /// because the project directory is what the user publishes and an autosave is not
    /// part of it.
    pub(crate) fn recovery_root(&self) -> PathBuf {
        self.data.join(crate::project::RECOVERY_DIRECTORY_NAME)
    }

    /// The application-owned cache used for short-lived device preview images.
    pub(crate) fn preview_cache_root(&self) -> PathBuf {
        self.cache.join("preview")
    }

    /// The private application-data directory used by the local automation backend.
    pub(crate) fn maa_user_data_root(&self) -> PathBuf {
        self.data.join("maa")
    }

    /// Short-lived signed packages created immediately before an explicit upload.
    pub(crate) fn publishing_cache_root(&self) -> PathBuf {
        self.cache.join("publishing-cache")
    }

    fn create_all(&self) -> Result<(), StartupError> {
        create_directory(
            &self.logs,
            "APP_LOG_DIRECTORY_CREATE_FAILED",
            StartupStage::CreateAppLogs,
        )?;
        create_directory(
            &self.data,
            "APP_DATA_DIRECTORY_CREATE_FAILED",
            StartupStage::CreateAppData,
        )?;
        create_directory(
            &self.cache,
            "APP_CACHE_DIRECTORY_CREATE_FAILED",
            StartupStage::CreateAppCache,
        )
    }
}

fn create_directory(
    path: &std::path::Path,
    code: &'static str,
    stage: StartupStage,
) -> Result<(), StartupError> {
    fs::create_dir_all(path).map_err(|error| StartupError::io(code, stage, error))
}
