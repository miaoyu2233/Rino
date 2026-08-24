use std::{error, fmt, io};

use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PublishingErrorCode {
    NoOpenProject,
    DialogUnavailable,
    InvalidInput,
    InvalidProject,
    AssetUnavailable,
    CredentialUnavailable,
    PackageWriteFailed,
    CacheCleanupFailed,
    GithubCliUnavailable,
    GithubAuthenticationRequired,
    GithubAuthenticationFailed,
    GithubLogoutFailed,
    PackageVersionExists,
    GithubCommandFailed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishingError {
    pub code: PublishingErrorCode,
    pub detail: String,
}

impl fmt::Display for PublishingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{:?} at {}", self.code, self.detail)
    }
}

impl error::Error for PublishingError {}

impl PublishingError {
    #[must_use]
    pub fn new(code: PublishingErrorCode, detail: &str) -> Self {
        Self {
            code,
            detail: detail.to_owned(),
        }
    }

    #[must_use]
    pub fn from_io(code: PublishingErrorCode, stage: &str, error: &io::Error) -> Self {
        Self::new(code, &format!("{stage}:{:?}", error.kind()))
    }
}

pub type PublishingResult<T> = Result<T, PublishingError>;
