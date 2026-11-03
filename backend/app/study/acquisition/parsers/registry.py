"""Registry for deterministic source parsers."""
from __future__ import annotations

from collections.abc import Callable

from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.japanesetest4you import JapaneseTest4YouParser

_PARSER_FACTORIES: dict[str, Callable[[], BaseSourceParser]] = {
    "japanesetest4you": JapaneseTest4YouParser,
}


def get_source_parser(parser_id: str) -> BaseSourceParser:
    try:
        return _PARSER_FACTORIES[parser_id]()
    except KeyError as exc:
        raise ValueError(f"Unknown source parser: {parser_id}") from exc
