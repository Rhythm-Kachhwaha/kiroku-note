"""
Authoritative JLPT Examination Blueprint Registry.
---------------------------------------------------
Provides versioned examination blueprint specifications for JLPT N1–N5.
Accurately encodes the official 2026 test section structures, timings,
and item-type taxonomies while transparently declaring the evidentiary basis
of each question quota.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Dict, List, Optional

from app.study.exam.enums import BlueprintEvidenceLevel
from app.study.exam.models import (
    ExamBlueprint,
    ExamItemQuota,
    ExamSectionBlueprint,
    ScoringSectionBlueprint,
)


DEFAULT_BLUEPRINT_VERSION = "2026.2"
LEGACY_BLUEPRINT_VERSION = "2026.1"


# =============================================================================
# Version 2026.1 (Legacy Standard Blueprints)
# Preserved strictly for historical snapshots and exam records.
# =============================================================================

N1_BLUEPRINT_2026_1 = ExamBlueprint(
    level="N1",
    version=LEGACY_BLUEPRINT_VERSION,
    name="Official JLPT N1 Standard Examination Blueprint (2026.1)",
    overall_max_score=180,
    overall_pass_threshold=100,
    test_sections=[
        ExamSectionBlueprint(
            section_code="N1_SEC_KNOWLEDGE_READING",
            label="Language Knowledge (Vocabulary/Grammar) & Reading",
            block_order=1,
            time_limit_minutes=110,
            categories=["vocabulary", "grammar", "reading"],
            item_quotas=[
                # Vocabulary
                ExamItemQuota(format_code="kanji_reading", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Kanji Reading"),
                ExamItemQuota(format_code="contextual_expressions", target_count=7, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Contextual Expressions"),
                ExamItemQuota(format_code="paraphrases", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: Paraphrases"),
                ExamItemQuota(format_code="usage", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Usage"),
                # Grammar
                ExamItemQuota(format_code="sentential_grammar_1", target_count=10, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 5: Sentential Grammar 1"),
                ExamItemQuota(format_code="sentence_composition", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 6: Sentence Composition (Star)"),
                ExamItemQuota(format_code="text_grammar", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 7: Text Grammar"),
                # Reading
                ExamItemQuota(format_code="comprehension_short", target_count=4, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 8: Comprehension Short"),
                ExamItemQuota(format_code="comprehension_mid", target_count=9, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 9: Comprehension Mid"),
                ExamItemQuota(format_code="comprehension_long", target_count=4, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 10: Comprehension Long"),
                ExamItemQuota(format_code="integrated_thematic_reading", target_count=3, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 11: Integrated Thematic Reading"),
                ExamItemQuota(format_code="information_retrieval", target_count=2, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 12: Information Retrieval"),
            ],
        ),
        ExamSectionBlueprint(
            section_code="N1_SEC_LISTENING",
            label="Listening",
            block_order=2,
            time_limit_minutes=55,
            categories=["listening"],
            item_quotas=[
                ExamItemQuota(format_code="task_based_listening", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Task-based Listening"),
                ExamItemQuota(format_code="key_points_listening", target_count=7, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Key Points Listening"),
                ExamItemQuota(format_code="general_outline_listening", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: General Outline Listening"),
                ExamItemQuota(format_code="quick_response", target_count=13, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Quick Response"),
                ExamItemQuota(format_code="listening_integrated", target_count=4, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 5: Integrated Listening"),
            ],
        ),
    ],
    scoring_sections=[
        ScoringSectionBlueprint(code="N1_SCORE_KNOWLEDGE", label="Language Knowledge (Vocabulary/Grammar)", categories=["vocabulary", "grammar"], max_score=60, pass_threshold=19),
        ScoringSectionBlueprint(code="N1_SCORE_READING", label="Reading", categories=["reading"], max_score=60, pass_threshold=19),
        ScoringSectionBlueprint(code="N1_SCORE_LISTENING", label="Listening", categories=["listening"], max_score=60, pass_threshold=19),
    ],
)
N1_BLUEPRINT = N1_BLUEPRINT_2026_1


# -----------------------------------------------------------------------------
# N2 Blueprint (105 min Knowledge/Reading, 50 min Listening; 90/180 pass, 19 each)
# -----------------------------------------------------------------------------
N2_BLUEPRINT_2026_1 = ExamBlueprint(
    level="N2",
    version=LEGACY_BLUEPRINT_VERSION,
    name="Official JLPT N2 Standard Examination Blueprint (2026.1)",
    overall_max_score=180,
    overall_pass_threshold=90,
    test_sections=[
        ExamSectionBlueprint(
            section_code="N2_SEC_KNOWLEDGE_READING",
            label="Language Knowledge (Vocabulary/Grammar) & Reading",
            block_order=1,
            time_limit_minutes=105,
            categories=["vocabulary", "grammar", "reading"],
            item_quotas=[
                # Vocabulary
                ExamItemQuota(format_code="kanji_reading", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Kanji Reading"),
                ExamItemQuota(format_code="orthography", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Orthography"),
                ExamItemQuota(format_code="word_formation", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: Word Formation"),
                ExamItemQuota(format_code="contextual_expressions", target_count=7, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Contextual Expressions"),
                ExamItemQuota(format_code="paraphrases", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 5: Paraphrases"),
                ExamItemQuota(format_code="usage", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 6: Usage"),
                # Grammar
                ExamItemQuota(format_code="sentential_grammar_1", target_count=12, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 7: Sentential Grammar 1"),
                ExamItemQuota(format_code="sentence_composition", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 8: Sentence Composition (Star)"),
                ExamItemQuota(format_code="text_grammar", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 9: Text Grammar"),
                # Reading
                ExamItemQuota(format_code="comprehension_short", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 10: Comprehension Short"),
                ExamItemQuota(format_code="comprehension_mid", target_count=9, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 11: Comprehension Mid"),
                ExamItemQuota(format_code="integrated_thematic_reading", target_count=2, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 12: Integrated Thematic Reading"),
                ExamItemQuota(format_code="information_retrieval", target_count=2, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 13: Information Retrieval"),
            ],
        ),
        ExamSectionBlueprint(
            section_code="N2_SEC_LISTENING",
            label="Listening",
            block_order=2,
            time_limit_minutes=50,
            categories=["listening"],
            item_quotas=[
                ExamItemQuota(format_code="task_based_listening", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Task-based Listening"),
                ExamItemQuota(format_code="key_points_listening", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Key Points Listening"),
                ExamItemQuota(format_code="general_outline_listening", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: General Outline Listening"),
                ExamItemQuota(format_code="quick_response", target_count=12, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Quick Response"),
                ExamItemQuota(format_code="listening_integrated", target_count=3, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 5: Integrated Listening"),
            ],
        ),
    ],
    scoring_sections=[
        ScoringSectionBlueprint(code="N2_SCORE_KNOWLEDGE", label="Language Knowledge (Vocabulary/Grammar)", categories=["vocabulary", "grammar"], max_score=60, pass_threshold=19),
        ScoringSectionBlueprint(code="N2_SCORE_READING", label="Reading", categories=["reading"], max_score=60, pass_threshold=19),
        ScoringSectionBlueprint(code="N2_SCORE_LISTENING", label="Listening", categories=["listening"], max_score=60, pass_threshold=19),
    ],
)


# -----------------------------------------------------------------------------
# N3 Blueprint (30 min Vocab, 70 min Grammar/Reading, 40 min Listening; 95/180 pass, 19 each)
# -----------------------------------------------------------------------------
N3_BLUEPRINT_2026_1 = ExamBlueprint(
    level="N3",
    version=LEGACY_BLUEPRINT_VERSION,
    name="Official JLPT N3 Standard Examination Blueprint (2026.1)",
    overall_max_score=180,
    overall_pass_threshold=95,
    test_sections=[
        ExamSectionBlueprint(
            section_code="N3_SEC_VOCABULARY",
            label="Language Knowledge (Vocabulary)",
            block_order=1,
            time_limit_minutes=30,
            categories=["vocabulary"],
            item_quotas=[
                ExamItemQuota(format_code="kanji_reading", target_count=8, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Kanji Reading"),
                ExamItemQuota(format_code="orthography", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Orthography"),
                ExamItemQuota(format_code="contextual_expressions", target_count=11, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: Contextual Expressions"),
                ExamItemQuota(format_code="paraphrases", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Paraphrases"),
                ExamItemQuota(format_code="usage", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 5: Usage"),
            ],
        ),
        ExamSectionBlueprint(
            section_code="N3_SEC_GRAMMAR_READING",
            label="Language Knowledge (Grammar) & Reading",
            block_order=2,
            time_limit_minutes=70,
            categories=["grammar", "reading"],
            item_quotas=[
                # Grammar
                ExamItemQuota(format_code="sentential_grammar_1", target_count=13, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Sentential Grammar 1"),
                ExamItemQuota(format_code="sentence_composition", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Sentence Composition (Star)"),
                ExamItemQuota(format_code="text_grammar", target_count=4, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: Text Grammar"),
                # Reading
                ExamItemQuota(format_code="comprehension_short", target_count=4, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Comprehension Short"),
                ExamItemQuota(format_code="comprehension_mid", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 5: Comprehension Mid"),
                ExamItemQuota(format_code="comprehension_long", target_count=4, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 6: Comprehension Long"),
                ExamItemQuota(format_code="information_retrieval", target_count=2, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 7: Information Retrieval"),
            ],
        ),
        ExamSectionBlueprint(
            section_code="N3_SEC_LISTENING",
            label="Listening",
            block_order=3,
            time_limit_minutes=40,
            categories=["listening"],
            item_quotas=[
                ExamItemQuota(format_code="task_based_listening", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Task-based Listening"),
                ExamItemQuota(format_code="key_points_listening", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Key Points Listening"),
                ExamItemQuota(format_code="general_outline_listening", target_count=3, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: General Outline Listening"),
                ExamItemQuota(format_code="verbal_expressions", target_count=4, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Verbal Expressions"),
                ExamItemQuota(format_code="quick_response", target_count=9, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 5: Quick Response"),
            ],
        ),
    ],
    scoring_sections=[
        ScoringSectionBlueprint(code="N3_SCORE_KNOWLEDGE", label="Language Knowledge (Vocabulary/Grammar)", categories=["vocabulary", "grammar"], max_score=60, pass_threshold=19),
        ScoringSectionBlueprint(code="N3_SCORE_READING", label="Reading", categories=["reading"], max_score=60, pass_threshold=19),
        ScoringSectionBlueprint(code="N3_SCORE_LISTENING", label="Listening", categories=["listening"], max_score=60, pass_threshold=19),
    ],
)


# -----------------------------------------------------------------------------
# N4 Blueprint (25 min Vocab, 55 min Grammar/Reading, 35 min Listening; 90/180 pass, 38/120 & 19/60)
# -----------------------------------------------------------------------------
N4_BLUEPRINT_2026_1 = ExamBlueprint(
    level="N4",
    version=LEGACY_BLUEPRINT_VERSION,
    name="Official JLPT N4 Standard Examination Blueprint (2026.1)",
    overall_max_score=180,
    overall_pass_threshold=90,
    test_sections=[
        ExamSectionBlueprint(
            section_code="N4_SEC_VOCABULARY",
            label="Language Knowledge (Vocabulary)",
            block_order=1,
            time_limit_minutes=25,
            categories=["vocabulary"],
            item_quotas=[
                ExamItemQuota(format_code="kanji_reading", target_count=9, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Kanji Reading"),
                ExamItemQuota(format_code="orthography", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Orthography"),
                ExamItemQuota(format_code="contextual_expressions", target_count=10, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: Contextual Expressions"),
                ExamItemQuota(format_code="paraphrases", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Paraphrases"),
                ExamItemQuota(format_code="usage", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 5: Usage"),
            ],
        ),
        ExamSectionBlueprint(
            section_code="N4_SEC_GRAMMAR_READING",
            label="Language Knowledge (Grammar) & Reading",
            block_order=2,
            time_limit_minutes=55,
            categories=["grammar", "reading"],
            item_quotas=[
                # Grammar
                ExamItemQuota(format_code="sentential_grammar_1", target_count=15, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Sentential Grammar 1"),
                ExamItemQuota(format_code="sentence_composition", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Sentence Composition (Star)"),
                ExamItemQuota(format_code="text_grammar", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: Text Grammar"),
                # Reading
                ExamItemQuota(format_code="comprehension_short", target_count=4, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Comprehension Short"),
                ExamItemQuota(format_code="comprehension_mid", target_count=4, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 5: Comprehension Mid"),
                ExamItemQuota(format_code="information_retrieval", target_count=2, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 6: Information Retrieval"),
            ],
        ),
        ExamSectionBlueprint(
            section_code="N4_SEC_LISTENING",
            label="Listening",
            block_order=3,
            time_limit_minutes=35,
            categories=["listening"],
            item_quotas=[
                ExamItemQuota(format_code="task_based_listening", target_count=8, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Task-based Listening"),
                ExamItemQuota(format_code="key_points_listening", target_count=7, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Key Points Listening"),
                ExamItemQuota(format_code="verbal_expressions", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: Verbal Expressions"),
                ExamItemQuota(format_code="quick_response", target_count=8, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Quick Response"),
            ],
        ),
    ],
    scoring_sections=[
        ScoringSectionBlueprint(code="N4_SCORE_KNOWLEDGE_READING", label="Language Knowledge (Vocabulary/Grammar) & Reading", categories=["vocabulary", "grammar", "reading"], max_score=120, pass_threshold=38),
        ScoringSectionBlueprint(code="N4_SCORE_LISTENING", label="Listening", categories=["listening"], max_score=60, pass_threshold=19),
    ],
)


# -----------------------------------------------------------------------------
# N5 Blueprint (20 min Vocab, 40 min Grammar/Reading, 30 min Listening; 80/180 pass, 38/120 & 19/60)
# -----------------------------------------------------------------------------
N5_BLUEPRINT_2026_1 = ExamBlueprint(
    level="N5",
    version=LEGACY_BLUEPRINT_VERSION,
    name="Official JLPT N5 Standard Examination Blueprint (2026.1)",
    overall_max_score=180,
    overall_pass_threshold=80,
    test_sections=[
        ExamSectionBlueprint(
            section_code="N5_SEC_VOCABULARY",
            label="Language Knowledge (Vocabulary)",
            block_order=1,
            time_limit_minutes=20,
            categories=["vocabulary"],
            item_quotas=[
                ExamItemQuota(format_code="kanji_reading", target_count=12, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Kanji Reading"),
                ExamItemQuota(format_code="orthography", target_count=8, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Orthography"),
                ExamItemQuota(format_code="contextual_expressions", target_count=10, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: Contextual Expressions"),
                ExamItemQuota(format_code="paraphrases", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Paraphrases"),
            ],
        ),
        ExamSectionBlueprint(
            section_code="N5_SEC_GRAMMAR_READING",
            label="Language Knowledge (Grammar) & Reading",
            block_order=2,
            time_limit_minutes=40,
            categories=["grammar", "reading"],
            item_quotas=[
                # Grammar
                ExamItemQuota(format_code="sentential_grammar_1", target_count=16, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Sentential Grammar 1"),
                ExamItemQuota(format_code="sentence_composition", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Sentence Composition (Star)"),
                ExamItemQuota(format_code="text_grammar", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: Text Grammar"),
                # Reading
                ExamItemQuota(format_code="comprehension_short", target_count=3, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Comprehension Short"),
                ExamItemQuota(format_code="comprehension_mid", target_count=2, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 5: Comprehension Mid"),
                ExamItemQuota(format_code="information_retrieval", target_count=1, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 6: Information Retrieval"),
            ],
        ),
        ExamSectionBlueprint(
            section_code="N5_SEC_LISTENING",
            label="Listening",
            block_order=3,
            time_limit_minutes=30,
            categories=["listening"],
            item_quotas=[
                ExamItemQuota(format_code="task_based_listening", target_count=7, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 1: Task-based Listening"),
                ExamItemQuota(format_code="key_points_listening", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 2: Key Points Listening"),
                ExamItemQuota(format_code="verbal_expressions", target_count=5, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 3: Verbal Expressions"),
                ExamItemQuota(format_code="quick_response", target_count=6, source_evidence=BlueprintEvidenceLevel.VERIFIED_PAPERS, description="Mondai 4: Quick Response"),
            ],
        ),
    ],
    scoring_sections=[
        ScoringSectionBlueprint(code="N5_SCORE_KNOWLEDGE_READING", label="Language Knowledge (Vocabulary/Grammar) & Reading", categories=["vocabulary", "grammar", "reading"], max_score=120, pass_threshold=38),
        ScoringSectionBlueprint(code="N5_SCORE_LISTENING", label="Listening", categories=["listening"], max_score=60, pass_threshold=19),
    ],
)


# =============================================================================
# Version 2026.2 (Refined Evidence-Preserving Standard Blueprints)
# Distinguishes verified official paper quotas from inferred/variable quotas.
# =============================================================================

def _derive_2026_2_blueprint(bp_2026_1: ExamBlueprint) -> ExamBlueprint:
    new_sections: list[ExamSectionBlueprint] = []
    for sec in bp_2026_1.test_sections:
        new_quotas: list[ExamItemQuota] = []
        for q in sec.item_quotas:
            # Variable quotas without uniform official verification across all administrations
            if q.format_code in ("integrated_thematic_reading", "listening_integrated"):
                new_q = ExamItemQuota(
                    format_code=q.format_code,
                    target_count=q.target_count,
                    source_evidence=BlueprintEvidenceLevel.INFERRED,
                    description=f"{q.description} (Inferred count across administrations)",
                )
            else:
                new_q = ExamItemQuota(
                    format_code=q.format_code,
                    target_count=q.target_count,
                    source_evidence=q.source_evidence,
                    description=q.description,
                )
            new_quotas.append(new_q)
        new_sec = ExamSectionBlueprint(
            section_code=sec.section_code,
            label=sec.label,
            block_order=sec.block_order,
            time_limit_minutes=sec.time_limit_minutes,
            categories=list(sec.categories),
            item_quotas=new_quotas,
        )
        new_sections.append(new_sec)

    return ExamBlueprint(
        level=bp_2026_1.level,
        version=DEFAULT_BLUEPRINT_VERSION,
        name=f"Official JLPT {bp_2026_1.level} Standard Examination Blueprint",
        overall_max_score=bp_2026_1.overall_max_score,
        overall_pass_threshold=bp_2026_1.overall_pass_threshold,
        test_sections=new_sections,
        scoring_sections=[s.model_copy() for s in bp_2026_1.scoring_sections],
    )


N1_BLUEPRINT_2026_2 = _derive_2026_2_blueprint(N1_BLUEPRINT_2026_1)
N2_BLUEPRINT_2026_2 = _derive_2026_2_blueprint(N2_BLUEPRINT_2026_1)
N3_BLUEPRINT_2026_2 = _derive_2026_2_blueprint(N3_BLUEPRINT_2026_1)
N4_BLUEPRINT_2026_2 = _derive_2026_2_blueprint(N4_BLUEPRINT_2026_1)
N5_BLUEPRINT_2026_2 = _derive_2026_2_blueprint(N5_BLUEPRINT_2026_1)

# Aliases pointing to current default (2026.2)
N1_BLUEPRINT = N1_BLUEPRINT_2026_2
N2_BLUEPRINT = N2_BLUEPRINT_2026_2
N3_BLUEPRINT = N3_BLUEPRINT_2026_2
N4_BLUEPRINT = N4_BLUEPRINT_2026_2
N5_BLUEPRINT = N5_BLUEPRINT_2026_2

OFFICIAL_BLUEPRINTS: Dict[str, ExamBlueprint] = {
    "N1": N1_BLUEPRINT_2026_2,
    "N2": N2_BLUEPRINT_2026_2,
    "N3": N3_BLUEPRINT_2026_2,
    "N4": N4_BLUEPRINT_2026_2,
    "N5": N5_BLUEPRINT_2026_2,
}

ALL_OFFICIAL_BLUEPRINTS: Dict[tuple[str, str], ExamBlueprint] = {
    ("N1", LEGACY_BLUEPRINT_VERSION): N1_BLUEPRINT_2026_1,
    ("N2", LEGACY_BLUEPRINT_VERSION): N2_BLUEPRINT_2026_1,
    ("N3", LEGACY_BLUEPRINT_VERSION): N3_BLUEPRINT_2026_1,
    ("N4", LEGACY_BLUEPRINT_VERSION): N4_BLUEPRINT_2026_1,
    ("N5", LEGACY_BLUEPRINT_VERSION): N5_BLUEPRINT_2026_1,
    ("N1", DEFAULT_BLUEPRINT_VERSION): N1_BLUEPRINT_2026_2,
    ("N2", DEFAULT_BLUEPRINT_VERSION): N2_BLUEPRINT_2026_2,
    ("N3", DEFAULT_BLUEPRINT_VERSION): N3_BLUEPRINT_2026_2,
    ("N4", DEFAULT_BLUEPRINT_VERSION): N4_BLUEPRINT_2026_2,
    ("N5", DEFAULT_BLUEPRINT_VERSION): N5_BLUEPRINT_2026_2,
}


def get_official_blueprint(level: str, version: str = DEFAULT_BLUEPRINT_VERSION) -> ExamBlueprint:
    """
    Retrieve the standard official examination blueprint for the specified level and version.
    """
    normalized_level = level.upper()
    key = (normalized_level, version)
    if key in ALL_OFFICIAL_BLUEPRINTS:
        return ALL_OFFICIAL_BLUEPRINTS[key]
    if normalized_level not in ("N1", "N2", "N3", "N4", "N5"):
        raise ValueError(f"Unknown JLPT level '{level}'. Must be one of N1, N2, N3, N4, N5.")
    raise ValueError(f"Official built-in blueprint for {level} version '{version}' not found.")


def list_official_blueprints() -> List[ExamBlueprint]:
    """Return all built-in official examination blueprints."""
    return list(OFFICIAL_BLUEPRINTS.values())


def get_blueprint_from_db_or_default(
    conn: sqlite3.Connection,
    level: str,
    version: Optional[str] = None,
) -> ExamBlueprint:
    """
    Load a versioned blueprint from the database ledger, falling back to built-in default.
    """
    normalized_level = level.upper()
    target_version = version or DEFAULT_BLUEPRINT_VERSION

    row = conn.execute(
        """
        SELECT config_json FROM exam_blueprint
        WHERE level = ? AND version = ?;
        """,
        (normalized_level, target_version),
    ).fetchone()

    if row:
        data = json.loads(row["config_json"])
        data_clean = {k: v for k, v in data.items() if k not in ("exam_mode", "audio_play_counts")}
        return ExamBlueprint.model_validate(data_clean)

    # Fall back to built-in official blueprint and persist it
    default_bp = get_official_blueprint(normalized_level, DEFAULT_BLUEPRINT_VERSION)
    save_blueprint_to_db(conn, default_bp)
    return default_bp


def save_blueprint_to_db(conn: sqlite3.Connection, blueprint: ExamBlueprint) -> None:
    """
    Persist or update an active exam blueprint in the database ledger.
    """
    config_json = blueprint.model_dump_json()
    conn.execute(
        """
        INSERT INTO exam_blueprint (level, version, name, config_json, is_active)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(level, version) DO UPDATE SET
            name = excluded.name,
            config_json = excluded.config_json,
            is_active = excluded.is_active;
        """,
        (blueprint.level, blueprint.version, blueprint.name, config_json),
    )
