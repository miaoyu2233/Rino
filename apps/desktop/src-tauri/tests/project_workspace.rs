//! Contained project file access: layout, atomic commit, scope, and recovery.

//! Test assertions panic by design, so the workspace lints that forbid that in production
//! code are relaxed for this integration test.
#![allow(
    clippy::expect_used,
    clippy::panic,
    reason = "an integration test reports failures by panicking"
)]

use std::{error::Error, fs, path::PathBuf};

use sha2::{Digest, Sha256};

use rino_desktop_lib::project::{
    ImageCaptureSourceKind, ImportedAsset, ProjectErrorCode, ProjectFile, ProjectFileSet,
    ProjectWorkspace,
};

struct TemporaryRoot {
    path: PathBuf,
}

impl TemporaryRoot {
    fn create(label: &str) -> Result<Self, Box<dyn Error>> {
        let path = std::env::temp_dir().join(format!(
            "rino-project-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&path)?;
        Ok(Self { path })
    }

    fn child(&self, name: &str) -> Result<PathBuf, Box<dyn Error>> {
        let path = self.path.join(name);
        fs::create_dir_all(&path)?;
        Ok(path)
    }
}

impl Drop for TemporaryRoot {
    fn drop(&mut self) {
        let _ignored = fs::remove_dir_all(&self.path);
    }
}

fn manifest_text(name: &str) -> String {
    format!(
        r#"{{"schemaVersion":1,"documentId":"0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9","name":"{name}","graphs":[{{"graphId":"1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea","fileName":"main.rino.graph.json"}}]}}"#
    )
}

fn file_set(name: &str) -> ProjectFileSet {
    ProjectFileSet {
        manifest: manifest_text(name),
        graphs: vec![ProjectFile {
            file_name: "main.rino.graph.json".to_owned(),
            contents: r#"{"schemaVersion":1,"graph":"entry"}"#.to_owned(),
        }],
    }
}

fn workspace(temporary: &TemporaryRoot) -> Result<ProjectWorkspace, Box<dyn Error>> {
    Ok(ProjectWorkspace::new(temporary.child("recovery-slot")?))
}

fn png_header(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes
}

fn imported_file_set(asset_hash: &str) -> ProjectFileSet {
    ProjectFileSet {
        manifest: format!(
            r#"{{"schemaVersion":1,"documentId":"0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9","metadata":{{"name":"Imported","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}},"entryGraphId":"1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea","graphs":[{{"graphId":"1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea","fileName":"graph-0.rino.graph.json"}}],"assets":[{{"assetId":"2b2c3d4e-5f60-4172-8384-95a6b7c8d9eb","displayName":"button.png","contentHash":"{asset_hash}","mediaType":"image/png","byteLength":24,"coordinateSpace":{{"spaceId":"pipeline-screen","width":1,"height":1}},"sourceKind":"imported","createdAt":"2026-01-01T00:00:00Z"}}],"requiredCapabilities":[]}}"#
        ),
        graphs: vec![ProjectFile {
            file_name: "graph-0.rino.graph.json".to_owned(),
            contents: r#"{"schemaVersion":1,"documentId":"0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9","graph":{"graphId":"1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea","name":"Imported","kind":"entry","nodes":[],"edges":[]}}"#.to_owned(),
        }],
    }
}

#[test]
fn imported_project_is_swapped_atomically_and_source_bytes_stay_native()
-> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("import-atomic")?;
    let target = temporary.child("imported")?;
    let source = temporary.child("source")?;
    let source_file = source.join("source.json");
    fs::write(&source_file, b"source remains untouched")?;
    let bytes = png_header(1, 1);
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let files = imported_file_set(&hash);
    let mut open = workspace(&temporary)?;

    let opened = open.import_new(
        &target,
        &files,
        &[ImportedAsset {
            content_hash: hash.clone(),
            bytes: bytes.clone(),
        }],
    )?;

    assert_eq!(opened.files.graphs.len(), 1);
    assert_eq!(fs::read(&source_file)?, b"source remains untouched");
    assert_eq!(
        fs::read(target.join("assets/images").join(format!("{hash}.png")))?,
        bytes
    );
    assert_eq!(
        fs::read_dir(&temporary.path)?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("rino-import"))
            .count(),
        0
    );
    Ok(())
}

