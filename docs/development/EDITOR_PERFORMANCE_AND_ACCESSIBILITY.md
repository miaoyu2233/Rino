# Editor performance and accessibility gate

Covers P3-T10. Describes the measurement scenes, the budgets the editor is held to, what
was measured and found, and which parts of the gate an automated check cannot answer.

## 1. Measurement scenes

`apps/desktop/src/test/graph-scenes.ts` builds the three scenes the performance plan names
(master plan section 18.4), at exactly its node and edge totals:

| Scene | Nodes | Edges | Shape | Digest |
| --- | --- | --- | --- | --- |
| `small` | 100 | 150 | Flow and arithmetic nodes only | `f9baa5b9` |
| `reference` | 500 | 750 | Mixed: adds sequence, capture, and recognition nodes | `177bb2f1` |
| `stress` | 1000 | 1500 | Flow and arithmetic nodes only | `96449b80` |

A scene is built from repeating units rather than stored as a fixture file, so a change to
the node registry cannot leave a checked-in document describing nodes that no longer exist.
Both unit shapes carry exactly 1.5 edges per node, which is what keeps the totals equal to
the plan's numbers whatever mixture a scene uses.

Every identifier is derived by hashing a name, so a scene rebuilds byte-identically: no
clock, no random source, no `crypto.randomUUID`. `sceneDigest` is recorded beside a
measurement, because a number quoted against a scene that has since changed is not
evidence. The digests above are asserted in `graph-scenes.test.ts`, so a scene cannot drift
without the change appearing in a diff.

Every scene validates with **zero diagnostics**. A scene used to measure editing must not
also be measuring the cost of drawing a thousand problem rows.

## 2. What is measured, and where

| Question | Held by | Layer |
| --- | --- | --- |
| How much of the document is re-derived per edit | `graph-projection-cost.test.ts` | Pure projection |
| How many node components React has to render per interaction | `canvas-interaction-cost.test.tsx` | Real canvas, real store |
| What the problems panel costs on a large invalid graph | `problems-cost.test.ts` | Validation and row assembly |
| Layout at every supported Windows scale factor | `display-scaling.test.tsx` | Application frame |
| Per-monitor scale transitions | `useWindowMetrics.test.tsx` | Desktop window boundary |
| Structural accessibility, labels, status, bilingual titles, expansion | `editor-accessibility.test.tsx` | Whole application |
| Reduced motion and continuous animation | `tools/verify-design-system-build.ps1` | Shipped stylesheet |

### Budgets these tests enforce

- Re-projecting an unchanged graph rebuilds **no** node or edge view, at every scene size.
- Moving a node, editing a property, or creating a connection rebuilds **exactly one** node
  view, at every scene size. Creating a connection additionally builds exactly one edge
  view.
- Opening the 500-node reference scene renders each node component **once**.
- Moving a node, creating a connection, or moving the selection in the 500-node scene
  renders **one** node component, not five hundred.
- Beginning a connection drag renders **no** node component: compatible-target
  highlighting is subscribed per port.
- Typing into an inline field renders **no** node component: a draft is held in the control
  and produces no command.
- Building the problems panel's rows costs time proportional to the number of problems, not
  to problems multiplied by graph size.
- The canvas keeps at least 480 by 320 logical pixels at 100, 125, 150, 175, and 200
  percent scaling on a 1920 by 1080 display, in both themes.

## 3. What the measurement found

Two pieces of quadratic work were found by building the scenes and fixed in this task.

**The projection scanned every edge once per node.** `connectedInputSignature` walked
`graph.edges` for each node to learn which of its inputs were already connected, and it did
so before the identity cache could short-circuit — so the scan ran on *every* re-projection,
including ones that rebuilt nothing. The scan is now one pass building a map
(`connectedInputsByNode`). Re-projecting the stress scene fell from **4.7 ms to 0.4 ms**, and
a cold projection from **5.1 ms to 0.9 ms**. The persisted format allows five thousand nodes
and ten thousand edges, where the old shape would have cost roughly twenty-five times the
stress-scene figure.

**The problems panel looked each node up by scanning the node array.**
`describeProblemSubject` called `graph.nodes.find` once per row, twice for a port-scoped
problem. On the stress scene with every connection removed — 1000 nodes, 1250 diagnostics —
those scans alone cost **7.9 ms**, about a third of the whole row-assembly pass. The
document is now indexed once per document (`indexDocumentForSubjects`). The same shape at
the format's five-thousand-node limit would have breached the 100 ms command budget on the
lookups alone.

