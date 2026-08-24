//! The on-disk names and limits of the project directory format.
//!
//! Decision Gate D-007 settled the authoring format as a directory: a manifest at the
//! root, one file per graph under `graphs/`, and project-owned binaries under `assets/`.
//! Every path this crate builds is the project root joined with a constant below or with
//! a name that passed one of the predicates below, so a project file can never direct a
//! read or a write at a path the format does not define.

use std::path::{Path, PathBuf};

use super::error::{ProjectError, ProjectErrorCode};

pub const PROJECT_MANIFEST_FILE_NAME: &str = "project.rino.json";
pub const GRAPHS_DIRECTORY_NAME: &str = "graphs";
pub const ASSETS_DIRECTORY_NAME: &str = "assets";
pub const IMAGE_ASSETS_DIRECTORY_NAME: &str = "images";
pub const RECOVERY_DIRECTORY_NAME: &str = "recovery";
pub const RECOVERY_ORIGIN_FILE_NAME: &str = "origin.json";

const GRAPH_FILE_SUFFIX: &str = ".rino.graph.json";
const MAXIMUM_GRAPH_FILE_STEM: usize = 63;
const CONTENT_HASH_LENGTH: usize = 64;
const IMAGE_OBJECT_SUFFIX: &str = ".png";

/// The manifest is small structured metadata; a larger one is a sign of a corrupt or
/// hostile file rather than of a large project, whose weight lives in its graphs.
pub const MAXIMUM_MANIFEST_BYTES: usize = 4 * 1024 * 1024;
/// The graph schema caps a graph at 5,000 nodes and 10,000 edges, which this bound
/// comfortably contains while still refusing a file that could exhaust memory.
pub const MAXIMUM_GRAPH_FILE_BYTES: usize = 16 * 1024 * 1024;
/// Matches the project schema's own limit on graphs.
pub const MAXIMUM_GRAPH_FILES: usize = 64;
/// Matches the project schema's own limit on image assets.
pub const MAXIMUM_ASSET_OBJECTS: usize = 2000;
/// Matches the asset schema's per-image byte limit.
pub const MAXIMUM_ASSET_OBJECT_BYTES: u64 = 256 * 1024 * 1024;

/// Windows resolves a device name before the first dot, so `con.rino.graph.json` opens
/// the console device rather than a file. The names are matched in lowercase because the
/// accepted character set below already excludes every other case.
const RESERVED_DEVICE_STEMS: [&str; 24] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9", "com0", "lpt0",
];

