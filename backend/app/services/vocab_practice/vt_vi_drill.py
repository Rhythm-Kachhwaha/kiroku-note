"""Verb Transitive/Intransitive (vt/vi) & Particle Cue Drill generator and grader."""
from __future__ import annotations

import hashlib
import random
from typing import Any

from app.repositories.word_state_repository import normalize_word_reading
from app.services.sentence_analysis import analyze
from app.services.vocab_practice.categories import (
    CAT_VERB_INTRANSITIVE,
    CAT_VERB_TRANSITIVE,
    analyze_sentence_usage_tags,
    build_word_target_from_dict,
)
from app.services.vocab_practice.conjugation_drill import (
    inflect_word,
    resolve_inflection_rule,
)
from app.services.vocab_practice.invariants import (
    locate_target_span,
    make_abstention,
    verify_sentence_roundtrip,
)
from app.services.vocab_practice.models import (
    AbstentionRecord,
    BLANK_TOKEN,
    PracticeChoice,
    PracticeQuestion,
    PracticeResult,
    SentenceContext,
    WordTarget,
)
from kiroku_dictionary.deinflect import deinflect
from kiroku_dictionary.lookup import is_kanji_char


# Curated (intransitive_expr, intransitive_reading, transitive_expr, transitive_reading)
CURATED_VT_VI_PAIRS: tuple[tuple[str, str, str, str], ...] = (
    ("閉まる", "しまる", "閉める", "しめる"),
    ("始まる", "はじまる", "始める", "はじめる"),
    ("終わる", "おわる", "終える", "おえる"),
    ("出る", "でる", "出す", "だす"),
    ("入る", "はいる", "入れる", "いれる"),
    ("消える", "きえる", "消す", "けす"),
    ("つく", "つく", "つける", "つける"),
    ("落ちる", "おちる", "落とす", "おとす"),
    ("壊れる", "こわれる", "壊す", "こわす"),
    ("割れる", "われる", "割る", "わる"),
    ("折れる", "おれる", "折る", "おる"),
    ("曲がる", "まがる", "曲げる", "まげる"),
    ("増える", "ふえる", "増やす", "ふやす"),
    ("減る", "へる", "減らす", "へらす"),
    ("変わる", "かわる", "変える", "かえる"),
    ("決まる", "きまる", "決める", "きめる"),
    ("見つかる", "みつかる", "見つける", "みつける"),
    ("起きる", "おきる", "起こす", "おこす"),
    ("止まる", "とまる", "止める", "とめる"),
    ("戻る", "もどる", "戻す", "もどす"),
    ("並ぶ", "ならぶ", "並べる", "ならべる"),
    ("集まる", "あつまる", "集める", "あつめる"),
    ("育つ", "そだつ", "育てる", "そだてる"),
    ("助かる", "たすかる", "助ける", "たすける"),
    ("焼ける", "やける", "焼く", "やく"),
    ("溶ける", "とける", "溶かす", "とかす"),
    ("冷える", "ひえる", "冷やす", "ひやす"),
    ("温まる", "あたたまる", "温める", "あたためる"),
    ("抜ける", "ぬける", "抜く", "ぬく"),
    ("建つ", "たつ", "建てる", "たてる"),
    ("倒れる", "たおれる", "倒す", "たおす"),
    ("汚れる", "よごれる", "汚す", "よごす"),
    ("濡れる", "ぬれる", "濡らす", "ぬらす"),
    ("乾く", "かわく", "乾かす", "かわかす"),
    ("届く", "とどく", "届ける", "とどける"),
    ("残る", "のこる", "残す", "のこす"),
    ("鳴る", "なる", "鳴らす", "ならす"),
    ("直る", "なおる", "直す", "なおす"),
    ("治る", "なおる", "治す", "なおす"),
    ("逃げる", "にげる", "逃がす", "にがす"),
    ("乗る", "のる", "乗せる", "のせる"),
    ("降りる", "おりる", "降ろす", "おろす"),
    ("掛かる", "かかる", "掛ける", "かける"),
    ("外れる", "はずれる", "外す", "はずす"),
    ("続く", "つづく", "続ける", "つづける"),
)

_VI_TO_VT: dict[tuple[str, str], tuple[str, str]] = {}
_VT_TO_VI: dict[tuple[str, str], tuple[str, str]] = {}
for _vi_e, _vi_r, _vt_e, _vt_r in CURATED_VT_VI_PAIRS:
    _VI_TO_VT[(_vi_e, _vi_r)] = (_vt_e, _vt_r)
    _VT_TO_VI[(_vt_e, _vt_r)] = (_vi_e, _vi_r)

