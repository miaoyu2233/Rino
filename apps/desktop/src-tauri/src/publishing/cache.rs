use std::{fs, io, path::Path};

use super::error::{PublishingError, PublishingErrorCode, PublishingResult};

const PACKAGE_SUFFIX: &str = ".rino-package";
const APPLICATION_SUFFIX: &str = ".exe";
const PACKAGE_ID_LENGTH: usize = 32;
const MAXIMUM_CACHE_ENTRIES: usize = 4_096;

pub fn prepare(root: &Path) -> PublishingResult<()> {
    fs::create_dir_all(root).map_err(|error| cache_error("publishingCacheCreate", &error))?;
    let metadata = fs::symlink_metadata(root)
        .map_err(|error| cache_error("publishingCacheMetadata", &error))?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_dir() {
        return Err(PublishingError::new(
            PublishingErrorCode::CacheCleanupFailed,
            "publishingCacheUnsafe",
        ));
    }

    let entries = fs::read_dir(root).map_err(|error| cache_error("publishingCacheRead", &error))?;
    for (index, entry) in entries.enumerate() {
        if index >= MAXIMUM_CACHE_ENTRIES {
            return Err(PublishingError::new(
                PublishingErrorCode::CacheCleanupFailed,
                "publishingCacheEntryLimit",
            ));
        }
        let entry = entry.map_err(|error| cache_error("publishingCacheEntry", &error))?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if !is_owned_cache_file_name(file_name) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| cache_error("publishingCacheFileMetadata", &error))?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_file() {
            return Err(PublishingError::new(
                PublishingErrorCode::CacheCleanupFailed,
                "publishingCacheFileUnsafe",
            ));
        }
        fs::remove_file(entry.path())
            .map_err(|error| cache_error("publishingCacheRemove", &error))?;
    }
    Ok(())
}

pub fn remove_artifact(path: &Path, completed_upload: bool) -> PublishingResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(cache_error(
            if completed_upload {
                "publishingCacheRetainedAfterUpload"
            } else {
                "publishingCacheRetainedAfterFailure"
            },
            &error,
        )),
    }
}

fn is_owned_cache_file_name(file_name: &str) -> bool {
    is_package_file_name(file_name)
        || is_application_file_name(file_name)
        || is_staging_file_name(file_name)
}

fn is_package_file_name(file_name: &str) -> bool {
    let Some(identifier) = file_name.strip_suffix(PACKAGE_SUFFIX) else {
        return false;
    };
    identifier.len() == PACKAGE_ID_LENGTH
        && identifier
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
}

fn is_application_file_name(file_name: &str) -> bool {
    let Some(identifier) = file_name.strip_suffix(APPLICATION_SUFFIX) else {
        return false;
    };
    identifier.len() == PACKAGE_ID_LENGTH
        && identifier
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
}
fn is_staging_file_name(file_name: &str) -> bool {
    let Some(rest) = file_name.strip_prefix('.') else {
        return false;
    };
    let Some((artifact_name, staging_id)) = rest.split_once(".rino-staging-") else {
        return false;
    };
    (is_package_file_name(artifact_name) || is_application_file_name(artifact_name))
        && staging_id.len() == PACKAGE_ID_LENGTH
        && staging_id
            .chars()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
}

fn cache_error(stage: &str, error: &io::Error) -> PublishingError {
    PublishingError::from_io(PublishingErrorCode::CacheCleanupFailed, stage, error)
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    metadata.file_attributes() & 0x0000_0400 != 0
}

#[cfg(not(windows))]
const fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_cleanup_removes_only_owned_package_names() {
        let root = std::env::temp_dir().join(format!(
            "rino-publishing-cache-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        assert!(fs::create_dir_all(&root).is_ok());
        let stale = root.join(format!("{}.rino-package", "a".repeat(32)));
        let staging = root.join(format!(
            ".{}.rino-package.rino-staging-{}",
            "b".repeat(32),
            "c".repeat(32)
        ));
        let unrelated = root.join("keep.txt");
        assert!(fs::write(&stale, b"private package").is_ok());
        assert!(fs::write(&staging, b"private staging package").is_ok());
        assert!(fs::write(&unrelated, b"unrelated").is_ok());

        assert!(prepare(&root).is_ok());
        assert!(!stale.exists());
        assert!(!staging.exists());
        assert!(unrelated.exists());
        assert!(fs::remove_dir_all(root).is_ok());
    }

    #[test]
    fn startup_cleanup_rejects_an_owned_name_that_is_not_a_file() {
        let root = std::env::temp_dir().join(format!(
            "rino-publishing-cache-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        assert!(fs::create_dir_all(&root).is_ok());
        let unsafe_entry = root.join(format!("{}.rino-package", "d".repeat(32)));
        assert!(fs::create_dir(&unsafe_entry).is_ok());

        let result = prepare(&root);
        assert!(result.is_err());
        let Err(error) = result else {
            unreachable!("the result was checked above")
        };
        assert_eq!(error.code, PublishingErrorCode::CacheCleanupFailed);
        assert!(unsafe_entry.is_dir());
        assert!(fs::remove_dir_all(root).is_ok());
    }
}
