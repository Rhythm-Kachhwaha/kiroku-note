import math
from dataclasses import dataclass
from enum import IntEnum
from typing import Dict, Any, Optional

class Rating(IntEnum):
    AGAIN = 1
    HARD = 2
    GOOD = 3
    EASY = 4

class CardState(IntEnum):
    NEW = 0
    LEARNING = 1
    REVIEW = 2
    RELEARNING = 3

@dataclass
class FSRSRecord:
    stability: float
    difficulty: float
    scheduled_days: int
    interval_label: str
    due_interval_str: str
    next_state: int
    reps: int
    lapses: int

DEFAULT_WEIGHTS = (
    0.4072, 1.1829, 3.1262, 15.4722,  # w0-w3: initial stabilities
    7.2102, 0.5316,                   # w4-w5: initial difficulty
    1.0651, 0.0234,                   # w6-w7: difficulty update
    1.616, 0.1544, 1.0824,            # w8-w10: stability update for recall
    1.9813, 0.0953, 0.2975,           # w11-w13: stability update for lapse
    0.2272, 0.2955, 0.4908,           # w14-w16: hard/good/easy stability modifiers
    2.9998, 0.4449                    # w17-w18
)

class FSRSEngine:
    def __init__(
        self,
        easy_initial_cap_days: int = 6,
        desired_retention: float = 0.90,
        max_interval_days: int = 365,
        weights: tuple = DEFAULT_WEIGHTS
    ):
        self.easy_initial_cap_days = max(1, easy_initial_cap_days)
        self.desired_retention = max(0.70, min(0.99, desired_retention))
        self.max_interval_days = max_interval_days
        self.w = weights

    def _format_interval(self, days: int) -> str:
        if days <= 0:
            return "<10m"
        elif days == 1:
            return "1d"
        elif days < 30:
            return f"{days}d"
        elif days < 365:
            months = round(days / 30.0, 1)
            return f"{int(months) if months.is_integer() else months}mo"
        else:
            years = round(days / 365.0, 1)
            return f"{int(years) if years.is_integer() else years}y"

    def schedule(
        self,
        rating: Rating,
        stability: float = 0.0,
        difficulty: float = 0.0,
        reps: int = 0,
        lapses: int = 0,
        elapsed_days: int = 0,
        state: CardState = CardState.NEW
    ) -> FSRSRecord:
        # Initial review for NEW cards or ungraduated (reps == 0)
        if state == CardState.NEW or reps == 0:
            return self._schedule_new(rating=rating, lapses=lapses)

        # Subsequent review (graduated or relearning)
        return self._schedule_review(
            rating=rating,
            stability=stability,
            difficulty=difficulty,
            reps=reps,
            lapses=lapses,
            elapsed_days=elapsed_days,
            state=state
        )

    def _schedule_new(self, rating: Rating, lapses: int) -> FSRSRecord:
        # Initial difficulty D_0(G) = w4 - (G - 3) * w5
        diff = max(1.0, min(10.0, self.w[4] - (int(rating) - 3) * self.w[5]))

        if rating == Rating.AGAIN:
            stab = self.w[0]
            days = 0
            label = "<10m"
            next_state = CardState.LEARNING
            next_reps = 0
        elif rating == Rating.HARD:
            stab = self.w[1]
            days = 1
            label = "1d"
            next_state = CardState.REVIEW
            next_reps = 1
        elif rating == Rating.GOOD:
            stab = self.w[2]
            days = 3
            label = "3d"
            next_state = CardState.REVIEW
            next_reps = 1
        else:  # Rating.EASY
            # Adaptable Easy Cap for first graduation
            days = self.easy_initial_cap_days
            stab = max(float(days), self.w[3])
            label = f"{days}d"
            next_state = CardState.REVIEW
            next_reps = 1

        return FSRSRecord(
            stability=round(stab, 4),
            difficulty=round(diff, 4),
            scheduled_days=days,
            interval_label=label,
            due_interval_str=label,
            next_state=next_state,
            reps=next_reps,
            lapses=lapses
        )

    def _schedule_review(
        self,
        rating: Rating,
        stability: float,
        difficulty: float,
        reps: int,
        lapses: int,
        elapsed_days: int,
        state: CardState
    ) -> FSRSRecord:
        cur_stab = max(0.1, stability)
        cur_diff = max(1.0, min(10.0, difficulty if difficulty > 0 else self.w[4]))

        if rating == Rating.AGAIN:
            # Card lapsed
            next_lapses = lapses + 1
            next_state = CardState.RELEARNING
            days = 0
            label = "<10m"
            # Stability reduction using standard FSRS post-lapse stability model
            post_lapse = self.w[11] * math.pow(cur_diff, -self.w[12]) * (math.pow(cur_stab + 1.0, self.w[13]) - 1.0)
            new_stab = max(0.1, min(cur_stab, post_lapse))
            new_diff = min(10.0, cur_diff + self.w[6])
            next_reps = reps + 1
            return FSRSRecord(
                stability=round(new_stab, 4),
                difficulty=round(new_diff, 4),
                scheduled_days=days,
                interval_label=label,
                due_interval_str=label,
                next_state=next_state,
                reps=next_reps,
                lapses=next_lapses
            )

        # Successful recall (HARD, GOOD, EASY)
        factor = 19.0 / 81.0
        # Retrievability R(t, s)
        t = max(0.0, float(elapsed_days))
        r = math.pow(1.0 + factor * t / cur_stab, -0.5)
        r = max(0.05, min(0.99, r))

        # Difficulty update with mean reversion
        delta_d = -self.w[6] * (int(rating) - 3)
        target_d = cur_diff + delta_d
        new_diff = max(1.0, min(10.0, self.w[7] * self.w[4] + (1.0 - self.w[7]) * target_d))

        # Stability update
        hard_penalty = self.w[14] if rating == Rating.HARD else 1.0
        easy_bonus = (1.0 + self.w[16]) if rating == Rating.EASY else 1.0

        growth = math.exp(self.w[8]) * (11.0 - new_diff) * math.pow(cur_stab, -self.w[9]) * (math.exp((1.0 - r) * self.w[10]) - 1.0) * hard_penalty * easy_bonus
        new_stab = cur_stab * (1.0 + max(0.05, growth))

        if rating == Rating.EASY:
            new_stab = max(new_stab, cur_stab * 2.2)
        elif rating == Rating.HARD:
            new_stab = max(1.0, min(new_stab, cur_stab * 1.2))

        # Calculate interval based on stability and desired retention
        raw_interval = (new_stab / factor) * (math.pow(self.desired_retention, -2.0) - 1.0)
        days = max(1, round(raw_interval))

        if rating == Rating.HARD:
            days = max(1, min(days, max(1, round(cur_stab * 0.8))))
        elif rating == Rating.EASY:
            days = max(days, elapsed_days + 5, 14)

        if self.max_interval_days:
            days = min(days, self.max_interval_days)

        label = self._format_interval(days)
        next_state = CardState.REVIEW
        next_reps = reps + 1

        return FSRSRecord(
            stability=round(new_stab, 4),
            difficulty=round(new_diff, 4),
            scheduled_days=days,
            interval_label=label,
            due_interval_str=label,
            next_state=next_state,
            reps=next_reps,
            lapses=lapses
        )

    def get_intervals_preview(
        self,
        stability: float = 0.0,
        difficulty: float = 0.0,
        reps: int = 0,
        lapses: int = 0,
        elapsed_days: int = 0,
        state: CardState = CardState.NEW
    ) -> Dict[str, str]:
        ratings = {
            "again": Rating.AGAIN,
            "hard": Rating.HARD,
            "good": Rating.GOOD,
            "easy": Rating.EASY
        }
        res = {}
        for key, rat in ratings.items():
            record = self.schedule(
                rating=rat,
                stability=stability,
                difficulty=difficulty,
                reps=reps,
                lapses=lapses,
                elapsed_days=elapsed_days,
                state=state
            )
            res[key] = record.interval_label
        return res
