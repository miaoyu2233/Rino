use serde::{Deserialize, Serialize};

use super::error::{PublishingError, PublishingErrorCode, PublishingResult};

pub const MAXIMUM_PACKAGE_BYTES: u64 = 1_073_741_824;
const MAXIMUM_TEXT_LENGTH: usize = 2_048;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PublishingContent {
    Resource,
    Application,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageOptions {
    pub package_id: String,
    pub version: String,
    pub summary: String,
    pub publisher_id: String,
    pub publisher_display_name: String,
    pub license_identifier: String,
    pub github_owner: String,
    pub github_repository: String,
    pub released_at: String,
    pub content: PublishingContent,
    pub update_wfp: bool,
}

impl PackageOptions {
    pub fn validate(&self) -> PublishingResult<()> {
        require_ascii_identifier(
            &self.package_id,
            3,
            128,
            |character| {
                character.is_ascii_lowercase()
                    || character.is_ascii_digit()
                    || ".-".contains(character)
            },
            "packageId",
        )?;
        if !is_simple_semantic_version(&self.version) {
            return Err(PublishingError::new(
                PublishingErrorCode::InvalidInput,
                "version",
            ));
        }
        require_text(&self.summary, MAXIMUM_TEXT_LENGTH, "summary")?;
        require_ascii_identifier(
            &self.publisher_id,
            1,
            128,
            |character| {
                character.is_ascii_lowercase()
                    || character.is_ascii_digit()
                    || "._-".contains(character)
            },
            "publisherId",
        )?;
        require_text(&self.publisher_display_name, 128, "publisherDisplayName")?;
        require_ascii_identifier(
            &self.license_identifier,
            1,
            128,
            |character| character.is_ascii_alphanumeric() || ".+-".contains(character),
            "licenseIdentifier",
        )?;
        require_github_name(&self.github_owner, "githubOwner")?;
        require_github_name(&self.github_repository, "githubRepository")?;
        if !is_utc_timestamp(&self.released_at) {
            return Err(PublishingError::new(
                PublishingErrorCode::InvalidInput,
                "releasedAt",
            ));
        }
        Ok(())
    }

    #[must_use]
    pub fn release_tag(&self) -> String {
        format!("v{}", self.version)
    }

    #[must_use]
    pub fn resource_asset_name(&self) -> String {
        let stem = self.package_id.replace('.', "-");
        format!("{stem}-{}.rino-package", self.version)
    }

    #[must_use]
    pub fn application_asset_name(&self) -> String {
        let stem = self.package_id.replace('.', "-");
        format!("{stem}-{}.rino-app.zip", self.version)
    }

    #[must_use]
    pub fn asset_name(&self) -> String {
        match self.content {
            PublishingContent::Resource => self.resource_asset_name(),
            PublishingContent::Application => self.application_asset_name(),
        }
    }
}

fn require_text(value: &str, maximum: usize, detail: &str) -> PublishingResult<()> {
    if value.trim().is_empty() || value.len() > maximum || value.chars().any(char::is_control) {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidInput,
            detail,
        ));
    }
    Ok(())
}

fn require_ascii_identifier<F>(
    value: &str,
    minimum: usize,
    maximum: usize,
    allowed: F,
    detail: &str,
) -> PublishingResult<()>
where
    F: Fn(char) -> bool,
{
    if value.len() < minimum
        || value.len() > maximum
        || !value.chars().all(allowed)
        || !value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric())
        || !value
            .chars()
            .last()
            .is_some_and(|character| character.is_ascii_alphanumeric())
    {
        return Err(PublishingError::new(
            PublishingErrorCode::InvalidInput,
            detail,
        ));
    }
    Ok(())
}

fn require_github_name(value: &str, detail: &str) -> PublishingResult<()> {
    require_ascii_identifier(
        value,
        1,
        100,
        |character| character.is_ascii_alphanumeric() || "_.-".contains(character),
        detail,
    )
}

fn is_simple_semantic_version(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.chars().all(|character| character.is_ascii_digit())
                && (part == &"0" || !part.starts_with('0'))
        })
}

