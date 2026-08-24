//! Resolution of the runtime executable the desktop shell is allowed to start.
//!
//! The program is always chosen here, never by the frontend or by project content. A
//! release build accepts only the bundled runtime next to the application executable. A
//! development build may fall back to the workspace interpreter, and that fallback is
//! compiled out of release builds so production can never select it.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use super::process::SidecarLaunch;
use super::protocol::TransportError;

#[cfg(windows)]
const BUNDLED_RUNTIME_FILE_NAME: &str = "rino-runtime.exe";
#[cfg(not(windows))]
const BUNDLED_RUNTIME_FILE_NAME: &str = "rino-runtime";

#[cfg(debug_assertions)]
const DEVELOPMENT_ADB_ENVIRONMENT_VARIABLE: &str = "RINO_DEV_ADB_EXECUTABLE";

/// Where the resolved runtime came from, for local diagnostics only.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LaunchSource {
    Bundled,
    DevelopmentWorkspace,
}

/// A resolved runtime entry point and its provenance.
pub struct ResolvedLaunch {
    pub launch: SidecarLaunch,
    pub source: LaunchSource,
}

/// Reads the explicit ADB executable used only by workspace development builds.
///
/// Release builds compile out both the environment-variable lookup and its name. Invalid,
/// relative, or missing files are ignored so neither `PATH` nor the working directory can
/// influence which executable the runtime starts.
#[cfg(debug_assertions)]
#[must_use]
pub fn development_adb_executable_from_environment() -> Option<PathBuf> {
    let path = PathBuf::from(std::env::var_os(DEVELOPMENT_ADB_ENVIRONMENT_VARIABLE)?);
    (path.is_absolute() && path.is_file()).then_some(path)
}

#[cfg(not(debug_assertions))]
pub const fn development_adb_executable_from_environment() -> Option<PathBuf> {
    None
}

/// Resolves the runtime entry point for the current build.
///
/// # Errors
///
/// Returns an error when no runtime executable can be resolved for this build.
pub fn resolve_launch(
    executable_directory: &Path,
    preview_cache_root: &Path,
    maa_user_data_root: &Path,
    development_adb_executable: Option<&Path>,
) -> Result<ResolvedLaunch, TransportError> {
    let bundled = executable_directory.join(BUNDLED_RUNTIME_FILE_NAME);
    if bundled.is_file() {
        return Ok(ResolvedLaunch {
            launch: SidecarLaunch::new(
                bundled,
                vec![
                    OsString::from("--preview-cache-directory"),
                    preview_cache_root.as_os_str().to_owned(),
                ],
            )?,
            source: LaunchSource::Bundled,
        });
    }

    development_launch(
        preview_cache_root,
        maa_user_data_root,
        development_adb_executable,
    )
    .ok_or(TransportError::ProtocolViolation(
        "the bundled runtime executable was not found beside the application",
    ))
}

#[cfg(debug_assertions)]
fn development_launch(
    preview_cache_root: &Path,
    maa_user_data_root: &Path,
    development_adb_executable: Option<&Path>,
) -> Option<ResolvedLaunch> {
    // The workspace interpreter has the runtime installed as an editable package, so the
    // module entry point resolves without adding any path to the child environment.
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)?
        .to_path_buf();
    let interpreter = if cfg!(windows) {
        workspace_root
            .join(".venv")
            .join("Scripts")
            .join("python.exe")
    } else {
        workspace_root.join(".venv").join("bin").join("python")
    };
    if !interpreter.is_file() {
        return None;
    }
    let arguments = development_arguments(
        preview_cache_root,
        maa_user_data_root,
        development_adb_executable,
    );
    SidecarLaunch::new(interpreter, arguments)
        .ok()
        .map(|launch| ResolvedLaunch {
            launch,
            source: LaunchSource::DevelopmentWorkspace,
        })
}

#[cfg(debug_assertions)]
fn development_arguments(
    preview_cache_root: &Path,
    maa_user_data_root: &Path,
    development_adb_executable: Option<&Path>,
) -> Vec<OsString> {
    let mut arguments = vec![
        OsString::from("-I"),
        OsString::from("-m"),
        OsString::from("rino_runtime"),
        OsString::from("--preview-cache-directory"),
        preview_cache_root.as_os_str().to_owned(),
    ];

    if let Some(adb_executable) =
        development_adb_executable.filter(|path| path.is_absolute() && path.is_file())
    {
        arguments.extend([
            OsString::from("--maa-user-data-directory"),
            maa_user_data_root.as_os_str().to_owned(),
            OsString::from("--adb-executable"),
            adb_executable.as_os_str().to_owned(),
        ]);
    }

    arguments
}

#[cfg(not(debug_assertions))]
const fn development_launch(
    _preview_cache_root: &Path,
    _maa_user_data_root: &Path,
    _development_adb_executable: Option<&Path>,
) -> Option<ResolvedLaunch> {
    None
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::*;

    fn contains_argument(arguments: &[OsString], expected: &str) -> bool {
        arguments.iter().any(|argument| argument == expected)
    }

    #[test]
    fn development_arguments_omit_maa_without_an_explicit_adb_executable() {
        let arguments = development_arguments(Path::new("preview"), Path::new("maa"), None);

        assert!(!contains_argument(&arguments, "--adb-executable"));
        assert!(!contains_argument(&arguments, "--maa-user-data-directory"));
    }

    #[test]
    fn development_arguments_pair_an_absolute_existing_adb_executable_with_maa_data()
    -> Result<(), Box<dyn std::error::Error>> {
        let adb_executable = std::env::current_exe()?;
        let maa_user_data_root = Path::new("maa-data");
        let arguments = development_arguments(
            Path::new("preview"),
            maa_user_data_root,
            Some(&adb_executable),
        );

        let maa_argument = arguments
            .iter()
            .position(|argument| argument == "--maa-user-data-directory")
            .ok_or_else(|| std::io::Error::other("Maa user data argument"))?;
        let adb_argument = arguments
            .iter()
            .position(|argument| argument == "--adb-executable")
            .ok_or_else(|| std::io::Error::other("ADB executable argument"))?;
        assert_eq!(
            arguments.get(maa_argument + 1).map(OsString::as_os_str),
            Some(maa_user_data_root.as_os_str())
        );
        assert_eq!(
            arguments.get(adb_argument + 1).map(OsString::as_os_str),
            Some(adb_executable.as_os_str())
        );
        Ok(())
    }

    #[test]
    fn development_arguments_reject_a_relative_adb_executable() {
        let arguments = development_arguments(
            Path::new("preview"),
            Path::new("maa"),
            Some(Path::new("adb.exe")),
        );

        assert!(!contains_argument(&arguments, "--adb-executable"));
        assert!(!contains_argument(&arguments, "--maa-user-data-directory"));
    }
}
