"""Optional, cached SudachiPy tokenizer adapter."""
from __future__ import annotations

from threading import Lock
from typing import Any

from app.services.tokenizers.base import Morpheme

try:
    from sudachipy import Dictionary
except ImportError:  # pragma: no cover - depends on optional deployment extra
    Dictionary = None  # type: ignore[assignment,misc]


_lock = Lock()
_instances: dict[str, "SudachiTokenizer"] = {}


class SudachiTokenizer:
    name = "sudachi"

    def __init__(self, dictionary_variant: str) -> None:
        if Dictionary is None:
            raise RuntimeError("SudachiPy is not installed")
        self.dictionary_variant = dictionary_variant
        self._tokenizer = Dictionary(dict=dictionary_variant).tokenizer()
        self.ready = True

    def tokenize(self, text: str) -> list[Morpheme]:
        result: list[Morpheme] = []
        for token in self._tokenizer.tokenize(text, mode="C"):
            start = token.begin()
            end = token.end()
            pos = tuple(str(part) for part in token.part_of_speech())
            result.append(
                Morpheme(
                    surface=text[start:end],
                    lemma=token.dictionary_form(),
                    reading=token.reading_form() or "",
                    pos=pos,
                    start=start,
                    end=end,
                    normalized=token.normalized_form(),
                )
            )
        return result


def get_sudachi_tokenizer(dictionary_variant: str = "small") -> SudachiTokenizer:
    """Return one thread-safe shared Sudachi tokenizer per dictionary variant."""
    variant = dictionary_variant if dictionary_variant in {"small", "core"} else "small"
    with _lock:
        tokenizer = _instances.get(variant)
        if tokenizer is None:
            tokenizer = SudachiTokenizer(variant)
            _instances[variant] = tokenizer
        return tokenizer


def sudachi_status(dictionary_variant: str = "small") -> dict[str, Any]:
    """Report optional dependency readiness without constructing it unnecessarily."""
    if Dictionary is None:
        return {
            "tokenizer": "unavailable",
            "dictionary": dictionary_variant,
            "ready": False,
        }
    try:
        get_sudachi_tokenizer(dictionary_variant)
    except Exception as exc:
        return {
            "tokenizer": "sudachi",
            "dictionary": dictionary_variant,
            "ready": False,
            "error": str(exc),
        }
    return {"tokenizer": "sudachi", "dictionary": dictionary_variant, "ready": True}
