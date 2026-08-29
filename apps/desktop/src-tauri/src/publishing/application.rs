use std::{
    collections::HashSet,
    ffi::OsString,
    fmt::Write as _,
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, Write},
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use super::{
    error::{PublishingError, PublishingErrorCode, PublishingResult},
    github::WfpTemplateRelease,
    manifest::PackageOptions,
    package::PackageOutput,
};

const TEMPLATE_ARCHIVE_NAME: &str = "Rino-WFP-win-x64.zip";
const TEMPLATE_MANIFEST_PATH: &str = "rino-wfp-template-v1.json";
pub const RESOURCE_DIRECTORY_NAME: &str = "RinoProject";
const RESOURCE_ARCHIVE_PREFIX: &str = "Resource/RinoProject";
const RESOURCE_DESCRIPTOR_NAME: &str = "rino-project-v1.json";
const RESOURCE_DESCRIPTOR_PATH: &str = "Resource/RinoProject/rino-project-v1.json";
const MAXIMUM_TEMPLATE_ARCHIVE_BYTES: u64 = 1_073_741_824;
const MAXIMUM_TEMPLATE_UNCOMPRESSED_BYTES: u64 = 2_147_483_648;
const MAXIMUM_APPLICATION_ARCHIVE_BYTES: u64 = 1_610_612_736;
const MAXIMUM_TEMPLATE_ENTRIES: usize = 16_384;
const MAXIMUM_RESOURCE_ENTRIES: usize = 4_096;
const MAXIMUM_TEMPLATE_MANIFEST_BYTES: u64 = 65_536;
const COPY_BUFFER_BYTES: usize = 64 * 1024;
const REQUIRED_TEMPLATE_PATHS: [&str; 11] = [
    "Rino.exe",
    "runtime/rino-runtime.exe",
    "runtime/platform-tools/adb.exe",
    "runtime/platform-tools/AdbWinApi.dll",
    "runtime/platform-tools/AdbWinUsbApi.dll",
    "runtime/platform-tools/libwinpthread-1.dll",
    "runtime/platform-tools/NOTICE.txt",
    "runtime/_internal/MaaAgentBinary/LICENSE",
    "Resource/base/model/ocr/det.onnx",
    "Resource/base/model/ocr/rec.onnx",
    "Resource/base/model/ocr/keys.txt",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TemplateManifest {
    schema_version: u32,
    template_id: String,
    template_version: String,
    platform: String,
    architecture: String,
    sidecar_protocol_version: u32,
    wfp_commit: String,
    rino_commit: String,
    platform_tools_revision: String,
    platform_tools_archive_sha256: String,
    required_paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResourceProjectDescriptor<'a> {
    schema_version: u32,
    publisher_key_id: &'a str,
    publisher_public_key_base64: &'a str,
    suggested_configuration_name: &'a str,
}

struct TemplateInventory {
    file_names: HashSet<String>,
}

pub fn resolve_template(cache_root: &Path, refresh: bool) -> PublishingResult<PathBuf> {
    prepare_template_cache(cache_root)?;
    let cached = cache_root.join(TEMPLATE_ARCHIVE_NAME);
    if refresh || !cached.is_file() {
        let staged = cache_root.join(format!(
            ".rino-wfp-template-{}.zip",
            uuid::Uuid::new_v4().simple()
        ));
        let release = super::github::download_latest_wfp_template(&staged)?;
        let synchronized = synchronize_template(&staged, &cached, &release);
        if synchronized.is_err() {
            let _ignored = fs::remove_file(&staged);
        }
        synchronized?;
    }
    validate_regular_file(&cached, "templateCacheFile")?;
    validate_template_archive(&cached)?;
    Ok(cached)
}

fn synchronize_template(
    staged: &Path,
    cached: &Path,
    release: &WfpTemplateRelease,
) -> PublishingResult<()> {
    validate_regular_file(staged, "templateDownload")?;
    let metadata = fs::metadata(staged).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::WfpTemplateSyncFailed,
            "templateDownloadMetadata",
            &error,
        )
    })?;
    if metadata.len() != release.byte_length || metadata.len() > MAXIMUM_TEMPLATE_ARCHIVE_BYTES {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateDownloadLength",
        ));
    }
    if hash_file(staged, PublishingErrorCode::WfpTemplateInvalid)? != release.sha256 {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateDownloadDigest",
        ));
    }
    validate_template_archive(staged)?;
    if cached.exists() {
        validate_regular_file(cached, "templateCacheTarget")?;
        fs::remove_file(cached).map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::WfpTemplateSyncFailed,
                "templateCacheReplace",
                &error,
            )
        })?;
    }
    fs::rename(staged, cached).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::WfpTemplateSyncFailed,
            "templateCacheCommit",
            &error,
        )
    })
}

