# MaaFramework Direct OCR Contract

## Status

The Python runtime implements the fixed `vision.ocr` capability through the official MaaFramework Python binding. Rino graphs are not compiled into Maa Pipeline. The implementation uses `Tasker.post_recognition("OCR", JOCR(...), image)` against an in-memory image artifact owned by the current runtime process.

The adapter is implementation-complete and has passed a controlled native recognition probe. Desktop packaging of the pinned model files remains a separate release task.

## Capability boundary

The production registry exposes OCR only when the fixed model has been configured, verified, and loaded successfully. It does not enumerate MaaFramework recognition algorithms dynamically.

The following capabilities are outside this contract:

- Neural-network classification or detection nodes.
- Arbitrary model paths selected by a graph or project.
- Custom recognition plugins.
- Raw recognition parameter JSON.
- Maa Pipeline as a Rino graph representation.

## Pinned model asset

The selected model is `OCR/ppocr_v5/zh_cn` from [MaaCommonAssets](https://github.com/MaaXYZ/MaaCommonAssets). It supports Simplified Chinese and English, along with additional scripts supplied by the upstream model.

- Repository commit: `dabcd4681ac990dc4361de26416d986abd80e4aa`
- Rino model key: `ppocr-v5-zh-cn`
- Inference provider: CPU
- Required files:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `det.onnx` | 4,748,769 | `8c3b7ee97913a7942b8565669dc9acbe8846fbbaf4b63e1d7fdb339005574a33` |
| `rec.onnx` | 16,517,247 | `31fb844ce3a4aaf13e4bea62ae35f43bd9a509966061980c30db9b248c542a6b` |
| `keys.txt` | 92,395 | `1ea29636956177e400af712d9782e7693f3fb25f98617bed10479d2965a836fd` |

The upstream keys.txt blob uses LF line endings and is 74,012 bytes. Rino deterministically normalizes it to CRLF without a BOM before packaging; the normalized 92,395-byte file has the pinned digest above. The dictionary content is otherwise unchanged.

Initialization fails closed when a required file is missing, is a symbolic link, has a different size, or has a different digest. The model directory is supplied by the desktop packaging boundary, not by a user-authored graph.

The asset repository declares the MIT license. Its model README identifies the upstream PP-OCRv5 detection and recognition artifacts. Release packaging must include the complete reviewed notices for MaaFramework, MaaCommonAssets, and the upstream model before public distribution.

## Node contract

`vision.ocr` has the following inputs:

- `image`: required `imageRef` from the current runtime image scope.
- `roi`: optional `rect` in the source image coordinate space. Omission means the full image.
- `confidenceThreshold`: required property after defaults are applied; finite number from `0` through `1`, default `0.3`.

The adapter fixes the remaining Maa parameters:

- Recognition type: `OCR`.
- Reading order: `Horizontal`.
- Index: `0`.
- Recognition-only mode: disabled so text detection and recognition both run.
- Model selector: the already loaded default model; no graph-controlled model name.

The result preserves:

- The Maa recognition operation ID.
- The source image generation.
- The source coordinate-space ID.
- The recognition hit state.
- Ordered candidates with text, confidence, and source-image rectangle.

The node selects the highest-confidence candidate. Equal confidence keeps the earlier Maa reading-order candidate. A successful no-match result has `matched = false`; it is not an operational error.

## Validation limits

- At most 256 filtered candidates.
- At most 4,096 Unicode code points per candidate text.
- Finite confidence from `0` through `1`.
- Integer rectangles with positive dimensions fully contained by the source image.
- Exactly one direct recognition detail with a positive operation ID and the `OCR` algorithm.
- The image handle, generation, dimensions, and coordinate space must match the runtime-owned artifact.
- The image coordinate space must match the selected connected device session.

MaaFramework 5.10.5 annotates an OCR result box as `Rect`, but the Python parser currently returns a four-element list for native OCR results. The Rino boundary accepts only these two reviewed forms and normalizes both into `RuntimeRect`.

Raw Maa detail dictionaries, debug images, native image buffers, device addresses, and model paths never enter node outputs or frontend IPC.

## Lifetime and cancellation

One OCR `Tasker` is bound to the shared loaded `Resource` and the controller for each connected device session. Device-affecting work remains serialized by the existing per-device lease.

The adapter snapshots job success and normalized recognition detail immediately after completion. It does not retain Maa job objects as history because `post_stop()`, cache clearing, or teardown may invalidate later status queries.

Cancellation is bridged across the runtime loop and the dedicated Maa loop. A cancellation signal or outer task cancellation calls `Tasker.post_stop()`, settles the worker, and returns the runtime cancellation error. A host timeout also requests stop. Cancellation cannot roll back an already dispatched non-idempotent device action; OCR itself is a read operation.

## Runtime activation

The sidecar accepts the application-owned model directory through:

```text
--maa-ocr-model-directory <absolute-directory>
```

The argument requires the existing Maa ADB configuration. When the argument is absent, capture remains available and `vision.ocr` is not registered. When the argument is present but verification or loading fails, the Maa backend fails closed instead of exposing a broken OCR node.

The desktop launcher must eventually resolve this path from a packaged, read-only application resource. It must not search the current directory, environment variables, user projects, or `PATH`.

## Verification

Automated coverage includes fixed recognition parameters, list and `Rect` box normalization, candidate bounds, fail-closed model integrity, source metadata, per-device session ownership, service-loop cancellation, host-loop cancellation, capability registration, and adjacent Maa regressions.

The sanitized native probe is:

```text
tools/spikes/maa-python/ocr_probe.py
```

It creates a numeric image in memory, connects an in-memory controller, selects CPU inference, loads the pinned model, binds a Tasker, and calls the production result adapter. Its report redacts recognized text. The accepted reference run produced one candidate and passed every structural check without connecting a real device.

## Remaining release work

- Keep the three verified model files and their deterministic normalization in the application packaging pipeline.
- Pass their resolved read-only directory from the Tauri launcher.
- Add complete third-party notices and verify redistribution obligations.
- Run packaged Windows smoke tests without a system Python installation.
- Run a controlled Android device or emulator graph covering capture, OCR, numeric parsing, comparison, branch visualization, and cancellation.
