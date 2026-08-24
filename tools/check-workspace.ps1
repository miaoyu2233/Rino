[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

function Invoke-WorkspaceCheck {
    param(
        [Parameter(Mandatory)]
        [string]$Name,
        [Parameter(Mandatory)]
        [scriptblock]$Command
    )

    Write-Output "Running $Name"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

Push-Location $repositoryRoot
try {
    Invoke-WorkspaceCheck -Name "pnpm frozen install" -Command { pnpm install --frozen-lockfile --offline }
    Invoke-WorkspaceCheck -Name "frontend format" -Command { pnpm run format:check }
    Invoke-WorkspaceCheck -Name "frontend lint" -Command { pnpm run lint }
    Invoke-WorkspaceCheck -Name "frontend typecheck" -Command { pnpm run typecheck }
    Invoke-WorkspaceCheck -Name "frontend tests" -Command { pnpm run test }
    Invoke-WorkspaceCheck -Name "frontend build" -Command { pnpm run build }
    Invoke-WorkspaceCheck -Name "design-system build contract" -Command { pwsh -NoProfile -File tools/verify-design-system-build.ps1 }

    Invoke-WorkspaceCheck -Name "Rust format" -Command { cargo fmt --all -- --check }
    Invoke-WorkspaceCheck -Name "Rust lint" -Command { cargo clippy --workspace --all-targets --locked --offline -- -D warnings }
    Invoke-WorkspaceCheck -Name "Rust tests" -Command { cargo test --workspace --all-targets --locked --offline }

    Invoke-WorkspaceCheck -Name "uv lock" -Command { uv lock --check }
    Invoke-WorkspaceCheck -Name "Python frozen sync" -Command { uv sync --all-packages --group dev --frozen --offline }
    Invoke-WorkspaceCheck -Name "Python format" -Command { uv run --frozen --project services/runtime ruff format --check services/runtime tools }
    Invoke-WorkspaceCheck -Name "Python lint" -Command { uv run --frozen --project services/runtime ruff check services/runtime tools }
    Invoke-WorkspaceCheck -Name "Python typecheck" -Command { uv run --frozen --project services/runtime pyright --project services/runtime/pyproject.toml }
    Invoke-WorkspaceCheck -Name "Python tests" -Command { uv run --frozen --project services/runtime pytest -c services/runtime/pyproject.toml }

    Invoke-WorkspaceCheck -Name "contract generation determinism" -Command { uv run --frozen --project services/runtime python tools/contracts/generate.py --check }
}
finally {
    Pop-Location
}