#[test]
fn failed_import_removes_staging_without_touching_empty_target() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("import-rollback")?;
    let target = temporary.child("imported")?;
    let mut open = workspace(&temporary)?;
    let bytes = png_header(1, 1);
    let error = open
        .import_new(
            &target,
            &imported_file_set(&"a".repeat(64)),
            &[ImportedAsset {
                content_hash: "a".repeat(64),
                bytes,
            }],
        )
        .expect_err("hash mismatch must roll back");

    assert_eq!(error.code, ProjectErrorCode::InvalidImage);
    assert_eq!(fs::read_dir(&target)?.count(), 0);
    assert_eq!(
        fs::read_dir(&temporary.path)?
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("rino-import"))
            .count(),
        0
    );
    Ok(())
}

#[test]
fn a_created_project_reopens_with_the_files_it_wrote() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("create")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;

    open.choose_location(&root)?;
    let location = open.create(&file_set("first"))?;
    assert_eq!(location.directory_name, "project");
    assert!(root.join("graphs/main.rino.graph.json").is_file());
    assert!(root.join("assets/images").is_dir());

    let reopened = open.open(&root.join("project.rino.json"))?;
    assert_eq!(reopened.files.manifest, manifest_text("first"));
    assert_eq!(reopened.files.graphs.len(), 1);
    assert!(reopened.recovery.is_none());

    Ok(())
}

#[test]
fn a_capture_is_committed_once_as_a_content_addressed_image() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("capture-object")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;
    let bytes = png_header(300, 400);

    let first = open.store_capture(
        &bytes,
        300,
        400,
        "capture-space",
        ImageCaptureSourceKind::RegionCapture,
    )?;
    let second = open.store_capture(
        &bytes,
        300,
        400,
        "capture-space",
        ImageCaptureSourceKind::RegionCapture,
    )?;

    assert_eq!(first.content_hash, second.content_hash);
    assert_eq!(first.content_hash.len(), 64);
    assert_eq!(first.byte_length, bytes.len() as u64);
    assert_eq!((first.width, first.height), (300, 400));
    assert_eq!(first.source_kind, ImageCaptureSourceKind::RegionCapture);
    let object = root
        .join("assets/images")
        .join(format!("{}.png", first.content_hash));
    assert_eq!(fs::read(object)?, bytes);
    assert_eq!(
        open.read_image_object(&first.content_hash, first.byte_length)?,
        bytes
    );
    let wrong_length = open
        .read_image_object(&first.content_hash, first.byte_length + 1)
        .expect_err("a mismatched declared length must be rejected");
    assert_eq!(wrong_length.code, ProjectErrorCode::InvalidImage);
    assert_eq!(fs::read_dir(root.join("assets/images"))?.count(), 1);

    Ok(())
}

#[test]
fn inconsistent_capture_metadata_is_rejected_without_a_staging_file() -> Result<(), Box<dyn Error>>
{
    let temporary = TemporaryRoot::create("capture-invalid")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;

    let error = open
        .store_capture(
            &png_header(300, 400),
            301,
            400,
            "capture-space",
            ImageCaptureSourceKind::DeviceCapture,
        )
        .expect_err("mismatched dimensions must be refused");
    assert_eq!(error.code, ProjectErrorCode::InvalidImage);
    assert_eq!(fs::read_dir(root.join("assets/images"))?.count(), 0);

    Ok(())
}

#[test]
fn orphan_cleanup_uses_only_the_committed_manifest_as_authority() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("capture-cleanup")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;
    let orphan = open.store_capture(
        &png_header(2, 3),
        2,
        3,
        "capture-space",
        ImageCaptureSourceKind::DeviceCapture,
    )?;
    let mut committed = file_set("without-orphan");
    committed.manifest = r#"{"schemaVersion":1,"assets":[]}"#.to_owned();
    open.save(&committed)?;
    let unrelated = root.join("assets/images/notes.txt");
    fs::write(&unrelated, "keep")?;

    assert_eq!(open.cleanup_orphan_assets()?, 1);
    assert!(
        !root
            .join("assets/images")
            .join(format!("{}.png", orphan.content_hash))
            .exists()
    );
    assert!(unrelated.exists());

    Ok(())
}

