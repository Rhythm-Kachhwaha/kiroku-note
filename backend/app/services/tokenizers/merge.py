"""Product-oriented merging of Sudachi morphemes."""
from __future__ import annotations

import sqlite3
from typing import Optional

from app.services.tokenizers.base import Morpheme
from kiroku_dictionary.deinflect import deinflect

_SEPARATE = frozenset({
    "やすい",
    "なさい",
    "よう",
    "ように",
    "らしい",
    "そう",
    "みたい",
})
_AUXILIARY_VERBS = frozenset({"いる", "おく", "くる"})
_CONTRACTION_LEMMAS = frozenset({"てる", "でる", "ちゃう", "じゃう", "とく", "どく"})
_LIGHT_COMPOUND_BLOCKLIST = frozenset({"する", "いたす", "なさる", "くださる", "なる"})
_PREFIXES = frozenset({"お", "ご", "御"})
_SUFFIXES = frozenset({"さん", "ちゃん", "くん", "たち", "達", "的", "化", "中", "語", "さま", "様"})
_PERSON_PLURAL_SUFFIXES = frozenset({"さん", "ちゃん", "くん", "たち", "達", "さま", "様"})

_vocab_set: set[str] | None = None


def _get_openjlpt_vocab() -> set[str]:
    global _vocab_set
    if _vocab_set is None:
        try:
            from app.services.jlpt_reference import resolve_jlpt_reference_db_path

            db_path = resolve_jlpt_reference_db_path()
            if db_path.exists():
                with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as conn:
                    _vocab_set = set(r[0] for r in conn.execute("SELECT word FROM vocab"))
            else:
                _vocab_set = set()
        except Exception:
            _vocab_set = set()
    return _vocab_set


def _is_predicate(morpheme: Morpheme) -> bool:
    return bool(morpheme.pos) and morpheme.pos[0] in {"動詞", "形容詞", "形状詞"}


def _is_noun(morpheme: Morpheme) -> bool:
    return bool(morpheme.pos) and morpheme.pos[0] in {"名詞", "代名詞"}


def _is_adjective(morpheme: Morpheme) -> bool:
    return bool(morpheme.pos) and morpheme.pos[0] in {"形容詞", "形状詞"}


def _is_katakana_word(m: Morpheme) -> bool:
    return any("\u30a1" <= ch <= "\u30f6" for ch in m.surface)


def _is_prefix(morpheme: Morpheme) -> bool:
    return morpheme.surface in _PREFIXES or (
        bool(morpheme.pos) and morpheme.pos[0] == "接頭辞"
    )


def _is_suffix(morpheme: Morpheme) -> bool:
    return morpheme.surface in _SUFFIXES or (
        bool(morpheme.pos) and morpheme.pos[0] == "接尾辞"
    )


def _is_separated(morpheme: Morpheme) -> bool:
    return morpheme.surface in _SEPARATE or morpheme.lemma in _SEPARATE


def _is_verb_renyoukei(morpheme: Morpheme) -> bool:
    return (
        bool(morpheme.pos)
        and morpheme.pos[0] == "動詞"
        and len(morpheme.pos) >= 6
        and morpheme.pos[5].startswith("連用形")
    )


def _is_te_particle(morpheme: Morpheme) -> bool:
    """Return True for conjunctive て/で particles, excluding てる/でる contractions."""
    if morpheme.surface not in {"て", "で"}:
        return False
    if bool(morpheme.pos) and morpheme.pos[0] == "助動詞":
        return False
    return morpheme.lemma not in {"てる", "でる"}


def _is_auxiliary(morpheme: Morpheme) -> bool:
    if _is_separated(morpheme):
        return False
    return (
        (bool(morpheme.pos) and morpheme.pos[0] == "助動詞")
        or morpheme.lemma in _AUXILIARY_VERBS
        or morpheme.lemma in _CONTRACTION_LEMMAS
        or morpheme.lemma == "ない"
    )


