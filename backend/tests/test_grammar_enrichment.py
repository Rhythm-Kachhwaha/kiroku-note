"""Tests for grammar enrichment table, service integration, and Tofugu parser."""
from __future__ import annotations

import json
from pathlib import Path
import sqlite3

import pytest

from app.services.grammar_reference import (
    CREATE_ENRICHMENT_TABLE_SQL,
    GrammarReferenceService,
    resolve_grammar_reference_db_path,
)
from app.study.acquisition.parsers.enrichment_seeds import CORE_ENRICHMENT_SEEDS
from app.study.acquisition.parsers.tofugu_parser import (
    CommonPitfall,
    FormationRule,
    GrammarEnrichment,
    NuanceContrast,
    TofuguParser,
)


def test_grammar_enrichment_schema_and_idempotency(tmp_path: Path):
    """Verify table creation SQL executes cleanly and is idempotent."""
    db_file = tmp_path / "test_enrichment.sqlite"
    conn = sqlite3.connect(db_file)

    # First execution creates table
    conn.executescript(CREATE_ENRICHMENT_TABLE_SQL)
    columns = [
        col[1] for col in conn.execute("PRAGMA table_info(grammar_enrichment)").fetchall()
    ]
    expected_cols = [
        "concept_id",
        "big_picture_concept",
        "formation_rules",
        "common_pitfalls",
        "nuance_contrasts",
        "visual_anchor_svg",
        "source_url",
        "updated_at",
    ]
    assert columns == expected_cols

    # Second execution must succeed idempotently without error
    conn.executescript(CREATE_ENRICHMENT_TABLE_SQL)

    # Verify insert and roundtrip
    enrichment = GrammarEnrichment(
        concept_id="c_test_point",
        big_picture_concept="Test mental model concept",
        formation_rules=[FormationRule(structure="Verb + て", description="te-form connection")],
        common_pitfalls=[CommonPitfall(misconception="Do not use with nouns", explanation="Strictly verb-only")],
        nuance_contrasts=[NuanceContrast(target_pattern="たら", difference="Different conditionality")],
        visual_anchor_svg="<svg></svg>",
        source_url="https://example.com/grammar/test",
    )
    conn.execute(
        "INSERT INTO grammar_enrichment VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        enrichment.to_db_row(),
    )
    conn.commit()

    row = conn.execute("SELECT * FROM grammar_enrichment WHERE concept_id = ?", ("c_test_point",)).fetchone()
    assert row is not None
    restored = GrammarEnrichment.from_db_row(row)
    assert restored.concept_id == "c_test_point"
    assert restored.big_picture_concept == "Test mental model concept"
    assert len(restored.formation_rules) == 1
    assert restored.formation_rules[0].structure == "Verb + て"
    assert len(restored.common_pitfalls) == 1
    assert len(restored.nuance_contrasts) == 1
    assert restored.visual_anchor_svg == "<svg></svg>"
    conn.close()


def test_grammar_reference_service_joins_enrichment():
    """Verify GrammarReferenceService transparently loads and joins enrichment data."""
    # Using the real bundled grammar reference database
    service = GrammarReferenceService()

    # Query key particles
    wa_point = service.get_point_by_key("は")
    assert wa_point is not None
    enrichment = wa_point.get("enrichment")
    assert enrichment is not None
    assert enrichment["concept_id"] == "c_n5_point_21"
    assert "topic" in enrichment["big_picture_concept"].lower()
    assert isinstance(enrichment["formation_rules"], list)
    assert any("は" in r["structure"] for r in enrichment["formation_rules"])
    assert isinstance(enrichment["nuance_contrasts"], list)
    assert any(c["target_pattern"] == "が" for c in enrichment["nuance_contrasts"])
    assert enrichment["visual_anchor_svg"] is not None

    # Query direct method
    enrichment_direct = service.get_enrichment("c_n5_point_21")
    assert enrichment_direct is not None
    assert enrichment_direct["big_picture_concept"] == enrichment["big_picture_concept"]

    # Point without enrichment returns None for enrichment field
    non_enriched = service.get_point_by_key("てしまう")
    assert non_enriched is not None
    assert non_enriched.get("enrichment") is None


def test_seeded_core_conceptual_points_coverage():
    """Verify core conceptual reference hubs are seeded out-of-the-box."""
    service = GrammarReferenceService()

    # Core Hubs to check:
    # 1. Particles: は, が, に, で
    # 2. Giving/Receiving: てあげる, てくれる, てもらう
    # 3. Conditionals: と, ば, たら, なら
    # 4. Evidentials/Conjectures: そうだ(appearance), そうだ(hearsay), らしい(conjecture), らしい(typical), ようだ
    target_keys = [
        "は", "が", "に", "で",
        "てあげる", "てくれる", "てもらう",
        "と", "ば", "たら", "なら",
        "そうだ(appearance)", "そうだ(hearsay)", "らしい", "ようだ"
    ]

    for key in target_keys:
        pt = service.get_point_by_key(key)
        assert pt is not None, f"Grammar point {key} not found"
        enr = pt.get("enrichment")
        assert enr is not None, f"Grammar point {key} (concept_id={pt.get('concept_id')}) missing enrichment"
        assert len(enr["big_picture_concept"]) > 20
        assert isinstance(enr["formation_rules"], list) and len(enr["formation_rules"]) > 0
        assert isinstance(enr["common_pitfalls"], list) and len(enr["common_pitfalls"]) > 0
        assert isinstance(enr["nuance_contrasts"], list) and len(enr["nuance_contrasts"]) > 0


def test_tofugu_parser_extraction_and_schema_compliance():
    """Verify TofuguParser extracts structured fields from markdown."""
    raw_markdown = """
# What is Verb + てあげる?

## Big Picture
Doing a favor for someone else with the psychological vector flowing outward from you to them.
It expresses that you willingly do an action for their benefit.

## How to Form
- `Verb [て-form] + あげる`: Used for peers or people below you.
- `Verb [て-form] + さしあげる`: Humble form for superiors.

## Common Mistakes
- Using it directly with a teacher or boss: It sounds condescending as if you are doing them a huge favor.
- Using it when you are the receiver: Use てくれる instead!

## Nuance Contrasts
- てくれる: Action moves towards you; benefactor is the other person.
- てもらう: You initiated or asked to receive the favor.
"""

    parser = TofuguParser()
    result = parser.parse(
        raw_markdown=raw_markdown,
        concept_id="c_n4_point_13",
        source_url="https://www.tofugu.com/japanese-grammar/te-ageru/",
        visual_anchor_svg="<svg viewBox='0 0 50 50'></svg>",
    )

    assert result.concept_id == "c_n4_point_13"
    assert "psychological vector flowing outward" in result.big_picture_concept
    assert len(result.formation_rules) == 2
    assert "Verb [て-form] + あげる" in result.formation_rules[0].structure
    assert len(result.common_pitfalls) == 2
    assert "Using it directly with a teacher or boss" in result.common_pitfalls[0].misconception
    assert len(result.nuance_contrasts) == 2
    assert result.nuance_contrasts[0].target_pattern == "てくれる"
    assert "moves towards you" in result.nuance_contrasts[0].difference
    assert result.visual_anchor_svg == "<svg viewBox='0 0 50 50'></svg>"

    # Check to_db_row format
    db_row = result.to_db_row()
    assert len(db_row) == 8
    assert db_row[0] == "c_n4_point_13"
    # Ensure JSON columns are valid JSON
    assert json.loads(db_row[2])
    assert json.loads(db_row[3])
    assert json.loads(db_row[4])
