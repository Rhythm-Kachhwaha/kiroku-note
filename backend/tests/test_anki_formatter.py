"""Unit tests for Stage 3B.4 Step 2: Dedicated AnkiFormatter Service."""
import unittest

from app.services.anki_formatter import (
    ANKI_CARD_CSS,
    escape_html,
    format_basic_back,
    format_example_html,
    format_meaning_html,
    format_ruby_html,
    get_anki_card_css,
    sanitize_media_tags,
)
from app.services.yomitan import (
    DictionaryEntry,
    DictionarySense,
    ExampleSentence,
    PitchAccent,
)


class TestAnkiFormatter(unittest.TestCase):
    """Test suite covering the AnkiFormatter presentation service."""

    # 1. Single meaning
    def test_01_single_meaning_formatting(self):
        # From structured entry
        entry = {
            "dictionary": "Jitendex",
            "senses": [
                {"index": 1, "glosses": ["movie", "film"], "parts_of_speech": ["noun"]},
            ],
        }
        html_out = format_meaning_html(entries=[entry])
        self.assertNotIn("<ol", html_out)
        self.assertIn("movie, film", html_out)
        self.assertIn('<span class="kn-pos">[noun]</span>', html_out)
        self.assertTrue(html_out.startswith('<div class="kn-meaning">'))

        # From plain text (single line)
        plain_out = format_meaning_html(meaning_text="movie, film")
        self.assertNotIn("<ol", plain_out)
        self.assertIn("movie, film", plain_out)
        self.assertTrue(plain_out.startswith('<div class="kn-meaning">'))

    # 2. Multiple meanings
    def test_02_multiple_meanings_formatting(self):
        # Structured senses
        entry = {
            "dictionary": "Jitendex",
            "senses": [
                {"index": 1, "glosses": ["to eat", "to consume"], "parts_of_speech": ["1-dan", "vt"]},
                {"index": 2, "glosses": ["to live on (e.g. one's salary)"], "parts_of_speech": ["1-dan"]},
            ],
        }
        html_out = format_meaning_html(entries=[entry])
        self.assertIn('<ol class="kn-meanings">', html_out)
        self.assertIn("<li>", html_out)
        self.assertIn("to eat, to consume", html_out)
        self.assertIn("to live on (e.g. one&#x27;s salary)", html_out)

        # Plain text multi-line
        plain_multiline = "1. to eat\n2. to live on"
        plain_out = format_meaning_html(meaning_text=plain_multiline)
        self.assertIn('<ol class="kn-meanings">', plain_out)
        self.assertIn("<li>to eat</li>", plain_out)
        self.assertIn("<li>to live on</li>", plain_out)

    # 3. Sense-bound POS
    def test_03_sense_bound_pos_preservation(self):
        entry = {
            "dictionary": "Jitendex",
            "senses": [
                {"index": 1, "glosses": ["to drop"], "parts_of_speech": ["godan", "vt"]},
                {"index": 2, "glosses": ["to fall"], "parts_of_speech": ["ichidan", "vi"]},
            ],
        }
        html_out = format_meaning_html(entries=[entry])
        self.assertIn('<span class="kn-pos">[godan, vt]</span>', html_out)
        self.assertIn('<span class="kn-pos">[ichidan, vi]</span>', html_out)

    # 4. Sense-bound tags
    def test_04_sense_bound_tags_preservation(self):
        entry = {
            "dictionary": "Jitendex",
            "senses": [
                {
                    "index": 1,
                    "glosses": ["to multiply"],
                    "parts_of_speech": ["ichidan", "vt"],
                    "tags": ["usually kana"],
                    "field_tags": ["math"],
                },
            ],
        }
        html_out = format_meaning_html(entries=[entry])
        self.assertIn('<span class="kn-pos">[ichidan, vt]</span>', html_out)
        self.assertNotIn('<span class="kn-tag">', html_out)

    # 5. HTML/XSS escaping
    def test_05_html_xss_escaping_security(self):
        # Malicious tags in glosses, POS, and tags
        entry = {
            "dictionary": "<script>alert('dict')</script>",
            "senses": [
                {
                    "index": 1,
                    "glosses": ["<script>alert(1)</script>", "A < B & C > D", 'quote"test\''],
                    "parts_of_speech": ['<img src=x onerror="alert(1)">'],
                    "tags": ['" onload="steal()'],
                },
            ],
        }
        html_out = format_meaning_html(entries=[entry])
        self.assertNotIn("<script>", html_out)
        self.assertNotIn("<img src=x", html_out)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html_out)
        self.assertIn("A &lt; B &amp; C &gt; D", html_out)
        self.assertIn("&quot;", html_out)
        self.assertIn("&#x27;", html_out)

    # 6. Ruby/furigana
    def test_06_ruby_furigana_formatting(self):
        # Bracket notation conversion
        bracket_src = "朝[あさ]御[ご]飯[はん]を食[た]べる。"
        ruby_out = format_ruby_html(bracket_src)
        self.assertIn("<ruby>朝<rt>あさ</rt></ruby>", ruby_out)
        self.assertIn("<ruby>御<rt>ご</rt></ruby>", ruby_out)
        self.assertIn("<ruby>飯<rt>はん</rt></ruby>", ruby_out)
        self.assertIn("<ruby>食<rt>た</rt></ruby>", ruby_out)
        self.assertIn("を", ruby_out)
        self.assertIn("べる。", ruby_out)

        # Kana prefix before kanji
        prefix_src = "お父[とう]さん"
        ruby_prefix = format_ruby_html(prefix_src)
        self.assertEqual(ruby_prefix, "お<ruby>父<rt>とう</rt></ruby>さん")

        # Plain text without brackets
        plain_src = "映画を見る"
        self.assertEqual(format_ruby_html(plain_src), "映画を見る")

        # Pre-existing <ruby> tags parsed and escaped safely
        preexisting = "<ruby>朝<rt>あさ</rt></ruby>を食[た]べる。"
        out_preexisting = format_ruby_html(preexisting)
        self.assertIn("<ruby>朝<rt>あさ</rt></ruby>", out_preexisting)
        self.assertIn("<ruby>食<rt>た</rt></ruby>", out_preexisting)

        # Malicious bracket content
        malicious_src = "<script>[alert(1)]"
        safe_ruby = format_ruby_html(malicious_src)
        self.assertNotIn("<script>", safe_ruby)
        self.assertIn("&lt;script&gt;", safe_ruby)

    # 7. Pitch information
    def test_07_pitch_information(self):
        pitches = [
            PitchAccent(reading="たべる", position=2, pattern_name="nakadaka"),
        ]
        card = {
            "reading": "たべる",
            "meaning": "to eat",
        }
        back_html = format_basic_back(card, pitches=pitches)
        self.assertIn('<span class="kn-pitch">[② Nakadaka]</span>', back_html)

        # Position 0 Heiban
        pitches_0 = [{"position": 0, "pattern_name": "heiban"}]
        back_html_0 = format_basic_back(card, pitches=pitches_0)
        self.assertIn('<span class="kn-pitch">[⓪ Heiban]</span>', back_html_0)

    # 8. Example + translation
    def test_08_example_and_translation(self):
        # Both sentence with ruby reading and translation
        ex_html = format_example_html(
            japanese="朝ご飯を食べる。",
            reading="朝[あさ]御[ご]飯[はん]を食[た]べる。",
            translation="To eat breakfast.",
        )
        self.assertIn('<div class="kn-example-block">', ex_html)
        self.assertIn('<p class="kn-example-ja">', ex_html)
        self.assertIn('<ruby>朝<rt>あさ</rt></ruby>', ex_html)
        self.assertIn('<p class="kn-example-en">To eat breakfast.</p>', ex_html)

        # Translation only (no ruby reading, clean Japanese)
        ex_no_ruby = format_example_html(
            japanese="映画を見る。",
            translation="Watch a movie.",
        )
        self.assertIn('<p class="kn-example-ja">映画を見る。</p>', ex_no_ruby)
        self.assertIn('<p class="kn-example-en">Watch a movie.</p>', ex_no_ruby)

        # Japanese only (translation omitted)
        ex_no_trans = format_example_html(japanese="本を読む。")
        self.assertIn('<p class="kn-example-ja">本を読む。</p>', ex_no_trans)
        self.assertNotIn('kn-example-en', ex_no_trans)

        # From ExampleSentence dataclass
        ex_dc = ExampleSentence(japanese="猫が好き", translation="I like cats")
        ex_dc_html = format_example_html(ex_dc)
        self.assertIn('<p class="kn-example-ja">猫が好き</p>', ex_dc_html)
        self.assertIn('<p class="kn-example-en">I like cats</p>', ex_dc_html)

    # 9. Basic back generation
    def test_09_basic_back_generation(self):
        card = {
            "expression": "食べる",
            "reading": "たべる",
            "meaning": "to eat",
            "hint": "irregular verb note",
            "notes": "Remember: 1-dan verb",
            "example_sentence": "朝ご飯を食べる。",
            "example_translation": "To eat breakfast.",
            "image": "kiroku_img_123.jpg",
            "audio": "kiroku_audio_123.wav",
        }
        pitches = [PitchAccent(reading="たべる", position=2, pattern_name="nakadaka")]
        entries = [
            {
                "dictionary": "Jitendex",
                "senses": [
                    {"index": 1, "glosses": ["to eat"], "parts_of_speech": ["1-dan", "vt"]},
                    {"index": 2, "glosses": ["to live on"], "parts_of_speech": ["1-dan"]},
                ],
            }
        ]
        back_html = format_basic_back(card, entries=entries, pitches=pitches)
        self.assertTrue(back_html.startswith('<div class="kn-card">'))
        self.assertTrue(back_html.endswith('</div>'))
        self.assertIn('<div class="kn-reading">', back_html)
        self.assertIn('<span class="kn-kana">たべる</span>', back_html)
        self.assertIn('<span class="kn-pitch">[② Nakadaka]</span>', back_html)
        self.assertIn('<hr class="kn-divider">', back_html)
        self.assertIn('<ol class="kn-meanings">', back_html)
        self.assertIn('<span class="kn-pos">[1-dan, vt]</span>', back_html)
        self.assertIn('<div class="kn-example-block">', back_html)
        self.assertIn('<div class="kn-hint">Hint: irregular verb note</div>', back_html)
        self.assertIn('<div class="kn-notes">Notes: Remember: 1-dan verb</div>', back_html)
        self.assertIn('<div class="kn-media">', back_html)
        self.assertIn('<img src="kiroku_img_123.jpg" class="kn-image">', back_html)
        self.assertIn('[sound:kiroku_audio_123.wav]', back_html)

    # 10. Media sanitization
    def test_10_media_sanitization(self):
        # Valid filenames
        img, aud = sanitize_media_tags("kiroku_img_12345.jpg", "kiroku_audio_12345.wav")
        self.assertEqual(img, '<img src="kiroku_img_12345.jpg" class="kn-image">')
        self.assertEqual(aud, '[sound:kiroku_audio_12345.wav]')

        # Pre-wrapped sound tag
        _, aud_wrapped = sanitize_media_tags(audio="[sound:kiroku_audio_123.wav]")
        self.assertEqual(aud_wrapped, '[sound:kiroku_audio_123.wav]')

        # Subdirectory path: extracts clean basename
        img_path, aud_path = sanitize_media_tags("data/media/ankiminer_img_999.png", "data/media/ankiminer_audio_999.wav")
        self.assertEqual(img_path, '<img src="ankiminer_img_999.png" class="kn-image">')
        self.assertEqual(aud_path, '[sound:ankiminer_audio_999.wav]')

        # Malicious image tag injection
        img_bad, aud_bad = sanitize_media_tags('<script>alert(1)</script>', '[sound:<script>alert(1)</script>]')
        self.assertEqual(img_bad, "")
        self.assertEqual(aud_bad, "")

        # Attribute breakout attempt
        img_break, aud_break = sanitize_media_tags('photo.jpg" onerror="alert(1)', 'sound.wav" onclick="bad()')
        self.assertEqual(img_break, "")
        self.assertEqual(aud_break, "")

        # Disallowed file extensions (e.g. .exe, .sh)
        img_sh, aud_sh = sanitize_media_tags("script.sh", "malware.exe")
        self.assertEqual(img_sh, "")
        self.assertEqual(aud_sh, "")

    # 11. Empty/missing optional fields
    def test_11_empty_missing_optional_fields(self):
        # Completely empty calls
        self.assertEqual(format_meaning_html("", None), "")
        self.assertEqual(format_example_html("", ""), "")
        self.assertEqual(sanitize_media_tags("", ""), ("", ""))
        self.assertEqual(format_basic_back({}), "")

        # Card with only expression and reading
        card_minimal = {"expression": "犬", "reading": "いぬ"}
        minimal_back = format_basic_back(card_minimal)
        self.assertIn('<span class="kn-kana">いぬ</span>', minimal_back)
        self.assertNotIn('<div class="kn-media">', minimal_back)
        self.assertNotIn('<div class="kn-hint">', minimal_back)
        self.assertNotIn('<div class="kn-notes">', minimal_back)
        self.assertNotIn('<div class="kn-example-block">', minimal_back)

    # 12. Multiple dictionary entries / preserved ordering
    def test_12_multiple_dictionary_entries_preserved_ordering(self):
        entries = [
            {
                "dictionary": "Jitendex",
                "is_primary": True,
                "senses": [
                    {"index": 1, "glosses": ["Jitendex Sense 1"], "parts_of_speech": ["noun"]},
                    {"index": 2, "glosses": ["Jitendex Sense 2"], "parts_of_speech": ["noun"]},
                ],
            },
            {
                "dictionary": "新明解",
                "is_primary": False,
                "senses": [
                    {"index": 1, "glosses": ["Shinmeikai Sense 1"], "parts_of_speech": ["noun"]},
                ],
            },
        ]
        html_out = format_meaning_html(entries=entries)
        self.assertIn('<ol class="kn-meanings">', html_out)
        idx_j1 = html_out.index("Jitendex Sense 1")
        idx_j2 = html_out.index("Jitendex Sense 2")
        idx_s1 = html_out.index("Shinmeikai Sense 1")
        self.assertTrue(idx_j1 < idx_j2 < idx_s1, "Ordering must strictly follow dictionary input order")

    # 13. Highly polysemous word (25 senses)
    def test_13_highly_polysemous_word_25_senses(self):
        senses = [
            {"index": i, "glosses": [f"Sense meaning {i}"], "parts_of_speech": ["ichidan", "vt"]}
            for i in range(1, 26)
        ]
        entries = [{"dictionary": "Jitendex", "senses": senses}]
        html_out = format_meaning_html(entries=entries)
        self.assertIn('<ol class="kn-meanings">', html_out)
        for i in range(1, 26):
            self.assertIn(f"Sense meaning {i}", html_out)
        self.assertEqual(html_out.count("<li>"), 25)
    # 14. Scoped CSS and styling tests (Stage 5.2)
    def test_14_scoped_css_and_styling(self):
        css = get_anki_card_css()
        self.assertIsInstance(css, str)
        self.assertGreater(len(css), 100)

        # 1. Scoped container and light theme variables
        self.assertIn(".kn-card", css)
        self.assertIn("--kn-bg: #ffffff;", css)
        self.assertIn("--kn-text: #1f2937;", css)
        self.assertIn("--kn-muted: #6b7280;", css)
        self.assertIn("--kn-surface: #f9fafb;", css)
        self.assertIn("--kn-pitch-bg: #eff6ff;", css)

        # 2. Night mode / dark mode selectors
        self.assertIn(".nightMode .kn-card", css)
        self.assertIn(".night_mode .kn-card", css)
        self.assertIn("body.nightMode .kn-card", css)
        self.assertIn("body.night_mode .kn-card", css)
        self.assertIn("@media (prefers-color-scheme: dark)", css)
        self.assertIn("--kn-bg: #1e1e2e;", css)

        # 3. Japanese typography fallbacks
        self.assertIn("Hiragino Sans", css)
        self.assertIn("Yu Gothic", css)
        self.assertIn("Noto Sans JP", css)

        # 4. Media constraints
        self.assertIn("max-height: 240px;", css)
        self.assertIn("max-width: 100%;", css)
        self.assertIn("object-fit: contain;", css)

        # 5. Embedded in Basic Back HTML
        card = {"expression": "勉強", "reading": "べんきょう", "meaning": "study"}
        back_html = format_basic_back(card)
        self.assertIn("<style>", back_html)
        self.assertIn("</style>", back_html)
        self.assertIn(".kn-card", back_html)
        self.assertIn(".nightMode .kn-card", back_html)

    # 15. Semantic elements structure verification (Stage 5.2)
    def test_15_semantic_elements_structure(self):
        card = {
            "expression": "掛ける",
            "reading": "かける",
            "meaning": "1. to hang\n2. to multiply",
            "hint": "multi-sense verb",
            "notes": "polite: かけます",
            "example_sentence": "壁に絵を掛ける。",
            "example_translation": "Hang a picture on the wall.",
            "image": "kakeru.jpg",
            "audio": "kakeru.mp3",
        }
        pitches = [PitchAccent(reading="かける", position=2, pattern_name="nakadaka")]
        entries = [
            {
                "dictionary": "Jitendex",
                "senses": [
                    {
                        "index": 1,
                        "glosses": ["to hang", "to suspend"],
                        "parts_of_speech": ["ichidan", "vt"],
                        "tags": ["common"],
                    },
                    {
                        "index": 2,
                        "glosses": ["to multiply"],
                        "parts_of_speech": ["ichidan", "vt"],
                        "field_tags": ["math"],
                    },
                ],
            }
        ]
        back_html = format_basic_back(card, entries=entries, pitches=pitches)

        # Verify exact hierarchy of classes
        self.assertIn('<div class="kn-card">', back_html)
        self.assertIn('<style>', back_html)
        self.assertIn('<div class="kn-reading">', back_html)
        self.assertIn('<span class="kn-kana">かける</span>', back_html)
        self.assertIn('<span class="kn-pitch">[② Nakadaka]</span>', back_html)
        self.assertIn('<hr class="kn-divider">', back_html)
        self.assertIn('<ol class="kn-meanings">', back_html)
        self.assertIn('<span class="kn-pos">[ichidan, vt]</span>', back_html)
        self.assertNotIn('<span class="kn-tag">', back_html)
        self.assertIn('<div class="kn-example-block">', back_html)
        self.assertIn('<p class="kn-example-ja">壁に絵を掛ける。</p>', back_html)
        self.assertIn('<p class="kn-example-en">Hang a picture on the wall.</p>', back_html)
        self.assertIn('<div class="kn-hint">Hint: multi-sense verb</div>', back_html)
        self.assertIn('<div class="kn-notes">Notes: polite: かけます</div>', back_html)
        self.assertIn('<div class="kn-media">', back_html)
        self.assertIn('<img src="kakeru.jpg" class="kn-image">', back_html)
        self.assertIn('[sound:kakeru.mp3]', back_html)

    # 16. Kunyomi okurigana formatting
    def test_16_format_kunyomi_okurigana(self):
        from app.services.anki_formatter import format_kunyomi
        self.assertEqual(format_kunyomi("あ.う"), "あ(う)")
        self.assertEqual(format_kunyomi("-あ.わせる"), "-あ(わせる)")
        self.assertEqual(format_kunyomi("あう"), "あう")
        self.assertEqual(format_kunyomi(""), "")

    # 17. Format kanji HTML with readings, stats, and dictionary attribution
    def test_17_format_kanji_html_isolated_and_stats(self):
        from app.services.anki_formatter import format_kanji_html
        kanji_data = [
            {
                "character": "合",
                "dictionary": "KANJIDIC",
                "onyomi": ["ゴウ", "ガッ", "カッ"],
                "kunyomi": ["あ.う", "あ.わせる"],
                "nanori": ["あい"],
                "meanings": ["fit", "suit", "join"],
                "stats": {"strokes": "6", "grade": "2", "freq": "41"},
            }
        ]
        html_out = format_kanji_html(kanji_data)
        self.assertIn('<div class="kn-kanji-card">', html_out)
        self.assertIn('<span class="kn-kanji-char">合</span>', html_out)
        self.assertIn('<span class="kn-tag">KANJIDIC</span>', html_out)
        self.assertIn('<span class="kn-tag">6 strokes</span>', html_out)
        self.assertIn('<span class="kn-tag">Grade 2</span>', html_out)
        self.assertIn('<span class="kn-tag">Freq #41</span>', html_out)
        self.assertIn('<span class="kn-onyomi">ゴウ, ガッ, カッ</span>', html_out)
        self.assertIn('<span class="kn-kunyomi">あ(う), あ(わせる)</span>', html_out)
        self.assertIn('<span class="kn-nanori">あい</span>', html_out)
        self.assertIn('<div class="kn-kanji-meanings">fit, suit, join</div>', html_out)

    # 18. JLPT: Historical KANJIDIC level vs Modern JLPT tags
    def test_18_jlpt_historical_vs_modern(self):
        from app.services.anki_formatter import format_kanji_html
        # Case A: Historical numeric 1-4 scale from KANJIDIC is deprecated and suppressed
        old_jlpt_data = [
            {
                "character": "合",
                "dictionary": "KANJIDIC",
                "stats": {"jlpt": "4"},
                "tags": [],
            }
        ]
        old_out = format_kanji_html(old_jlpt_data)
        self.assertNotIn("Old JLPT", old_out)
        self.assertNotIn("Old JLPT 4", old_out)
        self.assertNotIn("JLPT N4", old_out)

        # Case B: Modern JLPT tag
        modern_jlpt_data = [
            {
                "character": "食",
                "dictionary": "KANJIDIC",
                "stats": {"jlpt": "4"},
                "tags": ["jlpt-n5"],
            }
        ]
        modern_out = format_kanji_html(modern_jlpt_data)
        self.assertIn('<span class="kn-tag kn-jlpt">JLPT N5</span>', modern_out)
        self.assertNotIn("Old JLPT", modern_out)

    # 19. format_basic_back for isolated kanji card
    def test_19_format_basic_back_isolated_kanji(self):
        card = {
            "expression": "合",
            "reading": "ごう",
            "meaning": "fit, suit",
        }
        kanji_entries = [
            {
                "character": "合",
                "dictionary": "KANJIDIC",
                "onyomi": ["ゴウ", "ガッ", "カッ"],
                "kunyomi": ["あ.う", "あ.わせる"],
                "meanings": ["fit", "suit", "join"],
                "stats": {"strokes": "6", "jlpt": "4"},
            }
        ]
        term_entries = [
            {
                "dictionary": "Jitendex",
                "senses": [
                    {"index": 1, "glosses": ["0.18 liters"], "parts_of_speech": ["n"]},
                ],
            }
        ]
        back_html = format_basic_back(card, entries=term_entries, kanji_entries=kanji_entries)
        # Prominent kanji card appears
        self.assertIn('<div class="kn-kanji-card">', back_html)
        self.assertIn('<span class="kn-kanji-char">合</span>', back_html)
        self.assertIn('<span class="kn-onyomi">ゴウ, ガッ, カッ</span>', back_html)
        self.assertIn('<span class="kn-kunyomi">あ(う), あ(わせる)</span>', back_html)
        # Secondary vocabulary entry also included cleanly
        self.assertIn("0.18 liters", back_html)

    # 20. format_basic_back for vocabulary card with kanji entries
    def test_20_format_basic_back_vocabulary_with_kanji(self):
        card = {
            "expression": "食べる",
            "reading": "たべる",
            "meaning": "to eat",
        }
        kanji_entries = [
            {
                "character": "食",
                "dictionary": "KANJIDIC",
                "onyomi": ["ショク", "ジキ"],
                "kunyomi": ["た.べる", "く.う"],
                "meanings": ["eat", "food"],
                "stats": {"strokes": "9"},
            }
        ]
        term_entries = [
            {
                "dictionary": "Jitendex",
                "senses": [
                    {"index": 1, "glosses": ["to eat"], "parts_of_speech": ["v1", "vt"]},
                ],
            }
        ]
        back_html = format_basic_back(card, entries=term_entries, kanji_entries=kanji_entries)
        # Vocabulary definition appears first
        pos_pos = back_html.find('[v1, vt]')
        kanji_pos = back_html.find('<div class="kn-kanji-card">')
        self.assertNotEqual(pos_pos, -1)
        self.assertNotEqual(kanji_pos, -1)
        self.assertLess(pos_pos, kanji_pos, "Vocabulary senses must appear before kanji block for multi-kanji cards")
        self.assertIn('<span class="kn-onyomi">ショク, ジキ</span>', back_html)
        self.assertIn('<span class="kn-kunyomi">た(べる), く(う)</span>', back_html)

    # 21. format_basic_back with JLPT level and show_jlpt toggle
    def test_21_format_basic_back_jlpt(self):
        card = {
            "expression": "食べる",
            "reading": "たべる",
            "meaning": "to eat",
        }
        # With JLPT level and show_jlpt=True (default)
        html_with_jlpt = format_basic_back(card, jlpt_level="N5", show_jlpt=True)
        self.assertIn('<span class="kn-tag kn-jlpt">JLPT N5</span>', html_with_jlpt)
        self.assertIn('<span class="kn-kana">たべる</span>', html_with_jlpt)

        # With JLPT level and show_jlpt=False
        html_without_jlpt = format_basic_back(card, jlpt_level="N5", show_jlpt=False)
        self.assertNotIn('<span class="kn-tag kn-jlpt">', html_without_jlpt)
        self.assertNotIn('JLPT N5', html_without_jlpt)
        self.assertIn('<span class="kn-kana">たべる</span>', html_without_jlpt)


if __name__ == "__main__":
    unittest.main()