#[test]
fn graph_orphan_cleanup_removes_only_unreferenced_regular_graph_files() -> Result<(), Box<dyn Error>>
{
    let temporary = TemporaryRoot::create("graph-cleanup")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;

    let orphan = root.join("graphs/graph-2.rino.graph.json");
    fs::write(&orphan, r#"{"schemaVersion":1,"graph":"stale"}"#)?;
    fs::create_dir(root.join("graphs/graph-3.rino.graph.json"))?;
    fs::write(root.join("graphs/notes.txt"), "keep")?;

    assert_eq!(open.cleanup_orphan_graphs()?, 1);
    assert!(!orphan.exists());
    assert!(root.join("graphs/graph-3.rino.graph.json").is_dir());
    assert!(root.join("graphs/notes.txt").is_file());
    assert!(root.join("graphs/main.rino.graph.json").is_file());

    Ok(())
}

#[test]
fn graph_orphan_cleanup_deletes_nothing_when_manifest_is_unsafe() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("graph-cleanup-invalid")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;
    let orphan = root.join("graphs/graph-2.rino.graph.json");
    fs::write(&orphan, "stale")?;
    fs::write(
        root.join("project.rino.json"),
        r#"{"schemaVersion":1,"graphs":"bad"}"#,
    )?;

    let error = open
        .cleanup_orphan_graphs()
        .expect_err("unsafe manifest must block cleanup");
    assert_eq!(error.code, ProjectErrorCode::InvalidJson);
    assert!(orphan.exists());

    Ok(())
}

#[test]
fn a_directory_that_already_holds_a_project_is_refused() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("occupied")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;

    open.choose_location(&root)?;
    open.create(&file_set("first"))?;

    let error = open
        .choose_location(&root)
        .expect_err("a directory holding a project must be refused");
    assert_eq!(error.code, ProjectErrorCode::LocationAlreadyHoldsProject);

    Ok(())
}

#[test]
fn a_directory_holding_unrelated_files_is_refused() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("not-empty")?;
    let root = temporary.child("project")?;
    fs::write(root.join("notes.txt"), "user content")?;
    let mut open = workspace(&temporary)?;

    let error = open
        .choose_location(&root)
        .expect_err("a non-empty directory must be refused");
    assert_eq!(error.code, ProjectErrorCode::LocationNotEmpty);
    assert!(root.join("notes.txt").is_file());

    Ok(())
}

#[test]
fn a_graph_file_name_outside_the_format_is_refused_before_anything_is_written()
-> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("scope")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;

    for escape in [
        "../escape.rino.graph.json",
        "sub/main.rino.graph.json",
        "..\\escape.rino.graph.json",
        "con.rino.graph.json",
        "Main.rino.graph.json",
        "main.json",
    ] {
        let mut attempt = file_set("second");
        attempt.graphs[0].file_name = escape.to_owned();
        let error = open
            .save(&attempt)
            .expect_err("a name outside the format must be refused");
        assert_eq!(
            error.code,
            ProjectErrorCode::UnsupportedFileName,
            "{escape}"
        );
    }

    // Nothing above reached the disk: the project still holds its first manifest.
    assert_eq!(
        fs::read_to_string(root.join("project.rino.json"))?,
        manifest_text("first")
    );
    assert!(!temporary.path.join("escape.rino.graph.json").exists());

    Ok(())
}

#[test]
fn a_rejected_commit_keeps_the_previous_files() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("atomic")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;

    let mut broken = file_set("second");
    broken.manifest = "{ not json".to_owned();
    let error = open
        .save(&broken)
        .expect_err("content that is not JSON must not be committed");
    assert_eq!(error.code, ProjectErrorCode::InvalidJson);

    assert_eq!(
        fs::read_to_string(root.join("project.rino.json"))?,
        manifest_text("first")
    );
    // No staging file survives a rejected commit.
    let leftovers: Vec<_> = fs::read_dir(&root)?
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains("rino-staging"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");

    Ok(())
}

#[test]
fn a_file_the_format_does_not_define_is_left_alone_on_read() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("foreign")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;
    fs::write(root.join("graphs/notes.md"), "user content")?;

    let reopened = open.open(&root.join("project.rino.json"))?;

    assert_eq!(reopened.files.graphs.len(), 1);
    assert!(root.join("graphs/notes.md").is_file());

    Ok(())
}

