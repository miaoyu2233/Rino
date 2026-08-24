# Typed ports and edges

Covers P3-T06. Describes how a port's type becomes something the user can see, how the
editor shows where a connection may land and why it may not, and how a connection is drawn
for each of the two edge kinds.

## 1. What a port shows

A port carries four independent signals, so no single one has to be readable on its own:

| Signal | Source | Purpose |
| --- | --- | --- |
| Colour | `portAppearance` → `--port-*` token | The data type |
| Shape | `data-shape` on the port row | Execution, value, collection, optional |
| Written type | `CanvasPortView.showTypeLabel` | Types whose colour covers a family |
| Accessible name and tooltip | `graph.port.inputLabel` / `outputLabel` | Node, port, and type in one sentence |

Colour is never the only indicator, which the style guide requires and which also means the
canvas stays usable for a user who cannot separate the hues.

### Colour rules

Every primitive type has its own hue: execution neutral, boolean red, number cyan, string
violet, image amber, point and rectangle green.

A collection or an optional keeps the colour of the value it carries and expresses its
wrapper through shape, so one data type can be followed across a graph whether or not it
is wrapped. This is a deliberate departure from reading the style guide's "collection is
blue" literally: the element colour plus a square port says both what the element is and
that it is a collection, where one flat blue says only the latter.

`--port-collection` remains the colour for the case the element colour cannot cover: a
collection whose element type has no hue of its own, such as `collection<ocrCandidate>`.

### The written type

`requiresTypeLabel` is true for exactly the two colour roles that stand for a family of
types rather than one type: `unknown` and `collection`. Those ports render their type
beside the label in the monospace face. Structured recognition results have no dedicated
hue on purpose — inventing one per result type would exhaust the palette and still not
say which one it is.

## 2. Where a connection may land

`compatibleConnectionTargets` answers, for the port a drag started from, which ports the
connection could reach. It gets the answer from `GraphConnectionIndex.evaluate`, the same
call the editor makes when the drag is released, so a highlighted port cannot then refuse
the connection.

A port that already carries its maximum number of edges is still highlighted, because
landing there replaces the existing edge rather than being rejected (P3-T04, still true).

Only compatible ports change appearance. Nothing is dimmed, so beginning a drag re-renders
the ports that light up and leaves every other port on the canvas untouched. Each port
subscribes to a single boolean through `useCompatibleConnectionTarget`, so the store's
change runs every port's selector but re-renders only those whose answer moved.

The highlight is a static ring. Every candidate port pulsing at once would put continuous
motion across the whole canvas, which section 9 of the style guide reserves for the active
execution path.

### Why the evaluation needed an index

Highlighting asks the same question once per port on the canvas, so the per-candidate cost
cannot be allowed to grow with the graph. `GraphConnectionIndex` prepares the lookups the
evaluation repeats — nodes by identifier, incoming data edges by node, and a memoized set
of the pure nodes each node already depends on — and `evaluateConnection` is now a
single-candidate call on a throwaway index. The rules themselves did not change.

The index built when a drag starts is reused by hover validation and by the rejection
message through `connectionIndexFor`, which returns it only while it still describes the
same graph and registry objects.

## 3. Why a connection was refused

React Flow marks a handle it will not accept, but a colour change does not say what is
wrong. `ConnectionFeedback` renders the reason as a sentence at the port the pointer is
over, in the user's language, and announces it through `role="status"`.

The sentence comes from `connectionRejectionKeys`, a total record over
`ConnectionRejectionReason`: a reason added to the connection rules is a compile error
until it has text, so a bare code can never reach the user.

The component subscribes to React Flow's connection state through a selector that returns
only primitives. React Flow compares the selected slice shallowly, so the callout wakes
when the pointer moves onto, off, or between handles rather than on every pointer move.

The transient notification on `onConnect` is kept as the last gate before the document is
changed. It is not the normal path — React Flow does not call `onConnect` for a connection
`isValidConnection` refused — but the command layer should never depend on the canvas
having asked first.

## 4. How a connection is drawn

| Kind | Route | Stroke | Colour |
| --- | --- | --- | --- |
| Execution | Orthogonal, rounded corners | 2 px | Neutral execution token |
| Data | Bezier curve | 1.5 px | The source port's type colour |

Routing carries the distinction on its own, so the two kinds stay apart when the view is
zoomed out far enough to blur their colours. Each connection also has an SVG `<title>`
naming its kind and, for a data edge, the type it carries.

## 5. Execution activity

`CanvasEdgeData.activity` has three values:

- `idle` — no run has reached this connection. No extra styling.
- `traversed` — an earlier step took this path. Static success-toned stroke, so a finished
  run reads as history rather than as work still in progress.
- `active` — a run is on this path now. This is the only connection state allowed ongoing
  animation, a travelling dash. Under `prefers-reduced-motion` the global stylesheet stops
  the animation and the dashed running-toned stroke remains as static emphasis.

`projectEdges` takes the activity map as a required argument rather than defaulting it,
so the value is always chosen by the caller. Phase 3 passes `EMPTY_EDGE_ACTIVITY`: no run
exists yet, which is the truthful value rather than a default hidden in the projection.
The authoritative runtime supplies real activity in P4-T06, which is the task that owns
run state on the canvas.

## 6. Open gaps

- No producer sets edge activity yet. The states are rendered and tested through the
  projection, and P4-T06 connects them to runtime events.
- React Flow labels each connection group with its own untranslated
  `Edge from … to …` accessible name. The localized `<title>` is therefore a pointer
  tooltip only. Replacing the built-in name needs a translated string on the projected
  edge, which belongs with the accessibility sweep in P3-T10.
- Compatible-target highlighting has not been measured on the 500- and 1,000-node fixtures;
  that measurement is part of P3-T10.