fn prepare_template_cache(root: &Path) -> PublishingResult<()> {
    fs::create_dir_all(root).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::WfpTemplateSyncFailed,
            "templateCacheCreate",
            &error,
        )
    })?;
    let metadata = fs::symlink_metadata(root).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::WfpTemplateSyncFailed,
            "templateCacheMetadata",
            &error,
        )
    })?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_dir() {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateSyncFailed,
            "templateCacheUnsafe",
        ));
    }
    let entries = fs::read_dir(root).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::WfpTemplateSyncFailed,
            "templateCacheRead",
            &error,
        )
    })?;
    for entry in entries.take(4_097) {
        let entry = entry.map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::WfpTemplateSyncFailed,
                "templateCacheEntry",
                &error,
            )
        })?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if name.starts_with(".rino-wfp-template-")
            && Path::new(&name)
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        {
            validate_regular_file(&entry.path(), "templateCacheStaging")?;
            fs::remove_file(entry.path()).map_err(|error| {
                PublishingError::from_io(
                    PublishingErrorCode::WfpTemplateSyncFailed,
                    "templateCacheStagingRemove",
                    &error,
                )
            })?;
        }
    }
    Ok(())
}

pub fn write_application(
    target: &Path,
    template_path: &Path,
    package_path: &Path,
    package: &PackageOutput,
    options: &PackageOptions,
) -> PublishingResult<PackageOutput> {
    validate_regular_file(package_path, "bundledPackage")?;
    if hash_file(package_path, PublishingErrorCode::ApplicationWriteFailed)? != package.sha256 {
        return Err(PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "bundledPackageDigest",
        ));
    }
    let inventory = validate_template_archive(template_path)?;
    if inventory
        .file_names
        .iter()
        .any(|name| name.starts_with(&format!("{RESOURCE_ARCHIVE_PREFIX}/")))
    {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateResourceCollision",
        ));
    }

    let descriptor_bytes = resource_descriptor_bytes(package, options)?;

    let staged = staging_path(target)?;
    let result = write_staged_application(&staged, template_path, package_path, &descriptor_bytes);
    let completed = match result {
        Ok(completed) => completed,
        Err(error) => {
            let _ignored = fs::remove_file(&staged);
            return Err(error);
        }
    };
    if target.exists() {
        validate_regular_file(target, "applicationTarget")?;
        fs::remove_file(target).map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::ApplicationWriteFailed,
                "applicationReplace",
                &error,
            )
        })?;
    }
    if let Err(error) = fs::rename(&staged, target) {
        let _ignored = fs::remove_file(&staged);
        return Err(PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "applicationCommit",
            &error,
        ));
    }
    Ok(PackageOutput {
        asset_name: options.application_asset_name(),
        byte_length: completed.0,
        sha256: completed.1,
        key_id: package.key_id.clone(),
        public_key_base64: package.public_key_base64.clone(),
    })
}

pub fn write_resource_directory(
    target: &Path,
    package_path: &Path,
    package: &PackageOutput,
    options: &PackageOptions,
) -> PublishingResult<PackageOutput> {
    validate_regular_file(package_path, "resourcePackage")?;
    if hash_file(package_path, PublishingErrorCode::ApplicationWriteFailed)? != package.sha256 {
        return Err(PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourcePackageDigest",
        ));
    }
    let descriptor_bytes = resource_descriptor_bytes(package, options)?;
    let staged = resource_staging_path(target)?;
    fs::create_dir(&staged).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceDirectoryCreate",
            &error,
        )
    })?;
    let result = write_package_directory(&staged, package_path, &descriptor_bytes);
    let byte_length = match result {
        Ok(byte_length) => byte_length,
        Err(error) => {
            let _ignored = fs::remove_dir_all(&staged);
            return Err(error);
        }
    };
    if let Err(error) = commit_resource_directory(&staged, target) {
        let _ignored = fs::remove_dir_all(&staged);
        return Err(error);
    }
    Ok(PackageOutput {
        asset_name: RESOURCE_DIRECTORY_NAME.to_owned(),
        byte_length,
        sha256: package.sha256.clone(),
        key_id: package.key_id.clone(),
        public_key_base64: package.public_key_base64.clone(),
    })
}

