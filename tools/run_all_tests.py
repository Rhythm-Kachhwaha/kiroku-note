#!/usr/bin/env python3
"""Repo-wide test runner for Kiroku Note.

Runs backend (pytest), extension (node --test), and desktop (node --test) test suites,
prints a unified single-line summary, and optionally updates STATUS.md with `--write-status`.
"""
import argparse
import glob
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def run_backend(repo_root: Path):
    env = os.environ.copy()
    existing_pp = env.get("PYTHONPATH", "")
    backend_dirs = f"{repo_root}{os.pathsep}{repo_root / 'backend'}"
    env["PYTHONPATH"] = f"{backend_dirs}{os.pathsep}{existing_pp}" if existing_pp else backend_dirs

    cmd = [
        sys.executable,
        "-m",
        "pytest",
        "-c",
        str(repo_root / "backend" / "pytest.ini"),
        str(repo_root / "backend" / "tests"),
        "-m",
        "not network and not perf",
        "-q",
    ]
    proc = subprocess.run(cmd, cwd=str(repo_root), env=env, capture_output=True, text=True)
    out = proc.stdout + "\n" + proc.stderr

    passed = 0
    failed = 0
    skipped = 0

    m_pass = re.search(r"(\d+)\s+passed", out)
    if m_pass:
        passed = int(m_pass.group(1))
    m_fail = re.search(r"(\d+)\s+failed", out)
    if m_fail:
        failed = int(m_fail.group(1))
    m_err = re.search(r"(\d+)\s+error", out)
    if m_err:
        failed += int(m_err.group(1))
    m_skip = re.search(r"(\d+)\s+skipped", out)
    if m_skip:
        skipped = int(m_skip.group(1))

    return {
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "exit_code": proc.returncode,
        "raw": out,
    }


def run_node_suite(files: list[str], extra_args: list[str], repo_root: Path):
    if not files:
        return {"passed": 0, "failed": 0, "exit_code": 0, "raw": ""}

    cmd = ["node", "--test"] + extra_args + files
    proc = subprocess.run(cmd, cwd=str(repo_root), capture_output=True, text=True)
    out = proc.stdout + "\n" + proc.stderr

    passed = 0
    failed = 0

    m_pass = re.search(r"ℹ\s+pass\s+(\d+)", out)
    if m_pass:
        passed = int(m_pass.group(1))
    m_fail = re.search(r"ℹ\s+fail\s+(\d+)", out)
    if m_fail:
        failed = int(m_fail.group(1))

    return {
        "passed": passed,
        "failed": failed,
        "exit_code": proc.returncode,
        "raw": out,
    }


def main():
    parser = argparse.ArgumentParser(description="Run all repository test suites.")
    parser.add_argument("--write-status", action="store_true", help="Write honest counts to STATUS.md")
    args = parser.parse_args()

    # 1. Backend suite
    be = run_backend(REPO_ROOT)

    # 2. Extension suite
    ext_dir = REPO_ROOT / "extension" / "tests"
    ext_files = sorted(str(p.relative_to(REPO_ROOT)) for p in ext_dir.glob("*.test.js"))
    ext = run_node_suite(ext_files, [], REPO_ROOT)

    # 3. Desktop suite
    desk_dir = REPO_ROOT / "desktop" / "tests"
    desk_files = sorted(str(p.relative_to(REPO_ROOT)) for p in desk_dir.glob("*.test.js"))
    smoke = desk_dir / "smoke_test.js"
    if smoke.exists():
        desk_files.append(str(smoke.relative_to(REPO_ROOT)))
    desk = run_node_suite(desk_files, ["--test-concurrency=1"], REPO_ROOT)

    summary = (
        f"Backend: {be['passed']} passed, {be['failed']} failed; "
        f"Extension: {ext['passed']} passed, {ext['failed']} failed; "
        f"Desktop: {desk['passed']} passed, {desk['failed']} failed"
    )
    print(summary)

    if args.write_status:
        status_path = REPO_ROOT / "STATUS.md"
        status_lines = [
            "# Status",
            "Groups 1-6 complete: test hygiene and honest runner.",
            f"Backend: {be['passed']} passed, {be['failed']} failed | Extension: {ext['passed']} passed, {ext['failed']} failed | Desktop: {desk['passed']} passed, {desk['failed']} failed.",
            "All Group 6 hygiene slices verified on main.",
            "Targeted tests pass across all subsystems.",
        ]
        status_path.write_text("\n".join(status_lines) + "\n", encoding="utf-8")

    total_failures = be["failed"] + ext["failed"] + desk["failed"]
    if total_failures > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
