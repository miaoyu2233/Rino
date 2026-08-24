# Preview, Capture, and Image Asset Boundary

## Status

This document defines the F-MVP-03 domain boundary implemented by the desktop frontend,
the Rust shell, and the Python runtime. Presentation work may consume these interfaces but
must not duplicate coordinate math, token ownership, naming rules, or filesystem access.

## Artifact ownership

The Python runtime owns source images and private cache files. A preview response exposes
only a short-lived opaque token and safe dimensions. The preview token also identifies the
exact full-resolution source frame through `sourceCoordinateSpaceId` and
`sourceGeneration`.

`capture.prepare` binds either the full source frame or one bounded source-space region to
a separate short-lived capture token. Preparing a capture does not add it to a project.
The Rust shell registers the token against the current Sidecar generation and verifies the
file type, exact byte length, PNG header, IHDR dimensions, expiry, and cache location before
returning bytes to the webview.

The frontend never receives a private cache path. Preview PNGs are limited to 3 MiB.
Confirmed capture PNGs are limited to 64 MiB and two live Python artifacts. A capture lives
for at most 60 seconds unless explicitly released sooner.

## Confirmation state model

`PreparedCaptureSession` has three states:

| State | Bytes available | Allowed action | Transition |
| --- | --- | --- | --- |
| `active` | Yes | Commit or discard | `committed` or `released` |
| `committed` | No | None | Terminal |
| `released` | No | None | Terminal |

`prepareCaptureSession` reads the exact native capture before returning an active session.
If native reading or metadata validation fails, it attempts to release the runtime token.
A failed project commit leaves the session active so the user can retry or discard it.
A successful commit consumes the token and clears the large byte buffer.

The presentation layer must show the prepared bytes and obtain explicit confirmation
before calling `commit`. Closing or cancelling the confirmation surface must call
`discard`. Object URLs created for display remain presentation-owned and must be revoked
when the session is committed, discarded, replaced, or unmounted.

## Coordinate and overlay contract

All pointer geometry uses CSS pixels. Device pixel ratio changes raster sharpness but must
not be applied a second time to pointer coordinates. `createFitPreviewTransform` is the
single fit, zoom, pan, and one-to-one-scale model. It maps the source image into the current
preview viewport with explicit letterboxing offsets.

`previewPointToSource` and `previewDragToSourceRectangle` produce integer source-space
coordinates carrying the exact coordinate-space ID and source generation. Drag rectangles
are clipped to the image. Empty or completely external selections are rejected.

`projectDeviceOverlay` accepts point, ROI, rectangle, and recognition overlays. It rejects
stale generations, foreign coordinate spaces, invalid confidence values, and out-of-bounds
geometry before projection. Presentation components receive only preview-space geometry
and must not implement another transform.

Preview coordinates and saved authoring coordinates are deliberately different types. A
`SourcePoint` or `SourceRectangle` belongs to one preview frame and must not be persisted.
`createAuthoringPointSelection` and `createAuthoringRectangleSelection` remove that transient
identity and retain integer geometry plus the exact reference width and height. They reject
foreign frames, stale generations, fractional values, empty rectangles, and out-of-bounds
geometry.

Saved coordinates are represented by visible ordinary graph nodes:

- `core.geometry.point` receives a captured `image`, literal `x`, `y`, `referenceWidth`, and
  `referenceHeight`, then emits a runtime `point`.
- `core.geometry.rectangle` receives a captured `image`, literal `x`, `y`, `width`, `height`,
  `referenceWidth`, and `referenceHeight`, then emits a runtime `rectangle`.

At runtime each node requires the captured image dimensions to exactly match the saved
reference dimensions. It then binds the saved integers to that image's current coordinate
space ID and generation. A resolution mismatch, non-integer value, non-positive rectangle,
or out-of-bounds value fails before a device action can be dispatched. Rino never silently
scales a saved click coordinate.