fn resource_descriptor_bytes(
    package: &PackageOutput,
    options: &PackageOptions,
) -> PublishingResult<Vec<u8>> {
    let suggested_configuration_name = options.package_id.chars().take(80).collect::<String>();
    let descriptor = ResourceProjectDescriptor {
        schema_version: 1,
        publisher_key_id: &package.key_id,
        publisher_public_key_base64: &package.public_key_base64,
        suggested_configuration_name: &suggested_configuration_name,
    };
    let mut bytes = serde_json::to_vec_pretty(&descriptor).map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceDescriptor",
        )
    })?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[allow(
    clippy::too_many_lines,
    reason = "template copying and resource injection share one staged archive transaction"
)]
fn write_staged_application(
    staged: &Path,
    template_path: &Path,
    package_path: &Path,
    descriptor_bytes: &[u8],
) -> PublishingResult<(u64, String)> {
    let template_file = File::open(template_path).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "templateOpen",
            &error,
        )
    })?;
    let mut template = ZipArchive::new(template_file).map_err(|_| {
        PublishingError::new(PublishingErrorCode::WfpTemplateInvalid, "templateArchive")
    })?;
    let output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(staged)
        .map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::ApplicationWriteFailed,
                "applicationCreate",
                &error,
            )
        })?;
    let mut archive = ZipWriter::new(output);
    let file_options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    for index in 0..template.len() {
        let mut source = template.by_index(index).map_err(|_| {
            PublishingError::new(PublishingErrorCode::WfpTemplateInvalid, "templateEntry")
        })?;
        if source.is_dir() {
            continue;
        }
        let name = validate_archive_name(source.name(), false)?;
        archive.start_file(&name, file_options).map_err(|_| {
            PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "applicationTemplateEntry",
            )
        })?;
        io::copy(&mut source, &mut archive).map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::ApplicationWriteFailed,
                "applicationTemplateCopy",
                &error,
            )
        })?;
    }
    add_file(
        &mut archive,
        RESOURCE_DESCRIPTOR_PATH,
        descriptor_bytes,
        file_options,
    )?;
    let package_file = File::open(package_path).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourcePackageOpen",
            &error,
        )
    })?;
    let mut package = ZipArchive::new(package_file).map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourcePackageArchive",
        )
    })?;
    validate_resource_package_entries(&mut package)?;
    for index in 0..package.len() {
        let mut source = package.by_index(index).map_err(|_| {
            PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourcePackageEntry",
            )
        })?;
        let relative = validate_resource_entry_name(source.name())?;
        let target_name = format!("{RESOURCE_ARCHIVE_PREFIX}/{relative}");
        archive.start_file(target_name, file_options).map_err(|_| {
            PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceApplicationEntry",
            )
        })?;
        io::copy(&mut source, &mut archive).map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceApplicationCopy",
                &error,
            )
        })?;
    }
    let completed = archive.finish().map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "applicationFinish",
        )
    })?;
    completed.sync_all().map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "applicationFlush",
            &error,
        )
    })?;
    let length = completed
        .metadata()
        .map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::ApplicationWriteFailed,
                "applicationMetadata",
                &error,
            )
        })?
        .len();
    if length > MAXIMUM_APPLICATION_ARCHIVE_BYTES {
        return Err(PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "applicationSize",
        ));
    }
    let digest = hash_file(staged, PublishingErrorCode::ApplicationWriteFailed)?;
    validate_application_archive(staged)?;
    Ok((length, digest))
}

