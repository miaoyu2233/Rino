use std::{
    collections::HashSet,
    ffi::OsString,
    fmt::Write as _,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
    sync::OnceLock,
};

use sha2::{Digest, Sha256};
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::project::{ProjectFileSet, ProjectWorkspace};

use super::{
    error::{PublishingError, PublishingErrorCode, PublishingResult},
    manifest::{
        GraphDocumentSnapshot, LocalizedText, MAXIMUM_PACKAGE_BYTES, PackageCompatibility,
        PackageEntrypoint, PackageFileRecord, PackageLicense, PackageManifest, PackageMetadata,
        PackageOptions, PackagePayload, PackagePublisher, PackageSigning, PackageSource,
        ProjectManifestSnapshot,
    },
    signing::PublisherSigningKey,
};

const PACKAGE_MANIFEST_PATH: &str = "package.rino.json";
const SIGNATURE_PATH: &str = "signature.ed25519";
const GRAPH_SCHEMA_JSON: &str =
    include_str!("../../../../../contracts/graph/rino-graph-v1.schema.json");
static PROJECT_MANIFEST_VALIDATOR: OnceLock<Result<jsonschema::Validator, ()>> = OnceLock::new();
static GRAPH_DOCUMENT_VALIDATOR: OnceLock<Result<jsonschema::Validator, ()>> = OnceLock::new();

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageOutput {
    pub asset_name: String,
    pub byte_length: u64,
    pub sha256: String,
    pub key_id: String,
    pub public_key_base64: String,
}

struct PackageAsset {
    content_hash: String,
    byte_length: u64,
}

struct PreparedPackage {
    manifest_bytes: Vec<u8>,
    signature: [u8; 64],
    files: ProjectFileSet,
    assets: Vec<PackageAsset>,
}

struct CompletedArchive {
    byte_length: u64,
    sha256: String,
}

fn sha256_hex(bytes: &[u8]) -> String {
    bytes_to_hex(&Sha256::digest(bytes))
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::new(), |mut output, byte| {
        let _ignored = write!(output, "{byte:02x}");
        output
    })
}

fn json_bytes<T: serde::Serialize>(value: &T) -> PublishingResult<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|_| {
        PublishingError::new(PublishingErrorCode::InvalidProject, "packageManifest")
    })?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn validate_project_definition(
    value: &serde_json::Value,
    definition: &str,
    detail: &str,
) -> PublishingResult<()> {
    let slot = match definition {
        "ProjectManifestV1" => &PROJECT_MANIFEST_VALIDATOR,
        "GraphDocumentV1" => &GRAPH_DOCUMENT_VALIDATOR,
        _ => {
            return Err(PublishingError::new(
                PublishingErrorCode::InvalidProject,
                "projectSchemaDefinition",
            ));
        }
    };
    let validator = slot
        .get_or_init(|| {
            let canonical_schema: serde_json::Value =
                serde_json::from_str(GRAPH_SCHEMA_JSON).map_err(|_| ())?;
            let definitions = canonical_schema.get("$defs").cloned().ok_or(())?;
            let schema = serde_json::json!({
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "$ref": format!("#/$defs/{definition}"),
                "$defs": definitions,
            });
            jsonschema::draft202012::options()
                .should_validate_formats(true)
                .build(&schema)
                .map_err(|_| ())
        })
        .as_ref()
        .map_err(|()| {
            PublishingError::new(PublishingErrorCode::InvalidProject, "projectSchemaCompile")
        })?;
    if !validator.is_valid(value) {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidProject,
            detail,
        ));
    }
    Ok(())
}

