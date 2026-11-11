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
    is_oov: bool = False
    unresolved: bool = False
    resolution_status: str = "unvalidated"
    sequence_id: int | None = None
    canonical_reading: str | None = None

    @property
    def canonical_id(self) -> tuple[int, str] | None:
        """Return canonical (sequence_id, reading) key when resolved against dictionary."""
        if self.sequence_id is None:
            return None
        return (self.sequence_id, self.canonical_reading or self.reading)


class Tokenizer(Protocol):
    name: str
    dictionary_variant: str
    ready: bool

    def tokenize(self, text: str) -> list[Morpheme]:
        """Return morphemes with offsets into the original text."""
