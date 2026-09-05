[CmdletBinding()]
param(
    [string]$PlatformToolsArchive = "",
    [string]$IsccPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-File {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [long]$MinimumBytes = 1,
        [string]$Description = "file"
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required $Description is missing: $Path"
    }
    $item = Get-Item -LiteralPath $Path
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Required $Description must not be a reparse point: $Path"
    }
    if ($item.Length -lt $MinimumBytes) {
        throw "Required $Description is unexpectedly small: $Path"
    }
    return $item
}

function Assert-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [string]$Description = "directory"
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "Required $Description is missing: $Path"
    }
    $item = Get-Item -LiteralPath $Path
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Required $Description must not be a reparse point: $Path"
    }
    return $item
}

function Assert-InReleaseOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$ReleaseRoot,
        [string]$Description = "path"
    )

    $releasePrefix = $ReleaseRoot.TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ) + [IO.Path]::DirectorySeparatorChar
    if (-not $Path.StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Description must stay under release-local: $Path"
    }
}

function Remove-SafeOutputDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$ReleaseRoot
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    $resolvedPath = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
    Assert-InReleaseOutput -Path $resolvedPath -ReleaseRoot $ReleaseRoot -Description "Deletion target"
    if ((Get-Item -LiteralPath $resolvedPath).PSIsContainer -eq $false) {
        throw "Refusing to recursively remove a non-directory output path: $resolvedPath"
    }
    if ((Get-Item -LiteralPath $resolvedPath).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing to recursively remove a reparse-point output path: $resolvedPath"
    }
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot "release-local"))
$outputRoot = [IO.Path]::GetFullPath((Join-Path $releaseRoot "rino-installer"))
$stageRoot = Join-Path $outputRoot "stage"
$runtimeBuildRoot = Join-Path $outputRoot "runtime-build"
$runtimeDistRoot = Join-Path $runtimeBuildRoot "dist"
$runtimeWorkRoot = Join-Path $runtimeBuildRoot "work"
$runtimeSpecRoot = Join-Path $runtimeBuildRoot "spec"
$platformToolsExtractRoot = Join-Path $outputRoot "platform-tools-extract"
$stageRuntimeRoot = Join-Path $stageRoot "runtime"
$stagePlatformToolsRoot = Join-Path $stageRuntimeRoot "platform-tools"
$stageOcrRoot = Join-Path $stageRoot "Resource\base\model\ocr"

Assert-InReleaseOutput -Path $outputRoot -ReleaseRoot $releaseRoot -Description "OutputRoot"
if ($outputRoot.Equals($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputRoot must be a child of release-local."
}

$tauriConfigPath = Join-Path $repositoryRoot "apps\desktop\src-tauri\tauri.conf.json"
Assert-File -Path $tauriConfigPath -MinimumBytes 64 -Description "Tauri configuration" | Out-Null
$tauriConfig = [IO.File]::ReadAllText($tauriConfigPath) | ConvertFrom-Json
$version = [string]$tauriConfig.version
if ([string]::IsNullOrWhiteSpace($version) -or $version -notmatch "^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$") {
    throw "Tauri configuration contains an invalid release version."
}
if ([string]$tauriConfig.productName -ne "Rino" -or [string]$tauriConfig.mainBinaryName -ne "Rino") {
    throw "Tauri configuration must use Rino as the product and main binary name."
}

$resolvedPlatformToolsArchive = if ([string]::IsNullOrWhiteSpace($PlatformToolsArchive)) {
    [IO.Path]::GetFullPath((Join-Path $releaseRoot "platform-tools-latest-windows.zip"))
}
else {
    [IO.Path]::GetFullPath($PlatformToolsArchive)
}
Assert-File -Path $resolvedPlatformToolsArchive -MinimumBytes 1024 -Description "pinned Windows Platform Tools archive" | Out-Null
$expectedPlatformToolsSha256 = "45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99"
$actualPlatformToolsSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $resolvedPlatformToolsArchive).Hash.ToLowerInvariant()
if ($actualPlatformToolsSha256 -ne $expectedPlatformToolsSha256) {
    throw "The Windows Platform Tools archive SHA-256 is not the pinned 37.0.1 digest."
}

if (Test-Path -LiteralPath $outputRoot) {
    $existingOutput = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $outputRoot).Path)
    Assert-InReleaseOutput -Path $existingOutput -ReleaseRoot $releaseRoot -Description "Existing output"
    if ($existingOutput.Equals($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove release-local itself."
    }
    Remove-SafeOutputDirectory -Path $existingOutput -ReleaseRoot $releaseRoot
}
New-Item -ItemType Directory -Path @(
    $runtimeDistRoot,
    $runtimeWorkRoot,
    $runtimeSpecRoot,
    $platformToolsExtractRoot,
    $stagePlatformToolsRoot,
    $stageOcrRoot
) -Force | Out-Null

