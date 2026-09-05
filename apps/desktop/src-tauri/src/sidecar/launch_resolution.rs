//! Resolution of the runtime executable the desktop shell is allowed to start.
//!
//! The program is always chosen here, never by the frontend or by project content. A
//! release build accepts only the bundled runtime under the application directory. A
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

const BUNDLED_RUNTIME_DIRECTORY: &str = "runtime";
const BUNDLED_ADB_RELATIVE_PATH: &str = "platform-tools/adb.exe";
const BUNDLED_MAA_AGENT_RELATIVE_PATH: &str = "_internal/MaaAgentBinary";
const BUNDLED_OCR_RELATIVE_PATH: &str = "Resource/base/model/ocr";
const BUNDLED_OCR_FILES: [&str; 3] = ["det.onnx", "rec.onnx", "keys.txt"];

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
    let bundled = executable_directory
        .join(BUNDLED_RUNTIME_DIRECTORY)
        .join(BUNDLED_RUNTIME_FILE_NAME);
    if bundled.is_file() {
        let arguments =
            bundled_arguments(executable_directory, preview_cache_root, maa_user_data_root)?;
        let owned_adb_executable = executable_directory
            .join(BUNDLED_RUNTIME_DIRECTORY)
            .join(BUNDLED_ADB_RELATIVE_PATH);
        return Ok(ResolvedLaunch {
            launch: SidecarLaunch::new(bundled, arguments)?
                .with_owned_adb_executable(owned_adb_executable)?,
            source: LaunchSource::Bundled,
        });
    }

    development_launch(
        preview_cache_root,
        maa_user_data_root,
        development_adb_executable,
    )
    .ok_or(TransportError::ProtocolViolation(
        "the bundled runtime executable was not found under the application directory",
    ))
}