#[test]
fn only_a_project_manifest_selects_a_project() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("selection")?;
    let root = temporary.child("project")?;
    fs::write(root.join("other.json"), "{}")?;
    let mut open = workspace(&temporary)?;

    let error = open
        .open(&root.join("other.json"))
        .expect_err("only the manifest selects a project");
    assert_eq!(error.code, ProjectErrorCode::NotAProjectManifest);

    Ok(())
}

#[test]
fn the_recovery_slot_is_offered_only_to_the_project_it_belongs_to() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("recovery")?;
    let root = temporary.child("project")?;
    let other = temporary.child("other")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;

    open.write_autosave(&file_set("unsaved"))?;
    let reopened = open.open(&root.join("project.rino.json"))?;
    let recovery = reopened.recovery.expect("the slot belongs to this project");
    assert_eq!(recovery.manifest, manifest_text("unsaved"));

    // The project directory itself never receives the autosave.
    assert_eq!(
        fs::read_to_string(root.join("project.rino.json"))?,
        manifest_text("first")
    );

    open.choose_location(&other)?;
    open.create(&file_set("elsewhere"))?;
    let other_project = open.open(&other.join("project.rino.json"))?;
    assert!(other_project.recovery.is_none());

    Ok(())
}

#[test]
fn recovery_read_ignores_a_stale_graph_file_absent_from_its_manifest() -> Result<(), Box<dyn Error>>
{
    let temporary = TemporaryRoot::create("recovery-stale-graph")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;
    open.write_autosave(&file_set("unsaved"))?;

    let stale = temporary
        .path
        .join("recovery-slot/graphs/graph-2.rino.graph.json");
    fs::write(&stale, "stale")?;

    let reopened = open.open(&root.join("project.rino.json"))?;
    let recovery = reopened.recovery.expect("recovery should be available");
    assert_eq!(recovery.graphs.len(), 1);
    assert_eq!(recovery.graphs[0].file_name, "main.rino.graph.json");

    Ok(())
}

#[test]
fn discarding_recovery_removes_the_slot() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("discard")?;
    let root = temporary.child("project")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;
    open.write_autosave(&file_set("unsaved"))?;

    open.discard_recovery();

    let reopened = open.open(&root.join("project.rino.json"))?;
    assert!(reopened.recovery.is_none());

    Ok(())
}

#[test]
fn save_as_follows_the_project_and_carries_its_image_objects() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("save-as")?;
    let root = temporary.child("project")?;
    let target = temporary.child("copy")?;
    let mut open = workspace(&temporary)?;
    open.choose_location(&root)?;
    open.create(&file_set("first"))?;

    let object_name = format!("{}.png", "0a".repeat(32));
    fs::write(root.join("assets/images").join(&object_name), [1, 2, 3])?;
    fs::write(root.join("assets/images/notes.txt"), "not an object")?;

    open.choose_location(&target)?;
    let location = open.save_as(&file_set("second"))?;

    assert_eq!(location.directory_name, "copy");
    assert!(target.join("assets/images").join(&object_name).is_file());
    // A file that is not a content-addressed object is not carried across.
    assert!(!target.join("assets/images/notes.txt").exists());
    assert_eq!(
        fs::read_to_string(target.join("project.rino.json"))?,
        manifest_text("second")
    );
    // The original is left exactly as it was.
    assert_eq!(
        fs::read_to_string(root.join("project.rino.json"))?,
        manifest_text("first")
    );

    Ok(())
}

#[test]
fn a_command_without_an_open_project_is_refused() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("closed")?;
    let open = workspace(&temporary)?;

    let error = open
        .save(&file_set("first"))
        .expect_err("saving without an open project must be refused");
    assert_eq!(error.code, ProjectErrorCode::NoOpenProject);

    Ok(())
}

#[test]
fn creating_without_a_chosen_location_is_refused() -> Result<(), Box<dyn Error>> {
    let temporary = TemporaryRoot::create("unchosen")?;
    let mut open = workspace(&temporary)?;

    let error = open
        .create(&file_set("first"))
        .expect_err("creating without a chosen location must be refused");
    assert_eq!(error.code, ProjectErrorCode::NoChosenLocation);

    Ok(())
}
