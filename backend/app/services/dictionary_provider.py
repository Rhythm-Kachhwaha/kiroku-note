"""
dictionary_provider.py -- Provider seam for Japanese vocabulary and kanji dictionary backends.

Provides an abstraction boundary supporting:
- YomitanHttpProvider: Existing HTTP Yomitan daemon on port 19633.
- LocalDictionaryProvider: Standalone local kiroku_dictionary SQLite engine.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
import json
import logging
import os
from pathlib import Path
import sqlite3
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.services.yomitan import (
    IdentifiedTerm,
    YomitanError,
    YomitanResponseError,
    YomitanUnavailableError,
)

logger = logging.getLogger(__name__)

DEFAULT_YOMITAN_ENDPOINT = "http://127.0.0.1:19633"
DEFAULT_DB_PATH = str(Path(__file__).resolve().parent.parent.parent.parent / "kiroku_dict.sqlite")


def resolve_dictionary_db_path(custom_path: str | Path | None = None) -> Path:
    """Resolve the location of the kiroku_dict.sqlite database.

    Checks in priority order:
    1. Explicit custom_path argument
    2. KIROKU_DICT_SQLITE environment variable
    3. Existing file at sys._MEIPASS or sys.executable directory (if frozen)
    4. Existing file at REPO_ROOT / "kiroku_dict.sqlite"
    5. Existing file at REPO_ROOT / "kiroku_cloud_queue" / "kiroku_dict.sqlite"
    6. Existing file at %LOCALAPPDATA%/KirokuNote/kiroku_dict.sqlite
    7. Default fallback path (REPO_ROOT / "kiroku_dict.sqlite")
    """
    if custom_path:
        return Path(custom_path)

    env_path = os.getenv("KIROKU_DICT_SQLITE")
    if env_path:
        return Path(env_path)

    repo_root = Path(__file__).resolve().parent.parent.parent.parent
    candidates: list[Path] = []

    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).parent
        candidates.append(exe_dir / "kiroku_dict.sqlite")
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            candidates.append(Path(meipass) / "kiroku_dict.sqlite")

    candidates.append(repo_root / "kiroku_dict.sqlite")
    candidates.append(repo_root / "kiroku_cloud_queue" / "kiroku_dict.sqlite")

    local_app_data = os.getenv("LOCALAPPDATA")
    if local_app_data:
        candidates.append(Path(local_app_data) / "KirokuNote" / "kiroku_dict.sqlite")
    try:
        home = Path.home()
        candidates.append(home / ".local" / "share" / "KirokuNote" / "kiroku_dict.sqlite")
    except Exception:
        pass

    for cand in candidates:
        if cand.is_file():
            return cand

    return repo_root / "kiroku_dict.sqlite"


class DictionaryProvider(ABC):
    """Abstract interface for Japanese term identification, payload retrieval, and status."""

    @abstractmethod
    def identify(self, text: str) -> IdentifiedTerm:
        """Identify headword and reading for input text."""
        ...

    @abstractmethod
    def fetch_term_payload(self, term: str) -> dict[str, Any]:
        """Fetch raw Yomitan-shaped dictionaryEntries payload."""
        ...

    @abstractmethod
    def fetch_kanji_payload(self, text: str) -> list[dict[str, Any]]:
        """Fetch raw Yomitan-shaped kanjiEntries payload."""
        ...

    @abstractmethod
    def check_availability(self) -> bool:
        """Check if this backend provider is ready and reachable."""
        ...

    @abstractmethod
    def discover_available_dictionaries(self) -> list[str]:
        """Return list of active dictionary names provided by this backend."""
        ...


class YomitanHttpProvider(DictionaryProvider):
    """Existing HTTP client talking to Yomitan local server on port 19633."""

    def __init__(self, endpoint: str | None = None, timeout_seconds: float = 3.0, post_json_fn: Any = None):
        self._endpoint = (endpoint or os.getenv("YOMITAN_ENDPOINT") or DEFAULT_YOMITAN_ENDPOINT).rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._post_json_fn = post_json_fn

    def _post_json(self, path: str, payload: dict[str, Any]) -> Any:
        if self._post_json_fn is not None:
            return self._post_json_fn(path, payload)
        req = Request(
            f"{self._endpoint}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(req, timeout=self._timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            raise YomitanResponseError("Yomitan returned an invalid dictionary response.") from error
        except (URLError, TimeoutError, OSError) as error:
            raise YomitanUnavailableError("Yomitan is unavailable. Start Yomitan and try again.") from error
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise YomitanResponseError("Yomitan returned an invalid response.") from error

    def identify(self, text: str) -> IdentifiedTerm:
        from app.services.yomitan import YomitanService

        raw = self._post_json("/tokenize", {"text": text, "scanLength": 16, "parser": "scanning-parser"})
        return YomitanService.normalize_tokenize_response(raw, text)

    def fetch_term_payload(self, term: str) -> dict[str, Any]:
        raw = self._post_json("/termEntries", {"term": term})
        if not isinstance(raw, dict):
            raise YomitanResponseError("Yomitan returned an invalid dictionary response.")
        return raw

    def fetch_kanji_payload(self, text: str) -> list[dict[str, Any]]:
        clean_text = str(text).strip()
        raw = self._post_json("/kanjiEntries", {"character": clean_text})
        if not isinstance(raw, list):
            return []
        return raw

    def check_availability(self) -> bool:
        try:
            self._post_json("/tokenize", {"text": "日", "scanLength": 1, "parser": "scanning-parser"})
            return True
        except Exception:
            return False

    def discover_available_dictionaries(self) -> list[str]:
        seed_terms = ["の", "する", "食べる", "こと"]
        found_dicts: list[str] = []
        seen: set[str] = set()

        for term in seed_terms:
            try:
                raw = self._post_json("/termEntries", {"term": term})
                if isinstance(raw, dict) and isinstance(raw.get("dictionaryEntries"), list):
                    for de in raw["dictionaryEntries"]:
                        if not isinstance(de, dict):
                            continue
                        for defn in de.get("definitions", []) if isinstance(de.get("definitions"), list) else []:
                            if isinstance(defn, dict):
                                d_name = str(defn.get("dictionary") or "").strip()
                                if d_name and d_name not in seen:
                                    seen.add(d_name)
                                    found_dicts.append(d_name)
            except Exception:
                pass

        try:
            raw_kanji = self._post_json("/kanjiEntries", {"character": "一"})
            if isinstance(raw_kanji, list):
                for k in raw_kanji:
                    if isinstance(k, dict):
                        k_dict = str(k.get("dictionary") or "").strip()
                        if k_dict and k_dict not in seen:
                            seen.add(k_dict)
                            found_dicts.append(k_dict)
        except Exception:
            pass

        return found_dicts


class LocalDictionaryProvider(DictionaryProvider):
    """Standalone local dictionary engine provider wrapping kiroku_dictionary."""

    def __init__(self, db_path: str | Path | None = None):
        self._db_path = str(resolve_dictionary_db_path(db_path))
        self._engine: Any = None

    def _get_engine(self) -> Any:
        if self._engine is None:
            if not os.path.exists(self._db_path):
                raise YomitanUnavailableError(
                    f"Local dictionary database not found at '{self._db_path}'. Build it with: python -m kiroku_dictionary.build"
                )
            from kiroku_dictionary import DictionaryEngine
            self._engine = DictionaryEngine(self._db_path)
        return self._engine

    def identify(self, text: str) -> IdentifiedTerm:
        clean = (text or "").strip()
        if not clean:
            raise YomitanResponseError("Cannot identify an empty text.")

        # Full-sentence guard: sentence punctuation or long sentence
        sentence_punct = ("。", "！", "？", "\n", "、")
        if any(p in clean for p in sentence_punct) or (len(clean) > 30 and " " in clean):
            raise YomitanResponseError(
                "Local dictionary engine requires typed word/phrase input. Full-sentence tokenization requires Yomitan."
            )

        engine = self._get_engine()
        results = engine.lookup_terms(clean, max_results=1)
        if results:
            top = results[0]
            return IdentifiedTerm(
                expression=top.term,
                reading=top.reading,
                source_text=top.source or clean,
                deinflected_text=top.term,
            )

        # Fallback for unrecognized Japanese text
        if any("\u3040" <= ch <= "\u9fff" or "\uf900" <= ch <= "\ufaff" or ch == "\u3005" for ch in clean):
            return IdentifiedTerm(clean, clean, clean, clean)

        raise YomitanResponseError("Local dictionary could not identify a Japanese term in this selection.")

    def fetch_term_payload(self, term: str) -> dict[str, Any]:
        from kiroku_dictionary.yomitan_payload import format_term_entries_payload

        engine = self._get_engine()
        results = engine.lookup_terms(term, max_results=10)
        return format_term_entries_payload(results)

    def fetch_kanji_payload(self, text: str) -> list[dict[str, Any]]:
        from kiroku_dictionary.yomitan_payload import format_kanji_entries_payload

        engine = self._get_engine()
        results = engine.lookup_kanji(text)
        return format_kanji_entries_payload(results)

    def check_availability(self) -> bool:
        if not os.path.exists(self._db_path):
            return False
        try:
            conn = sqlite3.connect(f"file:{self._db_path}?mode=ro", uri=True)
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM meta LIMIT 1")
            cur.fetchone()
            conn.close()
            return True
        except Exception:
            return False

    def discover_available_dictionaries(self) -> list[str]:
        if not os.path.exists(self._db_path):
            return []
        try:
            conn = sqlite3.connect(f"file:{self._db_path}?mode=ro", uri=True)
            cur = conn.cursor()
            cur.execute("SELECT value FROM meta WHERE key IN ('jitendex_title', 'kanjidic_title')")
            names = [r[0] for r in cur.fetchall() if r[0]]
            conn.close()
            return names
        except Exception:
            return ["Jitendex (Local)", "KANJIDIC (Local)"]
