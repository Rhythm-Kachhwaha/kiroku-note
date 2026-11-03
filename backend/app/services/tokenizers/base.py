"""Shared tokenizer contracts."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class Morpheme:
    """Stable internal representation independent of tokenizer implementation."""

    surface: str
    lemma: str
    reading: str
    pos: tuple[str, ...]
    start: int
    end: int
    normalized: str


class Tokenizer(Protocol):
    name: str
    dictionary_variant: str
    ready: bool

    def tokenize(self, text: str) -> list[Morpheme]:
        """Return morphemes with offsets into the original text."""
