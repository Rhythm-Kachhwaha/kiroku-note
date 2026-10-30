"""
Adaptive Question Selection & Repetition Engine.
------------------------------------------------
Implements a deterministic, explainable adaptive selection policy based on attempt history,
correctness records, and learner difficulty feedback (Easy / Normal / Hard).

Selection Rules:
1. Two-time Correct + Easy Deprioritization: Questions answered correctly and rated 'easy'
   twice consecutively (consecutive_correct_easy >= 2) are strongly deprioritized (priority: 5.0)
   but never permanently removed.
2. Incorrect Question Prioritization: Questions answered incorrectly receive the highest repetition
   priority (priority: 200.0 - 250.0).
3. Hard Question Prioritization: Questions rated 'hard' receive high repetition priority
   (priority: 160.0 for correct-hard, 250.0 for incorrect-hard).
4. Normal Question Pacing: Questions answered correctly and rated 'normal' follow a moderate
   priority schedule (priority: 80.0).
5. Fresh Material Exploration: Unpracticed questions receive baseline high priority (priority: 120.0).
6. Consecutive Session Avoidance: Questions presented in the immediately preceding session receive
   a cooldown penalty (priority * 0.1) when sufficient candidate alternatives exist.
7. Intra-Session Deduplication: Sessions never repeat the same question.
8. Strict Eligibility Enforcement: Only questions passing evaluate_eligibility() enter the pool.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import random
import sqlite3
from typing import Any, List, Optional, Tuple

from app.study.eligibility import evaluate_eligibility
from app.study.session.enums import DifficultyRating


PRIORITY_INCORRECT_HARD = 250.0
PRIORITY_INCORRECT = 200.0
PRIORITY_CORRECT_HARD = 160.0
PRIORITY_UNATTEMPTED = 120.0
PRIORITY_CORRECT_NORMAL = 80.0
PRIORITY_CORRECT_EASY_ONCE = 40.0
PRIORITY_DEPRIORITIZED_EASY_TWICE = 5.0


def calculate_priority_score(
    total_attempts: int,
    last_is_correct: Optional[int],
    last_rating: Optional[str],
    consecutive_correct_easy: int,
) -> float:
    """
    Calculate the deterministic adaptive priority score for a question.
    Higher score indicates higher priority for repetition/selection.
    """
    if total_attempts == 0 or last_is_correct is None:
        return PRIORITY_UNATTEMPTED

    if last_is_correct == 0:
        if last_rating == DifficultyRating.HARD.value:
            return PRIORITY_INCORRECT_HARD
        return PRIORITY_INCORRECT

    # Question was answered correctly on last attempt
    if consecutive_correct_easy >= 2:
        return PRIORITY_DEPRIORITIZED_EASY_TWICE

    if last_rating == DifficultyRating.HARD.value:
        return PRIORITY_CORRECT_HARD

    if last_rating == DifficultyRating.EASY.value or consecutive_correct_easy == 1:
        return PRIORITY_CORRECT_EASY_ONCE

    # Default moderate schedule for normal or unrated correct
    return PRIORITY_CORRECT_NORMAL


def select_practice_candidates(
    conn: sqlite3.Connection,
    level: Optional[str] = None,
    category: Optional[str] = None,
    format_code: Optional[str] = None,
    limit: int = 10,
    seed: Optional[int] = None,
    previous_session_id: Optional[int] = None,
) -> List[Tuple[int, int]]:
    """
    Select eligible questions from the approved question bank using deterministic adaptive rules.

    Returns:
        List of tuples: [(question_id, current_revision_id), ...]
    """
    # 1. Fetch pre-filtered candidates from database matching criteria
    query_parts = [
        """
        SELECT
            q.id as question_id,
            q.current_revision_id,
            q.level,
            q.category,
            q.format_code,
            COALESCE(qas.total_attempts, 0) as total_attempts,
            COALESCE(qas.total_correct, 0) as total_correct,
            COALESCE(qas.consecutive_correct_easy, 0) as consecutive_correct_easy,
            qas.last_is_correct,
            qas.last_rating,
            qas.last_attempted_at,
            qas.last_session_id
        FROM question q
        LEFT JOIN question_adaptive_state qas ON q.id = qas.question_id
        WHERE q.status = 'active'
          AND q.current_revision_id IS NOT NULL
        """
    ]
    params: List[Any] = []

    if level:
        query_parts.append("AND q.level = ?")
        params.append(level)
    if category:
        query_parts.append("AND q.category = ?")
        params.append(category)
    if format_code:
        query_parts.append("AND q.format_code = ?")
        params.append(format_code)

    cursor = conn.execute(" ".join(query_parts), params)
    raw_candidates = cursor.fetchall()

    # 2. Filter strictly through authoritative evaluate_eligibility()
    eligible_candidates = []
    for cand in raw_candidates:
        q_id = cand["question_id"]
        is_eligible, _ = evaluate_eligibility(q_id, conn)
        if is_eligible:
            eligible_candidates.append(cand)

    if not eligible_candidates:
        return []

    # 3. Detect previous session if not provided
    if previous_session_id is None:
        prev_sess = conn.execute(
            """
            SELECT id FROM test_attempt
            WHERE status IN ('completed', 'in_progress')
            ORDER BY id DESC LIMIT 1;
            """
        ).fetchone()
        if prev_sess:
            previous_session_id = prev_sess["id"]

    # Check whether we have enough alternative candidates outside previous session
    prev_session_q_ids = set()
    if previous_session_id is not None:
        rows = conn.execute(
            "SELECT question_id FROM attempt_item WHERE attempt_id = ?;",
            (previous_session_id,),
        ).fetchall()
        prev_session_q_ids = {r["question_id"] for r in rows}

    has_enough_alternatives = (len(eligible_candidates) - len(prev_session_q_ids)) >= limit

    # 4. Compute priority score for each candidate
    scored_candidates = []
    effective_seed = seed if seed is not None else 42

    for cand in eligible_candidates:
        q_id = cand["question_id"]
        curr_rev_id = cand["current_revision_id"]

        score = calculate_priority_score(
            total_attempts=cand["total_attempts"],
            last_is_correct=cand["last_is_correct"],
            last_rating=cand["last_rating"],
            consecutive_correct_easy=cand["consecutive_correct_easy"],
        )

        # Apply consecutive session avoidance penalty
        if has_enough_alternatives and (q_id in prev_session_q_ids or cand["last_session_id"] == previous_session_id):
            score *= 0.1

        # Deterministic pseudo-random tie breaker using seed and question_id
        tie_hash = int(hashlib.sha256(f"{effective_seed}:{q_id}".encode()).hexdigest()[:8], 16)

        last_attempt = cand["last_attempted_at"] or ""
        scored_candidates.append((score, last_attempt, tie_hash, q_id, curr_rev_id))

    # 5. Sort deterministically:
    # Primary: priority score DESC
    # Secondary: last_attempted_at ASC (empty string first = unattempted first)
    # Tertiary: tie_hash
    scored_candidates.sort(key=lambda x: (-x[0], x[1], x[2]))

    # 6. Deduplicate and take top `limit`
    selected: List[Tuple[int, int]] = []
    seen = set()
    for _, _, _, q_id, rev_id in scored_candidates:
        if q_id not in seen:
            seen.add(q_id)
            selected.append((q_id, rev_id))
            if len(selected) >= limit:
                break

    return selected


def update_question_adaptive_state(
    conn: sqlite3.Connection,
    question_id: int,
    is_correct: bool,
    difficulty_rating: Optional[DifficultyRating],
    session_id: int,
) -> None:
    """
    Atomically update or insert question adaptive repetition state upon response submission.
    """
    row = conn.execute(
        """
        SELECT total_attempts, total_correct, consecutive_correct_easy, last_rating
        FROM question_adaptive_state
        WHERE question_id = ?;
        """,
        (question_id,),
    ).fetchone()

    total_attempts = 1
    total_correct = 1 if is_correct else 0
    consecutive_correct_easy = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    rating_val = difficulty_rating.value if difficulty_rating else None

    if row:
        total_attempts = row["total_attempts"] + 1
        total_correct = row["total_correct"] + (1 if is_correct else 0)
        prev_easy = row["consecutive_correct_easy"]
        if not rating_val:
            rating_val = row["last_rating"]

        if is_correct and rating_val == DifficultyRating.EASY.value:
            consecutive_correct_easy = prev_easy + 1
        else:
            consecutive_correct_easy = 0
    else:
        if is_correct and rating_val == DifficultyRating.EASY.value:
            consecutive_correct_easy = 1

    last_is_correct_int = 1 if is_correct else 0
    score = calculate_priority_score(
        total_attempts=total_attempts,
        last_is_correct=last_is_correct_int,
        last_rating=rating_val,
        consecutive_correct_easy=consecutive_correct_easy,
    )

    conn.execute(
        """
        INSERT INTO question_adaptive_state (
            question_id,
            total_attempts,
            total_correct,
            consecutive_correct_easy,
            last_attempted_at,
            last_session_id,
            last_rating,
            last_is_correct,
            priority_score,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(question_id) DO UPDATE SET
            total_attempts = excluded.total_attempts,
            total_correct = excluded.total_correct,
            consecutive_correct_easy = excluded.consecutive_correct_easy,
            last_attempted_at = excluded.last_attempted_at,
            last_session_id = excluded.last_session_id,
            last_rating = excluded.last_rating,
            last_is_correct = excluded.last_is_correct,
            priority_score = excluded.priority_score,
            updated_at = excluded.updated_at;
        """,
        (
            question_id,
            total_attempts,
            total_correct,
            consecutive_correct_easy,
            now_iso,
            session_id,
            rating_val,
            last_is_correct_int,
            score,
            now_iso,
        ),
    )

