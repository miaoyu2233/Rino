//! Contained project file access.
//!
//! Trusted Rust owns every project path. The frontend chooses a directory through a
//! native dialog and afterwards names only files, never paths, so the reachable set is
//! the manifest, the graph files the format defines, and the content-addressed image
//! objects under `assets/`.
//!
//! Each file is committed by writing a sibling staging file, flushing it to the device,
//! parsing it back, and only then replacing the target. A failure therefore leaves the
//! previous valid file in place. A project spans several files, so the graph files are
//! replaced first and the manifest last: the manifest is the authority for what belongs
//! to the project, and a project interrupted mid-commit stays loadable under its previous
//! manifest rather than pointing at a file that was never written.

use std::{
    collections::HashSet,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{
    error::{ProjectError, ProjectErrorCode},
    layout::{
        self, MAXIMUM_ASSET_OBJECT_BYTES, MAXIMUM_ASSET_OBJECTS, MAXIMUM_GRAPH_FILE_BYTES,
        MAXIMUM_GRAPH_FILES, MAXIMUM_MANIFEST_BYTES, PROJECT_MANIFEST_FILE_NAME,
        RECOVERY_ORIGIN_FILE_NAME,
    },
};

const STAGING_SUFFIX: &str = ".rino-staging";
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
const MAXIMUM_CAPTURE_DIMENSION: u32 = 16_384;

pub type ProjectResult<T> = Result<T, Box<ProjectError>>;

/// One project file named relative to the directory that owns it.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectFile {
    pub file_name: String,
    pub contents: String,
}

/// The complete text of a project, as the editor produced it or as it was read back.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectFileSet {
    pub manifest: String,
    pub graphs: Vec<ProjectFile>,
}

/// Where a project lives, in the two forms the interface needs.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLocation {
    /// The project directory's own name, shown beside the project title.
    pub directory_name: String,
    /// The full path, shown only on request as a tooltip and never logged.
    pub display_path: String,
}

/// A project as it was found on disk, together with any newer unsaved work.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    pub location: ProjectLocation,
    pub files: ProjectFileSet,
    /// Present when the recovery slot holds work for this project that was never saved.
    pub recovery: Option<ProjectFileSet>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageCaptureSourceKind {
    DeviceCapture,
    RegionCapture,
}

/// Safe project metadata returned after capture bytes have been committed.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredImageObject {
    pub content_hash: String,
    pub byte_length: u64,
    pub width: u32,
    pub height: u32,
    pub coordinate_space_id: String,
    pub source_kind: ImageCaptureSourceKind,
}

/// One source PNG that has been revalidated by the native import session and is ready for
/// the atomic new-project transaction. The bytes never travel through the webview.
#[derive(Clone, Debug)]
pub struct ImportedAsset {
    pub content_hash: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoveryOrigin {
    schema_version: u32,
    root_path: String,
}

/// The open project and the location the user has chosen for the next create or save-as.
pub struct ProjectWorkspace {
    root: Option<PathBuf>,
    chosen_location: Option<PathBuf>,
    recovery_root: PathBuf,
}

fn location_of(root: &Path) -> ProjectLocation {
    ProjectLocation {
        directory_name: root
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
        display_path: root.to_string_lossy().into_owned(),
    }
}

fn create_directory(path: &Path, stage: &str) -> ProjectResult<()> {
    fs::create_dir_all(path)
        .map_err(|error| ProjectError::from_io(ProjectErrorCode::CreateFailed, stage, &error))
}

/// Writes one file through a staging sibling and replaces the target only after the
/// staged bytes are on the device and parse as JSON.
fn stage_json_file(target: &Path, contents: &str) -> ProjectResult<PathBuf> {
    let file_name = target.file_name().ok_or_else(|| {
        ProjectError::boxed(ProjectErrorCode::UnsupportedFileName, "stagingTarget")
    })?;
    let mut staged_name = file_name.to_os_string();
    staged_name.push(STAGING_SUFFIX);
    let staged = target.with_file_name(staged_name);

    let mut file = File::create(&staged).map_err(|error| {
        ProjectError::from_io(ProjectErrorCode::WriteFailed, "stageCreate", &error)
    })?;
    file.write_all(contents.as_bytes()).map_err(|error| {
        ProjectError::from_io(ProjectErrorCode::WriteFailed, "stageWrite", &error)
    })?;
    file.flush().map_err(|error| {
        ProjectError::from_io(ProjectErrorCode::WriteFailed, "stageFlush", &error)
    })?;
    file.sync_all().map_err(|error| {
        ProjectError::from_io(ProjectErrorCode::WriteFailed, "stageSync", &error)
    })?;
    drop(file);

    let written = fs::read(&staged).map_err(|error| {
        ProjectError::from_io(ProjectErrorCode::WriteFailed, "stageVerify", &error)
    })?;
    if serde_json::from_slice::<serde_json::Value>(&written).is_err() {
        let _ignored = fs::remove_file(&staged);
        return Err(ProjectError::boxed(
            ProjectErrorCode::InvalidJson,
            "stageParse",
        ));
    }

    Ok(staged)
}

fn stage_binary_file(target: &Path, contents: &[u8]) -> ProjectResult<PathBuf> {
    let file_name = target.file_name().ok_or_else(|| {
        ProjectError::boxed(ProjectErrorCode::UnsupportedFileName, "binaryStagingTarget")
    })?;
    let mut staged_name = file_name.to_os_string();
    staged_name.push(STAGING_SUFFIX);
    let staged = target.with_file_name(staged_name);

    let result = (|| -> ProjectResult<()> {
        let mut file = File::create(&staged).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::WriteFailed, "assetStageCreate", &error)
        })?;
        file.write_all(contents).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::WriteFailed, "assetStageWrite", &error)
        })?;
        file.flush().map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::WriteFailed, "assetStageFlush", &error)
        })?;
        file.sync_all().map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::WriteFailed, "assetStageSync", &error)
        })?;
        drop(file);
        let written = fs::read(&staged).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::WriteFailed, "assetStageVerify", &error)
        })?;
        if written != contents {
            return Err(ProjectError::boxed(
                ProjectErrorCode::WriteFailed,
                "assetStageMismatch",
            ));
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ignored = fs::remove_file(&staged);
        return Err(error);
    }
    Ok(staged)
}

