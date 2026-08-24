use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use crate::sidecar::{ProtocolError, Retryability};
use crate::startup::{StartupError, StartupStage};

const ARTIFACT_TOKEN_LENGTH: usize = 32;
const CAPTURE_DIRECTORY_NAME: &str = "captures";
const PROJECT_ASSET_DIRECTORY_NAME: &str = "project-assets";
const MAXIMUM_PREVIEW_BYTES: usize = 3 * 1024 * 1024;
const MAXIMUM_CAPTURE_BYTES: usize = 64 * 1024 * 1024;
const MAXIMUM_PROJECT_ASSET_BYTES: usize = 64 * 1024 * 1024;
const MAXIMUM_CAPTURE_DIMENSION: u32 = 16_384;
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

#[derive(Clone, Copy, Debug)]
struct ArtifactEntry {
    generation: u64,
    byte_length: usize,
    expires_at: Instant,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CaptureSourceKind {
    DeviceCapture,
    RegionCapture,
}

#[derive(Clone, Debug)]
struct CaptureEntry {
    artifact: ArtifactEntry,
    width: u32,
    height: u32,
    coordinate_space_id: String,
    source_kind: CaptureSourceKind,
}

#[derive(Debug)]
pub struct PreparedCapture {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub coordinate_space_id: String,
    pub source_kind: CaptureSourceKind,
}

/// Owns native mappings from opaque runtime tokens to private cache files.
pub struct PreviewCache {
    root: PathBuf,
    capture_root: PathBuf,
    project_asset_root: PathBuf,
    previews: HashMap<String, ArtifactEntry>,
    captures: HashMap<String, CaptureEntry>,
}

impl std::fmt::Debug for PreviewCache {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PreviewCache")
            .field("root", &"<redacted>")
            .field("preview_count", &self.previews.len())
            .field("capture_count", &self.captures.len())
            .finish_non_exhaustive()
    }
}

impl PreviewCache {
    pub(crate) fn initialize(root: PathBuf) -> Result<Self, StartupError> {
        let capture_root = root.join(CAPTURE_DIRECTORY_NAME);
        let project_asset_root = root.join(PROJECT_ASSET_DIRECTORY_NAME);
        fs::create_dir_all(&capture_root)
            .and_then(|()| fs::create_dir_all(&project_asset_root))
            .map_err(|error| {
                StartupError::io(
                    "PREVIEW_CACHE_CREATE_FAILED",
                    StartupStage::CreatePreviewCache,
                    error,
                )
            })?;
        let cache = Self {
            root,
            capture_root,
            project_asset_root,
            previews: HashMap::new(),
            captures: HashMap::new(),
        };
        cache.remove_owned_files().map_err(|error| {
            StartupError::io(
                "PREVIEW_CACHE_CLEANUP_FAILED",
                StartupStage::CreatePreviewCache,
                error,
            )
        })?;
        Ok(cache)
    }

    pub(crate) fn register_preview_from_result(
        &mut self,
        result: &Value,
        generation: u64,
    ) -> Result<(), Box<ProtocolError>> {
        let preview = result.get("preview").and_then(Value::as_object);
        let token = preview
            .and_then(|value| value.get("previewToken"))
            .and_then(Value::as_str);
        let media_type = preview
            .and_then(|value| value.get("mediaType"))
            .and_then(Value::as_str);
        let byte_length = parse_byte_length(preview, MAXIMUM_PREVIEW_BYTES);
        let expires_in_milliseconds = preview
            .and_then(|value| value.get("expiresInMilliseconds"))
            .and_then(Value::as_u64);

        let Some((token, byte_length, expires_in_milliseconds)) = token
            .zip(byte_length)
            .zip(expires_in_milliseconds)
            .map(|((token, byte_length), expires)| (token, byte_length, expires))
        else {
            return Err(invalid_preview_result());
        };
        if !is_artifact_token(token)
            || media_type != Some("image/png")
            || !(1..=60_000).contains(&expires_in_milliseconds)
        {
            return Err(invalid_preview_result());
        }

        let entry = ArtifactEntry {
            generation,
            byte_length,
            expires_at: expiry(expires_in_milliseconds).ok_or_else(invalid_preview_result)?,
        };
        self.previews.insert(token.to_owned(), entry);
        Ok(())
    }