fn write_package_directory(
    target: &Path,
    package_path: &Path,
    descriptor_bytes: &[u8],
) -> PublishingResult<u64> {
    let package_file = File::open(package_path).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourcePackageOpen",
            &error,
        )
    })?;
    let mut package = ZipArchive::new(package_file).map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourcePackageArchive",
        )
    })?;
    validate_resource_package_entries(&mut package)?;
    let mut byte_length = descriptor_bytes.len() as u64;
    for index in 0..package.len() {
        let mut source = package.by_index(index).map_err(|_| {
            PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourcePackageEntry",
            )
        })?;
        let relative = validate_resource_entry_name(source.name())?;
        byte_length = byte_length.checked_add(source.size()).ok_or_else(|| {
            PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceDirectorySize",
            )
        })?;
        let destination = target.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
        let parent = destination.parent().ok_or_else(|| {
            PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceDirectoryPath",
            )
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceDirectoryParent",
                &error,
            )
        })?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|error| {
                PublishingError::from_io(
                    PublishingErrorCode::ApplicationWriteFailed,
                    "resourceDirectoryFile",
                    &error,
                )
            })?;
        io::copy(&mut source, &mut output).map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceDirectoryCopy",
                &error,
            )
        })?;
        output.sync_all().map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceDirectoryFlush",
                &error,
            )
        })?;
    }
    let descriptor_path = target.join(RESOURCE_DESCRIPTOR_NAME);
    let mut descriptor = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(descriptor_path)
        .map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceDescriptorCreate",
                &error,
            )
        })?;
    descriptor.write_all(descriptor_bytes).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceDescriptorWrite",
            &error,
        )
    })?;
    descriptor.sync_all().map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceDescriptorFlush",
            &error,
        )
    })?;
    Ok(byte_length)
}

fn validate_resource_package_entries(package: &mut ZipArchive<File>) -> PublishingResult<()> {
    if package.len() < 3 || package.len() > MAXIMUM_RESOURCE_ENTRIES {
        return Err(PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceEntryCount",
        ));
    }
    let mut names = HashSet::with_capacity(package.len());
    let mut expanded_bytes = 0_u64;
    for index in 0..package.len() {
        let entry = package.by_index(index).map_err(|_| {
            PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourcePackageEntry",
            )
        })?;
        if entry.is_dir() || is_symbolic_link(entry.unix_mode()) {
            return Err(PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceEntryType",
            ));
        }
        let name = validate_resource_entry_name(entry.name())?;
        if name.eq_ignore_ascii_case(RESOURCE_DESCRIPTOR_NAME)
            || !names.insert(name.to_ascii_lowercase())
        {
            return Err(PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceEntryCollision",
            ));
        }
        expanded_bytes = expanded_bytes.checked_add(entry.size()).ok_or_else(|| {
            PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceExpandedSize",
            )
        })?;
        if expanded_bytes > MAXIMUM_TEMPLATE_UNCOMPRESSED_BYTES {
            return Err(PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceExpandedSize",
            ));
        }
    }
    for required in [
        "package.rino.json",
        "signature.ed25519",
        "payload/project.rino.json",
    ] {
        if !names.contains(required) {
            return Err(PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceRequiredPath",
            ));
        }
    }
    Ok(())
}

fn validate_resource_entry_name(name: &str) -> PublishingResult<String> {
    if name.is_empty()
        || name.len() > 255
        || name.starts_with('/')
        || name.contains(['\\', ':', '\0'])
        || name.chars().any(char::is_control)
    {
        return Err(PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceEntryPath",
        ));
    }
    let path = Path::new(name);
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::CurDir | Component::RootDir | Component::Prefix(_)
        )
    }) || name.split('/').any(|segment| {
        segment.is_empty() || segment == "." || segment == ".." || segment.ends_with([' ', '.'])
    }) {
        return Err(PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceEntryPath",
        ));
    }
    Ok(name.to_owned())
}

fn resource_staging_path(target: &Path) -> PublishingResult<PathBuf> {
    resource_sibling_path(target, "staging")
}

fn resource_backup_path(target: &Path) -> PublishingResult<PathBuf> {
    resource_sibling_path(target, "backup")
}

fn resource_sibling_path(target: &Path, purpose: &str) -> PublishingResult<PathBuf> {
    let file_name = target.file_name().ok_or_else(|| {
        PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceDirectoryTarget",
        )
    })?;
    let mut sibling_name = OsString::from(".");
    sibling_name.push(file_name);
    sibling_name.push(format!(".rino-{purpose}-{}", uuid::Uuid::new_v4().simple()));
    Ok(target.with_file_name(sibling_name))
}

