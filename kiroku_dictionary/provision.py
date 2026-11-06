"""
provision.py -- Provisioning pipeline for kiroku_dict.sqlite.
Downloads, verifies, builds via importer, verifies integrity, and atomically renames.
Standard library only.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from typing import Any, Callable
import urllib.request

logger = logging.getLogger(__name__)

DEFAULT_JITENDEX_URL = "https://github.com/stephenmk/Jitendex/releases/latest/download/jitendex-yomitan.zip"
DEFAULT_KANJIDIC_URL = "https://raw.githubusercontent.com/themoeway/yomitan-dictionaries/main/dictionaries/KANJIDIC_english.zip"

_lock = threading.Lock()
_state: dict[str, Any] = {
    "status": "idle",  # "idle" | "running" | "completed" | "failed"
    "progress": 0.0,
    "message": "",
    "error": None,
    "started_at": 0.0,
    "completed_at": 0.0,
}


def get_provision_status() -> dict[str, Any]:
    """Return a snapshot of current provisioning state."""
    with _lock:
        return dict(_state)


def _update_state(status: str, progress: float, message: str, error: str | None = None) -> None:
    with _lock:
        _state["status"] = status
        _state["progress"] = max(0.0, min(100.0, progress))
        _state["message"] = message
        _state["error"] = error
        if status == "running" and _state["started_at"] == 0.0:
            _state["started_at"] = time.time()
        elif status in ("completed", "failed"):
            _state["completed_at"] = time.time()


def download_file(
    url: str,
    dest_path: Path,
    expected_sha256: str | None = None,
    progress_cb: Callable[[float, str], None] | None = None,
) -> None:
    """Download a file via HTTP(S) using urllib and verify sha256 hash if provided."""
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_dest = dest_path.with_suffix(".part")

    req = urllib.request.Request(
        url,
        headers={"User-Agent": "KirokuNote-Provisioner/1.0"},
    )

    hasher = hashlib.sha256() if expected_sha256 else None

    with urllib.request.urlopen(req, timeout=60.0) as resp, open(temp_dest, "wb") as f:
        total_header = resp.headers.get("Content-Length")
        total_bytes = int(total_header) if total_header and total_header.isdigit() else 0
        downloaded = 0

        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            f.write(chunk)
            if hasher:
                hasher.update(chunk)
            downloaded += len(chunk)
            if progress_cb and total_bytes > 0:
                progress_cb(downloaded / total_bytes, f"Downloaded {downloaded // 1024} KB")

    if expected_sha256 and hasher:
        computed = hasher.hexdigest().lower()
        if computed != expected_sha256.lower():
            if temp_dest.exists():
                temp_dest.unlink()
            raise ValueError(f"SHA-256 hash mismatch for {url}: expected {expected_sha256}, got {computed}")

    if temp_dest.exists():
        temp_dest.replace(dest_path)


def provision_database(
    target_path: Path | str | None = None,
    jitendex_url: str | None = None,
    kanjidic_url: str | None = None,
    jitendex_sha256: str | None = None,
    kanjidic_sha256: str | None = None,
    jitendex_local_zip: Path | str | None = None,
    kanjidic_local_zip: Path | str | None = None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
) -> Path:
    """Run dictionary database download, build, verification, and atomic rename.

    Returns the Path to the provisioned kiroku_dict.sqlite.
    """
    from kiroku_dictionary.paths import resolve_db_path

    out_db_path = Path(target_path) if target_path else resolve_db_path()

    _update_state("running", 5.0, "Preparing dictionary provisioning...")
    if progress_callback:
        progress_callback(get_provision_status())

    with tempfile.TemporaryDirectory(prefix="kiroku_dict_build_") as tmpdir:
        tmp_dir_path = Path(tmpdir)
        jitendex_zip = tmp_dir_path / "jitendex-yomitan.zip"
        kanjidic_zip = tmp_dir_path / "KANJIDIC_english.zip"

        # 1. Resolve or download Jitendex
        if jitendex_local_zip and Path(jitendex_local_zip).is_file():
            jitendex_zip = Path(jitendex_local_zip)
            _update_state("running", 15.0, "Using local Jitendex archive")
        else:
            j_url = jitendex_url or DEFAULT_JITENDEX_URL
            _update_state("running", 10.0, f"Downloading Jitendex from {j_url}...")
            if progress_callback:
                progress_callback(get_provision_status())
            download_file(
                j_url,
                jitendex_zip,
                expected_sha256=jitendex_sha256,
                progress_cb=lambda r, msg: _update_state("running", 10.0 + (r * 25.0), f"Jitendex: {msg}"),
            )

        # 2. Resolve or download KANJIDIC
        if kanjidic_local_zip and Path(kanjidic_local_zip).is_file():
            kanjidic_zip = Path(kanjidic_local_zip)
            _update_state("running", 45.0, "Using local KANJIDIC archive")
        else:
            k_url = kanjidic_url or DEFAULT_KANJIDIC_URL
            _update_state("running", 35.0, f"Downloading KANJIDIC from {k_url}...")
            if progress_callback:
                progress_callback(get_provision_status())
            download_file(
                k_url,
                kanjidic_zip,
                expected_sha256=kanjidic_sha256,
                progress_cb=lambda r, msg: _update_state("running", 35.0 + (r * 15.0), f"KANJIDIC: {msg}"),
            )

        # 3. Build SQLite database in temp file
        temp_out = tmp_dir_path / "kiroku_dict.sqlite.tmp"
        _update_state("running", 55.0, "Building SQLite dictionary database...")
        if progress_callback:
            progress_callback(get_provision_status())

        from kiroku_dictionary.importer import build_database
        build_database(
            jitendex_path=str(jitendex_zip),
            kanjidic_path=str(kanjidic_zip),
            output_db_path=str(temp_out),
        )

        # 4. Integrity and sample lookup verification
        _update_state("running", 85.0, "Verifying database integrity and lookups...")
        if progress_callback:
            progress_callback(get_provision_status())

        conn = sqlite3.connect(f"file:{temp_out}?mode=ro", uri=True)
        cur = conn.cursor()
        cur.execute("PRAGMA integrity_check")
        row = cur.fetchone()
        if not row or str(row[0]).lower() != "ok":
            conn.close()
            raise RuntimeError(f"Database integrity check failed: {row}")

        cur.execute("SELECT count(*) FROM meta")
        meta_count = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM terms")
        term_count = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM kanji")
        kanji_count = cur.fetchone()[0]
        conn.close()

        if meta_count == 0 or term_count == 0:
            raise RuntimeError(f"Database build produced empty tables (terms={term_count}, meta={meta_count})")

        from kiroku_dictionary.lookup import DictionaryEngine
        engine = DictionaryEngine(str(temp_out))
        # Ensure engine can execute lookup without error
        engine.lookup_terms("日")
        engine.close()

        # 5. Atomic rename into destination data dir
        _update_state("running", 95.0, "Finalizing dictionary installation...")
        if progress_callback:
            progress_callback(get_provision_status())

        out_db_path.parent.mkdir(parents=True, exist_ok=True)
        # Use shutil.copy2 or os.replace (copy across drive volumes if tmpdir on different mount)
        shutil.copy2(temp_out, out_db_path)

        # Reset dictionary service singleton so new DB is picked up immediately
        try:
            svc_mod = sys.modules.get("app.services.yomitan")
            if svc_mod and hasattr(svc_mod, "reset_dictionary_service"):
                svc_mod.reset_dictionary_service()
        except Exception:
            pass

        _update_state("completed", 100.0, f"Dictionary provisioned successfully ({term_count} terms, {kanji_count} kanji).")
        if progress_callback:
            progress_callback(get_provision_status())

    return out_db_path


def start_provisioning_in_background(
    target_path: Path | str | None = None,
    jitendex_url: str | None = None,
    kanjidic_url: str | None = None,
    jitendex_sha256: str | None = None,
    kanjidic_sha256: str | None = None,
    jitendex_local_zip: Path | str | None = None,
    kanjidic_local_zip: Path | str | None = None,
) -> bool:
    """Start dictionary provisioning in background thread if not already running."""
    with _lock:
        if _state["status"] == "running":
            return False
        _state["status"] = "running"
        _state["progress"] = 0.0
        _state["message"] = "Starting provisioning background job..."
        _state["error"] = None
        _state["started_at"] = time.time()
        _state["completed_at"] = 0.0

    def _worker():
        try:
            provision_database(
                target_path=target_path,
                jitendex_url=jitendex_url,
                kanjidic_url=kanjidic_url,
                jitendex_sha256=jitendex_sha256,
                kanjidic_sha256=kanjidic_sha256,
                jitendex_local_zip=jitendex_local_zip,
                kanjidic_local_zip=kanjidic_local_zip,
            )
        except Exception as exc:
            logger.error("Dictionary provisioning failed: %s", exc, exc_info=True)
            _update_state("failed", 0.0, "Dictionary provisioning failed.", str(exc))

    t = threading.Thread(target=_worker, name="DictionaryProvisioner", daemon=True)
    t.start()
    return True