fn discard_staged(staged: &[(PathBuf, PathBuf)]) {
    for (staged_path, _) in staged {
        let _ignored = fs::remove_file(staged_path);
    }
}

fn read_bounded(path: &Path, limit: usize, stage: &str) -> ProjectResult<String> {
    let metadata = fs::metadata(path)
        .map_err(|error| ProjectError::from_io(ProjectErrorCode::ReadFailed, stage, &error))?;
    if metadata.len() > limit as u64 {
        return Err(ProjectError::boxed(ProjectErrorCode::FileTooLarge, stage));
    }
    fs::read_to_string(path)
        .map_err(|error| ProjectError::from_io(ProjectErrorCode::ReadFailed, stage, &error))
}

fn validate_file_set(files: &ProjectFileSet) -> ProjectResult<()> {
    if files.manifest.len() > MAXIMUM_MANIFEST_BYTES {
        return Err(ProjectError::boxed(
            ProjectErrorCode::FileTooLarge,
            PROJECT_MANIFEST_FILE_NAME,
        ));
    }
    if files.graphs.len() > MAXIMUM_GRAPH_FILES {
        return Err(ProjectError::boxed(
            ProjectErrorCode::TooManyFiles,
            "graphs",
        ));
    }
    let mut seen: Vec<&str> = Vec::with_capacity(files.graphs.len());
    for graph in &files.graphs {
        if !layout::is_graph_file_name(&graph.file_name) {
            return Err(ProjectError::boxed(
                ProjectErrorCode::UnsupportedFileName,
                "graphFileName",
            ));
        }
        if seen.contains(&graph.file_name.as_str()) {
            return Err(ProjectError::boxed(
                ProjectErrorCode::UnsupportedFileName,
                "duplicateGraphFileName",
            ));
        }
        seen.push(&graph.file_name);
        if graph.contents.len() > MAXIMUM_GRAPH_FILE_BYTES {
            return Err(ProjectError::boxed(
                ProjectErrorCode::FileTooLarge,
                "graphFile",
            ));
        }
    }
    Ok(())
}

/// Commits a whole project directory, graph files first and the manifest last.
fn commit_file_set(root: &Path, files: &ProjectFileSet) -> ProjectResult<()> {
    validate_file_set(files)?;
    create_directory(&layout::graphs_directory(root), "graphsDirectory")?;

    let mut staged: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(files.graphs.len() + 1);
    for graph in &files.graphs {
        let target = layout::graph_file_path(root, &graph.file_name)?;
        match stage_json_file(&target, &graph.contents) {
            Ok(staged_path) => staged.push((staged_path, target)),
            Err(error) => {
                discard_staged(&staged);
                return Err(error);
            }
        }
    }
    let manifest_target = layout::manifest_path(root);
    match stage_json_file(&manifest_target, &files.manifest) {
        Ok(staged_path) => staged.push((staged_path, manifest_target)),
        Err(error) => {
            discard_staged(&staged);
            return Err(error);
        }
    }

    for (staged_path, target) in &staged {
        fs::rename(staged_path, target).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::WriteFailed, "commitReplace", &error)
        })?;
    }
    Ok(())
}

