# MaaFramework Python Direct-Operation Spike

## Status

- Task: `P0-T02`
- Candidate: `MaaFw==5.10.5`
- Probe date: 2026-07-24
- Host coverage: Windows x86-64 with CPython 3.13.5
- Result: The direct-operation architecture is viable without compiling a Rino graph into Maa Pipeline.
- Hardware limitation: No ADB device was discoverable, so real Android connection and capture remain a hardware acceptance item.

This document records evidence for the candidate binding. It does not define the production Maa adapter.

## Reproducible environment

The isolated project is under `tools/spikes/maa-python` and pins the complete dependency graph in `uv.lock`.

```powershell
uv sync --frozen --project tools/spikes/maa-python
uv run --frozen --project tools/spikes/maa-python python tools/spikes/maa-python/probe.py
```

The probe writes MaaFramework configuration only under the ignored project-local `.ai-local` directory. It disables framework logging, debug drawings, error captures, and stdout logs. Its controller is in-memory and cannot execute operating-system commands, application actions, shell commands, or real device input.

## Resolved package set

| Package | Resolved version | Role |
| --- | --- | --- |
| `MaaFw` | `5.10.5` | Official Python binding and Windows native runtime |
| `MaaAgentBinary` | `1.0.1` | Android controller agents and minicap libraries |
| `numpy` | `2.5.1` | Image array boundary used by the binding |
| `strenum` | `0.4.15` | Binding enum dependency |

`Library.version()` returned `v5.10.5`. Import, native library loading, and the complete probe passed on CPython 3.13.5.

The package metadata did not expose a usable license field. The upstream MaaFramework repository declares LGPL-3.0, while its bundled unmodified `DirectML.dll` has a separate distribution notice. Release packaging must preserve required notices and must make a deliberate CPU-only decision before omitting or including optional acceleration files.

## Static typing boundary

`MaaFw 5.10.5` does not publish a PEP 561 marker or complete type stubs. The spike therefore contains a deliberately minimal `typings/maa` package that describes only the interfaces reflected from the pinned runtime and exercised by this probe. It is not a replacement public API for MaaFramework and must not grow by guessing undocumented behavior.

Production integration must hide the untyped third-party surface behind Rino-owned typed protocols and validated result models. Whenever the MaaFramework version changes, the adapter owner must re-run runtime reflection, update only the affected local boundary declarations, and repeat the direct-operation probe before accepting the upgrade.

The spike pins its verification tools as development dependencies. The acceptance commands are:

```powershell
uv run --frozen --project tools/spikes/maa-python ruff format --check tools/spikes/maa-python
uv run --frozen --project tools/spikes/maa-python ruff check tools/spikes/maa-python
uv run --frozen --project tools/spikes/maa-python pyright --project tools/spikes/maa-python/pyproject.toml
uv lock --check --project tools/spikes/maa-python
```

## Verified Python interfaces

The following names and signatures were verified against the installed binding:

```text
Library.version() -> str
Toolkit.init_option(user_path, default_config={}) -> bool
Toolkit.find_adb_devices(specified_adb=None) -> list[AdbDevice]
AdbController(adb_path, address, screencap_methods, input_methods, config, agent_path)
Controller.post_connection() -> Job
Controller.post_screencap() -> JobWithResult
Controller.post_click(x, y, contact=0, pressure=1) -> Job
Controller.set_screenshot_use_raw_size(enable) -> bool
Tasker.bind(resource, controller) -> bool
Tasker.post_recognition(reco_type, reco_param, image) -> TaskJob
Tasker.post_action(action_type, action_param, box=Rect(...), reco_detail="") -> TaskJob
Tasker.post_stop() -> Job
Tasker.get_recognition_detail(reco_id) -> RecognitionDetail | None
Tasker.get_action_detail(action_id) -> ActionDetail | None
Tasker.add_sink(sink) -> int | None
TaskJob.wait() -> TaskJob
TaskJob.get(wait=False) -> TaskDetail | None
Resource.post_ocr_model(path) -> Job
```

Recognition and action parameters are binding-owned dataclasses such as `JDirectHit`, `JOCR`, and `JClick`. Passing an arbitrary dictionary is not the verified contract even where annotations appear broad.

## Runtime evidence

### Device discovery

`Toolkit.find_adb_devices()` completed successfully and returned zero devices. The probe reports only the count and never emits device names, addresses, serials, ADB locations, or configuration values.

The returned `AdbDevice` model contains the fields needed to construct `AdbController`: name, ADB path, address, screenshot methods, input methods, and configuration. Actual `AdbController.post_connection()` and Android capture cannot be accepted until a controlled device or emulator is available.

### Controlled connection and capture

An in-memory `CustomController` successfully completed `post_connection()` and `post_screencap()`. The probe enabled `set_screenshot_use_raw_size(True)` and confirmed that a synthetic `32 x 48 x 3` frame retained its exact shape.

MaaFramework may otherwise scale screenshots according to target-side settings. The production adapter must select and record one explicit screenshot size policy; it must not infer coordinate transforms from display size.

### Direct recognition without a Pipeline entry

The probe called:

```text
Tasker.post_recognition("DirectHit", JDirectHit(...), synthetic_image)
```

