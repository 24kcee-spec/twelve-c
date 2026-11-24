[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$ExchangeRate,

    [Parameter(Mandatory = $false)]
    [switch]$StartDev,

    [Parameter(Mandatory = $false)]
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$culture = [System.Globalization.CultureInfo]::InvariantCulture

function Find-RepoRoot {
    $candidate = $PSScriptRoot
    while ($candidate) {
        if ((Test-Path (Join-Path $candidate ".git")) -and
            (Test-Path (Join-Path $candidate "phase3-frontend")) -and
            (Test-Path (Join-Path $candidate "phase2-backend"))) {
            return $candidate
        }
        $parent = Split-Path $candidate -Parent
        if (-not $parent -or $parent -eq $candidate) { break }
        $candidate = $parent
    }
    throw "Could not find the Twelve C repository root. Run this script from inside your cloned twelve-c repository."
}

Write-Host ""
Write-Host "Twelve C - browser-only research study mode" -ForegroundColor Green
Write-Host "This configures the local build; it does not change normal account login."
Write-Host ""

$repoRoot = Find-RepoRoot
$frontendRoot = Join-Path $repoRoot "phase3-frontend"
$envFile = Join-Path $frontendRoot ".env.local"

if (-not $ExchangeRate) {
    $ExchangeRate = Read-Host "Enter the independently approved Task 5 exchange rate (ZiG per USD)"
}
if ([string]::IsNullOrWhiteSpace($ExchangeRate)) {
    throw "The approved Task 5 exchange rate is required. Do not run participant sessions with a guessed or default rate."
}

[decimal]$parsedRate = 0
$parsed = [decimal]::TryParse(
    $ExchangeRate,
    [System.Globalization.NumberStyles]::Float,
    $culture,
    [ref]$parsedRate
)
if (-not $parsed -or $parsedRate -le 0) {
    throw "Exchange rate must be a positive number, for example 26.8. Use a dot as the decimal separator."
}
$rateText = $parsedRate.ToString("0.################", $culture)

# Preserve all other local frontend settings and replace only the fixed
# study-rate entry. NEXT_PUBLIC_* values are embedded at build time.
$existingLines = @()
if (Test-Path $envFile) {
    $existingLines = @(Get-Content -LiteralPath $envFile)
}
$filteredLines = @($existingLines | Where-Object { $_ -notmatch '^\s*NEXT_PUBLIC_STUDY_EXCHANGE_RATE\s*=' })
$filteredLines += "NEXT_PUBLIC_STUDY_EXCHANGE_RATE=$rateText"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
    $envFile,
    (($filteredLines -join [Environment]::NewLine) + [Environment]::NewLine),
    $utf8NoBom
)

Write-Host "Study exchange rate locked for this local build: ZiG $rateText / USD" -ForegroundColor Cyan
Write-Host "Updated: $envFile"
Write-Host ""

Push-Location $frontendRoot
try {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "npm was not found. Install Node.js (LTS), reopen PowerShell, and run this script again."
    }

    if (-not (Test-Path (Join-Path $frontendRoot "node_modules"))) {
        Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
        npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
    }

    if (-not $SkipBuild) {
        Write-Host "Building Twelve C. The prebuild hook copies the authoritative Python engine and generates its SHA-256 manifest..." -ForegroundColor Yellow
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "The Next.js production build failed with exit code $LASTEXITCODE." }

        $manifest = Join-Path $frontendRoot "public\study-engine\manifest.json"
        $calculator = Join-Path $frontendRoot "public\study-engine\zimra_qpd\calculator.py"
        $rules = Join-Path $frontendRoot "public\study-engine\zimra_qpd\tax_rules.py"
        foreach ($requiredFile in @($manifest, $calculator, $rules)) {
            if (-not (Test-Path $requiredFile)) {
                throw "Expected study-engine build output is missing: $requiredFile"
            }
        }
        Write-Host ""
        Write-Host "Study engine assets generated successfully." -ForegroundColor Green
        Write-Host "Manifest: $manifest"
        Write-Host "Exchange rate: ZiG $rateText / USD"
    }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "Next:" -ForegroundColor Green
Write-Host "  1. Start the app:  cd phase3-frontend; npm run dev"
Write-Host "  2. Open:           http://localhost:3000/study"
Write-Host "  3. Confirm the exchange rate matches the signed-off Task 5 benchmark before any pilot or sealed run."
Write-Host ""
Write-Host "For Vercel, set NEXT_PUBLIC_STUDY_EXCHANGE_RATE to the same approved value in Project Settings > Environment Variables, then deploy the frozen commit."
Write-Host "Do not change the rate or engine after the first sealed run; freeze a new commit and rerun affected tests after any change."
Write-Host ""

if ($StartDev) {
    Push-Location $frontendRoot
    try {
        npm run dev
    }
    finally {
        Pop-Location
    }
}
