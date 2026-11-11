"""Shared lenient Japanese answer normalizer (NFKC, kana, romaji, and canonical variant matching)."""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Iterable

from kiroku_dictionary.schema import katakana_to_hiragana


_ROMAJI_MAP: dict[str, str] = {
    # 4-char
    "ltsu": "っ",
    "xtsu": "っ",
    # 3-char yoon / special
    "kya": "きゃ", "kyu": "きゅ", "kyo": "きょ",
    "gya": "ぎゃ", "gyu": "ぎゅ", "gyo": "ぎょ",
    "sha": "しゃ", "shu": "しゅ", "sho": "しょ", "she": "しぇ",
    "sya": "しゃ", "syu": "しゅ", "syo": "しょ", "sye": "しぇ",
    "ja": "じゃ", "ju": "じゅ", "jo": "じょ", "je": "じぇ",
    "jya": "じゃ", "jyu": "じゅ", "jyo": "じょ",
    "zya": "じゃ", "zyu": "じゅ", "zyo": "じょ",
    "cha": "ちゃ", "chu": "ちゅ", "cho": "ちょ", "che": "ちぇ",
    "tya": "ちゃ", "tyu": "ちゅ", "tyo": "ちょ", "tye": "ちぇ",
    "cya": "ちゃ", "cyu": "ちゅ", "cyo": "ちょ",
    "dya": "ぢゃ", "dyu": "ぢゅ", "dyo": "ぢょ",
    "nya": "にゃ", "nyu": "にゅ", "nyo": "にょ",
    "hya": "ひゃ", "hyu": "ひゅ", "hyo": "ひょ",
    "bya": "びゃ", "byu": "びゅ", "byo": "びょ",
    "pya": "ぴゃ", "pyu": "ぴゅ", "pyo": "ぴょ",
    "mya": "みゃ", "myu": "みゅ", "myo": "みょ",
    "rya": "りゃ", "ryu": "りゅ", "ryo": "りょ",
    "shi": "し", "chi": "ち", "tsu": "つ", "dzu": "づ",
    "xya": "ゃ", "xyu": "ゅ", "xyo": "ょ",
    "lya": "ゃ", "lyu": "ゅ", "lyo": "ょ",
    "xwa": "ゎ", "lwa": "ゎ",
    "thi": "てぃ", "dhi": "でぃ", "thu": "てゅ", "dhu": "でゅ",
    "tsa": "つぁ", "tsi": "つぃ", "tse": "つぇ", "tso": "つぉ",
    # 2-char
    "ka": "か", "ki": "き", "ku": "く", "ke": "け", "ko": "こ",
    "ga": "が", "gi": "ぎ", "gu": "ぐ", "ge": "げ", "go": "ご",
    "sa": "さ", "si": "し", "su": "す", "se": "せ", "so": "そ",
    "za": "ざ", "zi": "じ", "ji": "じ", "zu": "ず", "ze": "ぜ", "zo": "ぞ",
    "ta": "た", "ti": "ち", "tu": "つ", "te": "て", "to": "と",
    "da": "だ", "di": "ぢ", "du": "づ", "de": "で", "do": "ど",
    "na": "な", "ni": "に", "nu": "ぬ", "ne": "ね", "no": "の",
    "ha": "は", "hi": "ひ", "hu": "ふ", "fu": "ふ", "he": "へ", "ho": "ほ",
    "ba": "ば", "bi": "び", "bu": "ぶ", "be": "べ", "bo": "ぼ",
    "pa": "ぱ", "pi": "ぴ", "pu": "ぷ", "pe": "ぺ", "po": "ぽ",
    "ma": "ま", "mi": "み", "mu": "む", "me": "め", "mo": "も",
    "ya": "や", "yu": "ゆ", "yo": "よ",
    "ra": "ら", "ri": "り", "ru": "る", "re": "れ", "ro": "ろ",
    "wa": "わ", "wi": "うぃ", "we": "うぇ", "wo": "を",
    "fa": "ふぁ", "fi": "ふぃ", "fe": "ふぇ", "fo": "ふぉ",
    "xa": "ぁ", "xi": "ぃ", "xu": "ぅ", "xe": "ぇ", "xo": "ぉ",
    "la": "ぁ", "li": "ぃ", "lu": "ぅ", "le": "ぇ", "lo": "ぉ",
    "nn": "ん", "n'": "ん",
    # 1-char vowels
    "a": "あ", "i": "い", "u": "う", "e": "え", "o": "お",
}

_ROMAJI_VOWELS = frozenset({"a", "i", "u", "e", "o"})
_STRIP_PUNCT_RE = re.compile(r"[\s\u3000。、．，！？!?,.\"「」『』（）()]+")


def is_ascii_romaji(text: str) -> bool:
    """Return True if text consists purely of ASCII letters, apostrophes, hyphens, and spaces."""
    if not text:
        return False
    has_alpha = False
    for ch in text:
        if ch.isascii() and ch.isalpha():
            has_alpha = True
        elif ch in ("'", "-", " "):
            continue
        else:
            return False
    return has_alpha