/// Reports whether a name is one the editor is allowed to allocate for a graph file.
///
/// The accepted set is deliberately much narrower than the operating system allows: no
/// separators, no drive letters, no dots beyond the suffix, no uppercase, no reserved
/// device name, and therefore no traversal and no pair of names differing only by case.
#[must_use]
pub fn is_graph_file_name(candidate: &str) -> bool {
    let Some(stem) = candidate.strip_suffix(GRAPH_FILE_SUFFIX) else {
        return false;
    };
    if stem.is_empty() || stem.len() > MAXIMUM_GRAPH_FILE_STEM {
        return false;
    }
    if RESERVED_DEVICE_STEMS.contains(&stem) {
        return false;
    }
    let mut characters = stem.chars();
    let starts_well = characters
        .next()
        .is_some_and(|first| first.is_ascii_lowercase() || first.is_ascii_digit());
    starts_well
        && characters.all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

/// Reports whether a name is a content-addressed image object.
///
/// Objects are named by the lowercase SHA-256 of their bytes, so the name is generated
/// rather than chosen and carries no user text.
#[must_use]
pub fn is_image_object_name(candidate: &str) -> bool {
    let Some(stem) = candidate.strip_suffix(IMAGE_OBJECT_SUFFIX) else {
        return false;
    };
    stem.len() == CONTENT_HASH_LENGTH
        && stem
            .chars()
            .all(|character| character.is_ascii_digit() || matches!(character, 'a'..='f'))
}

#[must_use]
pub fn manifest_path(root: &Path) -> PathBuf {
    root.join(PROJECT_MANIFEST_FILE_NAME)
}

#[must_use]
pub fn graphs_directory(root: &Path) -> PathBuf {
    root.join(GRAPHS_DIRECTORY_NAME)
}

#[must_use]
pub fn image_assets_directory(root: &Path) -> PathBuf {
    root.join(ASSETS_DIRECTORY_NAME)
        .join(IMAGE_ASSETS_DIRECTORY_NAME)
}

/// Resolves one generated image object inside its fixed project directory.
pub fn image_object_path(root: &Path, content_hash: &str) -> Result<PathBuf, Box<ProjectError>> {
    let file_name = format!("{content_hash}{IMAGE_OBJECT_SUFFIX}");
    if !is_image_object_name(&file_name) {
        return Err(ProjectError::boxed(
            ProjectErrorCode::UnsupportedFileName,
            "imageObjectHash",
        ));
    }
    Ok(image_assets_directory(root).join(file_name))
}

/// Resolves one graph file inside a project root, refusing any name the format does not
/// define.
pub fn graph_file_path(root: &Path, file_name: &str) -> Result<PathBuf, Box<ProjectError>> {
    if !is_graph_file_name(file_name) {
        return Err(ProjectError::boxed(
            ProjectErrorCode::UnsupportedFileName,
            "graphFileName",
        ));
    }
    Ok(graphs_directory(root).join(file_name))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::{image_object_path, is_graph_file_name, is_image_object_name};

    #[test]
    fn accepts_only_editor_allocated_graph_file_names() {
        assert!(is_graph_file_name("main.rino.graph.json"));
        assert!(is_graph_file_name("graph-2.rino.graph.json"));

        assert!(!is_graph_file_name(".rino.graph.json"));
        assert!(!is_graph_file_name("Main.rino.graph.json"));
        assert!(!is_graph_file_name("main.json"));
        assert!(!is_graph_file_name("../main.rino.graph.json"));
        assert!(!is_graph_file_name("sub/main.rino.graph.json"));
        assert!(!is_graph_file_name("sub\\main.rino.graph.json"));
        assert!(!is_graph_file_name("con.rino.graph.json"));
        assert!(!is_graph_file_name("main .rino.graph.json"));
        assert!(!is_graph_file_name("图.rino.graph.json"));
        assert!(!is_graph_file_name(&format!(
            "{}.rino.graph.json",
            "a".repeat(64)
        )));
    }

    #[test]
    fn accepts_only_content_addressed_image_objects() {
        assert!(is_image_object_name(&format!("{}.png", "0a".repeat(32))));
        assert!(!is_image_object_name(&format!("{}.png", "0A".repeat(32))));
        assert!(!is_image_object_name("button.png"));
        assert!(!is_image_object_name(&format!("{}.jpg", "0a".repeat(32))));
    }

    #[test]
    fn resolves_only_a_lowercase_sha256_image_object() {
        let hash = "0a".repeat(32);
        assert!(matches!(
            image_object_path(Path::new("project"), &hash),
            Ok(path) if path == Path::new("project/assets/images").join(format!("{hash}.png"))
        ));
        assert!(image_object_path(Path::new("project"), "../capture").is_err());
    }

    #[test]
    fn rejects_every_reserved_device_stem() {
        for stem in ["con", "prn", "aux", "nul", "com1", "lpt9"] {
            assert!(
                !is_graph_file_name(&format!("{stem}.rino.graph.json")),
                "{stem} resolves to a device on Windows and must not name a graph file"
            );
        }
        // A device name is reserved only as the whole stem.
        assert!(is_graph_file_name("con-1.rino.graph.json"));
        assert!(is_graph_file_name("console.rino.graph.json"));
    }
}
