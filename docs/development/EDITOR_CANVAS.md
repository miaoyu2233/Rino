# Editor canvas boundary

Covers P3-T04. Describes how the graph document reaches React Flow, what stays on each
side of that boundary, and the decisions taken while wiring it.

## 1. Three models, one direction of truth

| Model | Owner | Contents |
| --- | --- | --- |
| Project document | `graph/store/document-store.ts` | `RinoProjectDocumentV1`, wrapped in undo history |
| Editor session | `graph/store/editor-session-store.ts` | Active graph, selection, in-application clipboard |
| Render model | `graph/canvas/graph-view-model.ts` and React Flow | Node/edge view data, selection flags, measured sizes, drag positions |

Changes flow document → render. Nothing flows back except through a command: a drag that
ends produces `moveNode`, a completed connection produces a composite `removeEdge*` +
`addEdge`, a delete produces `removeNode*`. React Flow's own state never reaches the
document, so viewport, measurement, and hover metadata cannot alter what a graph means.

`mergeNodeRenderState` and `mergeEdgeRenderState` carry selection, measured size, and an
in-progress drag position across a re-projection. A node marked `dragging` keeps the
position the pointer gave it until the drag commits, so an unrelated edit cannot snap it
back mid-gesture.

## 2. Projection cache

`GraphProjection` keys its cache on node and edge object identity. Commands are immutable
and replace only what they touch, so an untouched node arrives with its previous identity
and returns the previous view object. A node is rebuilt when its own object changes, when
its definition changes, or when the set of ports with an incoming edge changes. Replacing
the registry snapshot clears the whole cache.

Memoized `RinoNodeView` and `RinoEdgeView` depend on that identity stability; without it
the memo would never hit.

## 3. Connection rules

`graph/connection-rules.ts` answers a single question before the editor accepts a drag:
may this connection exist, and what does it displace? It applies the same rules the graph
validator applies, so an accepted connection cannot immediately produce a validation
error.

Connecting to a port that already carries its maximum number of edges **replaces** the
existing edge rather than being rejected. This matches the established node-editor
gesture. The removal travels inside the same composite command, so one undo restores the
previous wiring and the graph is never briefly over-connected.

Cardinality is derived, not configured: a data input takes one edge, a data output feeds
many, an execution input may be reached from many places, and an execution output
continues to one successor unless its definition declares `allowsFanOut`.

## 4. Interaction decisions

- Primary button drag on empty canvas draws a marquee (`selectionOnDrag`), partial
  intersection selects.
- Middle button drags to pan; holding space turns the primary button into a pan.
- `Control` extends a selection; `Shift` forces marquee mode.
- The delete key is withheld from React Flow (`deleteKeyCode={null}`) so every removal
  goes through the command layer and stays undoable.
- Canvas shortcuts resolve through `resolveCanvasShortcut`, which ignores events during
  input-method composition and events whose target is a text field, so an inline editor
  can never lose its keystrokes to a graph action.
- A drop from the palette is converted with `screenToCanvasPosition` and snapped to the
  8 px grid; the drag-over preview is positioned through the same function so the ghost
  sits exactly where the node will land.

## 5. Node registry during Phase 3

The Python runtime owns the authoritative registry and will deliver it in Phase 4. Until
then `RegistryProvider` installs the shared contract example, validated against the
registry schema rather than trusted, and the store records its source as `development`.

The installation is guarded by `import.meta.env.DEV`, so a production bundle never
presents example definitions as the ones a runtime will execute; the guard also lets the
bundler drop both the call and the fixture it imports. A snapshot already delivered by a
runtime is never replaced by it either.

## 6. Decisions recorded here

- **`skipLibCheck` is enabled for `apps/desktop` only.** The workspace compiles with
  `exactOptionalPropertyTypes`, and the React Flow declaration files are not authored for
  it. The option affects only the checking of dependency declaration files; application
  and test sources remain fully checked, and `packages/contracts-ts` keeps
  `skipLibCheck: false` so the generated contract types are still verified.
- **Node category tokens now follow the registry contract.** `nodeCategoryColorTokens` was
  authored before `NodeCategoryV1` existed and named a different set. It is now declared
  `satisfies Record<NodeCategoryV1, string>`, so a future category added to the contract
  is a compile error until the theme provides a colour for it.
- **React Flow's attribution badge is hidden.** The project owner chose this after being
  shown that the MIT licence does not require the badge and that the upstream project asks
  hiders to buy a subscription. Recorded here because it is a licensing-adjacent product
  decision rather than a styling one.

## 7. Palette and node creation

Four routes create a node, and all four run through `insertPaletteEntry`, so each produces
the same command and the same undo entry:

| Route | Placement |
| --- | --- |
| Drag from the palette | Under the pointer, held by the node's header |
| Click or keyboard-activate a palette item | Middle of the visible canvas |
| Canvas right-click, category submenu | Where the menu was opened |
| Tab quick add, or releasing a connection on empty canvas | Middle of the view, or the release point |

Search covers both display languages at once: a query is matched against every entry's
title, keywords, and description in Simplified Chinese *and* English, plus its technical
type key. So an English term finds a node while the interface is Chinese. Ranking puts a
title match above a keyword, above the type key, above a description mention. Queries are
NFKC-normalized, so a full-width or capitalized query still matches.

Node names are shown Chinese first with the English name as a second line, because
automation documentation and node type keys are written in English.

A node's capability state is `satisfied`, `unavailable`, or `unknown`, and `unknown` is
deliberately distinct: before a runtime connects the editor does not know what the backend
provides, and marking a node unavailable would be a guess.

Releasing a connection over empty canvas opens the quick-add panel filtered to nodes that
actually offer a port the connection can land on; the chosen node arrives already wired,
and the insertion plus the edge are a single undo step. Templates are excluded from that
filter because a template has no single endpoint to attach to.

Tab is claimed only when the graph surface itself holds focus, and Shift+Tab is never
claimed, so keyboard focus always has a way out of the canvas.

A template expands into ordinary registry nodes. The template key appears nowhere in the
saved document, which is asserted by test: a template is authoring assistance, not a
grouping the runtime would have to understand.

## 8. Open gaps

- Compatible-target highlighting, localized inline rejection text, and typed edge styling
  landed in P3-T06 and are documented in `docs/development/TYPED_PORTS_AND_EDGES.md`.
- Favourites and recent nodes are not implemented. The plan lists them as optional and
  they would not have earned their place ahead of the required routes.
- The palette reads capability state with no available-capability set, so every node that
  declares a capability shows as `unknown`. The real set arrives with the runtime registry
  in Phase 4; the state machine already distinguishes the three cases.
- The inspector consumes `selectedNodeIds` but does not exist yet (P3-T07).
- Large-graph measurement, DPI review, and the accessibility sweep landed in P3-T10 and are
  documented in `docs/development/EDITOR_PERFORMANCE_AND_ACCESSIBILITY.md`. That work
  replaced the projection's per-node edge scan with one pass per projection, and added the
  English second line to the node header that section 15.6 of the master plan requires.
  Pointer-to-paint latency, frame pacing, colour contrast, and rendering at real Windows
  scale factors remain open there.
- The runtime restart action lives in the placeholder shown before a project is open. Once
  a project is open, a runtime failure is visible in the top bar but has no restart
  affordance; a runtime control surface is a Phase 4 concern.
