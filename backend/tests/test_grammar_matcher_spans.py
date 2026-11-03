import re

from app.services.grammar_matcher import GrammarMatcher


class _Reference:
    def __init__(self, points):
        self.points = points

    def get_points(self):
        return self.points


def _point(key, pattern, **matcher):
    return {
        "pattern_key": key,
        "pattern_display": key,
        "meaning_short": key,
        "matcher": {"type": "regex", "regex": pattern, **matcher},
    }


def test_inflection_regex_builder_compiles_every_supported_form():
    matcher = GrammarMatcher(_Reference([]))
    for required_form in ("て", "た", "ない", "ます-stem", "dictionary", "plain"):
        regex = matcher._inflection_regex(
            {"inflection": {"required_form": required_form, "suffix": "いる"}}
        )
        assert regex is not None
        re.compile(regex)


def test_tokenized_spans_start_at_the_predicate_and_keep_match_end():
    cases = [
        (
            "友達と公園に行っている",
            [
                {"text": "友達", "pos": "noun"},
                {"text": "と", "pos": "particle"},
                {"text": "公園", "pos": "noun"},
                {"text": "に", "pos": "particle"},
                {"text": "行っ", "pos": "verb"},
                {"text": "ている", "pos": "auxiliary"},
            ],
            _point("ている", "ている"),
            (6, 11),
        ),
        (
            "寿司を食べたい",
            [
                {"text": "寿司", "pos": "noun"},
                {"text": "を", "pos": "particle"},
                {"text": "食べ", "pos": "verb"},
                {"text": "たい", "pos": "auxiliary"},
            ],
            _point("たい", "たい"),
            (3, 7),
        ),
        (
            "私は日本語を勉強している",
            [
                {"text": "私", "pos": "noun"},
                {"text": "は", "pos": "particle"},
                {"text": "日本語", "pos": "noun"},
                {"text": "を", "pos": "particle"},
                {"text": "勉強", "pos": "noun"},
                {"text": "し", "pos": "verb", "base_form": "する"},
                {"text": "ている", "pos": "auxiliary"},
            ],
            _point("ている", "ている"),
            (6, 12),
        ),
        (
            "ここに名前を書いてください",
            [
                {"text": "ここに", "pos": "noun"},
                {"text": "名前", "pos": "noun"},
                {"text": "を", "pos": "particle"},
                {"text": "書い", "pos": "verb"},
                {"text": "て", "pos": "auxiliary"},
                {"text": "ください", "pos": "verb"},
            ],
            _point("ここ", "ここ"),
            None,
        ),
        (
            "毎日運動するようにしている",
            [
                {"text": "毎日", "pos": "noun"},
                {"text": "運動", "pos": "noun"},
                {"text": "する", "pos": "verb", "base_form": "する"},
                {"text": "ように", "pos": "particle"},
                {"text": "し", "pos": "verb", "base_form": "する"},
                {"text": "ている", "pos": "auxiliary"},
            ],
            _point("ようにしている", "ようにしている"),
            (2, 13),
        ),
        (
            "食べなければならない",
            [
                {"text": "食べ", "pos": "verb"},
                {"text": "なければ", "pos": "auxiliary"},
                {"text": "ならない", "pos": "auxiliary"},
            ],
            _point("なければならない", "なければならない"),
            (0, 10),
        ),
    ]

    for sentence, tokens, point, expected in cases:
        spans = GrammarMatcher(_Reference([point])).match_sentence(tokens, sentence)
        if expected is None:
            assert spans == []
            continue
        assert [(span.start, span.end) for span in spans] == [expected]
        assert spans[0].end == expected[1]
        assert not any(
            token["text"] in {"は", "を", "に", "で", "と", "が", "も"}
            and spans[0].start < token_start + len(token["text"])
            and token_start < spans[0].end
            for token, token_start in (
                (token, sum(len(item["text"]) for item in tokens[:index]))
                for index, token in enumerate(tokens)
            )
        )
