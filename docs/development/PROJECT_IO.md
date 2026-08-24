# Project input and output

Covers P3-T09. Describes the on-disk authoring format settled by Decision Gate D-007, who
owns which half of a save, how a commit stays recoverable when it fails, and what the
editor does with a project it cannot read.

## 1. The project directory

A Rino project is a directory, not a file:

```text
ExampleProject/
├─ project.rino.json          the manifest: identity, metadata, graph index, assets
├─ graphs/
│  └─ main.rino.graph.json    one file per graph
└─ assets/
   └─ images/
      └─ <sha256>.png         content-addressed image objects
```

Every name above is written down once, in `graph/project/project-paths.ts` on the frontend
and `project/layout.rs` in the desktop shell. The reserved `.rino-package` extension for
the future distribution archive lives beside them, so the export task reuses the strings
rather than restating them.

The in-memory document (`RinoProjectDocumentV1`) still carries its graphs inline; the split
happens only at the file boundary. Two canonical definitions describe the persisted halves,
both added to `contracts/graph/rino-graph-v1.schema.json` so they share `GraphV1`,
`ImageAssetV1`, and the rest rather than duplicating them:

| Definition          | File                       | Holds                                                                                           |
| ------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- |
| `ProjectManifestV1` | `project.rino.json`        | Everything a project document holds except the graphs, plus the file each graph is stored under |
| `GraphDocumentV1`   | `graphs/*.rino.graph.json` | One `GraphV1`, plus the owning project's `documentId`                                           |

`GraphDocumentV1` repeats `documentId` so a graph file copied from another project is
rejected on open instead of silently adopted.

### Graph file names

The manifest is the authority for what belongs to a project: a graph file present on disk
but absent from the manifest is ignored, and a file the manifest names but the directory
does not hold is an error.

File names are allocated by the editor and never derived from user text. The entry graph
takes `main.rino.graph.json`; every other graph takes the first free `graph-<n>`. The
accepted set is `^[a-z0-9][a-z0-9-]{0,62}\.rino\.graph\.json$` minus the Windows reserved
device stems, which is far narrower than the operating system allows and therefore rules
out separators, drive letters, traversal, uppercase/lowercase pairs, and `con.rino.graph.json`
resolving to the console device. Both sides enforce it: the frontend refuses to emit such a
name, and the shell refuses to write or read one.

A name is assigned once and stored in the manifest. Renaming a graph does not rename its
file, for the same reason renaming an asset does not move its bytes.

The manifest is also the cleanup authority. After a committed save, the desktop shell may
remove only regular files under `graphs/` whose generated names are absent from the
manifest. Unknown names, directories, symlinks, staging siblings, and referenced graph
files are preserved. An unsafe manifest blocks cleanup without deleting anything.

### Image objects

Image assets are content-addressed: an object lives at `assets/images/<contentHash>.png`,
so two records with identical bytes share one object and a rename touches only the record.
Graph nodes reference `assetId`, never the display name or the object path.

Uniqueness of `displayName` is decided after Unicode NFKC normalization, trimming, and case
folding. The check runs twice: once when a record is filed or renamed, and again inside the
transaction that produces the manifest bytes, because a result computed while the user was
still editing cannot promise the manifest being committed is still free of collisions.

## 2. Who owns what

| Concern                                              | Owner                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| Which directory                                      | The user, through a native dialog the desktop shell presents |
| Path resolution, scope, atomicity, size limits       | `src-tauri/src/project/`                                     |
| Serialization, parsing, schema validation, migration | `src/graph/project/`                                         |
| What a failure means to the user                     | `project-actions.ts` and the localized `project.*` catalog   |

No project command accepts a path. The shell keeps the chosen root and later commands name
only files inside the format; the frontend never learns a path it could send back. The root
is canonicalized when it is chosen and when it is opened, so the recovery slot's recorded
origin and a later open of the same directory compare as one path rather than two
spellings.

The frontend produces the exact bytes and the shell writes them. That split keeps
formatting in one place: `serializeProject` rebuilds each document with its keys in the
order the canonical schema declares them, sorts the keys of the free-form JSON inside node
properties and literal inputs, and refuses a value JSON cannot represent rather than
letting `JSON.stringify` quietly emit `null`. Saving the same document twice therefore
produces the same bytes, which is what lets a save that would change nothing be skipped.

`metadata.updatedAt` moves only when the content did. A save serializes the document,
compares it with the text last committed, and returns without writing when they match.

## 3. Committing a project

Every file is written through a sibling staging file:

1. Write `<name>.rino-staging`, flush it, and `sync_all` it to the device.
2. Read it back and parse it as JSON.
3. Replace the target by rename.

A failure at any step leaves the previous valid file in place, and the staging file is
removed. A project spans several files, so all of them are staged and verified before any
of them is replaced, and the manifest is replaced last: the manifest defines what belongs
to the project, so an interruption mid-commit leaves a project that still loads under its
previous manifest rather than one pointing at a file that was never written.

After the manifest is committed, graph and image orphan cleanup run as independent
best-effort maintenance operations. A cleanup failure never turns an already committed
save into a failed save. The application-owned recovery slot applies the same graph-file
authority after each autosave; recovery reading also ignores validly named files absent
from its manifest.

