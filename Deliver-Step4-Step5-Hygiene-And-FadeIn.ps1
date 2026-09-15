<#
.SYNOPSIS
  Twelve C — Step 4 (.env.example fix + .gitignore *.bak cleanup + stray junk
  file deletion) and Step 5 (dashboard business-card fade-in-up fix), in one
  script, per the launch-guide Part 7 order.

.WHAT THIS DOES
  1. Locates the monorepo root (folder containing phase1-engine,
     phase2-backend, phase3-frontend as siblings).
  2. Times-stamps and backs up every file this script touches before writing.
  3. Rewrites phase2-backend\.env.example to add the 9 missing variables
     (ACCESS_TOKEN_EXPIRE_MINUTES, JWT_ALGORITHM, MFA_ENCRYPTION_KEY,
     MFA_ISSUER_NAME, POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER,
     REFRESH_TOKEN_EXPIRE_DAYS, TURNSTILE_SECRET_KEY) with a one-line
     comment each, sourced from app\config.py and docker-compose.yml.
  4. Adds *.bak and *.bak-* to both phase2-backend\.gitignore and
     phase3-frontend\.gitignore.
  5. Deletes the 18 stray .bak / timestamped backup files found across all
     three phase folders, and the 5 empty junk files at the phase3-frontend
     root ( "(" "0" "t" "zig" "{" ).
  6. Fixes the dashboard business-card fade-in bug: adds the existing
     `fade-in-up` CSS class (already defined in globals.css, already used
     elsewhere) to the business row <div> in
     phase3-frontend\src\app\dashboard\page.tsx.
  7. Re-runs the backend test suite (pytest, inside venv) and the frontend
     type check (tsc --noEmit) as verification gates.
  8. git add / commit / push, single command sequence, no branching.

  Nothing else is touched. No secrets are generated or rotated by this
  script — MFA_ENCRYPTION_KEY and TURNSTILE_SECRET_KEY are written as
  placeholders only; do that rotation yourself before real use.

.USAGE
  Run from anywhere inside (or above) the twelve-c monorepo:
    powershell -ExecutionPolicy Bypass -File .\Deliver-Step4-Step5-Hygiene-And-FadeIn.ps1
#>

$ErrorActionPreference = "Stop"
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

# ---------------------------------------------------------------------------
# 1. Locate repo root
# ---------------------------------------------------------------------------
function Find-RepoRoot {
    $candidate = (Get-Location).ProviderPath
    for ($i = 0; $i -lt 6; $i++) {
        $hasP1 = Test-Path (Join-Path $candidate "phase1-engine")
        $hasP2 = Test-Path (Join-Path $candidate "phase2-backend")
        $hasP3 = Test-Path (Join-Path $candidate "phase3-frontend")
        if ($hasP1 -and $hasP2 -and $hasP3) { return $candidate }
        $parent = Split-Path $candidate -Parent
        if (-not $parent -or $parent -eq $candidate) { break }
        $candidate = $parent
    }
    return $null
}

$RepoRoot = Find-RepoRoot
if (-not $RepoRoot) {
    Write-Host "Could not auto-locate the repo root (folder containing phase1-engine, phase2-backend, phase3-frontend)." -ForegroundColor Red
    Write-Host "Run this script from inside the twelve-c repo, or edit `$RepoRoot manually at the top of the script." -ForegroundColor Red
    exit 1
}
Write-Host "Repo root: $RepoRoot" -ForegroundColor Cyan

$Phase2Root = Join-Path $RepoRoot "phase2-backend"
$Phase3Root = Join-Path $RepoRoot "phase3-frontend"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Backup-File {
    param([string]$FullPath)
    if (Test-Path $FullPath) {
        $backupPath = "$FullPath.$Timestamp.bak"
        Copy-Item -LiteralPath $FullPath -Destination $backupPath -Force
        Write-Host "  Backed up -> $backupPath" -ForegroundColor DarkGray
    }
}

function Write-Utf8NoBom {
    param([string]$FullPath, [string]$Content)
    [System.IO.File]::WriteAllText($FullPath, $Content, (New-Object System.Text.UTF8Encoding $false))
}

# ---------------------------------------------------------------------------
# 2. phase2-backend\.env.example — add the 9 missing variables
# ---------------------------------------------------------------------------
Write-Host "`n[1/6] Rewriting phase2-backend\.env.example ..." -ForegroundColor Yellow

$envExamplePath = Join-Path $Phase2Root ".env.example"
Backup-File $envExamplePath