#[allow(
    clippy::too_many_lines,
    reason = "the manifest and exact payload inventory are assembled together so their hashes cannot diverge"
)]
fn prepare_package(
    files: ProjectFileSet,
    options: &PackageOptions,
    signing_key: &PublisherSigningKey,
) -> PublishingResult<PreparedPackage> {
    options.validate()?;
    let project_value: serde_json::Value = serde_json::from_str(&files.manifest).map_err(|_| {
        PublishingError::new(PublishingErrorCode::InvalidProject, "projectManifest")
    })?;
    validate_project_definition(&project_value, "ProjectManifestV1", "projectManifestSchema")?;
    let project: ProjectManifestSnapshot = serde_json::from_value(project_value).map_err(|_| {
        PublishingError::new(PublishingErrorCode::InvalidProject, "projectManifest")
    })?;
    if project.schema_version != 1 || project.graphs.is_empty() || project.graphs.len() > 64 {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidProject,
            "projectShape",
        ));
    }
    let mut graph_ids = HashSet::with_capacity(project.graphs.len());
    let mut graph_file_names = HashSet::with_capacity(project.graphs.len());
    if project.graphs.iter().any(|record| {
        !graph_ids.insert(record.graph_id.as_str())
            || !graph_file_names.insert(record.file_name.as_str())
    }) {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidProject,
            "duplicateGraphIdentity",
        ));
    }
    let mut capabilities = HashSet::with_capacity(project.required_capabilities.len());
    if project
        .required_capabilities
        .iter()
        .any(|capability| !capabilities.insert(capability.as_str()))
    {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidProject,
            "duplicateCapability",
        ));
    }
    let mut graph_records = Vec::with_capacity(files.graphs.len());
    let mut entry_graph_name = None;
    for graph_record in &project.graphs {
        let graph_file = files
            .graphs
            .iter()
            .find(|candidate| candidate.file_name == graph_record.file_name)
            .ok_or_else(|| {
                PublishingError::new(PublishingErrorCode::InvalidProject, "graphMissing")
            })?;
        let graph_value: serde_json::Value =
            serde_json::from_str(&graph_file.contents).map_err(|_| {
                PublishingError::new(PublishingErrorCode::InvalidProject, "graphDocument")
            })?;
        validate_project_definition(&graph_value, "GraphDocumentV1", "graphDocumentSchema")?;
        let graph: GraphDocumentSnapshot = serde_json::from_value(graph_value).map_err(|_| {
            PublishingError::new(PublishingErrorCode::InvalidProject, "graphDocument")
        })?;
        if graph.schema_version != 1
            || graph.document_id != project.document_id
            || graph.graph.graph_id != graph_record.graph_id
            || graph.graph.kind != "entry"
        {
            return Err(PublishingError::new(
                PublishingErrorCode::InvalidProject,
                "graphIdentity",
            ));
        }
        if graph.graph.graph_id == project.entry_graph_id {
            entry_graph_name = Some(graph.graph.name);
        }
        let bytes = graph_file.contents.as_bytes();
        graph_records.push(PackageFileRecord {
            path: format!("payload/graphs/{}", graph_file.file_name),
            role: "graph",
            media_type: "application/json",
            byte_length: bytes.len() as u64,
            sha256: sha256_hex(bytes),
        });
    }
    if graph_records.len() != project.graphs.len() {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidProject,
            "graphCount",
        ));
    }
    graph_records.sort_by(|left, right| left.path.cmp(&right.path));

    let mut package_files = vec![PackageFileRecord {
        path: "payload/project.rino.json".to_owned(),
        role: "projectManifest",
        media_type: "application/json",
        byte_length: files.manifest.len() as u64,
        sha256: sha256_hex(files.manifest.as_bytes()),
    }];
    package_files.extend(graph_records);

    let mut assets = Vec::with_capacity(project.assets.len());
    let mut asset_hashes = HashSet::with_capacity(project.assets.len());
    for asset in project.assets {
        if asset.media_type != "image/png"
            || asset.content_hash.len() != 64
            || !asset
                .content_hash
                .chars()
                .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
            || !asset_hashes.insert(asset.content_hash.clone())
        {
            return Err(PublishingError::new(
                PublishingErrorCode::InvalidProject,
                "assetIdentity",
            ));
        }
        package_files.push(PackageFileRecord {
            path: format!("payload/assets/images/{}.png", asset.content_hash),
            role: "image",
            media_type: "image/png",
            byte_length: asset.byte_length,
            sha256: asset.content_hash.clone(),
        });
        assets.push(PackageAsset {
            content_hash: asset.content_hash,
            byte_length: asset.byte_length,
        });
    }
    package_files.sort_by(|left, right| left.path.cmp(&right.path));
    assets.sort_by(|left, right| left.content_hash.cmp(&right.content_hash));

    let declared_bytes = package_files
        .iter()
        .try_fold(0_u64, |total, file| total.checked_add(file.byte_length))
        .ok_or_else(|| PublishingError::new(PublishingErrorCode::InvalidProject, "packageSize"))?;
    if declared_bytes > MAXIMUM_PACKAGE_BYTES {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidProject,
            "packageSize",
        ));
    }

    let key_id = signing_key.key_id(&options.publisher_id);
    let entry_graph_name = entry_graph_name
        .ok_or_else(|| PublishingError::new(PublishingErrorCode::InvalidProject, "entryGraph"))?;
    let manifest = PackageManifest {
        schema_version: 1,
        package_id: options.package_id.clone(),
        version: options.version.clone(),
        package_type: "project",
        metadata: PackageMetadata {
            display_name: LocalizedText {
                default: project.metadata.name.clone(),
            },
            summary: LocalizedText {
                default: options.summary.clone(),
            },
        },
        publisher: PackagePublisher {
            publisher_id: options.publisher_id.clone(),
            display_name: options.publisher_display_name.clone(),
        },
        license: PackageLicense {
            identifier: options.license_identifier.clone(),
        },
        source: PackageSource {
            provider: "github",
            owner: options.github_owner.clone(),
            repository: options.github_repository.clone(),
            release_tag: options.release_tag(),
            asset_name: options.asset_name(),
            repository_url: format!(
                "https://github.com/{}/{}",
                options.github_owner, options.github_repository
            ),
        },
        released_at: options.released_at.clone(),
        compatibility: PackageCompatibility {
            minimum_client_version: "1.0.0",
            sidecar_protocol_version: 1,
            project_schema_versions: [1],
            operating_system: "windows",
            architectures: ["x86_64"],
        },
        required_capabilities: project.required_capabilities.clone(),
        payload: PackagePayload {
            project_manifest_path: "payload/project.rino.json",
            default_project_entrypoint_id: "main",
            suggested_configuration_name: LocalizedText {
                default: project.metadata.name,
            },
            entrypoints: vec![PackageEntrypoint {
                entrypoint_id: "main",
                graph_id: project.entry_graph_id,
                display_name: LocalizedText {
                    default: entry_graph_name,
                },
                required_capabilities: project.required_capabilities,
            }],
        },
        files: package_files,
        signing: PackageSigning {
            algorithm: "ed25519",
            key_id,
            signature_file: SIGNATURE_PATH,
        },
    };
    let manifest_bytes = json_bytes(&manifest)?;
    let signature = signing_key.sign(&manifest_bytes);
    Ok(PreparedPackage {
        manifest_bytes,
        signature,
        files,
        assets,
    })
}

