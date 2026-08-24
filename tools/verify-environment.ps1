[CmdletBinding()]
param(
    [switch]$AsJson,
    [ValidateSet(
        "PowerShell",
        "Node.js",
        "Corepack",
        "pnpm",
        "Rust",
        "Cargo",
        "Rustup",
        "Python",
        "uv",
        "Git",
        "C++ build tools",
        "Windows SDK",
        "WebView2",
        "CMake"
    )]
    [string[]]$SimulateMissingTool = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$results = [System.Collections.Generic.List[object]]::new()

function Add-CheckResult {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [ValidateSet("pass", "warning", "error")]
        [string]$Status,
        [Parameter(Mandatory)]
        [string]$Detail,
        [string]$Action = ""
    )

    $results.Add([pscustomobject]@{
        name = $Name
        status = $Status
        detail = $Detail
        action = $Action
    })
}

function Test-SimulatedMissing {
    param([Parameter(Mandatory)][string]$Name)
    return $SimulateMissingTool -contains $Name
}

function Get-ToolOutput {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [string]$Command,
        [string[]]$Arguments = @()
    )

    if (Test-SimulatedMissing -Name $Name) {
        return $null
    }

    if ($null -eq (Get-Command -Name $Command -ErrorAction SilentlyContinue)) {
        return $null
    }

    try {
        $output = & $Command @Arguments 2>$null
        if ($LASTEXITCODE -ne 0) {
            return $null
        }
        return ([string]($output | Select-Object -First 1)).Trim()
    }
    catch {
        return $null
    }
}