$tauriBuildArguments = @(
    "pnpm",
    "--filter",
    "@rino/desktop",
    "tauri",
    "build",
    "--no-bundle"
)
& corepack @tauriBuildArguments
if ($LASTEXITCODE -ne 0) {
    throw "Tauri failed to build Rino.exe."
}

$runtimeProjectRoot = Join-Path $repositoryRoot "services\runtime"
$runtimeEntryPoint = Join-Path $runtimeProjectRoot "src\rino_runtime\__main__.py"
Assert-File -Path $runtimeEntryPoint -MinimumBytes 1024 -Description "Rino runtime entry point" | Out-Null
$uvArguments = @(
    "run",
    "--frozen",
    "--project",
    $runtimeProjectRoot,
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
    (Join-Path $runtimeProjectRoot "src"),
    "--collect-all",
    "maa",
    "--collect-all",
    "MaaAgentBinary",
    "--copy-metadata",
    "MaaFw",
    "--copy-metadata",
    "MaaAgentBinary",
    $runtimeEntryPoint
)
& uv @uvArguments
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed to build the Rino runtime."
}

$applicationExecutable = Join-Path $repositoryRoot "target\release\Rino.exe"
Assert-File -Path $applicationExecutable -MinimumBytes 65536 -Description "Rino application executable" | Out-Null
$runtimeBuiltRoot = Join-Path $runtimeDistRoot "rino-runtime"
Assert-Directory -Path $runtimeBuiltRoot -Description "frozen Rino runtime" | Out-Null
$runtimeExecutable = Join-Path $runtimeBuiltRoot "rino-runtime.exe"
$runtimeInternalRoot = Join-Path $runtimeBuiltRoot "_internal"
Assert-File -Path $runtimeExecutable -MinimumBytes 1048576 -Description "frozen Rino runtime executable" | Out-Null
Assert-Directory -Path $runtimeInternalRoot -Description "frozen Rino runtime _internal directory" | Out-Null
Assert-Directory -Path (Join-Path $runtimeInternalRoot "MaaAgentBinary") -Description "MaaAgentBinary directory" | Out-Null
Assert-File -Path (Join-Path $runtimeInternalRoot "MaaAgentBinary\LICENSE") -MinimumBytes 16 -Description "MaaAgentBinary license" | Out-Null

Expand-Archive -LiteralPath $resolvedPlatformToolsArchive -DestinationPath $platformToolsExtractRoot
$platformToolsPayload = Join-Path $platformToolsExtractRoot "platform-tools"
Assert-Directory -Path $platformToolsPayload -Description "Platform Tools payload" | Out-Null
$requiredPlatformToolsFiles = @(
    "adb.exe",
    "AdbWinApi.dll",
    "AdbWinUsbApi.dll",
    "libwinpthread-1.dll",
    "NOTICE.txt",
    "source.properties"
)
foreach ($fileName in $requiredPlatformToolsFiles) {
    $sourcePath = Join-Path $platformToolsPayload $fileName
    Assert-File -Path $sourcePath -MinimumBytes 16 -Description "Platform Tools $fileName" | Out-Null
    Copy-Item -LiteralPath $sourcePath -Destination $stagePlatformToolsRoot -Force
}

$ocrSourceRoot = Join-Path $repositoryRoot "_WFP\Resource\base\model\ocr"
Assert-Directory -Path $ocrSourceRoot -Description "pinned OCR model directory" | Out-Null
$requiredOcrFiles = @(
    [pscustomobject]@{
        Name = "det.onnx"
        Bytes = 4748769L
        Sha256 = "8c3b7ee97913a7942b8565669dc9acbe8846fbbaf4b63e1d7fdb339005574a33"
    },
    [pscustomobject]@{
        Name = "rec.onnx"
        Bytes = 16517247L
        Sha256 = "31fb844ce3a4aaf13e4bea62ae35f43bd9a509966061980c30db9b248c542a6b"
    },
    [pscustomobject]@{
        Name = "keys.txt"
        Bytes = 92395L
        Sha256 = "1ea29636956177e400af712d9782e7693f3fb25f98617bed10479d2965a836fd"
    }
)
foreach ($requiredOcrFile in $requiredOcrFiles) {
    $sourcePath = Join-Path $ocrSourceRoot $requiredOcrFile.Name
    $sourceItem = Assert-File -Path $sourcePath -MinimumBytes 16 -Description "pinned OCR $($requiredOcrFile.Name)"
    if ($sourceItem.Length -ne $requiredOcrFile.Bytes) {
        throw "Pinned OCR $($requiredOcrFile.Name) has an unexpected length."
    }
    $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash.ToLowerInvariant()
    if ($sourceHash -ne $requiredOcrFile.Sha256) {
        throw "Pinned OCR $($requiredOcrFile.Name) has an unexpected SHA-256 digest."
    }
    Copy-Item -LiteralPath $sourcePath -Destination $stageOcrRoot -Force
}

