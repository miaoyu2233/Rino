# Signed project export and GitHub publishing

Rino can export the currently open authoring project as a signed `.rino-package` for the
packaged client. It can also publish that same file as a public GitHub Release asset after
an explicit user action.

## Boundaries

- The package contains only `package.rino.json`, its raw 64-byte Ed25519 signature, the
  committed project manifest and graph JSON, and content-addressed PNG project assets.
- Rino graphs are not translated into Maa Pipeline and no WPF source code is copied.
- Recovery data, editor preferences, logs, paths, credentials, captures absent from the
  committed manifest, and local AI files are never included.
- Export reads committed project bytes. The frontend saves the project before calling the
  native exporter so the archive cannot silently lag behind the editor.
- The signing private key is generated from the operating system's cryptographic random
  source and stored in Windows Credential Manager. Only the key ID and public key are
  returned to the frontend for catalog registration.

## Package contract

The ZIP root is fixed:

```text
<package-id>-<version>.rino-package
├─ package.rino.json
├─ signature.ed25519
└─ payload/
   ├─ project.rino.json
   ├─ graphs/*.rino.graph.json
   └─ assets/images/<sha256>.png
```

Every payload file is declared with its byte length, media type, role, and lowercase
SHA-256 in `package.rino.json`. The manifest declares a project package with the project's
entry graph as the stable `main` entry point, protocol version 1, project schema version 1,
Windows x86-64 compatibility, and the project's existing required capability set.

The detached signature covers the exact UTF-8 manifest bytes. Before signing, the exporter
validates the persisted manifest and every graph against the embedded canonical Draft 2020-12
project schema, then verifies cross-file identities, duplicate IDs, capabilities, assets, and
declared hashes. The archive writer uses a fixed file order, stored ZIP entries, bounded file
counts and sizes, and no path supplied by the frontend. Local export writes a unique sibling,
flushes it, reopens the ZIP, hashes it, and only then atomically replaces the selected target;
a failed export preserves any previous target.

## GitHub Release workflow

Rino does not implement OAuth and never stores a GitHub token. Publishing locates the
installed GitHub CLI in its standard Windows locations and requires an existing authenticated
session. The native command accepts only validated owner, repository, version, and package
metadata fields; it never accepts an executable or arbitrary command arguments.

For a missing repository, Rino creates a public repository with a README. For an existing
repository, publishing refuses non-public visibility. It creates `v<version>` as a Release,
or adds the package to an existing matching Release only when the version's asset does not
already exist. Published `packageId` and version pairs are immutable and never clobbered.
The short-lived package under the application cache is deleted after success or failure;
cleanup failure is reported, and startup removes owned package and staging names left by a
terminated process before the application continues.

GitHub publication is the sole user-initiated network exception in the authoring
application. It does not add the package to the packaged client's curated catalog. A catalog
reviewer still needs the displayed package digest, key ID, public key, Release asset ID, and
compatibility metadata before client discovery can expose the package.

The `publisherId` and `publisherDisplayName` package fields are self-declared attribution and
namespace metadata. They are not GitHub identity, authentication, or verification. The active
GitHub CLI login determines the repository/upload identity; the manually entered owner and
repository fields select the target and are checked against that login's permissions.

## GitHub CLI authentication boundary

Rino does not implement OAuth and never reads or stores a GitHub account identifier or token.
The frontend receives only `{ available, authenticated }` from the fixed `publishing_status`,
`publishing_login`, and `publishing_logout` commands. Login delegates to the official GH CLI
browser/device flow; its one-time code is copied by GH CLI for the user to paste. GH CLI owns
all credential handling. If its operating-system credential store is unavailable, GH CLI may
fall back to a plaintext credential file; inspect the resulting state with `gh auth status`.

Rino launches only fixed commands and never passes arbitrary arguments. Authentication command
output is discarded. Publishing keeps only bounded command output needed to distinguish repository
and Release state; no command output is logged or returned to the frontend. Token environment
variables (`GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, and `GITHUB_ENTERPRISE_TOKEN`) and
debug variables (`GH_DEBUG` and `DEBUG`) are removed from every GH child process. Rino also disables
GH telemetry and update checks (`GH_TELEMETRY=false`, `DO_NOT_TRACK=1`,
`GH_NO_UPDATE_NOTIFIER=1`, and `GH_NO_EXTENSION_UPDATE_NOTIFIER=1`).

Logout removes the local GH CLI authentication configuration only. It does not revoke a remote
OAuth token. Rino shows this warning before logout and does not expose the command output or any
account data over IPC.

## Failure behavior

- A cancelled local save dialog creates no package.
- Invalid metadata, malformed committed project JSON, missing graph identity, unavailable or
  hash-mismatched assets, credential-store failure, package write failure, missing GitHub CLI,
  missing authentication, non-public repository visibility, or a failed GitHub command is a
  structured failure.
- Attempting to publish an existing package version is rejected and requires a version bump.
- No GitHub operation runs until the complete signed package has been created successfully.
- GitHub command output is not logged or returned to the frontend.
