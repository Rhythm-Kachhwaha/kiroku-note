"""Tests for dictionary provisioning pipeline, API endpoints, and clean-slate install."""
import http.server
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import zipfile

from fastapi.testclient import TestClient

from app.db.connection import init_db
from app.main import app
from app.services.yomitan import reset_dictionary_service
from kiroku_dictionary.provision import (
    get_provision_status,
    provision_database,
)


def _create_synthetic_jitendex_zip(dest_path: Path) -> None:
    """Create a minimal synthetic Jitendex Yomitan zip (<1KB, no licensed data)."""
    with zipfile.ZipFile(dest_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        index_data = {
            "title": "Synthetic Jitendex",
            "format": 3,
            "revision": "test2026",
            "sequenced": True,
        }
        zf.writestr("index.json", json.dumps(index_data))
        # Yomitan term entry format: [term, reading, definition_tags, rules, score, [glossary...], sequence, term_tags]
        term_bank = [
            ["食べる", "たべる", "v1", "v1", 100, ["to eat"], 1001, "common"],
            ["本", "ほん", "n", "", 80, ["book"], 1002, "common"],
        ]
        zf.writestr("term_bank_1.json", json.dumps(term_bank))
        tag_bank = [
            ["v1", "partOfSpeech", -1, "Ichidan verb", 0],
            ["common", "misc", 0, "Common word", 0],
        ]
        zf.writestr("tag_bank_1.json", json.dumps(tag_bank))


def _create_synthetic_kanjidic_zip(dest_path: Path) -> None:
    """Create a minimal synthetic KANJIDIC Yomitan zip (<1KB, no licensed data)."""
    with zipfile.ZipFile(dest_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        index_data = {
            "title": "Synthetic KANJIDIC",
            "format": 3,
            "revision": "test2026",
        }
        zf.writestr("index.json", json.dumps(index_data))
        # Yomitan kanji entry format: [character, onyomi, kunyomi, tags, [meanings...], {stats...}]
        kanji_bank = [
            ["食", "ショク", "た.べる", "grade2", ["eat", "food"], {"grade": "2"}],
            ["本", "ホン", "もと", "grade1", ["book", "origin"], {"grade": "1"}],
        ]
        zf.writestr("kanji_bank_1.json", json.dumps(kanji_bank))


class DictionaryProvisionTests(unittest.TestCase):
    def setUp(self):
        reset_dictionary_service()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.db_path = self.data_dir / "kiroku_test.db"
        init_db(self.db_path)

        self._orig_env = dict(os.environ)
        os.environ["KIROKU_DATA_DIR"] = str(self.data_dir)
        os.environ["ANKIMINER_DB_PATH"] = str(self.db_path)
        # Point KIROKU_DICT_SQLITE to non-existent file inside data_dir
        self.target_dict_sqlite = self.data_dir / "kiroku_dict.sqlite"
        os.environ["KIROKU_DICT_SQLITE"] = str(self.target_dict_sqlite)
        os.environ.pop("DICTIONARY_BACKEND", None)

        # Build synthetic fixtures
        self.jitendex_zip = self.data_dir / "synthetic_jitendex.zip"
        self.kanjidic_zip = self.data_dir / "synthetic_kanjidic.zip"
        _create_synthetic_jitendex_zip(self.jitendex_zip)
        _create_synthetic_kanjidic_zip(self.kanjidic_zip)

        # Setup local HTTP server to serve the fixture zips
        handler = http.server.SimpleHTTPRequestHandler
        # Serve from fixture dir
        parent_dir = str(self.data_dir)

        class CustomHandler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=parent_dir, **kwargs)

            def log_message(self, format, *args):
                pass  # Suppress logs

        self.httpd = http.server.HTTPServer(("127.0.0.1", 0), CustomHandler)
        self.port = self.httpd.server_address[1]
        self.server_thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.server_thread.start()

        self.client = TestClient(app)

    def tearDown(self):
        reset_dictionary_service()
        self.httpd.shutdown()
        self.httpd.server_close()
        os.environ.clear()
        os.environ.update(self._orig_env)
        self.temp_dir.cleanup()

    def test_fresh_data_dir_provision_then_capture_works(self):
        """End-to-end: fresh data dir -> provision via HTTP -> capture succeeds."""
        # 1. Fresh state: database does not exist
        self.assertFalse(self.target_dict_sqlite.exists())

        # Verify POST /api/capture returns 503 DICT_DB_MISSING before provisioning
        res_before = self.client.post("/api/capture", json={"text": "食べる", "auto_save": False})
        self.assertEqual(res_before.status_code, 503)

        # 2. Run provision_database with HTTP server URLs
        j_url = f"http://127.0.0.1:{self.port}/{self.jitendex_zip.name}"
        k_url = f"http://127.0.0.1:{self.port}/{self.kanjidic_zip.name}"

        out_path = provision_database(
            target_path=self.target_dict_sqlite,
            jitendex_url=j_url,
            kanjidic_url=k_url,
        )

        self.assertTrue(out_path.is_file())
        self.assertTrue(self.target_dict_sqlite.is_file())

        # 3. GET /api/dictionary/status returns db_present=True and jitendex=True
        status_res = self.client.get("/api/dictionary/status")
        self.assertEqual(status_res.status_code, 200)
        status_body = status_res.json()
        self.assertTrue(status_body["db_present"])
        self.assertTrue(status_body["jitendex"])
        self.assertTrue(status_body["kanjidic"])
        self.assertEqual(status_body["provisioning"]["status"], "completed")

        # 4. POST /api/capture now succeeds and captures the synthetic entry
        res_after = self.client.post("/api/capture", json={"text": "食べる", "auto_save": False})
        self.assertEqual(res_after.status_code, 200)
        capture_body = res_after.json()
        self.assertEqual(capture_body["expression"], "食べる")
        self.assertEqual(capture_body["reading"], "たべる")
        self.assertTrue(len(capture_body["entries"]) >= 1)

    def test_provision_endpoint_requires_desktop_control(self):
        """POST /api/dictionary/provision without desktop token returns 401."""
        res = self.client.post("/api/dictionary/provision", json={})
        self.assertEqual(res.status_code, 401)


if __name__ == "__main__":
    unittest.main()
