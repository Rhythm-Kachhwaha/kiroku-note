import pytest
from app.services.jlpt_reference import JlptReferenceService


def test_lookup_word_known():
    service = JlptReferenceService()
    # 食べる is a well-known N5 word
    level = service.lookup_word("食べる")
    assert level == "N5"


def test_lookup_word_unknown():
    service = JlptReferenceService()
    assert service.lookup_word("xyznonexistent123") is None
    assert service.lookup_word("") is None


def test_lookup_kanji_known():
    service = JlptReferenceService()
    # 食 is an N5 kanji
    level = service.lookup_kanji("食")
    assert level == "N5"


def test_lookup_kanji_unknown():
    service = JlptReferenceService()
    assert service.lookup_kanji("X") is None
    assert service.lookup_kanji("") is None


def test_nonexistent_database_fail_soft(tmp_path):
    fake_db = tmp_path / "nonexistent.sqlite"
    service = JlptReferenceService(db_path=fake_db)
    assert service.lookup_word("食べる") is None
    assert service.lookup_kanji("食") is None


def test_jlpt_multi_word_space_separated_resolution():
    service = JlptReferenceService()
    # '見る 観る' is N5 in DB, single '見る' is N3 in DB. Canonical level must be N5.
    assert service.lookup_word("見る") == "N5"
    assert service.lookup_word("観る") == "N5"


def test_jlpt_derivational_suffix_fallback():
    service = JlptReferenceService()
    # '必要性' is not in vocab table, but '必要' is N4
    assert service.lookup_word("必要性") == "N4"
    # '影響力' is not in vocab table, but '影響' is N3
    assert service.lookup_word("影響力") == "N3"


def test_jlpt_kanji_level_fallback_heuristic():
    service = JlptReferenceService()
    # '顕著' is not in vocab table, but 顕=N1, 著=N2 -> Conservative N1
    assert service.lookup_word_with_kanji_fallback("顕著") == "N1"


def test_lookup_word_exact_known():
    service = JlptReferenceService()
    # 食べる is an exact match in vocab table with level N5
    assert service.lookup_word_exact("食べる") == "N5"
    assert service.lookup_word_exact("勉強") == "N5"


def test_lookup_word_exact_reading_disambiguation():
    service = JlptReferenceService()
    # 勉強 has 'べんきょうする' (N5) and 'べんきょう' (N3)
    assert service.lookup_word_exact("勉強", reading="べんきょう") == "N3"
    assert service.lookup_word_exact("勉強", reading="べんきょうする") == "N5"

    # 悪い has 'わるい' (N5) and 'にくい' (N1)
    assert service.lookup_word_exact("悪い", reading="にくい") == "N1"
    assert service.lookup_word_exact("悪い", reading="わるい") == "N5"


def test_lookup_word_exact_false_positive_prevention():
    service = JlptReferenceService()
    # Suffix stripping produces false positive in lookup_word, but lookup_word_exact must reject it
    assert service.lookup_word("必要性") == "N4"
    assert service.lookup_word_exact("必要性") is None

    assert service.lookup_word("影響力") == "N3"
    assert service.lookup_word_exact("影響力") is None

    # Partial/LIKE matches in lookup_word ('見る 観る' -> N5) must NOT match in lookup_word_exact
    assert service.lookup_word("観る") == "N5"
    assert service.lookup_word_exact("観る") is None


def test_lookup_word_exact_edge_cases(tmp_path):
    service = JlptReferenceService()
    assert service.lookup_word_exact("") is None
    assert service.lookup_word_exact("   ") is None
    assert service.lookup_word_exact("xyznonexistent123") is None

    # Fail soft if database is nonexistent
    fake_db = tmp_path / "nonexistent.sqlite"
    fake_service = JlptReferenceService(db_path=fake_db)
    assert fake_service.lookup_word_exact("食べる") is None


