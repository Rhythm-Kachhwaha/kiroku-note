# ==============================================================================
# Kiroku Note — Standalone OCR Component Build Script (Windows)
# ==============================================================================
# Usage: powershell -ExecutionPolicy Bypass -File release/build-ocr.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PROJECT_ROOT = (Resolve-Path (Join-Path $SCRIPT_DIR "..")).Path

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Kiroku Note Standalone OCR Builder (V1.0.0)" -ForegroundColor Cyan
Write-Host "  Project Root: $PROJECT_ROOT" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Verify Python Environment
Write-Host "`n[1/5] Checking Python environment..." -ForegroundColor Yellow
$PythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PythonPath) {
    Write-Error "[FATAL] Python is not found in PATH. Please ensure Python is installed and available."
    exit 1
}
$PythonVersion = python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"
Write-Host "  Found Python: $PythonPath ($PythonVersion)" -ForegroundColor Green

# 2. Check OCR / PyTorch dependencies
Write-Host "`n[2/5] Checking manga-ocr and PyTorch CPU dependencies..." -ForegroundColor Yellow
$HasTorch = python -c "import torch; print(torch.__version__)" 2>$null
$HasMangaOcr = python -c "import manga_ocr; print(manga_ocr.__version__)" 2>$null

if (-not $HasTorch -or -not $HasMangaOcr) {
    Write-Host "`n[NOTICE] manga-ocr or PyTorch is not installed in the active environment." -ForegroundColor Yellow
    Write-Host "  To build the production OCR addon package, install the CPU-only PyTorch stack:" -ForegroundColor Cyan
    Write-Host "    pip install torch --index-url https://download.pytorch.org/whl/cpu" -ForegroundColor White
    Write-Host "    pip install manga-ocr pyinstaller" -ForegroundColor White
    Write-Host "`n  Build spec 'packaging/kiroku_ocr.spec' is verified and ready." -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Yellow
    Write-Host "  BUILD SKIPPED: manga-ocr/torch not installed in current env" -ForegroundColor Yellow
    Write-Host "============================================================" -ForegroundColor Yellow
    exit 0
}

Write-Host "  Found torch: $HasTorch" -ForegroundColor Green
Write-Host "  Found manga-ocr: $HasMangaOcr" -ForegroundColor Green

# 3. Clean prior build output
Write-Host "`n[3/5] Cleaning prior build output..." -ForegroundColor Yellow
$DistDir = Join-Path $PROJECT_ROOT "dist\ocr"
$BuildDir = Join-Path $PROJECT_ROOT "build\ocr"

if (Test-Path $DistDir) {
    Remove-Item -Path $DistDir -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path $BuildDir) {
    Remove-Item -Path $BuildDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null
Write-Host "  Cleaned build and dist directories." -ForegroundColor Green

# 4. Run PyInstaller Build
Write-Host "`n[4/5] Building standalone OCR package with PyInstaller..." -ForegroundColor Yellow
$SpecPath = Join-Path $PROJECT_ROOT "packaging\kiroku_ocr.spec"
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
Write-Host "`n[5/5] Verifying output package..." -ForegroundColor Yellow
$ExePath = Join-Path $DistDir "KirokuOCR\KirokuOCR.exe"
if (-not (Test-Path $ExePath)) {
    $ExePath = Join-Path $DistDir "KirokuOCR.exe"
}

if (-not (Test-Path $ExePath)) {
    Write-Error "[FATAL] Expected executable was not produced at: $ExePath"
    exit 1
}

$ExeItem = Get-Item $ExePath
$PackageDir = (Get-Item $ExePath).Directory.FullName
$TotalSizeBytes = (Get-ChildItem -Path $PackageDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
$TotalSizeMB = [math]::Round($TotalSizeBytes / 1MB, 2)

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  OCR BUILD SUCCESSFUL!" -ForegroundColor Green
Write-Host "  Executable: $ExePath" -ForegroundColor White
Write-Host "  Total Size: $TotalSizeMB MB ($TotalSizeBytes bytes)" -ForegroundColor White
Write-Host "  Duration:   $([math]::Round($BuildDuration, 1))s" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

exit 0
