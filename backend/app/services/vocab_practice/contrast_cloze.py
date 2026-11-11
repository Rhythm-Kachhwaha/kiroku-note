"""Contrast Cloze & Pattern/Particle Fill generator and grader."""
from __future__ import annotations

import hashlib
import random
from typing import Any

from app.repositories.word_state_repository import normalize_word_reading
from app.services.sentence_analysis import analyze
from app.services.vocab_practice.categories import (
    CAT_ADJECTIVE_NA,
    CAT_ADVERB,
    CAT_NOUN,
    CAT_ONOMATOPOEIA,
    CAT_SURU_VERB,
    analyze_sentence_usage_tags,
    build_word_target_from_dict,
)
from app.services.vocab_practice.invariants import (
    locate_target_span,
    make_abstention,
    validate_distractor_safety,
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
from kiroku_dictionary.schema import katakana_to_hiragana


_VOICING_PAIRS: tuple[tuple[str, str], ...] = (
    ("ころころ", "ごろごろ"),
    ("さらさら", "ざらざら"),
    ("きらきら", "ぎらぎら"),
    ("ぱたぱた", "ばたばた"),
    ("かさかさ", "がさがさ"),
    ("くるくる", "ぐるぐる"),
    ("とんとん", "どんどん"),
    ("ぽつぽつ", "ぼつぼつ"),
    ("ぴかぴか", "びかびか"),
    ("からから", "がらがら"),
    ("こつこつ", "ごつごつ"),
    ("ぱりぱり", "ばりばり"),
    ("ぽろぽろ", "ぼろぼろ"),
    ("すべすべ", "ずべずべ"),
    ("ふわふわ", "ぶわぶわ"),
    ("くすくす", "ぐずぐず"),
    ("ぴりぴり", "びりびり"),
    ("けろけろ", "げろげろ"),
)

_VOICING_MAP: dict[str, list[str]] = {}
for _a, _b in _VOICING_PAIRS:
    _VOICING_MAP.setdefault(_a, []).append(_b)
    _VOICING_MAP.setdefault(_b, []).append(_a)

_DEFAULT_MIMETIC_POOL: tuple[str, ...] = (
    "ころころ", "ごろごろ", "きらきら", "ぎらぎら", "さらさら", "ざらざら",
    "ふわふわ", "わくわく", "どきどき", "いらいら", "にこにこ", "のんびり",
    "はっきり", "すっきり", "ゆっくり", "びっくり", "がっかり", "ほっと",
    "ざあざあ", "しとしと", "わんわん", "くすくす", "めそめそ", "ぼんやり",
)

_DEFAULT_ADVERB_POOL: tuple[str, ...] = (
    "すぐ", "もう", "まだ", "ずっと", "とても", "かなり", "少し", "ほとんど",
    "必ず", "たぶん", "ようやく", "ついに", "やはり", "せっかく", "わざと",
)

_PATTERN_PARTICLES: tuple[str, ...] = ("と", "に", "する", "の")


def _stable_seed(*parts: Any) -> int:
    digest = hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


def _question_id(prefix: str, *parts: Any) -> str:
    digest = hashlib.sha1("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


class ContrastClozeGenerator:
    """
    Deterministic Contrast Cloze & Pattern Fill generator for adverbs, mimetics, and collocations.
    Enforces strict Roundtrip and Distractor Safety invariants.
    """

    question_type = "contrast_cloze"

    def __init__(self, dict_engine: Any = None, *, min_distractors: int = 3):
        self.dict_engine = dict_engine
        self.min_distractors = max(2, int(min_distractors))
        self.abstentions: list[AbstentionRecord] = []

    def _abstain(self, code: str, reason: str, target: WordTarget | None) -> None:
        self.abstentions.append(make_abstention(self.question_type, code, reason, target))

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
            self._abstain("missing_sentence", "Contrast cloze requires a real/captured sentence.", word)
            return None
        if self.dict_engine is None:
            self._abstain("missing_dictionary_engine", "Dictionary engine is required for invariant verification.", word)
            return None

        if ctx.mode == "pattern_fill":
            return self._generate_pattern_fill(word, ctx, sentence)
        return self._generate_contrast_cloze(word, ctx, sentence)

    def _collect_candidate_distractors(
        self,
        word: WordTarget,
        ctx: SentenceContext,
    ) -> list[WordTarget]:
        candidates: list[WordTarget] = list(ctx.candidate_distractors)
        seen_ids: set[int] = {int(c.sequence_id) for c in candidates if c.sequence_id}

        # Prioritize voicing-contrast partners first
        norm_key = katakana_to_hiragana(word.reading or word.expression)
        extra_terms: list[str] = list(_VOICING_MAP.get(norm_key, []))

        if word.has_category(CAT_ONOMATOPOEIA):
            extra_terms.extend(_DEFAULT_MIMETIC_POOL)
        elif word.has_category(CAT_ADVERB):
            extra_terms.extend(_DEFAULT_ADVERB_POOL)

        for term in extra_terms:
            if len(candidates) >= 20:
                break
            resolved = build_word_target_from_dict(self.dict_engine, term)
            if resolved is not None and int(resolved.sequence_id) not in seen_ids:
                seen_ids.add(int(resolved.sequence_id))
                candidates.append(resolved)

        return candidates

    def _generate_contrast_cloze(
        self,
        word: WordTarget,
        ctx: SentenceContext,
        sentence: str,
    ) -> PracticeQuestion | None:
        allowed_cats = {CAT_ADVERB, CAT_ONOMATOPOEIA}
        target_cats = set(word.categories) & allowed_cats
        if not target_cats:
            self._abstain(
                "unsupported_category",
                f"Contrast cloze targets adverbs/onomatopoeia, got categories={word.categories}.",
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
            self._abstain(
                "target_not_uniquely_located",
                f"Could not uniquely locate ({word.sequence_id}, {word.reading}) in sentence.",
                word,
            )
            return None

        start, end, target_surface, _morph = span
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

        # Require same-category distractors (preferring onomatopoeia if target is onomatopoeia)
        required_cat = CAT_ONOMATOPOEIA if CAT_ONOMATOPOEIA in target_cats else CAT_ADVERB
        pool = self._collect_candidate_distractors(word, ctx)

        safe_distractors: list[WordTarget] = []
        rejection_reasons: dict[str, str] = {}

        for cand in pool:
            if len(safe_distractors) >= 3:
                break
            is_safe, reason = validate_distractor_safety(
                target=word,
                distractor=cand,
                required_categories=(required_cat,),
                blanked_sentence=blanked_sentence,
                distractor_surface=cand.expression or cand.reading,
                dict_engine=self.dict_engine,
            )
            if is_safe:
                safe_distractors.append(cand)
            else:
                rejection_reasons[cand.expression or str(cand.sequence_id)] = reason

        if len(safe_distractors) < self.min_distractors:
            self._abstain(
                "insufficient_safe_distractors",
                f"Found {len(safe_distractors)} safe distractors (need {self.min_distractors}); rejections={rejection_reasons}.",
                word,
            )
            return None

        all_options = [
            PracticeChoice(
                choice_id=f"c_{word.sequence_id}",
                text=target_surface,
                reading=normalize_word_reading(word.reading),
                sequence_id=int(word.sequence_id),
            )
        ] + [
            PracticeChoice(
                choice_id=f"c_{d.sequence_id}",
                text=d.expression or d.reading,
                reading=normalize_word_reading(d.reading),
                sequence_id=int(d.sequence_id),
            )
            for d in safe_distractors[:3]
        ]
        rng = random.Random(_stable_seed(word.sequence_id, blanked_sentence))
        rng.shuffle(all_options)

        usage_tags = tuple(ctx.usage_tags) or tuple(
            item["tag"]
            for item in analyze_sentence_usage_tags(sentence, dict_engine=self.dict_engine)
        )
        q_id = _question_id("ccloze", word.sequence_id, blanked_sentence)
        gloss_hint = "; ".join(word.glosses[:2]) if word.glosses else ""
        return PracticeQuestion(
            question_id=q_id,
            question_type="contrast_cloze",
            target=word,
            prompt="Choose the word that best completes the sentence:",
            sentence=sentence,
            blanked_sentence=blanked_sentence,
            hint=gloss_hint,
            choices=tuple(all_options),
            expected_answers=(target_surface, word.expression, normalize_word_reading(word.reading)),
            expected_sequence_id=int(word.sequence_id),
            expected_reading=normalize_word_reading(word.reading),
            accepted_forms=(target_surface, word.expression, word.reading),
            usage_tags=usage_tags,
            metadata={"category": required_cat, "target_surface": target_surface},
        )

    def _licensed_particles_for_context(
        self,
        word: WordTarget,
        next_pos0: str,
    ) -> set[str]:
        """Return which particles in {と, に, する, の} are grammatically licensed after word before next_pos0."""
        pos_codes = set(word.pos_codes)
        cats = set(word.categories)
        licensed: set[str] = set()

        is_verb_or_adj_next = next_pos0 in ("動詞", "形容詞", "形状詞")
        is_noun_next = next_pos0 in ("名詞", "代名詞")
        is_clause_end = next_pos0 in ("", "助動詞", "補助記号", "記号", "助詞")

        if is_verb_or_adj_next:
            if "adv-to" in pos_codes or CAT_ONOMATOPOEIA in cats:
                licensed.add("と")
            if CAT_ADJECTIVE_NA in cats or "adv" in pos_codes or "n-adv" in pos_codes:
                licensed.add("に")
        elif is_noun_next:
            if "adj-no" in pos_codes or CAT_NOUN in cats:
                licensed.add("の")
            if "adv-to" in pos_codes:
                licensed.add("と")
        elif is_clause_end:
            if CAT_SURU_VERB in cats or "vs" in pos_codes:
                licensed.add("する")
            if "adv-to" in pos_codes or CAT_ONOMATOPOEIA in cats:
                licensed.add("と")

        return licensed

    def _generate_pattern_fill(
        self,
        word: WordTarget,
        ctx: SentenceContext,
        sentence: str,
    ) -> PracticeQuestion | None:
        span = locate_target_span(
            sentence,
            word,
            target_surface=ctx.target_surface,
            dict_engine=self.dict_engine,
        )
        if span is None:
            self._abstain("target_not_uniquely_located", "Target word not uniquely located in sentence.", word)
            return None

        start, end, target_surface, _morph = span
        ok_word, err_word = verify_sentence_roundtrip(
            original_sentence=sentence,
            blanked_sentence=sentence[:start] + BLANK_TOKEN + sentence[end:],
            target_surface=target_surface,
            target=word,
            dict_engine=self.dict_engine,
        )
        if not ok_word:
            self._abstain("roundtrip_failed", err_word, word)
            return None

        analysis = analyze(sentence, dict_lookup=self.dict_engine)
        target_idx = next(
            (i for i, m in enumerate(analysis.merged) if m.start == start and m.end == end),
            None,
        )
        if target_idx is None:
            self._abstain("missing_following_particle", "Could not align target token for pattern fill.", word)
            return None

        follower_surface = ""
        follower_start = 0
        follower_end = 0
        next_after = None

        if target_idx + 1 < len(analysis.merged) and analysis.merged[target_idx + 1].surface in _PATTERN_PARTICLES:
            follower = analysis.merged[target_idx + 1]
            follower_surface = follower.surface
            follower_start = follower.start
            follower_end = follower.end
            next_after = analysis.merged[target_idx + 2] if target_idx + 2 < len(analysis.merged) else None
        else:
            # Handle Sudachi-merged na-adj + に (e.g. '静かに' merged into a single morpheme)
            for pat in _PATTERN_PARTICLES:
                if target_surface.endswith(pat) and target_surface[: -len(pat)] in (word.expression, word.reading):
                    # Confirm in unmerged morphemes that stem + particle are distinct
                    unmerged_match = any(
                        m.surface == pat and m.end == end and m.start == end - len(pat)
                        for m in analysis.morphemes
                    )
                    if unmerged_match:
                        follower_surface = pat
                        follower_start = end - len(pat)
                        follower_end = end
                        target_surface = target_surface[: -len(pat)]
                        next_after = analysis.merged[target_idx + 1] if target_idx + 1 < len(analysis.merged) else None
                        break

        if not follower_surface:
            self._abstain("missing_following_particle", "No following particle/pattern token found after target.", word)
            return None

        next_pos0 = next_after.pos[0] if (next_after and next_after.pos) else ""

        licensed = self._licensed_particles_for_context(word, next_pos0)
        # If multiple particles in the set are licensed for this word+frame, abstain to avoid ambiguity.
        if follower_surface not in licensed:
            licensed.add(follower_surface)

        ambiguous_alternatives = [p for p in _PATTERN_PARTICLES if p != follower_surface and p in licensed]
        if ambiguous_alternatives:
            self._abstain(
                "ambiguous_pattern_fit",
                f"Multiple particles licensed for '{word.expression}' before POS '{next_pos0}': {sorted(licensed)}.",
                word,
            )
            return None

        blanked_sentence = sentence[:follower_start] + BLANK_TOKEN + sentence[follower_end:]
        if blanked_sentence.replace(BLANK_TOKEN, follower_surface, 1) != sentence:
            self._abstain("roundtrip_failed", "Pattern blank did not reproduce original sentence.", word)
            return None

        choices = [
            PracticeChoice(choice_id=f"pat_{p}", text=p, reading=p, sequence_id=None)
            for p in _PATTERN_PARTICLES
        ]
        rng = random.Random(_stable_seed(word.sequence_id, blanked_sentence))
        rng.shuffle(choices)

        usage_tags = tuple(ctx.usage_tags) or tuple(
            item["tag"]
            for item in analyze_sentence_usage_tags(sentence, dict_engine=self.dict_engine)
        )
        q_id = _question_id("pfill", word.sequence_id, blanked_sentence)
        return PracticeQuestion(
            question_id=q_id,
            question_type="pattern_fill",
            target=word,
            prompt=f"Choose the particle/pattern that pairs with {target_surface}:",
            sentence=sentence,
            blanked_sentence=blanked_sentence,
            hint="; ".join(word.glosses[:2]) if word.glosses else "",
            choices=tuple(choices),
            expected_answers=(follower_surface,),
            expected_sequence_id=int(word.sequence_id),
            expected_reading=follower_surface,
            accepted_forms=(follower_surface,),
            allow_kanji_answer=False,
            usage_tags=usage_tags,
            metadata={"mode": "pattern_fill", "expected_particle": follower_surface},
        )

    def grade(self, question: PracticeQuestion, answer: str) -> PracticeResult:
        clean = katakana_to_hiragana(str(answer or "").strip())
        accepted = {katakana_to_hiragana(x.strip()) for x in (*question.expected_answers, *question.accepted_forms) if x}
        # Also match by choice_id if frontend submits choice_id
        for choice in question.choices:
            if clean == choice.choice_id:
                clean = katakana_to_hiragana(choice.text)
                break
        is_correct = bool(clean and clean in accepted)
        primary_expected = question.expected_answers[0] if question.expected_answers else ""
        return PracticeResult(
            question_id=question.question_id,
            question_type=question.question_type,
            is_correct=is_correct,
            normalized_user_answer=clean,
            normalized_expected=katakana_to_hiragana(primary_expected),
            expected_answer=primary_expected,
            matched_variant=clean if is_correct else "",
            feedback="Correct." if is_correct else f"Expected: {primary_expected}",
        )