$envLines = @(
    "# Postgres",
    "DATABASE_URL=postgresql+asyncpg://user:password@host/dbname",
    "DATABASE_URL_SYNC=postgresql://user:password@host/dbname",
    "",
    "# Postgres (local docker-compose only - not read directly by the FastAPI app,",
    "# consumed by docker-compose.yml to provision the local dev DB container)",
    "POSTGRES_USER=zimra_qpd",
    "POSTGRES_PASSWORD=replace-with-a-long-random-string",
    "POSTGRES_DB=zimra_qpd",
    "",
    "# JWT",
    "JWT_SECRET_KEY=replace-with-a-long-random-string",
    "JWT_ALGORITHM=HS256",
    "ACCESS_TOKEN_EXPIRE_MINUTES=15",
    "REFRESH_TOKEN_EXPIRE_DAYS=7",
    "",
    "# MFA",
    "MFA_ISSUER_NAME=Twelve C",
    "# Fernet key (32 url-safe base64 bytes) for encrypting mfa_secret at rest -",
    "# generate with: python -c ""from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())""",
    "# NOTE: not yet consumed by app/core/mfa.py as of this commit - required once",
    "# the MFA-at-rest encryption fix lands. Until then this key does nothing.",
    "MFA_ENCRYPTION_KEY=replace-with-a-fernet-key",
    "",
    "# App",
    "ENVIRONMENT=development",
    "CORS_ORIGINS=http://localhost:3000",
    "",
    "# Frontend URL",
    "FRONTEND_URL=http://localhost:3000",
    "",
    "# How long a 6-digit email verification code stays valid",
    "EMAIL_VERIFICATION_CODE_EXPIRE_MINUTES=15",
    "",
    "# Brevo (https://app.brevo.com) - transactional email, free tier, does NOT",
    "# require you to own/verify a domain - only the sender address.",
    "BREVO_API_KEY=xkeysib-your-key-here",
    "BREVO_SENDER_EMAIL=you@example.com",
    "BREVO_SENDER_NAME=Twelve C",
    "",
    "# Google Sign-In (https://console.cloud.google.com/apis/credentials)",
    "GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com",
    "",
    "# Cloudflare Turnstile (https://dash.cloudflare.com -> Turnstile) - bot/spam",
    "# protection intended for /auth/register and /auth/login.",
    "# NOTE: not yet verified server-side anywhere in app/ as of this commit -",
    "# required once Turnstile verification is wired into the auth routes.",
    "TURNSTILE_SECRET_KEY=replace-with-your-turnstile-secret-key"
)
$envContent = ($envLines -join "`r`n") + "`r`n"
Write-Utf8NoBom -FullPath $envExamplePath -Content $envContent
Write-Host "  Done." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. .gitignore — add *.bak / *.bak-* to both repos
# ---------------------------------------------------------------------------
Write-Host "`n[2/6] Adding *.bak / *.bak-* to .gitignore in both repos ..." -ForegroundColor Yellow

$p2GitignorePath = Join-Path $Phase2Root ".gitignore"
Backup-File $p2GitignorePath
$p2GitignoreLines = @(
    ".env",
    ".env.local",
    "*.env",
    "__pycache__/",
    "*.pyc",
    ".pytest_cache/",
    "venv/",
    ".venv/",
    "*.egg-info/",
    ".vscode/",
    ".idea/",
    "*.bak",
    "*.bak-*"
)
Write-Utf8NoBom -FullPath $p2GitignorePath -Content (($p2GitignoreLines -join "`r`n") + "`r`n")

$p3GitignorePath = Join-Path $Phase3Root ".gitignore"
Backup-File $p3GitignorePath
$p3GitignoreLines = @(
    "node_modules/",
    ".next/",
    "out/",
    "build/",
    "dist/",
    "__pycache__/",
    "*.pyc",
    ".pytest_cache/",
    "tsconfig.tsbuildinfo",
    ".env",
    ".env.local",
    ".env.development.local",
    ".env.test.local",
    ".env.production.local",
    ".DS_Store",
    "*.bak",
    "*.bak-*"
)
Write-Utf8NoBom -FullPath $p3GitignorePath -Content (($p3GitignoreLines -join "`n") + "`n")
Write-Host "  Done." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 4. Delete stray .bak files and phase3-frontend root junk files
# ---------------------------------------------------------------------------
Write-Host "`n[3/6] Deleting stray .bak files and junk files ..." -ForegroundColor Yellow

$bakFiles = Get-ChildItem -Path $RepoRoot -Recurse -File -Filter "*.bak*" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\venv\\' -and $_.FullName -notmatch '\\\.venv\\' }

