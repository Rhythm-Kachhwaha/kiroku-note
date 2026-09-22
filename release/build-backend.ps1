# ==============================================================================
# Kiroku Note — Standalone Backend Build Script (Windows)
# ==============================================================================
# Usage: powershell -ExecutionPolicy Bypass -File release/build-backend.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PROJECT_ROOT = (Resolve-Path (Join-Path $SCRIPT_DIR "..")).Path

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Kiroku Note Standalone Backend Builder (V1.0)" -ForegroundColor Cyan
Write-Host "  Project Root: $PROJECT_ROOT" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Verify Python
Write-Host "`n[1/5] Checking Python environment..." -ForegroundColor Yellow
$PythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PythonPath) {
    Write-Error "[FATAL] Python is not found in PATH. Please ensure Python is installed and available."
    exit 1
}
$PythonVersion = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"
Write-Host "  Found Python: $PythonPath ($PythonVersion)" -ForegroundColor Green

# 2. Verify PyInstaller
Write-Host "`n[2/5] Checking PyInstaller..." -ForegroundColor Yellow
$PyInstallerCheck = python -c "import PyInstaller; print(PyInstaller.__version__)" 2>$null
if (-not $PyInstallerCheck) {
    Write-Host "  PyInstaller not detected in current environment. Installing..." -ForegroundColor DarkYellow
    python -m pip install pyinstaller
    if ($LASTEXITCODE -ne 0) {
        Write-Error "[FATAL] Failed to install PyInstaller."
        exit 1
    }
    $PyInstallerCheck = python -c "import PyInstaller; print(PyInstaller.__version__)"
}
Write-Host "  Found PyInstaller version: $PyInstallerCheck" -ForegroundColor Green

# 3. Clean previous build artifacts
Write-Host "`n[3/5] Cleaning prior build output..." -ForegroundColor Yellow
$DistDir = Join-Path $PROJECT_ROOT "dist\backend"
$BuildDir = Join-Path $PROJECT_ROOT "build"

if (Test-Path $DistDir) {
    Remove-Item -Path $DistDir -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $BuildDir) {
    Remove-Item -Path $BuildDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
Write-Host "  Cleaned build and dist directories." -ForegroundColor Green

# 4. Run PyInstaller Build
Write-Host "`n[4/5] Building standalone executable with PyInstaller..." -ForegroundColor Yellow
$SpecPath = Join-Path $PROJECT_ROOT "packaging\kiroku_backend.spec"
if (-not (Test-Path $SpecPath)) {
    Write-Error "[FATAL] Spec file not found at: $SpecPath"
    exit 1
}

$BuildStartTime = Get-Date
python -m PyInstaller "$SpecPath" --distpath "$DistDir" --workpath "$BuildDir" --clean --noconfirm

if ($LASTEXITCODE -ne 0) {
    Write-Error "[FATAL] PyInstaller build failed with exit code $LASTEXITCODE."
    exit $LASTEXITCODE
}
$BuildDuration = ((Get-Date) - $BuildStartTime).TotalSeconds

# 5. Verify Output Artifact
Write-Host "`n[5/5] Verifying output binary..." -ForegroundColor Yellow
$ExePath = Join-Path $DistDir "KirokuNote\KirokuNote.exe"
if (-not (Test-Path $ExePath)) {
    Write-Error "[FATAL] Expected executable was not produced at: $ExePath"
    exit 1
}

$ExeItem = Get-Item $ExePath
$ExeSizeMB = [math]::Round($ExeItem.Length / 1MB, 2)

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  BUILD SUCCESSFUL!" -ForegroundColor Green
Write-Host "  Executable: $ExePath" -ForegroundColor White
Write-Host "  Size:       $ExeSizeMB MB ($($ExeItem.Length) bytes)" -ForegroundColor White
Write-Host "  Duration:   $([math]::Round($BuildDuration, 1))s" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

exit 0
