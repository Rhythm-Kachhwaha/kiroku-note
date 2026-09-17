# ==============================================================================
# Kiroku Note — Chromium MV3 Extension Packager (Windows)
# ==============================================================================
# Usage: powershell -ExecutionPolicy Bypass -File release/build-extension.ps1
# ==============================================================================

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Definition
$PROJECT_ROOT = (Resolve-Path (Join-Path $SCRIPT_DIR "..")).Path
$EXTENSION_DIR = Join-Path $PROJECT_ROOT "extension"
$DIST_DIR = Join-Path $PROJECT_ROOT "dist\extension"
$UNPACKED_DIR = Join-Path $DIST_DIR "unpacked"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Kiroku Note Extension Packager (V1.0.0)" -ForegroundColor Cyan
Write-Host "  Extension Source: $EXTENSION_DIR" -ForegroundColor DarkGray
Write-Host "  Distribution Dir: $DIST_DIR" -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Validate Source Manifest
Write-Host "`n[1/6] Validating manifest.json..." -ForegroundColor Yellow
$ManifestPath = Join-Path $EXTENSION_DIR "manifest.json"
if (-not (Test-Path $ManifestPath)) {
    Write-Error "[FATAL] manifest.json not found at: $ManifestPath"
    exit 1
}

$ManifestContent = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json
$Version = $ManifestContent.version
$ManifestVersion = $ManifestContent.manifest_version
$ExtName = $ManifestContent.name

if ($ManifestVersion -ne 3) {
    Write-Error "[FATAL] Expected manifest_version 3, got: $ManifestVersion"
    exit 1
}
if ($Version -ne "1.0.0") {
    Write-Error "[FATAL] Expected version '1.0.0', got: '$Version'"
    exit 1
}
Write-Host "  Manifest valid: name='$ExtName', version='$Version', MV$ManifestVersion" -ForegroundColor Green

# 2. Check all files referenced by manifest
Write-Host "`n[2/6] Verifying referenced manifest resources..." -ForegroundColor Yellow
$ReferencedFiles = @()

if ($ManifestContent.background.service_worker) {
    $ReferencedFiles += $ManifestContent.background.service_worker
}
if ($ManifestContent.side_panel.default_path) {
    $ReferencedFiles += $ManifestContent.side_panel.default_path
}
if ($ManifestContent.content_scripts) {
    foreach ($cs in $ManifestContent.content_scripts) {
        if ($cs.js) {
            foreach ($script in $cs.js) {
                $ReferencedFiles += $script
            }
        }
    }
}

foreach ($relFile in $ReferencedFiles) {
    $normRel = $relFile.Replace('/', '\')
    $fullPath = Join-Path $EXTENSION_DIR $normRel
    if (-not (Test-Path $fullPath)) {
        Write-Error "[FATAL] Manifest references missing file: $relFile ($fullPath)"
        exit 1
    }
    Write-Host "  - Found: $relFile" -ForegroundColor DarkGray
}
$RefCount = $ReferencedFiles.Count
Write-Host "  All $RefCount manifest references verified." -ForegroundColor Green

# 3. Clean prior dist/extension
Write-Host "`n[3/6] Cleaning previous build artifacts..." -ForegroundColor Yellow
if (Test-Path $DIST_DIR) {
    Remove-Item -Path $DIST_DIR -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Path $UNPACKED_DIR -Force | Out-Null
Write-Host "  Created fresh unpacked staging dir: $UNPACKED_DIR" -ForegroundColor Green

# 4. Copy Runtime-Only Files
Write-Host "`n[4/6] Staging runtime extension files..." -ForegroundColor Yellow

$RuntimeItems = @(
    "manifest.json",
    "background.js",
    "content\capture-utils.js",
    "content\content.js",
    "content\video-mining-poc.js",
    "content\adapters\netflix-adapter.js",
    "content\adapters\youtube-adapter.js",
    "content\adapters\youtube-bridge.js",
    "lib\image-cropper.js",
    "lib\subtitle-parser.js",
    "offscreen\audio-timeline-sync.js",
    "offscreen\offscreen.html",
    "offscreen\offscreen.js",
    "offscreen\pcm-worklet-processor.js",
    "offscreen\rolling-pcm-buffer.js",
    "offscreen\wav-encoder.js",
    "sidepanel\sidepanel.css",
    "sidepanel\sidepanel.html",
    "sidepanel\sidepanel.js"
)

foreach ($item in $RuntimeItems) {
    $src = Join-Path $EXTENSION_DIR $item
    $dst = Join-Path $UNPACKED_DIR $item
    $dstDir = Split-Path -Parent $dst
    if (-not (Test-Path $dstDir)) {
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }
    if (-not (Test-Path $src)) {
        Write-Error "[FATAL] Missing required runtime file: $src"
        exit 1
    }
    Copy-Item -Path $src -Destination $dst -Force
    Write-Host "  Staged: $item" -ForegroundColor DarkGray
}

# 5. Content Audit
Write-Host "`n[5/6] Performing package content audit..." -ForegroundColor Yellow
$StagedFiles = Get-ChildItem -Path $UNPACKED_DIR -Recurse -File
$StagedCount = $StagedFiles.Count

$ForbiddenPatterns = @("*.test.js", "*.spec.js", "*.md", ".git*", "*.tmp", "*.log", "*.bak")
foreach ($file in $StagedFiles) {
    foreach ($pat in $ForbiddenPatterns) {
        if ($file.Name -like $pat) {
            Write-Error "[FATAL] Forbidden file leaked into package: $($file.FullName)"
            exit 1
        }
    }
}
Write-Host "  Audit clean: $StagedCount runtime files, 0 forbidden/test files." -ForegroundColor Green

# 6. Create ZIP Archive
Write-Host "`n[6/6] Generating distribution ZIP archive..." -ForegroundColor Yellow
$ZipName = "KirokuNote-extension-v$Version.zip"
$ZipPath = Join-Path $DIST_DIR $ZipName

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($UNPACKED_DIR, $ZipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)

if (-not (Test-Path $ZipPath)) {
    Write-Error "[FATAL] Failed to create ZIP archive at: $ZipPath"
    exit 1
}

$ZipItem = Get-Item $ZipPath
$ZipSizeBytes = $ZipItem.Length
$ZipSizeKB = [math]::Round($ZipSizeBytes / 1KB, 2)

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "  EXTENSION BUILD SUCCESSFUL!" -ForegroundColor Green
Write-Host "  ZIP Path:      $ZipPath" -ForegroundColor White
Write-Host "  ZIP Size:      $ZipSizeKB KB ($ZipSizeBytes bytes)" -ForegroundColor White
Write-Host "  Unpacked Dir:  $UNPACKED_DIR" -ForegroundColor White
Write-Host "  Total Files:   $StagedCount" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

exit 0
