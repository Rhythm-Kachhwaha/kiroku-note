"""10-page pilot runner for source acquisition quality verification."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

from app.study.acquisition.models import FetchOptions
from app.study.acquisition.parsers.base import BaseSourceParser
from app.study.acquisition.parsers.invariants import (
    InvariantScanReport,
    apply_invariant_quarantine,
    linear_scan_exercise,
)
from app.study.acquisition.parsers.registry import get_source_parser
from app.study.acquisition.providers.base import BaseAcquisitionProvider
from app.study.acquisition.reliability import (
    SourceReliabilityStatus,
    SourceReliabilityTracker,
)
from app.study.acquisition.source_profiles import SourceProfile
from app.study.verification.deterministic import (
    DeterministicAnswerValidator,
    DeterministicValidationResult,
)


@dataclass
class PilotPageResult:
    """Verification outcome for a single pilot crawl page."""

    url: str
    fetched: bool = False
    parsed: bool = False
    questions_total: int = 0
    questions_quarantined: int = 0
    invariant_violations: int = 0
    deterministic_disagreements: int = 0
    error: str | None = None
    scan_report: InvariantScanReport | None = None
    deterministic_results: list[DeterministicValidationResult] = field(default_factory=list)


@dataclass
class PilotReport:
    """Aggregate report from a bounded pilot crawl."""

    source_slug: str
    max_pages: int
    pages_attempted: int
    pages_succeeded: int
    pages_failed: int
    questions_total: int
    questions_quarantined: int
    invariant_violations: int
    deterministic_disagreements: int
    error_rate: float
    error_threshold: float
    quarantined: bool
    reliability_status: SourceReliabilityStatus
    quarantine_reason: str = ""
    page_results: list[PilotPageResult] = field(default_factory=list)


def run_pilot(
    urls: Sequence[str],
    profile: SourceProfile,
    *,
    provider: BaseAcquisitionProvider,
    parser: BaseSourceParser | None = None,
    dict_engine: Any | None = None,
    deterministic_validator: DeterministicAnswerValidator | None = None,
    max_pages: int = 10,
    error_threshold: float | None = None,
    tracker: SourceReliabilityTracker | None = None,
    fetch_options: FetchOptions | None = None,
) -> PilotReport:
    """Run a bounded pilot crawl (default 10 pages) with invariant + deterministic checks."""
    limit = max(1, int(max_pages))
    pilot_urls = [str(u).strip() for u in urls if str(u).strip()][:limit]

    threshold = (
        float(profile.error_threshold)
        if error_threshold is None
        else float(error_threshold)
    )
    active_parser = parser or get_source_parser(profile.parser_id)
    active_tracker = tracker or SourceReliabilityTracker(default_error_threshold=threshold)
    validator = deterministic_validator or DeterministicAnswerValidator(dict_engine=dict_engine)

    page_results: list[PilotPageResult] = []
    pages_succeeded = 0
    pages_failed = 0
    total_questions = 0
    total_quarantined = 0
    total_violations = 0
    total_disagreements = 0

    for url in pilot_urls:
        page_res = PilotPageResult(url=url)
        try:
            raw_fetch = provider.fetch_page(url, fetch_options)
            page_res.fetched = True
        except Exception as exc:
            page_res.error = f"fetch_failed: {exc}"
            pages_failed += 1
            page_results.append(page_res)
            active_tracker.record_page_outcome(
                profile.source_slug,
                page_failed=True,
                error_threshold=threshold,
                note=page_res.error,
            )
            continue

        try:
            parsed = active_parser.parse(
                raw_fetch.raw_markdown,
                url=url,
                title=raw_fetch.title,
            )
            page_res.parsed = True
        except Exception as exc:
            page_res.error = f"parse_failed: {exc}"
            pages_failed += 1
            page_results.append(page_res)
            active_tracker.record_page_outcome(
                profile.source_slug,
                page_failed=True,
                error_threshold=threshold,
                note=page_res.error,
            )
            continue

        scan = linear_scan_exercise(parsed)
        apply_invariant_quarantine(parsed, scan)
        page_res.scan_report = scan

        det_results = validator.validate_parsed_exercise(parsed)
        page_res.deterministic_results = det_results
        det_by_id = {r.question_external_id: r for r in det_results}

        disagreements = 0
        for q in parsed.questions:
            det_r = det_by_id.get(q.external_id)
            if det_r is not None and det_r.disagreement:
                disagreements += 1
                q.is_quarantined = True
                if det_r.reason and det_r.reason not in q.quarantine_reasons:
                    q.quarantine_reasons.append(det_r.reason)

        q_total = len(parsed.questions)
        q_quarantined = sum(1 for q in parsed.questions if q.is_quarantined)
        v_count = len(scan.violations)
        has_error_violation = any(v.severity == "error" for v in scan.violations)
        page_bad = (q_total == 0) or has_error_violation or (v_count > 0 and q_quarantined >= q_total)

        page_res.questions_total = q_total
        page_res.questions_quarantined = q_quarantined
        page_res.invariant_violations = v_count
        page_res.deterministic_disagreements = disagreements
        page_results.append(page_res)

        if page_bad:
            pages_failed += 1
        else:
            pages_succeeded += 1

        total_questions += q_total
        total_quarantined += q_quarantined
        total_violations += v_count
        total_disagreements += disagreements

        active_tracker.record_page_outcome(
            profile.source_slug,
            page_failed=page_bad,
            questions_scanned=q_total,
            questions_quarantined=q_quarantined,
            invariant_violations=v_count,
            deterministic_disagreements=disagreements,
            error_threshold=threshold,
        )

    rec = active_tracker.get_record(profile.source_slug, error_threshold=threshold)
    active_tracker.evaluate_source(profile.source_slug)
    return PilotReport(
        source_slug=profile.source_slug,
        max_pages=limit,
        pages_attempted=len(pilot_urls),
        pages_succeeded=pages_succeeded,
        pages_failed=pages_failed,
        questions_total=total_questions,
        questions_quarantined=total_quarantined,
        invariant_violations=total_violations,
        deterministic_disagreements=total_disagreements,
        error_rate=rec.error_rate,
        error_threshold=rec.error_threshold,
        quarantined=(rec.status == SourceReliabilityStatus.QUARANTINED),
        reliability_status=rec.status,
        quarantine_reason=rec.quarantine_reason,
        page_results=page_results,
    )