foreach ($f in $bakFiles) {
    Write-Host "  Deleting $($f.FullName)" -ForegroundColor DarkGray
    Remove-Item -LiteralPath $f.FullName -Force
}
Write-Host "  Removed $($bakFiles.Count) .bak file(s)." -ForegroundColor Green

$junkNames = @("(", "0", "t", "zig", "{")
$junkRemoved = 0
foreach ($name in $junkNames) {
    $junkPath = Join-Path $Phase3Root $name
    if (Test-Path -LiteralPath $junkPath -PathType Leaf) {
        $item = Get-Item -LiteralPath $junkPath
        if ($item.Length -eq 0) {
            Write-Host "  Deleting junk file: $junkPath" -ForegroundColor DarkGray
            Remove-Item -LiteralPath $junkPath -Force
            $junkRemoved++
        } else {
            Write-Host "  Skipping '$name' - not empty, refusing to auto-delete. Check it manually." -ForegroundColor Red
        }
    }
}
Write-Host "  Removed $junkRemoved junk file(s)." -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. Dashboard fade-in-up fix
# ---------------------------------------------------------------------------
Write-Host "`n[4/6] Fixing dashboard business-card fade-in-up ..." -ForegroundColor Yellow

$dashboardPagePath = Join-Path $Phase3Root "src\app\dashboard\page.tsx"
if (-not (Test-Path -LiteralPath $dashboardPagePath)) {
    Write-Host "  ERROR: $dashboardPagePath not found - skipping this fix." -ForegroundColor Red
} else {
    Backup-File $dashboardPagePath
    $dashboardContent = Get-Content -LiteralPath $dashboardPagePath -Raw

    $oldSnippet = '<div key={b.id} className={`group transition duration-150 hover:bg-seal-soft ${idx > 0 ? "border-t border-line" : ""}`}>'
    $newSnippet = '<div key={b.id} className={`fade-in-up group transition duration-150 hover:bg-seal-soft ${idx > 0 ? "border-t border-line" : ""}`}>'

    $matchCount = ([regex]::Matches($dashboardContent, [regex]::Escape($oldSnippet))).Count
    if ($matchCount -eq 0) {
        Write-Host "  ERROR: expected business-card <div> not found (file may have changed since this script was written). No changes made - fix manually." -ForegroundColor Red
    } elseif ($matchCount -gt 1) {
        Write-Host "  ERROR: expected snippet matched $matchCount times, not exactly 1 - refusing to guess. No changes made." -ForegroundColor Red
    } else {
        $dashboardContent = $dashboardContent.Replace($oldSnippet, $newSnippet)
        Write-Utf8NoBom -FullPath $dashboardPagePath -Content $dashboardContent
        Write-Host "  Done - fade-in-up added to the business row div." -ForegroundColor Green
    }
}

# ---------------------------------------------------------------------------
# 6. Verification gates
# ---------------------------------------------------------------------------
Write-Host "`n[5/6] Running verification gates ..." -ForegroundColor Yellow

Push-Location $Phase2Root
try {
    $venvActivate = Join-Path $Phase2Root "venv\Scripts\Activate.ps1"
    if (Test-Path $venvActivate) {
        Write-Host "  Activating backend venv ..." -ForegroundColor DarkGray
        & $venvActivate
    } else {
        Write-Host "  WARNING: venv not found at $venvActivate - running pytest with system Python." -ForegroundColor Red
    }
    Write-Host "  Running pytest (phase2-backend) ..." -ForegroundColor DarkGray
    python -m pytest -q
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Backend tests FAILED. Review output above before pushing." -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Write-Host "  Backend tests passed." -ForegroundColor Green
} finally {
    Pop-Location
}

Push-Location $Phase3Root
try {
    Write-Host "  Running tsc --noEmit (phase3-frontend) ..." -ForegroundColor DarkGray
    npx tsc --noEmit
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  Frontend type check FAILED. Review output above before pushing." -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Write-Host "  Frontend type check passed." -ForegroundColor Green
} finally {
    Pop-Location
}

# ---------------------------------------------------------------------------
# 7. Git commit and push
# ---------------------------------------------------------------------------
Write-Host "`n[6/6] Committing and pushing ..." -ForegroundColor Yellow

Push-Location $RepoRoot
try {
    git add -A
    git commit -m "chore: fix .env.example gaps, ignore *.bak, remove stray junk/backup files, fix dashboard card fade-in"
    git push
} finally {
    Pop-Location
}

Write-Host "`nAll done." -ForegroundColor Cyan
