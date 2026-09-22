"""
Automated verification tests for the standalone Kiroku Note Windows tray application.

IMPORTANT TEST SAFETY:
All runtime subprocess tests run against an isolated temporary directory and a dedicated
non-standard test port to ensure zero side-effects on developer/user data or active servers.
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import json
import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DIST_EXE = REPO_ROOT / "dist" / "backend" / "KirokuNote" / "KirokuNote.exe"
TEST_PORT = 21837


@pytest.mark.skipif(sys.platform != "win32", reason="Windows standalone executable test")
def test_executable_exists_and_size():
    if not DIST_EXE.exists():
        pytest.skip("Release backend has not been built")
    assert DIST_EXE.exists(), f"Expected standalone executable at: {DIST_EXE}"
    size_mb = DIST_EXE.stat().st_size / (1024 * 1024)
    assert 5.0 <= size_mb <= 120.0, f"Executable size unexpected: {size_mb:.2f} MB"


@pytest.mark.skipif(sys.platform != "win32", reason="Windows standalone executable test")
def test_standalone_executable_runtime_isolated():
    """
    Subprocess test verifying standalone executable launches, serves API routes,
    disables docs in production, persists cards in isolated storage, and handles port collision.
    """
    if not DIST_EXE.exists():
        pytest.skip(f"Executable not built yet at {DIST_EXE}")

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        isolated_data_dir = temp_path / "kiroku_user_data"
        isolated_db_path = isolated_data_dir / "data" / "kiroku_test.db"
        isolated_media_dir = isolated_data_dir / "media"

        isolated_data_dir.mkdir(parents=True, exist_ok=True)
        isolated_media_dir.mkdir(parents=True, exist_ok=True)

        env = os.environ.copy()
        env["KIROKU_PORT"] = str(TEST_PORT)
        env["KIROKU_DATA_DIR"] = str(isolated_data_dir)
        env["KIROKU_DB_PATH"] = str(isolated_db_path)
        env["KIROKU_MEDIA_DIR"] = str(isolated_media_dir)
        # Ensure debug is off for production verification
        env.pop("KIROKU_DEBUG", None)

        proc = subprocess.Popen(
            [str(DIST_EXE)],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            text=True,
        )

        base_url = f"http://127.0.0.1:{TEST_PORT}"
        ready = False
        start_time = time.time()

        try:
            # Poll /api/cards until backend is ready and responding
            while time.time() - start_time < 20:
                if proc.poll() is not None:
                    pytest.fail(f"Executable exited prematurely with code {proc.returncode}.")

                try:
                    req = urllib.request.Request(f"{base_url}/api/cards")
                    with urllib.request.urlopen(req, timeout=1.5) as resp:
                        if resp.status == 200:
                            ready = True
                            break
                except Exception:
                    time.sleep(0.5)

            if not ready:
                pytest.fail(f"Executable failed to become ready within 20s at {base_url}.")

            # 1. Verify /docs and /redoc are disabled in production (404)
            for doc_path in ("/docs", "/redoc"):
                try:
                    req = urllib.request.Request(f"{base_url}{doc_path}")
                    with urllib.request.urlopen(req, timeout=2.0) as resp:
                        pytest.fail(f"Expected 404 for {doc_path}, got HTTP {resp.status}")
                except urllib.error.HTTPError as err:
                    assert err.code == 404, f"Expected 404 for {doc_path}, got HTTP {err.code}"

            # 2. Verify database was initialized in the isolated path
            assert isolated_db_path.exists(), f"Database was not created at isolated path: {isolated_db_path}"

            # 3. Test saving a card via HTTP API
            card_payload = json.dumps({
                "expression": "約束",
                "reading": "やくそく",
                "meaning": "promise; agreement",
                "deck_name": "TestDeck",
            }).encode("utf-8")

            save_req = urllib.request.Request(
                f"{base_url}/api/cards/save",
                data=card_payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(save_req, timeout=3.0) as save_resp:
                assert save_resp.status == 200
                save_data = json.loads(save_resp.read().decode("utf-8"))
                assert save_data.get("id") is not None
                assert save_data.get("expression") == "約束"
                assert save_data.get("status") == "saved"

            # 4. Test listing cards
            list_req = urllib.request.Request(f"{base_url}/api/cards")
            with urllib.request.urlopen(list_req, timeout=3.0) as list_resp:
                assert list_resp.status == 200
                list_data = json.loads(list_resp.read().decode("utf-8"))
                assert list_data.get("total", 0) >= 1
                cards = list_data.get("cards", [])
                assert any(c.get("expression") == "約束" for c in cards)

            # 5. Test port collision behavior
            # Attempt to launch a second instance on the exact same port
            collision_proc = subprocess.Popen(
                [str(DIST_EXE)],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            coll_stdout, coll_stderr = collision_proc.communicate(timeout=10)
            assert collision_proc.returncode == 1, f"Expected exit code 1 on port collision, got {collision_proc.returncode}"
            combined_err = (coll_stdout or "") + (coll_stderr or "")
            assert "already occupied or unavailable" in combined_err or "10048" in combined_err

        finally:
            # Terminate running process cleanly
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            time.sleep(0.5)
