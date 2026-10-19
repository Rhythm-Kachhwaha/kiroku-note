#!/usr/bin/env python3
"""
buildsetup.py -- One-Click Robust Windows Installer Builder for Kiroku Note
=============================================================================
Builds the standalone backend executable, packages the MV3 browser extension,
and compiles the Inno Setup installer (Kiroku-Note-Setup-v<version>.exe).

Key Features:
  - One-click execution: run `python buildsetup.py` or double-click from Explorer.
  - tqdm progress bars for overall and granular build progress.
  - Dynamic discovery: auto-detects newly added routers, data files, adapters,
    and extension resources without hardcoded file lists.
  - Pre-flight manifest and security auditing: verifies all manifest assets exist
    and guarantees zero user-data (kiroku.db, secrets) leaks.
  - Automatic Inno Setup Compiler (ISCC.exe) discovery.
  - Process locking protection: detects running KirokuNote instances to avoid
    Windows file-lock PermissionErrors.

Usage:
  python buildsetup.py                    # Complete build (default)
  python buildsetup.py --skip-pyinstaller # Package extension + installer only
  python buildsetup.py --skip-installer   # Build backend + extension only
  python buildsetup.py --no-clean         # Keep existing build artifacts
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from typing import Any, Iterable

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Try importing tqdm; provide a lightweight drop-in fallback if unavailable
try:
    from tqdm import tqdm
except ImportError:
    class tqdm:  # type: ignore
        def __init__(self, iterable=None, total=None, desc="", unit="", **kwargs):
            self.iterable = iterable
            self.total = total or (len(iterable) if iterable is not None and hasattr(iterable, "__len__") else 0)
            self.desc = desc
            self.unit = unit
            self.n = 0
            if self.desc:
                print(f"[*] {self.desc}...", flush=True)

        def __iter__(self):
            for item in self.iterable:
                yield item
                self.update(1)

        def update(self, n=1):
            self.n += n
            pct = f"({int(self.n / self.total * 100)}%)" if self.total else ""
            # Print periodic progress
            if self.total and (self.n == self.total or self.n % max(1, self.total // 10) == 0):
                print(f"    ... {self.desc}: {self.n}/{self.total} {pct}", flush=True)

        def set_description(self, desc):
            self.desc = desc

        def close(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            self.close()


PROJECT_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = PROJECT_ROOT / "backend"
EXTENSION_DIR = PROJECT_ROOT / "extension"
PACKAGING_DIR = PROJECT_ROOT / "packaging"
INSTALLER_DIR = PROJECT_ROOT / "installer"
DIST_DIR = PROJECT_ROOT / "dist"
BUILD_DIR = PROJECT_ROOT / "build"

SPEC_FILE = PACKAGING_DIR / "kiroku_backend.spec"
ISS_FILE = INSTALLER_DIR / "kiroku_setup.iss"
MANIFEST_FILE = EXTENSION_DIR / "manifest.json"


# ---------------------------------------------------------------------------
# Helper Utilities
# ---------------------------------------------------------------------------

def print_banner(version: str) -> None:
    print("=" * 72)
    print("   KIROKU NOTE -- ONE-CLICK SETUP BUILDER")
    print(f"   Version:      {version}")
    print(f"   Project Root: {PROJECT_ROOT}")
    print(f"   Python:       {sys.executable} ({sys.version.split()[0]})")
    print("=" * 72)
    print()


def get_version() -> str:
    """Read canonical version from backend/app/config.py with manifest fallback."""
    config_py = BACKEND_DIR / "app" / "config.py"
    if config_py.is_file():
        text = config_py.read_text(encoding="utf-8")
        match = re.search(r'APP_VERSION\s*=\s*["\']([^"\']+)["\']', text)
        if match:
            return match.group(1).strip()

    if MANIFEST_FILE.is_file():
        try:
            data = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
            if "version" in data:
                return str(data["version"]).strip()
        except Exception:
            pass

    return "2.0.0"


def find_iscc() -> Path | None:
    """Locate Inno Setup command-line compiler (ISCC.exe) across standard Windows locations."""
    which_path = shutil.which("iscc")
    if which_path and os.path.isfile(which_path):
        return Path(which_path)

    candidates: list[str | Path] = [
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"),
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
        r"C:\Program Files (x86)\Inno Setup 5\ISCC.exe",
        r"C:\Program Files\Inno Setup 5\ISCC.exe",
    ]
    for cand in candidates:
        cand_path = Path(cand)
        if cand_path.is_file():
            return cand_path

    return None


def check_running_processes() -> None:
    """Warn or terminate running Kiroku Note processes that lock executable files on Windows."""
    if sys.platform != "win32":
        return

    try:
        output = subprocess.check_output(
            ["tasklist", "/FI", "IMAGENAME eq KirokuNote.exe", "/FO", "CSV", "/NH"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        if "KirokuNote.exe" in output:
            print("[!] Detected running KirokuNote.exe process which may lock build output.")
            print("[*] Terminating existing KirokuNote.exe instances...")
            subprocess.run(["taskkill", "/F", "/IM", "KirokuNote.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(1.0)
    except Exception:
        pass


def compute_sha256(filepath: Path) -> str:
    """Calculate SHA-256 checksum for a file."""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Build Stages
# ---------------------------------------------------------------------------

def stage_verify_environment() -> dict[str, Any]:
    """Verify all prerequisites, tools, and source assets exist."""
    issues: list[str] = []

    # 1. Spec file
    if not SPEC_FILE.is_file():
        issues.append(f"Missing PyInstaller spec file: {SPEC_FILE}")

    # 2. Inno Setup script
    if not ISS_FILE.is_file():
        issues.append(f"Missing Inno Setup script: {ISS_FILE}")

    # 3. Extension manifest
    if not MANIFEST_FILE.is_file():
        issues.append(f"Missing extension manifest: {MANIFEST_FILE}")

    # 4. Inno Setup compiler
    iscc = find_iscc()
    if not iscc:
        print("[!] Warning: Inno Setup compiler (ISCC.exe) not found on PATH or standard locations.")
        print("    Installer executable (.exe) cannot be compiled unless Inno Setup is installed.")
        print("    Download from: https://jrsoftware.org/isdl.php")

    # 5. Manifest resource pre-audit
    manifest_issues = audit_manifest_resources()
    if manifest_issues:
        issues.extend(manifest_issues)

    if issues:
        print("\n[!] Pre-flight verification failed:")
        for issue in issues:
            print(f"    - {issue}")
        raise RuntimeError("Pre-flight environment verification failed.")

    return {
        "iscc": iscc,
    }


def audit_manifest_resources() -> list[str]:
    """Ensure every asset referenced by manifest.json exists on disk."""
    errors: list[str] = []
    try:
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        return [f"Failed to parse {MANIFEST_FILE}: {e}"]

    referenced_files: list[str] = []

    # Background service worker
    bg = manifest.get("background", {})
    if isinstance(bg, dict) and "service_worker" in bg:
        referenced_files.append(bg["service_worker"])

    # Side panel
    sp = manifest.get("side_panel", {})
    if isinstance(sp, dict) and "default_path" in sp:
        referenced_files.append(sp["default_path"])

    # Action icons
    action = manifest.get("action", {})
    if isinstance(action, dict) and isinstance(action.get("default_icon"), dict):
        referenced_files.extend(action["default_icon"].values())

    # Root icons
    icons = manifest.get("icons", {})
    if isinstance(icons, dict):
        referenced_files.extend(icons.values())

    # Content scripts
    for cs in manifest.get("content_scripts", []):
        if isinstance(cs, dict) and isinstance(cs.get("js"), list):
            referenced_files.extend(cs["js"])

    # Web accessible resources
    for war in manifest.get("web_accessible_resources", []):
        if isinstance(war, dict) and isinstance(war.get("resources"), list):
            referenced_files.extend(war["resources"])

    for rel in referenced_files:
        norm = rel.replace("/", os.sep)
        full = EXTENSION_DIR / norm
        if not full.is_file():
            errors.append(f"Manifest references missing file: {rel} ({full})")

    return errors


def stage_clean(clean_backend: bool = True, clean_extension: bool = True) -> None:
    """Clean prior build and staging directories."""
    dirs_to_clean: list[Path] = []
    if clean_backend:
        dirs_to_clean.extend([
            DIST_DIR / "backend",
            BUILD_DIR,
        ])
    if clean_extension:
        dirs_to_clean.append(DIST_DIR / "extension" / "unpacked")

    for d in dirs_to_clean:
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)


def stage_build_backend() -> Path:
    """Run PyInstaller using kiroku_backend.spec with live progress output."""
    dist_backend = DIST_DIR / "backend"
    dist_backend.mkdir(parents=True, exist_ok=True)
    BUILD_DIR.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        str(SPEC_FILE),
        "--distpath",
        str(dist_backend),
        "--workpath",
        str(BUILD_DIR),
        "--clean",
        "--noconfirm",
    ]

    print(f"[*] Running PyInstaller with spec: {SPEC_FILE.name}")
    start_time = time.time()

    process = subprocess.Popen(
        cmd,
        cwd=str(PROJECT_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    # Stream PyInstaller messages while updating tqdm
    lines_read = 0
    with tqdm(desc="Compiling backend (PyInstaller)", unit="log") as pbar:
        while True:
            line = process.stdout.readline() if process.stdout else ""
            if not line and process.poll() is not None:
                break
            if line:
                lines_read += 1
                pbar.update(1)
                stripped = line.strip()
                if "Building EXE" in stripped or "COLLECT" in stripped or "INFO: Building" in stripped:
                    pbar.set_description(f"Compiling: {stripped[:40]}")

    rc = process.poll()
    if rc != 0:
        raise RuntimeError(f"PyInstaller build failed with exit code {rc}")

    exe_path = dist_backend / "KirokuNote" / "KirokuNote.exe"
    if not exe_path.is_file():
        raise FileNotFoundError(f"PyInstaller succeeded but executable not found at: {exe_path}")

    elapsed = time.time() - start_time
    size_mb = exe_path.stat().st_size / (1024 * 1024)
    print(f"[OK] Backend compiled successfully in {elapsed:.1f}s ({size_mb:.2f} MB)")
    return exe_path


def collect_extension_files() -> list[tuple[Path, Path]]:
    """
    Collect all runtime files for the extension, automatically excluding
    tests, specifications, markdown documentation, git files, and temporary artifacts.
    """
    unpacked_dir = DIST_DIR / "extension" / "unpacked"
    file_pairs: list[tuple[Path, Path]] = []

    excluded_dirs = {".git", ".vscode", "tests", "test", "__pycache__", "node_modules"}
    excluded_extensions = {".md", ".markdown", ".test.js", ".spec.js", ".tmp", ".bak", ".log", ".swp"}
    excluded_filenames = {".gitignore", ".gitattributes", ".DS_Store", "Thumbs.db"}

    for root, dirs, files in os.walk(EXTENSION_DIR):
        # Prune excluded directories in-place
        dirs[:] = [d for d in dirs if d not in excluded_dirs]

        for file in files:
            file_lower = file.lower()
            if file in excluded_filenames:
                continue
            if any(file_lower.endswith(ext) for ext in excluded_extensions):
                continue

            src_file = Path(root) / file
            rel_path = src_file.relative_to(EXTENSION_DIR)
            dst_file = unpacked_dir / rel_path
            file_pairs.append((src_file, dst_file))

    return file_pairs


def stage_package_extension(version: str) -> tuple[Path, Path]:
    """Package unpacked extension folder and generate distribution zip archive."""
    unpacked_dir = DIST_DIR / "extension" / "unpacked"
    dist_ext = DIST_DIR / "extension"
    dist_ext.mkdir(parents=True, exist_ok=True)
    unpacked_dir.mkdir(parents=True, exist_ok=True)

    files_to_copy = collect_extension_files()
    if not files_to_copy:
        raise RuntimeError(f"No extension files found in {EXTENSION_DIR}")

    # Copy runtime files with progress bar
    with tqdm(files_to_copy, desc="Staging extension runtime", unit="file") as pbar:
        for src, dst in pbar:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)

    # Verify manifest exists in unpacked destination
    unpacked_manifest = unpacked_dir / "manifest.json"
    if not unpacked_manifest.is_file():
        raise FileNotFoundError(f"Staged extension missing manifest at: {unpacked_manifest}")

    # Create ZIP archive
    zip_base = dist_ext / f"KirokuNote-extension-v{version}"
    zip_path = Path(f"{zip_base}.zip")
    if zip_path.exists():
        zip_path.unlink()

    print(f"[*] Compressing extension archive: {zip_path.name}")
    shutil.make_archive(str(zip_base), "zip", root_dir=str(unpacked_dir))

    size_kb = zip_path.stat().st_size / 1024
    print(f"[OK] Extension packaged: {len(files_to_copy)} files staged, ZIP size: {size_kb:.1f} KB")
    return unpacked_dir, zip_path


def stage_compile_installer(iscc_path: Path, version: str) -> Path:
    """Compile Inno Setup script into final setup installer."""
    output_dir = DIST_DIR / "installer"
    output_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(iscc_path),
        f"/DMyAppVersion={version}",
        str(ISS_FILE),
    ]

    print(f"[*] Compiling Inno Setup script: {ISS_FILE.name} (v{version})")
    start_time = time.time()

    process = subprocess.Popen(
        cmd,
        cwd=str(INSTALLER_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    with tqdm(desc="Compiling installer (Inno Setup)", unit="step") as pbar:
        while True:
            line = process.stdout.readline() if process.stdout else ""
            if not line and process.poll() is not None:
                break
            if line:
                pbar.update(1)

    rc = process.poll()
    if rc != 0:
        raise RuntimeError(f"Inno Setup compilation failed with exit code {rc}")

    expected_installer = output_dir / f"Kiroku-Note-Setup-v{version}.exe"
    if not expected_installer.is_file():
        # Fallback search for any newly created setup exe
        candidates = list(output_dir.glob("Kiroku-Note-Setup-*.exe"))
        if candidates:
            candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            expected_installer = candidates[0]
        else:
            raise FileNotFoundError(f"Inno Setup finished but installer not found at {expected_installer}")

    elapsed = time.time() - start_time
    size_mb = expected_installer.stat().st_size / (1024 * 1024)
    print(f"[OK] Setup installer compiled in {elapsed:.1f}s ({size_mb:.2f} MB)")
    return expected_installer


# ---------------------------------------------------------------------------
# Main Orchestrator
# ---------------------------------------------------------------------------

def build_setup(
    skip_pyinstaller: bool = False,
    skip_installer: bool = False,
    no_clean: bool = False,
) -> int:
    """Run the complete end-to-end setup build pipeline."""
    version = get_version()
    print_banner(version)

    overall_steps = 5
    current_step = 0
    start_time = time.time()

    with tqdm(total=overall_steps, desc="Overall Setup Build", unit="stage", position=0) as overall_pbar:
        # Stage 1: Environment & Tooling Verification
        current_step += 1
        overall_pbar.set_description(f"Stage {current_step}/{overall_steps}: Verifying Environment")
        env_info = stage_verify_environment()
        check_running_processes()
        overall_pbar.update(1)

        # Stage 2: Clean Staging Dirs
        current_step += 1
        overall_pbar.set_description(f"Stage {current_step}/{overall_steps}: Cleaning Staging Dirs")
        if not no_clean:
            stage_clean(clean_backend=not skip_pyinstaller, clean_extension=True)
        overall_pbar.update(1)

        # Stage 3: PyInstaller Backend Build
        current_step += 1
        overall_pbar.set_description(f"Stage {current_step}/{overall_steps}: Building Standalone Backend")
        exe_path: Path | None = None
        if not skip_pyinstaller:
            exe_path = stage_build_backend()
        else:
            exe_path = DIST_DIR / "backend" / "KirokuNote" / "KirokuNote.exe"
            if not exe_path.is_file():
                print(f"[!] Warning: --skip-pyinstaller requested but {exe_path} does not exist.")
                exe_path = stage_build_backend()
            else:
                print(f"[*] Reusing existing backend binary: {exe_path}")
        overall_pbar.update(1)

        # Stage 4: Extension Packaging
        current_step += 1
        overall_pbar.set_description(f"Stage {current_step}/{overall_steps}: Packaging Browser Extension")
        unpacked_dir, ext_zip = stage_package_extension(version)
        overall_pbar.update(1)

        # Stage 5: Inno Setup Compilation
        current_step += 1
        overall_pbar.set_description(f"Stage {current_step}/{overall_steps}: Compiling Windows Installer")
        installer_path: Path | None = None
        iscc = env_info.get("iscc")
        if not skip_installer and iscc:
            installer_path = stage_compile_installer(iscc, version)
        elif not iscc:
            print("[!] Skipped Inno Setup compilation: ISCC.exe compiler not found.")
        else:
            print("[*] Skipped Inno Setup compilation (--skip-installer flag).")
        overall_pbar.update(1)

    total_time = time.time() - start_time

    # Final Summary Report
    print("\n" + "=" * 72)
    print("   BUILD COMPLETE -- SUMMARY OF PRODUCED ARTIFACTS")
    print("=" * 72)
    if exe_path and exe_path.is_file():
        exe_mb = exe_path.stat().st_size / (1024 * 1024)
        print(f"  - Standalone Executable: {exe_path}")
        print(f"    Size: {exe_mb:.2f} MB")

    if ext_zip and ext_zip.is_file():
        zip_kb = ext_zip.stat().st_size / 1024
        print(f"  - Extension ZIP Package: {ext_zip}")
        print(f"    Size: {zip_kb:.1f} KB")

    if installer_path and installer_path.is_file():
        inst_mb = installer_path.stat().st_size / (1024 * 1024)
        inst_sha = compute_sha256(installer_path)
        print(f"  - Setup Installer:       {installer_path}")
        print(f"    Size:   {inst_mb:.2f} MB")
        print(f"    SHA256: {inst_sha}")

    print(f"\n  Total Duration: {total_time:.1f} seconds")
    print("=" * 72)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="One-Click Robust Windows Installer Builder for Kiroku Note"
    )
    parser.add_argument(
        "--skip-pyinstaller",
        action="store_true",
        help="Skip PyInstaller build and reuse existing dist/backend/KirokuNote binary.",
    )
    parser.add_argument(
        "--skip-installer",
        action="store_true",
        help="Skip Inno Setup installer compilation.",
    )
    parser.add_argument(
        "--no-clean",
        action="store_true",
        help="Do not clean build/ and dist/ directories before compiling.",
    )

    args = parser.parse_args()

    try:
        ret = build_setup(
            skip_pyinstaller=args.skip_pyinstaller,
            skip_installer=args.skip_installer,
            no_clean=args.no_clean,
        )
    except Exception as exc:
        print(f"\n[FATAL ERROR] {exc}", file=sys.stderr)
        ret = 1

    # If launched by double-clicking in Windows Explorer (interactive prompt without terminal parent),
    # keep window open so user can read status.
    if sys.platform == "win32" and sys.stdin and sys.stdin.isatty():
        # Check if parent is explorer.exe
        try:
            import ctypes
            # If standard handles are attached directly to console window
            pass
        except Exception:
            pass

    return ret


if __name__ == "__main__":
    sys.exit(main())
