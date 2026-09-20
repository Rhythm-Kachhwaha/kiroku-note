"""Unit tests for Stage 3B.1 Dictionary AST Normalization and Domain Models."""
import unittest
from dataclasses import asdict

from app.services.yomitan import (
    DictionaryEntry,
    DictionarySense,
    EnrichedTerm,
    Example,
    ExampleSentence,
    FrequencyRank,
    IdentifiedTerm,
    PitchAccent,
    Sense,
    YomitanService,
)


class TestDictionaryDomainModels(unittest.TestCase):
    """Test provider-neutral domain models and backward compatibility aliases."""

    def test_example_sentence_instantiation_and_alias(self):
        ex = ExampleSentence(
            japanese="映画を見る",
            reading="えいがをみる",
            translation="watch a movie",
            source_dictionary="Jitendex",
        )
        self.assertEqual(ex.japanese, "映画を見る")
        self.assertEqual(ex.reading, "えいがをみる")
        self.assertEqual(ex.translation, "watch a movie")
        self.assertEqual(ex.source_dictionary, "Jitendex")

        # Test backward-compatible alias
        self.assertIs(Example, ExampleSentence)
        legacy_ex = Example(japanese="猫", translation="cat")
        self.assertEqual(legacy_ex.japanese, "猫")
        self.assertEqual(legacy_ex.translation, "cat")
        self.assertIsNone(legacy_ex.reading)

    def test_pitch_accent_model(self):
        pitch = PitchAccent(
            reading="えいが",
            position=0,
            pattern_name="heiban",
            nasal_positions=[1],
            devoice_positions=[],
            dictionary="NHK",
        )
        self.assertEqual(pitch.reading, "えいが")
        self.assertEqual(pitch.position, 0)
        self.assertEqual(pitch.pattern_name, "heiban")
        self.assertEqual(pitch.nasal_positions, [1])
        self.assertEqual(pitch.devoice_positions, [])
        self.assertEqual(pitch.dictionary, "NHK")

    def test_frequency_rank_model(self):
        freq = FrequencyRank(
            dictionary="BCCWJ",
            frequency=450,
            display_value="450",
            rank=450,
            is_common=True,
        )
        self.assertEqual(freq.dictionary, "BCCWJ")
        self.assertEqual(freq.frequency, 450)
        self.assertEqual(freq.display_value, "450")
        self.assertEqual(freq.rank, 450)
        self.assertTrue(freq.is_common)

    def test_dictionary_sense_model_and_alias(self):
        ex = ExampleSentence(japanese="映画を見る", translation="watch a movie")
        sense = DictionarySense(
            index=1,
            glosses=["movie", "film"],
            parts_of_speech=["noun"],
            tags=["popular"],
            field_tags=["cinema"],
            notes=["Note: modern term"],
            examples=[ex],
        )
        self.assertEqual(sense.index, 1)
        self.assertEqual(sense.glosses, ["movie", "film"])
        self.assertEqual(sense.parts_of_speech, ["noun"])
        self.assertEqual(sense.tags, ["popular"])
        self.assertEqual(sense.field_tags, ["cinema"])
        self.assertEqual(sense.notes, ["Note: modern term"])
        self.assertEqual(len(sense.examples), 1)

        # Test backward-compatible alias
        self.assertIs(Sense, DictionarySense)
        legacy_sense = Sense(glosses=["cat"], tags=["animal"], notes=[], examples=[])
        self.assertEqual(legacy_sense.glosses, ["cat"])
        self.assertEqual(legacy_sense.parts_of_speech, [])

    def test_dictionary_entry_model(self):
        ex = ExampleSentence(japanese="映画を見る", translation="watch a movie")
        sense = DictionarySense(
            index=1,
            glosses=["movie", "film"],
            parts_of_speech=["noun"],
            tags=["★"],
            examples=[ex],
        )
        pitch = PitchAccent(reading="えいが", position=0, pattern_name="heiban", dictionary="NHK")
        freq = FrequencyRank(dictionary="BCCWJ", frequency=450, rank=450, is_common=True)

        entry = DictionaryEntry(
            dictionary="Jitendex.org [2026-08-11]",
            is_primary=True,
            term="映画",
            reading="えいが",
            parts_of_speech=["noun"],
            tags=["★"],
            senses=[sense],
            dictionary_alias="Jitendex",
            alt_terms=["映畫"],
            alt_readings=[],
            pitches=[pitch],
            frequencies=[freq],
            score=200,
        )
        self.assertEqual(entry.dictionary, "Jitendex.org [2026-08-11]")
        self.assertEqual(entry.dictionary_alias, "Jitendex")
        self.assertTrue(entry.is_primary)
        self.assertEqual(entry.term, "映画")
        self.assertEqual(entry.reading, "えいが")
        self.assertEqual(entry.alt_terms, ["映畫"])
        self.assertEqual(entry.parts_of_speech, ["noun"])
        self.assertEqual(len(entry.senses), 1)
        self.assertEqual(len(entry.pitches), 1)
        self.assertEqual(len(entry.frequencies), 1)
        self.assertEqual(entry.score, 200)

        # Test asdict serialization works cleanly
        data = asdict(entry)
        self.assertEqual(data["term"], "映画")
        self.assertEqual(data["pitches"][0]["position"], 0)
        self.assertEqual(data["frequencies"][0]["rank"], 450)

    def test_enriched_term_model(self):
        entry = DictionaryEntry(
            dictionary="Jitendex",
            is_primary=True,
            term="映画",
            reading="えいが",
        )
        enriched = EnrichedTerm(
            expression="映画",
            reading="えいが",
            source_text="映画を見ました",
            deinflected_text="映画",
            entries=[entry],
            dictionary_error=None,
            jlpt_level="N5",
        )
        self.assertEqual(enriched.expression, "映画")
        self.assertEqual(enriched.jlpt_level, "N5")
        self.assertEqual(len(enriched.entries), 1)
        self.assertIsNone(enriched.dictionary_error)


