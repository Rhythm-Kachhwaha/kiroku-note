"""Domain services and computations for 2-track grammar progress & mastery."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Literal

ProofModality = Literal[
    "spot_in_wild",
    "conjugation_cloze",
    "nuance_battle",
]

VALID_MODALITIES: set[str] = {
    "spot_in_wild",
    "conjugation_cloze",
    "nuance_battle",
}

MODALITY_WEIGHTS: dict[str, float] = {
    "spot_in_wild": 0.25,
    "conjugation_cloze": 0.35,
    "nuance_battle": 0.40,
}

MODALITY_BASE_INCREMENTS: dict[str, float] = {
    "spot_in_wild": 12.0,
    "conjugation_cloze": 15.0,
    "nuance_battle": 18.0,
}

PipelineStatus = Literal["unseen", "encountered", "practicing", "mastered"]


def compute_pipeline_status(seen_count: int, mastery_score: float, drill_count: int = 0) -> PipelineStatus:
    """Determine the 4-stage pipeline status from exposure and mastery.

    - Unseen: 0 encounters, 0% mastery
    - Encountered: Seen >= 1 time, 0% mastery (and no drills initiated)
    - Practicing: Initiated drills or has 1%-79% mastery
    - Mastered: Proven across drills with >= 80% mastery score
    """
    mastery = max(0.0, min(100.0, float(mastery_score or 0.0)))
    encounters = max(0, int(seen_count or 0))
    drills = max(0, int(drill_count or 0))

    if mastery >= 80.0 and drills > 0:
        return "mastered"
    if drills > 0 or mastery > 0.0:
        return "practicing"
    if encounters >= 1:
        return "encountered"
    return "unseen"


def calculate_modality_mastery(
    current_mastery: float,
    modality: str,
    is_correct: bool,
    current_stability: float = 0.0,
    current_difficulty: float = 5.0,
    last_drilled_at: str | None = None,
    now: datetime | None = None,
) -> dict[str, float | str]:
    """Calculate updated mastery score and FSRS memory parameters based on drill outcome.

    Active verification across 3 proof modalities:
    1) spot_in_wild (0.25 weight)
    2) conjugation_cloze (0.35 weight)
    3) nuance_battle (0.40 weight)
    """
    if modality not in VALID_MODALITIES:
        raise ValueError(f"Invalid modality '{modality}'. Expected one of {sorted(VALID_MODALITIES)}")

    curr_now = now or datetime.now(timezone.utc)
    now_iso = curr_now.isoformat()

    # Apply retrievability decay if previously drilled
    retrievability = 1.0
    effective_mastery = current_mastery
    if last_drilled_at and current_stability > 0.0:
        try:
            last_dt = datetime.fromisoformat(last_drilled_at)
            elapsed_days = max(0.0, (curr_now - last_dt).total_seconds() / 86400.0)
            # Standard FSRS / Ebbinghaus forgetting curve: R = (1 + elapsed / (9 * S)) ^ -1
            retrievability = math.pow(1.0 + (elapsed_days / (9.0 * current_stability)), -1.0)
            retrievability = max(0.1, min(1.0, retrievability))
            effective_mastery = current_mastery * (0.85 + 0.15 * retrievability)
        except Exception:
            retrievability = 1.0

    weight = MODALITY_WEIGHTS[modality]
    base_delta = MODALITY_BASE_INCREMENTS[modality]

    if is_correct:
        # Diminishing returns as mastery approaches 100%
        headroom = max(0.0, 100.0 - effective_mastery)
        gain = base_delta * (0.6 + 0.4 * (headroom / 100.0)) * (0.7 + 0.3 * weight)
        new_mastery = min(100.0, effective_mastery + gain)
        score_delta = round(new_mastery - current_mastery, 2)

        # Update FSRS stability & difficulty
        new_difficulty = max(1.0, current_difficulty - 0.2)
        new_stability = max(1.0, current_stability * 1.8 + 1.0)
    else:
        # Penalty for failure on drill
        penalty = base_delta * 0.75 * (0.8 + 0.4 * weight)
        new_mastery = max(0.0, effective_mastery - penalty)
        score_delta = round(new_mastery - current_mastery, 2)

        new_difficulty = min(10.0, current_difficulty + 0.5)
        new_stability = max(0.5, current_stability * 0.5)

    new_mastery = round(max(0.0, min(100.0, new_mastery)), 2)

    return {
        "new_mastery": new_mastery,
        "score_delta": score_delta,
        "new_stability": round(new_stability, 3),
        "new_difficulty": round(new_difficulty, 3),
        "retrievability": round(retrievability, 3),
        "timestamp": now_iso,
    }