`useCoordinatePickerStore` owns only one small selection session and never owns image bytes.
Every session is generation-tagged so a delayed pointer event cannot complete a replacement
session. `commitPointPickerSelection` and `commitRectanglePickerSelection` verify the exact
source frame, target graph node, execution edit lock, and one-command undo boundary before
clearing the session. Rejected commits leave the session open for recovery or cancellation.

`readAuthoringCoordinateSelection` and `createAuthoringSelectionOverlay` may display a saved
selection on a later preview frame only when the current source resolution exactly matches
the reference resolution. The overlay is rebound to the current frame identity before it is
passed to `projectDeviceOverlay`; no stored coordinate-space identifier is reused.

## Refresh policy

`choosePreviewRefreshPolicy` is the authoritative cadence policy:

- Disconnected, user-paused, hidden, or inactive surfaces stop acquisition.
- A healthy idle device targets approximately 15 FPS.
- Moderate capture cost targets 10 FPS.
- Graph interaction or an active run targets 5 FPS.
- A busy device targets 2 FPS.
- Slow capture cost backs off in 50 ms steps, bounded at 1 second.

The UI may display this state but must not invent a competing timer policy. Only one refresh
request may be active at a time, and an older response must not replace a newer frame.

## Naming contract

Asset display names are normalized with Unicode NFKC, trimmed, and compared with invariant
case folding. Empty names, control characters, path separators, a trailing period, reserved
device names, and names longer than 200 Unicode code points are rejected.

Normalized collisions block filing. They never overwrite an existing record and never
silently rename the user's input. `suggestAvailableAssetDisplayName` supplies a deterministic
` (N)` suggestion. Automatic names use `capture-YYYYMMDD-HHmmss-NNN` and choose the first
available ordinal from 001 through 999 for that local second.

Name validation and collision checks must finish before committing the capture bytes. If
the name is rejected, the confirmation session remains active.

## Project commit and recovery

`project_store_capture` is the only webview-accessible path that can move a confirmed
capture into a project. Rust reads the generation-bound capture, verifies it again, hashes
the exact bytes with SHA-256, and writes it as `assets/images/<sha256>.png` through a flushed
and verified staging sibling. Existing objects are reused only when their bytes match.

The command returns safe metadata only: content hash, byte length, dimensions,
coordinate-space ID, and source kind. It returns no local path. On failure, the temporary
capture remains available for retry. On success, both native and Python artifact ownership
are released.

The frontend adds the returned metadata to the project document with a new asset ID and the
already-approved display name, then performs the normal project save. The manifest remains
the commit point. A process exit between object storage and manifest save can leave an
unreferenced immutable object but cannot make the manifest reference missing bytes.

`project_cleanup_orphan_assets` is an explicit post-save maintenance operation. It accepts
only a conservatively validated version-1 manifest, removes only regular files with valid
content-addressed PNG names that the committed manifest does not reference, and leaves
foreign files and links untouched. A failed save must not invoke cleanup.

Reopening a project reconstructs asset records from the manifest. Image bytes remain in the
fixed project object directory and are never inserted into broad reactive state.

## Budget-agent presentation handoff

Lane B may implement B-MVP-03 using these fixed interfaces:

- `createFitPreviewTransform`, `oneToOneZoom`, and the source/preview conversion functions.
- `choosePreviewRefreshPolicy`.
- `projectDeviceOverlay` and its typed overlay models.
- `createCaptureRuntimePort`, `createCaptureProjectPort`, and
  `prepareCaptureSession`.
- The asset-name validation, collision, automatic-name, and suggestion functions.
- `ProjectTransport.storeCapture` and `ProjectTransport.cleanupOrphanAssets`.

Required presentation states are disconnected, loading, live, paused, hidden, inactive,
busy, stale, expired, preparing, confirming, invalid name, duplicate name, committing,
commit failed, committed, and discarded. The implementation must use existing semantic
tokens and icon components, restore focus after confirmation, support keyboard selection,
respect reduced motion, and revoke every object URL it creates.

Lane B must not change IPC schemas, token lifetime, coordinate transforms, cadence policy,
Rust commands, project paths, hashing, atomic writes, cleanup authority, or name
normalization. Any required change to those boundaries returns to Lane F.
