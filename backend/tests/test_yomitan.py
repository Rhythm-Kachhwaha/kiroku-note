import http.client
import unittest
from unittest.mock import patch

from app.services.yomitan import YomitanResponseError, YomitanService, YomitanUnavailableError


class YomitanNormalizationTests(unittest.TestCase):
    def test_uses_dictionary_headword_and_deinflection_not_fragment(self):
        payload=[{"content":[[{"text":"見","reading":"み","headwords":[[{"term":"見る","reading":"みる","sources":[{"originalText":"見た","deinflectedText":"見る"}]}]]}]]}]
        term=YomitanService.normalize_tokenize_response(payload,"見た")
        self.assertEqual((term.expression,term.reading,term.source_text,term.deinflected_text),("見る","みる","見た","見る"))

    def test_supports_hiragana_katakana_and_kanji_tokens(self):
        for text in ("映画","こんにちは","カメラ"):
            payload=[{"content":[[{"text":text,"reading":"","headwords":[[{"term":text,"reading":text,"sources":[{"originalText":text,"deinflectedText":text}]}]]}]]}]
            self.assertEqual(YomitanService.normalize_tokenize_response(payload,text).expression,text)

    def test_ignores_punctuation_tokens_and_extracts_headword(self):
        payload = [{"content": [[
            {"text": "「", "reading": ""},
            {"text": "映画", "reading": "えいが", "headwords": [[{"term": "映画", "reading": "えいが", "sources": [{"originalText": "映画", "deinflectedText": "映画"}]}]]},
            {"text": "」", "reading": ""}
        ]]}]
        term = YomitanService.normalize_tokenize_response(payload, "「映画」")
        self.assertEqual((term.expression, term.reading), ("映画", "えいが"))

    def test_rejects_empty_or_malformed_responses(self):
        for payload in ([],{},[{"content":[[]]}],[{"content":[[{"reading":"えいが"}]]}]):
            with self.subTest(payload=payload):
                with self.assertRaises(YomitanResponseError): YomitanService.normalize_tokenize_response(payload)

    def test_remote_disconnected_raises_unavailable_not_500(self):
        """RemoteDisconnected (OSError, not URLError) must not escape as a bare exception."""
        service = YomitanService()
        with patch("app.services.yomitan.urlopen", side_effect=http.client.RemoteDisconnected("closed")):
            with self.assertRaises(YomitanUnavailableError):
                service._post_json("/tokenize", {"text": "映画"})


class YomitanCrossReferenceTests(unittest.TestCase):
    """Test cross-reference extraction from Yomitan AST using real Jitendex AST shape."""

    def test_extracts_structured_cross_reference_and_preserves_plain_notes(self):
        raw_payload = {
            "dictionaryEntries": [
                {
                    "isPrimary": True,
                    "score": 0,
                    "headwords": [{"term": "合", "reading": "ごう"}],
                    "definitions": [
                        {
                            "dictionary": "Jitendex.org [2026-08-11]",
                            "entries": [
                                {
                                    "type": "structured-content",
                                    "content": [
                                        {
                                            "tag": "ul",
                                            "data": {"content": "sense-groups"},
                                            "content": [
                                                {
                                                    "tag": "li",
                                                    "data": {"content": "sense-group"},
                                                    "content": [
                                                        {
                                                            "tag": "span",
                                                            "data": {"content": "part-of-speech-info"},
                                                            "content": "noun",
                                                        },
                                                        {
                                                            "tag": "ol",
                                                            "data": {"content": "senses"},
                                                            "content": [
                                                                {
                                                                    "tag": "li",
                                                                    "data": {"content": "sense"},
                                                                    "content": [
                                                                        {
                                                                            "tag": "span",
                                                                            "data": {"content": "glossary"},
                                                                            "content": "opposition (astronomy)",
                                                                        },
                                                                        {
                                                                            "tag": "span",
                                                                            "data": {"content": "note"},
                                                                            "content": "also written as 間",
                                                                        },
                                                                        {
                                                                            "tag": "div",
                                                                            "data": {"class": "extra-box", "content": "xref"},
                                                                            "content": [
                                                                                {
                                                                                    "tag": "div",
                                                                                    "data": {"content": "xref-content"},
                                                                                    "content": [
                                                                                        {
                                                                                            "tag": "span",
                                                                                            "lang": "en",
                                                                                            "data": {"content": "reference-label"},
                                                                                            "content": "See also",
                                                                                        },
                                                                                        {
                                                                                            "tag": "a",
                                                                                            "lang": "ja",
                                                                                            "href": "?query=%E8%A1%9D&wildcards=off&primary_reading=%E3%81%97%E3%82%87%E3%81%86",
                                                                                            "content": {
                                                                                                "tag": "ruby",
                                                                                                "content": [
                                                                                                    "衝",
                                                                                                    {"tag": "rt", "content": "しょう"},
                                                                                                ],
                                                                                            },
                                                                                        },
                                                                                    ],
                                                                                },
                                                                                {
                                                                                    "tag": "div",
                                                                                    "data": {"content": "xref-glossary"},
                                                                                    "content": "③ opposition",
                                                                                },
                                                                            ],
                                                                        },
                                                                    ],
                                                                }
                                                            ],
                                                        },
                                                    ],
                                                }
                                            ],
                                        }
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ]
        }

        entries = YomitanService.normalize_term_entries_response(raw_payload)
        self.assertEqual(len(entries), 1)
        sense = entries[0].senses[0]

        # Senses must have structured cross_references
        self.assertTrue(hasattr(sense, "cross_references"))
        self.assertEqual(len(sense.cross_references), 1)
        xref = sense.cross_references[0]
        self.assertEqual(xref.target_term, "衝")
        self.assertEqual(xref.target_reading, "しょう")
        self.assertIsNone(xref.target_sense_index)
        self.assertEqual(xref.display_text, "See also 衝 ③ opposition")

        # notes must contain ONLY genuine non-reference notes
        self.assertEqual(sense.notes, ["also written as 間"])
        # notes must NOT contain xref fragments
        for frag in ("See also", "See also衝", "③ opposition", "See also 衝 ③ opposition"):
            self.assertNotIn(frag, sense.notes)

