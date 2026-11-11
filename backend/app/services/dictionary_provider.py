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
    DictionaryDatabaseMissingError,
    DictionaryTermNotFoundError,
    IdentifiedTerm,
    YomitanError,
    YomitanResponseError,
    YomitanUnavailableError,
)
from app.services.operational_diagnostics import record_operational_failure

logger = logging.getLogger(__name__)

DEFAULT_YOMITAN_ENDPOINT = "http://127.0.0.1:19633"
DEFAULT_DB_PATH = str(Path(__file__).resolve().parent.parent.parent.parent / "kiroku_dict.sqlite")


def resolve_dictionary_db_path(custom_path: str | Path | None = None) -> Path:
    """Resolve the location of the kiroku_dict.sqlite database via kiroku_dictionary.paths."""
    from kiroku_dictionary.paths import resolve_db_path
    return resolve_db_path(custom_path)


def get_dictionary_db_info(custom_path: str | Path | None = None) -> dict[str, Any]:
    """Inspect and return metadata flags for the resolved local dictionary database."""
    resolved = resolve_dictionary_db_path(custom_path)
    db_present = resolved.is_file()
    jitendex = False
    kanjidic = False
    if db_present:
        try:
            conn = sqlite3.connect(f"file:{resolved}?mode=ro", uri=True)
            cur = conn.cursor()
            cur.execute("SELECT key, value FROM meta WHERE key IN ('jitendex_title', 'kanjidic_title')")
            meta = dict(cur.fetchall())
            jitendex = bool(meta.get("jitendex_title"))
            kanjidic = bool(meta.get("kanjidic_title"))
            conn.close()
        except Exception:
            pass
    return {
        "db_present": db_present,
        "db_path": str(resolved),
        "jitendex": jitendex,
        "kanjidic": kanjidic,
    }


class DictionaryProvider(ABC):
    """Abstract interface for Japanese term identification, payload retrieval, and status."""

    supports_sentence_tokenization = True

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

    @abstractmethod
    def tokenize_with_inflection(self, text: str) -> list[dict[str, Any]]:
        """Tokenize a sentence while retaining headwords and inflection chains."""
        ...

    @abstractmethod
    def scan_term_entries(self, term: str) -> list[dict[str, Any]]:
        """Return raw dictionary entries for a term."""
        ...

    def term_exists(self, term: str) -> bool:
        """Check whether a term exists in the dictionary backend."""
        return bool(self.scan_term_entries(term))

    def resolve_canonical(
        self,
        lemma: str,
        *,
        normalized_form: str = "",
        surface: str = "",
        reading: str = "",
        pos: tuple[str, ...] | list[str] | str = (),
    ) -> Any:
        """Optional canonical JMdict entry resolution (implemented by LocalDictionaryProvider)."""
        return None


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

    def tokenize_with_inflection(self, text: str) -> list[dict[str, Any]]:
        raw = self._post_json("/tokenize", {
            "text": text, "scanLength": 128, "parser": "scanning-parser",
        })
        return YomitanService.normalize_tokenize_tokens(raw)

    def scan_term_entries(self, term: str) -> list[dict[str, Any]]:
        raw = self.fetch_term_payload(term)
        entries = raw.get("dictionaryEntries", [])
        return entries if isinstance(entries, list) else []

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
        seed_terms = ["の", "する", "食べる", "こと", "てしまう", "なければならない", "ことがある", "わけ"]
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
            except Exception as exc:
                record_operational_failure("dictionary.discovery_term", exc, level=logging.DEBUG)

        try:
            raw_kanji = self._post_json("/kanjiEntries", {"character": "一"})
            if isinstance(raw_kanji, list):
                for k in raw_kanji:
                    if isinstance(k, dict):
                        k_dict = str(k.get("dictionary") or "").strip()
                        if k_dict and k_dict not in seen:
                            seen.add(k_dict)
                            found_dicts.append(k_dict)
        except Exception as exc:
            record_operational_failure("dictionary.discovery_kanji", exc, level=logging.DEBUG)

        return found_dicts


