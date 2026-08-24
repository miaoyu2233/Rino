//! Contained project file access for the authoring format settled by Decision Gate D-007.

pub mod commands;
mod error;
mod layout;
mod workspace;

pub use commands::ProjectWorkspaceState;
pub use error::{ProjectError, ProjectErrorCode};
pub use layout::RECOVERY_DIRECTORY_NAME;
pub use workspace::{
    ImageCaptureSourceKind, ImportedAsset, ProjectFile, ProjectFileSet, ProjectLocation,
    ProjectWorkspace, StoredImageObject,
};