fn commit_resource_directory(staged: &Path, target: &Path) -> PublishingResult<()> {
    if !target.exists() {
        return fs::rename(staged, target).map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::ApplicationWriteFailed,
                "resourceDirectoryCommit",
                &error,
            )
        });
    }
    let metadata = fs::symlink_metadata(target).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceDirectoryMetadata",
            &error,
        )
    })?;
    if !metadata.is_dir() || is_reparse_point(&metadata) {
        return Err(PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceDirectoryUnsafe",
        ));
    }
    let backup = resource_backup_path(target)?;
    fs::rename(target, &backup).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceDirectoryBackup",
            &error,
        )
    })?;
    if let Err(error) = fs::rename(staged, target) {
        let _restored = fs::rename(&backup, target);
        return Err(PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceDirectoryCommit",
            &error,
        ));
    }
    fs::remove_dir_all(&backup).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "resourceDirectoryCleanup",
            &error,
        )
    })
}

fn add_file<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    path: &str,
    bytes: &[u8],
    options: SimpleFileOptions,
) -> PublishingResult<()> {
    archive.start_file(path, options).map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "applicationEntry",
        )
    })?;
    archive.write_all(bytes).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "applicationEntryWrite",
            &error,
        )
    })
}

#[allow(
    clippy::too_many_lines,
    reason = "entry inventory and manifest validation must describe the same opened archive"
)]
fn validate_template_archive(path: &Path) -> PublishingResult<TemplateInventory> {
    validate_regular_file(path, "templateArchiveFile")?;
    let length = fs::metadata(path)
        .map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::WfpTemplateInvalid,
                "templateArchiveMetadata",
                &error,
            )
        })?
        .len();
    if length == 0 || length > MAXIMUM_TEMPLATE_ARCHIVE_BYTES {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateArchiveSize",
        ));
    }
    let file = File::open(path).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateArchiveOpen",
            &error,
        )
    })?;
    let mut archive = ZipArchive::new(file).map_err(|_| {
        PublishingError::new(PublishingErrorCode::WfpTemplateInvalid, "templateArchive")
    })?;
    if archive.is_empty() || archive.len() > MAXIMUM_TEMPLATE_ENTRIES {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateEntryCount",
        ));
    }
    let mut names = HashSet::with_capacity(archive.len());
    let mut folded_names = HashSet::with_capacity(archive.len());
    let mut uncompressed = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|_| {
            PublishingError::new(PublishingErrorCode::WfpTemplateInvalid, "templateEntry")
        })?;
        let name = validate_archive_name(entry.name(), entry.is_dir())?;
        if !entry.is_dir() {
            uncompressed = uncompressed.checked_add(entry.size()).ok_or_else(|| {
                PublishingError::new(
                    PublishingErrorCode::WfpTemplateInvalid,
                    "templateExpandedSize",
                )
            })?;
            if uncompressed > MAXIMUM_TEMPLATE_UNCOMPRESSED_BYTES {
                return Err(PublishingError::new(
                    PublishingErrorCode::WfpTemplateInvalid,
                    "templateExpandedSize",
                ));
            }
            if is_symbolic_link(entry.unix_mode()) {
                return Err(PublishingError::new(
                    PublishingErrorCode::WfpTemplateInvalid,
                    "templateSymbolicLink",
                ));
            }
            if !names.insert(name.clone()) || !folded_names.insert(name.to_ascii_lowercase()) {
                return Err(PublishingError::new(
                    PublishingErrorCode::WfpTemplateInvalid,
                    "templateDuplicateEntry",
                ));
            }
        }
    }
    for required in REQUIRED_TEMPLATE_PATHS {
        if !names.contains(required) {
            return Err(PublishingError::new(
                PublishingErrorCode::WfpTemplateInvalid,
                "templateRequiredPath",
            ));
        }
    }
    let mut manifest_file = archive.by_name(TEMPLATE_MANIFEST_PATH).map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateManifestMissing",
        )
    })?;
    if manifest_file.size() == 0 || manifest_file.size() > MAXIMUM_TEMPLATE_MANIFEST_BYTES {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateManifestSize",
        ));
    }
    let manifest_capacity = usize::try_from(manifest_file.size()).map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateManifestSize",
        )
    })?;
    let mut manifest_bytes = Vec::with_capacity(manifest_capacity);
    manifest_file
        .read_to_end(&mut manifest_bytes)
        .map_err(|error| {
            PublishingError::from_io(
                PublishingErrorCode::WfpTemplateInvalid,
                "templateManifestRead",
                &error,
            )
        })?;
    let manifest: TemplateManifest = serde_json::from_slice(&manifest_bytes).map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateManifestJson",
        )
    })?;
    validate_template_manifest(&manifest, &names)?;
    Ok(TemplateInventory { file_names: names })
}

