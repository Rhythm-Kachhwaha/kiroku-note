from app.services.grammar_reference import (
    GrammarReferenceService,
    resolve_grammar_reference_db_path,
)


def test_resolve_grammar_reference_db_path():
    path = resolve_grammar_reference_db_path()
    assert path.name == "grammar_reference.sqlite"
    assert path.is_file()


def test_grammar_reference_lookup():
    service = GrammarReferenceService()
    point = service.get_point_by_key("てしまう")
    assert point is not None
    assert point["level"] in ("N5", "N4")
    assert "completely" in point["meaning_short"].lower() or "regret" in point["meaning_short"].lower()
    assert point["english_breakdown"]
    assert isinstance(point["examples"], list)


def test_grammar_reference_normalizes_display_markers_and_katakana():
    service = GrammarReferenceService()
    assert service.get_point_by_key("〜てしまう") == service.get_point_by_key("てシマウ")


def test_grammar_reference_preserves_normalized_key_collisions():
    service = GrammarReferenceService()
    point = service.get_point_by_key("らしい")

    assert point is not None
    assert {source["level"] for source in point["sources"]} == {"N4", "N3"}
    assert {source["meaning_short"] for source in point["sources"]} == {
        "seems like; I heard; typical of",
        "seems; I heard; typical (less casual than みたい)",
    }


def test_seed_normalization_and_retrieval_consistency():
    service = GrammarReferenceService()

    # 1. Verify each seed pattern can be retrieved using normalized key and tilde variants (〜, ~, ～)
    test_cases = [
        ("ば〜ほど", "ばほど", ["ば〜ほど", "ば~ほど", "ば～ほど", "ばほど"], "N3"),
        ("とか〜とか", "とかとか", ["とか〜とか", "とか~とか", "とか～とか", "とかとか"], "N4"),
        ("お〜になる", "おになる", ["お〜になる", "お~になる", "お～になる", "おになる"], "N4"),
    ]

    for raw_pattern, norm_key, variants, expected_level in test_cases:
        canonical_point = service.get_point_by_key(norm_key)
        assert canonical_point is not None, f"Failed to retrieve point for {norm_key}"
        assert canonical_point["pattern_key"] == norm_key
        assert canonical_point["level"] == expected_level

        # Tilde variants behave consistently
        for variant in variants:
            point = service.get_point_by_key(variant)
            assert point is not None
            assert point["id"] == canonical_point["id"]
            assert point["pattern_key"] == norm_key

        # Seed information is preserved and retrieved in sources
        sources = canonical_point.get("sources", [])
        assert len(sources) >= 2, f"Expected both OpenJLPT and Seed sources for {norm_key}"
        seed_source = next((s for s in sources if s.get("source") == "Kiroku matcher seed"), None)
        assert seed_source is not None, f"Seed record not found in sources for {norm_key}"
        assert seed_source["pattern_key"] == norm_key
        assert seed_source["level"] == expected_level

        # Active matcher configuration is preserved
        if norm_key in {"ばほど", "とかとか"}:
            assert canonical_point["matcher"]["type"] == "discontinuous"
            assert seed_source["matcher"]["type"] == "discontinuous"
        elif norm_key == "おになる":
            assert canonical_point["matcher"]["type"] == "regex"
            assert seed_source["matcher"]["type"] == "regex"


def test_builder_seed_rows_normalized_consistently(tmp_path):
    from tools.build_grammar_index import row_for, normalize_pattern_key, build

    # Verify row_for normalizes seed rows through same code path as source rows
    seed_row = row_for("ば〜ほど", "N3", "meaning", None, "[]", "Kiroku matcher seed")
    source_row = row_for("〜ば〜ほど", "N3", "meaning", None, "[]", "OpenJLPT grammar list")
    assert seed_row[1] == normalize_pattern_key("ば〜ほど") == "ばほど"
    assert source_row[1] == normalize_pattern_key("〜ば〜ほど") == "ばほど"
    assert seed_row[1] == source_row[1]

    # Verify rebuilding produces consistent database
    db_path = tmp_path / "grammar_test.sqlite"
    build(db_path)
    test_service = GrammarReferenceService(db_path)
    try:
        for key in ("ばほど", "とかとか", "おになる"):
            pt = test_service.get_point_by_key(key)
            assert pt is not None
            assert pt["pattern_key"] == key
            assert len(pt["sources"]) == 2
    finally:
        test_service.close()
        GrammarReferenceService._index_cache.pop(db_path.resolve(), None)