fn read_file_set(root: &Path) -> ProjectResult<ProjectFileSet> {
    let manifest = read_bounded(
        &layout::manifest_path(root),
        MAXIMUM_MANIFEST_BYTES,
        "manifest",
    )?;
    let referenced = referenced_graph_file_names(&manifest)?;

    let graphs_directory = layout::graphs_directory(root);
    let mut graphs = Vec::new();
    let entries = fs::read_dir(&graphs_directory)
        .map_err(|error| ProjectError::from_io(ProjectErrorCode::ReadFailed, "graphs", &error))?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "graphsEntry", &error)
        })?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !layout::is_graph_file_name(&file_name) {
            // A file the format does not define is left alone rather than read; the
            // manifest decides what belongs to the project.
            continue;
        }
        if !referenced.contains(&file_name) {
            // A validly named file absent from the manifest is stale project data, not a
            // graph the caller may reopen. Cleanup removes it after a committed save.
            continue;
        }
        if graphs.len() >= MAXIMUM_GRAPH_FILES {
            return Err(ProjectError::boxed(
                ProjectErrorCode::TooManyFiles,
                "graphs",
            ));
        }
        let contents = read_bounded(&entry.path(), MAXIMUM_GRAPH_FILE_BYTES, "graphFile")?;
        graphs.push(ProjectFile {
            file_name,
            contents,
        });
    }
    graphs.sort_by(|left, right| left.file_name.cmp(&right.file_name));

    Ok(ProjectFileSet { manifest, graphs })
}

/// Copies the content-addressed image objects of one project into another root.
///
/// Only names the format generates are copied, and both the object count and each
/// object's size are bounded, so a save-as cannot be turned into an unbounded copy of an
/// arbitrary directory by a hand-edited project.
fn copy_image_objects(source_root: &Path, target_root: &Path) -> ProjectResult<()> {
    let source = layout::image_assets_directory(source_root);
    if !source.is_dir() {
        return Ok(());
    }
    let target = layout::image_assets_directory(target_root);
    create_directory(&target, "imageAssetsDirectory")?;

    let entries = fs::read_dir(&source)
        .map_err(|error| ProjectError::from_io(ProjectErrorCode::ReadFailed, "assets", &error))?;
    let mut copied = 0usize;
    for entry in entries {
        let entry = entry.map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "assetsEntry", &error)
        })?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !layout::is_image_object_name(&file_name) {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "assetMetadata", &error)
        })?;
        if !metadata.is_file() || metadata.len() > MAXIMUM_ASSET_OBJECT_BYTES {
            return Err(ProjectError::boxed(
                ProjectErrorCode::FileTooLarge,
                "assetObject",
            ));
        }
        copied += 1;
        if copied > MAXIMUM_ASSET_OBJECTS {
            return Err(ProjectError::boxed(
                ProjectErrorCode::TooManyFiles,
                "assets",
            ));
        }
        fs::copy(entry.path(), target.join(&file_name)).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::WriteFailed, "assetCopy", &error)
        })?;
    }
    Ok(())
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24
        || !bytes.starts_with(PNG_SIGNATURE)
        || bytes.get(8..12) != Some(&[0, 0, 0, 13])
        || bytes.get(12..16) != Some(b"IHDR")
    {
        return None;
    }
    let width = u32::from_be_bytes(bytes.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(bytes.get(20..24)?.try_into().ok()?);
    ((1..=MAXIMUM_CAPTURE_DIMENSION).contains(&width)
        && (1..=MAXIMUM_CAPTURE_DIMENSION).contains(&height))
    .then_some((width, height))
}

fn validate_existing_image_object(target: &Path, contents: &[u8]) -> ProjectResult<bool> {
    let metadata = match fs::symlink_metadata(target) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(ProjectError::from_io(
                ProjectErrorCode::ReadFailed,
                "assetMetadata",
                &error,
            ));
        }
    };
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() != contents.len() as u64
        || metadata.len() > MAXIMUM_ASSET_OBJECT_BYTES
    {
        return Err(ProjectError::boxed(
            ProjectErrorCode::InvalidImage,
            "existingAssetObject",
        ));
    }
    let existing = fs::read(target).map_err(|error| {
        ProjectError::from_io(ProjectErrorCode::ReadFailed, "assetObject", &error)
    })?;
    if existing != contents {
        return Err(ProjectError::boxed(
            ProjectErrorCode::InvalidImage,
            "existingAssetHashMismatch",
        ));
    }
    Ok(true)
}