Bounds are enforced before anything is written: 4 MiB for the manifest, 16 MiB per graph
file, 64 graph files, 2,000 image objects, and 256 MiB per object. They match the limits
the canonical schema already states, so a file that passes here cannot fail validation for
size alone.

`save as` creates the new directory, copies the content-addressed image objects across —
only names matching the object pattern, and only within the same bounds — then commits, and
the editor follows the project to its new location. The original directory is left exactly
as it was.

## 4. Reading a project

Everything on disk is untrusted input. `parseProject` runs one order every time:

1. Decode the manifest as JSON.
2. Raise it to the current schema version through the migration ladder.
3. Validate it against `ProjectManifestV1`.
4. Read only the graph files the manifest names; validly named files absent from the
   manifest are ignored.
5. For each graph the manifest names, decode, validate against `GraphDocumentV1`, and check
   that it belongs to this project and to that graph identifier.
6. Check that the entry graph is among the graphs and that no two asset records collide.
7. Assemble the document and validate the assembled result against `RinoProjectDocumentV1`.

A failure at any step reports a localized, actionable reason and — importantly — releases
the directory the shell had already adopted, so a later save cannot write into a project
this build could not read.

### Versions

`CURRENT_PROJECT_SCHEMA_VERSION` is 1 and `PROJECT_MIGRATION_STEPS` is empty, because
version one is the first published format. The harness exists now so the first real
migration is one entry rather than a new subsystem, and it is exercised by a test ladder
from an imagined earlier version.

A manifest declaring a **newer** version is refused rather than opened read-only. Opening it
would still let a later save rewrite fields this build cannot see; the user is told to
update Rino, and nothing is modified. A manifest declaring an older version with no step
that raises it is refused the same way.

## 5. Unsaved work

Three questions can cost a user work, and each has one answer:

| Situation                                                 | Behavior                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| New, Open, or Close with unsaved changes                  | A modal asks: save and continue, discard, or cancel. A failed save never continues. |
| Editing pauses for 15 seconds with unsaved changes        | The document is copied to the recovery slot                                         |
| Opening a project with a recovery slot that belongs to it | A modal offers the restored work or the version on disk                             |

The recovery slot lives under the application data directory, never inside the project
directory: the project directory is what a user publishes, and an autosave is not part of
it. The slot holds one project at a time plus an `origin.json` naming the root it belongs
to, and it is offered only to that project. Saving, creating, or explicitly discarding
clears it. Both the slot and any `.rino-staging` file left by an interrupted save are
recorded in the local privacy denylist and `.gitignore`.

### Known limitation

Closing the application window is **not** intercepted, so it does not raise the unsaved-work
question. Work is still protected by the recovery slot, which is offered the next time the
project is opened, but the last edits made within the autosave quiet period are lost.
Intercepting the window close needs a prevented close plus a frontend round trip, and a
frontend that fails to answer would wedge the window; that trade belongs to a task that can
also test it.

## 6. What is deliberately not here

- **Importing or capturing image bytes.** The record schema, the collision-safe naming,
  the rename command, the content-addressed object layout, and the transactional uniqueness
  recheck are all implemented and tested. The command that reads image bytes from disk or
  from a device is not: its entry point is the device workbench, which is Phase 5, and a
  native command nothing can reach would be dead code.
- **External-change detection and multiple writers.** Rino does not watch the project
  directory, and two Rino windows editing one project would overwrite each other. Single
  local editing is the assumption this task ships under.
- **The `.rino-package` archive.** Distribution packaging is now implemented as a separate,
  explicit publishing boundary described in `PROJECT_PUBLISHING.md`; it remains distinct
  from the editable authoring directory.

## 7. Evidence

| Check                                                         | Covers                                                                                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts-ts/src/graph-contracts.test.ts`           | Manifest and graph-file fixtures, valid and invalid, with bounded diagnostics                                                                 |
| `apps/desktop/src/graph/project/project-format.test.ts`       | Name allocation, byte-stable serialization, round trip, and every parse rejection                                                             |
| `apps/desktop/src/graph/project/project-migration.test.ts`    | The ladder, the newer-version refusal, and an unreadable version                                                                              |
| `apps/desktop/src/graph/project/asset-commands.test.ts`       | Normalization, collision-safe naming, rename, and exact inverses                                                                              |
| `apps/desktop/src/graph/project/project-actions.test.ts`      | Create, skip-unchanged save, `updatedAt` stamping, save-as, failed-write handling, reopen, and recovery                                       |
| `apps/desktop/src/app-shell/ProjectShell.test.tsx`            | Toolbar, keyboard save, the unsaved-work question, and the recovery prompt                                                                    |
| `apps/desktop/src-tauri/tests/project_workspace.rs`           | Layout, path scope including reserved device names, atomic commit, graph/image orphan cleanup, recovery ownership, and save-as object copying |
| `apps/desktop/src-tauri/tests/desktop_shell_configuration.rs` | The reviewed command allowlist, including the graph cleanup command                                                                           |

The native dialogs themselves are not covered by an automated test: presenting them
requires a running desktop shell and a user. Everything behind the dialog — what a chosen
directory must satisfy, and what happens to the files afterwards — is covered above.