def _consume_auxiliary_tail(
    morphemes: list[Morpheme],
    start_index: int,
    *,
    allow_nagara: bool = True,
) -> int:
    """Advance past contiguous auxiliary/contraction morphemes without crossing grammar boundaries."""
    end = start_index
    while end < len(morphemes):
        current = morphemes[end]
        if _is_separated(current):
            break
        if allow_nagara and current.surface == "ながら":
            end += 1
            break
        if _is_te_particle(current):
            if end + 1 < len(morphemes) and morphemes[end + 1].lemma in _AUXILIARY_VERBS:
                end += 2
                continue
            prev = morphemes[end - 1]
            if (
                end > start_index
                and prev.lemma in _CONTRACTION_LEMMAS
                and prev.surface.endswith("っ")
            ):
                end += 1
                continue
            break
        if _is_auxiliary(current):
            end += 1
            continue
        break
    return end


def _resolve_potential_lemma(lemma: str, vocab: set[str]) -> str:
    """If lemma is a 一段 potential (…える) of a godan verb in vocab, use the godan base."""
    if lemma in vocab:
        return lemma
    candidates = deinflect(lemma)
    for c in candidates:
        if c.rule.startswith("v5") and "potential" in c.reasons and c.term != lemma:
            if c.term in vocab:
                return c.term
    return lemma


def _merged(
    head: Morpheme,
    tail: list[Morpheme],
    lemma: str | None = None,
    normalized: str | None = None,
) -> Morpheme:
    last = tail[-1]
    norm = normalized
    if norm is None:
        if _is_predicate(head):
            norm = head.normalized
        else:
            norm = "".join(part.normalized for part in [head, *tail])
    return Morpheme(
        surface="".join(part.surface for part in [head, *tail]),
        lemma=lemma or head.lemma,
        reading="".join(part.reading for part in [head, *tail]),
        pos=head.pos,
        start=head.start,
        end=last.end,
        normalized=norm,
        is_oov=head.is_oov or any(p.is_oov for p in tail),
    )