function ConvertTo-SemanticVersion {
    param([AllowNull()][string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }

    $match = [regex]::Match($Text, "(?<!\d)(\d+)\.(\d+)(?:\.(\d+))?")
    if (-not $match.Success) {
        return $null
    }

    $patch = if ($match.Groups[3].Success) { [int]$match.Groups[3].Value } else { 0 }
    return [version]::new(
        [int]$match.Groups[1].Value,
        [int]$match.Groups[2].Value,
        $patch
    )
}

function Test-VersionCheck {
    param(
        [Parameter(Mandatory)][string]$Name,
        [AllowNull()][string]$Output,
        [Parameter(Mandatory)][version]$Minimum,
        [Parameter(Mandatory)][version]$MaximumExclusive,
        [Parameter(Mandatory)][string]$MissingAction,
        [Parameter(Mandatory)][string]$IncompatibleAction
    )

    if ([string]::IsNullOrWhiteSpace($Output)) {
        Add-CheckResult -Name $Name -Status "error" -Detail "Not detected." -Action $MissingAction
        return
    }

    $version = ConvertTo-SemanticVersion -Text $Output
    if ($null -eq $version) {
        Add-CheckResult -Name $Name -Status "error" -Detail "Detected, but the version could not be parsed." -Action $IncompatibleAction
        return
    }

    if ($version -lt $Minimum -or $version -ge $MaximumExclusive) {
        Add-CheckResult -Name $Name -Status "error" -Detail "Detected version $version; required range is >=$Minimum and <$MaximumExclusive." -Action $IncompatibleAction
        return
    }

    Add-CheckResult -Name $Name -Status "pass" -Detail "Version $version is supported."
}

$osVersion = [Environment]::OSVersion.Version
$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if (-not $IsWindows) {
    Add-CheckResult -Name "Windows" -Status "error" -Detail "The current host is not Windows." -Action "Use a supported Windows 10 or Windows 11 x86-64 development host."
}
elseif ($architecture -ne "X64") {
    Add-CheckResult -Name "Windows" -Status "error" -Detail "Detected $architecture architecture; x86-64 is required for the first release target." -Action "Use a Windows x86-64 host."
}
elseif ($osVersion.Build -lt 19045) {
    Add-CheckResult -Name "Windows" -Status "error" -Detail "Detected build $($osVersion.Build); build 19045 or newer is required by the initial development baseline." -Action "Use Windows 10 build 19045 or a supported Windows 11 build."
}
else {
    Add-CheckResult -Name "Windows" -Status "pass" -Detail "Windows x86-64 build $($osVersion.Build) is supported."
}

$powerShellOutput = if (Test-SimulatedMissing -Name "PowerShell") { $null } else { $PSVersionTable.PSVersion.ToString() }
Test-VersionCheck -Name "PowerShell" -Output $powerShellOutput -Minimum ([version]"7.4.0") -MaximumExclusive ([version]"8.0.0") -MissingAction "Install a supported PowerShell 7 release and run the check with pwsh -NoProfile." -IncompatibleAction "Use PowerShell 7.4 or newer, below 8.0."

$nodeOutput = Get-ToolOutput -Name "Node.js" -Command "node" -Arguments @("--version")
Test-VersionCheck -Name "Node.js" -Output $nodeOutput -Minimum ([version]"24.0.0") -MaximumExclusive ([version]"25.0.0") -MissingAction "Install a supported Node.js 24 LTS release." -IncompatibleAction "Select Node.js 24 LTS for this workspace."

$corepackOutput = Get-ToolOutput -Name "Corepack" -Command "corepack" -Arguments @("--version")
if ([string]::IsNullOrWhiteSpace($corepackOutput)) {
    Add-CheckResult -Name "Corepack" -Status "error" -Detail "Not detected." -Action "Use the Corepack entry point supplied for the selected Node.js toolchain; do not install project packages globally."
}
else {
    Add-CheckResult -Name "Corepack" -Status "pass" -Detail "Version $corepackOutput is available."
}

$pnpmOutput = Get-ToolOutput -Name "pnpm" -Command "pnpm" -Arguments @("--version")
Test-VersionCheck -Name "pnpm" -Output $pnpmOutput -Minimum ([version]"11.0.0") -MaximumExclusive ([version]"12.0.0") -MissingAction "Activate the project-approved pnpm 11 release through Corepack after user authorization." -IncompatibleAction "Use pnpm 11 for the initial workspace."

$rustOutput = Get-ToolOutput -Name "Rust" -Command "rustc" -Arguments @("--version")
Test-VersionCheck -Name "Rust" -Output $rustOutput -Minimum ([version]"1.96.0") -MaximumExclusive ([version]"2.0.0") -MissingAction "Install Rust through rustup with the MSVC toolchain pinned by rust-toolchain.toml." -IncompatibleAction "Use the Rust toolchain pinned by rust-toolchain.toml (1.96 or newer)."

$cargoOutput = Get-ToolOutput -Name "Cargo" -Command "cargo" -Arguments @("--version")
Test-VersionCheck -Name "Cargo" -Output $cargoOutput -Minimum ([version]"1.96.0") -MaximumExclusive ([version]"2.0.0") -MissingAction "Install Cargo through the same rustup-managed toolchain pinned by rust-toolchain.toml." -IncompatibleAction "Use Cargo from the toolchain pinned by rust-toolchain.toml (1.96 or newer)."

$rustupOutput = Get-ToolOutput -Name "Rustup" -Command "rustup" -Arguments @("--version")
if ([string]::IsNullOrWhiteSpace($rustupOutput)) {
    Add-CheckResult -Name "Rustup" -Status "error" -Detail "Not detected." -Action "Install rustup and select stable-x86_64-pc-windows-msvc."
}
else {
    $activeToolchain = ([string](& rustup show active-toolchain 2>$null)).Trim()
    $installedTargets = @(& rustup target list --installed 2>$null)
    if ($activeToolchain -notmatch "x86_64-pc-windows-msvc" -or $installedTargets -notcontains "x86_64-pc-windows-msvc") {
        Add-CheckResult -Name "Rustup" -Status "error" -Detail "Rustup is available, but an x86-64 MSVC toolchain and target are not both active. Inside this repository the active toolchain is pinned by rust-toolchain.toml." -Action "Install the toolchain pinned by rust-toolchain.toml and the x86_64-pc-windows-msvc target."
    }
    else {
        Add-CheckResult -Name "Rustup" -Status "pass" -Detail "An x86-64 MSVC toolchain and target are active."
    }
}

$pythonOutput = Get-ToolOutput -Name "Python" -Command "python" -Arguments @("--version")
Test-VersionCheck -Name "Python" -Output $pythonOutput -Minimum ([version]"3.13.0") -MaximumExclusive ([version]"3.14.0") -MissingAction "Install an approved x86-64 CPython 3.13 release only after the user authorizes installation." -IncompatibleAction "Use CPython 3.13; services/runtime pins requires-python ==3.13.* and the pinned MaaFramework binding is verified on 3.13."

$uvOutput = Get-ToolOutput -Name "uv" -Command "uv" -Arguments @("--version")
Test-VersionCheck -Name "uv" -Output $uvOutput -Minimum ([version]"0.10.0") -MaximumExclusive ([version]"0.12.0") -MissingAction "Install the approved uv release only after user authorization." -IncompatibleAction "Use the approved uv 0.10-0.11 release range for this workspace."

$gitOutput = Get-ToolOutput -Name "Git" -Command "git" -Arguments @("--version")
Test-VersionCheck -Name "Git" -Output $gitOutput -Minimum ([version]"2.45.0") -MaximumExclusive ([version]"3.0.0") -MissingAction "Install a supported Git for Windows release." -IncompatibleAction "Use Git 2.45 or newer, below 3.0."

$programFilesX86 = [Environment]::GetFolderPath("ProgramFilesX86")
$vswhere = Join-Path $programFilesX86 "Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-SimulatedMissing -Name "C++ build tools") {
    $visualStudioVersion = $null
}
elseif (Test-Path -LiteralPath $vswhere) {
    $visualStudioVersion = ([string](& $vswhere -latest -products "*" -requires "Microsoft.VisualStudio.Component.VC.Tools.x86.x64" -property installationVersion 2>$null)).Trim()
}
else {
    $visualStudioVersion = $null
}