fn add_entry<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    path: &str,
    bytes: &[u8],
) -> PublishingResult<()> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .unix_permissions(0o644);
    archive.start_file(path, options).map_err(|_| {
        PublishingError::new(PublishingErrorCode::PackageWriteFailed, "archiveEntry")
    })?;
    archive.write_all(bytes).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::PackageWriteFailed,
            "archiveWrite",
            &error,
        )
    })
}

fn staging_path(target: &Path) -> PublishingResult<PathBuf> {
    let file_name = target.file_name().ok_or_else(|| {
        PublishingError::new(PublishingErrorCode::PackageWriteFailed, "packageTarget")
    })?;
    let mut staged_name = OsString::from(".");
    staged_name.push(file_name);
    staged_name.push(format!(".rino-staging-{}", uuid::Uuid::new_v4().simple()));
    Ok(target.with_file_name(staged_name))
}

fn validate_completed_archive(path: &Path, expected_entries: usize) -> PublishingResult<()> {
    let file = File::open(path).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::PackageWriteFailed,
            "archiveVerifyOpen",
            &error,
        )
    })?;
    let archive = ZipArchive::new(file).map_err(|_| {
        PublishingError::new(PublishingErrorCode::PackageWriteFailed, "archiveVerify")
    })?;
    if archive.len() != expected_entries {
        return Err(PublishingError::new(
            PublishingErrorCode::PackageWriteFailed,
            "archiveEntryCount",
        ));
    }
    Ok(())
}

