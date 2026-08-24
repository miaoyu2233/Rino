# MaaFramework Direct Click Contract

## Status

The Python runtime implements `automation.clickPoint` and `automation.clickRectCenter` through the official MaaFramework controller `post_click` API. The implementation does not expose arbitrary Maa actions, action JSON, shell commands, custom actions, or Pipeline tasks.

The production service and host implementation is complete and has passed an in-memory native Maa controller probe. Physical Android acceptance remains a user-controlled gate.

## Coordinate authority

All production clicks use raw screenshot coordinates. `OfficialMaaBinding` requires `set_screenshot_use_raw_size(true)` when creating a controller. A click is accepted only when it carries metadata from a current runtime-owned frame:

- Opaque coordinate-space ID.
- Positive source image generation.
- Integer point or rectangle coordinates.
- Established current frame width and height.

The device service assigns an opaque coordinate-space ID to each device session. It invalidates the coordinate space after a reconnect and whenever a later valid capture changes the frame dimensions. This prevents points or rectangles from an earlier orientation or controller session from being dispatched silently.

Coordinate metadata is runtime-only. Physical device identifiers, addresses, and private paths are never stored in points or rectangles.

## Point click

`automation.clickPoint` accepts a required `point` input. Production validation requires:

```text
0 <= x < currentFrameWidth
0 <= y < currentFrameHeight
point.coordinateSpaceId == currentDeviceCoordinateSpaceId
point.sourceGeneration > 0
```

The exact validated point is sent to `controller.post_click(x, y)`.

## Rectangle-center click

`automation.clickRectCenter` accepts a required `rect` input. Production validation requires positive dimensions and full containment in the current frame:

```text
x >= 0
y >= 0
width > 0
height > 0
x + width <= currentFrameWidth
y + height <= currentFrameHeight
```

The dispatched point is deterministic integer center selection:

```text
centerX = x + floor(width / 2)
centerY = y + floor(height / 2)
```

The rectangle must carry the current coordinate-space ID and a positive source generation. OCR candidate rectangles receive both values from their source image.

## Cancellation and outcome rules

Clicks are non-idempotent. The runtime checks cancellation while waiting for the device lease and again immediately before dispatch. Once dispatch begins, the runtime does not report a successful click as cancelled merely because cancellation arrives afterward.

The following rules are normative:

- Cancellation observed before dispatch produces `NODE_CANCELLED` and sends no click.
- Bounds, missing metadata, stale coordinate space, or unavailable frame dimensions produce a known action failure and send no click.
- A dispatch exception, failed Maa job, host timeout, process crash, or interrupted confirmation after dispatch produces `NODE_ACTION_OUTCOME_UNKNOWN` when the runtime remains able to report it.
- Unknown outcomes are never retryable automatically.
- A successful confirmed job produces `clicked = true` and selects `next`.
- The runtime never attempts compensation by clicking again.

The Sidecar process supervisor must preserve the same unknown-outcome rule when a process exit interrupts an active device action. That cross-process recovery behavior remains part of the MVP recovery gate.

## Concurrency

The node executor uses the graph runtime device lease, and the Maa service independently uses its controller-session lease. Point and rectangle actions targeting the same opaque device cannot overlap with capture, OCR, reconnect, disconnect, or another click. Different devices may proceed independently when their operations are otherwise safe.

## Capability boundary

The production Maa registry contains statically authored definitions. At this stage it may register:

- `automation.captureScreen`
- `vision.ocr` only when the pinned model is available
- `automation.clickPoint`
- `automation.clickRectCenter`

Maa capability discovery cannot create additional node types. Command, Shell, Custom, raw action parameters, and plugin-backed actions remain excluded.

## Verification

Automated tests cover exact point dispatch, rectangle-center math, bounds, missing metadata, stale coordinate spaces, resolution changes, reconnects, pre-dispatch cancellation, failed jobs, dispatch exceptions, host normalization, node-error mapping, and the production capability allowlist.

The sanitized native probe is:

```text
tools/spikes/maa-python/click_probe.py
```

It uses a Maa in-memory controller, enables raw-size coordinates, captures a synthetic frame, dispatches one point and one rectangle-center click through the production device service, and verifies exact synthetic coordinates. It never connects a physical device.

## Physical acceptance gate

Physical acceptance requires explicit user approval and a controlled emulator or device surface:

1. Use an application-owned audited ADB binary and the pinned Maa compatibility unit.
2. Open a disposable surface with two harmless targets and no account or purchase action.
3. Capture the raw frame and record only an opaque pass/fail case ID.
4. Dispatch one approved point click and one approved rectangle-center click.
5. Rotate or resize the target, capture again, and verify the old coordinate token is rejected.
6. Disconnect and reconnect, then verify the old token is rejected again.
7. Cancel before dispatch and verify no click occurs.
8. Do not commit screenshots, device IDs, addresses, ADB paths, or raw logs.

No automated test may choose or click a real target without this controlled user gate.
