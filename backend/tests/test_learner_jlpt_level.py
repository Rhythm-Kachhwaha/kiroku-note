"""Tests for unified learner JLPT level resolution, normalization, and promotion containment."""
import pytest
from app.config import (
    DEFAULT_LEARNER_JLPT_LEVEL,
    get_learner_jlpt_level,
    is_within_learner_level,
    normalize_jlpt_level,
    save_stored_llm_config,
)


class TestNormalizeJlptLevel:
    def test_normalize_standard_strings(self):
        for lvl in ["N1", "N2", "N3", "N4", "N5"]:
            assert normalize_jlpt_level(lvl) == lvl
            assert normalize_jlpt_level(lvl.lower()) == lvl

    def test_normalize_digits(self):
        assert normalize_jlpt_level("1") == "N1"
        assert normalize_jlpt_level("2") == "N2"
        assert normalize_jlpt_level("3") == "N3"
        assert normalize_jlpt_level("4") == "N4"
        assert normalize_jlpt_level("5") == "N5"

    def test_normalize_with_whitespace(self):
        assert normalize_jlpt_level("  n4  ") == "N4"
        assert normalize_jlpt_level("\tN2\n") == "N2"
        assert normalize_jlpt_level("  5  ") == "N5"

    def test_normalize_integers(self):
        assert normalize_jlpt_level(4) == "N4"  # type: ignore[arg-type]
        assert normalize_jlpt_level(1) == "N1"  # type: ignore[arg-type]

    def test_normalize_invalid_inputs(self):
        assert normalize_jlpt_level(None) is None
        assert normalize_jlpt_level("") is None
        assert normalize_jlpt_level("   ") is None
        assert normalize_jlpt_level("0") is None
        assert normalize_jlpt_level("6") is None
        assert normalize_jlpt_level("N0") is None
        assert normalize_jlpt_level("N6") is None
        assert normalize_jlpt_level("N-1") is None
        assert normalize_jlpt_level("invalid") is None
        assert normalize_jlpt_level(True) is None  # type: ignore[arg-type]
        assert normalize_jlpt_level(False) is None  # type: ignore[arg-type]


class TestDefaultLearnerJlptLevel:
    def test_default_constant(self):
        assert DEFAULT_LEARNER_JLPT_LEVEL == "N4"


class TestGetLearnerJlptLevel:
    def test_default_when_no_config(self):
        assert get_learner_jlpt_level({}) == "N4"

    def test_env_var_override(self):
        assert get_learner_jlpt_level({"KIROKU_LEARNER_JLPT_LEVEL": "N2"}) == "N2"
        assert get_learner_jlpt_level({"KIROKU_LEARNER_JLPT_LEVEL": "n1"}) == "N1"
        assert get_learner_jlpt_level({"KIROKU_LEARNER_JLPT_LEVEL": "5"}) == "N5"

    def test_env_var_invalid_falls_back_to_default(self):
        assert get_learner_jlpt_level({"KIROKU_LEARNER_JLPT_LEVEL": "invalid"}) == "N4"

    def test_stored_learner_jlpt_level(self, tmp_path):
        env = {"KIROKU_DATA_DIR": str(tmp_path)}
        assert get_learner_jlpt_level(env) == "N4"
        save_stored_llm_config({"learner_jlpt_level": "N3"}, env=env)
        assert get_learner_jlpt_level(env) == "N3"

    def test_stored_learner_jlpt_level_normalization(self, tmp_path):
        env = {"KIROKU_DATA_DIR": str(tmp_path)}
        save_stored_llm_config({"learner_jlpt_level": "n5"}, env=env)
        assert get_learner_jlpt_level(env) == "N5"

    def test_stored_fallback_to_jlpt_level(self, tmp_path):
        env = {"KIROKU_DATA_DIR": str(tmp_path)}
        # When learner_jlpt_level is absent, fall back to jlpt_level
        save_stored_llm_config({"jlpt_level": "N2"}, env=env)
        assert get_learner_jlpt_level(env) == "N2"

    def test_stored_precedence_learner_over_jlpt_level(self, tmp_path):
        env = {"KIROKU_DATA_DIR": str(tmp_path)}
        # learner_jlpt_level takes precedence over legacy jlpt_level
        save_stored_llm_config({"learner_jlpt_level": "N1", "jlpt_level": "N5"}, env=env)
        assert get_learner_jlpt_level(env) == "N1"

    def test_stored_invalid_learner_falls_back_to_jlpt_level(self, tmp_path):
        env = {"KIROKU_DATA_DIR": str(tmp_path)}
        # Invalid learner_jlpt_level falls back to valid jlpt_level
        save_stored_llm_config({"learner_jlpt_level": "invalid", "jlpt_level": "N3"}, env=env)
        assert get_learner_jlpt_level(env) == "N3"

    def test_env_takes_precedence_over_stored(self, tmp_path):
        env = {
            "KIROKU_DATA_DIR": str(tmp_path),
            "KIROKU_LEARNER_JLPT_LEVEL": "N5",
        }
        save_stored_llm_config({"learner_jlpt_level": "N1"}, env=env)
        assert get_learner_jlpt_level(env) == "N5"

    def test_invalid_env_falls_back_to_stored(self, tmp_path):
        env = {
            "KIROKU_DATA_DIR": str(tmp_path),
            "KIROKU_LEARNER_JLPT_LEVEL": "invalid",
        }
        save_stored_llm_config({"learner_jlpt_level": "N2"}, env=env)
        assert get_learner_jlpt_level(env) == "N2"


