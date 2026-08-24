[CmdletBinding()]
param(
    [Parameter()]
    [ValidateNotNullOrEmpty()]
    [string]$Revision = "HEAD"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

function Invoke-GitLines {
    param(
        [Parameter(Mandatory)]
        [string[]]$Arguments,
        [Parameter()]
        [int[]]$AllowedExitCodes = @(0)
    )

    $output = @(& git @Arguments 2>$null)
    if ($LASTEXITCODE -notin $AllowedExitCodes) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }

    return $output
}

Push-Location $repositoryRoot
try {
    $revisionExpression = $Revision + "^{commit}"
    $resolvedRevisionLines = @(
        Invoke-GitLines -Arguments @("rev-parse", "--verify", $revisionExpression)
    )
    $resolvedRevision = ([string]$resolvedRevisionLines[0]).Trim()
    $paths = @(Invoke-GitLines -Arguments @("ls-tree", "-r", "--name-only", $resolvedRevision))
    $violations = [System.Collections.Generic.List[string]]::new()
    $commitEmails = @(
        Invoke-GitLines -Arguments @("show", "-s", "--format=%ae%n%ce", $resolvedRevision)
    )
    foreach ($commitEmail in $commitEmails) {
        if (
            [string]::IsNullOrWhiteSpace($commitEmail) -or
            $commitEmail -notmatch "^[0-9]+\+[^@]+@users\.noreply\.github\.com$"
        ) {
            $violations.Add("commit metadata [author and committer emails must use GitHub noreply]")
        }
    }

    $pathRules = @(
        @{
            Name = "local AI instructions, prompts, or state"
            Pattern = "(?i)(^|/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.windsurfrules)$|(^|/)\.(ai-local|agents|codex|claude|gemini|cursor|cline|continue|roo)(/|$)|(^|/)\.aider[^/]*$|^\.github/(copilot-instructions\.md|instructions/|prompts/)"
        },
        @{
            Name = "credential or secret file"
            Pattern = "(?i)(^|/)(\.env(?:\..+)?|credentials\.json|secrets\.json|\.netrc|_netrc|\.pypirc)$|\.(key|pem|p12|pfx|jks|keystore|mobileprovision)$"
        },
        @{
            Name = "private user data, capture, diagnostic, or log"
            Pattern = "(?i)(^|/)(user-data|local-data|local-scripts|downloads|recordings|screenshots|captures|crash-reports|logs|debug|vision|on_error|profiles|ipc-captures|publishing-cache)(/|$)|\.(log|trace|dmp|dump|db|db-journal|sqlite|sqlite3|ipc-dump|har|pcap|pcapng)$"
        },
        @{
            Name = "dependency, cache, build, or package output"
            Pattern = "(?i)(^|/)(node_modules|dist|build|coverage|target|\.venv|venv|env|__pycache__|\.pytest_cache|\.mypy_cache|\.pyright|\.ruff_cache|\.hypothesis|htmlcov|release-local)(/|$)|\.rino-package(?:\.rino-staging-.+)?$|\.rino-staging$|\.rino-import-staging$"
        },
        @{
            Name = "root README prohibited by publication policy"
            Pattern = "(?i)^readme(?:\..+)?$"
        }
    )

    foreach ($path in $paths) {
        $normalizedPath = $path.Replace("\", "/")
        foreach ($rule in $pathRules) {
            if ($normalizedPath -match $rule.Pattern) {
                $violations.Add("$normalizedPath [$($rule.Name)]")
            }
        }
    }

    $largeBlobLimit = 20MB
    foreach ($entry in Invoke-GitLines -Arguments @("ls-tree", "-r", "-l", $resolvedRevision)) {
        if ($entry -match "^\d+\s+blob\s+[0-9a-f]+\s+(\d+)\t(.+)$" -and [long]$Matches[1] -gt $largeBlobLimit) {
            $violations.Add("$($Matches[2]) [blob exceeds 20 MiB]")
        }
    }

    if ($paths -cnotcontains "LICENSE") {
        $violations.Add("LICENSE [required AGPL-3.0 license is missing]")
    }

    $contentRules = [System.Collections.Generic.List[object]]::new()
    $contentRules.Add(@{ Name = "private key material"; Pattern = "-{5}BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-{5}" })
    $contentRules.Add(@{ Name = "GitHub access token"; Pattern = "github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}" })
    $contentRules.Add(@{ Name = "AWS access key"; Pattern = "AKIA[0-9A-Z]{16}" })
    $contentRules.Add(@{ Name = "current local repository path"; Pattern = [regex]::Escape($repositoryRoot) })

    $localProfileName = [Environment]::UserName
    if (-not [string]::IsNullOrWhiteSpace($localProfileName)) {
        $profilePattern = "C:[\\/]+Users[\\/]+" + [regex]::Escape($localProfileName) + "([\\/]|$)"
        $contentRules.Add(@{ Name = "current Windows profile path"; Pattern = $profilePattern })
    }

    $configuredEmailLines = @(
        Invoke-GitLines -Arguments @("config", "--get", "user.email") -AllowedExitCodes @(0, 1)
    )
    $configuredEmail = if ($configuredEmailLines.Count -gt 0) {
        [string]$configuredEmailLines[0]
    }
    else {
        ""
    }
    if (-not [string]::IsNullOrWhiteSpace($configuredEmail) -and $configuredEmail -notmatch "@users\.noreply\.github\.com$") {
        $contentRules.Add(@{ Name = "private Git author email"; Pattern = [regex]::Escape($configuredEmail.Trim()) })
    }

    $commitMessage = (
        Invoke-GitLines -Arguments @("show", "-s", "--format=%B", $resolvedRevision)
    ) -join [Environment]::NewLine
    foreach ($rule in $contentRules) {
        if ($commitMessage -match $rule.Pattern) {
            $violations.Add("commit message [$($rule.Name)]")
        }

        $matches = @(
            Invoke-GitLines -Arguments @("grep", "-I", "-l", "-E", "-e", $rule.Pattern, $resolvedRevision, "--") -AllowedExitCodes @(0, 1)
        )
        foreach ($path in $matches) {
            $violations.Add("$path [$($rule.Name)]")
        }
    }

    if ($violations.Count -gt 0) {
        $summary = $violations | Sort-Object -Unique | ForEach-Object { " - $_" }
        throw "Publication privacy check failed:$([Environment]::NewLine)$($summary -join [Environment]::NewLine)"
    }

    Write-Output "Publication privacy check passed for $resolvedRevision ($($paths.Count) files)."
}
finally {
    Pop-Location
}
