# ==============================================================================
# Kiroku Note — Windows Desktop Application Builder
# ==============================================================================
# Usage: powershell -ExecutionPolicy Bypass -File release/build-desktop.ps1
# Produces: dist/desktop/kiroku.exe with bundled backend and resources
# ==============================================================================

param (
    [switch]$SkipBackendCheck = $false
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PROJECT_ROOT = (Resolve-Path (Join-Path $SCRIPT_DIR "..")).Path
$DESKTOP_DIR = Join-Path $PROJECT_ROOT "desktop"
$DIST_DESKTOP = Join-Path $PROJECT_ROOT "dist\desktop"
$DIST_BACKEND = Join-Path $PROJECT_ROOT "dist\backend\KirokuNote"
$ELECTRON_DIST = Join-Path $DESKTOP_DIR "node_modules\electron\dist"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Kiroku Note Windows Desktop Application Builder" -ForegroundColor Cyan
Write-Host "  Target Executable: dist\desktop\kiroku.exe" -ForegroundColor DarkGray
Write-Host "  Project Root:      $PROJECT_ROOT" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Verify Electron binaries
Write-Host "`n[1/6] Verifying Electron binaries..." -ForegroundColor Yellow
if (-not (Test-Path $ELECTRON_DIST)) {
    Write-Host "  Electron dist not found in node_modules. Running npm install in desktop..." -ForegroundColor DarkYellow
    Push-Location $DESKTOP_DIR
    try {
        & npm.cmd install
    } finally {
        Pop-Location
    }
}

$ElectronExe = Join-Path $ELECTRON_DIST "electron.exe"
if (-not (Test-Path $ElectronExe)) {
    Write-Error "[FATAL] Electron binary not found at $ElectronExe. Please run 'npm install' in desktop/ directory."
    exit 1
}
Write-Host "  Found Electron distribution at: $ELECTRON_DIST" -ForegroundColor Green

# 2. Check Backend Executable
Write-Host "`n[2/6] Verifying backend standalone executable..." -ForegroundColor Yellow
$BackendExe = Join-Path $DIST_BACKEND "KirokuNote.exe"
if (-not (Test-Path $BackendExe)) {
    if ($SkipBackendCheck) {
        Write-Host "  [WARN] Backend binary not found at $BackendExe (skipped via flag)." -ForegroundColor DarkYellow
    } else {
        Write-Host "  Backend executable not found at $BackendExe." -ForegroundColor DarkYellow
        Write-Host "  Building backend with release/build-backend.ps1..." -ForegroundColor Yellow
        & powershell -ExecutionPolicy Bypass -File (Join-Path $SCRIPT_DIR "build-backend.ps1")
        if (-not (Test-Path $BackendExe)) {
            Write-Error "[FATAL] Failed to build backend executable at $BackendExe."
            exit 1
        }
    }
}
if (Test-Path $BackendExe) {
    $BackendSizeMB = [math]::Round((Get-Item $BackendExe).Length / 1MB, 2)
    Write-Host "  Found standalone backend binary: $BackendExe ($BackendSizeMB MB)" -ForegroundColor Green
}

# 3. Clean prior build output
Write-Host "`n[3/6] Cleaning prior desktop build output..." -ForegroundColor Yellow
if (Test-Path $DIST_DESKTOP) {
    Remove-Item -Path $DIST_DESKTOP -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $DIST_DESKTOP -Force | Out-Null
Write-Host "  Cleaned and initialized: $DIST_DESKTOP" -ForegroundColor Green

# 4. Copy Electron distribution and rename to kiroku.exe
Write-Host "`n[4/6] Staging Electron distribution runtime..." -ForegroundColor Yellow
Copy-Item -Path "$ELECTRON_DIST\*" -Destination $DIST_DESKTOP -Recurse -Force

$TargetKirokuExe = Join-Path $DIST_DESKTOP "kiroku.exe"
$SourceElectronInDist = Join-Path $DIST_DESKTOP "electron.exe"
if (Test-Path $SourceElectronInDist) {
    Rename-Item -Path $SourceElectronInDist -NewName "kiroku.exe" -Force
}
if (-not (Test-Path $TargetKirokuExe)) {
    Write-Error "[FATAL] Failed to stage kiroku.exe at $TargetKirokuExe"
    exit 1
}
Write-Host "  Created desktop executable: $TargetKirokuExe" -ForegroundColor Green

# 5. Package application resources into resources/app
Write-Host "`n[5/6] Packaging desktop application and bundled backend..." -ForegroundColor Yellow
$ResourcesDir = Join-Path $DIST_DESKTOP "resources"
$AppDir = Join-Path $ResourcesDir "app"
New-Item -ItemType Directory -Path $AppDir -Force | Out-Null

# Remove default_app.asar so resources/app is executed
$DefaultAppAsar = Join-Path $ResourcesDir "default_app.asar"
if (Test-Path $DefaultAppAsar) {
    Remove-Item -Path $DefaultAppAsar -Force
}

# Copy desktop package.json, bin, and src
Copy-Item -Path (Join-Path $DESKTOP_DIR "package.json") -Destination $AppDir -Force
Copy-Item -Path (Join-Path $DESKTOP_DIR "bin") -Destination $AppDir -Recurse -Force
Copy-Item -Path (Join-Path $DESKTOP_DIR "src") -Destination $AppDir -Recurse -Force

# Copy application assets
$AssetsTarget = Join-Path $AppDir "assets"
New-Item -ItemType Directory -Path $AssetsTarget -Force | Out-Null
$AssetsSource = Join-Path $PROJECT_ROOT "assets"
if (Test-Path $AssetsSource) {
    Copy-Item -Path "$AssetsSource\*" -Destination $AssetsTarget -Recurse -Force
}

# Copy extension files into resources/extension
$ExtTarget = Join-Path $ResourcesDir "extension"
New-Item -ItemType Directory -Path $ExtTarget -Force | Out-Null
$ExtSource = Join-Path $PROJECT_ROOT "extension"
if (Test-Path $ExtSource) {
    Copy-Item -Path "$ExtSource\*" -Destination $ExtTarget -Recurse -Force
}

# Bundle backend into resources/backend/KirokuNote
if (Test-Path $DIST_BACKEND) {
    $BackendTarget = Join-Path $ResourcesDir "backend\KirokuNote"
    New-Item -ItemType Directory -Path $BackendTarget -Force | Out-Null
    Copy-Item -Path "$DIST_BACKEND\*" -Destination $BackendTarget -Recurse -Force
    Write-Host "  Bundled backend executable into $BackendTarget" -ForegroundColor Green
}

# 6. Verify build artifacts
Write-Host "`n[6/6] Verifying final packaging artifacts..." -ForegroundColor Yellow
if (-not (Test-Path $TargetKirokuExe)) {
    Write-Error "[FATAL] Expected desktop executable was not produced at: $TargetKirokuExe"
    exit 1
}
$KirokuItem = Get-Item $TargetKirokuExe
$KirokuSizeMB = [math]::Round($KirokuItem.Length / 1MB, 2)

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  DESKTOP BUILD SUCCESSFUL!" -ForegroundColor Green
Write-Host "  Executable: $TargetKirokuExe" -ForegroundColor White
Write-Host "  Size:       $KirokuSizeMB MB ($($KirokuItem.Length) bytes)" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

exit 0
