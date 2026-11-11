"""Registry for deterministic source parsers."""
from __future__ import annotations

from collections.abc import Callable

from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.cotoacademy import CotoAcademyParser
from app.study.acquisition.parsers.gyanmirai import GyanMiraiParser
from app.study.acquisition.parsers.japanesetest4you import JapaneseTest4YouParser
from app.study.acquisition.parsers.jlpt_official import JlptOfficialParser
from app.study.acquisition.parsers.nihongo_pro import NihongoProParser
from app.study.acquisition.parsers.nihongomaster import NihongoMasterParser
from app.study.acquisition.parsers.tatoeba import TatoebaParser

_PARSER_FACTORIES: dict[str, Callable[[], BaseSourceParser]] = {
    "japanesetest4you": JapaneseTest4YouParser,
    "jlpt_official": JlptOfficialParser,
    "cotoacademy": CotoAcademyParser,
    "gyanmirai": GyanMiraiParser,
    "nihongomaster": NihongoMasterParser,
    "nihongo_pro": NihongoProParser,
    "tatoeba": TatoebaParser,
}


def get_source_parser(parser_id: str) -> BaseSourceParser:
    try:
        return _PARSER_FACTORIES[parser_id]()
    except KeyError as exc:
        raise ValueError(f"Unknown source parser: {parser_id}") from exc
