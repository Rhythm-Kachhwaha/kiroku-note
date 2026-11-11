"""Per-source reliability tracking and automatic quarantine logic."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class SourceReliabilityStatus(str, Enum):
    """Health classification for an acquisition source."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    QUARANTINED = "quarantined"


@dataclass
class SourceReliabilityRecord:
    """Cumulative reliability telemetry for a single source slug."""

    source_slug: str
    error_threshold: float = 0.25
    pages_attempted: int = 0
    pages_failed: int = 0
    questions_scanned: int = 0
    questions_quarantined: int = 0
    invariant_violations: int = 0
    deterministic_disagreements: int = 0
    status: SourceReliabilityStatus = SourceReliabilityStatus.HEALTHY
    quarantine_reason: str = ""
    last_updated_at: str = ""
    notes: list[str] = field(default_factory=list)

    @property
    def page_error_rate(self) -> float:
        if self.pages_attempted <= 0:
            return 0.0
        return self.pages_failed / self.pages_attempted

    @property
    def question_error_rate(self) -> float:
        if self.questions_scanned <= 0:
            return 0.0
        bad = max(self.questions_quarantined, self.deterministic_disagreements)
        return min(1.0, bad / self.questions_scanned)

    @property
    def error_rate(self) -> float:
        """Effective error rate combining page failures and question-level issues."""
        if self.pages_attempted <= 0 and self.questions_scanned <= 0:
            return 0.0
        if self.questions_scanned <= 0:
            return self.page_error_rate
        # Either high page failure rate or high question corruption/disagreement rate triggers quarantine.
        return max(self.page_error_rate, self.question_error_rate)


class SourceReliabilityTracker:
    """Tracks source error rates and automatically quarantines unreliable sources."""

    def __init__(self, default_error_threshold: float = 0.25) -> None:
        self._default_threshold = max(0.0, min(1.0, float(default_error_threshold)))
        self._records: dict[str, SourceReliabilityRecord] = {}

    def get_record(
        self,
        source_slug: str,
        *,
        error_threshold: float | None = None,
    ) -> SourceReliabilityRecord:
        slug = (source_slug or "").strip().lower()
        if not slug:
            raise ValueError("source_slug must be non-empty")
        rec = self._records.get(slug)
        if rec is None:
            threshold = self._default_threshold if error_threshold is None else float(error_threshold)
            rec = SourceReliabilityRecord(
                source_slug=slug,
                error_threshold=max(0.0, min(1.0, threshold)),
                last_updated_at=datetime.now(timezone.utc).isoformat(),
            )
            self._records[slug] = rec
        elif error_threshold is not None:
            rec.error_threshold = max(0.0, min(1.0, float(error_threshold)))
        return rec

    def record_page_outcome(
        self,
        source_slug: str,
        *,
        page_failed: bool = False,
        questions_scanned: int = 0,
        questions_quarantined: int = 0,
        invariant_violations: int = 0,
        deterministic_disagreements: int = 0,
        error_threshold: float | None = None,
        note: str = "",
    ) -> SourceReliabilityRecord:
        """Record one page's extraction/verification metrics and re-evaluate status."""
        rec = self.get_record(source_slug, error_threshold=error_threshold)
        rec.pages_attempted += 1
        if page_failed:
            rec.pages_failed += 1
        rec.questions_scanned += max(0, int(questions_scanned))
        rec.questions_quarantined += max(0, int(questions_quarantined))
        rec.invariant_violations += max(0, int(invariant_violations))
        rec.deterministic_disagreements += max(0, int(deterministic_disagreements))
        if note:
            rec.notes.append(note)
        rec.last_updated_at = datetime.now(timezone.utc).isoformat()
        return self.evaluate_source(rec.source_slug)

    def compute_error_rate(self, source_slug: str) -> float:
        rec = self.get_record(source_slug)
        return rec.error_rate

    def evaluate_source(self, source_slug: str) -> SourceReliabilityRecord:
        """Evaluate reliability thresholds and downgrade/quarantine when exceeded."""
        rec = self.get_record(source_slug)
        rate = rec.error_rate
        if rate > rec.error_threshold:
            rec.status = SourceReliabilityStatus.QUARANTINED
            rec.quarantine_reason = (
                f"Error rate {rate:.1%} exceeded threshold {rec.error_threshold:.1%} "
                f"(pages_failed={rec.pages_failed}/{rec.pages_attempted}, "
                f"questions_quarantined={rec.questions_quarantined}/{rec.questions_scanned}, "
                f"disagreements={rec.deterministic_disagreements})"
            )
        elif rate > (rec.error_threshold * 0.5) and rate > 0.0:
            rec.status = SourceReliabilityStatus.DEGRADED
            rec.quarantine_reason = ""
        else:
            rec.status = SourceReliabilityStatus.HEALTHY
            rec.quarantine_reason = ""
        return rec

    def is_quarantined(self, source_slug: str) -> bool:
        rec = self._records.get((source_slug or "").strip().lower())
        if rec is None:
            return False
        return rec.status == SourceReliabilityStatus.QUARANTINED

    def list_records(self) -> list[SourceReliabilityRecord]:
        return [self._records[k] for k in sorted(self._records)]