    pub(crate) fn register_capture_from_result(
        &mut self,
        result: &Value,
        generation: u64,
    ) -> Result<(), Box<ProtocolError>> {
        let capture = result.get("capture").and_then(Value::as_object);
        let token = capture
            .and_then(|value| value.get("captureToken"))
            .and_then(Value::as_str);
        let media_type = capture
            .and_then(|value| value.get("mediaType"))
            .and_then(Value::as_str);
        let width = parse_dimension(capture, "width");
        let height = parse_dimension(capture, "height");
        let coordinate_space_id = capture
            .and_then(|value| value.get("coordinateSpaceId"))
            .and_then(Value::as_str);
        let source_kind = capture
            .and_then(|value| value.get("sourceKind"))
            .and_then(Value::as_str)
            .and_then(parse_capture_source_kind);
        let byte_length = parse_byte_length(capture, MAXIMUM_CAPTURE_BYTES);
        let expires_in_milliseconds = capture
            .and_then(|value| value.get("expiresInMilliseconds"))
            .and_then(Value::as_u64);

        let Some((token, width, height, coordinate_space_id, source_kind, byte_length, expires)) =
            token
                .zip(width)
                .zip(height)
                .zip(coordinate_space_id)
                .zip(source_kind)
                .zip(byte_length)
                .zip(expires_in_milliseconds)
                .map(
                    |(
                        (((((token, width), height), coordinate_space_id), source_kind), bytes),
                        expires,
                    )| {
                        (
                            token,
                            width,
                            height,
                            coordinate_space_id,
                            source_kind,
                            bytes,
                            expires,
                        )
                    },
                )
        else {
            return Err(invalid_capture_result());
        };
        if !is_artifact_token(token)
            || media_type != Some("image/png")
            || coordinate_space_id.is_empty()
            || coordinate_space_id.chars().count() > 128
            || coordinate_space_id.chars().any(char::is_control)
            || !(1_000..=120_000).contains(&expires)
        {
            return Err(invalid_capture_result());
        }

        let artifact = ArtifactEntry {
            generation,
            byte_length,
            expires_at: expiry(expires).ok_or_else(invalid_capture_result)?,
        };
        self.captures.insert(
            token.to_owned(),
            CaptureEntry {
                artifact,
                width,
                height,
                coordinate_space_id: coordinate_space_id.to_owned(),
                source_kind,
            },
        );
        Ok(())
    }

    pub(crate) fn release_preview(&mut self, token: &str) {
        if self.previews.remove(token).is_some() {
            let _ignored = fs::remove_file(self.preview_path(token));
        }
    }

    pub(crate) fn release_capture(&mut self, token: &str) {
        if self.captures.remove(token).is_some() {
            let _ignored = fs::remove_file(self.capture_path(token));
        }
    }

    pub(crate) fn read_preview(
        &mut self,
        token: &str,
        generation: u64,
    ) -> Result<Vec<u8>, Box<ProtocolError>> {
        if !is_artifact_token(token) {
            return Err(preview_unavailable());
        }
        self.remove_expired();
        let Some(entry) = self.previews.get(token).copied() else {
            return Err(preview_unavailable());
        };
        if entry.generation != generation || Instant::now() >= entry.expires_at {
            self.release_preview(token);
            return Err(preview_unavailable());
        }
        read_png(&self.preview_path(token), entry, MAXIMUM_PREVIEW_BYTES).map_err(|_| {
            self.release_preview(token);
            preview_unavailable()
        })
    }

    pub(crate) fn read_capture(
        &mut self,
        token: &str,
        generation: u64,
    ) -> Result<PreparedCapture, Box<ProtocolError>> {
        if !is_artifact_token(token) {
            return Err(capture_unavailable());
        }
        self.remove_expired();
        let Some(entry) = self.captures.get(token).cloned() else {
            return Err(capture_unavailable());
        };
        if entry.artifact.generation != generation || Instant::now() >= entry.artifact.expires_at {
            self.release_capture(token);
            return Err(capture_unavailable());
        }
        let bytes = read_png(
            &self.capture_path(token),
            entry.artifact,
            MAXIMUM_CAPTURE_BYTES,
        )
        .map_err(|_| {
            self.release_capture(token);
            capture_unavailable()
        })?;
        let Some((png_width, png_height)) = png_dimensions(&bytes) else {
            self.release_capture(token);
            return Err(capture_unavailable());
        };
        if (png_width, png_height) != (entry.width, entry.height) {
            self.release_capture(token);
            return Err(capture_unavailable());
        }
        Ok(PreparedCapture {
            bytes,
            width: entry.width,
            height: entry.height,
            coordinate_space_id: entry.coordinate_space_id,
            source_kind: entry.source_kind,
        })
    }