Measured on the development machine with the pinned toolchain, against the digests above:

| Pass | `small` | `reference` | `stress` |
| --- | --- | --- | --- |
| Cold projection (nodes and edges) | 0.27 ms | 0.82 ms | 0.87 ms |
| Re-projection after an edit | 0.10 ms | 0.33 ms | 0.38 ms |
| Validate, order, and describe an unwired scene | — | 439 problems | 1250 problems, 24 ms |

These are node-level numbers from the test runner, not browser frame times. They are
recorded so a later change can be compared against them, not as a claim about what the user
perceives.

## 4. Accessibility findings

The sweep is automated where a document without layout can answer the question:

- No structural violation is reported by an audit of the whole application with a graph
  open and its diagnostics listed, in both the light and the warm-neutral dark theme.
- Every button and every element with a button role carries an accessible name.
- No control is given a forced tab position.
- A node's disabled and breakpoint state is stated in words as well as in colour, and a
  problem row names its severity.
- A node header shows its Simplified Chinese name with the English name on a second line,
  and follows a language change. This was **added in this task**: the header previously
  showed one name, which did not meet master plan section 15.6. The palette and the header
  now resolve their names through one boundary, `localization/bilingual-title.ts`, so a node
  cannot be called one thing in the list it is dragged from and another on the canvas.
- An icon action's tooltip opens as soon as the keyboard reaches it, rather than after the
  hover delay a pointer user waits out.
- Text expansion is exercised by rendering the whole application in English, which is over
  thirty percent longer than the Simplified Chinese catalog by character count; every region
  and control keeps its accessible name.
- A truncating canvas label keeps its full text in a `title` attribute.

## 5. Open gaps

These are recorded rather than closed, with the reason and the work that owns them.

- **Pointer-to-paint latency and frame pacing are not measured.** The plan asks for both.
  The test environment has no layout engine, no compositor, and no frame clock; a number
  produced there would be fiction. Measuring them needs a browser-driving harness, which
  is a new production-adjacent dependency this task did not introduce on its own authority.
  What is enforced instead is the work per interaction — the render counts in section 2 —
  which is the input to frame pacing rather than a substitute for it.
- **Connection rendering is not counted at the component layer.** The graph library draws an
  edge only once both endpoints have been measured, and nothing is measured without a
  layout engine, so no edge component ever mounts in the test environment. Edge cost is
  held to a budget one layer down, in the projection.
- **Colour contrast is not checked.** The audit disables the contrast rule because it needs
  computed colours from real stylesheets. Contrast in both themes remains a manual check on
  the running desktop application, as it has been since P1-T03.
- **The 100 to 200 percent scaling matrix is checked as layout, not as rendering.** The
  frame's response to each scale factor is asserted, and the per-monitor transition is
  asserted against the desktop window boundary. Whether text, ports, icons, focus rings,
  and one-pixel separators stay crisp at each scale, and across a real mixed-DPI monitor
  move, is a visual check on Windows and remains an explicit acceptance gate.
- **The problems list is not virtualized.** P3-T08 deferred this measurement here. The data
  it needs is cheap — 24 ms to validate, order, and describe 1250 problems on a
  thousand-node graph — but the rows themselves are rendered in full. A project with nothing
  wired up is exactly when the list is longest. No budget is breached by anything measurable
  here, and the master plan does not list this panel among the lists to virtualize, so it is
  left as a known cost rather than changed speculatively.
- **Keyboard focus is lost when a responsive collapse removes the focused control.** Moving
  to a narrower or higher-scaled display replaces the palette column with a rail; if the
  palette search held focus, focus falls back to the document body. The selection survives
  and the palette stays reachable through the rail. Master plan section 15.14 asks for focus
  to be preserved "when possible", and where the control ceases to exist the question is
  where focus *should* go — a product decision rather than a defect to patch inside a
  measurement task.
- **A deterministic fake device preview does not exist yet**, so the Phase 3 exit gate's
  "measured while a fake preview refreshes" condition cannot be exercised. The preview
  pipeline is P5-T06; building one here would pre-empt it.

## 6. Cost of the gate itself

Opening the 500-node scene in the test environment takes seconds, and an accessibility
audit takes seconds more. Both suites therefore state an explicit generous timeout: the
assertion is the render count or the violation list, and a loaded machine must not turn a
slow environment into a false failure. The default timeout did catch one real regression
while this task was being written — a per-node lookup in every display language, added with
the bilingual header and removed by binding the translators once — so the ceiling is set
high rather than removed.
