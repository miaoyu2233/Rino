# Controlled Android Acceptance Gate

## Status

Passed on a controlled Windows x86-64 emulator target for the MVP Maa-backed
capabilities. The target was operated through the pinned official MaaFramework Python
binding and an explicit ADB executable. No Maa Pipeline was used.

## Privacy and safety boundary

- The user enabled local-only ADB access and authorized the controlled interaction.
- Device identifiers, ADB addresses, installation paths, OCR text, and native connection
  metadata were never recorded in this document or the probe output.
- Captured frames remained in bounded process memory and were released after each probe.
- The click check used a non-destructive Android settings surface and restored the home
  screen afterward.
- No rendered evidence, retained screenshot, remote upload, telemetry, or Git operation
  was created.

## Accepted scenarios

| Scenario | Result |
| --- | --- |
| Explicit local ADB endpoint becomes ready | Passed |
| Maa runtime and pinned OCR model initialize | Passed |
| Device discovery and connection | Passed |
| Raw coordinate-space capture | Passed at 1280 × 720 |
| Fixed OCR with bounded candidate rectangles | Passed |
| OCR cancellation | Passed with a structured cancelled outcome |
| Rectangle-center click using the captured frame generation | Passed |
| Post-click frame change | Passed |
| Device disconnect and bounded host shutdown | Passed |
| Native emulator output excluded from protocol stdout | Passed |
| Sidecar terminated while connected | Passed |
| New Sidecar generation reconnects and disconnects cleanly | Passed |

## Protocol stdout finding

The emulator-native control library writes opaque connection details directly to process
stdout even when Maa logging is disabled. That output would corrupt the framed desktop
protocol. `rino_runtime.ipc.stdio_boundary.reserve_protocol_stdout` now duplicates the
inherited protocol pipe and redirects file descriptor 1 to the null device before the
native backend starts. The Sidecar writes protocol frames only through the reserved
handle.

The boundary has a subprocess regression test covering direct file-descriptor output and
native C runtime output. A real Maa-backed Sidecar restart probe also confirmed that the
protocol stream remains parseable while the emulator library is active.

## Discovery limitation

On the accepted emulator installation, Maa Toolkit reports both a loopback TCP transport
and a generic emulator transport for the same running instance. The loopback transport
completed connection, capture, OCR, cancellation, click, and disconnect using Maa's
default ADB control methods.

Rino keeps both results opaque and does not persist either physical identifier. A later
device-selection refinement should distinguish transport kinds or perform a proven safe
deduplication. It must not merge separate devices based only on display model, resolution,
or other non-unique metadata.

## Remaining coverage

- A physical Android device has not been exercised.
- Multiple simultaneous emulator instances have not been exercised.
- Clean-machine packaged-runtime and installer behavior belongs to `C-MVP-04`.
- The duplicate discovery presentation remains a known UX issue, not a runtime or safety
  failure.

## References

- [MaaFramework control methods](https://maafw.com/en/docs/2.4-ControlMethods/)
- [MaaFramework integrated interface](https://maafw.com/en/docs/2.2-IntegratedInterfaceOverview/)
- [MuMu Player developer ADB manual](https://www.mumuplayer.com/help/win/developers-essentials-manual.html)
