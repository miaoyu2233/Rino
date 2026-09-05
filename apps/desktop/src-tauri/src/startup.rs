use std::{
    error::Error,
    fmt, fs,
    io::{self, Write},
};

use serde::Serialize;

const STARTUP_DIAGNOSTIC_FILE_NAME: &str = "rino-startup-error-v1.json";
const DIAGNOSTIC_WRITE_FAILURE: &str = r#"{"schemaVersion":1,"application":"rino-desktop","severity":"error","code":"STARTUP_DIAGNOSTIC_WRITE_FAILED","stage":"reportStartupFailure","failureKind":"io"}"#;
const DIAGNOSTIC_SERIALIZE_FAILURE: &str = r#"{"schemaVersion":1,"application":"rino-desktop","severity":"error","code":"STARTUP_DIAGNOSTIC_SERIALIZE_FAILED","stage":"reportStartupFailure","failureKind":"serialization"}"#;

#[derive(Clone, Copy, Debug)]
pub enum StartupStage {
    RegisterApplicationInstance,
    BuildDesktopRuntime,
    ResolveAppData,
    ResolveAppCache,
    ResolveAppLogs,
    CreateAppData,
    CreateAppCache,
    CreateAppLogs,
    CreatePreviewCache,
    CleanPublishingCache,
    ResolveRuntimeExecutable,
}

impl StartupStage {
    const fn as_str(self) -> &'static str {
        match self {
            Self::RegisterApplicationInstance => "registerApplicationInstance",
            Self::BuildDesktopRuntime => "buildDesktopRuntime",
            Self::ResolveAppData => "resolveAppData",
            Self::ResolveAppCache => "resolveAppCache",
            Self::ResolveAppLogs => "resolveAppLogs",
            Self::CreateAppData => "createAppData",
            Self::CreateAppCache => "createAppCache",
            Self::CreateAppLogs => "createAppLogs",
            Self::CreatePreviewCache => "createPreviewCache",
            Self::CleanPublishingCache => "cleanPublishingCache",
            Self::ResolveRuntimeExecutable => "resolveRuntimeExecutable",
        }
    }
}

enum StartupErrorSource {
    Tauri(tauri::Error),
    Io(io::Error),
}

impl StartupErrorSource {
    const fn kind(&self) -> &'static str {
        match self {
            Self::Tauri(_) => "tauri",
            Self::Io(_) => "io",
        }
    }

    fn os_error_code(&self) -> Option<i32> {
        match self {
            Self::Tauri(_) => None,
            Self::Io(error) => error.raw_os_error(),
        }
    }
}

/// A startup failure that retains its source for local debugging while exposing only safe,
/// structured diagnostic fields to logs.
pub struct StartupError {
    code: &'static str,
    stage: StartupStage,
    source: StartupErrorSource,
}

impl StartupError {
    pub(crate) const fn desktop_runtime(source: tauri::Error) -> Self {
        Self::tauri(
            "DESKTOP_RUNTIME_BUILD_FAILED",
            StartupStage::BuildDesktopRuntime,
            source,
        )
    }

    pub(crate) const fn tauri(
        code: &'static str,
        stage: StartupStage,
        source: tauri::Error,
    ) -> Self {
        Self {
            code,
            stage,
            source: StartupErrorSource::Tauri(source),
        }
    }

    pub(crate) const fn io(code: &'static str, stage: StartupStage, source: io::Error) -> Self {
        Self {
            code,
            stage,
            source: StartupErrorSource::Io(source),
        }
    }

    fn diagnostic(&self) -> StartupDiagnostic {
        StartupDiagnostic {
            schema_version: 1,
            application: "rino-desktop",
            severity: "error",
            code: self.code,
            stage: self.stage.as_str(),
            failure_kind: self.source.kind(),
            os_error_code: self.source.os_error_code(),
        }
    }
}

impl fmt::Debug for StartupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StartupError")
            .field("code", &self.code)
            .field("stage", &self.stage.as_str())
            .field("failure_kind", &self.source.kind())
            .field("os_error_code", &self.source.os_error_code())
            .finish_non_exhaustive()
    }
}

impl fmt::Display for StartupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Rino startup failed at {} with code {}",
            self.stage.as_str(),
            self.code
        )
    }
}

impl Error for StartupError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match &self.source {
            StartupErrorSource::Tauri(error) => Some(error),
            StartupErrorSource::Io(error) => Some(error),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupDiagnostic {
    schema_version: u8,
    application: &'static str,
    severity: &'static str,
    code: &'static str,
    stage: &'static str,
    failure_kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    os_error_code: Option<i32>,
}

/// Writes a redacted, versioned startup diagnostic to standard error and to a fixed file in the
/// operating system's temporary directory. The file path is not exposed to the frontend.
pub fn report_startup_failure(error: &StartupError) {
    let diagnostic = serialize_diagnostic(error);
    let diagnostic_path = std::env::temp_dir().join(STARTUP_DIAGNOSTIC_FILE_NAME);
    let file_write_failed = fs::write(diagnostic_path, diagnostic.as_bytes()).is_err();

    let stderr = io::stderr();
    let mut stderr_lock = stderr.lock();
    if file_write_failed {
        let _write_result = writeln!(stderr_lock, "{DIAGNOSTIC_WRITE_FAILURE}");
    }
    let _write_result = writeln!(stderr_lock, "{diagnostic}");
}

fn serialize_diagnostic(error: &StartupError) -> String {
    serde_json::to_string(&error.diagnostic())
        .unwrap_or_else(|_| DIAGNOSTIC_SERIALIZE_FAILURE.to_owned())
}

#[cfg(test)]
mod tests {
    use super::{StartupError, StartupStage, serialize_diagnostic};

    #[test]
    fn diagnostic_omits_sensitive_source_message() -> Result<(), serde_json::Error> {
        let error = StartupError::io(
            "APP_DATA_DIRECTORY_CREATE_FAILED",
            StartupStage::CreateAppData,
            std::io::Error::other(r"private path C:\Users\example\secret"),
        );

        let diagnostic = serialize_diagnostic(&error);
        let parsed: serde_json::Value = serde_json::from_str(&diagnostic)?;

        assert_eq!(parsed["schemaVersion"], 1);
        assert_eq!(parsed["code"], "APP_DATA_DIRECTORY_CREATE_FAILED");
        assert_eq!(parsed["stage"], "createAppData");
        assert_eq!(parsed["failureKind"], "io");
        assert!(!diagnostic.contains("private path"));
        assert!(!diagnostic.contains("Users"));

        Ok(())
    }

    #[test]
    fn debug_and_display_output_omit_sensitive_source_message() {
        let error = StartupError::io(
            "APP_LOG_DIRECTORY_CREATE_FAILED",
            StartupStage::CreateAppLogs,
            std::io::Error::other("private diagnostic detail"),
        );

        let debug_output = format!("{error:?}");
        let display_output = error.to_string();

        assert!(!debug_output.contains("private diagnostic detail"));
        assert!(!display_output.contains("private diagnostic detail"));
        assert!(display_output.contains("APP_LOG_DIRECTORY_CREATE_FAILED"));
    }
}
