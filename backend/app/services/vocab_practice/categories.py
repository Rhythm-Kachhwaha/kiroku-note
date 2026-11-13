"""Dictionary-driven word categorization, word sets, coverage metrics, and sentence usage tags."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import re
import sqlite3
from typing import Any, Iterable, Sequence

from app.db.connection import (
    db_session,
    ensure_vocab_practice_tables,
    ensure_vocab_state_tables,
    get_db_path,
)
from app.repositories.word_state_repository import (
    normalize_word_expression,
    normalize_word_reading,
)
from app.services.vocab_practice.models import (
    CategoryTag,
    WordSetCoverage,
    WordTarget,
)
from kiroku_dictionary.lookup import is_kana_only
from kiroku_dictionary.normalizer import (
    extract_senses_from_glossary,
    find_marked_nodes,
)
from kiroku_dictionary.schema import decompress_content, katakana_to_hiragana


# Canonical learner category constants
CAT_ADVERB = "adverb"
CAT_ONOMATOPOEIA = "onomatopoeia"
CAT_SURU_VERB = "suru_verb"
CAT_VERB_TRANSITIVE = "verb_transitive"
CAT_VERB_INTRANSITIVE = "verb_intransitive"
CAT_VERB_ICHIDAN = "verb_ichidan"
CAT_VERB_GODAN = "verb_godan"
CAT_VERB_KURU = "verb_kuru"
CAT_ADJECTIVE_I = "adjective_i"
CAT_ADJECTIVE_NA = "adjective_na"
CAT_NOUN = "noun"
CAT_EXPRESSION = "expression"

# Curated mimetic / onomatopoeia subtypes (giongo, giseigo, gitaigo, emotion)
ON_MIM_SUBTYPES: dict[str, str] = {
    # giongo: inanimate / environmental sounds
    "ざあざあ": "giongo",
    "ごろごろ": "giongo",
    "ぱちぱち": "giongo",
    "がらがら": "giongo",
    "ぽつぽつ": "giongo",
    "しとしと": "giongo",
    "びゅうびゅう": "giongo",
    "どしん": "giongo",
    "ばたん": "giongo",
    "こんこん": "giongo",
    "がたんごとん": "giongo",
    "ざぶざぶ": "giongo",
    "ぽたぽた": "giongo",
    "かちかち": "giongo",
    "ごうごう": "giongo",
    "ばさばさ": "giongo",
    "ぱんぱん": "giongo",
    # giseigo: animate / vocal sounds
    "わんわん": "giseigo",
    "にゃあにゃあ": "giseigo",
    "けろけろ": "giseigo",
    "げらげら": "giseigo",
    "くすくす": "giseigo",
    "ぺちゃくちゃ": "giseigo",
    "ぶつぶつ": "giseigo",
    "めそめそ": "giseigo",
    "ぎゃあぎゃあ": "giseigo",
    "ぴよぴよ": "giseigo",
    "こけこっこう": "giseigo",
    "もぐもぐ": "giseigo",
    "ごろにゃん": "giseigo",
    "ひそひそ": "giseigo",
    # gitaigo: manner, state, visual, tactile
    "ころころ": "gitaigo",
    "きらきら": "gitaigo",
    "ぎらぎら": "gitaigo",
    "ふわふわ": "gitaigo",
    "さらさら": "gitaigo",
    "ざらざら": "gitaigo",
    "つるつる": "gitaigo",
    "べたべた": "gitaigo",
    "すべすべ": "gitaigo",
    "ぐちゃぐちゃ": "gitaigo",
    "すっきり": "gitaigo",
    "しっかり": "gitaigo",
    "ゆっくり": "gitaigo",
    "はっきり": "gitaigo",
    "ぴったり": "gitaigo",
    "ぼんやり": "gitaigo",
    "のんびり": "gitaigo",
    "ぴかぴか": "gitaigo",
    "ぱたぱた": "gitaigo",
    "ばたばた": "gitaigo",
    "うろうろ": "gitaigo",
    "ぐずぐず": "gitaigo",
    "すらすら": "gitaigo",
    "ぺらぺら": "gitaigo",
    "ぶかぶか": "gitaigo",
    "ぎりぎり": "gitaigo",
    "じっと": "gitaigo",
    "そっと": "gitaigo",
    "ふと": "gitaigo",
    # emotion: psychological / emotional / somatic feelings
    "わくわく": "emotion",
    "どきどき": "emotion",
    "いらいら": "emotion",
    "うきうき": "emotion",
    "ひやひや": "emotion",
    "ぞくぞく": "emotion",
    "ほっと": "emotion",
    "がっかり": "emotion",
    "びっくり": "emotion",
    "うっとり": "emotion",
    "くよくよ": "emotion",
    "はらはら": "emotion",
    "むかむか": "emotion",
    "しみじみ": "emotion",
    "じーん": "emotion",
    "にこにこ": "emotion",
    "にやにや": "emotion",
    "しょんぼり": "emotion",
    "うんざり": "emotion",
    "どきっと": "emotion",
}

BUILTIN_TAG_SETS: tuple[tuple[str, str, str, str, str], ...] = (
    ("cat-adverbs", "Adverbs", "Adverbs and to-adverbs (adv / adv-to)", CAT_ADVERB, ""),
    ("cat-onomatopoeia", "Onomatopoeia & Mimetics", "All onomatopoeic and mimetic expressions (on-mim)", CAT_ONOMATOPOEIA, ""),
    ("cat-onmim-giongo", "Mimetics: Giongo (Sounds)", "Inanimate sound words", CAT_ONOMATOPOEIA, "giongo"),
    ("cat-onmim-giseigo", "Mimetics: Giseigo (Voices)", "Animate/vocal sound words", CAT_ONOMATOPOEIA, "giseigo"),
    ("cat-onmim-gitaigo", "Mimetics: Gitaigo (Manner)", "Visual, tactile, and manner mimetics", CAT_ONOMATOPOEIA, "gitaigo"),
    ("cat-onmim-emotion", "Mimetics: Emotion", "Psychological and emotional state mimetics", CAT_ONOMATOPOEIA, "emotion"),
    ("cat-suru-verbs", "Suru Verbs", "Verbal nouns and suru verbs (vs)", CAT_SURU_VERB, ""),
    ("cat-vt-verbs", "Transitive Verbs", "Transitive verbs taking direct objects (vt)", CAT_VERB_TRANSITIVE, ""),
    ("cat-vi-verbs", "Intransitive Verbs", "Intransitive verbs (vi)", CAT_VERB_INTRANSITIVE, ""),
    ("cat-ichidan-verbs", "Ichidan Verbs", "Ichidan / 1-dan verbs (v1)", CAT_VERB_ICHIDAN, ""),
    ("cat-godan-verbs", "Godan Verbs", "Godan / 5-dan verbs (v5*)", CAT_VERB_GODAN, ""),
    ("cat-adj-i", "I-Adjectives", "I-adjectives (adj-i)", CAT_ADJECTIVE_I, ""),
    ("cat-adj-na", "Na-Adjectives", "Na-adjectives (adj-na)", CAT_ADJECTIVE_NA, ""),
    ("cat-nouns", "Nouns", "Nouns (n)", CAT_NOUN, ""),
    ("cat-expressions", "Expressions", "Idiomatic expressions and phrases (exp)", CAT_EXPRESSION, ""),
)


# Canonical Japanese Adverb Lexicon (N5 to N1)
CANONICAL_ADVERB_SET: set[str] = {
    # N5
    "いつも", "あまり", "とても", "たいへん", "大変", "ちょっと", "すぐ", "直ぐ", "たくさん",
    "もっと", "ずっと", "だんだん", "ゆっくり", "しっかり", "はっきり", "ちょうど", "たぶん",
    "まっすぐ", "ぜんぜん", "全然", "ほぼ", "大体", "だいたい", "初めて", "はじめて", "また",
    "まだ", "もう", "いっしょに", "一緒に", "どう", "そう", "こう", "ああ", "よく", "いちばん",
    "一番", "少し", "すこし", "大抵", "たいてい",
    # N4
    "すっかり", "ずいぶん", "随分", "急に", "きゅうに", "確かに", "たしかに", "特に", "とくに",
    "なるべく", "なるほど", "ほとんど", "別に", "べつに", "まず", "もし", "やっと", "やはり",
    "やっぱり", "急いで", "いそいで", "決して", "けっして", "絶対に", "ぜったいに", "たまに",
    "必ず", "かならず", "非常に", "ひじょうに", "普通", "ふつう",
    # N3-N1
    "あらかじめ", "改めて", "いかに", "いずれ", "今に", "今にも", "思い切り", "およそ",
    "かつて", "必ずしも", "極めて", "近年", "げんに", "現に", "再三", "幸い",
    "直ちに", "たちまち", "単に", "常に", "どうせ", "滅多に", "めったに", "ろくに", "割に",
    "割合に", "徐々に", "じょじょに", "次第に", "しだいに", "いっそ", "いっそう", "一層",
    "概して", "果して", "果たして", "恐らく", "おそらく", "大して", "たいして", "大層",
    "とっくに", "ともかく", "何しろ", "なにしろ", "なんと", "何と", "何とか", "なんとなく",
    "一応", "いちおう", "一段と", "いちだんと", "一向に", "いっこうに", "一体", "いったい",
    "どうにか", "どうやら", "どうせ", "とうとう", "ますます", "益々", "めいめい",
}

CANONICAL_NA_ADJECTIVES: set[str] = {
    "便利", "べんり", "親切", "しんせつ", "静か", "しずか", "有名", "ゆうめい", "元気", "げんき",
    "簡単", "かんたん", "必要", "ひつよう", "安全", "あんぜん", "危険", "きけん", "大切", "たいせつ",
    "大事", "だいじ", "自由", "じゆう", "複雑", "ふくざつ", "特別", "とくべつ", "適当", "てきとう",
    "真面目", "まじめ", "盛ん", "さかん", "暇", "ひま", "素敵", "すてき", "立派", "りっぱ",
    "下手", "へた", "上手", "じょうず", "嫌い", "きらい", "好き", "すき", "綺麗", "きれい",
    "丁寧", "ていねい", "変", "へん", "楽", "らく", "嫌", "いや", "無理", "むり", "十分", "じゅうぶん",
}

_ADVERB_GLOSS_HINTS = (
    "always", "very", "quite", "slowly", "immediately", "soon", "often", "sometimes",
    "usually", "scarcely", "hardly", "already", "not very", "a lot", "gradually",
    "firmly", "clearly", "suddenly", "perhaps", "maybe", "at all", "at once",
    "together", "more and more", "at first", "finally", "especially", "actually",
    "certainly", "absolutely", "definitely", "approximately", "nearly", "mostly",
)


def classify_pos_heuristic(expression: str, reading: str = "", meaning: str = "") -> str:
    """Heuristic part-of-speech classification when sequence_id or JMdict tags are absent."""
    expr = (expression or "").strip()
    read = (reading or "").strip()
    mean = (meaning or "").strip().lower()

    if not expr:
        return CAT_NOUN

    # 1. Canonical Adverbs (checked first to distinguish adverbs like だんだん)
    if expr in CANONICAL_ADVERB_SET or read in CANONICAL_ADVERB_SET:
        return CAT_ADVERB

    # 2. Onomatopoeia / Mimetics (giongo, giseigo, gitaigo, emotion)
    # Checked before Katakana loanwords so expressions like ペラペラ and ドキドキ are classified correctly
    if expr in ON_MIM_SUBTYPES or read in ON_MIM_SUBTYPES:
        return CAT_ONOMATOPOEIA
    if "onomatopoeia" in mean or "mimetic" in mean or "on-mim" in mean:
        return CAT_ONOMATOPOEIA
    if (len(expr) == 4 and expr[0:2] == expr[2:4]) or (len(read) == 4 and read[0:2] == read[2:4]):
        return CAT_ONOMATOPOEIA

    # 3. Katakana loanword
    if re.fullmatch(r"^[ァ-ヴー・\s]+$", expr):
        return "katakana_loanword"

    # 4. Gloss-based Adverbs
    if "adverb" in mean or "(adv" in mean or mean.startswith("adv"):
        return CAT_ADVERB
    if any(h in mean for h in _ADVERB_GLOSS_HINTS) and not mean.startswith(("to ", "to be", "to have", "to do", "a ", "the ")):
        return CAT_ADVERB
    if expr.endswith("り") and len(expr) >= 3 and (expr[0] == expr[1] or "っ" in expr or "ん" in expr):
        return CAT_ADVERB

    # 5. Adjectives (na and i)
    if expr in CANONICAL_NA_ADJECTIVES or read in CANONICAL_NA_ADJECTIVES:
        return CAT_ADJECTIVE_NA
    if "adjective" in mean or "(adj" in mean:
        return CAT_ADJECTIVE_I if expr.endswith("い") else CAT_ADJECTIVE_NA
    if expr.endswith("い") and len(expr) > 1 and not mean.startswith("to "):
        return CAT_ADJECTIVE_I
    if expr.endswith("な") and len(expr) > 2:
        return CAT_ADJECTIVE_NA

    # 6. Verbs
    if mean.startswith(("to ", "to be ", "to have ", "to do ")) or " verb" in mean or "(v1)" in mean or "(v5" in mean or "(vi)" in mean or "(vt)" in mean:
        return "verb"

    # 7. Verb inflection ending fallback (when not matching adverb or adjective)
    verb_endings = ("う", "く", "す", "つ", "ぬ", "ふ", "む", "る", "ぐ", "ず", "づ", "ぶ", "ぷ")
    if expr.endswith(verb_endings) and len(expr) > 1 and (mean.startswith("to") or not mean):
        return "verb"

    return CAT_NOUN


def get_gap_breakdown_by_category(
    level: str = "N4",
    limit_per_category: int = 150,
    db_path: Any = None,
) -> dict[str, Any]:
    """Breakdown unseen JLPT gap words by category (adverb, noun, katakana_loanword, verb, adjective)."""
    from app.services.jlpt_reference import JlptReferenceService

    ref_service = JlptReferenceService()
    actual_db = db_path or get_db_path()

    excluded: set[str] = set()
    try:
        with db_session(actual_db) as conn:
            for r in conn.execute("SELECT expression FROM cards").fetchall():
                if r["expression"]:
                    excluded.add(str(r["expression"]).strip())
            for r in conn.execute("SELECT word FROM known_words").fetchall():
                if r["word"]:
                    excluded.add(str(r["word"]).strip())
            for r in conn.execute("SELECT expression FROM word_states WHERE state = 'known'").fetchall():
                if r["expression"]:
                    excluded.add(str(r["expression"]).strip())
    except Exception:
        pass

    target_lvl = level.strip().upper() if level else "N4"
    if target_lvl not in ("N5", "N4", "N3", "N2", "N1"):
        target_lvl = "N4"

    level_order = ["N5", "N4", "N3", "N2", "N1"]
    target_idx = level_order.index(target_lvl)
    eligible_levels = level_order[: target_idx + 1]

    raw_gaps = []
    for lvl in eligible_levels:
        words = ref_service.get_words_by_level(lvl, limit=5000)
        for w in words:
            expr = w["expression"].strip()
            if expr and expr not in excluded:
                raw_gaps.append(w)

    categories_map: dict[str, list[dict[str, Any]]] = {
        "adverb": [],
        "noun": [],
        "katakana_loanword": [],
        "verb": [],
        "adjective": [],
    }

    for gap in raw_gaps:
        expr = gap["expression"]
        read = gap.get("reading", "")
        mean = gap.get("meaning", "")

        cat = classify_pos_heuristic(expr, read, mean)
        if cat in ("adjective_i", "adjective_na"):
            cat = "adjective"
        elif cat in (CAT_VERB_TRANSITIVE, CAT_VERB_INTRANSITIVE, CAT_VERB_ICHIDAN, CAT_VERB_GODAN, CAT_SURU_VERB):
            cat = "verb"
        elif cat in (CAT_ADVERB, CAT_ONOMATOPOEIA):
            cat = "adverb"

        if cat not in categories_map:
            cat = "noun"

        if len(categories_map[cat]) < limit_per_category:
            categories_map[cat].append({
                "expression": expr,
                "reading": read,
                "meaning": mean,
                "jlpt_level": gap.get("jlpt_level", target_lvl),
                "category": cat,
            })

    counts = {k: len(v) for k, v in categories_map.items()}
    total_gaps = sum(counts.values())

    return {
        "level": target_lvl,
        "total_gaps": total_gaps,
        "counts": counts,
        "breakdown": categories_map,
    }


_POS_TEXT_ALIASES: dict[str, str] = {
    "adverb": "adv",
    "to-adverb": "adv-to",
    "mimetic": "on-mim",
    "onomatopoeia": "on-mim",
    "suru": "vs",
    "suru verb": "vs",
    "suru-verb": "vs",
    "transitive": "vt",
    "intransitive": "vi",
    "1-dan": "v1",
    "ichidan": "v1",
    "5-dan": "v5",
    "godan": "v5",
    "kuru": "vk",
    "kuru verb": "vk",
    "i-adj": "adj-i",
    "adjective": "adj-i",
    "na-adj": "adj-na",
    "na-adjective": "adj-na",
    "noun": "n",
    "expression": "exp",
}

_GIONGO_GLOSS_HINTS = ("sound", "noise", "bang", "crash", "thunder", "rumble", "rain", "drip", "splash", "wind", "rattle", "click")
_GISEIGO_GLOSS_HINTS = ("bark", "meow", "croak", "chirp", "laugh", "giggle", "mutter", "whisper", "cry", "sob", "scream", "chatter")
_EMOTION_GLOSS_HINTS = ("feel", "feeling", "heart", "nervous", "excited", "thrilled", "angry", "irritated", "relieved", "disappointed", "anxious", "happy", "smile", "grin", "sad", "depressed")


def resolve_onomatopoeia_subtype(
    expression: str,
    reading: str = "",
    glosses: Sequence[str] = (),
) -> str:
    """Determine mimetic subtype (giongo, giseigo, gitaigo, emotion) deterministically."""
    for candidate in (reading, expression):
        norm = katakana_to_hiragana(str(candidate or "").strip())
        if norm in ON_MIM_SUBTYPES:
            return ON_MIM_SUBTYPES[norm]

    joined_gloss = " ".join(str(g or "").lower() for g in glosses)
    if any(w in joined_gloss for w in _EMOTION_GLOSS_HINTS):
        return "emotion"
    if any(w in joined_gloss for w in _GISEIGO_GLOSS_HINTS):
        return "giseigo"
    if any(w in joined_gloss for w in _GIONGO_GLOSS_HINTS):
        return "giongo"
    return "gitaigo"


def extract_jmdict_tags(
    *,
    def_tags: Iterable[str] | str = (),
    term_tags: Iterable[str] | str = (),
    rules: str = "",
    content_blob: bytes | None = None,
    glossary: Any = None,
) -> tuple[str, ...]:
    """Collect normalized JMdict/Jitendex POS and misc tag codes from row fields and AST."""
    raw_tokens: list[str] = []

    def _extend_tokens(val: Iterable[str] | str) -> None:
        if isinstance(val, str):
            raw_tokens.extend(val.replace("\xa0", " ").split())
        else:
            for item in val:
                raw_tokens.extend(str(item or "").replace("\xa0", " ").split())

    _extend_tokens(def_tags)
    _extend_tokens(term_tags)
    _extend_tokens(rules)

    parsed_glossary = glossary
    if parsed_glossary is None and content_blob:
        try:
            parsed_glossary = decompress_content(content_blob)
        except Exception:
            parsed_glossary = None

    if parsed_glossary is not None:
        for marker in ("part-of-speech-info", "misc-info"):
            for node in find_marked_nodes(parsed_glossary, marker):
                data = node.get("data")
                if isinstance(data, dict):
                    code = str(data.get("code") or "").strip()
                    if code:
                        raw_tokens.append(code)
                content = node.get("content")
                if isinstance(content, str):
                    mapped = _POS_TEXT_ALIASES.get(content.strip().lower())
                    if mapped:
                        raw_tokens.append(mapped)

    deduped: list[str] = []
    for tok in raw_tokens:
        clean = tok.strip().lower()
        if clean and clean not in deduped:
            deduped.append(clean)
    return tuple(deduped)


def classify_tags_to_categories(
    tags: Iterable[str],
    *,
    expression: str = "",
    reading: str = "",
    glosses: Sequence[str] = (),
    source: str = "jmdict",
) -> list[CategoryTag]:
    """Deterministically map JMdict/Jitendex tags to multi-tag learner categories."""
    tag_set = {str(t).strip().lower() for t in tags if t}
    results: list[CategoryTag] = []
    seen: set[tuple[str, str]] = set()

    def _add(cat: str, sub: str = "") -> None:
        key = (cat, sub)
        if key not in seen:
            seen.add(key)
            results.append(CategoryTag(category=cat, subtype=sub, source=source))

    # Adverbs
    if "adv-to" in tag_set:
        _add(CAT_ADVERB, "adv-to")
    elif "adv" in tag_set:
        _add(CAT_ADVERB, "adv")

    # Onomatopoeia / Mimetics
    if "on-mim" in tag_set or "mimetic" in tag_set:
        subtype = resolve_onomatopoeia_subtype(expression, reading, glosses)
        _add(CAT_ONOMATOPOEIA, subtype)

    # Suru verbs
    for t in sorted(tag_set):
        if t == "vs" or t.startswith("vs-"):
            _add(CAT_SURU_VERB, t)

    # Transitive / Intransitive
    if "vt" in tag_set:
        _add(CAT_VERB_TRANSITIVE, "vt")
    if "vi" in tag_set:
        _add(CAT_VERB_INTRANSITIVE, "vi")

    # Verb conjugation classes
    for t in sorted(tag_set):
        if t in ("v1", "v1-s"):
            _add(CAT_VERB_ICHIDAN, t)
        elif t == "v5" or t.startswith("v5"):
            _add(CAT_VERB_GODAN, t)
        elif t == "vk":
            _add(CAT_VERB_KURU, "vk")

    # Adjectives
    if "adj-i" in tag_set or "adj-ix" in tag_set:
        _add(CAT_ADJECTIVE_I, "adj-ix" if "adj-ix" in tag_set else "adj-i")
    if "adj-na" in tag_set:
        _add(CAT_ADJECTIVE_NA, "adj-na")

    # Nouns
    for t in ("n", "n-adv", "n-t", "n-pref", "n-suf"):
        if t in tag_set:
            _add(CAT_NOUN, "" if t == "n" else t)

    # Expressions
    if "exp" in tag_set:
        _add(CAT_EXPRESSION, "exp")

    return results


def build_word_target_from_dict(
    dict_engine: Any,
    expression: str = "",
    *,
    reading: str = "",
    sequence_id: int | None = None,
) -> WordTarget | None:
    """Resolve a word via DictionaryEngine and extract canonical WordTarget + categories."""
    if dict_engine is None:
        return None

    conn = dict_engine.get_connection()
    cur = conn.cursor()
    rows: list[tuple[Any, ...]] = []
    if sequence_id is not None:
        rows = cur.execute(
            """
            SELECT term, reading, rules, def_tags, score, sequence, term_tags, dictionary, content_blob
            FROM terms
            WHERE sequence = ?
            ORDER BY score DESC
            """,
            (int(sequence_id),),
        ).fetchall()
        if rows and reading:
            norm_r = normalize_word_reading(reading)
            exact_r = [r for r in rows if normalize_word_reading(r[1]) == norm_r]
            if exact_r:
                rows = exact_r + [r for r in rows if r not in exact_r]
        if rows and expression:
            norm_e = normalize_word_expression(expression)
            exact_e = [r for r in rows if normalize_word_expression(r[0]) == norm_e]
            if exact_e:
                rows = exact_e + [r for r in rows if r not in exact_e]

    if not rows and expression:
        canon = dict_engine.resolve_canonical(expression, reading=reading)
        if canon is not None:
            return build_word_target_from_dict(
                dict_engine,
                expression=canon.term,
                reading=canon.reading,
                sequence_id=canon.sequence_id,
            )
        return None

    if not rows:
        return None

    primary = rows[0]
    term, row_reading, rules, def_tags, _score, seq, term_tags, dict_name, blob = primary
    all_glosses: list[str] = []
    all_tags: list[str] = []
    xrefs: list[str] = []
    alt_forms: list[str] = []

    for r in rows:
        r_term, r_read, r_rules, r_def_tags, _r_score, _r_seq, r_term_tags, r_dict, r_blob = r
        for form in (r_term, r_read):
            if form and form not in alt_forms:
                alt_forms.append(form)
        glossary_data = None
        if r_blob:
            try:
                glossary_data = decompress_content(r_blob)
                senses, _pos = extract_senses_from_glossary(glossary_data, source_dict=r_dict or "Jitendex")
                for sense in senses:
                    for g in sense.glosses:
                        if g and g not in all_glosses:
                            all_glosses.append(g)
                    for xr in sense.cross_references:
                        if xr.target_term and xr.target_term not in xrefs:
                            xrefs.append(xr.target_term)
            except Exception:
                glossary_data = None

        row_tags = extract_jmdict_tags(
            def_tags=r_def_tags or "",
            term_tags=r_term_tags or "",
            rules=r_rules or "",
            glossary=glossary_data,
        )
        for t in row_tags:
            if t not in all_tags:
                all_tags.append(t)

    cat_tags = classify_tags_to_categories(
        all_tags,
        expression=str(term),
        reading=normalize_word_reading(row_reading),
        glosses=all_glosses,
    )
    categories = tuple(dict.fromkeys(ct.category for ct in cat_tags))
    subtypes = tuple(dict.fromkeys(ct.subtype for ct in cat_tags if ct.subtype))

    return WordTarget(
        sequence_id=int(seq),
        expression=str(term),
        reading=normalize_word_reading(row_reading) or str(row_reading or ""),
        glosses=tuple(all_glosses),
        categories=categories,
        subtypes=subtypes,
        rules=str(rules or ""),
        def_tags=tuple((def_tags or "").split()),
        term_tags=tuple((term_tags or "").split()),
        pos_codes=tuple(all_tags),
        cross_references=tuple(xrefs),
        alternate_forms=tuple(alt_forms),
    )


def upsert_word_categories(
    sequence_id: int,
    category_tags: Sequence[CategoryTag],
    *,
    db_path: Path | str | None = None,
    conn: sqlite3.Connection | None = None,
    now_iso: str | None = None,
) -> int:
    """Persist multi-tag category rows for a canonical JMdict sequence_id."""
    if not category_tags:
        return 0
    ts = now_iso or datetime.now(timezone.utc).isoformat()
    rows = [
        (int(sequence_id), ct.category, ct.subtype or "", ct.source or "jmdict", ts)
        for ct in category_tags
    ]
    sql = """
        INSERT INTO word_categories (sequence_id, category, subtype, source, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(sequence_id, category, subtype)
        DO UPDATE SET source = excluded.source, updated_at = excluded.updated_at
    """
    if conn is not None:
        ensure_vocab_practice_tables(conn)
        conn.executemany(sql, rows)
        conn.commit()
        return len(rows)

    with db_session(db_path) as session_conn:
        ensure_vocab_practice_tables(session_conn)
        session_conn.executemany(sql, rows)
        session_conn.commit()
        return len(rows)


def get_word_categories(
    *,
    sequence_id: int | None = None,
    category: str | None = None,
    subtype: str | None = None,
    db_path: Path | str | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Query persisted word_categories rows."""
    clauses: list[str] = []
    params: list[Any] = []
    if sequence_id is not None:
        clauses.append("sequence_id = ?")
        params.append(int(sequence_id))
    if category:
        clauses.append("category = ?")
        params.append(category.strip())
    if subtype:
        clauses.append("subtype = ?")
        params.append(subtype.strip())

    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    sql = f"""
        SELECT sequence_id, category, subtype, source, updated_at
        FROM word_categories{where}
        ORDER BY sequence_id ASC, category ASC, subtype ASC
    """
    if conn is not None:
        ensure_vocab_practice_tables(conn)
        return [dict(r) for r in conn.execute(sql, params).fetchall()]

    with db_session(db_path) as session_conn:
        ensure_vocab_practice_tables(session_conn)
        return [dict(r) for r in session_conn.execute(sql, params).fetchall()]


def categorize_and_persist_word(
    dict_engine: Any,
    *,
    sequence_id: int | None = None,
    expression: str = "",
    reading: str = "",
    db_path: Path | str | None = None,
    conn: sqlite3.Connection | None = None,
) -> WordTarget | None:
    """Resolve a word from DictionaryEngine, classify its tags, and persist word_categories."""
    target = build_word_target_from_dict(
        dict_engine,
        expression=expression,
        reading=reading,
        sequence_id=sequence_id,
    )
    if target is None:
        return None
    cat_tags = classify_tags_to_categories(
        target.pos_codes,
        expression=target.expression,
        reading=target.reading,
        glosses=target.glosses,
    )
    upsert_word_categories(target.sequence_id, cat_tags, db_path=db_path, conn=conn)
    return target


def sync_categories_from_word_states(
    dict_engine: Any,
    *,
    db_path: Path | str | None = None,
) -> int:
    """Populate word_categories for all tracked word_states with a canonical sequence_id."""
    if dict_engine is None:
        return 0
    total_written = 0
    with db_session(db_path) as conn:
        ensure_vocab_state_tables(conn)
        ensure_vocab_practice_tables(conn)
        rows = conn.execute(
            """
            SELECT DISTINCT sequence_id, reading, expression
            FROM word_states
            WHERE sequence_id IS NOT NULL AND state != 'blacklisted'
            """
        ).fetchall()
        for row in rows:
            target = build_word_target_from_dict(
                dict_engine,
                expression=str(row["expression"] or ""),
                reading=str(row["reading"] or ""),
                sequence_id=int(row["sequence_id"]),
            )
            if target is None:
                continue
            cat_tags = classify_tags_to_categories(
                target.pos_codes,
                expression=target.expression,
                reading=target.reading,
                glosses=target.glosses,
            )
            if cat_tags:
                total_written += upsert_word_categories(
                    target.sequence_id,
                    cat_tags,
                    conn=conn,
                )
    return total_written


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", unicodedata_ascii(name).lower()).strip("-")
    return base or "custom-set"


def unicodedata_ascii(text: str) -> str:
    return "".join(ch if ch.isascii() else "-" for ch in str(text or ""))


def create_custom_word_set(
    name: str,
    *,
    description: str = "",
    slug: str | None = None,
    items: Sequence[dict[str, Any]] = (),
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Create a custom word set and optionally populate initial items."""
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ValueError("Word set name is required.")
    clean_slug = (slug or _slugify(clean_name)).strip()
    now_iso = datetime.now(timezone.utc).isoformat()

    with db_session(db_path) as conn:
        ensure_vocab_practice_tables(conn)
        cur = conn.execute(
            """
            INSERT INTO word_sets (
                slug, name, description, set_type, filter_category, filter_subtype, created_at, updated_at
            ) VALUES (?, ?, ?, 'custom', '', '', ?, ?)
            """,
            (clean_slug, clean_name, str(description or ""), now_iso, now_iso),
        )
        set_id = int(cur.lastrowid)
        if items:
            _insert_word_set_items_on_conn(conn, set_id, items, now_iso=now_iso)
        conn.commit()
        row = conn.execute("SELECT * FROM word_sets WHERE id = ?", (set_id,)).fetchone()
        return dict(row)


def _insert_word_set_items_on_conn(
    conn: sqlite3.Connection,
    set_id: int,
    items: Sequence[dict[str, Any]],
    *,
    now_iso: str,
) -> int:
    prepared: list[tuple[int, int, str, str, str]] = []
    for item in items:
        seq_raw = item.get("sequence_id")
        if seq_raw is None:
            raise ValueError("Each word set item requires a canonical sequence_id.")
        seq_id = int(seq_raw)
        if seq_id <= 0:
            raise ValueError("Each word set item requires a positive canonical sequence_id.")
        reading = normalize_word_reading(item.get("reading") or "")
        expr = normalize_word_expression(item.get("expression") or "")
        prepared.append((set_id, seq_id, reading, expr, now_iso))
    if not prepared:
        return 0
    conn.executemany(
        """
        INSERT INTO word_set_items (set_id, sequence_id, reading, expression, added_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(set_id, sequence_id, reading)
        DO UPDATE SET expression = CASE WHEN excluded.expression != '' THEN excluded.expression ELSE word_set_items.expression END
        """,
        prepared,
    )
    return len(prepared)


def add_word_set_items(
    slug_or_id: str | int,
    items: Sequence[dict[str, Any]],
    *,
    db_path: Path | str | None = None,
) -> int:
    """Add canonical (sequence_id, reading, expression) items to a custom word set."""
    now_iso = datetime.now(timezone.utc).isoformat()
    with db_session(db_path) as conn:
        ensure_vocab_practice_tables(conn)
        ws = _find_custom_word_set_on_conn(conn, slug_or_id)
        if ws is None:
            raise LookupError(f"Word set '{slug_or_id}' not found.")
        count = _insert_word_set_items_on_conn(conn, int(ws["id"]), items, now_iso=now_iso)
        conn.execute("UPDATE word_sets SET updated_at = ? WHERE id = ?", (now_iso, ws["id"]))
        conn.commit()
        return count


def delete_custom_word_set(
    slug_or_id: str | int,
    *,
    db_path: Path | str | None = None,
) -> bool:
    """Delete a custom word set by slug or numeric id."""
    with db_session(db_path) as conn:
        ensure_vocab_practice_tables(conn)
        ws = _find_custom_word_set_on_conn(conn, slug_or_id)
        if ws is None:
            return False
        conn.execute("DELETE FROM word_sets WHERE id = ?", (ws["id"],))
        conn.commit()
        return True


def _find_custom_word_set_on_conn(
    conn: sqlite3.Connection,
    slug_or_id: str | int,
) -> sqlite3.Row | None:
    if isinstance(slug_or_id, int) or (isinstance(slug_or_id, str) and slug_or_id.isdigit()):
        row = conn.execute("SELECT * FROM word_sets WHERE id = ?", (int(slug_or_id),)).fetchone()
        if row is not None:
            return row
    return conn.execute("SELECT * FROM word_sets WHERE slug = ?", (str(slug_or_id),)).fetchone()


def _compute_tag_set_coverage_on_conn(
    conn: sqlite3.Connection,
    *,
    slug: str,
    name: str,
    description: str,
    category: str,
    subtype: str = "",
) -> WordSetCoverage:
    """Compute known/learning/total coverage for a tag-based word set, excluding blacklisted."""
    clauses = ["wc.category = ?"]
    params: list[Any] = [category]
    if subtype:
        clauses.append("wc.subtype = ?")
        params.append(subtype)
    where = " AND ".join(clauses)

    # Distinct sequence_ids matching category(+subtype) paired with any word_states rows
    # respecting (sequence_id, reading) and excluding 'blacklisted'.
    cat_seqs = conn.execute(
        f"SELECT DISTINCT wc.sequence_id FROM word_categories wc WHERE {where}",
        params,
    ).fetchall()
    seq_ids = [int(r["sequence_id"]) for r in cat_seqs]
    if not seq_ids:
        return WordSetCoverage(
            slug=slug,
            name=name,
            set_type="category",
            description=description,
            known_count=0,
            learning_count=0,
            total_count=0,
            coverage_ratio=0.0,
            filter_category=category,
            filter_subtype=subtype,
        )

    placeholders = ",".join("?" for _ in seq_ids)
    ws_rows = conn.execute(
        f"SELECT sequence_id, reading, state FROM word_states WHERE sequence_id IN ({placeholders})",
        seq_ids,
    ).fetchall()

    by_seq: dict[int, list[str]] = {}
    for row in ws_rows:
        by_seq.setdefault(int(row["sequence_id"]), []).append(str(row["state"]))

    known_count = 0
    learning_count = 0
    total_count = 0
    for seq_id in seq_ids:
        states = by_seq.get(seq_id)
        if not states:
            total_count += 1
            continue
        for st in states:
            if st == "blacklisted":
                continue
            total_count += 1
            if st == "known":
                known_count += 1
            elif st == "learning":
                learning_count += 1

    ratio = round(known_count / total_count, 4) if total_count > 0 else 0.0
    return WordSetCoverage(
        slug=slug,
        name=name,
        set_type="category",
        description=description,
        known_count=known_count,
        learning_count=learning_count,
        total_count=total_count,
        coverage_ratio=ratio,
        filter_category=category,
        filter_subtype=subtype,
    )


def _compute_custom_set_coverage_on_conn(
    conn: sqlite3.Connection,
    ws_row: sqlite3.Row,
) -> WordSetCoverage:
    items = conn.execute(
        "SELECT sequence_id, reading, expression FROM word_set_items WHERE set_id = ?",
        (ws_row["id"],),
    ).fetchall()
    known_count = 0
    learning_count = 0
    total_count = 0
    for item in items:
        seq_id = int(item["sequence_id"])
        norm_read = normalize_word_reading(item["reading"])
        if norm_read:
            st_row = conn.execute(
                "SELECT state FROM word_states WHERE sequence_id = ? AND reading = ?",
                (seq_id, norm_read),
            ).fetchone()
        else:
            st_row = conn.execute(
                "SELECT state FROM word_states WHERE sequence_id = ? ORDER BY id ASC LIMIT 1",
                (seq_id,),
            ).fetchone()
        state = str(st_row["state"]) if st_row is not None else "unseen"
        if state == "blacklisted":
            continue
        total_count += 1
        if state == "known":
            known_count += 1
        elif state == "learning":
            learning_count += 1

    ratio = round(known_count / total_count, 4) if total_count > 0 else 0.0
    return WordSetCoverage(
        slug=str(ws_row["slug"]),
        name=str(ws_row["name"]),
        set_type=str(ws_row["set_type"] or "custom"),
        description=str(ws_row["description"] or ""),
        known_count=known_count,
        learning_count=learning_count,
        total_count=total_count,
        coverage_ratio=ratio,
        filter_category=str(ws_row["filter_category"] or ""),
        filter_subtype=str(ws_row["filter_subtype"] or ""),
    )


def list_word_sets_with_coverage(*, db_path: Path | str | None = None) -> list[WordSetCoverage]:
    """Return built-in tag-based word sets and custom word sets with live coverage metrics."""
    results: list[WordSetCoverage] = []
    with db_session(db_path) as conn:
        ensure_vocab_state_tables(conn)
        ensure_vocab_practice_tables(conn)
        for slug, name, desc, cat, sub in BUILTIN_TAG_SETS:
            results.append(
                _compute_tag_set_coverage_on_conn(
                    conn,
                    slug=slug,
                    name=name,
                    description=desc,
                    category=cat,
                    subtype=sub,
                )
            )
        custom_rows = conn.execute("SELECT * FROM word_sets ORDER BY id ASC").fetchall()
        for ws in custom_rows:
            results.append(_compute_custom_set_coverage_on_conn(conn, ws))
    return results


def get_word_set_detail(
    slug_or_id: str | int,
    *,
    db_path: Path | str | None = None,
) -> dict[str, Any] | None:
    """Return a word set's coverage and constituent entries (custom or built-in)."""
    with db_session(db_path) as conn:
        ensure_vocab_state_tables(conn)
        ensure_vocab_practice_tables(conn)

        for slug, name, desc, cat, sub in BUILTIN_TAG_SETS:
            if str(slug_or_id) == slug:
                cov = _compute_tag_set_coverage_on_conn(
                    conn, slug=slug, name=name, description=desc, category=cat, subtype=sub
                )
                clauses = ["wc.category = ?"]
                params: list[Any] = [cat]
                if sub:
                    clauses.append("wc.subtype = ?")
                    params.append(sub)
                rows = conn.execute(
                    f"""
                    SELECT DISTINCT wc.sequence_id, ws.reading, ws.expression, COALESCE(ws.state, 'unseen') AS state
                    FROM word_categories wc
                    LEFT JOIN word_states ws ON ws.sequence_id = wc.sequence_id
                    WHERE {' AND '.join(clauses)} AND COALESCE(ws.state, 'unseen') != 'blacklisted'
                    ORDER BY wc.sequence_id ASC
                    """,
                    params,
                ).fetchall()
                return {
                    **cov.to_dict(),
                    "items": [dict(r) for r in rows],
                }

        ws_row = _find_custom_word_set_on_conn(conn, slug_or_id)
        if ws_row is None:
            return None
        cov = _compute_custom_set_coverage_on_conn(conn, ws_row)
        item_rows = conn.execute(
            """
            SELECT wsi.sequence_id, wsi.reading, wsi.expression, wsi.added_at,
                   COALESCE(ws.state, 'unseen') AS state
            FROM word_set_items wsi
            LEFT JOIN word_states ws
              ON ws.sequence_id = wsi.sequence_id
             AND (wsi.reading = '' OR ws.reading = wsi.reading)
            WHERE wsi.set_id = ? AND COALESCE(ws.state, 'unseen') != 'blacklisted'
            ORDER BY wsi.id ASC
            """,
            (ws_row["id"],),
        ).fetchall()
        return {
            **cov.to_dict(),
            "items": [dict(r) for r in item_rows],
        }


def record_practice_result(
    *,
    sequence_id: int,
    reading: str = "",
    expression: str = "",
    question_type: str,
    category: str = "",
    is_correct: bool,
    user_answer: str = "",
    expected_answer: str = "",
    response_time_ms: int | None = None,
    db_path: Path | str | None = None,
    now_iso: str | None = None,
) -> int:
    """Persist a single graded vocabulary practice attempt in vocab_practice_results."""
    ts = now_iso or datetime.now(timezone.utc).isoformat()
    norm_read = normalize_word_reading(reading)
    norm_expr = normalize_word_expression(expression)
    with db_session(db_path) as conn:
        ensure_vocab_practice_tables(conn)
        cur = conn.execute(
            """
            INSERT INTO vocab_practice_results (
                sequence_id, reading, expression, question_type, category,
                is_correct, user_answer, expected_answer, response_time_ms, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                int(sequence_id),
                norm_read,
                norm_expr,
                str(question_type),
                str(category or ""),
                1 if is_correct else 0,
                str(user_answer or ""),
                str(expected_answer or ""),
                int(response_time_ms) if response_time_ms is not None else None,
                ts,
            ),
        )
        conn.commit()
        return int(cur.lastrowid)


def get_practice_stats(*, db_path: Path | str | None = None) -> dict[str, Any]:
    """Return aggregate accuracy stats per question type and category from vocab_practice_results."""
    with db_session(db_path) as conn:
        ensure_vocab_practice_tables(conn)
        totals = conn.execute(
            """
            SELECT
                COUNT(*) AS total_attempts,
                COALESCE(SUM(is_correct), 0) AS total_correct
            FROM vocab_practice_results
            """
        ).fetchone()
        by_type_rows = conn.execute(
            """
            SELECT
                question_type,
                COUNT(*) AS attempts,
                COALESCE(SUM(is_correct), 0) AS correct
            FROM vocab_practice_results
            GROUP BY question_type
            ORDER BY question_type ASC
            """
        ).fetchall()
        by_cat_rows = conn.execute(
            """
            SELECT
                category,
                COUNT(*) AS attempts,
                COALESCE(SUM(is_correct), 0) AS correct
            FROM vocab_practice_results
            WHERE category != ''
            GROUP BY category
            ORDER BY category ASC
            """
        ).fetchall()

    total_attempts = int(totals["total_attempts"]) if totals else 0
    total_correct = int(totals["total_correct"]) if totals else 0
    return {
        "total_attempts": total_attempts,
        "total_correct": total_correct,
        "accuracy": round(total_correct / total_attempts, 4) if total_attempts > 0 else 0.0,
        "by_question_type": [
            {
                "question_type": str(r["question_type"]),
                "attempts": int(r["attempts"]),
                "correct": int(r["correct"]),
                "accuracy": round(int(r["correct"]) / int(r["attempts"]), 4),
            }
            for r in by_type_rows
        ],
        "by_category": [
            {
                "category": str(r["category"]),
                "attempts": int(r["attempts"]),
                "correct": int(r["correct"]),
                "accuracy": round(int(r["correct"]) / int(r["attempts"]), 4),
            }
            for r in by_cat_rows
        ],
    }


def analyze_sentence_usage_tags(
    sentence: str,
    *,
    dict_engine: Any = None,
    morphemes: Sequence[Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Compute deterministic per-sentence grammatical/collocational usage tags.

    Examples:
    - na-adj + に -> 'adverbial_na_ni'
    - mimetic + と -> 'quotative_mimetic_to'
    - mimetic + する -> 'mimetic_suru'
    - i-adj く -> 'adverbial_i_ku'
    - を + vt verb -> 'transitive_wo'
    - が + vi verb -> 'intransitive_ga'
    """
    clean_sentence = str(sentence or "").strip()
    if not clean_sentence:
        return []

    tokens = list(morphemes) if morphemes is not None else []
    if not tokens:
        try:
            from app.services.sentence_analysis import analyze

            analysis = analyze(clean_sentence, dict_lookup=dict_engine)
            tokens = list(analysis.merged)
        except Exception:
            tokens = []

    if not tokens:
        return []

    usage_tags: list[dict[str, Any]] = []
    seen_tags: set[tuple[str, str]] = set()

    def _emit(tag: str, surface: str, lemma: str, sequence_id: int | None, detail: str) -> None:
        key = (tag, surface)
        if key not in seen_tags:
            seen_tags.add(key)
            usage_tags.append(
                {
                    "tag": tag,
                    "surface": surface,
                    "lemma": lemma,
                    "sequence_id": sequence_id,
                    "detail": detail,
                }
            )

    targets_cache: dict[int, WordTarget | None] = {}

    def _get_target(tok: Any) -> WordTarget | None:
        seq = getattr(tok, "sequence_id", None)
        if seq is None or dict_engine is None:
            return None
        if seq not in targets_cache:
            targets_cache[seq] = build_word_target_from_dict(
                dict_engine,
                expression=getattr(tok, "lemma", ""),
                reading=getattr(tok, "canonical_reading", None) or getattr(tok, "reading", ""),
                sequence_id=seq,
            )
        return targets_cache[seq]

    for idx, tok in enumerate(tokens):
        pos = tuple(getattr(tok, "pos", ()) or ())
        surface = str(getattr(tok, "surface", "") or "")
        lemma = str(getattr(tok, "lemma", "") or surface)
        seq = getattr(tok, "sequence_id", None)
        nxt = tokens[idx + 1] if idx + 1 < len(tokens) else None
        prv = tokens[idx - 1] if idx - 1 >= 0 else None
        nxt_surface = str(getattr(nxt, "surface", "") or "") if nxt else ""
        nxt_lemma = str(getattr(nxt, "lemma", "") or "") if nxt else ""
        prv_surface = str(getattr(prv, "surface", "") or "") if prv else ""

        target = _get_target(tok)
        cats = set(target.categories) if target else set()

        # Check mimetic + と / する
        is_mimetic = (
            CAT_ONOMATOPOEIA in cats
            or katakana_to_hiragana(lemma) in ON_MIM_SUBTYPES
            or katakana_to_hiragana(surface) in ON_MIM_SUBTYPES
        )
        if is_mimetic:
            if nxt_surface == "と":
                _emit(
                    "quotative_mimetic_to",
                    f"{surface}と",
                    lemma,
                    seq,
                    "mimetic + と -> quotative adverbial usage",
                )
            elif nxt_lemma == "する" or nxt_surface.startswith(("する", "した", "して", "し")):
                _emit(
                    "mimetic_suru",
                    f"{surface}{nxt_surface}",
                    lemma,
                    seq,
                    "mimetic + する -> verbal usage",
                )

        # Check na-adj + に (handles both split [静か, に] and Sudachi-merged [静かに])
        is_na_adj = CAT_ADJECTIVE_NA in cats or (bool(pos) and pos[0] == "形状詞")
        if is_na_adj:
            if nxt_surface == "に":
                _emit(
                    "adverbial_na_ni",
                    f"{surface}に",
                    lemma,
                    seq,
                    "na-adj + に -> adverbial usage",
                )
            elif surface.endswith("に") and (
                surface[:-1] == lemma or (lemma.endswith("だ") and surface[:-1] == lemma[:-1])
            ):
                _emit(
                    "adverbial_na_ni",
                    surface,
                    lemma,
                    seq,
                    "na-adj + に -> adverbial usage",
                )

        # Check i-adj adverbial く
        is_i_adj = CAT_ADJECTIVE_I in cats or (bool(pos) and pos[0] == "形容詞")
        if is_i_adj and surface.endswith("く") and lemma.endswith("い") and surface != lemma:
            _emit(
                "adverbial_i_ku",
                surface,
                lemma,
                seq,
                "i-adj く -> adverbial usage",
            )

        # Check を + vt / が + vi
        if prv_surface == "を" and CAT_VERB_TRANSITIVE in cats:
            _emit(
                "transitive_wo",
                f"を{surface}",
                lemma,
                seq,
                "を + vt -> transitive verb usage",
            )
        if prv_surface == "が" and CAT_VERB_INTRANSITIVE in cats:
            _emit(
                "intransitive_ga",
                f"が{surface}",
                lemma,
                seq,
                "が + vi -> intransitive verb usage",
            )

    return usage_tags
