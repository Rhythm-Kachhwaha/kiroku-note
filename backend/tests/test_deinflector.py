"""
test_deinflector.py -- Comprehensive table-driven tests for kiroku_dictionary deinflector.

Verifies at least 150 input -> (dictionary form, rule, reason) cases across ichidan, godan,
suru/kuru irregulars, adjectives, contractions, and negative control cases.
"""
from pathlib import Path
import sys
import unittest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from kiroku_dictionary.deinflect import DeinflectionCandidate, deinflect


class DeinflectorTests(unittest.TestCase):
    # Table-driven test cases: (input_form, expected_dict_form, expected_rule, expected_reason_keyword)
    CASES: list[tuple[str, str, str, str]] = [
        # --- 1. Ichidan Verbs (食べる) ---
        ("食べます", "食べる", "v1", "polite"),
        ("食べました", "食べる", "v1", "polite-past"),
        ("食べません", "食べる", "v1", "polite-negative"),
        ("食べませんでした", "食べる", "v1", "polite-negative-past"),
        ("食べましょう", "食べる", "v1", "polite-volitional"),
        ("食べた", "食べる", "v1", "past"),
        ("食べて", "食べる", "v1", "te-form"),
        ("食べない", "食べる", "v1", "negative"),
        ("食べなかった", "食べる", "v1", "past"),
        ("食べなくて", "食べる", "v1", "te-form"),
        ("食べなければ", "食べる", "v1", "conditional"),
        ("食べず", "食べる", "v1", "negative"),
        ("食べずに", "食べる", "v1", "negative"),
        ("食べられる", "食べる", "v1", "passive-or-potential"),
        ("食べれる", "食べる", "v1", "potential"),
        ("食べさせる", "食べる", "v1", "causative"),
        ("食べさせられる", "食べる", "v1", "causative-passive"),
        ("食べよう", "食べる", "v1", "volitional"),
        ("食べろ", "食べる", "v1", "imperative"),
        ("食べよ", "食べる", "v1", "imperative"),
        ("食べれば", "食べる", "v1", "conditional"),
        ("食べたら", "食べる", "v1", "conditional"),
        ("食べたい", "食べる", "v1", "desire"),
        ("食べそう", "食べる", "v1", "conjectural"),
        ("食べすぎる", "食べる", "v1", "excess"),
        ("食べちゃう", "食べる", "v1", "contraction-chau"),
        ("食べちゃった", "食べる", "v1", "contraction-chau-past"),
        ("食べてる", "食べる", "v1", "contraction-teru"),
        ("食べてた", "食べる", "v1", "contraction-teru-past"),
        ("食べとく", "食べる", "v1", "contraction-toku"),

        # --- 2. Ichidan Verbs (見る, 起きる, 答える) ---
        ("見ます", "見る", "v1", "polite"),
        ("見た", "見る", "v1", "past"),
        ("見て", "見る", "v1", "te-form"),
        ("見ない", "見る", "v1", "negative"),
        ("見られる", "見る", "v1", "passive-or-potential"),
        ("見たい", "見る", "v1", "desire"),
        ("起きます", "起きる", "v1", "polite"),
        ("起きた", "起きる", "v1", "past"),
        ("起きない", "起きる", "v1", "negative"),
        ("起きれば", "起きる", "v1", "conditional"),
        ("答えます", "答える", "v1", "polite"),
        ("答えた", "答える", "v1", "past"),
        ("答えない", "答える", "v1", "negative"),

        # --- 3. Godan ku (書く, 聞く, 働く) ---
        ("書きます", "書く", "v5", "polite"),
        ("書きました", "書く", "v5", "polite-past"),
        ("書きません", "書く", "v5", "polite-negative"),
        ("書かない", "書く", "v5", "negative"),
        ("書かなかった", "書く", "v5", "past"),
        ("書いて", "書く", "v5", "te-form"),
        ("書いた", "書く", "v5", "past"),
        ("書ける", "書く", "v5", "potential"),
        ("書かれる", "書く", "v5", "passive"),
        ("書かせる", "書く", "v5", "causative"),
        ("書かせられる", "書く", "v5", "causative-passive"),
        ("書こう", "書く", "v5", "volitional"),
        ("書け", "書く", "v5", "imperative"),
        ("書けば", "書く", "v5", "conditional"),
        ("書いたら", "書く", "v5", "conditional"),
        ("書きたい", "書く", "v5", "desire"),
        ("書きそう", "書く", "v5", "conjectural"),
        ("書きすぎる", "書く", "v5", "excess"),
        ("書いてる", "書く", "v5", "contraction-teru"),
        ("書いちゃう", "書く", "v5", "contraction-chau"),
        ("聞きます", "聞く", "v5", "polite"),
        ("聞いて", "聞く", "v5", "te-form"),
        ("聞いた", "聞く", "v5", "past"),
        ("働いた", "働く", "v5", "past"),
        ("働かない", "働く", "v5", "negative"),

        # --- 4. Godan Special ku (行く / いく) ---
        ("行きます", "行く", "v5", "polite"),
        ("行かない", "行く", "v5", "negative"),
        ("行って", "行く", "v5", "te-form"),
        ("行った", "行く", "v5", "past"),
        ("行ける", "行く", "v5", "potential"),
        ("行こう", "行く", "v5", "volitional"),
        ("行けば", "行く", "v5", "conditional"),
        ("いって", "いく", "v5", "te-form"),
        ("いった", "いく", "v5", "past"),

        # --- 5. Godan gu (泳ぐ, 急ぐ) ---
        ("泳ぎます", "泳ぐ", "v5", "polite"),
        ("泳がない", "泳ぐ", "v5", "negative"),
        ("泳いで", "泳ぐ", "v5", "te-form"),
        ("泳いだ", "泳ぐ", "v5", "past"),
        ("泳げる", "泳ぐ", "v5", "potential"),
        ("泳がれる", "泳ぐ", "v5", "passive"),
        ("泳がせる", "泳ぐ", "v5", "causative"),
        ("泳ごう", "泳ぐ", "v5", "volitional"),
        ("泳げ", "泳ぐ", "v5", "imperative"),
        ("泳げば", "泳ぐ", "v5", "conditional"),
        ("泳いだら", "泳ぐ", "v5", "conditional"),
        ("泳ぎたい", "泳ぐ", "v5", "desire"),
        ("泳いでる", "泳ぐ", "v5", "contraction-deru"),
        ("急いだ", "急ぐ", "v5", "past"),
        ("急いで", "急ぐ", "v5", "te-form"),

        # --- 6. Godan su (話す, 出す) ---
        ("話します", "話す", "v5", "polite"),
        ("話さない", "話す", "v5", "negative"),
        ("話して", "話す", "v5", "te-form"),
        ("話した", "話す", "v5", "past"),
        ("話せる", "話す", "v5", "potential"),
        ("話される", "話す", "v5", "passive"),
        ("話させる", "話す", "v5", "causative"),
        ("話そう", "話す", "v5", "volitional"),
        ("話せ", "話す", "v5", "imperative"),
        ("話せば", "話す", "v5", "conditional"),
        ("話したら", "話す", "v5", "conditional"),
        ("話したい", "話す", "v5", "desire"),
        ("話してる", "話す", "v5", "contraction-teru"),
        ("出した", "出す", "v5", "past"),
        ("出して", "出す", "v5", "te-form"),

        # --- 7. Godan tsu (待つ, 立つ) ---
        ("待ちます", "待つ", "v5", "polite"),
        ("待たない", "待つ", "v5", "negative"),
        ("待って", "待つ", "v5", "te-form"),
        ("待った", "待つ", "v5", "past"),
        ("待てる", "待つ", "v5", "potential"),
        ("待たれる", "待つ", "v5", "passive"),
        ("待たせる", "待つ", "v5", "causative"),
        ("待とう", "待つ", "v5", "volitional"),
        ("待て", "待つ", "v5", "imperative"),
        ("待てば", "待つ", "v5", "conditional"),
        ("待ったら", "待つ", "v5", "conditional"),
        ("待ちたい", "待つ", "v5", "desire"),
        ("待ってる", "待つ", "v5", "contraction-teru"),
        ("立った", "立つ", "v5", "past"),
        ("立って", "立つ", "v5", "te-form"),

        # --- 8. Godan nu (死ぬ) ---
        ("死にます", "死ぬ", "v5", "polite"),
        ("死なない", "死ぬ", "v5", "negative"),
        ("死んで", "死ぬ", "v5", "te-form"),
        ("死んだ", "死ぬ", "v5", "past"),
        ("死ねる", "死ぬ", "v5", "potential"),
        ("死のう", "死ぬ", "v5", "volitional"),
        ("死ねば", "死ぬ", "v5", "conditional"),
        ("死んだら", "死ぬ", "v5", "conditional"),
        ("死にたい", "死ぬ", "v5", "desire"),
        ("死んでる", "死ぬ", "v5", "contraction-deru"),

        # --- 9. Godan bu (呼ぶ, 遊ぶ) ---
        ("呼びます", "呼ぶ", "v5", "polite"),
        ("呼ばない", "呼ぶ", "v5", "negative"),
        ("呼んで", "呼ぶ", "v5", "te-form"),
        ("呼んだ", "呼ぶ", "v5", "past"),
        ("呼べる", "呼ぶ", "v5", "potential"),
        ("呼ばれる", "呼ぶ", "v5", "passive"),
        ("呼ばせる", "呼ぶ", "v5", "causative"),
        ("呼ぼう", "呼ぶ", "v5", "volitional"),
        ("呼べば", "呼ぶ", "v5", "conditional"),
        ("呼んだら", "呼ぶ", "v5", "conditional"),
        ("呼びたい", "呼ぶ", "v5", "desire"),
        ("呼んでる", "呼ぶ", "v5", "contraction-deru"),
        ("遊んだ", "遊ぶ", "v5", "past"),
        ("遊んで", "遊ぶ", "v5", "te-form"),

        # --- 10. Godan mu (飲む, 読む) ---
        ("飲みます", "飲む", "v5", "polite"),
        ("飲まない", "飲む", "v5", "negative"),
        ("飲んで", "飲む", "v5", "te-form"),
        ("飲んだ", "飲む", "v5", "past"),
        ("飲める", "飲む", "v5", "potential"),
        ("飲まれる", "飲む", "v5", "passive"),
        ("飲ませる", "飲む", "v5", "causative"),
        ("飲もう", "飲む", "v5", "volitional"),
        ("飲めば", "飲む", "v5", "conditional"),
        ("飲んだら", "飲む", "v5", "conditional"),
        ("飲みたい", "飲む", "v5", "desire"),
        ("飲んでる", "飲む", "v5", "contraction-deru"),
        ("飲んじゃう", "飲む", "v5", "contraction-jau"),
        ("読んだ", "読む", "v5", "past"),
        ("読んで", "読む", "v5", "te-form"),

        # --- 11. Godan ru (走る, 帰る, 取る) ---
        ("走ります", "走る", "v5", "polite"),
        ("走らない", "走る", "v5", "negative"),
        ("走って", "走る", "v5", "te-form"),
        ("走った", "走る", "v5", "past"),
        ("走れる", "走る", "v5", "potential"),
        ("走られる", "走る", "v5", "passive"),
        ("走らせる", "走る", "v5", "causative"),
        ("走ろう", "走る", "v5", "volitional"),
        ("走れば", "走る", "v5", "conditional"),
        ("走ったら", "走る", "v5", "conditional"),
        ("走りたい", "走る", "v5", "desire"),
        ("走ってる", "走る", "v5", "contraction-teru"),
        ("帰った", "帰る", "v5", "past"),
        ("帰って", "帰る", "v5", "te-form"),
        ("取った", "取る", "v5", "past"),

        # --- 12. Godan u (買う, 使う, 言う) ---
        ("買います", "買う", "v5", "polite"),
        ("買わない", "買う", "v5", "negative"),
        ("買って", "買う", "v5", "te-form"),
        ("買った", "買う", "v5", "past"),
        ("買える", "買う", "v5", "potential"),
        ("買われる", "買う", "v5", "passive"),
        ("買わせる", "買う", "v5", "causative"),
        ("買おう", "買う", "v5", "volitional"),
        ("買えば", "買う", "v5", "conditional"),
        ("買ったら", "買う", "v5", "conditional"),
        ("買いたい", "買う", "v5", "desire"),
        ("買ってる", "買う", "v5", "contraction-teru"),
        ("使った", "使う", "v5", "past"),
        ("使って", "使う", "v5", "te-form"),

        # --- 13. Suru (する) ---
        ("します", "する", "vs", "polite"),
        ("しました", "する", "vs", "polite-past"),
        ("しません", "する", "vs", "polite-negative"),
        ("しない", "する", "vs", "negative"),
        ("して", "する", "vs", "te-form"),
        ("した", "する", "vs", "past"),
        ("される", "する", "vs", "passive"),
        ("させる", "する", "vs", "causative"),
        ("させられる", "する", "vs", "causative-passive"),
        ("しよう", "する", "vs", "volitional"),
        ("しろ", "する", "vs", "imperative"),
        ("せよ", "する", "vs", "imperative"),
        ("すれば", "する", "vs", "conditional"),
        ("したら", "する", "vs", "conditional"),
        ("したい", "する", "vs", "desire"),
        ("してる", "する", "vs", "contraction-teru"),

        # --- 14. Kuru (くる / 来る) ---
        ("きます", "くる", "vk", "polite"),
        ("きました", "くる", "vk", "polite-past"),
        ("こない", "くる", "vk", "negative"),
        ("きて", "くる", "vk", "te-form"),
        ("きた", "くる", "vk", "past"),
        ("こられる", "くる", "vk", "passive-or-potential"),
        ("こよう", "くる", "vk", "volitional"),
        ("こい", "くる", "vk", "imperative"),
        ("くれば", "くる", "vk", "conditional"),
        ("きたら", "くる", "vk", "conditional"),
        ("きたい", "くる", "vk", "desire"),
        ("来ます", "来る", "vk", "polite"),
        ("来ない", "来る", "vk", "negative"),
        ("来て", "来る", "vk", "te-form"),
        ("来た", "来る", "vk", "past"),
        ("来られる", "来る", "vk", "passive-or-potential"),

        # --- 15. I-Adjectives (高い, 美しい) ---
        ("高くない", "高い", "adj-i", "negative"),
        ("高くなかった", "高い", "adj-i", "past"),
        ("高くて", "高い", "adj-i", "te-form"),
        ("高ければ", "高い", "adj-i", "conditional"),
        ("高かった", "高い", "adj-i", "past"),
        ("高かったら", "高い", "adj-i", "conditional"),
        ("高そう", "高い", "adj-i", "conjectural"),
        ("高さ", "高い", "adj-i", "nominalization"),
        ("高すぎる", "高い", "adj-i", "excess"),
        ("美しくない", "美しい", "adj-i", "negative"),
        ("美しかった", "美しい", "adj-i", "past"),
        ("美しくて", "美しい", "adj-i", "te-form"),

        # --- 16. Irregulars: いい / よい, ある ---
        ("よくない", "いい", "adj-i", "negative"),
        ("よかった", "いい", "adj-i", "past"),
        ("よければ", "いい", "adj-i", "conditional"),
        ("よくて", "いい", "adj-i", "te-form"),
        ("よさそう", "いい", "adj-i", "conjectural"),
        ("よさ", "いい", "adj-i", "nominalization"),
        ("良かった", "良い", "adj-i", "past"),
        ("良くない", "良い", "adj-i", "negative"),
        ("ない", "ある", "v5", "negative"),
        ("なかった", "ある", "v5", "past"),
    ]

    def test_case_count_exceeds_150(self):
        """Ensure test suite satisfies the 'at least 150 cases' requirement."""
        self.assertGreaterEqual(len(self.CASES), 150)

    def test_table_driven_deinflections(self):
        """Run all table-driven positive deinflection cases."""
        for surface, expected_term, expected_rule, expected_keyword in self.CASES:
            with self.subTest(surface=surface, expected_term=expected_term):
                candidates = deinflect(surface)
                matching = [c for c in candidates if c.term == expected_term and c.rule == expected_rule]
                self.assertTrue(
                    len(matching) > 0,
                    f"Failed to deinflect '{surface}' -> ('{expected_term}', '{expected_rule}'). Candidates found: {[(c.term, c.rule) for c in candidates]}",
                )
                cand = matching[0]
                if expected_keyword:
                    self.assertTrue(
                        any(expected_keyword in r for r in cand.reasons),
                        f"Expected reason '{expected_keyword}' not found in candidate reasons: {cand.reasons}",
                    )

    def test_negative_controls_not_matching_rules(self):
        """Negative controls: nouns and non-inflected words must not match verb rules."""
        nouns = ["猫", "犬", "本", "車", "机", "東京", "日本", "友達"]
        for noun in nouns:
            with self.subTest(noun=noun):
                candidates = deinflect(noun)
                # Should contain original word with rule "all"
                self.assertEqual(candidates[0].term, noun)
                self.assertEqual(candidates[0].rule, "all")

                # If entry in dictionary has empty rules (noun), it must NOT match verb candidates
                noun_entry_rules = ""
                verb_candidates = [c for c in candidates if c.rule in ("v1", "v5", "vs", "vk")]
                for vc in verb_candidates:
                    self.assertFalse(
                        vc.matches_entry_rules(noun_entry_rules),
                        f"Candidate '{vc.term}' ({vc.rule}) erroneously matched noun rules '{noun_entry_rules}'",
                    )


if __name__ == "__main__":
    unittest.main()
