"""Kiroku Note Windows tray host for the local FastAPI backend."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

import pystray
from PIL import Image, ImageDraw, ImageFont
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
_MUTEX_HANDLE = None


def _setup_logging() -> Path:
    """Initialize file logging in %LOCALAPPDATA%/KirokuNote/logs/tray_host.log."""
    log_dir = get_app_data_dir() / "logs"
    log_file = log_dir / "tray_host.log"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        if not logging.getLogger().handlers:
            logging.basicConfig(
                filename=str(log_file),
                level=logging.INFO,
                format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                encoding="utf-8",
            )
    except Exception:
        pass
    return log_file


def _acquire_single_instance_mutex() -> bool:
    """Acquire a Windows named mutex to prevent duplicate running instances."""
    global _MUTEX_HANDLE
    if os.name != "nt":
        return True
    try:
        import ctypes
        ERROR_ALREADY_EXISTS = 183
        mutex_name = "Local\\KirokuNote_SingleInstance_Mutex"
        handle = ctypes.windll.kernel32.CreateMutexW(None, False, mutex_name)
        if ctypes.windll.kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
            if handle:
                ctypes.windll.kernel32.CloseHandle(handle)
            return False
        _MUTEX_HANDLE = handle
        return True
    except Exception:
        return True


def _release_single_instance_mutex() -> None:
    """Release the process-owned single-instance mutex when shutting down."""
    global _MUTEX_HANDLE
    if _MUTEX_HANDLE:
        try:
            import ctypes
            ctypes.windll.kernel32.CloseHandle(_MUTEX_HANDLE)
        except Exception:
            pass
        _MUTEX_HANDLE = None


def _handle_already_running() -> int:
    """Provide feedback when another instance is already running."""
    port = resolve_port()
    url = f"http://{DEFAULT_KIROKU_HOST}:{port}/api/health"
    alive = False
    try:
        with urllib.request.urlopen(url, timeout=1.0) as resp:
            alive = (resp.status == 200)
    except Exception:
        pass
    if not alive:
        try:
            with socket.create_connection((DEFAULT_KIROKU_HOST, port), timeout=0.25):
                alive = True
        except OSError:
            pass

    if "--startup" in sys.argv:
        return 0

    if alive:
        if sys.stderr is not None:
            print("Port already occupied or unavailable; another Kiroku Note instance is running.", file=sys.stderr)
        if os.name == "nt" and not os.environ.get("PYTEST_CURRENT_TEST"):
            try:
                import ctypes
                ctypes.windll.user32.MessageBoxW(
                    None,
                    "Kiroku Note is already running in the background.\n\n"
                    "Look for the 'あ' icon in your system tray (notification area near your clock, or click the ^ arrow).\n\n"
                    "Right-click the icon to view status, extension setup guide, or open user data.",
                    "Kiroku Note Already Running",
                    0x40 | 0x10000,  # MB_ICONINFORMATION | MB_SETFOREGROUND
                )
            except Exception:
                pass
        return 1
    return 0


def _show_error_dialog(message: str, title: str = "Kiroku Note Startup Error") -> None:
    """Show a Windows native error message box if not running headlessly."""
    if os.name == "nt" and not os.environ.get("PYTEST_CURRENT_TEST") and "--startup" not in sys.argv:
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                None,
                message,
                title,
                0x10 | 0x10000,  # MB_ICONERROR | MB_SETFOREGROUND
            )
        except Exception:
            pass


def _make_icon() -> Image.Image:
    # Try loading pre-rendered asset first
    candidate_paths = [
        PROJECT_ROOT / "assets" / "icon.png",
        PROJECT_ROOT.parent / "assets" / "icon.png",
    ]
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        candidate_paths.insert(0, Path(sys._MEIPASS) / "assets" / "icon.png")
    
    for path in candidate_paths:
        if path.exists():
            try:
                return Image.open(path).resize((64, 64), Image.Resampling.LANCZOS)
            except Exception:
                pass

    # Dynamic fallback rendering of Hiragana 'あ' in vibrant orange on a lighter dark tile
    scale = 4
    canvas_size = 64 * scale
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    margin = int(canvas_size * 0.05)
    radius = int(canvas_size * 0.22)
    draw.rounded_rectangle(
        (margin, margin, canvas_size - margin, canvas_size - margin),
        radius=radius,
        fill=(45, 41, 37, 255),
        outline=(97, 86, 76, 255),
        width=max(1, int(4 * scale))
    )

    font_candidates = [
        r"C:\Windows\Fonts\NotoSansJP-VF.ttf",
        r"C:\Windows\Fonts\YuGothB.ttc",
        r"C:\Windows\Fonts\meiryob.ttc",
        r"C:\Windows\Fonts\BIZ-UDGothicB.ttc",
        r"C:\Windows\Fonts\msgothic.ttc",
    ]
    font = None
    for fc in font_candidates:
        if os.path.exists(fc):
            try:
                font = ImageFont.truetype(fc, int(canvas_size * 0.58))
                break
            except Exception:
                continue
    if font is None:
        try:
            font = ImageFont.load_default()
        except Exception:
            pass

    char = "あ"
    bbox = draw.textbbox((0, 0), char, font=font) if font else (0, 0, 32, 32)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = (canvas_size - text_w) // 2 - bbox[0]
    y = (canvas_size - text_h) // 2 - bbox[1] - int(canvas_size * 0.02)

    shadow_offset = max(1, int(2 * scale))
    draw.text((x + shadow_offset, y + shadow_offset), char, font=font, fill=(20, 18, 16, 200))
    draw.text((x, y), char, font=font, fill=(255, 106, 19, 255))

    return image.resize((64, 64), Image.Resampling.LANCZOS)


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

        # In-memory cached status to prevent blocking and hover-flicker during menu display
        self._yomitan_connected: bool = False
        self._anki_connected: bool = False
        self._ocr_installed: bool = False
        self._ocr_available: bool = False
        self._last_menu_state: tuple[str, bool, bool, bool, bool, bool] | None = None

    def start_backend(self) -> None:
        with self._lock:
            if self.server_thread and self.server_thread.is_alive():
                return
            self.state = "Starting"
            self.error = ""
            try:
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
                logging.info(f"Started backend server thread on {self.host}:{self.port}")
            except Exception as exc:
                import traceback
                err = traceback.format_exc()
                logging.error(f"Failed to initialize backend application:\n{err}")
                self.state = "Error"
                self.error = str(exc)

    def _run_backend(self) -> None:
        assert self.server is not None
        try:
            self.server.run()
        except Exception as exc:
            import traceback
            err = traceback.format_exc()
            logging.error(f"Backend server failed or crashed:\n{err}")
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
        self.refresh_status(force_update=True)

    def quit(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        self.stop_backend()
        icon.stop()

    def toggle_startup(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        _set_startup_enabled(not _startup_enabled())
        if self.icon:
            self.icon.update_menu()

    def open_folder(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        folder = get_app_data_dir()
        folder.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(str(folder))
        else:
            subprocess.Popen(["xdg-open", str(folder)])

    def open_instructions(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        candidates = [
            PROJECT_ROOT / "installer" / "extension_instructions.txt",
            PROJECT_ROOT / "extension_instructions.txt",
            Path(sys.executable).parent / "extension_instructions.txt",
        ]
        for c in candidates:
            if c.exists():
                if os.name == "nt":
                    os.startfile(str(c))
                else:
                    subprocess.Popen(["xdg-open", str(c)])
                return
        self.open_folder(icon, item)

    def open_status_page(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        import webbrowser
        webbrowser.open(f"{self.base_url}/api/cards?limit=1")

    def toggle_ocr(self, icon: pystray.Icon, item: pystray.MenuItem) -> None:
        """Start or stop the OCR daemon on user action."""
        action = "stop" if self._ocr_available else "start"
        threading.Thread(target=self._exec_ocr_toggle, args=(action,), daemon=True).start()

    def _exec_ocr_toggle(self, action: str) -> None:
        try:
            req = urllib.request.Request(f"{self.base_url}/api/ocr/{action}", method="POST", data=b"{}")
            req.add_header("Content-Type", "application/json")
            with urllib.request.urlopen(req, timeout=10.0) as resp:
                pass
        except Exception:
            pass
        self.refresh_status(force_update=True)

    def _get_json(self, path: str) -> dict[str, object] | None:
        try:
            with urllib.request.urlopen(f"{self.base_url}{path}", timeout=0.5) as response:
                value = json.loads(response.read().decode("utf-8"))
                return value if isinstance(value, dict) else None
        except (OSError, urllib.error.URLError, ValueError):
            return None

    def refresh_status(self, force_update: bool = False) -> None:
        backend_payload = self._get_json("/api/health")
        with self._lock:
            if backend_payload is not None:
                self.state = "Running"
            elif self.state != "Error":
                self.state = "Starting" if self.server_thread and self.server_thread.is_alive() else "Error"

        yomitan_payload = self._get_json("/api/yomitan/dictionaries")
        anki_payload = self._get_json("/api/anki/status")
        ocr_payload = self._get_json("/api/ocr/status")

        with self._lock:
            self._yomitan_connected = bool(yomitan_payload and yomitan_payload.get("available_dictionaries"))
            self._anki_connected = bool(anki_payload and anki_payload.get("connected"))
            self._ocr_installed = bool(ocr_payload and ocr_payload.get("installed"))
            self._ocr_available = bool(ocr_payload and ocr_payload.get("available"))

            current_state = (
                self.state,
                self._yomitan_connected,
                self._anki_connected,
                self._ocr_installed,
                self._ocr_available,
                _startup_enabled(),
            )
            state_changed = (self._last_menu_state != current_state)
            if state_changed:
                self._last_menu_state = current_state

        # ONLY update menu if values actually changed or forced, eliminating hover stutter/blue flicker
        if self.icon and (state_changed or force_update):
            self.icon.update_menu()

    def _header_label(self) -> str:
        if self.state == "Running":
            return f"● Kiroku Note (Running • :{self.port})"
        elif self.state == "Starting":
            return "○ Kiroku Note (Starting...)"
        return "✕ Kiroku Note (Stopped)"

    def _yomitan_label(self) -> str:
        dot = "●" if self._yomitan_connected else "○"
        status_text = "Connected" if self._yomitan_connected else "Not found"
        return f"  {dot} Yomitan: {status_text}"

    def _anki_label(self) -> str:
        dot = "●" if self._anki_connected else "○"
        status_text = "Connected" if self._anki_connected else "Not found"
        return f"  {dot} AnkiConnect: {status_text}"

    def _ocr_label(self) -> str:
        if not self._ocr_installed:
            return "  ○ OCR Engine: Not installed"
        if self._ocr_available:
            return "  ● OCR Engine: Ready (Active)"
        return "  ○ OCR Engine: Off (Stopped)"

    def _ocr_action_label(self) -> str:
        if self._ocr_available:
            return "⏹ Stop OCR Engine"
        return "▶ Start OCR Engine"

    def _ocr_action_visible(self) -> bool:
        return self._ocr_installed

    def _build_menu(self) -> pystray.Menu:
        return pystray.Menu(
            pystray.MenuItem(lambda item: self._header_label(), None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Service Status:", None, enabled=False),
            pystray.MenuItem(lambda item: self._yomitan_label(), None, enabled=False),
            pystray.MenuItem(lambda item: self._anki_label(), None, enabled=False),
            pystray.MenuItem(lambda item: self._ocr_label(), None, enabled=False),
            pystray.MenuItem(
                lambda item: self._ocr_action_label(),
                self.toggle_ocr,
                visible=lambda item: self._ocr_action_visible(),
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Extension Setup Guide", self.open_instructions, default=True),
            pystray.MenuItem("Open User Data Folder", self.open_folder),
            pystray.MenuItem("Backend Status (Browser)", self.open_status_page),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Start with Windows", self.toggle_startup, checked=lambda item: _startup_enabled()),
            pystray.MenuItem("Restart Backend", self.restart_backend),
            pystray.MenuItem("Quit Kiroku Note", self.quit),
        )

    def run(self) -> bool:
        self.start_backend()
        deadline = time.time() + 10.0
        while self.server_thread and self.server_thread.is_alive() and not (self.server and self.server.started):
            if time.time() >= deadline:
                break
            time.sleep(0.05)

        if self.server is None or not self.server.started:
            self.stop_backend()
            logging.error(f"Backend failed to reach started state within 10s. Last error: {self.error}")
            return False

        # Pre-populate status
        self.refresh_status(force_update=True)

        def poll() -> None:
            while self.icon:
                self.refresh_status()
                time.sleep(2)

        self.icon = pystray.Icon(
            APP_NAME,
            _make_icon(),
            APP_NAME,
            self._build_menu(),
        )

        # Notify user on manual launch that app is active in system tray
        if "--startup" not in sys.argv:
            try:
                self.icon.notify(
                    "Kiroku Note is active in your background and ready.",
                    "Kiroku Note"
                )
            except Exception:
                pass

        threading.Thread(target=poll, name="kiroku-tray-status", daemon=True).start()
        self.icon.run()
        return True


def main() -> None:
    # For frozen windowed (.exe) binaries, attach to parent console if invoked from terminal
    if getattr(sys, "frozen", False) and sys.platform == "win32":
        if sys.stdout is None and any(arg in sys.argv for arg in ("--version", "-v", "--check", "--help", "-h")):
            try:
                import ctypes
                if ctypes.windll.kernel32.AttachConsole(-1):
                    sys.stdout = open("CONOUT$", "w", encoding="utf-8", errors="replace")
                    sys.stderr = open("CONOUT$", "w", encoding="utf-8", errors="replace")
            except Exception:
                pass

    if "--version" in sys.argv or "-v" in sys.argv:
        from app.config import APP_VERSION
        print(f"Kiroku Note v{APP_VERSION}")
        sys.exit(0)

    if "--check" in sys.argv:
        from app.config import APP_VERSION
        print(f"Kiroku Note v{APP_VERSION} Pre-flight Check:")
        print(f"  App Data Dir: {get_app_data_dir()}")
        print(f"  Port:         {resolve_port()}")
        try:
            from app.main import app
            print("  Backend App:  OK (app.main loaded successfully)")
        except Exception as e:
            print(f"  Backend App:  FAILED ({e})")
            sys.exit(1)
        sys.exit(0)

    if "--startup" in sys.argv:
        os.environ.setdefault("KIROKU_STARTUP", "1")

    log_path = _setup_logging()
    logging.info(f"Kiroku Note starting (PID {os.getpid()}, argv={sys.argv})")

    # Enforce single-instance operation
    if not _acquire_single_instance_mutex():
        logging.info("Another instance is already running; notifying and exiting.")
        sys.exit(_handle_already_running())

    host = TrayHost()
    if not host.run():
        err_msg = host.error or "Backend server failed to start within 10 seconds."
        logging.error(f"Fatal startup failure: {err_msg}")
        _show_error_dialog(
            f"Kiroku Note failed to start.\n\n"
            f"Error: {err_msg}\n\n"
            f"Log file:\n{log_path}",
            "Kiroku Note Startup Error",
        )
        raise SystemExit(1)


if __name__ == "__main__":
    main()