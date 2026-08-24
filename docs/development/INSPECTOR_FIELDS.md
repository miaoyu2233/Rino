# Inspector and node fields

Covers P3-T07. Describes the subset of a property schema the editor can draw, how a value
is validated before it reaches the document, how one edit becomes one undo entry, and why
the inspector and the fields drawn on a node cannot disagree.

## 1. Where a node's configuration comes from

A node holds two kinds of configurable value, and they are not interchangeable:

| Value | Stored in | Declared by | Command |
| --- | --- | --- | --- |
| Property | `NodeV1.properties` | `NodeDefinitionV1.propertySchema` | `setNodeProperty` |
| Inline literal | `NodeV1.inputValues` | A data input port with `acceptsLiteral` | `setInputValue` |
| Alias | `NodeV1.displayAlias` | Nothing; it is authoring metadata | `setDisplayAlias` |

A property configures behavior that no port supplies. An inline literal is the fallback
value of a data input that carries no connection; connecting an edge to that port makes
the literal inert, and the inspector says so rather than leaving two sources of truth on
screen. The alias changes only what the canvas shows: the type key, type version, ports,
and execution identity are untouched, which is asserted by test.

## 2. The property schema subset

`readPropertyFields` reads `propertySchema` as a JSON Schema object schema and produces one
field per declared property. The registry sends localization keys rather than translated
text, and JSON Schema has no keyword for that, so four vendor keywords carry them. An
unknown keyword is ignored by a standard validator, so the same schema still validates a
value elsewhere.

| Keyword | Meaning |
| --- | --- |
| `x-rinoLabelKey` | Localization key for the field label. Required. |
| `x-rinoDescriptionKey` | Localization key for the hover help. |
| `x-rinoUnitKey` | Localization key for the unit shown beside a numeric field. |
| `x-rinoOptionLabelKeys` | Map from each `enum` value to its localization key. |

The drawn subset is deliberately narrow:

| Declaration | Control | Honoured keywords |
| --- | --- | --- |
| `type: "boolean"` | Checkbox | — |
| `type: "string"` | Text field | `minLength`, `maxLength` |
| `type: "string"` with `enum` | Choice list | `x-rinoOptionLabelKeys` |
| `type: "number"` or `"integer"` | Numeric field | `minimum`, `maximum`, `x-rinoUnitKey` |

`required` on the object schema marks a field that refuses to be emptied. The default a
`Reset` action returns to comes from `propertyDefaults`, which is also what node insertion
copies into a new node, so the two can never name different defaults.

`pattern` is deliberately not honoured. A regular expression arriving over the runtime
boundary is untrusted input and evaluating one on every keystroke is a denial-of-service
surface; pattern-shaped configuration belongs to the specialist regular-expression editor
of its own later task.

Anything else — an array, a nested object, a missing label key, an `enum` whose options
have no labels, a declaration that is not an object at all — becomes a field with no
editor. Its stored value is still shown, read-only, with the reason. A document is never
reduced to what this build happens to understand, and a definition may legitimately
describe a value that belongs to a specialist editor a later task introduces.

Two bounds apply because a definition crosses the runtime boundary: at most
`MAXIMUM_PROPERTY_FIELDS` (64) fields are drawn, and the count of any that were not is
reported in the panel rather than silently dropped.

## 3. Which inputs get an inline editor

`literalEditorFor` maps a port type to a control. Only `bool`, `number`, and `string` have
one, and an `optional<T>` is edited with the editor of `T`. A rectangle, point, image
handle, recognition result, or collection has no written form a user could be expected to
type correctly, so those ports are shown with the reason they cannot be edited here: their
value comes from a connection, or, in a later task, from picking it in the device
workbench.

Text fields are bounded by the persisted format's own limits (`MAXIMUM_TEXT_VALUE_LENGTH`,
`MAXIMUM_DISPLAY_ALIAS_LENGTH`), so an over-long value is refused while it is being typed,
naming the field, rather than at save time when the user has moved on.

An inline value is removed by emptying its field. A required input refuses that and says
why, because the resulting graph would be one the user cannot run.

## 4. Validation happens before the document changes

`parseFieldInput` is the only path from typed text to a stored value. An entry that fails
validation is kept in the field with the reason written beneath it and never reaches a
command, so the document holds no value that validation would reject. String lengths are
counted in code points, which is how the persisted schema counts them, so the editor
refuses exactly what a save would refuse.

The inverse check also runs: `matchesEditor` compares a stored value against the editor
that should hold it. A document written by a newer definition, edited by hand, or saved
before a definition changed shows a mismatch notice instead of being silently rewritten.

## 5. One interaction, one undo entry

Typing produces no command. A command is created when an edit is committed — on blur, on
`Enter`, on a checkbox toggle, on a choice selection, or on `Reset` — so a three-character
number is one undo entry rather than three. `Escape` returns the field to the document's
value without committing.

Every field edit goes through `field-commands.ts`, which reads the active graph and the
document store at commit time rather than capturing them when a control rendered. An edit
therefore can never be applied to a graph that an earlier command has already replaced.

## 6. Why the two surfaces cannot drift

The inspector and the fields drawn on a node body are the same `FieldControl` component,
resolve their editor through the same `literalEditorFor`, validate through the same
`parseFieldInput`, and commit through the same `commitInputLiteral`. Neither holds a copy
of the value: both read the document.

Inside the control, the draft text is authoritative only while the control has focus. An
edit arriving from elsewhere — an undo, the other surface, a future runtime event — updates
the document and is shown as soon as focus leaves, but never rewrites what the user is in
the middle of typing. That is the whole of the synchronization rule, and it is asserted by
test in both directions.

The panel subscribes to the selected node object and to a string signature of that node's
connected inputs, not to the graph's node array, so an edit elsewhere in the graph does not
re-render it.

## 7. Deferred to their owning tasks

Three parts of the P3-T07 description are not implemented here, because implementing them
now would mean inventing registry content that does not exist yet:

- **Recognition-method selectors.** The mechanism a method selector needs is a property
  whose value decides which other properties apply, together with a preview of the
  configuration a switch would discard. No definition declares a recognition method today,
  and deciding which methods Rino offers is a product decision that belongs with the
  MaaFramework recognition work in Phase 6.
- **Picking a rectangle, point, or capture asset from the device workbench.** No node
  currently accepts a rectangle, point, or asset reference as a property or literal, and
  the device workbench that would supply one arrives in Phase 5. The inspector already
  states, for every such input, that its value comes from a connection.
- **Specialist region and regular-expression editors.** The plan assigns these to their own
  later tasks.

An unsupported field is a stated state with a written reason, not a placeholder: the value
is preserved and the user is told why it cannot be edited here.
