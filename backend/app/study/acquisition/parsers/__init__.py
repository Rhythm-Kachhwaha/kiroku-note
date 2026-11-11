"""
Acquisition Source Parsers Package.
"""
from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.bunpro import BunproParser
from app.study.acquisition.parsers.cotoacademy import CotoAcademyParser
from app.study.acquisition.parsers.gyanmirai import GyanMiraiParser
from app.study.acquisition.parsers.invariants import (
    InvariantScanReport,
    InvariantViolation,
    SourceScanReport,
    linear_scan_exercise,
    linear_scan_source,
)
from app.study.acquisition.parsers.japanesetest4you import JapaneseTest4YouParser
from app.study.acquisition.parsers.jlpt_official import JlptOfficialParser
from app.study.acquisition.parsers.models import (
    ParsedAnswerClaim,
    ParsedChoice,
    ParsedExercise,
    ParsedPassage,
    ParsedQuestion,
)
from app.study.acquisition.parsers.nihongo_pro import NihongoProParser
from app.study.acquisition.parsers.nihongomaster import NihongoMasterParser
from app.study.acquisition.parsers.registry import get_source_parser
from app.study.acquisition.parsers.tatoeba import TatoebaParser
from app.study.acquisition.parsers.tofugu_parser import (
    CommonPitfall,
    FormationRule,
    GrammarEnrichment,
    NuanceContrast,
    TofuguParser,
)

__all__ = [
    "BaseSourceParser",
    "CommonPitfall",
    "CotoAcademyParser",
    "FormationRule",
    "GrammarEnrichment",
    "GyanMiraiParser",
    "InvariantScanReport",
    "InvariantViolation",
    "JapaneseTest4YouParser",
    "JlptOfficialParser",
    "NihongoMasterParser",
    "NihongoProParser",
    "NuanceContrast",
    "ParsedChoice",
    "ParsedAnswerClaim",
    "ParsedQuestion",
    "ParsedPassage",
    "ParsedExercise",
    "SourceScanReport",
    "TatoebaParser",
    "TofuguParser",
    "get_source_parser",
    "linear_scan_exercise",
    "linear_scan_source",
]
