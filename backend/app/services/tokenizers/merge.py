"""Product-oriented merging of Sudachi morphemes."""
from __future__ import annotations

from app.services.tokenizers.base import Morpheme

_SEPARATE = frozenset({"ながら", "やすい", "なさい", "よう", "ように"})
_AUXILIARY_VERBS = frozenset({"いる", "おく", "くる"})


def _is_predicate(morpheme: Morpheme) -> bool:
    return bool(morpheme.pos) and morpheme.pos[0] in {"動詞", "形容詞", "形状詞"}


def _is_auxiliary(morpheme: Morpheme) -> bool:
    if morpheme.surface in _SEPARATE or morpheme.lemma in _SEPARATE:
        return False
    return (
        (bool(morpheme.pos) and morpheme.pos[0] == "助動詞")
        or morpheme.lemma in _AUXILIARY_VERBS
        or morpheme.lemma == "ない"
    )


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


def merge_morphemes(morphemes: list[Morpheme]) -> list[Morpheme]:
    """Merge predicate and auxiliary chains while preserving grammar boundaries."""
    result: list[Morpheme] = []
    index = 0
    while index < len(morphemes):
        head = morphemes[index]

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

        if head.surface in _SEPARATE or head.lemma in _SEPARATE or not _is_predicate(head):
            result.append(head)
            index += 1
            continue

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