fn validate_template_manifest(
    manifest: &TemplateManifest,
    file_names: &HashSet<String>,
) -> PublishingResult<()> {
    let is_lower_hash = |value: &str, lengths: &[usize]| {
        lengths.contains(&value.len())
            && value
                .chars()
                .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
    };
    if manifest.schema_version != 1
        || manifest.template_id != "rino-wfp-win-x64"
        || manifest.template_version.is_empty()
        || manifest.template_version.len() > 64
        || manifest.platform != "windows"
        || manifest.architecture != "x86_64"
        || manifest.sidecar_protocol_version != 1
        || !is_lower_hash(&manifest.wfp_commit, &[40, 64])
        || !is_lower_hash(&manifest.rino_commit, &[40, 64])
        || manifest.platform_tools_revision.is_empty()
        || manifest.platform_tools_revision.len() > 64
        || !is_lower_hash(&manifest.platform_tools_archive_sha256, &[64])
        || manifest.required_paths.len() < REQUIRED_TEMPLATE_PATHS.len()
        || manifest.required_paths.len() > 256
    {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateManifestFields",
        ));
    }
    let required = manifest.required_paths.iter().collect::<HashSet<_>>();
    if required.len() != manifest.required_paths.len()
        || REQUIRED_TEMPLATE_PATHS
            .iter()
            .any(|path| !required.contains(&path.to_string()) || !file_names.contains(*path))
    {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateManifestRequiredPaths",
        ));
    }
    Ok(())
}

fn validate_application_archive(path: &Path) -> PublishingResult<()> {
    let file = File::open(path).map_err(|error| {
        PublishingError::from_io(
            PublishingErrorCode::ApplicationWriteFailed,
            "applicationVerifyOpen",
            &error,
        )
    })?;
    let mut archive = ZipArchive::new(file).map_err(|_| {
        PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "applicationVerify",
        )
    })?;
    for required in [
        "Rino.exe",
        RESOURCE_DESCRIPTOR_PATH,
        "Resource/RinoProject/package.rino.json",
        "Resource/RinoProject/signature.ed25519",
        "Resource/RinoProject/payload/project.rino.json",
    ] {
        let entry = archive.by_name(required).map_err(|_| {
            PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "applicationRequiredPath",
            )
        })?;
        if entry.is_dir() || entry.size() == 0 {
            return Err(PublishingError::new(
                PublishingErrorCode::ApplicationWriteFailed,
                "applicationRequiredPath",
            ));
        }
    }
    Ok(())
}

fn validate_archive_name(name: &str, directory: bool) -> PublishingResult<String> {
    if name.is_empty() || name.starts_with('/') || name.contains('\0') {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateEntryPath",
        ));
    }
    let canonical = name.replace('\\', "/");
    let normalized = if directory {
        canonical.strip_suffix('/').unwrap_or(&canonical)
    } else {
        &canonical
    };
    let path = Path::new(normalized);
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::CurDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            "templateEntryPath",
        ));
    }
    Ok(normalized.to_owned())
}

fn staging_path(target: &Path) -> PublishingResult<PathBuf> {
    let file_name = target.file_name().ok_or_else(|| {
        PublishingError::new(
            PublishingErrorCode::ApplicationWriteFailed,
            "applicationTarget",
        )
    })?;
    let mut staged_name = OsString::from(".");
    staged_name.push(file_name);
    staged_name.push(format!(".rino-staging-{}", uuid::Uuid::new_v4().simple()));
    Ok(target.with_file_name(staged_name))
}

fn validate_regular_file(path: &Path, detail: &'static str) -> PublishingResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        PublishingError::from_io(PublishingErrorCode::WfpTemplateInvalid, detail, &error)
    })?;
    if metadata.file_type().is_symlink() || is_reparse_point(&metadata) || !metadata.is_file() {
        return Err(PublishingError::new(
            PublishingErrorCode::WfpTemplateInvalid,
            detail,
        ));
    }
    Ok(())
}

fn hash_file(path: &Path, code: PublishingErrorCode) -> PublishingResult<String> {
    let mut file = File::open(path)
        .map_err(|error| PublishingError::from_io(code, "artifactHashOpen", &error))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES].into_boxed_slice();
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| PublishingError::from_io(code, "artifactHashRead", &error))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            let _ignored = write!(output, "{byte:02x}");
            output
        }))
}