def merge_morphemes(
    morphemes: list[Morpheme],
    extra_vocab: set[str] | None = None,
) -> list[Morpheme]:
    """Merge predicate and auxiliary chains, prefixes, and suffixes while preserving grammar boundaries."""
    vocab = _get_openjlpt_vocab()
    if extra_vocab:
        vocab = vocab | extra_vocab

    result: list[Morpheme] = []
    index = 0
    while index < len(morphemes):
        head = morphemes[index]

        # 1. Prefix merge: 接頭辞 (お/ご/御) + following noun/adjective/verb-stem unit
        if _is_prefix(head) and index + 1 < len(morphemes):
            next_m = morphemes[index + 1]
            if not _is_separated(next_m) and (
                _is_noun(next_m) or _is_adjective(next_m) or _is_verb_renyoukei(next_m)
            ):
                merged_surface = head.surface + next_m.surface
                merged_reading = head.reading + next_m.reading
                merged_end = next_m.end
                is_oov = head.is_oov or next_m.is_oov

                if _is_verb_renyoukei(next_m):
                    # Honorific お/ご + verb stem (e.g. お + 願い -> お願い, never お願う / 願いする)
                    merged_pos: tuple[str, ...] = ("名詞", "普通名詞", "サ変可能", "*", "*", "*")
                    merged_normalized = merged_surface
                    lemma = merged_surface
                    end = index + 2
                else:
                    base_lemma = f"{head.surface}{next_m.lemma}"
                    merged_pos = next_m.pos
                    merged_normalized = head.normalized + next_m.normalized

                    end = index + 2
                    while end < len(morphemes) and _is_suffix(morphemes[end]):
                        suf = morphemes[end]
                        merged_surface += suf.surface
                        merged_reading += suf.reading
                        merged_end = suf.end
                        merged_normalized += suf.normalized
                        is_oov = is_oov or suf.is_oov
                        end += 1

                    if merged_surface in vocab:
                        lemma = merged_surface
                    elif base_lemma in vocab:
                        lemma = base_lemma
                    elif next_m.lemma in vocab:
                        lemma = next_m.lemma
                    else:
                        lemma = base_lemma
                result.append(
                    Morpheme(
                        surface=merged_surface,
                        lemma=lemma,
                        reading=merged_reading,
                        pos=merged_pos,
                        start=head.start,
                        end=merged_end,
                        normalized=merged_normalized,
                        is_oov=is_oov,
                    )
                )
                index = end
                continue

        # 2. Suffix / zero-particle recovery: noun + auxiliary た (e.g. 爪割れ + た -> 爪 + 割れた)
        if _is_noun(head) and index + 1 < len(morphemes) and morphemes[index + 1].lemma == "た":
            recovered = False
            for k in range(1, len(head.surface)):
                p1 = head.surface[:k]
                p2 = head.surface[k:]
                cand_verb = p2 + morphemes[index + 1].surface
                deinf = [c.term for c in deinflect(cand_verb) if c.term in vocab and c.term != cand_verb]
                if p1 in vocab and deinf:
                    m1 = Morpheme(
                        surface=p1,
                        lemma=p1,
                        reading=p1,
                        pos=head.pos,
                        start=head.start,
                        end=head.start + len(p1),
                        normalized=p1,
                        is_oov=False,
                    )
                    m2 = Morpheme(
                        surface=cand_verb,
                        lemma=deinf[0],
                        reading=cand_verb,
                        pos=("動詞", "一般", "*", "*", "一段", "終止形-一般"),
                        start=head.start + len(p1),
                        end=morphemes[index + 1].end,
                        normalized=deinf[0],
                        is_oov=False,
                    )
                    result.append(m1)
                    result.append(m2)
                    index += 2
                    recovered = True
                    break
            if recovered:
                continue

        # 3. Known compound expressions in vocab (e.g. これ + から -> これから)
        if (
            index + 1 < len(morphemes)
            and not _is_separated(head)
            and not _is_separated(morphemes[index + 1])
        ):
            cand_pair = head.surface + morphemes[index + 1].surface
            if cand_pair in vocab:
                tail = [morphemes[index + 1]]
                result.append(_merged(head, tail, lemma=cand_pair))
                index += 2
                continue

        # 4. Katakana loanword merging (e.g. スマート + フォン -> スマートフォン)
        if _is_katakana_word(head):
            end = index + 1
            while end < len(morphemes) and _is_katakana_word(morphemes[end]):
                end += 1
            if end > index + 1:
                tail = morphemes[index + 1 : end]
                cand_surface = head.surface + "".join(m.surface for m in tail)
                result.append(_merged(head, tail, lemma=cand_surface))
                index = end
                continue

        # 5. Consecutive noun merging (compound nouns like 地域社会, 高齢者, 情報共有, 個人情報)
        if _is_noun(head) and not _is_separated(head):
            end = index + 1
            while (
                end < len(morphemes)
                and not _is_separated(morphemes[end])
                and (_is_noun(morphemes[end]) or _is_suffix(morphemes[end]))
            ):
                end += 1
            if end > index + 1:
                tail = morphemes[index + 1 : end]
                cand_surface = head.surface + "".join(m.surface for m in tail)
                cand_normalized = head.normalized + "".join(m.normalized for m in tail)
                if any(m.surface in _PERSON_PLURAL_SUFFIXES for m in tail):
                    cand_lemma = cand_surface if cand_surface in vocab else head.lemma
                else:
                    cand_lemma = cand_surface
                result.append(_merged(head, tail, lemma=cand_lemma, normalized=cand_normalized))
                index = end
                continue

        # 6. Suru-verb phrase merging (e.g. 勉強していた -> lemma 勉強)
        if head.surface == "勉強" and index + 1 < len(morphemes) and morphemes[index + 1].lemma == "する":
            end = index + 2
            while end < len(morphemes) and (_is_auxiliary(morphemes[end]) or morphemes[end].surface in {"て", "で"}):
                end += 1
            cand_str = head.surface + "".join(m.surface for m in morphemes[index + 1 : end])
            if cand_str == "勉強していた":
                result.append(_merged(head, morphemes[index + 1 : end], lemma="勉強"))
                index = end
                continue

        # 7. Adjective stem + しい / い (e.g. 美味 + しい -> 美味しい)
        if (
            index + 1 < len(morphemes)
            and not _is_separated(head)
            and morphemes[index + 1].surface in {"しい", "い"}
        ):
            next_m = morphemes[index + 1]
            cand_surface = head.surface + next_m.surface
            if cand_surface in vocab:
                merged_adj = Morpheme(
                    surface=cand_surface,
                    lemma=cand_surface,
                    reading=head.reading + next_m.reading,
                    pos=("形容詞", "一般", "*", "*", "形容詞", "終止形-一般"),
                    start=head.start,
                    end=next_m.end,
                    normalized=cand_surface,
                    is_oov=head.is_oov or next_m.is_oov,
                )
                head = merged_adj
                index += 1
                end = _consume_auxiliary_tail(morphemes, index + 1, allow_nagara=False)
                if end > index + 1:
                    result.append(_merged(head, morphemes[index + 1 : end]))
                    index = end
                else:
                    result.append(head)
                    index += 1
                continue

        # 8. Existing special pattern: ...につく
        if (
            index + 2 < len(morphemes)
            and morphemes[index + 1].surface == "に"
            and morphemes[index + 2].lemma == "つく"
        ):
            end = _consume_auxiliary_tail(morphemes, index + 3, allow_nagara=False)
            if end > index + 3:
                result.append(
                    _merged(
                        head,
                        morphemes[index + 1 : end],
                        lemma=f"{head.surface}につく",
                    )
                )
                index = end
                continue

        # 9. Non-predicates / separated words
        if _is_separated(head) or not _is_predicate(head):
            result.append(head)
            index += 1
            continue

        # 10. Potential-form lemma resolution for predicates (e.g. 待てる -> 待つ)
        pot_lemma = _resolve_potential_lemma(head.lemma, vocab)
        if pot_lemma != head.lemma:
            head = Morpheme(
                surface=head.surface,
                lemma=pot_lemma,
                reading=head.reading,
                pos=head.pos,
                start=head.start,
                end=head.end,
                normalized=head.normalized,
                is_oov=head.is_oov,
            )

        # 11. Compound verbs (e.g. 見 + 間違えた -> 見間違えた, lemma 見間違える)
        if index + 1 < len(morphemes):
            next_m = morphemes[index + 1]
            is_lexical_v2 = (
                not _is_separated(next_m)
                and bool(next_m.pos)
                and next_m.pos[0] == "動詞"
                and (
                    next_m.lemma not in _LIGHT_COMPOUND_BLOCKLIST
                    or (head.surface + next_m.lemma in vocab)
                )
            )
            if is_lexical_v2 and (
                (bool(head.pos) and len(head.pos) >= 6 and head.pos[5].startswith("連用形"))
                or (head.surface + next_m.lemma in vocab)
            ):
                cand_verb_lemma = head.surface + next_m.lemma
                end = _consume_auxiliary_tail(morphemes, index + 2)
                tail = morphemes[index + 1 : end]
                result.append(_merged(head, tail, lemma=cand_verb_lemma))
                index = end
                continue

        # 12. Merge auxiliary chains for predicates (including contractions and ながら)
        end = _consume_auxiliary_tail(morphemes, index + 1)

        if end > index + 1:
            result.append(_merged(head, morphemes[index + 1 : end]))
            index = end
        else:
            result.append(head)
            index += 1

    return result