$stageApplicationExecutable = Join-Path $stageRoot "Rino.exe"
Copy-Item -LiteralPath $applicationExecutable -Destination $stageApplicationExecutable -Force
Copy-Item -Path (Join-Path $runtimeBuiltRoot "*") -Destination $stageRuntimeRoot -Recurse -Force
$licenseSource = Join-Path $repositoryRoot "LICENSE"
Assert-File -Path $licenseSource -MinimumBytes 1024 -Description "Rino license" | Out-Null
Copy-Item -LiteralPath $licenseSource -Destination (Join-Path $stageRoot "LICENSE") -Force

$requiredStageFiles = @(
    @{ Path = "Rino.exe"; MinimumBytes = 65536; Description = "Rino application" },
    @{ Path = "runtime\rino-runtime.exe"; MinimumBytes = 1048576; Description = "frozen Rino runtime" },
    @{ Path = "runtime\platform-tools\adb.exe"; MinimumBytes = 1024; Description = "application-owned ADB" },
    @{ Path = "runtime\platform-tools\AdbWinApi.dll"; MinimumBytes = 1024; Description = "ADB WinApi" },
    @{ Path = "runtime\platform-tools\AdbWinUsbApi.dll"; MinimumBytes = 1024; Description = "ADB WinUsbApi" },
    @{ Path = "runtime\platform-tools\libwinpthread-1.dll"; MinimumBytes = 1024; Description = "ADB pthread runtime" },
    @{ Path = "runtime\platform-tools\NOTICE.txt"; MinimumBytes = 16; Description = "Platform Tools notice" },
    @{ Path = "runtime\_internal\MaaAgentBinary\LICENSE"; MinimumBytes = 16; Description = "MaaAgentBinary license" },
    @{ Path = "Resource\base\model\ocr\det.onnx"; MinimumBytes = 16; Description = "OCR detection model" },
    @{ Path = "Resource\base\model\ocr\rec.onnx"; MinimumBytes = 16; Description = "OCR recognition model" },
    @{ Path = "Resource\base\model\ocr\keys.txt"; MinimumBytes = 16; Description = "OCR dictionary" },
    @{ Path = "LICENSE"; MinimumBytes = 1024; Description = "Rino license" }
)
foreach ($requiredStageFile in $requiredStageFiles) {
    Assert-File -Path (Join-Path $stageRoot $requiredStageFile.Path) -MinimumBytes $requiredStageFile.MinimumBytes -Description $requiredStageFile.Description | Out-Null
}
$forbiddenWfpExecutables = Get-ChildItem -LiteralPath $stageRoot -Recurse -File |
    Where-Object { $_.Name -match "(?i)(MFAWPF|Rino[_-]?WFP).*\.exe$" }
if ($null -ne $forbiddenWfpExecutables) {
    throw "The Rino installer stage must not contain a WFP executable."
}

$issPath = Join-Path $repositoryRoot "installer\Rino.iss"
$borderBitmapPath = Join-Path $repositoryRoot "installer\btn_border.bmp"
Assert-File -Path $issPath -MinimumBytes 1024 -Description "Rino Inno Setup script" | Out-Null
Assert-File -Path $borderBitmapPath -MinimumBytes 1024 -Description "Rino installer button bitmap" | Out-Null

$resolvedIsccPath = ""
if (-not [string]::IsNullOrWhiteSpace($IsccPath)) {
    $resolvedIsccPath = [IO.Path]::GetFullPath($IsccPath)
}
else {
    $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
    $programFiles = [Environment]::GetEnvironmentVariable("ProgramFiles")
    $localAppData = [Environment]::GetEnvironmentVariable("LOCALAPPDATA")
    $candidates = @(
        (Join-Path $localAppData "Programs\Inno Setup 6\ISCC.exe"),
        (Join-Path $programFilesX86 "Inno Setup 6\ISCC.exe"),
        (Join-Path $programFiles "Inno Setup 6\ISCC.exe")
    )
    $resolvedIsccPath = $candidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1
}
Assert-File -Path $resolvedIsccPath -MinimumBytes 65536 -Description "Inno Setup compiler" | Out-Null