fn count_image_objects(directory: &Path) -> ProjectResult<usize> {
    let entries = fs::read_dir(directory)
        .map_err(|error| ProjectError::from_io(ProjectErrorCode::ReadFailed, "assets", &error))?;
    let mut count = 0usize;
    for entry in entries {
        let entry = entry.map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "assetsEntry", &error)
        })?;
        if layout::is_image_object_name(&entry.file_name().to_string_lossy()) {
            count = count.saturating_add(1);
        }
    }
    Ok(count)
}

fn referenced_image_hashes(manifest: &str) -> ProjectResult<HashSet<String>> {
    let value: serde_json::Value = serde_json::from_str(manifest)
        .map_err(|_| ProjectError::boxed(ProjectErrorCode::InvalidJson, "manifest"))?;
    let object = value
        .as_object()
        .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::InvalidImage, "manifestShape"))?;
    if object
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return Err(ProjectError::boxed(
            ProjectErrorCode::InvalidImage,
            "manifestVersion",
        ));
    }
    let assets = object
        .get("assets")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::InvalidImage, "manifestAssets"))?;
    if assets.len() > MAXIMUM_ASSET_OBJECTS {
        return Err(ProjectError::boxed(
            ProjectErrorCode::TooManyFiles,
            "manifestAssets",
        ));
    }
    let mut referenced = HashSet::with_capacity(assets.len());
    for asset in assets {
        let hash = asset
            .as_object()
            .and_then(|record| record.get("contentHash"))
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                ProjectError::boxed(ProjectErrorCode::InvalidImage, "assetContentHash")
            })?;
        if layout::image_object_path(Path::new("."), hash).is_err() {
            return Err(ProjectError::boxed(
                ProjectErrorCode::InvalidImage,
                "assetContentHash",
            ));
        }
        referenced.insert(hash.to_owned());
    }
    Ok(referenced)
}

fn referenced_graph_file_names(manifest: &str) -> ProjectResult<HashSet<String>> {
    let value: serde_json::Value = serde_json::from_str(manifest)
        .map_err(|_| ProjectError::boxed(ProjectErrorCode::InvalidJson, "manifest"))?;
    let object = value
        .as_object()
        .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::InvalidJson, "manifestShape"))?;
    if object
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return Err(ProjectError::boxed(
            ProjectErrorCode::InvalidJson,
            "manifestVersion",
        ));
    }
    let graphs = object
        .get("graphs")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::InvalidJson, "manifestGraphs"))?;
    if graphs.len() > MAXIMUM_GRAPH_FILES {
        return Err(ProjectError::boxed(
            ProjectErrorCode::TooManyFiles,
            "manifestGraphs",
        ));
    }

    let mut referenced = HashSet::with_capacity(graphs.len());
    for graph in graphs {
        let record = graph
            .as_object()
            .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::InvalidJson, "manifestGraph"))?;
        if record
            .get("graphId")
            .and_then(serde_json::Value::as_str)
            .is_none()
        {
            return Err(ProjectError::boxed(
                ProjectErrorCode::InvalidJson,
                "manifestGraphId",
            ));
        }
        let file_name = record
            .get("fileName")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| {
                ProjectError::boxed(ProjectErrorCode::InvalidJson, "manifestGraphFileName")
            })?;
        if !layout::is_graph_file_name(file_name) {
            return Err(ProjectError::boxed(
                ProjectErrorCode::UnsupportedFileName,
                "graphFileName",
            ));
        }
        if !referenced.insert(file_name.to_owned()) {
            return Err(ProjectError::boxed(
                ProjectErrorCode::UnsupportedFileName,
                "duplicateGraphFileName",
            ));
        }
    }
    Ok(referenced)
}

fn cleanup_orphan_graph_files(root: &Path, manifest: &str) -> ProjectResult<usize> {
    let referenced = referenced_graph_file_names(manifest)?;
    let directory = layout::graphs_directory(root);
    if !directory.is_dir() {
        return Ok(0);
    }
    let entries = fs::read_dir(&directory)
        .map_err(|error| ProjectError::from_io(ProjectErrorCode::ReadFailed, "graphs", &error))?;
    let mut inspected = 0usize;
    let mut removed = 0usize;
    for entry in entries {
        let entry = entry.map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "graphsEntry", &error)
        })?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !layout::is_graph_file_name(&file_name) {
            continue;
        }
        inspected = inspected.saturating_add(1);
        if inspected > MAXIMUM_GRAPH_FILES {
            return Err(ProjectError::boxed(
                ProjectErrorCode::TooManyFiles,
                "graphs",
            ));
        }
        let file_type = entry.file_type().map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "graphType", &error)
        })?;
        if file_type.is_file() && !referenced.contains(&file_name) {
            fs::remove_file(entry.path()).map_err(|error| {
                ProjectError::from_io(ProjectErrorCode::WriteFailed, "orphanGraph", &error)
            })?;
            removed = removed.saturating_add(1);
        }
    }
    Ok(removed)
}

