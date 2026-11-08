import os
import sys
import time
import subprocess
import tempfile
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
EXT_DIR = ROOT_DIR / "extension"

class BackendRunner:
    def __init__(self, port=21828):
        self.port = port
        self.temp_dir = tempfile.TemporaryDirectory()
        self.process = None

    def start(self):
        env = os.environ.copy()
        env["PYTHONPATH"] = f"{ROOT_DIR};{ROOT_DIR / 'backend'}"
        env["KIROKU_DATA_DIR"] = self.temp_dir.name
        env["KIROKU_PORT"] = str(self.port)
        env["KIROKU_EXTENSION_PAIRING_ENABLED"] = "1"
        env["KIROKU_STUDY_API_TOKEN"] = "desktop-test-token"

        cmd = [
            sys.executable,
            "-m", "uvicorn",
            "app.main:app",
            "--host", "127.0.0.1",
            "--port", str(self.port),
            "--log-level", "warning"
        ]
        self.process = subprocess.Popen(cmd, env=env, cwd=str(ROOT_DIR / "backend"))

        # Wait for health
        url = f"http://127.0.0.1:{self.port}/api/health"
        for _ in range(30):
            try:
                with urllib.request.urlopen(url, timeout=1) as resp:
                    if resp.status == 200:
                        return
            except Exception:
                time.sleep(0.3)
        raise RuntimeError("Backend failed to start within 10 seconds")

    def stop(self):
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except Exception:
                self.process.kill()
        self.temp_dir.cleanup()