fn bundled_arguments(
    executable_directory: &Path,
    preview_cache_root: &Path,
    maa_user_data_root: &Path,
) -> Result<Vec<OsString>, TransportError> {
    if !executable_directory.is_absolute() {
        return Err(TransportError::ProtocolViolation(
            "the bundled resource directory must be absolute",
        ));
    }

    let runtime_directory = executable_directory.join(BUNDLED_RUNTIME_DIRECTORY);
    let adb_executable = runtime_directory.join(BUNDLED_ADB_RELATIVE_PATH);
    let maa_agent_directory = runtime_directory.join(BUNDLED_MAA_AGENT_RELATIVE_PATH);
    let ocr_model_directory = executable_directory.join(BUNDLED_OCR_RELATIVE_PATH);

    if !adb_executable.is_file() {
        return Err(TransportError::ProtocolViolation(
            "the bundled ADB executable was not found",
        ));
    }
    if !maa_agent_directory.is_dir() {
        return Err(TransportError::ProtocolViolation(
            "the bundled Maa agent directory was not found",
        ));
    }
    if !ocr_model_directory.is_dir()
        || BUNDLED_OCR_FILES
            .iter()
            .any(|file_name| !ocr_model_directory.join(file_name).is_file())
    {
        return Err(TransportError::ProtocolViolation(
            "the bundled OCR model directory is incomplete",
        ));
    }

    Ok(vec![
        OsString::from("--preview-cache-directory"),
        preview_cache_root.as_os_str().to_owned(),
        OsString::from("--maa-user-data-directory"),
        maa_user_data_root.as_os_str().to_owned(),
        OsString::from("--adb-executable"),
        adb_executable.into_os_string(),
        OsString::from("--maa-agent-directory"),
        maa_agent_directory.into_os_string(),
        OsString::from("--maa-ocr-model-directory"),
        ocr_model_directory.into_os_string(),
    ])
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
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    struct TestLayout {
        root: PathBuf,
    }

    impl TestLayout {
        fn new() -> Result<Self, Box<dyn std::error::Error>> {
            let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
            let root = std::env::temp_dir().join(format!("rino-launch-resolution-{nonce}"));
            let runtime = root.join(BUNDLED_RUNTIME_DIRECTORY);
            let ocr = root.join(BUNDLED_OCR_RELATIVE_PATH);
            fs::create_dir_all(runtime.join("platform-tools"))?;
            fs::create_dir_all(runtime.join(BUNDLED_MAA_AGENT_RELATIVE_PATH))?;
            fs::create_dir_all(&ocr)?;
            fs::write(runtime.join(BUNDLED_RUNTIME_FILE_NAME), b"runtime")?;
            fs::write(runtime.join(BUNDLED_ADB_RELATIVE_PATH), b"adb")?;
            for file_name in BUNDLED_OCR_FILES {
                fs::write(ocr.join(file_name), b"ocr")?;
            }
            Ok(Self { root })
        }
    }

    impl Drop for TestLayout {
        fn drop(&mut self) {
            let _ignored = fs::remove_dir_all(&self.root);
        }
    }

    fn argument_value<'a>(arguments: &'a [OsString], name: &str) -> Option<&'a OsString> {
        arguments
            .windows(2)
            .find(|pair| pair[0] == name)
            .map(|pair| &pair[1])
    }

    #[test]
    fn bundled_arguments_use_only_application_owned_runtime_assets()
    -> Result<(), Box<dyn std::error::Error>> {
        let layout = TestLayout::new()?;
        let preview = layout.root.join("preview");
        let maa_data = layout.root.join("maa-data");
        let arguments = bundled_arguments(&layout.root, &preview, &maa_data)?;

        let expected_adb = layout
            .root
            .join(BUNDLED_RUNTIME_DIRECTORY)
            .join(BUNDLED_ADB_RELATIVE_PATH)
            .into_os_string();
        let expected_agent = layout
            .root
            .join(BUNDLED_RUNTIME_DIRECTORY)
            .join(BUNDLED_MAA_AGENT_RELATIVE_PATH)
            .into_os_string();
        let expected_ocr = layout.root.join("Resource/base/model/ocr").into_os_string();
        let expected_preview = preview.into_os_string();
        let expected_maa_data = maa_data.into_os_string();
        assert_eq!(
            argument_value(&arguments, "--adb-executable"),
            Some(&expected_adb)
        );
        assert_eq!(
            argument_value(&arguments, "--maa-agent-directory"),
            Some(&expected_agent)
        );
        assert_eq!(
            argument_value(&arguments, "--maa-ocr-model-directory"),
            Some(&expected_ocr)
        );
        assert_eq!(
            argument_value(&arguments, "--preview-cache-directory"),
            Some(&expected_preview)
        );
        assert_eq!(
            argument_value(&arguments, "--maa-user-data-directory"),
            Some(&expected_maa_data)
        );
        Ok(())
    }

    #[test]
    fn bundled_arguments_reject_an_incomplete_runtime_layout()
    -> Result<(), Box<dyn std::error::Error>> {
        let layout = TestLayout::new()?;
        fs::remove_file(
            layout
                .root
                .join(BUNDLED_RUNTIME_DIRECTORY)
                .join(BUNDLED_ADB_RELATIVE_PATH),
        )?;

        let error = bundled_arguments(
            &layout.root,
            &layout.root.join("preview"),
            &layout.root.join("maa-data"),
        )
        .expect_err("missing bundled ADB must be rejected");
        assert!(matches!(error, TransportError::ProtocolViolation(_)));
        Ok(())
    }

    #[test]
    fn bundled_launch_owns_only_its_packaged_adb_executable()
    -> Result<(), Box<dyn std::error::Error>> {
        let layout = TestLayout::new()?;
        let resolved = resolve_launch(
            &layout.root,
            &layout.root.join("preview"),
            &layout.root.join("maa-data"),
            None,
        )?;
        let expected_adb = layout
            .root
            .join(BUNDLED_RUNTIME_DIRECTORY)
            .join(BUNDLED_ADB_RELATIVE_PATH);

        assert_eq!(resolved.source, LaunchSource::Bundled);
        assert_eq!(
            resolved.launch.owned_adb_executable(),
            Some(expected_adb.as_path())
        );
        Ok(())
    }

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