fn is_symbolic_link(mode: Option<u32>) -> bool {
    mode.is_some_and(|value| value & 0o170_000 == 0o120_000)
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
    use std::{fs, io::Read};

    use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

    use super::*;
    use crate::publishing::manifest::PublishingContent;

    #[test]
    fn application_archive_contains_runnable_template_and_signed_project() {
        let root = test_root("application");
        assert!(fs::create_dir_all(&root).is_ok());
        let template = root.join("template.zip");
        create_template(&template, None);
        let package_path = root.join("project.rino-package");
        create_resource_package(&package_path);
        let package_sha =
            hash_file(&package_path, PublishingErrorCode::PackageWriteFailed).unwrap_or_default();
        let package = PackageOutput {
            asset_name: "example.rino-package".to_owned(),
            byte_length: fs::metadata(&package_path).map_or(0, |metadata| metadata.len()),
            sha256: package_sha.clone(),
            key_id: "example.publisher.key".to_owned(),
            public_key_base64: "ERERERERERERERERERERERERERERERERERERERERERE=".to_owned(),
        };
        let target = root.join("example.rino-app.zip");
        let result = write_application(&target, &template, &package_path, &package, &options());
        assert!(result.is_ok());

        let file = File::open(&target);
        assert!(file.is_ok());
        let mut archive = file.ok().and_then(|file| ZipArchive::new(file).ok());
        assert!(archive.is_some());
        if let Some(archive) = archive.as_mut() {
            assert!(archive.by_name("Rino.exe").is_ok());
            let mut embedded = Vec::new();
            assert!(
                archive
                    .by_name("Resource/RinoProject/payload/project.rino.json")
                    .and_then(|mut file| file.read_to_end(&mut embedded).map_err(Into::into))
                    .is_ok()
            );
            assert_eq!(embedded, b"project");
            let mut descriptor = String::new();
            assert!(
                archive
                    .by_name(RESOURCE_DESCRIPTOR_PATH)
                    .and_then(|mut file| file.read_to_string(&mut descriptor).map_err(Into::into))
                    .is_ok()
            );
            let value: serde_json::Value =
                serde_json::from_str(&descriptor).unwrap_or(serde_json::Value::Null);
            assert_eq!(
                value
                    .get("publisherKeyId")
                    .and_then(serde_json::Value::as_str),
                Some("example.publisher.key")
            );
            assert!(
                archive
                    .by_name("bundled-project/project.rino-package")
                    .is_err()
            );
        }
        drop(archive);
        assert!(fs::remove_dir_all(root).is_ok());
    }

    #[test]
    fn resource_export_replaces_one_rino_project_directory() {
        let root = test_root("resource-directory");
        let resource_root = root.join("Resource");
        let target = resource_root.join(RESOURCE_DIRECTORY_NAME);
        assert!(fs::create_dir_all(&target).is_ok());
        assert!(fs::write(target.join("stale.txt"), b"stale").is_ok());
        let package_path = root.join("project.rino-package");
        create_resource_package(&package_path);
        let package_sha =
            hash_file(&package_path, PublishingErrorCode::PackageWriteFailed).unwrap_or_default();
        let package = PackageOutput {
            asset_name: "example.rino-package".to_owned(),
            byte_length: fs::metadata(&package_path).map_or(0, |metadata| metadata.len()),
            sha256: package_sha.clone(),
            key_id: "example.publisher.key".to_owned(),
            public_key_base64: "ERERERERERERERERERERERERERERERERERERERERERE=".to_owned(),
        };

        let result = write_resource_directory(&target, &package_path, &package, &options());

        assert!(result.is_ok());
        assert_eq!(
            result.ok().map(|output| output.asset_name),
            Some("RinoProject".to_owned())
        );
        assert!(target.join(RESOURCE_DESCRIPTOR_NAME).is_file());
        assert!(target.join("package.rino.json").is_file());
        assert!(target.join("signature.ed25519").is_file());
        assert!(target.join("payload/project.rino.json").is_file());
        assert!(!target.join("stale.txt").exists());
        assert!(fs::remove_dir_all(root).is_ok());
    }

    #[test]
    fn real_template_exports_a_signed_application_when_configured() {
        let Some(template) = std::env::var_os("RINO_WFP_TEMPLATE").map(PathBuf::from) else {
            return;
        };
        let root = test_root("real-application");
        let project_root = root.join("project");
        assert!(fs::create_dir_all(&project_root).is_ok());
        let mut workspace = crate::project::ProjectWorkspace::new(root.join("recovery"));
        assert!(workspace.choose_location(&project_root).is_ok());
        assert!(workspace.create(&project_files()).is_ok());
        let package_path = root.join("project.rino-package");
        let package = crate::publishing::package::write_package(
            &package_path,
            &workspace,
            &options(),
            &crate::publishing::signing::PublisherSigningKey::from_test_secret([31_u8; 32]),
        );
        assert!(package.is_ok());
        let target = root.join("example.rino-app.zip");
        let application = package.and_then(|package| {
            write_application(&target, &template, &package_path, &package, &options())
        });
        assert!(application.is_ok(), "{application:?}");
        assert!(validate_application_archive(&target).is_ok());
        assert!(fs::remove_dir_all(root).is_ok());
    }
    #[test]
    fn template_archive_rejects_parent_directory_entries() {
        let root = test_root("traversal");
        assert!(fs::create_dir_all(&root).is_ok());
        let template = root.join("template.zip");
        create_template(&template, Some("../escape.dll"));

        let result = validate_template_archive(&template);
        assert!(matches!(
            result,
            Err(PublishingError {
                code: PublishingErrorCode::WfpTemplateInvalid,
                ..
            })
        ));
        assert!(fs::remove_dir_all(root).is_ok());
    }

    fn create_template(path: &Path, extra_entry: Option<&str>) {
        let file = File::create(path).unwrap_or_else(|error| panic!("template create: {error}"));
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);
        for required in REQUIRED_TEMPLATE_PATHS {
            assert!(archive.start_file(required, options).is_ok());
            assert!(archive.write_all(b"template payload").is_ok());
        }
        let manifest = serde_json::json!({
            "schemaVersion": 1,
            "templateId": "rino-wfp-win-x64",
            "templateVersion": "1.0.0",
            "platform": "windows",
            "architecture": "x86_64",
            "sidecarProtocolVersion": 1,
            "wfpCommit": "a".repeat(64),
            "rinoCommit": "b".repeat(64),
            "platformToolsRevision": "37.0.1",
            "platformToolsArchiveSha256": "c".repeat(64),
            "requiredPaths": REQUIRED_TEMPLATE_PATHS,
        });
        assert!(archive.start_file(TEMPLATE_MANIFEST_PATH, options).is_ok());
        assert!(
            archive
                .write_all(&serde_json::to_vec(&manifest).unwrap_or_default())
                .is_ok()
        );
        if let Some(extra_entry) = extra_entry {
            assert!(archive.start_file(extra_entry, options).is_ok());
            assert!(archive.write_all(b"unsafe").is_ok());
        }
        assert!(archive.finish().is_ok());
    }

    fn create_resource_package(path: &Path) {
        let file = File::create(path).unwrap_or_else(|error| panic!("package create: {error}"));
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .unix_permissions(0o644);
        for (name, contents) in [
            ("package.rino.json", b"manifest".as_slice()),
            ("signature.ed25519", &[7_u8; 64]),
            ("payload/project.rino.json", b"project".as_slice()),
        ] {
            assert!(archive.start_file(name, options).is_ok());
            assert!(archive.write_all(contents).is_ok());
        }
        assert!(archive.finish().is_ok());
    }

    fn project_files() -> crate::project::ProjectFileSet {
        crate::project::ProjectFileSet {
            manifest: r#"{
  "schemaVersion": 1,
  "documentId": "0a1b2c3d-4e5f-4061-8273-8495a6b7c8d9",
  "metadata": {
    "name": "Exported application",
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
            graphs: vec![crate::project::ProjectFile {
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
            summary: "Example application".to_owned(),
            publisher_id: "example.publisher".to_owned(),
            publisher_display_name: "Example Publisher".to_owned(),
            license_identifier: "LicenseRef-Proprietary".to_owned(),
            github_owner: "example-owner".to_owned(),
            github_repository: "example-repository".to_owned(),
            released_at: "2026-08-12T12:34:56.000Z".to_owned(),
            content: PublishingContent::Application,
            update_wfp: true,
        }
    }

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "rino-{label}-test-{}",
            uuid::Uuid::new_v4().simple()
        ))
    }
}