$compilerSourceRoot = Split-Path -Parent $resolvedIsccPath
Assert-Directory -Path $compilerSourceRoot -Description "Inno Setup compiler directory" | Out-Null
$compilerBundleRoot = Join-Path $stageRoot "installer-compiler"
New-Item -ItemType Directory -Path $compilerBundleRoot -Force | Out-Null
Copy-Item -Path (Join-Path $compilerSourceRoot "*") -Destination $compilerBundleRoot -Recurse -Force
$projectInstallerScript = Join-Path $repositoryRoot "installer\RinoProject.iss"
$projectInstallerLanguage = Join-Path $repositoryRoot "installer\ChineseSimplified.isl"
$projectInstallerLanguageLicense = Join-Path $repositoryRoot "installer\ChineseSimplified.LICENSE.txt"
Assert-File -Path $projectInstallerScript -MinimumBytes 512 -Description "project installer script" | Out-Null
Assert-File -Path $projectInstallerLanguage -MinimumBytes 20000 -Description "Simplified Chinese installer translation" | Out-Null
Assert-File -Path $projectInstallerLanguageLicense -MinimumBytes 1024 -Description "Simplified Chinese installer translation license" | Out-Null
$expectedProjectInstallerLanguageSha256 = "e0b0b350e2245f3c5e65586dfe43d574f6e7f06f2261149aba284954b3fc9a8d"
$actualProjectInstallerLanguageSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $projectInstallerLanguage).Hash.ToLowerInvariant()
if ($actualProjectInstallerLanguageSha256 -ne $expectedProjectInstallerLanguageSha256) {
    throw "The Simplified Chinese installer translation does not match the pinned revision."
}
Copy-Item -LiteralPath $projectInstallerScript -Destination (Join-Path $compilerBundleRoot "RinoProject.iss") -Force
Copy-Item -LiteralPath $projectInstallerLanguage -Destination (Join-Path $compilerBundleRoot "ChineseSimplified.isl") -Force
Copy-Item -LiteralPath $projectInstallerLanguageLicense -Destination (Join-Path $compilerBundleRoot "ChineseSimplified.LICENSE.txt") -Force
$requiredCompilerFiles = @(
    @{ Path = "ISCC.exe"; MinimumBytes = 65536; Description = "bundled Inno Setup compiler" },
    @{ Path = "license.txt"; MinimumBytes = 1024; Description = "Inno Setup license" },
    @{ Path = "RinoProject.iss"; MinimumBytes = 512; Description = "project installer script" },
    @{ Path = "ChineseSimplified.isl"; MinimumBytes = 20000; Description = "Simplified Chinese installer translation" },
    @{ Path = "ChineseSimplified.LICENSE.txt"; MinimumBytes = 1024; Description = "Simplified Chinese installer translation license" }
)
foreach ($requiredCompilerFile in $requiredCompilerFiles) {
    Assert-File -Path (Join-Path $compilerBundleRoot $requiredCompilerFile.Path) -MinimumBytes $requiredCompilerFile.MinimumBytes -Description $requiredCompilerFile.Description | Out-Null
}

$isccArguments = @(
    "/DAppVersion=$version",
    "/O$outputRoot",
    $issPath
)
& $resolvedIsccPath @isccArguments
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup failed to compile the Rino installer."
}

Assert-InReleaseOutput -Path $runtimeBuildRoot -ReleaseRoot $releaseRoot -Description "runtime build output"
Assert-InReleaseOutput -Path $platformToolsExtractRoot -ReleaseRoot $releaseRoot -Description "Platform Tools extraction output"

$installerPath = Join-Path $outputRoot "Rino_${version}_Setup.exe"
Assert-File -Path $installerPath -MinimumBytes 65536 -Description "Rino installer" | Out-Null
$stageRuntimeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $stageRoot "runtime\rino-runtime.exe")).Hash.ToLowerInvariant()
$stageApplicationHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $stageApplicationExecutable).Hash.ToLowerInvariant()
$installerHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installerPath).Hash.ToLowerInvariant()
$hashManifestPath = Join-Path $outputRoot "SHA256SUMS.txt"
$hashManifest = @(
    "$installerHash  Rino_${version}_Setup.exe",
    "$stageApplicationHash  stage/Rino.exe",
    "$stageRuntimeHash  stage/runtime/rino-runtime.exe"
) -join "`n"
[IO.File]::WriteAllText(
    $hashManifestPath,
    $hashManifest + "`n",
    [Text.UTF8Encoding]::new($false)
)

Remove-SafeOutputDirectory -Path $runtimeBuildRoot -ReleaseRoot $releaseRoot
Remove-SafeOutputDirectory -Path $platformToolsExtractRoot -ReleaseRoot $releaseRoot

[pscustomobject]@{
    product = "Rino"
    version = $version
    installer = $installerPath
    installerBytes = (Get-Item -LiteralPath $installerPath).Length
    installerSha256 = $installerHash
    stage = $stageRoot
    stageApplicationSha256 = $stageApplicationHash
    stageRuntimeSha256 = $stageRuntimeHash
    platformToolsRevision = "37.0.1"
    platformToolsArchiveSha256 = $actualPlatformToolsSha256
} | ConvertTo-Json -Depth 3