def romaji_to_hiragana(text: str) -> str:
    """Deterministically convert Hepburn/Kunrei romaji into hiragana (WanaKana-compatible)."""
    s = unicodedata.normalize("NFKC", text or "").strip().lower()
    if not s:
        return ""
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        ch = s[i]
        if ch in (" ", "\t", "\u3000"):
            i += 1
            continue
        if ch == "-":
            out.append("ー")
            i += 1
            continue
        if ch == "'":
            i += 1
            continue
        # Syllabic 'n' handling: nn / n' -> ん; n before non-vowel/non-y/end -> ん
        if ch == "n":
            if i + 1 < n and s[i + 1] in ("n", "'"):
                out.append("ん")
                i += 2
                continue
            if i + 1 == n or (s[i + 1] not in _ROMAJI_VOWELS and s[i + 1] != "y"):
                out.append("ん")
                i += 1
                continue
        # Syllabic 'm' before b/p/m (e.g. shimbun, tempu)
        if ch == "m" and i + 1 < n and s[i + 1] in ("b", "p", "m"):
            out.append("ん")
            i += 1
            continue
        # Geminate consonant -> っ (e.g. kk, tt, pp, ss, or tch -> っち)
        if i + 1 < n and ch.isalpha() and ch not in _ROMAJI_VOWELS and ch != "n":
            nxt = s[i + 1]
            if ch == nxt or (ch == "t" and s[i : i + 3] == "tch"):
                out.append("っ")
                i += 1
                continue

        matched = False
        for length in (4, 3, 2, 1):
            if i + length <= n:
                chunk = s[i : i + length]
                if chunk in _ROMAJI_MAP:
                    out.append(_ROMAJI_MAP[chunk])
                    i += length
                    matched = True
                    break
        if not matched:
            out.append(ch)
            i += 1
    return "".join(out)


def normalize_japanese_answer(text: str, *, convert_romaji: bool = True) -> str:
    """
    Normalize a learner's Japanese typed answer:
    - NFKC folding (full-width ASCII/kana -> standard)
    - Strip outer spaces & Japanese/Latin punctuation
    - Optional deterministic romaji -> hiragana conversion
    - Katakana -> hiragana folding
    """
    raw = unicodedata.normalize("NFKC", str(text or "")).strip()
    if not raw:
        return ""
    cleaned = _STRIP_PUNCT_RE.sub("", raw)
    if not cleaned:
        return ""
    if convert_romaji and is_ascii_romaji(cleaned):
        cleaned = romaji_to_hiragana(cleaned)
    cleaned = cleaned.replace("'", "")
    if not cleaned:
        return ""
    return katakana_to_hiragana(cleaned).lower()


def _resolve_canonical_variants(
    answer: str,
    *,
    expected_sequence_id: int | None = None,
    dict_engine: Any = None,
) -> tuple[str, ...]:
    """Resolve an answer containing kanji/okurigana variants against dict_engine if available."""
    if not answer or dict_engine is None or not expected_sequence_id:
        return ()
    variants: list[str] = []
    try:
        if hasattr(dict_engine, "resolve_canonical"):
            canon = dict_engine.resolve_canonical(answer)
            if canon is not None and int(canon.sequence_id) == int(expected_sequence_id):
                variants.extend([canon.term, canon.reading])
        if hasattr(dict_engine, "lookup_terms"):
            groups = dict_engine.lookup_terms(answer, max_results=5, mode="word")
            for grp in groups:
                for defn in getattr(grp, "definitions", ()):
                    if int(getattr(defn, "sequence", 0)) == int(expected_sequence_id):
                        variants.extend([grp.term, grp.reading])
                        break
    except Exception:
        return ()
    return tuple(dict.fromkeys(v for v in variants if v))


def check_lenient_answer(
    user_answer: str,
    *,
    expected_answers: Iterable[str],
    accepted_forms: Iterable[str] = (),
    expected_sequence_id: int | None = None,
    allow_kanji: bool = True,
    dict_engine: Any = None,
) -> tuple[bool, str, str]:
    """
    Compare user_answer against expected_answers and accepted_forms using lenient normalization.

    Returns (is_correct, normalized_user_answer, matched_variant).
    """
    norm_user = normalize_japanese_answer(user_answer, convert_romaji=True)
    if not norm_user:
        return False, "", ""

    candidate_pool: list[str] = list(expected_answers)
    if allow_kanji:
        candidate_pool.extend(accepted_forms)

    normalized_targets: dict[str, str] = {}
    for target in candidate_pool:
        norm_t = normalize_japanese_answer(target, convert_romaji=True)
        if norm_t and norm_t not in normalized_targets:
            normalized_targets[norm_t] = target

    if norm_user in normalized_targets:
        return True, norm_user, normalized_targets[norm_user]

    if allow_kanji and expected_sequence_id and dict_engine is not None:
        raw_clean = _STRIP_PUNCT_RE.sub("", unicodedata.normalize("NFKC", str(user_answer or "")).strip())
        resolved = _resolve_canonical_variants(
            raw_clean,
            expected_sequence_id=expected_sequence_id,
            dict_engine=dict_engine,
        )
        for variant in resolved:
            norm_v = normalize_japanese_answer(variant, convert_romaji=True)
            if norm_v in normalized_targets:
                return True, norm_user, variant

    return False, norm_user, ""