fn is_utc_timestamp(value: &str) -> bool {
    let has_expected_shape = value.len() == 24
        && value.ends_with('Z')
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value.as_bytes().get(10) == Some(&b'T')
        && value.as_bytes().get(13) == Some(&b':')
        && value.as_bytes().get(16) == Some(&b':')
        && value.as_bytes().get(19) == Some(&b'.')
        && value.chars().enumerate().all(|(index, character)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19 | 23) || character.is_ascii_digit()
        });
    if !has_expected_shape {
        return false;
    }
    let schema = serde_json::json!({ "type": "string", "format": "date-time" });
    jsonschema::draft202012::options()
        .should_validate_formats(true)
        .build(&schema)
        .is_ok_and(|validator| validator.is_valid(&serde_json::Value::String(value.to_owned())))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectManifestSnapshot {
    pub schema_version: u32,
    pub document_id: String,
    pub metadata: ProjectMetadataSnapshot,
    pub entry_graph_id: String,
    pub graphs: Vec<ProjectGraphRecord>,
    pub assets: Vec<ProjectAssetRecord>,
    pub required_capabilities: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectMetadataSnapshot {
    pub name: String,
    #[serde(rename = "createdAt")]
    pub _created_at: String,
    #[serde(rename = "updatedAt")]
    pub _updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectGraphRecord {
    pub graph_id: String,
    pub file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectAssetRecord {
    #[serde(rename = "assetId")]
    pub _asset_id: String,
    #[serde(rename = "displayName")]
    pub _display_name: String,
    pub content_hash: String,
    pub media_type: String,
    pub byte_length: u64,
    #[serde(rename = "coordinateSpace")]
    pub _coordinate_space: serde_json::Value,
    #[serde(rename = "sourceKind")]
    pub _source_kind: String,
    #[serde(rename = "createdAt")]
    pub _created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphDocumentSnapshot {
    pub schema_version: u32,
    pub document_id: String,
    pub graph: GraphSnapshot,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphSnapshot {
    pub graph_id: String,
    pub name: String,
    pub kind: String,
    #[serde(rename = "nodes")]
    pub _nodes: Vec<serde_json::Value>,
    #[serde(rename = "edges")]
    pub _edges: Vec<serde_json::Value>,
    #[serde(default, rename = "editorMetadata")]
    pub _editor_metadata: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageManifest {
    pub schema_version: u32,
    pub package_id: String,
    pub version: String,
    pub package_type: &'static str,
    pub metadata: PackageMetadata,
    pub publisher: PackagePublisher,
    pub license: PackageLicense,
    pub source: PackageSource,
    pub released_at: String,
    pub compatibility: PackageCompatibility,
    pub required_capabilities: Vec<String>,
    pub payload: PackagePayload,
    pub files: Vec<PackageFileRecord>,
    pub signing: PackageSigning,
}

#[derive(Serialize)]
pub struct LocalizedText {
    pub default: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageMetadata {
    pub display_name: LocalizedText,
    pub summary: LocalizedText,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePublisher {
    pub publisher_id: String,
    pub display_name: String,
}

#[derive(Serialize)]
pub struct PackageLicense {
    pub identifier: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageSource {
    pub provider: &'static str,
    pub owner: String,
    pub repository: String,
    pub release_tag: String,
    pub asset_name: String,
    pub repository_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageCompatibility {
    pub minimum_client_version: &'static str,
    pub sidecar_protocol_version: u32,
    pub project_schema_versions: [u32; 1],
    pub operating_system: &'static str,
    pub architectures: [&'static str; 1],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePayload {
    pub project_manifest_path: &'static str,
    pub default_project_entrypoint_id: &'static str,
    pub suggested_configuration_name: LocalizedText,
    pub entrypoints: Vec<PackageEntrypoint>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageEntrypoint {
    pub entrypoint_id: &'static str,
    pub graph_id: String,
    pub display_name: LocalizedText,
    pub required_capabilities: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageFileRecord {
    pub path: String,
    pub role: &'static str,
    pub media_type: &'static str,
    pub byte_length: u64,
    pub sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageSigning {
    pub algorithm: &'static str,
    pub key_id: String,
    pub signature_file: &'static str,
}