class TestIsWithinLearnerLevel:
    def test_default_learner_level_is_n4(self):
        # Default learner level is N4: encompasses N5 and N4
        assert is_within_learner_level("N5") is True
        assert is_within_learner_level("N4") is True
        assert is_within_learner_level("N3") is False
        assert is_within_learner_level("N2") is False
        assert is_within_learner_level("N1") is False

    def test_none_or_invalid_target_returns_false(self):
        assert is_within_learner_level(None) is False
        assert is_within_learner_level("") is False
        assert is_within_learner_level("unknown") is False
        assert is_within_learner_level("N0") is False
        assert is_within_learner_level("N6") is False

    def test_learner_level_n5(self):
        # N5 learner only encompasses N5
        assert is_within_learner_level("N5", "N5") is True
        assert is_within_learner_level("N4", "N5") is False
        assert is_within_learner_level("N3", "N5") is False
        assert is_within_learner_level("N2", "N5") is False
        assert is_within_learner_level("N1", "N5") is False

    def test_learner_level_n3(self):
        assert is_within_learner_level("N5", "N3") is True
        assert is_within_learner_level("N4", "N3") is True
        assert is_within_learner_level("N3", "N3") is True
        assert is_within_learner_level("N2", "N3") is False
        assert is_within_learner_level("N1", "N3") is False

    def test_learner_level_n2(self):
        assert is_within_learner_level("N5", "N2") is True
        assert is_within_learner_level("N4", "N2") is True
        assert is_within_learner_level("N3", "N2") is True
        assert is_within_learner_level("N2", "N2") is True
        assert is_within_learner_level("N1", "N2") is False

    def test_learner_level_n1(self):
        # N1 encompasses all levels N5..N1
        for lvl in ["N5", "N4", "N3", "N2", "N1"]:
            assert is_within_learner_level(lvl, "N1") is True

    def test_normalization_in_containment(self):
        assert is_within_learner_level("n5", "n4") is True
        assert is_within_learner_level("5", "4") is True
        assert is_within_learner_level("4", "3") is True
        assert is_within_learner_level("1", "4") is False

    def test_invalid_learner_level_defaults_to_n4(self):
        # If an invalid learner level is provided, it should default to N4
        assert is_within_learner_level("N5", "invalid") is True
        assert is_within_learner_level("N4", "invalid") is True
        assert is_within_learner_level("N3", "invalid") is False