fn commit_staged_package(staged: &Path, target: &Path) -> PublishingResult<()> {
    // The staging file is a sibling, so rename remains one same-volume filesystem operation.
    // Windows and Unix both replace an existing regular target through this API.
    fs::rename(staged, target).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::PackageWriteFailed,
            "packageCommit",
            &error,
        )
    })
}

fn write_staged_archive(
    staged: &Path,
    workspace: &ProjectWorkspace,
    prepared: PreparedPackage,
) -> PublishingResult<CompletedArchive> {
    let expected_entries = 3_usize
        .saturating_add(prepared.files.graphs.len())
        .saturating_add(prepared.assets.len());
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(staged)
        .map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::PackageWriteFailed,
                "packageCreate",
                &error,
            )
        })?;
    let mut archive = ZipWriter::new(file);
    add_entry(
        &mut archive,
        PACKAGE_MANIFEST_PATH,
        &prepared.manifest_bytes,
    )?;
    add_entry(&mut archive, SIGNATURE_PATH, &prepared.signature)?;
    add_entry(
        &mut archive,
        "payload/project.rino.json",
        prepared.files.manifest.as_bytes(),
    )?;
    let mut graphs = prepared.files.graphs;
    graphs.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    for graph in graphs {
        add_entry(
            &mut archive,
            &format!("payload/graphs/{}", graph.file_name),
            graph.contents.as_bytes(),
        )?;
    }
    for asset in prepared.assets {
        let bytes = workspace
            .read_image_object(&asset.content_hash, asset.byte_length)
            .map_err(|_| {
                PublishingError::new(PublishingErrorCode::AssetUnavailable, "projectAsset")
            })?;
        add_entry(
            &mut archive,
            &format!("payload/assets/images/{}.png", asset.content_hash),
            &bytes,
        )?;
    }
    let completed = archive.finish().map_err(|_| {
        PublishingError::new(PublishingErrorCode::PackageWriteFailed, "archiveFinish")
    })?;
    completed.sync_all().map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::PackageWriteFailed,
            "archiveFlush",
            &error,
        )
    })?;

    let metadata = fs::metadata(staged).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::PackageWriteFailed,
            "packageMetadata",
            &error,
        )
    })?;
    if metadata.len() > MAXIMUM_PACKAGE_BYTES {
        return Err(PublishingError::new(
            PublishingErrorCode::PackageWriteFailed,
            "archiveSize",
        ));
    }
    validate_completed_archive(staged, expected_entries)?;
    Ok(CompletedArchive {
        byte_length: metadata.len(),
        sha256: hash_file(staged)?,
    })
}

pub fn write_package(
    target: &Path,
    workspace: &ProjectWorkspace,
    options: &PackageOptions,
    signing_key: &PublisherSigningKey,
) -> PublishingResult<PackageOutput> {
    let files = workspace.read_current_files().map_err(|error| {
        let code = if error.code == crate::project::ProjectErrorCode::NoOpenProject {
            PublishingErrorCode::NoOpenProject
        } else {
            PublishingErrorCode::InvalidProject
        };
        PublishingError::new(code, "projectSnapshot")
    })?;
    let prepared = prepare_package(files, options, signing_key)?;
    let staged = staging_path(target)?;
    let archive = match write_staged_archive(&staged, workspace, prepared) {
        Ok(archive) => archive,
        Err(error) => {
            let _ignored = fs::remove_file(&staged);
            return Err(error);
        }
    };
    if let Err(error) = commit_staged_package(&staged, target) {
        let _ignored = fs::remove_file(&staged);
        return Err(error);
    }
    Ok(PackageOutput {
        asset_name: options.asset_name(),
        byte_length: archive.byte_length,
        sha256: archive.sha256,
        key_id: signing_key.key_id(&options.publisher_id),
        public_key_base64: signing_key.public_key_base64(),
    })
}

