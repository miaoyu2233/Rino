[CmdletBinding()]
param(
    [string]$WfpRepositoryRoot = "",
    [string]$PlatformToolsArchive = "",
    [string]$OutputRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "release-local"))
$resolvedWfpRoot = if ([string]::IsNullOrWhiteSpace($WfpRepositoryRoot)) {
    [IO.Path]::GetFullPath((Join-Path $repositoryRoot "_WFP"))
}
else {
    [IO.Path]::GetFullPath($WfpRepositoryRoot)
}
$resolvedPlatformToolsArchive = if ([string]::IsNullOrWhiteSpace($PlatformToolsArchive)) {
    [IO.Path]::GetFullPath(
        (Join-Path $releaseRoot "platform-tools-latest-windows.zip")
    )
}
else {
    [IO.Path]::GetFullPath($PlatformToolsArchive)
}
$resolvedOutputRoot = if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    [IO.Path]::GetFullPath((Join-Path $releaseRoot "rino-wfp-template"))
}
else {
    [IO.Path]::GetFullPath($OutputRoot)
}

$releasePrefix =
    $releaseRoot.TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ) + [IO.Path]::DirectorySeparatorChar
if (-not $resolvedOutputRoot.StartsWith(
    $releasePrefix,
    [StringComparison]::OrdinalIgnoreCase
)) {
    throw "OutputRoot must be inside the repository release-local directory."
}
if (-not (Test-Path -LiteralPath (Join-Path $resolvedWfpRoot "MFAWPF.csproj"))) {
    throw "The Rino_WFP repository root is unavailable."
}
if (-not (Test-Path -LiteralPath $resolvedPlatformToolsArchive -PathType Leaf)) {
    throw "The pinned Windows Platform Tools archive is unavailable."
}

$expectedPlatformToolsSha256 =
    "45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99"
$actualPlatformToolsSha256 = (
    Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedPlatformToolsArchive
).Hash.ToLowerInvariant()
if ($actualPlatformToolsSha256 -ne $expectedPlatformToolsSha256) {
    throw "The Windows Platform Tools archive SHA-256 is not the pinned 37.0.1 digest."
}

if (Test-Path -LiteralPath $resolvedOutputRoot) {
    $resolvedOutput = (Resolve-Path -LiteralPath $resolvedOutputRoot).Path
    if (-not $resolvedOutput.StartsWith(
        $releasePrefix,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Refusing to replace output outside release-local."
    }
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
}

$runtimeBuildRoot = Join-Path $resolvedOutputRoot "runtime-build"
$runtimeDistRoot = Join-Path $runtimeBuildRoot "dist"
$runtimeWorkRoot = Join-Path $runtimeBuildRoot "work"
$runtimeSpecRoot = Join-Path $runtimeBuildRoot "spec"
$wpfPublishRoot = Join-Path $resolvedOutputRoot "wpf-publish"
$platformToolsRoot = Join-Path $resolvedOutputRoot "platform-tools-extract"
$templateRoot = Join-Path $resolvedOutputRoot "template"
$runtimeTargetRoot = Join-Path $templateRoot "runtime"
$adbTargetRoot = Join-Path $runtimeTargetRoot "platform-tools"
New-Item -ItemType Directory -Path @(
    $runtimeDistRoot,
    $runtimeWorkRoot,
    $runtimeSpecRoot,
    $wpfPublishRoot,
    $platformToolsRoot,
    $templateRoot,
    $runtimeTargetRoot,
    $adbTargetRoot
) -Force | Out-Null

$uvArguments = @(
    "run",
    "--frozen",
    "--project",
    (Join-Path $repositoryRoot "services\runtime"),
    "--with",
    "pyinstaller==6.21.0",
    "pyinstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--name",
    "rino-runtime",
    "--contents-directory",
    "_internal",
    "--distpath",
    $runtimeDistRoot,
    "--workpath",
    $runtimeWorkRoot,
    "--specpath",
    $runtimeSpecRoot,
    "--paths",
    (Join-Path $repositoryRoot "services\runtime\src"),
    "--collect-all",
    "maa",
    "--collect-all",
    "MaaAgentBinary",
    "--copy-metadata",
    "MaaFw",
    "--copy-metadata",
    "MaaAgentBinary",
    (Join-Path $repositoryRoot "services\runtime\src\rino_runtime\__main__.py")
)
& uv @uvArguments
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed to build the Rino runtime."
}

$dotnetArguments = @(
    "publish",
    (Join-Path $resolvedWfpRoot "MFAWPF.csproj"),
    "-c",
    "Release",
    "-r",
    "win-x64",
    "--self-contained",
    "true",
    "-p:PublishSingleFile=false",
    "-o",
    $wpfPublishRoot
)
& dotnet @dotnetArguments
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed to build Rino_WFP."
}

Copy-Item -Path (Join-Path $wpfPublishRoot "*") -Destination $templateRoot -Recurse
$runtimeBuiltRoot = Join-Path $runtimeDistRoot "rino-runtime"
Copy-Item -Path (Join-Path $runtimeBuiltRoot "*") -Destination $runtimeTargetRoot -Recurse

