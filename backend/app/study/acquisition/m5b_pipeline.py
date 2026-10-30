"""
Milestone 5-B: First Real Question Bank Population and Dual-Model Verification Pipeline.
----------------------------------------------------------------------------------------
Orchestrates:
1. Database initialization and migration verification (0001–0004) with doctor and backup checks.
2. Controlled acquisition of the 10-12 selected pilot exercises (~80 questions: N5 & N4).
3. Real binary media downloading (audio MP3s with duration extraction, diagram images) via MediaStore.
4. M3 Gate 1 deterministic ingestion pipeline (adapters, segmentation, classification, normalization, validation).
5. M3 Gate 2 dual-model verification with genuine independent models and multimodal safety quarantine.
6. Automated approval for verified concordant candidates; strict quarantine for defective, ambiguous,
   unverified, or unsupported media-dependent questions.
7. Atomic persistence with immutable sealed revisions, provenance tracking, and content fingerprints.
8. Rigorous idempotency validation asserting 0 duplicate questions, revisions, sources, or assets.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import sqlite3
from typing import Any, Sequence

from app.config import get_study_dir
from app.study.acquisition.cache import RawAcquisitionCache
from app.study.acquisition.enums import (
    AcquisitionItemStatus,
    AcquisitionJobStatus,
)
from app.study.acquisition.job_service import AcquisitionJobService
from app.study.acquisition.media.asset_downloader import AssetDownloader
from app.study.acquisition.models import DiscoveredExercise
from app.study.acquisition.parsers.japanesetest4you import JapaneseTest4YouParser
from app.study.acquisition.parsers.models import AudioAssociation, ParsedExercise
from app.study.backup import create_study_backup
from app.study.connection import StudyDatabaseManager
from app.study.contracts.enums import (
    JlptLevel,
    QuestionStatus,
    StructuralFamily,
)
from app.study.doctor import DoctorFinding, run_doctor
from app.study.eligibility import evaluate_eligibility
from app.study.ingestion.enums import (
    IngestAdapterKind,
    ReviewReasonCode,
    ReviewStatus,
)
from app.study.ingestion.models import CandidateQuestion, IngestInput, IngestionResult
from app.study.ingestion.pipeline import IngestionPipeline
from app.study.media import MediaStore
from app.study.migrations.runner import run_migrations
from app.study.provenance import normalize_source_url
from app.study.verification.enums import ComparisonScenario, VerificationStatus
from app.study.verification.service import VerificationService

logger = logging.getLogger(__name__)


# -----------------------------------------------------------------------------
# 10 Authoritative Pilot Exercises Target (~80 Questions: 40 N5 + 40 N4)
# -----------------------------------------------------------------------------
PILOT_EXERCISE_SPECS = [
    # N5 Section (Target: ~40 questions)
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-grammar-exercise-1/",
        "level": "N5",
        "section": "grammar",
        "title": "JLPT N5 Grammar Exercise 01",
        "target_count": 10,
    },
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-vocabulary-exercise-1/",
        "level": "N5",
        "section": "vocabulary",
        "title": "JLPT N5 Vocabulary Exercise 01",
        "target_count": 10,
    },
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-kanji-exercise-1/",
        "level": "N5",
        "section": "kanji",
        "title": "JLPT N5 Kanji Exercise 01",
        "target_count": 5,  # Clean items target
    },
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-reading-exercise-1/",
        "level": "N5",
        "section": "reading",
        "title": "JLPT N5 Reading Exercise 01",
        "target_count": 5,
    },
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-listening-exercise-1/",
        "level": "N5",
        "section": "listening",
        "title": "JLPT N5 Listening Exercise 01",
        "target_count": 5,
    },
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n5-listening-exercise-2/",
        "level": "N5",
        "section": "listening",
        "title": "JLPT N5 Listening Exercise 02",
        "target_count": 5,
    },
    # N4 Section (Target: ~40 questions)
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/",
        "level": "N4",
        "section": "grammar",
        "title": "JLPT N4 Grammar Exercise 01",
        "target_count": 10,
    },
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-vocabulary-exercise-1/",
        "level": "N4",
        "section": "vocabulary",
        "title": "JLPT N4 Vocabulary Exercise 01",
        "target_count": 10,
    },
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-kanji-exercise-2/",
        "level": "N4",
        "section": "kanji",
        "title": "JLPT N4 Kanji Exercise 02",
        "target_count": 5,  # Clean items target
    },
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-reading-exercise-1/",
        "level": "N4",
        "section": "reading",
        "title": "JLPT N4 Reading Exercise 01",
        "target_count": 5,  # Blanks 1–5
    },
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-listening-exercise-1/",
        "level": "N4",
        "section": "listening",
        "title": "JLPT N4 Listening Exercise 01",
        "target_count": 5,
    },
    {
        "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-listening-exercise-2/",
        "level": "N4",
        "section": "listening",
        "title": "JLPT N4 Listening Exercise 02",
        "target_count": 5,
    },
]


@dataclass
class PilotExecutionSummary:
    """Detailed metrics and outcomes from an M5-B pilot run."""
    total_discovered_pages: int = 0
    total_acquired_pages: int = 0
    total_questions_discovered: int = 0
    total_questions_ingested: int = 0
    approved_count: int = 0
    quarantined_count: int = 0
    quarantine_reasons: dict[str, int] = field(default_factory=dict)
    jlpt_counts: dict[str, int] = field(default_factory=dict)
    format_counts: dict[str, int] = field(default_factory=dict)
    media_assets_retrieved: int = 0
    audio_tracks_retrieved: int = 0
    diagram_images_retrieved: int = 0
    total_audio_duration_ms: int = 0
    doctor_errors: int = 0
    doctor_warnings: int = 0
    eligible_approved_count: int = 0
    ineligible_quarantined_count: int = 0
    idempotent_re_run_identical: bool = False
    details: list[dict[str, Any]] = field(default_factory=list)


class M5BPilotPipeline:
    """The authoritative runner executing M5-B question bank population."""

    def __init__(
        self,
        db_manager: StudyDatabaseManager | None = None,
        media_store: MediaStore | None = None,
        cache: RawAcquisitionCache | None = None,
        verification_service: VerificationService | None = None,
        downloader: AssetDownloader | None = None,
    ) -> None:
        study_dir = get_study_dir()
        study_dir.mkdir(parents=True, exist_ok=True)
        self.db_manager = db_manager or StudyDatabaseManager(db_path=study_dir / "study.db")
        media_dir = study_dir / "media"
        media_dir.mkdir(parents=True, exist_ok=True)
        self.media_store = media_store or MediaStore(media_dir=media_dir)
        self.cache = cache or RawAcquisitionCache(base_dir=study_dir / "raw_acquisition")
        self.verification_service = verification_service
        self.downloader = downloader or AssetDownloader(media_store=self.media_store)
        self.pipeline = IngestionPipeline()
        self.parser = JapaneseTest4YouParser(downloader=self.downloader)

    def initialize_database(self, run_backup: bool = True) -> list[DoctorFinding]:
        """
        Step A: Apply migrations 0001–0004 in order, test doctor, and take initial backup.
        """
        logger.info("Initializing study.db schema and triggers...")
        conn = self.db_manager.get_connection()
        try:
            run_migrations(conn)
        finally:
            conn.close()

        # Run database doctor to verify pristine baseline
        with self.db_manager.read() as conn:
            findings = run_doctor(conn, media_store=self.media_store, verify_media_hashes=True)
            error_findings = [f for f in findings if f.severity == "ERROR"]
            if error_findings:
                raise RuntimeError(f"Database doctor reported errors after initialization: {error_findings}")

        if run_backup:
            try:
                with self.db_manager.read() as conn:
                    user_ver = conn.execute("PRAGMA user_version;").fetchone()[0]
                    backup_path = create_study_backup(
                        source_conn=conn,
                        from_version=user_ver,
                        to_version=user_ver,
                    )
                logger.info("Baseline backup created: %s", backup_path)
            except Exception as exc:
                logger.warning("Baseline backup could not be created: %s", exc)

        return findings

    def run_pilot(
        self,
        specs: list[dict[str, Any]] | None = None,
        verify_multimodal_safety: bool = True,
        max_questions_per_exercise: int | None = None,
    ) -> PilotExecutionSummary:
        """
        Steps B–F: Execute controlled acquisition, media download, M3 Gate 1 ingestion,
        Gate 2 dual-model verification, automated approval/quarantine, and atomic persistence.
        """
        target_specs = specs or PILOT_EXERCISE_SPECS
        summary = PilotExecutionSummary()
        summary.total_discovered_pages = len(target_specs)

        # Track overall acquisition job in database
        with self.db_manager.write_tx() as conn:
            job = AcquisitionJobService.create_job(
                conn=conn,
                source_name="JapaneseTest4You",
                target_category_url="https://japanesetest4you.com/",
                jlpt_level="MIXED",
                section_category="pilot",
            )
            AcquisitionJobService.add_job_items(
                conn=conn,
                job_id=job.id,
                discovered=[
                    DiscoveredExercise(url=s["url"], title=s["title"], ordinal=idx)
                    for idx, s in enumerate(target_specs, start=1)
                ],
            )

        # Process each exercise spec
        for spec in target_specs:
            url = spec["url"]
            title = spec["title"]
            level_str = spec["level"]
            sec_str = spec["section"]

            logger.info("Processing exercise: %s (%s)", title, url)
            page_detail = self._process_single_exercise(
                url=url,
                title=title,
                level_str=level_str,
                section_str=sec_str,
                job_id=job.id,
                verify_multimodal_safety=verify_multimodal_safety,
                max_questions=max_questions_per_exercise,
            )
            summary.total_acquired_pages += 1
            summary.total_questions_discovered += page_detail["discovered"]
            summary.total_questions_ingested += page_detail["ingested"]
            summary.approved_count += page_detail["approved"]
            summary.quarantined_count += page_detail["quarantined"]
            summary.media_assets_retrieved += page_detail["assets_retrieved"]
            summary.audio_tracks_retrieved += page_detail["audio_retrieved"]
            summary.diagram_images_retrieved += page_detail["diagrams_retrieved"]
            summary.total_audio_duration_ms += page_detail["audio_duration_ms"]

            for r_code, count in page_detail["quarantine_reasons"].items():
                summary.quarantine_reasons[r_code] = summary.quarantine_reasons.get(r_code, 0) + count

            for lvl, count in page_detail["level_counts"].items():
                summary.jlpt_counts[lvl] = summary.jlpt_counts.get(lvl, 0) + count

            for fmt, count in page_detail["format_counts"].items():
                summary.format_counts[fmt] = summary.format_counts.get(fmt, 0) + count

            summary.details.append(page_detail)

        # Finalize job status
        with self.db_manager.write_tx() as conn:
            AcquisitionJobService.update_job_status(
                conn=conn,
                job_id=job.id,
                status=AcquisitionJobStatus.COMPLETED,
            )

        # Evaluate eligibility across all persisted questions
        with self.db_manager.read() as conn:
            q_rows = conn.execute("SELECT id, external_id, status FROM question;").fetchall()
            for q_row in q_rows:
                is_elig, reasons = evaluate_eligibility(
                    q_row["id"], conn=conn, verify_files=True, media_store=self.media_store
                )
                if is_elig:
                    summary.eligible_approved_count += 1
                else:
                    summary.ineligible_quarantined_count += 1

            # Run Doctor verification
            findings = run_doctor(conn, media_store=self.media_store, verify_media_hashes=True)
            summary.doctor_errors = sum(1 for f in findings if f.severity == "ERROR")
            summary.doctor_warnings = sum(1 for f in findings if f.severity == "WARNING")

        return summary

    def _process_single_exercise(
        self,
        url: str,
        title: str,
        level_str: str,
        section_str: str,
        job_id: str,
        verify_multimodal_safety: bool,
        max_questions: int | None = None,
    ) -> dict[str, Any]:
        """Process one exercise page through the acquisition, ingestion, and verification loop."""
        norm_url = normalize_source_url(url)
        detail: dict[str, Any] = {
            "url": norm_url,
            "title": title,
            "discovered": 0,
            "ingested": 0,
            "approved": 0,
            "quarantined": 0,
            "quarantine_reasons": {},
            "level_counts": {},
            "format_counts": {},
            "assets_retrieved": 0,
            "audio_retrieved": 0,
            "diagrams_retrieved": 0,
            "audio_duration_ms": 0,
        }

        # 1. Fetch raw markdown from cache or provider
        raw_fetch = self.cache.get(url)
        if not raw_fetch:
            raw_fetch = self.cache.get(norm_url)

        if not raw_fetch:
            # Not in cache -> fallback to provider
            from app.study.acquisition.providers.registry import get_acquisition_provider
            prov = get_acquisition_provider()
            raw_fetch = prov.fetch_page(url)
            self.cache.put(raw_fetch)

        # 2. Parse exercise markdown
        parsed = self.parser.parse(raw_fetch.raw_markdown, url=url, title=title)
        if max_questions is not None and len(parsed.questions) > max_questions:
            parsed.questions = parsed.questions[:max_questions]

        detail["discovered"] = len(parsed.questions)

        # 3. Retrieve binary media assets into MediaStore
        with self.db_manager.write_tx() as conn:
            # A. Passage diagrams
            for p in parsed.passages:
                for img_url in list(p.image_urls):
                    try:
                        res = self.downloader.download_asset(img_url, conn=conn, kind="diagram")
                        detail["assets_retrieved"] += 1
                        detail["diagrams_retrieved"] += 1
                    except Exception as exc:
                        logger.warning("Could not download passage diagram %s: %s", img_url, exc)

            # B. Question diagrams
            for q in parsed.questions:
                for img_url in list(q.image_urls):
                    try:
                        res = self.downloader.download_asset(img_url, conn=conn, kind="diagram")
                        detail["assets_retrieved"] += 1
                        detail["diagrams_retrieved"] += 1
                    except Exception as exc:
                        logger.warning("Could not download question diagram %s: %s", img_url, exc)

            # C. Audio tracks (preserving complete sections and audio duration)
            for tr in parsed.audio_tracks:
                try:
                    res = self.downloader.download_asset(tr.track_url, conn=conn, kind="audio")
                    tr.asset_id = res.get("asset_id")
                    tr.duration_ms = res.get("duration_ms")
                    tr.status = "retrieved"
                    detail["assets_retrieved"] += 1
                    detail["audio_retrieved"] += 1
                    if tr.duration_ms:
                        detail["audio_duration_ms"] += tr.duration_ms
                except Exception as exc:
                    logger.warning("Could not download audio track %s: %s", tr.track_url, exc)
                    tr.status = "failed"
                    tr.error_reason = str(exc)

            # Update question audio associations
            for q in parsed.questions:
                if q.audio:
                    try:
                        res = self.downloader.download_asset(q.audio.track_url, conn=conn, kind="audio")
                        q.audio.asset_id = res.get("asset_id")
                        q.audio.duration_ms = res.get("duration_ms")
                        q.audio.status = "retrieved"
                        detail["assets_retrieved"] += 1
                        detail["audio_retrieved"] += 1
                        if q.audio.duration_ms:
                            detail["audio_duration_ms"] += q.audio.duration_ms
                    except Exception as exc:
                        logger.warning("Could not download audio track %s: %s", q.audio.track_url, exc)
                        q.audio.status = "failed"
                        q.audio.error_reason = str(exc)

        # 4. M3 Gate 1 Ingestion
        structured_payload = parsed.to_m3_structured_payload()
        level_enum = JlptLevel(level_str.upper()) if level_str else JlptLevel.N4

        ingest_input = IngestInput(
            adapter_kind=IngestAdapterKind.STRUCTURED_JSON,
            content=structured_payload,
            source_name="JapaneseTest4You",
            source_type="web_capture",
            url=norm_url,
            citation=parsed.title,
            license_or_permission="Public educational web exercise",
            default_level=level_enum,
            auto_approve=False,  # Evaluated below via Gate 2
            metadata={"raw_url": url},
        )

        with self.db_manager.write_tx() as conn:
            ingestion_res = self.pipeline.run(
                input_data=ingest_input,
                conn=conn,
                persist=False,  # We will evaluate verification before persisting
            )

        candidates = ingestion_res.questions

        # 5. M3 Gate 2 Dual-Model Verification & Multimodal Safety
        v_records: list[tuple[CandidateQuestion, Any]] = []
        for cand in candidates:
            fmt_code = cand.classification.format_code if cand.classification else "unknown"
            lvl_code = cand.classification.level.value if cand.classification else level_str
            detail["level_counts"][lvl_code] = detail["level_counts"].get(lvl_code, 0) + 1
            detail["format_counts"][fmt_code] = detail["format_counts"].get(fmt_code, 0) + 1

            # A. Structural invalidity check
            is_structurally_invalid = (
                (not cand.payload)
                or (cand.validation and not cand.validation.is_valid)
                or any(
                    r in (
                        ReviewReasonCode.INVALID_CHOICE_COUNT,
                        ReviewReasonCode.INCOMPLETE_CHOICES,
                        ReviewReasonCode.MALFORMED_MARKUP,
                        ReviewReasonCode.MISSING_ANSWER_KEY,
                    )
                    for r in cand.review_reasons
                )
            )
            if is_structurally_invalid:
                cand.review_status = ReviewStatus.NEEDS_REVIEW
                r_code = cand.review_reasons[0].value if cand.review_reasons else "STRUCTURAL_DEFECT"
                detail["quarantine_reasons"][r_code] = detail["quarantine_reasons"].get(r_code, 0) + 1
                detail["quarantined"] += 1
                continue

            # B. Multimodal Safety Check
            has_audio = (
                cand.classification.structural_family == StructuralFamily.F5
                or any(a.get("role") == "audio" or a.get("kind") == "audio" for a in cand.draft.attached_assets)
            )
            has_diagram = any(
                a.get("role") in ("diagram", "illustration") or a.get("kind") in ("diagram", "illustration")
                for a in cand.draft.attached_assets
            )

            if verify_multimodal_safety and (has_audio or has_diagram):
                cand.review_status = ReviewStatus.NEEDS_REVIEW
                reason_code = "UNSUPPORTED_MEDIA_DEPENDENT_QUESTION"
                cand.review_reasons.append(ReviewReasonCode.MANUAL_CORRECTION_REQUIRED)
                cand.review_notes = (
                    f"Quarantined under Multimodal Safety: {'Audio' if has_audio else 'Diagram'} inspection "
                    "requires dedicated multimodal AI evaluation not supported by text solvers."
                )
                detail["quarantine_reasons"][reason_code] = detail["quarantine_reasons"].get(reason_code, 0) + 1
                detail["quarantined"] += 1
                continue

            # C. Dual-Model Verification
            if self.verification_service is not None and self.verification_service.is_enabled:
                try:
                    v_record = self.verification_service.verify_candidate(cand)
                    v_records.append((cand, v_record))

                    if (
                        v_record.comparison
                        and v_record.comparison.scenario == ComparisonScenario.SCENARIO_A_AGREEMENT
                    ):
                        # Both models and source answer claim agree perfectly!
                        cand.review_status = ReviewStatus.APPROVED
                        if cand.payload:
                            cand.payload.status = QuestionStatus.ACTIVE
                        detail["approved"] += 1
                    else:
                        # Model disagreement, ambiguity, source conflict, or failure -> Quarantine
                        cand.review_status = ReviewStatus.NEEDS_REVIEW
                        sc_val = v_record.comparison.scenario.value if v_record.comparison else "AI_DISAGREEMENT"
                        detail["quarantine_reasons"][sc_val] = detail["quarantine_reasons"].get(sc_val, 0) + 1
                        detail["quarantined"] += 1
                except Exception as exc:
                    logger.warning("Verification failed for question %s: %s", cand.candidate_id, exc)
                    cand.review_status = ReviewStatus.NEEDS_REVIEW
                    detail["quarantine_reasons"]["AI_VERIFICATION_EXCEPTION"] = (
                        detail["quarantine_reasons"].get("AI_VERIFICATION_EXCEPTION", 0) + 1
                    )
                    detail["quarantined"] += 1
            else:
                # AI unconfigured or disabled -> Quarantine as unverified
                cand.review_status = ReviewStatus.NEEDS_REVIEW
                cand.review_notes = "Quarantined: Dual-model AI verification is unconfigured or disabled."
                reason_code = "AI_VERIFICATION_UNCONFIGURED"
                detail["quarantine_reasons"][reason_code] = detail["quarantine_reasons"].get(reason_code, 0) + 1
                detail["quarantined"] += 1

        # 6. Step F: Atomic Persistence & Relational Tracking
        from app.study.ingestion.adapters.structured_json import StructuredJsonInputAdapter
        doc = StructuredJsonInputAdapter().extract(ingest_input)
        with self.db_manager.write_tx() as conn:
            source_id, batch_id = self.pipeline._persistence.persist_batch(
                conn=conn,
                doc=doc,
                questions=candidates,
                groups=ingestion_res.groups,
                persist_quarantined=True,  # Preserve all quarantined items with review reason
            )

            # Persist verification runs with newly assigned question & revision IDs
            if self.verification_service is not None and self.verification_service.is_enabled:
                for cand_item, v_rec in v_records:
                    if cand_item.persisted_question_id and cand_item.persisted_revision_id:
                        v_rec.question_id = cand_item.persisted_question_id
                        v_rec.question_revision_id = cand_item.persisted_revision_id
                        self.verification_service.persistence.save_verification_run(conn, v_rec)

            # Record item progress
            item_row = conn.execute(
                "SELECT id FROM acquisition_job_item WHERE job_id = ? AND exercise_url = ?;",
                (job_id, url),
            ).fetchone()
            if item_row:
                AcquisitionJobService.record_item_success(
                    conn=conn,
                    item_id=item_row["id"],
                    status=AcquisitionItemStatus.INGESTED,
                    cache_path=raw_fetch.metadata.get("cache_path") if raw_fetch else None,
                )

        detail["ingested"] = len(candidates)
        return detail

    def verify_idempotency(self, specs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """
        Step G: Run the exact same acquisition and ingestion a second time.
        Verify 0 duplicate questions, revisions, sources, or assets.
        """
        target_specs = specs or PILOT_EXERCISE_SPECS

        with self.db_manager.read() as conn:
            counts_before = {
                "question": conn.execute("SELECT COUNT(*) FROM question;").fetchone()[0],
                "question_revision": conn.execute("SELECT COUNT(*) FROM question_revision;").fetchone()[0],
                "source": conn.execute("SELECT COUNT(*) FROM source;").fetchone()[0],
                "question_source": conn.execute("SELECT COUNT(*) FROM question_source;").fetchone()[0],
                "asset": conn.execute("SELECT COUNT(*) FROM asset;").fetchone()[0],
                "source_answer_claim": conn.execute("SELECT COUNT(*) FROM source_answer_claim;").fetchone()[0],
                "revision_choice": conn.execute("SELECT COUNT(*) FROM revision_choice;").fetchone()[0],
            }

        logger.info("Executing second idempotency re-run on %d specs...", len(target_specs))
        re_run_summary = self.run_pilot(specs=target_specs)

        with self.db_manager.read() as conn:
            counts_after = {
                "question": conn.execute("SELECT COUNT(*) FROM question;").fetchone()[0],
                "question_revision": conn.execute("SELECT COUNT(*) FROM question_revision;").fetchone()[0],
                "source": conn.execute("SELECT COUNT(*) FROM source;").fetchone()[0],
                "question_source": conn.execute("SELECT COUNT(*) FROM question_source;").fetchone()[0],
                "asset": conn.execute("SELECT COUNT(*) FROM asset;").fetchone()[0],
                "source_answer_claim": conn.execute("SELECT COUNT(*) FROM source_answer_claim;").fetchone()[0],
                "revision_choice": conn.execute("SELECT COUNT(*) FROM revision_choice;").fetchone()[0],
            }

        diffs = {table: counts_after[table] - counts_before[table] for table in counts_before}
        is_idempotent = all(diff == 0 for diff in diffs.values())

        return {
            "is_idempotent": is_idempotent,
            "counts_before": counts_before,
            "counts_after": counts_after,
            "diffs": diffs,
            "re_run_summary": re_run_summary,
        }


def main():
    """CLI entrypoint to run the M5-B real question bank population and verification."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    logger.info("Starting M5-B Question Bank Population & Verification...")

    pipeline = M5BPilotPipeline()
    logger.info("Step A: Initializing database and verifying migrations...")
    findings = pipeline.initialize_database(run_backup=True)
    logger.info("Doctor findings upon initialization: %d findings", len(findings))

    logger.info("Step B-F: Executing Pilot Ingestion across %d exercises...", len(PILOT_EXERCISE_SPECS))
    summary = pipeline.run_pilot()

    logger.info("Pilot Ingestion Complete!")
    logger.info("Discovered: %d, Ingested: %d, Approved: %d, Quarantined: %d",
                summary.total_questions_discovered, summary.total_questions_ingested,
                summary.approved_count, summary.quarantined_count)
    logger.info("Quarantine reasons: %s", summary.quarantine_reasons)
    logger.info("Media assets: %d, Audio: %d (%d ms), Diagrams: %d",
                summary.media_assets_retrieved, summary.audio_tracks_retrieved,
                summary.total_audio_duration_ms, summary.diagram_images_retrieved)
    logger.info("Eligible approved: %d, Ineligible quarantined: %d",
                summary.eligible_approved_count, summary.ineligible_quarantined_count)
    logger.info("Doctor: %d errors, %d warnings", summary.doctor_errors, summary.doctor_warnings)

    logger.info("Step G: Running idempotency verification...")
    idem = pipeline.verify_idempotency()
    logger.info("Idempotency result: %s", idem["is_idempotent"])
    logger.info("Counts before: %s", idem["counts_before"])
    logger.info("Counts after: %s", idem["counts_after"])
    logger.info("Diffs: %s", idem["diffs"])

    print("\n" + "=" * 60)
    print("M5-B EXECUTION SUMMARY")
    print("=" * 60)
    print(f"Total Discovered Questions: {summary.total_questions_discovered}")
    print(f"Total Ingested Questions:  {summary.total_questions_ingested}")
    print(f"Approved (Active):         {summary.approved_count}")
    print(f"Quarantined (Draft):       {summary.quarantined_count}")
    print(f"Quarantine Breakdown:      {summary.quarantine_reasons}")
    print(f"JLPT Counts:               {summary.jlpt_counts}")
    print(f"Format Counts:             {summary.format_counts}")
    print(f"Media Assets Downloaded:   {summary.media_assets_retrieved}")
    print(f"Audio Tracks Retrieved:    {summary.audio_tracks_retrieved} ({summary.total_audio_duration_ms} ms)")
    print(f"Diagrams Retrieved:        {summary.diagram_images_retrieved}")
    print(f"Doctor Status:             {summary.doctor_errors} errors, {summary.doctor_warnings} warnings")
    print(f"Eligible Approved:         {summary.eligible_approved_count}")
    print(f"Ineligible Quarantined:    {summary.ineligible_quarantined_count}")
    print(f"Idempotency Preserved:     {idem['is_idempotent']}")
    print(f"Table Diffs:               {idem['diffs']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