    pub(crate) fn clear(&mut self) {
        self.previews.clear();
        self.captures.clear();
        let _ignored = self.remove_owned_files();
    }

    pub(crate) fn stage_project_asset(&self, bytes: &[u8]) -> Result<String, Box<ProtocolError>> {
        if bytes.is_empty()
            || bytes.len() > MAXIMUM_PROJECT_ASSET_BYTES
            || !bytes.starts_with(PNG_SIGNATURE)
        {
            return Err(project_asset_unavailable());
        }
        let token = Uuid::new_v4().simple().to_string();
        let path = self.project_asset_path(&token);
        File::create(&path)
            .and_then(|mut file| std::io::Write::write_all(&mut file, bytes))
            .map_err(|_| project_asset_unavailable())?;
        Ok(token)
    }

    pub(crate) fn release_project_asset(&self, token: &str) {
        if is_artifact_token(token) {
            let _ignored = fs::remove_file(self.project_asset_path(token));
        }
    }

    fn remove_expired(&mut self) {
        let now = Instant::now();
        let expired_previews = self
            .previews
            .iter()
            .filter_map(|(token, entry)| (now >= entry.expires_at).then_some(token.clone()))
            .collect::<Vec<_>>();
        for token in expired_previews {
            self.release_preview(&token);
        }
        let expired_captures = self
            .captures
            .iter()
            .filter_map(|(token, entry)| {
                (now >= entry.artifact.expires_at).then_some(token.clone())
            })
            .collect::<Vec<_>>();
        for token in expired_captures {
            self.release_capture(&token);
        }
    }

    fn preview_path(&self, token: &str) -> PathBuf {
        self.root.join(format!("{token}.png"))
    }

    fn capture_path(&self, token: &str) -> PathBuf {
        self.capture_root.join(format!("{token}.png"))
    }

    fn project_asset_path(&self, token: &str) -> PathBuf {
        self.project_asset_root.join(format!("{token}.png"))
    }

    fn remove_owned_files(&self) -> io::Result<()> {
        remove_token_files(&self.root)?;
        remove_token_files(&self.capture_root)?;
        remove_token_files(&self.project_asset_root)
    }
}

fn parse_dimension(value: Option<&serde_json::Map<String, Value>>, key: &str) -> Option<u32> {
    value
        .and_then(|object| object.get(key))
        .and_then(Value::as_u64)
        .and_then(|dimension| u32::try_from(dimension).ok())
        .filter(|dimension| (1..=MAXIMUM_CAPTURE_DIMENSION).contains(dimension))
}

fn parse_byte_length(
    value: Option<&serde_json::Map<String, Value>>,
    maximum: usize,
) -> Option<usize> {
    value
        .and_then(|object| object.get("byteLength"))
        .and_then(Value::as_u64)
        .and_then(|length| usize::try_from(length).ok())
        .filter(|length| (1..=maximum).contains(length))
}

fn parse_capture_source_kind(value: &str) -> Option<CaptureSourceKind> {
    match value {
        "deviceCapture" => Some(CaptureSourceKind::DeviceCapture),
        "regionCapture" => Some(CaptureSourceKind::RegionCapture),
        _ => None,
    }
}

fn expiry(expires_in_milliseconds: u64) -> Option<Instant> {
    Instant::now().checked_add(Duration::from_millis(expires_in_milliseconds))
}

