"""
Deterministic Answer Validation (Zero LLM Answer Overwrites).
------------------------------------------------------------
Verifies scraped answer keys deterministically BEFORE accepting them or running
any LLM explanation:
1. Vocabulary reading & orthography questions checked against local
   `kiroku_dictionary` (`DictionaryEngine` / compatible lookup).
2. Grammar & blank-fill questions: substitute `{blank}` with each choice and
   evaluate morphological + dictionary plausibility via `sentence_analysis.analyze`.
3. Disagreements flag `disagreement` / `review_required` rather than blindly
   accepting a bad scraped key.
4. Enforces the Zero-LLM-Overwrite invariant: LLMs NEVER invent or overwrite
   answer keys, and LLM explanations run only after deterministic & source
   validation pass.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Callable, Literal, Sequence

from pydantic import BaseModel, Field

from app.study.acquisition.parsers.models import ParsedExercise, ParsedQuestion
from app.study.ingestion.models import CandidateQuestion
from app.study.verification.enums import VerificationStatus
from app.study.verification.models import AISourceClaimInput

logger = logging.getLogger(__name__)

DeterministicStatus = Literal["agreed", "disagreement", "review_required", "skipped"]

_UNDERLINE_RE = re.compile(r"\{u\|([^}]+)\}")
_BRACKET_TARGET_RE = re.compile(r"【([^】]+)】")
_KANJI_RUN_RE = re.compile(r"[\u4E00-\u9FFF]+[\u3040-\u309F]*")
_BLANK_RE = re.compile(r"\{blank(?:\|[^}]+)?\}")


def _katakana_to_hiragana(text: str) -> str:
    chars: list[str] = []
    for ch in text:
        code = ord(ch)
        if 0x30A1 <= code <= 0x30F6:
            chars.append(chr(code - 0x60))
        else:
            chars.append(ch)
    return "".join(chars).strip()


def _resolve_dict_engine(dict_engine: Any = None) -> Any | None:
    if dict_engine is not None:
        return dict_engine
    try:
        from kiroku_dictionary import get_default_engine

        engine = get_default_engine()
        if Path(engine.db_path).is_file():
            return engine
    except Exception as exc:
        logger.debug("Default kiroku_dictionary unavailable: %s", exc)
    return None


def _lookup_term_readings(dict_engine: Any, term: str) -> set[str]:
    clean = (term or "").strip()
    if not clean or dict_engine is None:
        return set()
    readings: set[str] = set()
    if hasattr(dict_engine, "lookup_terms"):
        try:
            groups = dict_engine.lookup_terms(clean, max_results=20, mode="word")
            for g in groups or []:
                g_term = getattr(g, "term", "") or (g.get("term", "") if isinstance(g, dict) else "")
                g_reading = getattr(g, "reading", "") or (g.get("reading", "") if isinstance(g, dict) else "")
                if g_term == clean or _katakana_to_hiragana(g_term) == _katakana_to_hiragana(clean):
                    if g_reading:
                        readings.add(_katakana_to_hiragana(g_reading))
                    if g_term:
                        readings.add(_katakana_to_hiragana(g_term))
        except Exception as exc:
            logger.debug("lookup_terms failed for %s: %s", clean, exc)
    if not readings and hasattr(dict_engine, "scan_term_entries"):
        try:
            for entry in dict_engine.scan_term_entries(clean) or []:
                r_val = entry.get("reading") or ""
                if r_val:
                    readings.add(_katakana_to_hiragana(str(r_val)))
        except Exception as exc:
            logger.debug("scan_term_entries failed for %s: %s", clean, exc)
    return readings


def _dict_term_exists(dict_engine: Any, term: str) -> bool:
    clean = (term or "").strip()
    if not clean or dict_engine is None:
        return False
    if hasattr(dict_engine, "term_exists"):
        try:
            return bool(dict_engine.term_exists(clean))
        except Exception:
            pass
    return bool(_lookup_term_readings(dict_engine, clean))


def _default_sentence_analyzer(text: str, dict_lookup: Any = None) -> Any:
    from app.services.sentence_analysis import analyze

    return analyze(text, dict_lookup=dict_lookup)


def _extract_target_token(stem: str, rationale: str = "") -> str:
    u_match = _UNDERLINE_RE.search(stem)
    if u_match:
        return u_match.group(1).strip()
    b_matches = _BRACKET_TARGET_RE.findall(stem)
    if b_matches:
        # Prefer shorter target word bracket over full context sentence bracket
        shortest = min(b_matches, key=len).strip()
        if len(shortest) <= 20:
            return shortest
    if rationale:
        if "=>" in rationale:
            left = rationale.split("=>", 1)[0].strip()
            if left and len(left) <= 20:
                return left
        if ":" in rationale:
            left = rationale.split(":", 1)[0].strip()
            if left and len(left) <= 20:
                return left
    kanji_matches = _KANJI_RUN_RE.findall(stem)
    if kanji_matches:
        return kanji_matches[0].strip()
    return ""


class ChoicePlausibility(BaseModel):
    """Per-choice deterministic evaluation output."""

    ordinal: int
    choice_text: str
    filled_sentence: str = ""
    unresolved_count: int = 0
    resolved_count: int = 0
    dictionary_matched: bool = False
    plausible: bool = True
    notes: str = ""


class DeterministicValidationResult(BaseModel):
    """Result of deterministic dictionary/morphological verification."""

    question_external_id: str = ""
    format_code: str = ""
    status: DeterministicStatus
    review_required: bool = False
    scraped_ordinal: int | None = None
    deterministic_candidate_ordinals: list[int] = Field(default_factory=list)
    reason: str = ""
    choice_analyses: list[ChoicePlausibility] = Field(default_factory=list)

    @property
    def disagreement(self) -> bool:
        return self.status == "disagreement"


class DeterministicAnswerValidator:
    """Validates scraped answer keys using local dictionary and Sudachi analysis."""

    def __init__(
        self,
        dict_engine: Any = None,
        sentence_analyzer: Callable[..., Any] | None = None,
    ) -> None:
        self._dict_engine = _resolve_dict_engine(dict_engine)
        self._analyzer = sentence_analyzer or _default_sentence_analyzer

    def validate_question_fields(
        self,
        *,
        external_id: str,
        format_code: str,
        stem: str,
        choices: Sequence[tuple[int, str]],
        scraped_ordinal: int | None,
        rationale: str = "",
    ) -> DeterministicValidationResult:
        """Deterministically verify a scraped answer key against dictionary & tokenizer."""
        if scraped_ordinal is None:
            return DeterministicValidationResult(
                question_external_id=external_id,
                format_code=format_code,
                status="review_required",
                review_required=True,
                scraped_ordinal=None,
                reason="Missing scraped answer key; deterministic validation cannot approve.",
            )

        choice_map = {ord_v: txt for ord_v, txt in choices}
        if scraped_ordinal not in choice_map:
            return DeterministicValidationResult(
                question_external_id=external_id,
                format_code=format_code,
                status="disagreement",
                review_required=True,
                scraped_ordinal=scraped_ordinal,
                reason=f"Scraped answer ordinal {scraped_ordinal} is not in choices {sorted(choice_map.keys())}.",
            )

        claimed_text = choice_map[scraped_ordinal].strip()

        # 1. Kanji reading check against kiroku_dictionary
        if format_code == "kanji_reading":
            if self._dict_engine is None:
                return DeterministicValidationResult(
                    question_external_id=external_id,
                    format_code=format_code,
                    status="skipped",
                    review_required=False,
                    scraped_ordinal=scraped_ordinal,
                    reason="Dictionary engine unavailable; kanji reading check skipped.",
                )
            target = _extract_target_token(stem, rationale=rationale)
            valid_readings = _lookup_term_readings(self._dict_engine, target)
            if not valid_readings:
                return DeterministicValidationResult(
                    question_external_id=external_id,
                    format_code=format_code,
                    status="skipped",
                    review_required=False,
                    scraped_ordinal=scraped_ordinal,
                    reason=f"Target '{target}' not found in local dictionary.",
                )
            matching_ords = [
                ord_v
                for ord_v, txt in choices
                if _katakana_to_hiragana(txt) in valid_readings
            ]
            analyses = [
                ChoicePlausibility(
                    ordinal=ord_v,
                    choice_text=txt,
                    dictionary_matched=(_katakana_to_hiragana(txt) in valid_readings),
                    plausible=(_katakana_to_hiragana(txt) in valid_readings),
                )
                for ord_v, txt in choices
            ]
            if scraped_ordinal not in matching_ords:
                return DeterministicValidationResult(
                    question_external_id=external_id,
                    format_code=format_code,
                    status="disagreement",
                    review_required=True,
                    scraped_ordinal=scraped_ordinal,
                    deterministic_candidate_ordinals=matching_ords,
                    reason=(
                        f"Dictionary readings for '{target}' ({sorted(valid_readings)}) "
                        f"do not match scraped choice {scraped_ordinal} ('{claimed_text}')."
                    ),
                    choice_analyses=analyses,
                )
            return DeterministicValidationResult(
                question_external_id=external_id,
                format_code=format_code,
                status="agreed",
                review_required=False,
                scraped_ordinal=scraped_ordinal,
                deterministic_candidate_ordinals=matching_ords,
                reason=f"Dictionary confirmed reading '{claimed_text}' for '{target}'.",
                choice_analyses=analyses,
            )

        # 2. Orthography (kana -> kanji) check against kiroku_dictionary
        if format_code == "orthography":
            if self._dict_engine is None:
                return DeterministicValidationResult(
                    question_external_id=external_id,
                    format_code=format_code,
                    status="skipped",
                    review_required=False,
                    scraped_ordinal=scraped_ordinal,
                    reason="Dictionary engine unavailable; orthography check skipped.",
                )
            target_kana = _katakana_to_hiragana(_extract_target_token(stem, rationale=rationale))
            matching_ords: list[int] = []
            analyses: list[ChoicePlausibility] = []
            for ord_v, txt in choices:
                readings = _lookup_term_readings(self._dict_engine, txt.strip())
                exists = _dict_term_exists(self._dict_engine, txt.strip())
                matched = exists and (not target_kana or not readings or target_kana in readings)
                if matched:
                    matching_ords.append(ord_v)
                analyses.append(
                    ChoicePlausibility(
                        ordinal=ord_v,
                        choice_text=txt,
                        dictionary_matched=matched,
                        plausible=matched,
                    )
                )
            if matching_ords and scraped_ordinal not in matching_ords:
                return DeterministicValidationResult(
                    question_external_id=external_id,
                    format_code=format_code,
                    status="disagreement",
                    review_required=True,
                    scraped_ordinal=scraped_ordinal,
                    deterministic_candidate_ordinals=matching_ords,
                    reason=(
                        f"Scraped orthography choice {scraped_ordinal} ('{claimed_text}') "
                        f"failed dictionary validation while choices {matching_ords} matched."
                    ),
                    choice_analyses=analyses,
                )
            if not matching_ords:
                return DeterministicValidationResult(
                    question_external_id=external_id,
                    format_code=format_code,
                    status="skipped",
                    review_required=False,
                    scraped_ordinal=scraped_ordinal,
                    reason="No orthography choices resolved in local dictionary.",
                    choice_analyses=analyses,
                )
            return DeterministicValidationResult(
                question_external_id=external_id,
                format_code=format_code,
                status="agreed",
                review_required=False,
                scraped_ordinal=scraped_ordinal,
                deterministic_candidate_ordinals=matching_ords,
                reason=f"Dictionary validated orthography choice '{claimed_text}'.",
                choice_analyses=analyses,
            )

        # 3. Grammar & Blank-Fill Plausibility via sentence_analysis.analyze + dictionary
        if _BLANK_RE.search(stem) and format_code in (
            "sentential_grammar_1",
            "contextual_expressions",
            "text_grammar",
            "",
        ):
            analyses: list[ChoicePlausibility] = []
            for ord_v, txt in choices:
                filled = _BLANK_RE.sub(txt.strip(), stem, count=1)
                # Strip markup tags for tokenization
                plain_filled = re.sub(r"\{u\|([^}]+)\}", r"\1", filled)
                plain_filled = re.sub(r"\[([^|\]]+)\|[^\]]+\]", r"\1", plain_filled)
                unresolved = 0
                resolved = 0
                dict_matched = True
                notes = ""
                try:
                    analysis = self._analyzer(plain_filled, dict_lookup=self._dict_engine)
                    merged = getattr(analysis, "merged", []) or []
                    for m in merged:
                        if getattr(m, "resolution_status", None) == "skipped":
                            continue
                        if getattr(m, "unresolved", False):
                            unresolved += 1
                        else:
                            resolved += 1
                    if self._dict_engine is not None and format_code == "contextual_expressions":
                        dict_matched = _dict_term_exists(self._dict_engine, txt.strip())
                        if not dict_matched:
                            # Also check lemmatized tokens from choice text itself
                            c_analysis = self._analyzer(txt.strip(), dict_lookup=self._dict_engine)
                            c_merged = getattr(c_analysis, "merged", []) or []
                            dict_matched = any(
                                getattr(m, "resolution_status", None) == "resolved" for m in c_merged
                            )
                except Exception as exc:
                    notes = f"Analyzer unavailable: {exc}"

                plausible = (unresolved == 0) and dict_matched
                analyses.append(
                    ChoicePlausibility(
                        ordinal=ord_v,
                        choice_text=txt,
                        filled_sentence=plain_filled,
                        unresolved_count=unresolved,
                        resolved_count=resolved,
                        dictionary_matched=dict_matched,
                        plausible=plausible,
                        notes=notes,
                    )
                )

            plausible_ords = [a.ordinal for a in analyses if a.plausible]
            claimed_analysis = next((a for a in analyses if a.ordinal == scraped_ordinal), None)
            if claimed_analysis is not None and not claimed_analysis.plausible:
                return DeterministicValidationResult(
                    question_external_id=external_id,
                    format_code=format_code,
                    status="disagreement",
                    review_required=True,
                    scraped_ordinal=scraped_ordinal,
                    deterministic_candidate_ordinals=plausible_ords,
                    reason=(
                        f"Filled sentence for scraped choice {scraped_ordinal} ('{claimed_text}') "
                        f"failed morphological/dictionary plausibility (unresolved={claimed_analysis.unresolved_count}, "
                        f"dict_matched={claimed_analysis.dictionary_matched})."
                    ),
                    choice_analyses=analyses,
                )
            return DeterministicValidationResult(
                question_external_id=external_id,
                format_code=format_code,
                status="agreed",
                review_required=False,
                scraped_ordinal=scraped_ordinal,
                deterministic_candidate_ordinals=plausible_ords,
                reason="Filled sentence passed morphological and dictionary plausibility.",
                choice_analyses=analyses,
            )

        # 4. General vocabulary choices (paraphrases, usage)
        if format_code in ("paraphrases", "usage") and self._dict_engine is not None:
            matched_ords = [
                ord_v for ord_v, txt in choices if _dict_term_exists(self._dict_engine, txt.strip())
            ]
            if matched_ords and scraped_ordinal not in matched_ords:
                return DeterministicValidationResult(
                    question_external_id=external_id,
                    format_code=format_code,
                    status="disagreement",
                    review_required=True,
                    scraped_ordinal=scraped_ordinal,
                    deterministic_candidate_ordinals=matched_ords,
                    reason=f"Scraped choice '{claimed_text}' was not found in dictionary while other choices matched.",
                )
            return DeterministicValidationResult(
                question_external_id=external_id,
                format_code=format_code,
                status="agreed",
                review_required=False,
                scraped_ordinal=scraped_ordinal,
                deterministic_candidate_ordinals=matched_ords,
                reason="Vocabulary choice verified in local dictionary.",
            )

        return DeterministicValidationResult(
            question_external_id=external_id,
            format_code=format_code,
            status="skipped",
            review_required=False,
            scraped_ordinal=scraped_ordinal,
            reason=f"No deterministic dictionary rule applicable for format '{format_code}'.",
        )

    def validate_parsed_question(self, q: ParsedQuestion) -> DeterministicValidationResult:
        """Validate a ParsedQuestion from acquisition."""
        choices = [(c.ordinal, c.text) for c in q.choices]
        scraped_ord = q.answer.claimed_ordinal if q.answer else None
        rationale = q.answer.rationale if q.answer else ""
        return self.validate_question_fields(
            external_id=q.external_id,
            format_code=q.format_code or "",
            stem=q.stem,
            choices=choices,
            scraped_ordinal=scraped_ord,
            rationale=rationale,
        )

    def validate_parsed_exercise(self, exercise: ParsedExercise) -> list[DeterministicValidationResult]:
        """Validate all questions in a ParsedExercise."""
        return [self.validate_parsed_question(q) for q in exercise.questions]

    def validate_candidate(self, candidate: CandidateQuestion) -> DeterministicValidationResult:
        """Validate an ingestion CandidateQuestion."""
        choices = [(c.ordinal, c.text) for c in candidate.draft.raw_choices]
        scraped_ord: int | None = None
        if candidate.draft.source_answer_key is not None:
            try:
                scraped_ord = int(str(candidate.draft.source_answer_key).strip())
            except ValueError:
                for c in candidate.draft.raw_choices:
                    if c.label == str(candidate.draft.source_answer_key).strip():
                        scraped_ord = c.ordinal
                        break
        fmt_code = candidate.classification.format_code if candidate.classification else ""
        return self.validate_question_fields(
            external_id=candidate.candidate_id,
            format_code=fmt_code,
            stem=candidate.draft.raw_stem,
            choices=choices,
            scraped_ordinal=scraped_ord,
            rationale=candidate.draft.source_answer_rationale,
        )


def is_llm_explanation_allowed(
    comparison_status: VerificationStatus,
    source_claims: Sequence[AISourceClaimInput],
    agreed_choice: str | None,
    *,
    deterministic_result: DeterministicValidationResult | None = None,
) -> bool:
    """
    Enforce the Zero-LLM-Answer-Overwrite invariant:
    - LLMs NEVER invent an answer key when source_claims is empty.
    - LLMs NEVER overwrite a conflicting source answer key.
    - Explanations are permitted ONLY when deterministic validation did not flag
      disagreement/review_required AND both models agreed with a valid source claim.
    """
    if not source_claims or not agreed_choice:
        return False
    if comparison_status != VerificationStatus.AGREEMENT:
        return False
    source_keys = {c.claimed_choice_key.strip() for c in source_claims if c.claimed_choice_key}
    if agreed_choice.strip() not in source_keys:
        return False
    if deterministic_result is not None and deterministic_result.review_required:
        return False
    return True
