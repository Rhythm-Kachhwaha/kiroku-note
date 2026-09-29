from app.services.verb_metadata import parse_verb_metadata


def test_parse_ichidan_transitive():
    meta = parse_verb_metadata(["1-dan", "transitive"])
    assert meta.is_verb is True
    assert meta.verb_type == "ichidan"
    assert meta.is_transitive is True
    assert meta.is_intransitive is False
    assert meta.transitivity_label == "他動詞"


def test_parse_godan_intransitive():
    meta = parse_verb_metadata(["5-dan", "intransitive"])
    assert meta.is_verb is True
    assert meta.verb_type == "godan"
    assert meta.is_transitive is False
    assert meta.is_intransitive is True
    assert meta.transitivity_label == "自動詞"


def test_parse_godan_special():
    meta = parse_verb_metadata(["5-dan (spec.)", "transitive"])
    assert meta.is_verb is True
    assert meta.verb_type == "godan"
    assert meta.is_transitive is True
    assert meta.is_intransitive is False
    assert meta.transitivity_label == "他動詞"


def test_parse_suru_verb():
    meta = parse_verb_metadata(["noun", "suru", "transitive", "intransitive"])
    assert meta.is_verb is True
    assert meta.verb_type == "suru"
    assert meta.is_transitive is True
    assert meta.is_intransitive is True
    assert meta.transitivity_label == "自他動詞"


def test_parse_kuru_verb():
    meta = parse_verb_metadata(["kuru verb", "intransitive"])
    assert meta.is_verb is True
    assert meta.verb_type == "kuru"
    assert meta.is_transitive is False
    assert meta.is_intransitive is True
    assert meta.transitivity_label == "自動詞"


def test_parse_aux_verb():
    meta = parse_verb_metadata(["aux-verb"])
    assert meta.is_verb is True
    assert meta.verb_type == "aux-verb"
    assert meta.is_transitive is False
    assert meta.is_intransitive is False
    assert meta.transitivity_label == "none"


def test_parse_non_verb():
    meta = parse_verb_metadata(["noun", "adjective"])
    assert meta.is_verb is False
    assert meta.verb_type is None
    assert meta.is_transitive is False
    assert meta.is_intransitive is False
    assert meta.transitivity_label == "none"


def test_parse_empty():
    meta = parse_verb_metadata([])
    assert meta.is_verb is False
    assert meta.verb_type is None
    assert meta.is_transitive is False
    assert meta.is_intransitive is False
    assert meta.transitivity_label == "none"