class TestYomitanASTNormalizer(unittest.TestCase):
    """Test AST normalizer in YomitanService across all linguistic and edge cases."""

    def test_1_normal_jitendex_structured_entry(self):
        sense1 = {
            "tag": "li",
            "data": {"content": "sense"},
            "content": [
                {"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "movie"}, {"tag": "li", "content": "film"}]},
                {
                    "tag": "div",
                    "data": {"content": "example-sentence"},
                    "content": [
                        {"tag": "span", "data": {"content": "example-sentence-a"}, "content": [{"tag": "ruby", "content": ["映", {"tag": "rt", "content": "えい"}]}, "画"]},
                        {"tag": "span", "data": {"content": "example-sentence-b"}, "content": "a movie"},
                    ],
                },
            ],
        }
        group = {
            "tag": "li",
            "data": {"content": "sense-group"},
            "content": [
                {"tag": "span", "data": {"content": "part-of-speech-info"}, "content": "noun"},
                {"tag": "ol", "content": [sense1]},
            ],
        }
        raw = {
            "dictionaryEntries": [
                {
                    "isPrimary": True,
                    "score": 200,
                    "headwords": [{"term": "映画", "reading": "えいが"}],
                    "definitions": [
                        {
                            "dictionary": "Jitendex.org [2026-08-11]",
                            "dictionaryAlias": "Jitendex",
                            "isPrimary": True,
                            "headwordIndices": [0],
                            "tags": [{"name": "★", "category": "popular"}],
                            "entries": [{"type": "structured-content", "content": [{"tag": "ul", "data": {"content": "sense-groups"}, "content": [group]}]}],
                        }
                    ],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry.dictionary, "Jitendex.org [2026-08-11]")
        self.assertEqual(entry.dictionary_alias, "Jitendex")
        self.assertTrue(entry.is_primary)
        self.assertEqual(entry.term, "映画")
        self.assertEqual(entry.reading, "えいが")
        self.assertEqual(entry.parts_of_speech, ["noun"])
        self.assertEqual(entry.tags, ["★"])
        self.assertEqual(len(entry.senses), 1)
        self.assertEqual(entry.senses[0].glosses, ["movie", "film"])
        self.assertEqual(entry.senses[0].parts_of_speech, ["noun"])
        self.assertEqual(len(entry.senses[0].examples), 1)
        self.assertEqual(entry.senses[0].examples[0].japanese, "映画")
        self.assertEqual(entry.senses[0].examples[0].translation, "a movie")

    def test_2_multiple_senses_preserved(self):
        s1 = {"tag": "li", "data": {"content": "sense"}, "content": [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "to hang"}]}]}
        s2 = {"tag": "li", "data": {"content": "sense"}, "content": [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "to put on (glasses)"}]}]}
        s3 = {"tag": "li", "data": {"content": "sense"}, "content": [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "to sit down"}]}]}
        raw = {
            "dictionaryEntries": [
                {
                    "isPrimary": True,
                    "headwords": [{"term": "掛ける", "reading": "かける"}],
                    "definitions": [
                        {
                            "dictionary": "Jitendex",
                            "entries": [
                                {
                                    "type": "structured-content",
                                    "content": [{"tag": "ul", "data": {"content": "sense-groups"}, "content": [{"tag": "li", "data": {"content": "sense-group"}, "content": [s1, s2, s3]}]}],
                                }
                            ],
                        }
                    ],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries[0].senses), 3)
        self.assertEqual(entries[0].senses[0].glosses, ["to hang"])
        self.assertEqual(entries[0].senses[1].glosses, ["to put on (glasses)"])
        self.assertEqual(entries[0].senses[2].glosses, ["to sit down"])
        self.assertEqual(entries[0].senses[0].index, 1)
        self.assertEqual(entries[0].senses[1].index, 2)
        self.assertEqual(entries[0].senses[2].index, 3)

    def test_3_pos_attached_to_different_senses(self):
        g1 = {
            "tag": "li",
            "data": {"content": "sense-group"},
            "content": [
                {"tag": "span", "data": {"content": "part-of-speech-info"}, "content": "transitive verb"},
                {"tag": "li", "data": {"content": "sense"}, "content": [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "to open"}]}]},
            ],
        }
        g2 = {
            "tag": "li",
            "data": {"content": "sense-group"},
            "content": [
                {"tag": "span", "data": {"content": "part-of-speech-info"}, "content": "intransitive verb"},
                {"tag": "li", "data": {"content": "sense"}, "content": [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "to become open"}]}]},
            ],
        }
        raw = {
            "dictionaryEntries": [
                {
                    "headwords": [{"term": "ひらく", "reading": "ひらく"}],
                    "definitions": [{"dictionary": "JMdict", "entries": [{"type": "structured-content", "content": [g1, g2]}]}],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries[0].senses), 2)
        self.assertEqual(entries[0].senses[0].parts_of_speech, ["transitive verb"])
        self.assertEqual(entries[0].senses[1].parts_of_speech, ["intransitive verb"])
        self.assertEqual(set(entries[0].parts_of_speech), {"transitive verb", "intransitive verb"})

    def test_4_multiple_dictionaries_and_is_primary(self):
        raw = {
            "dictionaryEntries": [
                {
                    "isPrimary": True,
                    "score": 100,
                    "headwords": [{"term": "猫", "reading": "ねこ"}],
                    "definitions": [{"dictionary": "Jitendex", "dictionaryAlias": "Jit", "isPrimary": True, "entries": ["cat; feline"]}],
                },
                {
                    "isPrimary": False,
                    "score": 50,
                    "headwords": [{"term": "猫", "reading": "ねこ"}],
                    "definitions": [{"dictionary": "Daijirin", "dictionaryAlias": "DJR", "isPrimary": False, "entries": ["ネコ科の食肉類。"]}],
                },
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0].dictionary, "Jitendex")
        self.assertEqual(entries[0].dictionary_alias, "Jit")
        self.assertTrue(entries[0].is_primary)
        self.assertEqual(entries[0].senses[0].glosses, ["cat; feline"])
        self.assertEqual(entries[1].dictionary, "Daijirin")
        self.assertEqual(entries[1].dictionary_alias, "DJR")
        self.assertFalse(entries[1].is_primary)
        self.assertEqual(entries[1].senses[0].glosses, ["ネコ科の食肉類。"])

    def test_5_pitch_accent_preservation(self):
        raw = {
            "dictionaryEntries": [
                {
                    "headwords": [{"term": "映画", "reading": "えいが"}],
                    "definitions": [{"dictionary": "Jitendex", "entries": ["movie"]}],
                    "pitches": [{"dictionary": "NHK", "reading": "えいが", "position": 0, "nasalPositions": [], "devoicePositions": []}],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries[0].pitches), 1)
        self.assertEqual(entries[0].pitches[0].dictionary, "NHK")
        self.assertEqual(entries[0].pitches[0].reading, "えいが")
        self.assertEqual(entries[0].pitches[0].position, 0)
        self.assertEqual(entries[0].pitches[0].pattern_name, "heiban")

    def test_6_pitch_accent_from_pronunciations_key(self):
        raw = {
            "dictionaryEntries": [
                {
                    "headwords": [{"term": "食べる", "reading": "たべる"}],
                    "definitions": [{"dictionary": "Jitendex", "entries": ["to eat"]}],
                    "pronunciations": [{"dictionary": "Shinmeikai", "reading": "たべる", "pitches": [{"position": 2}]}],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries[0].pitches), 1)
        self.assertEqual(entries[0].pitches[0].dictionary, "Shinmeikai")
        self.assertEqual(entries[0].pitches[0].position, 2)
        self.assertEqual(entries[0].pitches[0].pattern_name, "nakadaka")

    def test_7_frequency_rank_preservation(self):
        raw = {
            "dictionaryEntries": [
                {
                    "headwords": [{"term": "映画", "reading": "えいが"}],
                    "definitions": [{"dictionary": "Jitendex", "entries": ["movie"]}],
                    "frequencies": [
                        {"dictionary": "BCCWJ", "frequency": 420, "displayValue": "420", "rank": 420},
                        {"dictionary": "Innocent", "value": 310, "displayValue": "★ 310"},
                    ],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries[0].frequencies), 2)
        self.assertEqual(entries[0].frequencies[0].dictionary, "BCCWJ")
        self.assertEqual(entries[0].frequencies[0].rank, 420)
        self.assertEqual(entries[0].frequencies[1].dictionary, "Innocent")
        self.assertEqual(entries[0].frequencies[1].frequency, 310)
        self.assertEqual(entries[0].frequencies[1].display_value, "★ 310")

    def test_8_alt_terms_and_readings_extraction(self):
        raw = {
            "dictionaryEntries": [
                {
                    "headwords": [
                        {"term": "映画", "reading": "えいが"},
                        {"term": "映畫", "reading": "えいが"},
                        {"term": "映画", "reading": "えいか"},
                    ],
                    "definitions": [{"dictionary": "Jitendex", "headwordIndices": [0], "entries": ["movie"]}],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(entries[0].term, "映画")
        self.assertEqual(entries[0].reading, "えいが")
        self.assertEqual(entries[0].alt_terms, ["映畫"])
        self.assertEqual(entries[0].alt_readings, ["えいか"])

    def test_9_linguistic_tags_and_notes(self):
        sense = {
            "tag": "li",
            "data": {"content": "sense"},
            "content": [
                {"tag": "span", "data": {"content": "misc-info"}, "content": "usually kana"},
                {"tag": "span", "data": {"content": "field-info"}, "content": "computing"},
                {"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "file"}]},
                {"tag": "div", "data": {"content": "sense-note"}, "content": "Note: technical usage"},
            ],
        }
        raw = {
            "dictionaryEntries": [
                {
                    "headwords": [{"term": "ファイル", "reading": "ファイル"}],
                    "definitions": [{"dictionary": "Jitendex", "entries": [{"type": "structured-content", "content": [sense]}]}],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(entries[0].senses[0].tags, ["usually kana"])
        self.assertEqual(entries[0].senses[0].field_tags, ["computing"])
        self.assertEqual(entries[0].senses[0].notes, ["Note: technical usage"])

    def test_10_missing_optional_fields_safe(self):
        raw = {
            "dictionaryEntries": [
                {
                    "headwords": [{"term": "猫"}],
                    "definitions": [{"entries": []}],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].term, "猫")
        self.assertEqual(entries[0].reading, "")
        self.assertEqual(entries[0].senses, [])
        self.assertEqual(entries[0].pitches, [])
        self.assertEqual(entries[0].frequencies, [])

    def test_11_empty_definitions_payload(self):
        raw = {"dictionaryEntries": [{"headwords": [{"term": "猫"}], "definitions": []}]}
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(entries, [])

    def test_12_malformed_partial_ast(self):
        raw = {
            "dictionaryEntries": [
                {
                    "headwords": None,
                    "definitions": [{"dictionary": "Test", "entries": [{"type": "structured-content", "content": None}]}],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].term, "")
        self.assertEqual(entries[0].senses, [])

    def test_13_unknown_ast_nodes_stripped_safely(self):
        unknown_node = {
            "tag": "custom-canvas",
            "data": {"custom": "data"},
            "content": [
                {"tag": "svg", "content": "ignored graphical data"},
                {"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "clean definition"}]},
            ],
        }
        raw = {
            "dictionaryEntries": [
                {
                    "headwords": [{"term": "テスト", "reading": "テスト"}],
                    "definitions": [{"dictionary": "CustomDict", "entries": [{"type": "structured-content", "content": [unknown_node]}]}],
                }
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].senses[0].glosses, ["clean definition"])

    def test_14_excessive_recursion_depth_clamped(self):
        # Build 50-levels deep nested node
        node: dict = {"tag": "li", "content": "deep leaf definition"}
        for _ in range(50):
            node = {"tag": "div", "content": [node]}
        raw = {
            "dictionaryEntries": [
                {
                    "headwords": [{"term": "深い", "reading": "ふかい"}],
                    "definitions": [{"dictionary": "DeepDict", "entries": [{"type": "structured-content", "content": [node]}]}],
                }
            ]
        }
        # Must not raise RecursionError
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries), 1)

    def test_15_one_corrupted_entry_does_not_break_valid_entries(self):
        raw = {
            "dictionaryEntries": [
                {"broken": True, "definitions": "not a list"},  # Corrupted
                {
                    "isPrimary": True,
                    "headwords": [{"term": "本", "reading": "ほん"}],
                    "definitions": [{"dictionary": "GoodDict", "entries": ["book"]}],
                },
            ]
        }
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].term, "本")
        self.assertEqual(entries[0].senses[0].glosses, ["book"])

    def test_16_legacy_dictionary_response_test_payload_compatibility(self):
        sense = {
            "tag": "div",
            "data": {"content": "sense"},
            "content": [
                {"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "movie"}, {"tag": "li", "content": "film"}]},
                {
                    "tag": "div",
                    "data": {"content": "example-sentence"},
                    "content": [
                        {"tag": "span", "data": {"content": "example-sentence-a"}, "content": [{"tag": "ruby", "content": ["映", {"tag": "rt", "content": "えい"}]}, "画"]},
                        {"tag": "span", "data": {"content": "example-sentence-b"}, "content": "a movie"},
                    ],
                },
            ],
        }
        group = {"tag": "div", "data": {"content": "sense-group"}, "content": [{"tag": "span", "data": {"content": "part-of-speech-info"}, "content": "noun"}, sense]}
        definition = {
            "dictionary": "Jitendex.org [test]",
            "isPrimary": True,
            "headwordIndices": [0],
            "tags": [{"name": "★"}],
            "entries": [{"type": "structured-content", "content": [group]}],
        }
        raw = {"dictionaryEntries": [{"isPrimary": True, "headwords": [{"term": "映画", "reading": "えいが"}], "definitions": [definition]}]}
        entries = YomitanService.normalize_term_entries_response(raw)
        self.assertEqual(entries[0].dictionary, "Jitendex.org [test]")
        self.assertEqual(entries[0].parts_of_speech, ["noun"])
        self.assertEqual(entries[0].senses[0].glosses, ["movie", "film"])
        self.assertEqual(entries[0].senses[0].examples[0].japanese, "映画")
        self.assertEqual(entries[0].senses[0].examples[0].translation, "a movie")


class TestDictionarySchemas(unittest.TestCase):
    """Test Pydantic schemas in app.schemas for API model compatibility."""

    def test_schema_serialization_from_normalized_entry(self):
        from app.schemas import (
            CaptureResponse,
            DictionaryEntry as DictionaryEntrySchema,
            Example as ExampleSchema,
            FrequencyRank as FrequencyRankSchema,
            PitchAccent as PitchAccentSchema,
            Sense as SenseSchema,
        )

        ex = ExampleSentence(japanese="映画を見る", reading="えいがをみる", translation="watch a movie", source_dictionary="Jitendex")
        pitch = PitchAccent(reading="えいが", position=0, pattern_name="heiban", nasal_positions=[], devoice_positions=[], dictionary="NHK")
        freq = FrequencyRank(dictionary="BCCWJ", frequency=450, display_value="450", rank=450, is_common=True)
        sense = DictionarySense(
            index=1,
            glosses=["movie", "film"],
            parts_of_speech=["noun"],
            tags=["★"],
            field_tags=["cinema"],
            notes=["Note 1"],
            examples=[ex],
        )
        entry = DictionaryEntry(
            dictionary="Jitendex.org",
            dictionary_alias="Jitendex",
            is_primary=True,
            term="映画",
            reading="えいが",
            alt_terms=["映畫"],
            alt_readings=[],
            parts_of_speech=["noun"],
            tags=["★"],
            senses=[sense],
            pitches=[pitch],
            frequencies=[freq],
            score=200,
        )

        # Validate that asdict() serializes directly into Pydantic models
        entry_dict = asdict(entry)
        validated_entry = DictionaryEntrySchema(**entry_dict)
        self.assertEqual(validated_entry.dictionary, "Jitendex.org")
        self.assertEqual(validated_entry.dictionary_alias, "Jitendex")
        self.assertTrue(validated_entry.is_primary)
        self.assertEqual(validated_entry.alt_terms, ["映畫"])
        self.assertEqual(len(validated_entry.senses), 1)
        self.assertEqual(validated_entry.senses[0].parts_of_speech, ["noun"])
        self.assertEqual(validated_entry.senses[0].field_tags, ["cinema"])
        self.assertEqual(len(validated_entry.pitches), 1)
        self.assertEqual(validated_entry.pitches[0].position, 0)
        self.assertEqual(len(validated_entry.frequencies), 1)
        self.assertEqual(validated_entry.frequencies[0].rank, 450)

        # Validate CaptureResponse with jlpt_level and entries
        capture_data = {
            "expression": "映画",
            "reading": "えいが",
            "meaning": "movie",
            "entries": [entry_dict],
            "jlpt_level": "N5",
        }
        capture_resp = CaptureResponse(**capture_data)
        self.assertEqual(capture_resp.expression, "映画")
        self.assertEqual(capture_resp.jlpt_level, "N5")
        self.assertEqual(len(capture_resp.entries), 1)
        self.assertEqual(capture_resp.entries[0].senses[0].glosses, ["movie", "film"])

    def test_legacy_payload_compatibility_with_defaults(self):
        from app.schemas import CaptureResponse, DictionaryEntry as DictionaryEntrySchema

        # Legacy payload missing new fields
        legacy_entry = {
            "dictionary": "Jitendex",
            "is_primary": True,
            "term": "猫",
            "reading": "ねこ",
            "parts_of_speech": ["noun"],
            "tags": [],
            "senses": [{"glosses": ["cat"], "tags": [], "notes": [], "examples": []}],
        }
        validated = DictionaryEntrySchema(**legacy_entry)
        self.assertIsNone(validated.dictionary_alias)
        self.assertEqual(validated.alt_terms, [])
        self.assertEqual(validated.alt_readings, [])
        self.assertEqual(validated.pitches, [])
        self.assertEqual(validated.frequencies, [])
        self.assertEqual(validated.score, 0)
        self.assertEqual(validated.senses[0].parts_of_speech, [])
        self.assertEqual(validated.senses[0].field_tags, [])
        self.assertEqual(validated.senses[0].index, 1)

        # Legacy CaptureResponse missing jlpt_level
        legacy_capture = {
            "expression": "猫",
            "reading": "ねこ",
            "meaning": "cat",
        }
        cap = CaptureResponse(**legacy_capture)
        self.assertIsNone(cap.jlpt_level)


class TestCrossReferenceModelParity(unittest.TestCase):
    """Verify 100% field parity and serialization between domain and schema CrossReference."""

    def test_cross_reference_domain_and_schema_parity(self):
        from app.schemas import CrossReference as CrossReferenceSchema
        from app.services.yomitan import CrossReference as CrossReferenceDomain

        domain_xref = CrossReferenceDomain(
            target_term="衝",
            display_text="See also 衝 ③ opposition",
            target_reading="しょう",
            target_sense_index=None,
        )

        # asdict must produce clean dict matching schema fields
        serialized = asdict(domain_xref)
        self.assertEqual(
            serialized,
            {
                "target_term": "衝",
                "display_text": "See also 衝 ③ opposition",
                "target_reading": "しょう",
                "target_sense_index": None,
            },
        )

        # Pydantic schema must ingest serialized domain model without error
        schema_xref = CrossReferenceSchema(**serialized)
        self.assertEqual(schema_xref.target_term, domain_xref.target_term)
        self.assertEqual(schema_xref.display_text, domain_xref.display_text)
        self.assertEqual(schema_xref.target_reading, domain_xref.target_reading)
        self.assertEqual(schema_xref.target_sense_index, domain_xref.target_sense_index)

        # Verify field names match exactly to prevent model drift
        domain_fields = set(CrossReferenceDomain.__dataclass_fields__.keys())
        schema_fields = set(CrossReferenceSchema.model_fields.keys())
        self.assertEqual(domain_fields, schema_fields)


if __name__ == "__main__":
    unittest.main()