The task succeeded and returned a populated `RecognitionDetail`. Lookup by recognition ID through `Tasker.get_recognition_detail()` also succeeded. No Pipeline entry represented or scheduled the recognition.

### Direct action without a Pipeline entry

The probe called:

```text
Tasker.post_action("Click", JClick(...), Rect(...))
```

The action succeeded against the in-memory controller, produced `ActionDetail`, and was independently retrievable through `Tasker.get_action_detail()`. The synthetic controller received exactly one click at the computed target center. No real device action occurred.

### Resource initialization requirement

Direct operations still require a Tasker bound to both a connected Controller and a loaded Resource. Calling direct recognition on an uninitialized Tasker returned task ID zero and failed.

The probe loads a small test-only Pipeline file to mark its Resource ready and to provide a cancellable delay task. This is not compilation of the Rino graph. Production should load only the minimum resource components required by the selected recognizer, such as an OCR model and image assets, plus a neutral initialization resource if MaaFramework still requires it.

### Stop and cancellation

The probe started a test-only task with a ten-second post delay, observed the Tasker in a running state, then called `Tasker.post_stop()`. Stop succeeded and the task completed in approximately 3 milliseconds on the reference run.

This verifies the stop mechanism on a controlled non-device task. Cancellation during real ADB capture or input remains unverified. Rino must still perform a pre-dispatch cancellation check and must never assume that already-dispatched non-idempotent input can be rolled back.

### Detail lifetime

Recognition and action statuses were successful immediately after their jobs completed, and their detail objects were retrieved successfully. After a later `post_stop()`, querying the old jobs' `succeeded` properties returned false.

The adapter must snapshot terminal status and details immediately when each job completes. It must not use a prior Job object as a durable history record after stop, cache clearing, or Tasker teardown.

### Callback threading

Custom controller callbacks, controller event-sink notifications, and Tasker event-sink notifications all arrived on threads other than the Python main thread. The reference run observed ten controller messages and eight Tasker messages.

Callbacks must perform bounded validation and enqueue normalized events, then return. They must not call frontend IPC, mutate broad application state, block on asyncio, or retain image buffers.

## Native distribution inventory

The Windows wheel includes these native files:

```text
DirectML.dll
MaaAdbControlUnit.dll
MaaAgentClient.dll
MaaAgentServer.dll
MaaCustomControlUnit.dll
MaaFramework.dll
MaaGamepadControlUnit.dll
MaaPluginDemo.dll
MaaRecordControlUnit.dll
MaaReplayControlUnit.dll
MaaToolkit.dll
MaaUtils.dll
MaaWin32ControlUnit.dll
ViGEmClient.dll
fastdeploy_ppocr_maa.dll
onnxruntime_maa.dll
opencv_world4_maa.dll
```

`MaaAgentBinary 1.0.1` contributed 56 native minicap libraries across Android architectures and API levels.

Rino must package an allowlisted subset. In particular, `MaaPluginDemo.dll`, gamepad support, record/replay support, and optional GPU components must not be included merely because they are present in the wheel. ADB agent files must be resolved from the pinned package rather than an arbitrary system path.

## OCR boundary

The installed Python binding exposes `JOCR` and `Resource.post_ocr_model()`, and the native wheel includes the OCR engine dependencies. It does not include the required model resource directory containing `det.onnx`, `rec.onnx`, and `keys.txt`.

Official documentation points to MaaCommonAssets for converted OCR models. That repository declares the MIT license. This spike did not download or redistribute model files and therefore did not execute OCR. Before the OCR production adapter is accepted, Rino must:

1. Select pinned Simplified Chinese and English-capable model assets.
2. Record their source revision, hashes, licenses, notices, supported character set, and expected memory cost.
3. Load them through `Resource.post_ocr_model()` from a controlled application resource root.
4. Execute direct OCR against an intentionally created, sanitized fixture.
5. Verify candidate text, confidence, rectangle, reading order, and detail preservation.

## Architecture conclusion

Rino can keep its graph language, number parsing, comparisons, branches, variables, loops, retries, and scheduling outside Maa Pipeline. The Maa adapter can use direct Tasker recognition/action calls and controller operations while preserving Maa detail objects.

The verified adapter constraints are:

- Bind a loaded Resource and connected Controller before direct operations.
- Use Maa parameter dataclasses at the binding boundary.
- Snapshot status and details immediately after completion.
- Treat all callbacks as foreign-thread callbacks.
- Run blocking waits in bounded workers rather than the asyncio event loop.
- Select an explicit screenshot size policy.
- Keep controller actions allowlisted; do not expose shell, command, plugin loading, or arbitrary action JSON.
- Keep Maa native files and Android agents behind a versioned packaging manifest.

## Remaining risk and gate state

P0-T02 establishes that Pipeline compilation is unnecessary for Rino execution. The following evidence remains open and must not be misreported as complete:

- Real ADB connection and screenshot on a controlled emulator or device.
- Cancellation while an ADB capture or device operation is active.
- Direct OCR with pinned Chinese/English model resources and a sanitized fixture.
- Clean-machine sidecar packaging without system Python.
- Final legal notice inventory for every redistributed DLL, Android agent, and OCR model.

These gaps do not require changing the approved graph-runtime architecture. They remain explicit compatibility and packaging gates for the Maa adapter and release process.
