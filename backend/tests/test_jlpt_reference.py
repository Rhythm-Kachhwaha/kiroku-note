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
