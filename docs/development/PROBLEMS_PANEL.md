# Problems panel

Covers P3-T08. Describes where the editor's graph diagnostics come from, what makes a
revalidation incremental, how a problem is turned into navigation, and which surface owns
each part of a reveal.

## 1. One panel, two sources

The problems tab of the bottom debug panel shows two things a user cannot usefully tell
apart:

| Section | Source | Lifetime |
| --- | --- | --- |
| Graph diagnostics | Derived from the open document on every edit | Ends when the edit that caused it is undone or fixed |
| Application and runtime problems | Reported by an error boundary or a service into the diagnostic store | Stays until dismissed |

`ProblemsPanel` composes them and owns the single empty state. `GraphProblemsSection`
renders nothing when no project is open; `ProblemsList` renders nothing when nothing has
been reported. Neither draws its own empty state, so the panel never shows two.

Graph diagnostics are never dismissible. They are a statement about the document as it is
right now, so dismissing one would only hide the document from the user. Application
problems remain dismissible because they describe something that already happened.

## 2. Incremental revalidation

`validate-graph.ts` exposes the validator in two pieces rather than only as one pass:

| Entry point | Produces |
| --- | --- |
| `DocumentValidator.validateStructure(document)` | Duplicate graph identifiers, a missing entry graph, asset identifier and name collisions |
| `DocumentValidator.validateGraph(graph)` | Everything about one graph's nodes, ports, and edges |
| `validateProjectDocument(document, registry, options)` | The full pass, assembled from both |

A graph's diagnostics depend on that graph, on the registry snapshot, and on the advertised
capabilities — and on nothing else in the document. `createIncrementalValidation` uses that
fact: a command replaces only the graph it edits, so object identity is an exact record of
what an edit touched, and the diagnostics of every other graph are reused unchanged.
Document structure is always rechecked because its cost is proportional to the number of
graphs and assets rather than to the size of the graph being edited.

The cache is discarded whenever the registry snapshot or the capability set changes, and a
graph the document no longer contains is evicted so a re-added graph is revalidated rather
than served a stale entry. Tests assert that an incremental pass and a full pass over the
same inputs are equal, and that the untouched graph's diagnostic objects are the *same
objects* — equality alone would not prove anything was reused.

The panel holds the validator instance, so the cache is released with the panel and no
validation runs while the problems tab is closed.

## 3. The commitment checkpoint

Incremental validation is what the editor shows while the user works. `validateProjectDocument`
remains the full pass and is what a commitment point calls: project save (P3-T09) and run
(Phase 4) validate the whole document rather than trusting a cache. Both paths produce the
same diagnostic codes in the same order, which is what makes the panel's verdict and the
gate's verdict the same verdict.

`ValidationReport.executable` is false while any error-severity diagnostic remains. The
panel states that in words rather than only by colour.

## 4. From a diagnostic to navigation

A diagnostic names its location by identifier. `focusTargetOf` reduces that to what the
editor can act on:

| Location scope | Reveals |
| --- | --- |
| `graph` | The graph becomes active |
| `node` | The node is selected and centred |
| `port` | The node is selected and centred, and the inspector field for that port takes focus |
| `edge` | The connection is selected and the viewport centres between its endpoints |
| `document`, `asset` | Nothing; the row is listed but is not activatable |

`revealProblem` sequences the three stores a reveal touches — the editor session (active
graph and selection), the layout preference (the right workbench opens on the inspector for
a node or port problem), and the focus request — so a problem behaves identically however
it was activated.

The request itself carries a monotonic `requestId`. Activating the same problem twice must
reveal it again, which an otherwise identical target could not express.

Each surface answers only the part of a request it owns and remembers the last request it
answered:

- `GraphCanvas` applies the selection to its render state and calls `setCenter`. The reveal
  animation uses the panel motion tier and is instant under reduced motion.
- `InspectorPanel` moves keyboard focus to the field marked with the port's field key. It
  waits until the named node is both selected and rendered, so it never races the selection
  change instead of following it.

A request is cleared when the project closes, because reopening the same project would
otherwise replay a reveal against a freshly loaded graph.

## 5. Localization

Diagnostics carry a message key and bounded scalar parameters rather than translated text,
so a diagnostic produced by the editor and one produced by the Python runtime read the same
way in the user's language. `translateDataMessage` is the boundary for a key that arrives as
data and interpolates values; a key with no catalog entry falls back to the stable code
rather than rendering blank.

The location of a problem is shown as separate breadcrumb pieces — graph, node, port — and
never as an assembled sentence, so no translation is built from fragments. A node is named
by the user's alias when they set one, by the definition's localized title otherwise, and by
its raw type key when the registry has no definition for it.

## 6. Known limits

- Validation runs only while the problems tab is open. A count badge on the tab would
  require always-on validation and is not implemented.
- `availableCapabilities` is not passed yet: no runtime advertises capabilities in Phase 3,
  so capability diagnostics stay silent rather than claiming a node cannot run.
- The list is not virtualized. It is bounded in practice by the document rather than by
  time, but a very large invalid document will render one row per diagnostic; P3-T10
  measures the editor at scale and is the place to revisit this.