fn hash_file(path: &Path) -> PublishingResult<String> {
    let mut file = File::open(path).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::PackageWriteFailed,
            "packageHashOpen",
            &error,
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::PackageWriteFailed,
                "packageHashRead",
                &error,
            )
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(bytes_to_hex(&hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Read};

    use base64::Engine as _;
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use zip::ZipArchive;

    use crate::project::{ProjectFile, ProjectWorkspace};

    use super::*;

    #[test]
    fn simple_options_reject_prerelease_and_unsafe_names() {
        let mut options = options();
        options.version = "1.0.0-beta".to_owned();
        assert!(options.validate().is_err());
        options.version = "1.0.0".to_owned();
        options.github_repository = "owner/repository".to_owned();
        assert!(options.validate().is_err());
        options.github_repository = "repository".to_owned();
        options.released_at = "2026-99-12T12:34:56.000Z".to_owned();
        assert!(options.validate().is_err());
    }

    #[test]
    fn signing_key_produces_raw_compatible_ed25519_signature() {
        let key = PublisherSigningKey::from_test_secret([7_u8; 32]);
        let message = b"package manifest";
        let signature = Signature::from_bytes(&key.sign(message));
        let public_bytes = base64::engine::general_purpose::STANDARD
            .decode(key.public_key_base64())
            .unwrap_or_default();
        let public_array: [u8; 32] = public_bytes.try_into().unwrap_or([0_u8; 32]);
        let verifier = VerifyingKey::from_bytes(&public_array);
        assert!(verifier.is_ok());
        assert!(verifier.is_ok_and(|key| key.verify(message, &signature).is_ok()));
    }

    #[test]
    fn exported_archive_has_the_client_contract_and_a_valid_signature() {
        let test_root = std::env::temp_dir().join(format!(
            "rino-package-export-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let project_root = test_root.join("project");
        let recovery_root = test_root.join("recovery");
        assert!(fs::create_dir_all(&project_root).is_ok());
        let mut workspace = ProjectWorkspace::new(recovery_root);
        assert!(workspace.choose_location(&project_root).is_ok());
        assert!(workspace.create(&project_files()).is_ok());

        let target = test_root.join("example.rino-package");
        let key = PublisherSigningKey::from_test_secret([11_u8; 32]);
        let output = write_package(&target, &workspace, &options(), &key);
        assert!(output.is_ok());

        let archive_file = File::open(&target);
        assert!(archive_file.is_ok());
        let mut archive = archive_file
            .ok()
            .and_then(|file| ZipArchive::new(file).ok());
        assert!(archive.is_some());
        if let Some(archive) = archive.as_mut() {
            assert_eq!(archive.len(), 4);
            let mut manifest_bytes = Vec::new();
            let manifest_read = archive
                .by_name(PACKAGE_MANIFEST_PATH)
                .and_then(|mut file| file.read_to_end(&mut manifest_bytes).map_err(Into::into));
            assert!(manifest_read.is_ok());
            let manifest: Result<serde_json::Value, _> = serde_json::from_slice(&manifest_bytes);
            assert_eq!(
                manifest
                    .as_ref()
                    .ok()
                    .and_then(|value| value.get("packageType"))
                    .and_then(serde_json::Value::as_str),
                Some("project")
            );
            assert_eq!(
                manifest
                    .as_ref()
                    .ok()
                    .and_then(|value| value.pointer("/payload/projectManifestPath"))
                    .and_then(serde_json::Value::as_str),
                Some("payload/project.rino.json")
            );

            let mut signature_bytes = [0_u8; 64];
            let signature_read = archive
                .by_name(SIGNATURE_PATH)
                .and_then(|mut file| file.read_exact(&mut signature_bytes).map_err(Into::into));
            assert!(signature_read.is_ok());
            let public_bytes = base64::engine::general_purpose::STANDARD
                .decode(key.public_key_base64())
                .unwrap_or_default();
            let public_array: [u8; 32] = public_bytes.try_into().unwrap_or([0_u8; 32]);
            let verifier = VerifyingKey::from_bytes(&public_array);
            assert!(verifier.is_ok_and(|verifier| {
                verifier
                    .verify(&manifest_bytes, &Signature::from_bytes(&signature_bytes))
                    .is_ok()
            }));
        }
        drop(archive);
        assert!(fs::remove_dir_all(&test_root).is_ok());
    }

    #[test]
    fn failed_export_preserves_an_existing_package() {
        let test_root = std::env::temp_dir().join(format!(
            "rino-package-preserve-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let project_root = test_root.join("project");
        assert!(fs::create_dir_all(&project_root).is_ok());
        let mut files = project_files();
        files.manifest = files.manifest.replace(
            r#"  "assets": [],"#,
            r#"  "assets": [{
    "assetId": "bfa1e0d4-f809-4415-8038-0213245f6071",
    "displayName": "capture-001",
    "contentHash": "9f2c1a7be3d45608192a3b4c5d6e7f80910213245f60718293a4b5c6d7e8f900",
    "mediaType": "image/png",
    "byteLength": 240128,
    "coordinateSpace": { "spaceId": "device.main", "width": 1080, "height": 2400 },
    "sourceKind": "deviceCapture",
    "createdAt": "2026-07-26T10:05:00Z"
  }],"#,
        );
        let mut workspace = ProjectWorkspace::new(test_root.join("recovery"));
        assert!(workspace.choose_location(&project_root).is_ok());
        assert!(workspace.create(&files).is_ok());

        let target = test_root.join("existing.rino-package");
        assert!(fs::write(&target, b"previous valid package").is_ok());
        let result = write_package(
            &target,
            &workspace,
            &options(),
            &PublisherSigningKey::from_test_secret([13_u8; 32]),
        );

        assert!(matches!(
            result,
            Err(PublishingError {
                code: PublishingErrorCode::AssetUnavailable,
                ..
            })
        ));
        assert_eq!(
            fs::read(&target).ok().as_deref(),
            Some(b"previous valid package".as_slice())
        );
        assert!(fs::remove_dir_all(test_root).is_ok());
    }

    #[test]
    fn export_rejects_a_graph_that_fails_the_canonical_schema() {
        let test_root = std::env::temp_dir().join(format!(
            "rino-package-schema-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let project_root = test_root.join("project");
        assert!(fs::create_dir_all(&project_root).is_ok());
        let mut files = project_files();
        files.graphs[0].contents = files.graphs[0].contents.replace(
            r#"    "nodes": [],"#,
            r#"    "nodes": [{ "nodeId": "invalid" }],"#,
        );
        let mut workspace = ProjectWorkspace::new(test_root.join("recovery"));
        assert!(workspace.choose_location(&project_root).is_ok());
        assert!(workspace.create(&files).is_ok());

        let target = test_root.join("invalid.rino-package");
        let result = write_package(
            &target,
            &workspace,
            &options(),
            &PublisherSigningKey::from_test_secret([17_u8; 32]),
        );

        assert!(matches!(
            result,
            Err(PublishingError {
                code: PublishingErrorCode::InvalidProject,
                ..
            })
        ));
        assert!(!target.exists());
        assert!(fs::remove_dir_all(test_root).is_ok());
    }

    fn project_files() -> ProjectFileSet {
        ProjectFileSet {
            manifest: r#"{
  "schemaVersion": 1,
  "documentId": "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
  "metadata": {
    "name": "Example",
    "createdAt": "2026-08-12T00:00:00.000Z",
    "updatedAt": "2026-08-12T00:00:00.000Z"
  },
  "entryGraphId": "1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea",
  "graphs": [{
    "graphId": "1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea",
    "fileName": "main.rino.graph.json"
  }],
  "assets": [],
  "requiredCapabilities": []
}"#
            .to_owned(),
            graphs: vec![ProjectFile {
                file_name: "main.rino.graph.json".to_owned(),
                contents: r#"{
  "schemaVersion": 1,
  "documentId": "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
  "graph": {
    "graphId": "1b2c3d4e-5f60-4172-8384-95a6b7c8d9ea",
    "name": "Main",
    "kind": "entry",
    "nodes": [],
    "edges": []
  }
}"#
                .to_owned(),
            }],
        }
    }

    fn options() -> PackageOptions {
        PackageOptions {
            package_id: "io.rino.project.example".to_owned(),
            version: "1.2.3".to_owned(),
            summary: "Example package".to_owned(),
            publisher_id: "example.publisher".to_owned(),
            publisher_display_name: "Example Publisher".to_owned(),
            license_identifier: "LicenseRef-Proprietary".to_owned(),
            github_owner: "example-owner".to_owned(),
            github_repository: "example-repository".to_owned(),
            released_at: "2026-08-12T12:34:56.000Z".to_owned(),
            content: super::super::manifest::PublishingContent::Resource,
            update_wfp: false,
        }
    }
}
