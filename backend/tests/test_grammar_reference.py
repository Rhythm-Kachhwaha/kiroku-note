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