_DEINFLECT_REASON_TO_FORM: dict[str, str] = {
    "negative": "negative",
    "past": "past",
    "te-form": "te_form",
    "polite": "polite",
    "polite-negative": "polite_negative",
    "polite-past": "polite_past",
    "polite-negative-past": "polite_negative_past",
    "passive": "passive",
    "causative": "causative",
    "potential": "potential",
    "polite-imperative": "polite_imperative",
    "volitional": "volitional",
    "conditional": "conditional",
    "desire": "desire",
}


def _is_strict_vt(word: WordTarget) -> bool:
    return word.has_category(CAT_VERB_TRANSITIVE) and not word.has_category(CAT_VERB_INTRANSITIVE)


def _is_strict_vi(word: WordTarget) -> bool:
    return word.has_category(CAT_VERB_INTRANSITIVE) and not word.has_category(CAT_VERB_TRANSITIVE)


def _detect_preceding_case_particle(morphemes: list[Any], verb_idx: int) -> tuple[str | None, Any | None]:
    """Scan backward within the clause for the case particle cue ('を' or 'が') governing the verb."""
    for i in range(verb_idx - 1, -1, -1):
        m = morphemes[i]
        pos0 = m.pos[0] if m.pos else ""
        pos1 = m.pos[1] if len(m.pos) > 1 else ""
        if pos0 in ("補助記号", "記号", "動詞") or (pos0 == "助詞" and pos1 == "接続助詞"):
            break
        if m.surface in ("を", "が", "は", "も"):
            return m.surface, m
    return None, None


def _match_surface_inflection(
    target: WordTarget,
    target_surface: str,
    counterpart: WordTarget,
) -> str | None:
    """Inflect counterpart to match target_surface's tense/polarity/politeness."""
    if target_surface == target.expression or target_surface == target.reading:
        return counterpart.expression or counterpart.reading

    target_rule = resolve_inflection_rule(target)
    counterpart_rule = resolve_inflection_rule(counterpart)
    if not target_rule or not counterpart_rule:
        return None

    for cand in deinflect(target_surface):
        if cand.term in (target.expression, target.reading) and cand.matches_entry_rules(target_rule):
            if len(cand.reasons) == 1:
                form = _DEINFLECT_REASON_TO_FORM.get(cand.reasons[0])
                if form:
                    return inflect_word(counterpart.expression, counterpart_rule, form)
    return None