fn canonical_empty_import_target(target: &Path) -> ProjectResult<PathBuf> {
    let metadata = fs::symlink_metadata(target).map_err(|error| {
        ProjectError::from_io(
            ProjectErrorCode::CreateFailed,
            "importTargetMetadata",
            &error,
        )
    })?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_dir() {
        return Err(ProjectError::boxed(
            ProjectErrorCode::CreateFailed,
            "importTargetUnsafe",
        ));
    }
    let mut entries = fs::read_dir(target).map_err(|error| {
        ProjectError::from_io(ProjectErrorCode::ReadFailed, "importTargetRead", &error)
    })?;
    if entries.next().is_some() {
        return Err(ProjectError::boxed(
            ProjectErrorCode::LocationNotEmpty,
            "importTargetNotEmpty",
        ));
    }
    fs::canonicalize(target).map_err(|error| {
        ProjectError::from_io(
            ProjectErrorCode::ReadFailed,
            "importTargetCanonicalize",
            &error,
        )
    })
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

impl ProjectWorkspace {
    #[must_use]
    pub const fn new(recovery_root: PathBuf) -> Self {
        Self {
            root: None,
            chosen_location: None,
            recovery_root,
        }
    }

    /// Reads a validated, bounded snapshot of the currently open project's committed files.
    ///
    /// Publishing deliberately uses committed bytes. The frontend saves first, then the
    /// exporter reads the exact manifest and graphs that a recipient will later validate.
    ///
    /// # Errors
    ///
    /// Returns a structured error when no project is open or committed files are invalid.
    pub fn read_current_files(&self) -> ProjectResult<ProjectFileSet> {
        let root = self
            .root
            .as_deref()
            .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::NoOpenProject, "publish"))?;
        read_file_set(root)
    }

    #[must_use]
    pub fn open_location(&self) -> Option<ProjectLocation> {
        self.root.as_deref().map(location_of)
    }

    /// Remembers a directory the user chose for the next create or save-as.
    ///
    /// The directory is checked here rather than at commit time so the user learns
    /// immediately that a folder is unusable, while it is still obvious which folder they
    /// picked.
    ///
    /// # Errors
    ///
    /// Returns a structured error when the directory cannot be read, already holds a
    /// project, or holds unrelated files.
    pub fn choose_location(&mut self, directory: &Path) -> ProjectResult<ProjectLocation> {
        if layout::manifest_path(directory).exists() {
            return Err(ProjectError::boxed(
                ProjectErrorCode::LocationAlreadyHoldsProject,
                "chooseLocation",
            ));
        }
        let mut entries = fs::read_dir(directory).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "chooseLocation", &error)
        })?;
        if entries.next().is_some() {
            return Err(ProjectError::boxed(
                ProjectErrorCode::LocationNotEmpty,
                "chooseLocation",
            ));
        }
        // Every stored root is canonical, so the recovery slot's origin and a later open
        // of the same directory compare as the same path rather than as two spellings.
        let directory = fs::canonicalize(directory).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "chooseLocation", &error)
        })?;
        let location = location_of(&directory);
        self.chosen_location = Some(directory);
        Ok(location)
    }

    fn take_chosen_location(&mut self) -> ProjectResult<PathBuf> {
        self.chosen_location
            .take()
            .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::NoChosenLocation, "location"))
    }

    /// Creates the directory layout of a new project and writes its first files.
    ///
    /// # Errors
    ///
    /// Returns a structured error when no location was chosen or a file cannot be
    /// committed.
    pub fn create(&mut self, files: &ProjectFileSet) -> ProjectResult<ProjectLocation> {
        let root = self.take_chosen_location()?;
        create_directory(&layout::graphs_directory(&root), "graphsDirectory")?;
        create_directory(&layout::image_assets_directory(&root), "assetsDirectory")?;
        commit_file_set(&root, files)?;
        self.discard_recovery();
        let location = location_of(&root);
        self.root = Some(root);
        Ok(location)
    }

    /// Atomically creates a new project from a native import session.
    ///
    /// The selected target is required to be an existing empty directory. A complete
    /// project is first written to a sibling staging directory, then the empty target is
    /// moved aside and the staging directory is renamed into its place. If either rename
    /// fails, the original empty directory is restored and the staging tree is removed.
    /// The source directory is never involved in this transaction.
    ///
    /// # Errors
    ///
    /// Returns a structured error when the target is not an existing empty directory, an
    /// imported file is invalid, or the staged project cannot be atomically swapped in.
    pub fn import_new(
        &mut self,
        target: &Path,
        files: &ProjectFileSet,
        assets: &[ImportedAsset],
    ) -> ProjectResult<OpenedProject> {
        let root = canonical_empty_import_target(target)?;
        validate_file_set(files)?;
        if assets.len() > MAXIMUM_ASSET_OBJECTS {
            return Err(ProjectError::boxed(
                ProjectErrorCode::TooManyFiles,
                "importAssets",
            ));
        }

        let suffix = Uuid::new_v4().simple().to_string();
        let directory_name = root
            .file_name()
            .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::CreateFailed, "importTarget"))?
            .to_string_lossy();
        let staging =
            root.with_file_name(format!(".{directory_name}.rino-import-staging-{suffix}"));
        let backup = root.with_file_name(format!(".{directory_name}.rino-import-backup-{suffix}"));

        let result = (|| -> ProjectResult<OpenedProject> {
            create_directory(&layout::graphs_directory(&staging), "importGraphsDirectory")?;
            create_directory(
                &layout::image_assets_directory(&staging),
                "importAssetsDirectory",
            )?;

            let mut seen_hashes = HashSet::with_capacity(assets.len());
            let mut staged_assets: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(assets.len());
            for asset in assets {
                if asset.bytes.is_empty()
                    || asset.bytes.len() as u64 > MAXIMUM_ASSET_OBJECT_BYTES
                    || format!("{:x}", Sha256::digest(&asset.bytes)) != asset.content_hash
                    || png_dimensions(&asset.bytes).is_none()
                    || !seen_hashes.insert(asset.content_hash.as_str())
                {
                    return Err(ProjectError::boxed(
                        ProjectErrorCode::InvalidImage,
                        "importAsset",
                    ));
                }
                let target = layout::image_object_path(&staging, &asset.content_hash)?;
                let staged = stage_binary_file(&target, &asset.bytes)?;
                staged_assets.push((staged, target));
            }
            commit_file_set(&staging, files)?;
            let committed_files = read_file_set(&staging)?;
            for (staged, target) in &staged_assets {
                fs::rename(staged, target).map_err(|error| {
                    ProjectError::from_io(
                        ProjectErrorCode::WriteFailed,
                        "importAssetCommit",
                        &error,
                    )
                })?;
            }

            fs::rename(&root, &backup).map_err(|error| {
                ProjectError::from_io(ProjectErrorCode::WriteFailed, "importTargetMove", &error)
            })?;
            if let Err(error) = fs::rename(&staging, &root) {
                let _ignored = fs::rename(&backup, &root);
                return Err(ProjectError::from_io(
                    ProjectErrorCode::WriteFailed,
                    "importProjectMove",
                    &error,
                ));
            }
            let _ignored = fs::remove_dir_all(&backup);

            let location = location_of(&root);
            self.discard_recovery();
            self.root = Some(root.clone());
            Ok(OpenedProject {
                location,
                files: committed_files,
                recovery: None,
            })
        })();

        if result.is_err() {
            let _ignored = fs::remove_dir_all(&staging);
            let _ignored = fs::remove_dir_all(&backup);
        }
        result
    }

    /// Opens the project owning one selected manifest file.
    ///
    /// # Errors
    ///
    /// Returns a structured error when the selection is not a project manifest or the
    /// project directory cannot be read.
    pub fn open(&mut self, manifest_path: &Path) -> ProjectResult<OpenedProject> {
        if manifest_path.file_name().and_then(|name| name.to_str())
            != Some(PROJECT_MANIFEST_FILE_NAME)
        {
            return Err(ProjectError::boxed(
                ProjectErrorCode::NotAProjectManifest,
                "open",
            ));
        }
        let root = manifest_path
            .parent()
            .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::NotAProjectManifest, "openRoot"))?
            .to_path_buf();
        // The canonical form is what every later path is joined onto, so a link or a
        // relative component in the selection cannot survive into a write.
        let root = fs::canonicalize(&root).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "openRoot", &error)
        })?;

        let files = read_file_set(&root)?;
        let recovery = self.read_recovery_for(&root);
        let location = location_of(&root);
        self.root = Some(root);
        Ok(OpenedProject {
            location,
            files,
            recovery,
        })
    }

    /// Rewrites the open project in place.
    ///
    /// # Errors
    ///
    /// Returns a structured error when no project is open or a file cannot be committed.
    pub fn save(&self, files: &ProjectFileSet) -> ProjectResult<ProjectLocation> {
        let root = self
            .root
            .as_deref()
            .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::NoOpenProject, "save"))?;
        commit_file_set(root, files)?;
        Ok(location_of(root))
    }

    /// Commits one verified PNG capture as an immutable content-addressed image object.
    ///
    /// # Errors
    ///
    /// Returns a structured error when no project is open, the bytes disagree with their
    /// registered metadata, an object collision is detected, or the write cannot commit.
    pub fn store_capture(
        &self,
        contents: &[u8],
        width: u32,
        height: u32,
        coordinate_space_id: &str,
        source_kind: ImageCaptureSourceKind,
    ) -> ProjectResult<StoredImageObject> {
        let root = self
            .root
            .as_deref()
            .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::NoOpenProject, "storeCapture"))?;
        if contents.is_empty()
            || contents.len() as u64 > MAXIMUM_ASSET_OBJECT_BYTES
            || png_dimensions(contents) != Some((width, height))
            || coordinate_space_id.is_empty()
            || coordinate_space_id.chars().count() > 128
            || coordinate_space_id.chars().any(char::is_control)
        {
            return Err(ProjectError::boxed(
                ProjectErrorCode::InvalidImage,
                "captureMetadata",
            ));
        }

        let content_hash = format!("{:x}", Sha256::digest(contents));
        let target = layout::image_object_path(root, &content_hash)?;
        if !validate_existing_image_object(&target, contents)? {
            let directory = layout::image_assets_directory(root);
            create_directory(&directory, "imageAssetsDirectory")?;
            if count_image_objects(&directory)? >= MAXIMUM_ASSET_OBJECTS {
                return Err(ProjectError::boxed(
                    ProjectErrorCode::TooManyFiles,
                    "assets",
                ));
            }
            let staged = stage_binary_file(&target, contents)?;
            if let Err(error) = fs::rename(&staged, &target) {
                let _ignored = fs::remove_file(&staged);
                return Err(ProjectError::from_io(
                    ProjectErrorCode::WriteFailed,
                    "assetCommit",
                    &error,
                ));
            }
        }
        Ok(StoredImageObject {
            content_hash,
            byte_length: contents.len() as u64,
            width,
            height,
            coordinate_space_id: coordinate_space_id.to_owned(),
            source_kind,
        })
    }

    /// Reads one content-addressed project image after checking its fixed path, size, and
    /// hash. The caller receives bytes only; the private project root never crosses the
    /// native command boundary.
    ///
    /// # Errors
    ///
    /// Returns a structured error when no project is open, the declared length is outside
    /// the project limit, the fixed image object cannot be read, or its length or hash no
    /// longer matches the manifest record.
    pub fn read_image_object(
        &self,
        content_hash: &str,
        expected_byte_length: u64,
    ) -> ProjectResult<Vec<u8>> {
        let root = self.root.as_deref().ok_or_else(|| {
            ProjectError::boxed(ProjectErrorCode::NoOpenProject, "readImageObject")
        })?;
        if expected_byte_length == 0 || expected_byte_length > 64 * 1024 * 1024 {
            return Err(ProjectError::boxed(
                ProjectErrorCode::FileTooLarge,
                "runAsset",
            ));
        }
        let path = layout::image_object_path(root, content_hash)?;
        let metadata = fs::metadata(&path).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "runAssetMetadata", &error)
        })?;
        if metadata.len() != expected_byte_length {
            return Err(ProjectError::boxed(
                ProjectErrorCode::InvalidImage,
                "runAssetLength",
            ));
        }
        let bytes = fs::read(&path).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "runAssetRead", &error)
        })?;
        if format!("{:x}", Sha256::digest(&bytes)) != content_hash {
            return Err(ProjectError::boxed(
                ProjectErrorCode::InvalidImage,
                "runAssetHash",
            ));
        }
        Ok(bytes)
    }

    /// Removes immutable image objects no longer referenced by the committed manifest.
    ///
    /// This is an explicit post-save maintenance operation. It never runs before a
    /// manifest commit, so a capture retained for a failed save remains available.
    ///
    /// # Errors
    ///
    /// Returns a structured error when no project is open, the committed manifest cannot
    /// be validated conservatively, or an orphan cannot be removed.
    pub fn cleanup_orphan_assets(&self) -> ProjectResult<usize> {
        let root = self.root.as_deref().ok_or_else(|| {
            ProjectError::boxed(ProjectErrorCode::NoOpenProject, "cleanupOrphanAssets")
        })?;
        let manifest = read_bounded(
            &layout::manifest_path(root),
            MAXIMUM_MANIFEST_BYTES,
            "manifest",
        )?;
        let referenced = referenced_image_hashes(&manifest)?;
        let directory = layout::image_assets_directory(root);
        if !directory.is_dir() {
            return Ok(0);
        }
        let entries = fs::read_dir(&directory).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::ReadFailed, "assets", &error)
        })?;
        let mut inspected = 0usize;
        let mut removed = 0usize;
        for entry in entries {
            let entry = entry.map_err(|error| {
                ProjectError::from_io(ProjectErrorCode::ReadFailed, "assetsEntry", &error)
            })?;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if !layout::is_image_object_name(&file_name) {
                continue;
            }
            inspected = inspected.saturating_add(1);
            if inspected > MAXIMUM_ASSET_OBJECTS {
                return Err(ProjectError::boxed(
                    ProjectErrorCode::TooManyFiles,
                    "assets",
                ));
            }
            let file_type = entry.file_type().map_err(|error| {
                ProjectError::from_io(ProjectErrorCode::ReadFailed, "assetType", &error)
            })?;
            let Some(hash) = file_name.strip_suffix(".png") else {
                continue;
            };
            if file_type.is_file() && !referenced.contains(hash) {
                fs::remove_file(entry.path()).map_err(|error| {
                    ProjectError::from_io(ProjectErrorCode::WriteFailed, "orphanAsset", &error)
                })?;
                removed = removed.saturating_add(1);
            }
        }
        Ok(removed)
    }

    /// Removes graph files no longer referenced by the committed manifest.
    ///
    /// This is an explicit post-save maintenance operation. The manifest is parsed and
    /// validated before any directory entry can be removed, and only regular files with
    /// names generated by the project format are eligible.
    ///
    /// # Errors
    ///
    /// Returns a structured error when no project is open, the committed manifest cannot
    /// be used conservatively, or an orphan cannot be removed.
    pub fn cleanup_orphan_graphs(&self) -> ProjectResult<usize> {
        let root = self.root.as_deref().ok_or_else(|| {
            ProjectError::boxed(ProjectErrorCode::NoOpenProject, "cleanupOrphanGraphs")
        })?;
        let manifest = read_bounded(
            &layout::manifest_path(root),
            MAXIMUM_MANIFEST_BYTES,
            "manifest",
        )?;
        cleanup_orphan_graph_files(root, &manifest)
    }

    /// Writes the open project into a newly chosen directory and follows it there.
    ///
    /// # Errors
    ///
    /// Returns a structured error when no location was chosen, the previous project's
    /// assets cannot be copied, or a file cannot be committed.
    pub fn save_as(&mut self, files: &ProjectFileSet) -> ProjectResult<ProjectLocation> {
        let target = self.take_chosen_location()?;
        create_directory(&layout::graphs_directory(&target), "graphsDirectory")?;
        create_directory(&layout::image_assets_directory(&target), "assetsDirectory")?;
        if let Some(source) = self.root.as_deref() {
            copy_image_objects(source, &target)?;
        }
        commit_file_set(&target, files)?;
        self.discard_recovery();
        let location = location_of(&target);
        self.root = Some(target);
        Ok(location)
    }

    pub fn close(&mut self) {
        self.root = None;
        self.chosen_location = None;
        self.discard_recovery();
    }

    /// Writes unsaved work to the application-owned recovery slot.
    ///
    /// The slot lives in application data rather than in the project directory, because
    /// the project directory is what the user publishes and an autosave is not part of it.
    ///
    /// # Errors
    ///
    /// Returns a structured error when no project is open or the slot cannot be written.
    pub fn write_autosave(&self, files: &ProjectFileSet) -> ProjectResult<()> {
        let root = self
            .root
            .as_deref()
            .ok_or_else(|| ProjectError::boxed(ProjectErrorCode::NoOpenProject, "autosave"))?;
        create_directory(&self.recovery_root, "recoveryDirectory")?;
        commit_file_set(&self.recovery_root, files)?;
        cleanup_orphan_graph_files(&self.recovery_root, &files.manifest)?;

        let origin = RecoveryOrigin {
            schema_version: 1,
            root_path: root.to_string_lossy().into_owned(),
        };
        let encoded = serde_json::to_string(&origin)
            .map_err(|_| ProjectError::boxed(ProjectErrorCode::InvalidJson, "recoveryOrigin"))?;
        let target = self.recovery_root.join(RECOVERY_ORIGIN_FILE_NAME);
        let staged = stage_json_file(&target, &encoded)?;
        fs::rename(&staged, &target).map_err(|error| {
            ProjectError::from_io(ProjectErrorCode::WriteFailed, "recoveryOrigin", &error)
        })
    }

    /// Removes the recovery slot, which is what accepting or refusing recovery does.
    pub fn discard_recovery(&self) {
        let _ignored = fs::remove_dir_all(&self.recovery_root);
    }

    /// Returns the recovery slot only when it belongs to the project being opened.
    fn read_recovery_for(&self, root: &Path) -> Option<ProjectFileSet> {
        let origin_text =
            fs::read_to_string(self.recovery_root.join(RECOVERY_ORIGIN_FILE_NAME)).ok()?;
        let origin: RecoveryOrigin = serde_json::from_str(&origin_text).ok()?;
        if origin.schema_version != 1 || Path::new(&origin.root_path) != root {
            return None;
        }
        read_file_set(&self.recovery_root).ok()
    }
}
