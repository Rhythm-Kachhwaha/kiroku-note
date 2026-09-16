"""Focused tests for CardService multi-sense card draft synthesis."""
from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock

from app.repositories.card_repository import CardDraft, CardRepository
from app.services.card_service import (
    CardService,
    synthesize_default_example,
    synthesize_default_meaning,
)
from app.services.yomitan import (
    DictionaryEntry,
    DictionarySense,
    EnrichedTerm,
    ExampleSentence,
    IdentifiedTerm,
)


class TestCardServiceDraftSynthesis(unittest.TestCase):
    # 1. Empty entries -> ""
    def test_synthesize_default_meaning_empty_entries(self):
        self.assertEqual(synthesize_default_meaning([]), "")

    # 2. Empty senses -> ""
    def test_synthesize_default_meaning_empty_senses(self):
        self.assertEqual(
            synthesize_default_meaning([DictionaryEntry(dictionary="Test", senses=[])]),
            "",
        )
        self.assertEqual(
            synthesize_default_meaning(
                [DictionaryEntry(dictionary="Test", senses=[DictionarySense(glosses=[])])]
            ),
            "",
        )

    # 3. Single sense with multiple glosses
    def test_synthesize_default_meaning_single_sense(self):
        entries = [
            DictionaryEntry(
                dictionary="Jitendex",
                is_primary=True,
                senses=[
                    DictionarySense(
                        index=1,
                        glosses=["movie", "film"],
                    )
                ],
            )
        ]
        self.assertEqual(synthesize_default_meaning(entries), "movie, film")

    # 4. Multiple senses -> numbered lines
    def test_synthesize_default_meaning_multi_sense(self):
        entries = [
            DictionaryEntry(
                dictionary="Jitendex",
                is_primary=True,
                term="食べる",
                reading="たべる",
                senses=[
                    DictionarySense(index=1, glosses=["to eat"]),
                    DictionarySense(
                        index=2,
                        glosses=["to live on (e.g. one's salary)", "to get by"],
                    ),
                ],
            )
        ]
        expected = "1. to eat\n2. to live on (e.g. one's salary), to get by"
        self.assertEqual(synthesize_default_meaning(entries), expected)

    # 5. Primary entry selection
    def test_synthesize_default_meaning_prefers_primary_entry(self):
        entries = [
            DictionaryEntry(
                dictionary="SecondaryDict",
                is_primary=False,
                senses=[DictionarySense(index=1, glosses=["secondary definition"])],
            ),
            DictionaryEntry(
                dictionary="PrimaryDict",
                is_primary=True,
                senses=[
                    DictionarySense(index=1, glosses=["primary sense 1"]),
                    DictionarySense(index=2, glosses=["primary sense 2"]),
                ],
            ),
        ]
        expected = "1. primary sense 1\n2. primary sense 2"
        self.assertEqual(synthesize_default_meaning(entries), expected)

    # 6. Primary entry with no usable glosses -> fallback to another valid entry
    def test_synthesize_default_meaning_falls_back_if_primary_has_no_glosses(self):
        entries = [
            DictionaryEntry(
                dictionary="EmptyPrimary",
                is_primary=True,
                senses=[DictionarySense(index=1, glosses=[])],
            ),
            DictionaryEntry(
                dictionary="SecondaryValid",
                is_primary=False,
                senses=[DictionarySense(index=1, glosses=["valid fallback"])],
            ),
        ]
        self.assertEqual(synthesize_default_meaning(entries), "valid fallback")

    # 7. Empty/whitespace gloss filtering
    def test_synthesize_default_meaning_filters_empty_and_whitespace_glosses(self):
        entries = [
            DictionaryEntry(
                dictionary="Jitendex",
                is_primary=True,
                senses=[
                    DictionarySense(index=1, glosses=["  ", ""]),
                    DictionarySense(index=2, glosses=["  to eat  ", "", "  to dine  "]),
                ],
            )
        ]
        self.assertEqual(synthesize_default_meaning(entries), "to eat, to dine")

    # 8. Multiple senses where only one has usable glosses -> unnumbered result
    def test_synthesize_default_meaning_filters_empty_senses_to_single_unnumbered(self):
        entries = [
            DictionaryEntry(
                dictionary="Jitendex",
                is_primary=True,
                senses=[
                    DictionarySense(index=1, glosses=[""]),
                    DictionarySense(index=2, glosses=["valid sense"]),
                    DictionarySense(index=3, glosses=["   "]),
                ],
            )
        ]
        self.assertEqual(synthesize_default_meaning(entries), "valid sense")

    # 9. Primary entry example
    def test_synthesize_default_example_primary_entry(self):
        entries = [
            DictionaryEntry(
                dictionary="Jitendex",
                is_primary=True,
                senses=[
                    DictionarySense(
                        index=1,
                        glosses=["to eat"],
                        examples=[
                            ExampleSentence(
                                japanese="ご飯を食べる",
                                reading="ご飯[はん]を食[た]べる",
                                translation="to eat a meal",
                            )
                        ],
                    )
                ],
            )
        ]
        sentence, translation = synthesize_default_example(entries)
        self.assertEqual(sentence, "ご飯を食べる")
        self.assertEqual(translation, "to eat a meal")

    # 10. Fallback when primary has no example
    def test_synthesize_default_example_fallback_when_primary_has_no_example(self):
        entries = [
            DictionaryEntry(
                dictionary="PrimaryNoExample",
                is_primary=True,
                senses=[DictionarySense(index=1, glosses=["to drink"], examples=[])],
            ),
            DictionaryEntry(
                dictionary="SecondaryWithExample",
                is_primary=False,
                senses=[
                    DictionarySense(
                        index=1,
                        glosses=["to drink"],
                        examples=[
                            ExampleSentence(
                                japanese="水を飲む",
                                translation="to drink water",
                            )
                        ],
                    )
                ],
            ),
        ]
        sentence, translation = synthesize_default_example(entries)
        self.assertEqual(sentence, "水を飲む")
        self.assertEqual(translation, "to drink water")

    # 11. No examples -> ("", "")
    def test_synthesize_default_example_empty(self):
        self.assertEqual(synthesize_default_example([]), ("", ""))
        self.assertEqual(
            synthesize_default_example([DictionaryEntry(dictionary="Test", senses=[])]),
            ("", ""),
        )

    # 12. Multi-sense capture produces numbered meaning
    def test_capture_term_synthesizes_multisense_meaning(self):
        mock_yomitan = MagicMock()
        mock_yomitan.identify.return_value = IdentifiedTerm("掛ける", "かける", "掛ける", "掛ける")
        mock_yomitan.enrich.return_value = EnrichedTerm(
            expression="掛ける",
            reading="かける",
            source_text="掛ける",
            deinflected_text="掛ける",
            jlpt_level="N5",
            entries=[
                DictionaryEntry(
                    dictionary="Jitendex",
                    is_primary=True,
                    term="掛ける",
                    reading="かける",
                    senses=[
                        DictionarySense(index=1, glosses=["to hang up", "to hoist"]),
                        DictionarySense(index=2, glosses=["to put on (glasses, etc.)"]),
                        DictionarySense(index=3, glosses=["to spend (time, money)"]),
                    ],
                )
            ],
            dictionary_error=None,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            repo = CardRepository(Path(tmpdir) / "test.db")
            service = CardService(yomitan_service=mock_yomitan, card_repository=repo)

            draft = service.capture_term("掛ける")
            expected_meaning = (
                "1. to hang up, to hoist\n"
                "2. to put on (glasses, etc.)\n"
                "3. to spend (time, money)"
            )
            self.assertEqual(draft.meaning, expected_meaning)
            self.assertEqual(draft.status, "draft")

    # 13. jlpt_level survives into CaptureResponse
    def test_capture_term_forwards_jlpt_level(self):
        mock_yomitan = MagicMock()
        mock_yomitan.identify.return_value = IdentifiedTerm("映画", "えいが", "映画", "映画")
        mock_yomitan.enrich.return_value = EnrichedTerm(
            expression="映画",
            reading="えいが",
            source_text="映画",
            deinflected_text="映画",
            jlpt_level="N5",
            entries=[
                DictionaryEntry(
                    dictionary="Jitendex",
                    is_primary=True,
                    senses=[DictionarySense(index=1, glosses=["movie", "film"])],
                )
            ],
            dictionary_error=None,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            repo = CardRepository(Path(tmpdir) / "test.db")
            service = CardService(yomitan_service=mock_yomitan, card_repository=repo)

            draft = service.capture_term("映画")
            self.assertEqual(draft.jlpt_level, "N5")

    # 14. Existing saved card/user meaning is preserved
    def test_capture_term_preserves_user_edited_saved_card_meaning(self):
        mock_yomitan = MagicMock()
        mock_yomitan.identify.return_value = IdentifiedTerm("掛ける", "かける", "掛ける", "掛ける")
        mock_yomitan.enrich.return_value = EnrichedTerm(
            expression="掛ける",
            reading="かける",
            source_text="掛ける",
            deinflected_text="掛ける",
            jlpt_level="N5",
            entries=[
                DictionaryEntry(
                    dictionary="Jitendex",
                    is_primary=True,
                    term="掛ける",
                    reading="かける",
                    senses=[
                        DictionarySense(index=1, glosses=["to hang up", "to hoist"]),
                        DictionarySense(index=2, glosses=["to put on (glasses, etc.)"]),
                    ],
                )
            ],
            dictionary_error=None,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            repo = CardRepository(Path(tmpdir) / "test.db")
            # Pre-save an existing card with a user-customized meaning
            repo.save_or_update(
                CardDraft(
                    expression="掛ける",
                    reading="かける",
                    meaning="My Custom User Meaning: to take time",
                    deck_name="Default",
                )
            )

            service = CardService(yomitan_service=mock_yomitan, card_repository=repo)
            result = service.capture_term("掛ける", deck_name="Default")

            # Must return the user-saved meaning, NOT overwrite with multi-sense default
            self.assertEqual(result.meaning, "My Custom User Meaning: to take time")
            self.assertEqual(result.status, "already_saved")
            self.assertTrue(result.is_duplicate)


if __name__ == "__main__":
    unittest.main()
