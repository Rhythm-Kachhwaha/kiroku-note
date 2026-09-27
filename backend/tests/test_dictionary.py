import unittest
from app.services.yomitan import IdentifiedTerm, YomitanService

class DictionaryResponseTests(unittest.TestCase):
    def payload(self):
        sense={"tag":"div","data":{"content":"sense"},"content":[
            {"tag":"ul","data":{"content":"glossary"},"content":[{"tag":"li","content":"movie"},{"tag":"li","content":"film"}]},
            {"tag":"div","data":{"content":"example-sentence"},"content":[
                {"tag":"span","data":{"content":"example-sentence-a"},"content":[{"tag":"ruby","content":["映",{"tag":"rt","content":"えい"}]},"画"]},
                {"tag":"span","data":{"content":"example-sentence-b"},"content":"a movie"}]}]}
        group={"tag":"div","data":{"content":"sense-group"},"content":[{"tag":"span","data":{"content":"part-of-speech-info"},"content":"noun"},sense]}
        definition={"dictionary":"Jitendex.org [test]","isPrimary":True,"headwordIndices":[0],"tags":[{"name":"★"}],"entries":[{"type":"structured-content","content":[group]}]}
        return {"dictionaryEntries":[{"isPrimary":True,"headwords":[{"term":"映画","reading":"えいが"}],"definitions":[definition]}]}

    def test_preserves_entry_sense_pos_and_ruby_example(self):
        entries=YomitanService.normalize_term_entries_response(self.payload())
        self.assertEqual(entries[0].dictionary,"Jitendex.org [test]")
        self.assertEqual(entries[0].parts_of_speech,["noun"])
        self.assertEqual(entries[0].senses[0].glosses,["movie","film"])
        self.assertEqual((entries[0].senses[0].examples[0].japanese,entries[0].senses[0].examples[0].translation),("映画","a movie"))

    def test_missing_definitions_and_malformed_payloads_are_safe(self):
        self.assertEqual(YomitanService.normalize_term_entries_response({"dictionaryEntries":[{}]}),[])
        with self.assertRaises(Exception): YomitanService.normalize_term_entries_response({})

    def test_term_entries_request_uses_normalized_term(self):
        service=YomitanService(); calls=[]
        service._post_json=lambda path,body:calls.append((path,body)) or ({"dictionaryEntries":[]} if path == "/termEntries" else [])
        service.enrich(IdentifiedTerm("見る","みる","見た","見る"))
        self.assertEqual(calls,[("/termEntries",{"term":"見る"}),("/kanjiEntries",{"character":"見る"})])

    def test_term_entries_request_uses_kana_reading_for_kana_queries(self):
        service = YomitanService(); calls = []
        sample_res = {"dictionaryEntries": [{"headwords": [{"term": "地震", "reading": "じしん"}], "definitions": [{"dictionary": "Test", "entries": []}]}]}
        service._post_json = lambda path, body: calls.append((path, body)) or (sample_res if path == "/termEntries" else [])
        service.enrich(IdentifiedTerm("地震", "じしん", "じしん", "じしん"))
        self.assertEqual(calls, [("/termEntries", {"term": "じしん"}), ("/kanjiEntries", {"character": "地震"})])

    def test_term_entries_falls_back_to_expression_if_kana_lookup_empty(self):
        service = YomitanService(); calls = []
        service._post_json = lambda path, body: calls.append((path, body)) or ({"dictionaryEntries": []} if path == "/termEntries" else [])
        service.enrich(IdentifiedTerm("地震", "じしん", "じしん", "じしん"))
        self.assertEqual(calls, [("/termEntries", {"term": "じしん"}), ("/termEntries", {"term": "地震"}), ("/kanjiEntries", {"character": "地震"})])

    def test_enrich_preserves_multiple_same_reading_candidates(self):
        service = YomitanService()
        sample_payload = {
            "dictionaryEntries": [
                {
                    "isPrimary": True,
                    "headwords": [{"term": "地震", "reading": "じしん"}],
                    "definitions": [{
                        "dictionary": "Jitendex.org [test]",
                        "entries": [{"type": "structured-content", "content": [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "earthquake"}]}]}]
                    }]
                },
                {
                    "isPrimary": True,
                    "headwords": [{"term": "自信", "reading": "じしん"}],
                    "definitions": [{
                        "dictionary": "Jitendex.org [test]",
                        "entries": [{"type": "structured-content", "content": [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "self-confidence"}]}]}]
                    }]
                },
                {
                    "isPrimary": True,
                    "headwords": [{"term": "自身", "reading": "じしん"}],
                    "definitions": [{
                        "dictionary": "Jitendex.org [test]",
                        "entries": [{"type": "structured-content", "content": [{"tag": "ul", "data": {"content": "glossary"}, "content": [{"tag": "li", "content": "oneself"}]}]}]
                    }]
                },
            ]
        }
        service._post_json = lambda path, body: sample_payload if path == "/termEntries" else []
        enriched = service.enrich(IdentifiedTerm("地震", "じしん", "じしん", "じしん"))
        terms = [e.term for e in enriched.entries]
        self.assertEqual(terms, ["地震", "自信", "自身"])
        readings = [e.reading for e in enriched.entries]
        self.assertEqual(readings, ["じしん", "じしん", "じしん"])


