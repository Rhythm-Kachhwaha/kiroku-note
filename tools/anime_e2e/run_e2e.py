import sys
import os
import time
import importlib
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT_DIR = Path(__file__).resolve().parents[2]
EXT_DIR = str((ROOT_DIR / "extension").resolve()).replace("/", "\\")

sys.path.insert(0, str(Path(__file__).parent))
from backend_runner import BackendRunner
from fixture_server import FixtureServer
from desk_helper import DesktopClient

def run_scenario(name):
    print(f"=== Running Scenario: {name} ===")
    backend = BackendRunner()
    fixture_server = FixtureServer()
    desk_client = DesktopClient()

    backend.start()
    fixture_server.start()
    desk_client.start()

    time.sleep(1)

    try:
        mod = importlib.import_module(f"scenarios.{name}")
    except Exception as e:
        print(f"ERROR: Failed to import scenario {name}: {e}")
        backend.stop()
        fixture_server.stop()
        desk_client.stop()
        return False

    temp_profile = Path(backend.temp_dir.name) / "chrome_profile"
    temp_profile.mkdir(parents=True, exist_ok=True)

    success = False
    with sync_playwright() as p:
        args = [
            f"--disable-extensions-except={EXT_DIR}",
            f"--load-extension={EXT_DIR}",
            "--no-sandbox",
        ]
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(temp_profile),
            headless=False,
            args=args,
            ignore_default_args=["--disable-extensions"]
        )

        if not context.service_workers:
            try:
                context.wait_for_event("serviceworker", timeout=4000)
            except Exception:
                pass

        try:
            mod.run(context, desk_client)
            print(f"PASS: {name}")
            success = True
        except Exception as e:
            print(f"FAIL: {name} -> {e}")
            success = False
        finally:
            context.close()

    desk_client.stop()
    fixture_server.stop()
    backend.stop()
    return success

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "e01"
    if target == "all":
        all_ok = True
        for i in range(1, 16):
            s_name = f"e{i:02d}"
            ok = run_scenario(s_name)
            if not ok:
                all_ok = False
        sys.exit(0 if all_ok else 1)
    else:
        ok = run_scenario(target)
        sys.exit(0 if ok else 1)
