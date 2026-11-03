"""Compatibility tokenizer metadata and conservative fallback tokenizer."""
from __future__ import annotations

import unicodedata

from app.services.tokenizers.base import Morpheme


def _is_word_character(char: str) -> bool:
    category = unicodedata.category(char)
    return char.isalnum() or category.startswith("L") or category.startswith("M")


class LegacyTokenizer:
    """Fallback tokenizer retained for installations without SudachiPy."""

    name = "legacy"
    dictionary_variant = "openjlpt"
    ready = True

    def tokenize(self, text: str) -> list[Morpheme]:
        result: list[Morpheme] = []
        index = 0
        while index < len(text):
            start = index
            if _is_word_character(text[index]):
                index += 1
                while index < len(text) and _is_word_character(text[index]):
                    index += 1
            else:
                index += 1
            surface = text[start:index]
            result.append(
                Morpheme(
                    surface=surface,
                    lemma=surface,
                    reading="",
                    pos=(),
                    start=start,
                    end=index,
                    normalized=unicodedata.normalize("NFKC", surface),
                )
            )
        return result