if ([string]::IsNullOrWhiteSpace($visualStudioVersion)) {
    Add-CheckResult -Name "C++ build tools" -Status "error" -Detail "A complete x86/x64 C++ desktop toolchain was not detected." -Action "Install the Desktop development with C++ workload and x86/x64 compiler tools."
}
else {
    Add-CheckResult -Name "C++ build tools" -Status "pass" -Detail "A compatible C++ desktop toolchain is available."
}

$windowsSdkRoot = Join-Path $programFilesX86 "Windows Kits\10\Lib"
$windowsSdkVersions = if (Test-SimulatedMissing -Name "Windows SDK") {
    @()
}
else {
    @(Get-ChildItem -LiteralPath $windowsSdkRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        ConvertTo-SemanticVersion -Text $_.Name
    } | Where-Object { $null -ne $_ })
}

$supportedSdk = @($windowsSdkVersions | Where-Object { $_ -ge [version]"10.0.19041.0" } | Sort-Object -Descending)
if ($supportedSdk.Count -eq 0) {
    Add-CheckResult -Name "Windows SDK" -Status "error" -Detail "No supported Windows SDK was detected." -Action "Install Windows SDK 10.0.19041.0 or newer through the C++ desktop workload."
}
else {
    Add-CheckResult -Name "Windows SDK" -Status "pass" -Detail "Newest supported SDK: $($supportedSdk[0])."
}

$webViewVersion = $null
if (-not (Test-SimulatedMissing -Name "WebView2")) {
    $webViewRoot = Join-Path $programFilesX86 "Microsoft\EdgeWebView\Application"
    $webViewVersion = Get-ChildItem -LiteralPath $webViewRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        ConvertTo-SemanticVersion -Text $_.Name
    } | Where-Object { $null -ne $_ } | Sort-Object -Descending | Select-Object -First 1
}

if ($null -eq $webViewVersion) {
    Add-CheckResult -Name "WebView2" -Status "error" -Detail "The Evergreen Runtime was not detected." -Action "Install a serviced WebView2 Evergreen Runtime."
}
else {
    Add-CheckResult -Name "WebView2" -Status "pass" -Detail "Evergreen Runtime version $webViewVersion is available."
}

$cmakeOutput = Get-ToolOutput -Name "CMake" -Command "cmake" -Arguments @("--version")
if ([string]::IsNullOrWhiteSpace($cmakeOutput)) {
    Add-CheckResult -Name "CMake" -Status "warning" -Detail "Not detected; it is optional for the current task." -Action "Install it only if a later approved task builds native dependencies from source."
}
else {
    Add-CheckResult -Name "CMake" -Status "pass" -Detail "$cmakeOutput"
}

$hasErrors = @($results | Where-Object { $_.status -eq "error" }).Count -gt 0

if ($AsJson) {
    [pscustomobject]@{
        schemaVersion = 1
        ready = -not $hasErrors
        simulated = $SimulateMissingTool.Count -gt 0
        results = $results
    } | ConvertTo-Json -Depth 5
}
else {
    foreach ($result in $results) {
        $label = $result.status.ToUpperInvariant()
        Write-Output "[$label] $($result.name): $($result.detail)"
        if (-not [string]::IsNullOrWhiteSpace($result.action)) {
            Write-Output "  Action: $($result.action)"
        }
    }

    Write-Output ""
    if ($SimulateMissingTool.Count -gt 0) {
        Write-Output "Simulation mode was used; this output is not real readiness evidence."
    }
    Write-Output $(if ($hasErrors) { "Environment is not ready." } else { "Environment is ready." })
}

if ($hasErrors) {
    exit 1
}

exit 0