fn read_png(path: &Path, entry: ArtifactEntry, maximum: usize) -> io::Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || usize::try_from(metadata.len()).ok() != Some(entry.byte_length)
    {
        return Err(io::Error::from(io::ErrorKind::InvalidData));
    }
    let mut file = File::open(path)?;
    let mut bytes = Vec::with_capacity(entry.byte_length);
    file.by_ref()
        .take((maximum + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() != entry.byte_length || !bytes.starts_with(PNG_SIGNATURE) {
        return Err(io::Error::from(io::ErrorKind::InvalidData));
    }
    Ok(bytes)
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

fn remove_token_files(root: &Path) -> io::Result<()> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let Some(token) = file_name.strip_suffix(".png") else {
            continue;
        };
        if is_artifact_token(token) && entry.file_type()?.is_file() {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

fn is_artifact_token(token: &str) -> bool {
    token.len() == ARTIFACT_TOKEN_LENGTH
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn invalid_preview_result() -> Box<ProtocolError> {
    Box::new(ProtocolError::new(
        "PREVIEW_RESULT_INVALID",
        "runtime.error.invalidRuntimeResult",
        "The runtime returned invalid preview metadata.".to_owned(),
        Retryability::Safe,
    ))
}

fn preview_unavailable() -> Box<ProtocolError> {
    Box::new(ProtocolError::new(
        "PREVIEW_UNAVAILABLE",
        "runtime.error.previewUnavailable",
        "The requested preview is unavailable or expired.".to_owned(),
        Retryability::Safe,
    ))
}

fn invalid_capture_result() -> Box<ProtocolError> {
    Box::new(ProtocolError::new(
        "CAPTURE_RESULT_INVALID",
        "runtime.error.invalidRuntimeResult",
        "The runtime returned invalid capture metadata.".to_owned(),
        Retryability::Safe,
    ))
}

fn capture_unavailable() -> Box<ProtocolError> {
    Box::new(ProtocolError::new(
        "CAPTURE_UNAVAILABLE",
        "runtime.error.captureUnavailable",
        "The requested capture is unavailable or expired.".to_owned(),
        Retryability::Safe,
    ))
}

fn project_asset_unavailable() -> Box<ProtocolError> {
    Box::new(ProtocolError::new(
        "PROJECT_ASSET_UNAVAILABLE",
        "runtime.error.projectAssetUnavailable",
        "A selected project image could not be prepared for this run.".to_owned(),
        Retryability::Safe,
    ))
}

#[cfg(test)]
mod tests {
    use std::error::Error;
    use std::fs;
    use std::time::Duration;

    use serde_json::json;
    use uuid::Uuid;

    use super::{CaptureSourceKind, PreviewCache};

    fn cache() -> Result<PreviewCache, crate::StartupError> {
        let root = std::env::temp_dir().join(format!("rino-preview-test-{}", Uuid::new_v4()));
        PreviewCache::initialize(root)
    }

    fn preview_descriptor(
        token: &str,
        byte_length: usize,
        expires_in_milliseconds: u64,
    ) -> serde_json::Value {
        json!({
            "preview": {
                "previewToken": token,
                "mediaType": "image/png",
                "width": 1,
                "height": 1,
                "sourceWidth": 1,
                "sourceHeight": 1,
                "sourceCoordinateSpaceId": "source-space",
                "sourceGeneration": 1,
                "byteLength": byte_length,
                "expiresInMilliseconds": expires_in_milliseconds
            }
        })
    }

    fn capture_descriptor(
        token: &str,
        byte_length: usize,
        width: u32,
        height: u32,
    ) -> serde_json::Value {
        json!({
            "capture": {
                "captureToken": token,
                "mediaType": "image/png",
                "width": width,
                "height": height,
                "coordinateSpaceId": "capture-space",
                "sourceKind": "regionCapture",
                "byteLength": byte_length,
                "expiresInMilliseconds": 60_000
            }
        })
    }

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR".to_vec();
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes
    }

    #[test]
    fn reads_only_a_registered_current_generation_preview() -> Result<(), Box<dyn Error>> {
        let mut cache = cache()?;
        let token = "0123456789abcdef0123456789abcdef";
        let bytes = b"\x89PNG\r\n\x1a\ncontent";
        fs::write(cache.preview_path(token), bytes)?;
        assert!(
            cache
                .register_preview_from_result(&preview_descriptor(token, bytes.len(), 30_000), 4)
                .is_ok()
        );
        let Ok(read_bytes) = cache.read_preview(token, 4) else {
            return Err("registered preview could not be read".into());
        };
        assert_eq!(read_bytes, bytes);
        assert!(cache.read_preview(token, 5).is_err());
        Ok(())
    }

    #[test]
    fn reads_only_a_registered_current_generation_capture() -> Result<(), Box<dyn Error>> {
        let mut cache = cache()?;
        let token = "abcdef0123456789abcdef0123456789";
        let bytes = png_header(300, 400);
        fs::write(cache.capture_path(token), &bytes)?;
        assert!(
            cache
                .register_capture_from_result(&capture_descriptor(token, bytes.len(), 300, 400), 7)
                .is_ok()
        );
        let Ok(capture) = cache.read_capture(token, 7) else {
            return Err("registered capture could not be read".into());
        };
        assert_eq!(capture.bytes, bytes);
        assert_eq!((capture.width, capture.height), (300, 400));
        assert_eq!(capture.coordinate_space_id, "capture-space");
        assert_eq!(capture.source_kind, CaptureSourceKind::RegionCapture);
        assert!(cache.read_capture(token, 8).is_err());
        Ok(())
    }

    #[test]
    fn rejects_forged_and_invalid_metadata() -> Result<(), Box<dyn Error>> {
        let mut cache = cache()?;
        assert!(cache.read_preview("../private", 1).is_err());
        assert!(cache.read_capture("../private", 1).is_err());
        assert!(
            cache
                .register_preview_from_result(
                    &preview_descriptor("ABCDEF0123456789ABCDEF0123456789", 12, 30_000),
                    1
                )
                .is_err()
        );
        assert!(
            cache
                .register_capture_from_result(
                    &capture_descriptor(
                        "abcdef0123456789abcdef0123456789",
                        64 * 1024 * 1024 + 1,
                        1,
                        1
                    ),
                    1
                )
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn rejects_expired_content_and_removes_it() -> Result<(), Box<dyn Error>> {
        let mut cache = cache()?;
        let token = "fedcba9876543210fedcba9876543210";
        let bytes = b"not a png";
        fs::write(cache.preview_path(token), bytes)?;
        assert!(
            cache
                .register_preview_from_result(&preview_descriptor(token, bytes.len(), 1), 2)
                .is_ok()
        );
        std::thread::sleep(Duration::from_millis(2));

        assert!(cache.read_preview(token, 2).is_err());
        assert!(!cache.preview_path(token).exists());
        Ok(())
    }

    #[test]
    fn rejects_non_png_or_mismatched_capture_content() -> Result<(), Box<dyn Error>> {
        let mut cache = cache()?;
        let token = "abcdef0123456789abcdef0123456789";
        let bytes = png_header(1, 1);
        fs::write(cache.capture_path(token), &bytes)?;
        assert!(
            cache
                .register_capture_from_result(&capture_descriptor(token, bytes.len(), 2, 1), 2)
                .is_ok()
        );

        assert!(cache.read_capture(token, 2).is_err());
        assert!(!cache.capture_path(token).exists());
        Ok(())
    }

    #[test]
    fn stages_and_releases_a_private_project_asset_token() -> Result<(), Box<dyn Error>> {
        let cache = cache()?;
        let bytes = png_header(1, 1);

        let token = cache
            .stage_project_asset(&bytes)
            .map_err(|_| "project asset could not be staged")?;
        assert_eq!(token.len(), 32);
        assert_eq!(fs::read(cache.project_asset_path(&token))?, bytes);

        cache.release_project_asset(&token);
        assert!(!cache.project_asset_path(&token).exists());
        assert!(cache.stage_project_asset(b"not a png").is_err());
        Ok(())
    }

    #[test]
    fn startup_removes_only_owned_token_files() -> Result<(), Box<dyn Error>> {
        let root = std::env::temp_dir().join(format!("rino-preview-test-{}", Uuid::new_v4()));
        let captures = root.join("captures");
        fs::create_dir_all(&captures)?;
        let owned_preview = root.join("0123456789abcdef0123456789abcdef.png");
        let owned_capture = captures.join("abcdef0123456789abcdef0123456789.png");
        let unrelated = root.join("keep.png");
        fs::write(&owned_preview, b"owned")?;
        fs::write(&owned_capture, b"owned")?;
        fs::write(&unrelated, b"unrelated")?;

        let cache = PreviewCache::initialize(root)?;

        assert!(!owned_preview.exists());
        assert!(!owned_capture.exists());
        assert!(unrelated.exists());
        fs::remove_dir_all(cache.root)?;
        Ok(())
    }
}
