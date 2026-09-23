# ==============================================================================
# Kiroku Note — Windows Inno Setup Installer Builder
# ==============================================================================
# Usage: powershell -ExecutionPolicy Bypass -File release/build-installer.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PROJECT_ROOT = (Resolve-Path (Join-Path $SCRIPT_DIR "..")).Path
$INSTALLER_DIR = Join-Path $PROJECT_ROOT "installer"
$ISS_PATH = Join-Path $INSTALLER_DIR "kiroku_setup.iss"
$DIST_DIR = Join-Path $PROJECT_ROOT "dist\installer"
$BACKEND_EXE = Join-Path $PROJECT_ROOT "dist\backend\KirokuNote\KirokuNote.exe"
$EXTENSION_DIR = Join-Path $PROJECT_ROOT "dist\extension\unpacked"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Kiroku Note Windows Installer Builder (V1.0.0)" -ForegroundColor Cyan
Write-Host "  Project Root: $PROJECT_ROOT" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Verify Prerequisites
Write-Host "`n[1/4] Verifying release prerequisites..." -ForegroundColor Yellow

if (-not (Test-Path $BACKEND_EXE)) {
    Write-Error "[FATAL] Backend standalone executable not found at: $BACKEND_EXE. Please run 'release/build-backend.ps1' first."
    exit 1
}
$BackendSizeMB = [math]::Round((Get-Item $BACKEND_EXE).Length / 1MB, 2)
Write-Host "  Found backend binary: $BACKEND_EXE ($BackendSizeMB MB)" -ForegroundColor Green

if (-not (Test-Path $EXTENSION_DIR)) {
    Write-Error "[FATAL] Packed extension directory not found at: $EXTENSION_DIR. Please run 'release/build-extension.ps1' first."
    exit 1
}
$ExtFileCount = (Get-ChildItem -Path $EXTENSION_DIR -Recurse -File).Count
Write-Host "  Found unpacked extension: $EXTENSION_DIR ($ExtFileCount files)" -ForegroundColor Green

if (-not (Test-Path $ISS_PATH)) {
    Write-Error "[FATAL] Inno Setup script not found at: $ISS_PATH"
    exit 1
}
Write-Host "  Found Inno Setup script: $ISS_PATH" -ForegroundColor Green

# 2. Static Audit of .iss script and payload
Write-Host "`n[2/4] Auditing installer script and payload security..." -ForegroundColor Yellow

$IssContent = Get-Content -Path $ISS_PATH -Raw

# Check required parameters
if ($IssContent -notmatch 'AppName\s*=\s*(\{#MyAppName\}|"?Kiroku Note"?)' -and $IssContent -notmatch '#define\s+MyAppName\s+"Kiroku Note"') {
    Write-Error "[FATAL] Missing AppName='Kiroku Note' in $ISS_PATH"
    exit 1
}
if ($IssContent -notmatch '#define\s+MyAppVersion\s+"[^"]+"') {
    Write-Error "[FATAL] Missing #define MyAppVersion in $ISS_PATH"
    exit 1
}
if ($IssContent -match '#define\s+MyAppVersion\s+"([^"]+)"') {
    $Version = $Matches[1]
} else {
    $ManifestPath = Join-Path $PROJECT_ROOT "extension\manifest.json"
    $Version = (Get-Content $ManifestPath -Raw | ConvertFrom-Json).version
}
if ($IssContent -notmatch 'ArchitecturesInstallIn64BitMode\s*=\s*x64compatible') {
    Write-Error "[FATAL] Missing 64-bit installation directive in $ISS_PATH"
    exit 1
}

# Audit against user data leaks
$ForbiddenPayloads = @("kiroku.db", "ankiminer.db", "%LOCALAPPDATA%", "{localappdata}")
foreach ($forbidden in $ForbiddenPayloads) {
    if ($IssContent -match "Source:\s*`"[^`"]*$forbidden") {
        Write-Error "[FATAL] User data or localappdata path detected in Files section: $forbidden"
        exit 1
    }
}
Write-Host "  Payload audit passed: zero user databases/userData leaks." -ForegroundColor Green

# 3. Locate Inno Setup Compiler (ISCC.exe)
Write-Host "`n[3/4] Searching for Inno Setup compiler (ISCC.exe)..." -ForegroundColor Yellow

$IsccCandidates = @(
    (Get-Command iscc -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    "C:\Program Files (x86)\Inno Setup 5\ISCC.exe",
    "C:\Program Files\Inno Setup 5\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
)

$IsccPath = $null
foreach ($candidate in $IsccCandidates) {
    if ($candidate -and (Test-Path $candidate)) {
        $IsccPath = $candidate
        break
    }
}

if (-not $IsccPath) {
    Write-Host "`n[NOTICE] Inno Setup compiler (ISCC.exe) is not installed on this system." -ForegroundColor Yellow
    Write-Host "  The Inno Setup script '$ISS_PATH' has been created and statically verified." -ForegroundColor Cyan
    Write-Host "  To compile the installer on a machine with Inno Setup installed:" -ForegroundColor Cyan
    Write-Host "    iscc `"$ISS_PATH`"" -ForegroundColor White
    Write-Host "`n============================================================" -ForegroundColor Yellow
    Write-Host "  SCRIPT READY (Compilation skipped: ISCC unavailable)" -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
    exit 0
}

Write-Host "  Found Inno Setup compiler: $IsccPath" -ForegroundColor Green

# 4. Compile Installer
Write-Host "`n[4/4] Compiling Windows installer with Inno Setup..." -ForegroundColor Yellow

if (-not (Test-Path $DIST_DIR)) {
    New-Item -ItemType Directory -Path $DIST_DIR -Force | Out-Null
}

$BuildStartTime = Get-Date
& "$IsccPath" "$ISS_PATH"

if ($LASTEXITCODE -ne 0) {
    Write-Error "[FATAL] Inno Setup compilation failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}

$ExpectedInstaller = Join-Path $DIST_DIR "Kiroku-Note-Setup-v$Version.exe"
if (-not (Test-Path $ExpectedInstaller)) {
    Write-Error "[FATAL] Expected installer was not generated at: $ExpectedInstaller"
    exit 1
}

$InstallerItem = Get-Item $ExpectedInstaller
$InstallerSizeMB = [math]::Round($InstallerItem.Length / 1MB, 2)
$BuildDuration = ((Get-Date) - $BuildStartTime).TotalSeconds

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  INSTALLER BUILD SUCCESSFUL!" -ForegroundColor Green
Write-Host "  Installer Path: $ExpectedInstaller" -ForegroundColor White
Write-Host "  Size:           $InstallerSizeMB MB ($($InstallerItem.Length) bytes)" -ForegroundColor White
Write-Host "  Duration:       $([math]::Round($BuildDuration, 1))s" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

exit 0
