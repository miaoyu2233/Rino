# Maa capture and runtime image handles

Status: P5-T03 implementation baseline.

## Ownership boundary

Rino invokes the pinned Maa controller's direct `post_screencap()` operation. It does not
compile a graph to Maa Pipeline. The returned array is validated at the untyped dependency
boundary, copied into Rino-owned contiguous memory, and made read-only before any handle is
published.

Full-resolution pixels remain inside the Python runtime process. A graph value carries only:

- an opaque process-local handle;
- width and height;
- an opaque coordinate-space identifier;
- a monotonically increasing capture generation; and
- an internal monotonic expiry deadline.

The handle, coordinate-space identifier, and expiry deadline are never included in node-value
events. Runtime events expose only bounded dimensions and display summaries. Physical device
identifiers, ADB addresses, executable paths, and image bytes never enter the graph document,
logs, or version-one JSON IPC.

## Limits and lifetime

The process-owned image scope applies all of these bounds before accepting a frame:

| Limit | MVP value |
| --- | ---: |
| Maximum width or height | 16,384 pixels |
| Maximum artifacts | 8 |
| Maximum bytes per image | 64 MiB |
| Maximum total image bytes | 192 MiB |
| Default lifetime | 300 seconds |

Expired artifacts are removed on access and accounting queries. When inserting a new image,
the scope evicts least-recently-used artifacts until both count and memory bounds are met. An
explicit release removes one handle immediately. Sidecar shutdown closes the scope and drops
all retained image references. A later preview layer must use a separate bounded preview
artifact and must not expose these full-resolution buffers to the frontend.

Every resolve operation compares the complete reference, including generation, dimensions,
coordinate space, and expiry deadline. Reusing or forging a released handle therefore cannot
resolve a different image silently.

## Threading and cancellation

All Maa controller work remains serialized by the existing per-device lease. Blocking capture
and result retrieval run outside both the graph event loop and the Maa service event loop. The
graph cancellation probe is checked immediately before dispatch and again before the captured
frame is stored or returned. MaaFw 5.10.5 does not expose a verified direct cancellation API
for an in-flight controller capture through this adapter, so an already-dispatched capture may
finish in its worker thread; its result is not published after cancellation.

## Registry exposure

The production Sidecar registers `automation.captureScreen` only when Maa initialization
succeeds and the capture host is present. At this stage it does not register `vision.ocr` or
the action nodes. Backend advertisements cannot add nodes. A successful composition advertises
`runtime.screenCapture` in the handshake; the ordinary desktop composition remains unavailable
until an audited application-owned ADB payload is supplied.

## Verification boundary

Automated tests cover copied ownership, read-only pixels, TTL expiry, explicit release,
least-recently-used eviction, byte and shape rejection, forged-reference rejection, direct Maa
capture success and failure, cancellation before dispatch, registry exposure, safe event
summaries, and Sidecar cleanup. Real-device capture remains a hardware compatibility gate and
must be verified with the pinned runtime and controlled Android target before Phase 5 exits.
