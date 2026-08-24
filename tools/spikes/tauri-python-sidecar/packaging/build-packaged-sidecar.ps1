[CmdletBinding()]
param(
    [string]$OutputRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$spikeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $spikeRoot "..\..\.."))
$localReleaseRoot = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot "release-local"))
$resolvedOutputRoot = if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    Join-Path $localReleaseRoot "sidecar-packaging-spike"
}
else {
    [System.IO.Path]::GetFullPath($OutputRoot)
}

$releasePrefix = $localReleaseRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedOutputRoot.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must be inside the repository release-local directory."
}

$targetTriple = ([string](& rustc --print host-tuple)).Trim()
if ($LASTEXITCODE -ne 0 -or $targetTriple -ne "x86_64-pc-windows-msvc") {
    throw "This Phase 0 packaging spike requires the x86_64-pc-windows-msvc host toolchain."
}

if (Test-Path -LiteralPath $resolvedOutputRoot) {
    Remove-Item -LiteralPath $resolvedOutputRoot -Recurse -Force
}

$distRoot = Join-Path $resolvedOutputRoot "pyinstaller-dist"
$workRoot = Join-Path $resolvedOutputRoot "pyinstaller-work"
$specRoot = Join-Path $resolvedOutputRoot "pyinstaller-spec"
$stageRoot = Join-Path $resolvedOutputRoot "tauri-boundary-fixture"
$binaryRoot = Join-Path $stageRoot "binaries"
$sourceScript = Join-Path $spikeRoot "sidecar\runtime_sidecar.py"

New-Item -ItemType Directory -Path $distRoot, $workRoot, $specRoot, $binaryRoot -Force | Out-Null

& uv run --frozen --project $spikeRoot pyinstaller `
    --noconfirm `
    --clean `
    --onedir `
    --name "rino-runtime-sidecar" `
    --contents-directory "rino-runtime-sidecar-support" `
    --distpath $distRoot `
    --workpath $workRoot `
    --specpath $specRoot `
    $sourceScript
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed to build the packaged Sidecar."
}

$builtRoot = Join-Path $distRoot "rino-runtime-sidecar"
$builtExecutable = Join-Path $builtRoot "rino-runtime-sidecar.exe"
$builtSupport = Join-Path $builtRoot "rino-runtime-sidecar-support"
$stagedExecutable = Join-Path $binaryRoot "rino-runtime-sidecar-$targetTriple.exe"
$stagedSupport = Join-Path $binaryRoot "rino-runtime-sidecar-support"

if (-not (Test-Path -LiteralPath $builtExecutable -PathType Leaf)) {
    throw "The frozen Sidecar executable was not produced."
}
if (-not (Test-Path -LiteralPath $builtSupport -PathType Container)) {
    throw "The frozen Sidecar support directory was not produced."
}

Copy-Item -LiteralPath $builtExecutable -Destination $stagedExecutable
Copy-Item -LiteralPath $builtSupport -Destination $stagedSupport -Recurse
Copy-Item -LiteralPath (Join-Path $spikeRoot "tauri-boundary-fixture\tauri.conf.json") -Destination $stageRoot
Copy-Item -LiteralPath (Join-Path $spikeRoot "tauri-boundary-fixture\capabilities") -Destination $stageRoot -Recurse

$tauriConfig = Get-Content -Raw -LiteralPath (Join-Path $stageRoot "tauri.conf.json") | ConvertFrom-Json
if (@($tauriConfig.bundle.externalBin) -notcontains "binaries/rino-runtime-sidecar") {
    throw "The staged Tauri fixture does not declare the expected external binary base name."
}
if (@($tauriConfig.bundle.resources) -notcontains "binaries/rino-runtime-sidecar-support/") {
    throw "The staged Tauri fixture does not include the onedir support resources."
}

$artifact = Get-Item -LiteralPath $stagedExecutable
$artifactHash = Get-FileHash -Algorithm SHA256 -LiteralPath $stagedExecutable
[pscustomobject]@{
    schemaVersion = 1
    targetTriple = $targetTriple
    bundler = "PyInstaller 6.21.0 onedir spike"
    executablePath = $artifact.FullName
    executableBytes = $artifact.Length
    executableSha256 = $artifactHash.Hash
    supportDirectory = $stagedSupport
    tauriFixture = $stageRoot
} | ConvertTo-Json -Depth 3
