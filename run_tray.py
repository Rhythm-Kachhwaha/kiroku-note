"""Kiroku Note Windows tray host for the local FastAPI backend."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

import pystray
from PIL import Image, ImageDraw
import uvicorn


PROJECT_ROOT = Path(__file__).resolve().parent
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import (  # noqa: E402
    APP_NAME,
    DEFAULT_KIROKU_HOST,
    get_app_data_dir,
    resolve_port,
)


RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
STARTUP_VALUE = "KirokuNote"


def _make_icon() -> Image.Image:
    image = Image.new("RGBA", (64, 64), (25, 25, 25, 255))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((8, 8, 56, 56), radius=12, fill=(231, 111, 81, 255))
    draw.ellipse((20, 20, 44, 44), fill=(25, 25, 25, 255))
    draw.ellipse((27, 27, 37, 37), fill=(245, 241, 232, 255))
    return image


def _startup_enabled() -> bool:
    if os.name != "nt":
        return False
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            value, _ = winreg.QueryValueEx(key, STARTUP_VALUE)
            return bool(value)
    except OSError:
        return False


def _set_startup_enabled(enabled: bool) -> None:
    if os.name != "nt":
        return
    import winreg

    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
        if enabled:
            executable = Path(sys.executable).resolve()
            winreg.SetValueEx(key, STARTUP_VALUE, 0, winreg.REG_SZ, f'"{executable}" --startup')
        else:
            try:
                winreg.DeleteValue(key, STARTUP_VALUE)
            except FileNotFoundError:
                pass


class TrayHost:
    def __init__(self) -> None:
        self.host = DEFAULT_KIROKU_HOST
        self.port = resolve_port()
        self.base_url = f"http://{self.host}:{self.port}"
        self.server: uvicorn.Server | None = None
        self.server_thread: threading.Thread | None = None
        self.state = "Starting"
        self.error = ""
        self.icon: pystray.Icon | None = None
        self._lock = threading.Lock()

    def start_backend(self) -> None:
        with self._lock:
            if self.server_thread and self.server_thread.is_alive():
                return
            self.state = "Starting"
            self.error = ""
            from app.main import app

            config = uvicorn.Config(
                app,
                host=self.host,
                port=self.port,
                log_level="warning",
                access_log=False,
                log_config=None,
                reload=False,
            )
            self.server = uvicorn.Server(config)
            self.server_thread = threading.Thread(target=self._run_backend, name="kiroku-backend", daemon=True)
            self.server_thread.start()

    def _run_backend(self) -> None:
        assert self.server is not None
        try:
            self.server.run()
        except Exception as exc:
            with self._lock:
                self.state = "Error"
                self.error = str(exc)

    def stop_backend(self) -> None:
        with self._lock:
            server = self.server
            thread = self.server_thread
            self.server = None
            self.server_thread = None
        if server is not None:
            server.should_exit = True
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=5)

    def restart_backend(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        self.stop_backend()
        self.start_backend()
        icon.update_menu()

    def quit(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        self.stop_backend()
        icon.stop()

    def toggle_startup(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        _set_startup_enabled(not _startup_enabled())
        icon.update_menu()

    def open_folder(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        folder = get_app_data_dir()
        folder.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(str(folder))
        else:
            subprocess.Popen(["xdg-open", str(folder)])

    def _get_json(self, path: str) -> dict[str, object] | None:
        try:
            with urllib.request.urlopen(f"{self.base_url}{path}", timeout=0.4) as response:
                value = json.loads(response.read().decode("utf-8"))
                return value if isinstance(value, dict) else None
        except (OSError, urllib.error.URLError, ValueError):
            return None

    def refresh_status(self) -> None:
        payload = self._get_json("/api/cards?limit=1")
        with self._lock:
            if payload is not None:
                self.state = "Running"
            elif self.state != "Error":
                self.state = "Starting" if self.server_thread and self.server_thread.is_alive() else "Error"
        if self.icon:
            self.icon.update_menu()

    def _service_label(self, path: str, name: str) -> str:
        payload = self._get_json(path)
        if path == "/api/ocr/status":
            if not payload or not payload.get("installed"):
                return f"{name}: Not installed"
            return f"{name}: Ready" if payload.get("available") else f"{name}: Starting"
        connected = bool(
            payload
            and (
                payload.get("available", payload.get("connected", False))
                or payload.get("available_dictionaries")
            )
        )
        return f"{name}: {'Connected' if connected else 'Not found'}"

    def run(self) -> bool:
        self.start_backend()
        deadline = time.time() + 10.0
        while self.server_thread and self.server_thread.is_alive() and not self.server.started:
            if time.time() >= deadline:
                break
            time.sleep(0.05)

        if self.server is None or not self.server.started:
            self.stop_backend()
            return False

        def poll() -> None:
            while self.icon:
                self.refresh_status()
                time.sleep(2)

        self.icon = pystray.Icon(
            APP_NAME,
            _make_icon(),
            APP_NAME,
            pystray.Menu(
                pystray.MenuItem(lambda item: f"Kiroku - {self.state}", None, enabled=False),
                pystray.MenuItem(f"Server: {self.host}:{self.port}", None, enabled=False),
                pystray.MenuItem(lambda item: self._service_label("/api/yomitan/dictionaries", "Yomitan"), None, enabled=False),
                pystray.MenuItem(lambda item: self._service_label("/api/anki/status", "AnkiConnect"), None, enabled=False),
                pystray.MenuItem(lambda item: self._service_label("/api/ocr/status", "OCR"), None, enabled=False),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Start with Windows", self.toggle_startup, checked=lambda item: _startup_enabled()),
                pystray.MenuItem("Open Kiroku folder", self.open_folder),
                pystray.MenuItem("Restart", self.restart_backend),
                pystray.MenuItem("Quit", self.quit),
            ),
        )
        threading.Thread(target=poll, name="kiroku-tray-status", daemon=True).start()
        self.icon.run()
        return True


def main() -> None:
    if "--startup" in sys.argv:
        os.environ.setdefault("KIROKU_STARTUP", "1")
    if not TrayHost().run():
        raise SystemExit(1)


if __name__ == "__main__":
    main()