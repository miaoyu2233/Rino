[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$assetDirectory = Join-Path $repositoryRoot "apps\desktop\dist\assets"

if (-not (Test-Path -LiteralPath $assetDirectory -PathType Container)) {
    throw "The frontend asset directory is missing. Run the production build first."
}

$stylesheets = @(Get-ChildItem -LiteralPath $assetDirectory -Filter "*.css" -File)
if ($stylesheets.Count -ne 1) {
    throw "Expected exactly one compiled application stylesheet, found $($stylesheets.Count)."
}

$stylesheet = Get-Content -Raw -LiteralPath $stylesheets[0].FullName
$requiredTokens = @(
    "--background",
    "--surface",
    "--surface-elevated",
    "--surface-interactive",
    "--border",
    "--border-strong",
    "--text-primary",
    "--text-secondary",
    "--text-muted",
    "--accent",
    "--success",
    "--warning",
    "--danger",
    "--info",
    "--port-exec",
    "--port-boolean",
    "--port-number",
    "--port-string",
    "--port-image",
    "--port-spatial",
    "--port-collection",
    "--port-unknown",
    "--category-flow",
    "--category-logic",
    "--category-values",
    "--category-text",
    "--category-vision",
    "--category-device",
    "--category-timing",
    "--category-diagnostics",
    "--node-idle",
    "--node-running",
    "--node-succeeded",
    "--node-failed",
    "--control-height-compact",
    "--control-height-standard",
    "--focus-ring-width",
    "--duration-micro",
    "--duration-standard",
    "--duration-panel"
)

foreach ($token in $requiredTokens) {
    if (-not $stylesheet.Contains("$token`:")) {
        throw "Compiled stylesheet is missing required token $token."
    }
}

if (-not $stylesheet.Contains("data-theme=dark")) {
    throw "Compiled stylesheet is missing the explicit dark-theme selector."
}

if (-not $stylesheet.Contains("prefers-reduced-motion:reduce")) {
    throw "Compiled stylesheet is missing reduced-motion behavior."
}

# Reduced motion has to reach both halves of the motion system: the duration tokens the
# interface animates through, and any animation or transition a component declares for
# itself. Checking the shipped stylesheet rather than the authored one is what proves the
# rules survived bundling and minification.
$reducedMotionRules = @(
    "--duration-micro:0s",
    "--duration-standard:0s",
    "--duration-panel:0s",
    "transition-duration:.01ms!important",
    "animation-duration:.01ms!important",
    "animation-iteration-count:1!important"
)

foreach ($rule in $reducedMotionRules) {
    if (-not $stylesheet.Contains($rule)) {
        throw "Compiled stylesheet does not neutralize $rule under reduced motion."
    }
}

# Only the connection a run is currently traversing may animate without end. Rino's own
# rules are checked here; the graph library's `animated` edge class is never applied,
# because the projection carries execution state through `rino-edge--*` instead.
$rinoContinuousAnimations = [regex]::Matches(
    $stylesheet,
    "\.rino-[a-z0-9_-]+\{[^}]*infinite[^}]*\}"
)
$unexpectedContinuousAnimations = @(
    $rinoContinuousAnimations |
        Where-Object { -not $_.Value.StartsWith(".rino-edge--active{") }
)
if ($rinoContinuousAnimations.Count -ne 1 -or $unexpectedContinuousAnimations.Count -ne 0) {
    throw "Continuous animation is allowed only on the active execution path, found $($rinoContinuousAnimations.Count) rule(s)."
}

# The rem-based sizing tokens are authored against the browser default root size. A root
# font-size in any other unit silently rescales every control, icon, radius, and hit zone.
if ($stylesheet -match "html\{[^}]*font-size:(?!100%)") {
    throw "Compiled stylesheet overrides the root font size, which rescales every rem sizing token."
}

if ($stylesheet -match "(?i)(url\(|@import\s+)[`"']?https?://") {
    throw "Compiled stylesheet loads a remote URL."
}

$fontAssets = @(Get-ChildItem -LiteralPath $assetDirectory -Filter "*.woff2" -File)
if ($fontAssets.Count -ne 4) {
    throw "Expected exactly four reviewed WOFF2 assets, found $($fontAssets.Count)."
}

$requiredFontPatterns = @(
    "inter-latin-wght-normal-*.woff2",
    "inter-latin-ext-wght-normal-*.woff2",
    "jetbrains-mono-latin-wght-normal-*.woff2",
    "jetbrains-mono-latin-ext-wght-normal-*.woff2"
)

foreach ($pattern in $requiredFontPatterns) {
    $matchingAssets = @($fontAssets | Where-Object { $_.Name -like $pattern })
    if ($matchingAssets.Count -ne 1) {
        throw "Expected exactly one built font asset matching $pattern."
    }
}

$fontBytes = ($fontAssets | Measure-Object -Property Length -Sum).Sum
if ($fontBytes -gt 262144) {
    throw "Reviewed font assets exceed the 256 KiB P1-T03 budget."
}

Write-Output "Design-system build contract passed with $($fontAssets.Count) local font assets totaling $fontBytes bytes."