Expand-Archive -LiteralPath $resolvedPlatformToolsArchive -DestinationPath $platformToolsRoot
$platformToolsPayload = Join-Path $platformToolsRoot "platform-tools"
$requiredAdbFiles = @(
    "adb.exe",
    "AdbWinApi.dll",
    "AdbWinUsbApi.dll",
    "libwinpthread-1.dll",
    "NOTICE.txt",
    "source.properties"
)
foreach ($fileName in $requiredAdbFiles) {
    $sourcePath = Join-Path $platformToolsPayload $fileName
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "The pinned Platform Tools archive is missing $fileName."
    }
    Copy-Item -LiteralPath $sourcePath -Destination $adbTargetRoot
}

$requiredOcrFiles = @(
    [pscustomobject]@{
        Path = "Resource\base\model\ocr\det.onnx"
        Bytes = 4748769L
        Sha256 = "8c3b7ee97913a7942b8565669dc9acbe8846fbbaf4b63e1d7fdb339005574a33"
    },
    [pscustomobject]@{
        Path = "Resource\base\model\ocr\rec.onnx"
        Bytes = 16517247L
        Sha256 = "31fb844ce3a4aaf13e4bea62ae35f43bd9a509966061980c30db9b248c542a6b"
    },
    [pscustomobject]@{
        Path = "Resource\base\model\ocr\keys.txt"
        Bytes = 92395L
        Sha256 = "1ea29636956177e400af712d9782e7693f3fb25f98617bed10479d2965a836fd"
    }
)
foreach ($requiredOcrFile in $requiredOcrFiles) {
    $ocrPath = Join-Path $templateRoot $requiredOcrFile.Path
    if (-not (Test-Path -LiteralPath $ocrPath -PathType Leaf)) {
        throw "The Rino_WFP template is missing pinned OCR file $($requiredOcrFile.Path)."
    }
    if ((Get-Item -LiteralPath $ocrPath).Length -ne $requiredOcrFile.Bytes) {
        throw "The pinned OCR file $($requiredOcrFile.Path) has an unexpected length."
    }
    $ocrSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $ocrPath).Hash.ToLowerInvariant()
    if ($ocrSha256 -ne $requiredOcrFile.Sha256) {
        throw "The pinned OCR file $($requiredOcrFile.Path) has an unexpected SHA-256 digest."
    }
}
$requiredTemplatePaths = @(
    "Rino.exe",
    "runtime\rino-runtime.exe",
    "runtime\platform-tools\adb.exe",
    "runtime\platform-tools\AdbWinApi.dll",
    "runtime\platform-tools\AdbWinUsbApi.dll",
    "runtime\platform-tools\libwinpthread-1.dll",
    "runtime\platform-tools\NOTICE.txt",
    "runtime\_internal\MaaAgentBinary\LICENSE",
    "Resource\base\model\ocr\det.onnx",
    "Resource\base\model\ocr\rec.onnx",
    "Resource\base\model\ocr\keys.txt"
)
foreach ($relativePath in $requiredTemplatePaths) {
    if (-not (Test-Path -LiteralPath (Join-Path $templateRoot $relativePath) -PathType Leaf)) {
        throw "The Rino_WFP template is missing required file $relativePath."
    }
}

[xml]$project = Get-Content -Raw -LiteralPath (Join-Path $resolvedWfpRoot "MFAWPF.csproj")
$versionNode = $project.SelectSingleNode("/Project/PropertyGroup/Version")
if ($null -eq $versionNode -or [string]::IsNullOrWhiteSpace($versionNode.InnerText)) {
    throw "The Rino_WFP project version is unavailable."
}
$templateVersion = $versionNode.InnerText
$wfpCommit = ([string](& git -C $resolvedWfpRoot rev-parse HEAD)).Trim()
$rinoCommit = ([string](& git -C $repositoryRoot rev-parse HEAD)).Trim()
$manifest = [ordered]@{
    schemaVersion = 1
    templateId = "rino-wfp-win-x64"
    templateVersion = $templateVersion
    platform = "windows"
    architecture = "x86_64"
    sidecarProtocolVersion = 1
    wfpCommit = $wfpCommit
    rinoCommit = $rinoCommit
    platformToolsRevision = "37.0.1"
    platformToolsArchiveSha256 = $expectedPlatformToolsSha256
    requiredPaths = $requiredTemplatePaths |
        ForEach-Object { $_.Replace("\", "/") }
}
$manifestPath = Join-Path $templateRoot "rino-wfp-template-v1.json"
$manifestJson = $manifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText(
    $manifestPath,
    $manifestJson,
    [Text.UTF8Encoding]::new($false)
)

$templateArchive = Join-Path $resolvedOutputRoot "Rino-WFP-win-x64.zip"
Compress-Archive -Path (Join-Path $templateRoot "*") -DestinationPath $templateArchive -CompressionLevel Optimal
$templateArchiveHash = (
    Get-FileHash -Algorithm SHA256 -LiteralPath $templateArchive
).Hash.ToLowerInvariant()

[pscustomobject]@{
    schemaVersion = 1
    templateArchive = $templateArchive
    templateArchiveBytes = (Get-Item -LiteralPath $templateArchive).Length
    templateArchiveSha256 = $templateArchiveHash
    templateVersion = $templateVersion
    wfpCommit = $wfpCommit
    rinoCommit = $rinoCommit
    platformToolsRevision = "37.0.1"
} | ConvertTo-Json -Depth 3