class LocalDictionaryProvider(DictionaryProvider):
    """Standalone local dictionary engine provider wrapping kiroku_dictionary.

    The local word index provides dictionary notes only. Grammar sentence
    tokenization is supplied independently by the local Sudachi adapter.
    """

    supports_sentence_tokenization = False

    def __init__(self, db_path: str | Path | None = None):
        self._db_path = str(resolve_dictionary_db_path(db_path))
        self._engine: Any = None

    def _get_engine(self) -> Any:
        if self._engine is None:
            if not os.path.exists(self._db_path):
                raise DictionaryDatabaseMissingError(
                    db_path=self._db_path,
                    message=f"Local dictionary database not found at '{self._db_path}'. Run provisioning in Settings > Dictionary.",
                )
            from kiroku_dictionary import DictionaryEngine
            self._engine = DictionaryEngine(self._db_path)
        return self._engine

    def close(self) -> None:
        """Close underlying dictionary engine and connections."""
        if self._engine is not None:
            try:
                self._engine.close()
            except Exception:
                pass
            self._engine = None

    def term_exists(self, term: str) -> bool:
        """Return True if term exists in the local dictionary terms table."""
        engine = self._get_engine()
        return engine.term_exists(term)

    def resolve_canonical(
        self,
        lemma: str,
        *,
        normalized_form: str = "",
        surface: str = "",
        reading: str = "",
        pos: tuple[str, ...] | list[str] | str = (),
    ) -> Any:
        """Resolve a token against local JMdict entries with reading/POS/tag disambiguation."""
        engine = self._get_engine()
        return engine.resolve_canonical(
            lemma,
            normalized_form=normalized_form,
            surface=surface,
            reading=reading,
            pos=pos,
        )

    def identify(self, text: str) -> IdentifiedTerm:
        clean = (text or "").strip()
        if not clean:
            raise YomitanResponseError("Cannot identify an empty text.")

        engine = self._get_engine()

        stripped = clean.strip(" \t\r\n　「」『』（）［］【】〈〉《》〔〕“”‘’\"'.,、。！？")
        if not stripped:
            stripped = clean

        # 1. Direct word lookup hits -> disambiguate with Sudachi when multiple candidates match
        results = engine.lookup_terms(clean, max_results=3, mode="word")
        if results:
            top = results[0]
            if len(results) > 1:
                try:
                    from app.services.tokenizers.merge import merge_morphemes
                    from app.services.tokenizers.sudachi import get_sudachi_tokenizer

                    sudachi_tokens = merge_morphemes(get_sudachi_tokenizer().tokenize(stripped))
                    if sudachi_tokens:
                        pref_lemma = sudachi_tokens[0].lemma
                        matched = [r for r in results if r.term == pref_lemma]
                        if matched:
                            top = matched[0]
                except Exception as exc:
                    logger.debug("Sudachi disambiguation skipped in identify: %s", exc)
            return IdentifiedTerm(
                expression=top.term,
                reading=top.reading,
                source_text=top.source or clean,
                deinflected_text=top.term,
            )

        # Tokenize with Sudachi (mode C) + product merge to inspect structure
        tokens = []
        merged_tokens = []
        try:
            from app.services.tokenizers.merge import merge_morphemes
            from app.services.tokenizers.sudachi import get_sudachi_tokenizer

            tok = get_sudachi_tokenizer()
            tokens = tok.tokenize(stripped)
            merged_tokens = merge_morphemes(tokens)
        except Exception as exc:
            logger.debug("Sudachi tokenization skipped in identify: %s", exc)

        from kiroku_dictionary.lookup import is_kana_only

        # 2. Multi-token selection: prefer longest dictionary hit from selection start via scan; else first content token
        if len(tokens) > 1 or any(p in clean for p in ("。", "！", "？", "\n", "、", " ", "　")):
            particles = {"の", "に", "を", "は", "が", "で", "と", "へ", "も", "か", "や", "ね", "よ", "から", "まで", "より"}
            scan_results = engine.lookup_terms(stripped, max_results=5, mode="scan")
            first_merged_len = len(merged_tokens[0].surface) if merged_tokens else 0
            if scan_results:
                top = scan_results[0]
                shorter_than_merged = first_merged_len > len(top.source)
                if not shorter_than_merged and not (len(stripped) > len(top.source) and top.source in particles):
                    return IdentifiedTerm(
                        expression=top.term,
                        reading=top.reading,
                        source_text=top.source or stripped,
                        deinflected_text=top.term,
                    )

            candidate_tokens = merged_tokens or tokens
            if candidate_tokens:
                chosen_token = None
                for t in candidate_tokens:
                    pos0 = t.pos[0] if t.pos else ""
                    if pos0 not in ("助詞", "補助記号", "記号", "空白"):
                        chosen_token = t
                        break
                if chosen_token is None:
                    chosen_token = candidate_tokens[0]

                for candidate_str in (chosen_token.lemma, chosen_token.normalized, chosen_token.surface):
                    if not candidate_str:
                        continue
                    tok_hits = engine.lookup_terms(
                        candidate_str,
                        max_results=1,
                        mode="word",
                        preferred_lemma=chosen_token.lemma,
                        preferred_reading=chosen_token.reading,
                    )
                    if tok_hits:
                        top = tok_hits[0]
                        return IdentifiedTerm(
                            expression=top.term,
                            reading=top.reading,
                            source_text=chosen_token.surface or clean,
                            deinflected_text=top.term,
                        )

            if scan_results:
                top = scan_results[0]
                if not (len(stripped) > len(top.source) and top.source in particles):
                    return IdentifiedTerm(
                        expression=top.term,
                        reading=top.reading,
                        source_text=top.source or stripped,
                        deinflected_text=top.term,
                    )

        # 3. Single-token selection or no hit: fallback to raw text ONLY when selection is single kana word with no entry
        if is_kana_only(clean) and not any(ch in clean for ch in " \t\r\n　、。！？") and len(clean) <= 30:
            return IdentifiedTerm(clean, clean, clean, clean)

        # 4. No hit -> raise typed error DICT_TERM_NOT_FOUND
        raise DictionaryTermNotFoundError(
            f"Local dictionary could not identify a Japanese term in '{clean}'."
        )

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

    def tokenize_with_inflection(self, text: str) -> list[dict[str, Any]]:
        # The local word index intentionally does not pretend to be a sentence
        # tokenizer. GrammarService uses its literal fallback instead.
        return []

    def scan_term_entries(self, term: str) -> list[dict[str, Any]]:
        payload = self.fetch_term_payload(term)
        entries = payload.get("dictionaryEntries", [])
        return entries if isinstance(entries, list) else []