class VtViDrillGenerator:
    """Deterministic transitive/intransitive verb pair & particle cue drill generator."""

    question_type = "vt_vi_drill"

    def __init__(self, dict_engine: Any = None):
        self.dict_engine = dict_engine
        self.abstentions: list[AbstentionRecord] = []

    def _abstain(self, code: str, reason: str, target: WordTarget | None) -> None:
        self.abstentions.append(make_abstention(self.question_type, code, reason, target))

    def find_counterpart(self, word: WordTarget, *, want_transitive: bool) -> WordTarget | None:
        """Discover the paired vt/vi counterpart via curated table, cross-references, or kanji-stem mining."""
        if self.dict_engine is None:
            return None

        key = (word.expression, normalize_word_reading(word.reading))
        lookup_map = _VI_TO_VT if want_transitive else _VT_TO_VI
        pair = lookup_map.get(key)
        if pair is not None:
            cand = build_word_target_from_dict(self.dict_engine, pair[0], reading=pair[1])
            if cand is not None and int(cand.sequence_id) != int(word.sequence_id):
                if (want_transitive and _is_strict_vt(cand)) or (not want_transitive and _is_strict_vi(cand)):
                    return cand

        # Fallback: cross-references or shared kanji stem in dictionary
        candidates_to_check: list[str] = list(word.cross_references)
        first_kanji = next((ch for ch in word.expression if is_kanji_char(ch)), None)
        if first_kanji:
            try:
                conn = self.dict_engine.get_connection()
                rows = conn.execute(
                    "SELECT DISTINCT term, reading, sequence FROM terms WHERE term LIKE ? AND term != ? LIMIT 30",
                    (f"{first_kanji}%", word.expression),
                ).fetchall()
                for r in rows:
                    candidates_to_check.append(str(r[0]))
            except Exception:
                pass

        seen: set[str] = set()
        for term in candidates_to_check:
            if not term or term in seen:
                continue
            seen.add(term)
            cand = build_word_target_from_dict(self.dict_engine, term)
            if cand is None or int(cand.sequence_id) == int(word.sequence_id):
                continue
            if want_transitive and _is_strict_vt(cand):
                return cand
            if not want_transitive and _is_strict_vi(cand):
                return cand
        return None

    def generate(
        self,
        word: WordTarget,
        context: SentenceContext | None = None,
    ) -> PracticeQuestion | None:
        if not word.sequence_id or int(word.sequence_id) <= 0:
            self._abstain("missing_sequence_id", "Target word must have a canonical JMdict sequence_id.", word)
            return None
        ctx = context or SentenceContext()
        sentence = (ctx.sentence or "").strip()
        if not sentence:
            self._abstain("missing_sentence", "vt/vi drill requires a sentence with a particle cue.", word)
            return None
        if self.dict_engine is None:
            self._abstain("missing_dictionary_engine", "Dictionary engine is required for vt/vi drill.", word)
            return None

        # Target must have strict unambiguous transitivity (not 自他動詞)
        target_vt = _is_strict_vt(word)
        target_vi = _is_strict_vi(word)
        if not (target_vt ^ target_vi):
            self._abstain(
                "ambiguous_verb_transitivity",
                f"Verb '{word.expression}' is dual-transitivity or lacks vt/vi tag ({word.categories}).",
                word,
            )
            return None

        span = locate_target_span(
            sentence,
            word,
            target_surface=ctx.target_surface,
            dict_engine=self.dict_engine,
        )
        if span is None:
            self._abstain("target_not_uniquely_located", "Target verb not uniquely located in sentence.", word)
            return None

        start, end, target_surface, _morph = span
        analysis = analyze(sentence, dict_lookup=self.dict_engine)
        verb_idx = next(
            (i for i, m in enumerate(analysis.merged) if m.start == start and m.end == end),
            None,
        )
        if verb_idx is None:
            self._abstain("verb_token_not_found", "Could not align verb morpheme index.", word)
            return None

        cue, cue_morph = _detect_preceding_case_particle(analysis.merged, verb_idx)
        if cue not in ("を", "が") or cue_morph is None:
            self._abstain(
                "missing_or_ambiguous_particle_cue",
                f"Expected preceding 'を' or 'が' cue, found '{cue}'.",
                word,
            )
            return None

        if (cue == "を" and not target_vt) or (cue == "が" and not target_vi):
            self._abstain(
                "particle_transitivity_mismatch",
                f"Cue '{cue}' conflicts with target transitivity (vt={target_vt}, vi={target_vi}).",
                word,
            )
            return None

        if ctx.mode == "particle_cue":
            return self._generate_particle_cue_drill(word, sentence, cue, cue_morph, target_vt)

        return self._generate_pair_drill(word, ctx, sentence, start, end, target_surface, cue, target_vt)

    def _generate_particle_cue_drill(
        self,
        word: WordTarget,
        sentence: str,
        cue: str,
        cue_morph: Any,
        target_vt: bool,
    ) -> PracticeQuestion | None:
        blanked = sentence[: cue_morph.start] + BLANK_TOKEN + sentence[cue_morph.end :]
        if blanked.replace(BLANK_TOKEN, cue, 1) != sentence:
            self._abstain("roundtrip_failed", "Particle blank did not reproduce sentence.", word)
            return None

        choices = [
            PracticeChoice(choice_id="p_wo", text="を", reading="を"),
            PracticeChoice(choice_id="p_ga", text="が", reading="が"),
        ]
        digest = hashlib.sha1(f"{word.sequence_id}|{blanked}|particle".encode("utf-8")).hexdigest()[:12]
        usage_tags = tuple(
            item["tag"] for item in analyze_sentence_usage_tags(sentence, dict_engine=self.dict_engine)
        )
        trans_desc = "transitive (他動詞)" if target_vt else "intransitive (自動詞)"
        return PracticeQuestion(
            question_id=f"vtvi_p_{digest}",
            question_type="vt_vi_drill",
            target=word,
            prompt=f"Choose the particle matching {word.expression} ({trans_desc}):",
            sentence=sentence,
            blanked_sentence=blanked,
            hint="; ".join(word.glosses[:2]) if word.glosses else "",
            choices=tuple(choices),
            expected_answers=(cue,),
            expected_sequence_id=int(word.sequence_id),
            expected_reading=cue,
            accepted_forms=(cue,),
            allow_kanji_answer=False,
            usage_tags=usage_tags,
            metadata={"mode": "particle_cue", "transitivity": "vt" if target_vt else "vi"},
        )

    def _generate_pair_drill(
        self,
        word: WordTarget,
        ctx: SentenceContext,
        sentence: str,
        start: int,
        end: int,
        target_surface: str,
        cue: str,
        target_vt: bool,
    ) -> PracticeQuestion | None:
        blanked_sentence = sentence[:start] + BLANK_TOKEN + sentence[end:]
        ok, err = verify_sentence_roundtrip(
            original_sentence=sentence,
            blanked_sentence=blanked_sentence,
            target_surface=target_surface,
            target=word,
            dict_engine=self.dict_engine,
        )
        if not ok:
            self._abstain("roundtrip_failed", err, word)
            return None

        counterpart = ctx.paired_counterpart
        if counterpart is None:
            counterpart = self.find_counterpart(word, want_transitive=not target_vt)
        if counterpart is None:
            self._abstain("missing_vt_vi_counterpart", f"No strict opposite-transitivity counterpart found for '{word.expression}'.", word)
            return None

        # Verify opposite transitivity strictly
        if (target_vt and not _is_strict_vi(counterpart)) or (not target_vt and not _is_strict_vt(counterpart)):
            self._abstain("counterpart_ambiguous_transitivity", f"Counterpart '{counterpart.expression}' lacks strict opposite transitivity.", word)
            return None

        counterpart_surface = _match_surface_inflection(word, target_surface, counterpart)
        if not counterpart_surface:
            self._abstain(
                "counterpart_inflection_mismatch",
                f"Could not mirror inflection of '{target_surface}' onto counterpart '{counterpart.expression}'.",
                word,
            )
            return None

        # Verify counterpart tokenization stability in blank (resolves to counterpart, not target)
        alt_sentence = blanked_sentence.replace(BLANK_TOKEN, counterpart_surface, 1)
        alt_span_end = start + len(counterpart_surface)
        alt_analysis = analyze(alt_sentence, dict_lookup=self.dict_engine)
        alt_tok = next(
            (m for m in alt_analysis.merged if m.start == start and m.end == alt_span_end),
            None,
        )
        if alt_tok is None or alt_tok.sequence_id is None or int(alt_tok.sequence_id) != int(counterpart.sequence_id):
            self._abstain(
                "counterpart_breaks_tokenization",
                f"Counterpart '{counterpart_surface}' did not resolve to sequence_id={counterpart.sequence_id} in sentence blank.",
                word,
            )
            return None

        choices = [
            PracticeChoice(
                choice_id=f"v_{word.sequence_id}",
                text=target_surface,
                reading=normalize_word_reading(word.reading),
                sequence_id=int(word.sequence_id),
            ),
            PracticeChoice(
                choice_id=f"v_{counterpart.sequence_id}",
                text=counterpart_surface,
                reading=normalize_word_reading(counterpart.reading),
                sequence_id=int(counterpart.sequence_id),
            ),
        ]
        seed = int(hashlib.sha1(f"{word.sequence_id}|{blanked_sentence}".encode("utf-8")).hexdigest()[:12], 16)
        random.Random(seed).shuffle(choices)

        usage_tags = tuple(ctx.usage_tags) or tuple(
            item["tag"] for item in analyze_sentence_usage_tags(sentence, dict_engine=self.dict_engine)
        )
        digest = hashlib.sha1(f"{word.sequence_id}|{blanked_sentence}".encode("utf-8")).hexdigest()[:12]
        return PracticeQuestion(
            question_id=f"vtvi_{digest}",
            question_type="vt_vi_drill",
            target=word,
            prompt=f"Choose the verb form that matches particle '{cue}':",
            sentence=sentence,
            blanked_sentence=blanked_sentence,
            hint="; ".join(word.glosses[:2]) if word.glosses else "",
            choices=tuple(choices),
            expected_answers=(target_surface, word.expression),
            expected_sequence_id=int(word.sequence_id),
            expected_reading=normalize_word_reading(word.reading),
            accepted_forms=(target_surface, word.expression, normalize_word_reading(word.reading)),
            usage_tags=usage_tags,
            metadata={
                "mode": "verb_pair",
                "particle_cue": cue,
                "counterpart_expression": counterpart.expression,
                "counterpart_sequence_id": counterpart.sequence_id,
            },
        )

    def grade(self, question: PracticeQuestion, answer: str) -> PracticeResult:
        clean = str(answer or "").strip()
        for choice in question.choices:
            if clean == choice.choice_id:
                clean = choice.text
                break
        norm_clean = normalize_word_reading(clean)
        accepted_norm = {
            normalize_word_reading(x)
            for x in (*question.expected_answers, *question.accepted_forms)
            if x
        }
        is_correct = bool(clean and (clean in question.expected_answers or clean in question.accepted_forms or norm_clean in accepted_norm))
        primary = question.expected_answers[0] if question.expected_answers else question.target.expression
        return PracticeResult(
            question_id=question.question_id,
            question_type=question.question_type,
            is_correct=is_correct,
            normalized_user_answer=norm_clean or clean,
            normalized_expected=normalize_word_reading(primary) or primary,
            expected_answer=primary,
            matched_variant=clean if is_correct else "",
            feedback="Correct." if is_correct else f"Expected: {primary}",
        )
