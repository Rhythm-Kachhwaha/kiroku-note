"""Product-oriented merging of Sudachi morphemes."""
from __future__ import annotations

import sqlite3
from typing import Optional

from app.services.tokenizers.base import Morpheme
from kiroku_dictionary.deinflect import deinflect

_SEPARATE = frozenset({"ながら", "やすい", "なさい", "よう", "ように"})
_AUXILIARY_VERBS = frozenset({"いる", "おく", "くる"})
_PREFIXES = frozenset({"お", "ご", "御"})
_SUFFIXES = frozenset({"さん", "ちゃん", "くん", "たち", "達", "的", "化", "中"})

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
    return bool(morpheme.pos) and morpheme.pos[0] == "名詞"


def _is_adjective(morpheme: Morpheme) -> bool:
    return bool(morpheme.pos) and morpheme.pos[0] in {"形容詞", "形状詞"}


def _is_prefix(morpheme: Morpheme) -> bool:
    return morpheme.surface in _PREFIXES or (
        bool(morpheme.pos) and morpheme.pos[0] == "接頭辞"
    )


def _is_suffix(morpheme: Morpheme) -> bool:
    return morpheme.surface in _SUFFIXES or (
        bool(morpheme.pos) and morpheme.pos[0] == "接尾辞" and morpheme.surface in _SUFFIXES
    )


def _is_auxiliary(morpheme: Morpheme) -> bool:
    if morpheme.surface in _SEPARATE or morpheme.lemma in _SEPARATE:
        return False
    return (
        (bool(morpheme.pos) and morpheme.pos[0] == "助動詞")
        or morpheme.lemma in _AUXILIARY_VERBS
        or morpheme.lemma == "ない"
    )


def _resolve_potential_lemma(lemma: str, vocab: set[str]) -> str:
    """If lemma is a 一段 potential (…える) of a godan verb in vocab, use the godan base."""
    candidates = deinflect(lemma)
    for c in candidates:
        if c.rule.startswith("v5") and "potential" in c.reasons and c.term != lemma:
            if c.term in vocab:
                return c.term
    return lemma


def _merged(head: Morpheme, tail: list[Morpheme], lemma: str | None = None) -> Morpheme:
    last = tail[-1]
    return Morpheme(
        surface="".join(part.surface for part in [head, *tail]),
        lemma=lemma or head.lemma,
        reading="".join(part.reading for part in [head, *tail]),
        pos=head.pos,
        start=head.start,
        end=last.end,
        normalized=head.normalized,
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

        # 1. Prefix merge: 接頭辞 (お/ご/御) + following noun/adjective unit
        if _is_prefix(head) and index + 1 < len(morphemes):
            next_m = morphemes[index + 1]
            if _is_noun(next_m) or _is_adjective(next_m):
                merged_surface = head.surface + next_m.surface
                base_lemma = f"{head.surface}{next_m.lemma}"
                merged_reading = head.reading + next_m.reading
                merged_pos = next_m.pos
                merged_end = next_m.end
                merged_normalized = head.normalized + next_m.normalized

                # Check following suffixes: (さん, ちゃん, くん, たち, 達, 的, 化, 中)
                end = index + 2
                while end < len(morphemes) and _is_suffix(morphemes[end]):
                    suf = morphemes[end]
                    merged_surface += suf.surface
                    merged_reading += suf.reading
                    merged_end = suf.end
                    merged_normalized += suf.normalized
                    end += 1

                lemma = merged_surface if merged_surface in vocab else base_lemma
                result.append(
                    Morpheme(
                        surface=merged_surface,
                        lemma=lemma,
                        reading=merged_reading,
                        pos=merged_pos,
                        start=head.start,
                        end=merged_end,
                        normalized=merged_normalized,
                    )
                )
                index = end
                continue

        # 2. Suffix attach to preceding noun unit (without prefix)
        if _is_noun(head):
            end = index + 1
            while end < len(morphemes) and _is_suffix(morphemes[end]):
                end += 1
            if end > index + 1:
                tail = morphemes[index + 1 : end]
                cand_surface = head.surface + "".join(m.surface for m in tail)
                cand_lemma = cand_surface if cand_surface in vocab else head.lemma
                result.append(_merged(head, tail, lemma=cand_lemma))
                index = end
                continue

        # 3. Adjective stem + しい / い (e.g. 美味 + しい -> 美味しい)
        if index + 1 < len(morphemes) and morphemes[index + 1].surface in {"しい", "い"}:
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
                )
                # Allow it to merge with any following auxiliary
                head = merged_adj
                index += 1  # will increment or handle below
                # Let head proceed below with index = index + 1
                # To cleanly merge with auxiliaries, we replace head and advance
                # but let's handle auxiliaries on merged_adj:
                end = index + 1
                while end < len(morphemes):
                    current = morphemes[end]
                    if current.surface in _SEPARATE or current.lemma in _SEPARATE:
                        break
                    if _is_auxiliary(current):
                        end += 1
                        continue
                    break
                if end > index + 1:
                    result.append(_merged(head, morphemes[index + 1 : end]))
                    index = end
                else:
                    result.append(head)
                    index += 1
                continue

        # 4. Existing special pattern: ...につく
        if (
            index + 2 < len(morphemes)
            and morphemes[index + 1].surface == "に"
            and morphemes[index + 2].lemma == "つく"
        ):
            end = index + 3
            while end < len(morphemes):
                current = morphemes[end]
                if current.surface in _SEPARATE:
                    break
                if current.surface in {"て", "で"}:
                    if (
                        end + 1 < len(morphemes)
                        and morphemes[end + 1].lemma in _AUXILIARY_VERBS
                    ):
                        end += 2
                        continue
                    break
                if _is_auxiliary(current):
                    end += 1
                    continue
                break
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

        # 5. Non-predicates / separated words
        if head.surface in _SEPARATE or head.lemma in _SEPARATE or not _is_predicate(head):
            result.append(head)
            index += 1
            continue

        # 6. Potential-form lemma resolution for predicates (e.g. 待てる -> 待つ)
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
            )

        # 7. Merge auxiliary chains for predicates
        end = index + 1
        while end < len(morphemes):
            current = morphemes[end]
            if current.surface in _SEPARATE or current.lemma in _SEPARATE:
                break
            if current.surface in {"て", "で"}:
                if (
                    end + 1 < len(morphemes)
                    and morphemes[end + 1].lemma in _AUXILIARY_VERBS
                ):
                    end += 2
                    continue
                break
            if _is_auxiliary(current):
                end += 1
                continue
            break

        if end > index + 1:
            result.append(_merged(head, morphemes[index + 1 : end]))
            index = end
        else:
            result.append(head)
            index += 1

    return result
