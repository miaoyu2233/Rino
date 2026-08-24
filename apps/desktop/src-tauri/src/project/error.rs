//! The structured failures the project surface reports to the frontend.

use std::{error, fmt, io};

use serde::Serialize;

/// A stable failure code the frontend maps to a localized, actionable message.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectErrorCode {
    /// The command needs an open project and none is open.
    NoOpenProject,
    /// A create or save-as was requested without a location the user had chosen.
    NoChosenLocation,
    /// The chosen directory already holds a project.
    LocationAlreadyHoldsProject,
    /// The chosen directory holds files that are not a Rino project.
    LocationNotEmpty,
    /// The selected file is not a project manifest.
    NotAProjectManifest,
    /// A file name outside the format's own allowlist was supplied or found.
    UnsupportedFileName,
    /// A file exceeds the format's size limit.
    FileTooLarge,
    /// A project holds more files than the format allows.
    TooManyFiles,
    /// The file could not be read.
    ReadFailed,
    /// The file could not be written, so the previous file was kept.
    WriteFailed,
    /// The project directory could not be created.
    CreateFailed,
    /// Content that must be JSON did not parse, so it was not committed.
    InvalidJson,
    /// Image bytes or their registered metadata are invalid or inconsistent.
    InvalidImage,
    /// A short-lived capture token is forged, stale, expired, or already released.
    CaptureUnavailable,
    /// The native file dialog could not be presented.
    DialogUnavailable,
}

/// A project failure carrying a stable code and a bounded technical hint.
///
/// The hint names the stage or the file name involved and never the absolute path, so a
/// failure the user copies out of the interface exposes no part of their profile layout.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectError {
    pub code: ProjectErrorCode,
    pub detail: String,
}

/// Both fields are already free of paths and user content, so the rendered form is safe
/// to place in a local diagnostic.
impl fmt::Display for ProjectError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:?} at {}", self.code, self.detail)
    }
}

impl error::Error for ProjectError {}

impl ProjectError {
    #[must_use]
    pub fn new(code: ProjectErrorCode, detail: &str) -> Self {
        Self {
            code,
            detail: detail.to_owned(),
        }
    }

    #[must_use]
    pub fn boxed(code: ProjectErrorCode, detail: &str) -> Box<Self> {
        Box::new(Self::new(code, detail))
    }

    /// Wraps an input/output failure, keeping only its kind.
    #[must_use]
    pub fn from_io(code: ProjectErrorCode, stage: &str, error: &io::Error) -> Box<Self> {
        Box::new(Self {
            code,
            detail: format!("{stage}:{:?}", error.kind()),
        })
    }
}
