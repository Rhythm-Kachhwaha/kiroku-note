"""Deterministic What-Next practice recommendation queue (weak results + word_states + encounters)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from app.db.connection import (
    db_session,
    ensure_vocab_practice_tables,
    ensure_vocab_state_tables,
)
from app.services.vocab_practice.categories import (
    CAT_ADJECTIVE_I,
    CAT_ADVERB,
    CAT_ONOMATOPOEIA,
    CAT_SURU_VERB,
    CAT_VERB_GODAN,
    CAT_VERB_ICHIDAN,
    CAT_VERB_INTRANSITIVE,
    CAT_VERB_KURU,
    CAT_VERB_TRANSITIVE,
)
from app.services.vocab_practice.models import PracticeRecommendation


_STATE_PRIORITY_WEIGHTS: dict[str, float] = {
    "tracking": 30.0,
    "learning": 25.0,
    "seen": 18.0,
    "unseen": 10.0,
    "known": 2.0,
}

_EXCLUDED_STATES = frozenset({"blacklisted", "ignored"})


def _select_question_type_for_word(
    categories: tuple[str, ...],
    has_sentence: bool,
    weakest_qtype: str | None = None,
) -> str:
    if weakest_qtype:
        return weakest_qtype
    cats = set(categories)
    if (CAT_ONOMATOPOEIA in cats or CAT_ADVERB in cats) and has_sentence:
        return "contrast_cloze"
    if (CAT_VERB_TRANSITIVE in cats) ^ (CAT_VERB_INTRANSITIVE in cats):
        if has_sentence:
            return "vt_vi_drill"
    if cats & {CAT_VERB_ICHIDAN, CAT_VERB_GODAN, CAT_VERB_KURU, CAT_SURU_VERB, CAT_ADJECTIVE_I}:
        return "conjugation_drill"
    if has_sentence:
        return "typed_recall_meaning"
    return "typed_recall_reading"


def recommend_practice_queue(
    *,
    limit: int = 20,
    category: str | None = None,
    db_path: Path | str | None = None,
) -> list[PracticeRecommendation]:
    """
    Rank candidate words/question types deterministically by:
    1. Weak vocab_practice_results (low accuracy / recent errors)
    2. word_states lifecycle priority (tracking/learning/seen; excluding blacklisted/ignored)
    3. word_encounters frequency
    """
    safe_limit = max(1, min(int(limit), 200))

    with db_session(db_path) as conn:
        ensure_vocab_state_tables(conn)
        ensure_vocab_practice_tables(conn)

        state_rows = conn.execute(
            """
            SELECT sequence_id, reading, expression, state
            FROM word_states
            WHERE sequence_id IS NOT NULL
              AND state NOT IN ('blacklisted', 'ignored')
            """
        ).fetchall()
        if not state_rows:
            return []

        # Map categories by sequence_id
        cat_rows = conn.execute(
            "SELECT sequence_id, category FROM word_categories"
        ).fetchall()
        cats_by_seq: dict[int, list[str]] = {}
        for r in cat_rows:
            cats_by_seq.setdefault(int(r["sequence_id"]), []).append(str(r["category"]))

        # Encounter counts & presence of sentence evidence per (sequence_id, reading)
        enc_rows = conn.execute(
            """
            SELECT sequence_id, reading,
                   COUNT(*) AS enc_count,
                   SUM(CASE WHEN sentence != '' THEN 1 ELSE 0 END) AS sent_count
            FROM word_encounters
            WHERE sequence_id IS NOT NULL
            GROUP BY sequence_id, reading
            """
        ).fetchall()
        enc_map: dict[tuple[int, str], tuple[int, bool]] = {
            (int(r["sequence_id"]), str(r["reading"] or "")): (
                int(r["enc_count"]),
                int(r["sent_count"] or 0) > 0,
            )
            for r in enc_rows
        }

        # Practice results per (sequence_id, reading, question_type)
        res_rows = conn.execute(
            """
            SELECT sequence_id, reading, question_type,
                   COUNT(*) AS attempts,
                   COALESCE(SUM(is_correct), 0) AS correct
            FROM vocab_practice_results
            GROUP BY sequence_id, reading, question_type
            """
        ).fetchall()
        word_results: dict[tuple[int, str], list[tuple[str, int, int]]] = {}
        for r in res_rows:
            key = (int(r["sequence_id"]), str(r["reading"] or ""))
            word_results.setdefault(key, []).append(
                (str(r["question_type"]), int(r["attempts"]), int(r["correct"]))
            )

    recommendations: list[PracticeRecommendation] = []
    for row in state_rows:
        seq_id = int(row["sequence_id"])
        reading = str(row["reading"] or "")
        expr = str(row["expression"] or "")
        state = str(row["state"] or "unseen")
        if state in _EXCLUDED_STATES:
            continue

        word_cats = tuple(dict.fromkeys(cats_by_seq.get(seq_id, ())))
        if category and category not in word_cats:
            continue

        enc_count, has_sentence = enc_map.get((seq_id, reading), (0, False))
        per_type = word_results.get((seq_id, reading), [])

        total_attempts = sum(a for _, a, _ in per_type)
        total_correct = sum(c for _, _, c in per_type)
        overall_acc: float | None = (
            round(total_correct / total_attempts, 4) if total_attempts > 0 else None
        )

        # Identify weakest practiced question type if any has accuracy < 0.8
        weakest_qtype: str | None = None
        if per_type:
            weakest = min(per_type, key=lambda item: (item[2] / max(1, item[1]), -item[1]))
            if weakest[2] / max(1, weakest[1]) < 0.8:
                weakest_qtype = weakest[0]

        qtype = _select_question_type_for_word(word_cats, has_sentence, weakest_qtype=weakest_qtype)

        reasons: list[str] = []
        score = _STATE_PRIORITY_WEIGHTS.get(state, 5.0)
        reasons.append(f"state:{state}")

        if overall_acc is not None:
            weakness_boost = (1.0 - overall_acc) * 40.0
            score += weakness_boost
            if overall_acc < 0.7:
                reasons.append(f"weak_accuracy:{overall_acc:.2f}")
        else:
            score += 12.0
            reasons.append("unpracticed")

        if enc_count > 0:
            freq_boost = min(enc_count, 20) * 1.5
            score += freq_boost
            reasons.append(f"encounters:{enc_count}")

        recommendations.append(
            PracticeRecommendation(
                sequence_id=seq_id,
                expression=expr,
                reading=reading,
                recommended_question_type=qtype,
                priority_score=score,
                word_state=state,
                encounter_count=enc_count,
                accuracy=overall_acc,
                attempt_count=total_attempts,
                categories=word_cats,
                reasons=tuple(reasons),
            )
        )

    recommendations.sort(
        key=lambda rec: (-rec.priority_score, -rec.encounter_count, rec.sequence_id, rec.reading)
    )
    return recommendations[:safe_limit]
