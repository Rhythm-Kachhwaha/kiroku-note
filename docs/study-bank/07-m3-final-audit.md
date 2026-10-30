# Kiroku Note — JLPT Question Bank: Milestone 3 Final Audit & Git Checkpoint

**Document ID:** `docs/study-bank/07-m3-final-audit.md`  
**Milestone:** Milestone 3 (Gate 1 Deterministic Ingestion & Gate 2 Independent AI Verification)  
**Date:** 2026-10-30  
**Status:** Audit Completed & Verified (42 Targeted Tests Passed, 183 Study Tests Passed, 923 Full Backend Tests Passed)  

---

## 1. Executive Summary

A comprehensive correctness, data-integrity, and compatibility audit of Milestone 3 Gate 2 was conducted across the local-first JLPT Question Bank (`study.db`).

The audit verified:
1. **Human correction and revision branching integrity** (preserving sealed revisions, choices, listening audio/images, external source claims, F2 star derivations, and human explanations).
2. **Model disagreement and explanation safety** (guaranteeing that uncertain model outputs or conflicting sources never generate unverified canonical explanations).
3. **Environment configuration and `.env` loading** (implementing stdlib-only root `.env` loading, zero leakage of API secrets, and graceful offline fallback).
4. **Database migration 0003 integrity** (verifying STRICT tables, composite foreign keys, engine-level immutability triggers, and doctor health check).
5. **Gate 1 deterministic compatibility** (verifying that ingestion remains 100% offline, deterministic, and free from AI leaks).

---

## 2. Audit Findings & Remediations

### 2.1 Audit A — Human Correction & Revision Integrity
- **Finding A1 (Asset Relationship Preservation):** When `VerificationReviewService.apply_decision()` executed an answer correction (`HumanDecisionType.CORRECT`), it branched into revision $N+1$, but previously omitted copying rows from `question_revision_asset`. This caused listening audio references (F5) and question diagrams/illustrations to be lost on revision $N+1$.
  - **Fix:** Added deterministic copying of all `question_revision_asset` rows from revision $N$ to revision $N+1$ before sealing the new revision.
- **Finding A2 (Source Answer Claim Preservation):** External source answer claims (`source_answer_claim`) from revision $N$ were not carried forward to revision $N+1$.
  - **Fix:** Copied all source claims to revision $N+1$, mapping choice IDs to the new revision's choices, and automatically marking `is_conflict = 1` if a source claimed an answer contradicting the human-corrected answer.
- **Finding A3 (F2 Sentence Composition Payload Consistency):** For Family F2 questions, correcting the star answer without clearing an obsolete 4-fragment permutation in `payload_json` caused `recompose_question_from_db` to raise a `ValueError` (contradiction between star choice and derived permutation).
  - **Fix:** In `apply_decision()`, for `sentence_composition`, updated `derived_star_choice_key` to the target choice and cleared contradictory `fragment_order` to `None` so that `F2QuestionPayload` validation succeeds without assuming the unverified full permutation.
- **Finding A4 (Human Explanation Ledger):** Recorded a human explanation in `question_explanation` for revision $N+1$ with `generated_by_slot = 'human'` and `is_human_approved = 1`.

### 2.2 Audit B — Model Disagreement & Explanation Safety
- **Finding B1 (Unsafe Target Selection on Model Disagreement):** In `VerificationService.verify_solve_request()`, when models disagreed (Scenario C or Scenario E) or when sources conflicted (Scenario F), target choice selection fell back to `comparison.source_choices[0]` or `model_a_resp.selected_choice_key`, generating a canonical explanation for an unconfirmed answer and blending conflicting reasoning.
  - **Fix:** Restricted explanation synthesis strictly to cases where both models agree on the target choice (Scenarios A, B, and concordant D). When models disagree, when multiple external source claims conflict, or when questions are flagged ambiguous/defective, canonical explanation synthesis is disabled (`explanation_record = None`).
  - **Audit Confirmation:** Both Model A and Model B answers, confidences, reasonings, and choice analyses remain individually preserved in `verification_model_response` (Stage 1). The question is flagged with status `MODEL_DISAGREEMENT`, `SOURCE_CLAIM_CONFLICT`, or `QUESTION_AMBIGUOUS` for priority human review.

### 2.3 Audit C — Environment Configuration & `.env` Loading
- **Finding C1 (Missing Automatic `.env` Loading):** The application did not automatically load variables from the root `.env` file upon startup.
  - **Fix:** Implemented standard-library-only `load_dotenv()` in `app.config` (invoked on module import and in `load_verification_config_from_env()`). Resolves `.env` deterministically anchored to the repository root via `Path(__file__)`, safely handles quotes/comments, and preserves existing environment variables without third-party dependencies.
  - **Audit Confirmation:** API keys remain strictly excluded from `ModelSlotConfig.__repr__`, string formatting, and `study.db`. Missing configuration disables AI verification gracefully with status `NOT_VERIFIED`. Gate 1 functions 100% offline without keys.

### 2.4 Audit D — Migration & Database Integrity
- **Audit Findings:**
  - `0003_ai_verification.sql` strictly enforces SQLite 3.37+ `STRICT` table definitions.
  - Composite foreign keys guarantee that model responses, explanations, and human decisions cannot cross question or revision boundaries.
  - Immutability triggers (`trg_verification_run_no_delete`, `trg_verification_model_response_no_update`, `trg_verification_model_response_no_delete`, `trg_verification_human_decision_no_update`, `trg_verification_human_decision_no_delete`, `trg_question_explanation_no_delete`) prevent tampering.
  - Verification runs for revision $N$ cannot be presented as runs for revision $N+1$.
  - Read-only database doctor (`run_doctor`) passes with 0 ERROR findings.

### 2.5 Audit E — Gate 1 Compatibility
- **Audit Findings:**
  - Ingestion pipeline (`app.study.ingestion.pipeline`) contains zero AI/LLM imports or dependencies.
  - All 5 input adapters (pasted text, structured JSON, digital PDF, scanned image, audio) operate completely offline.
  - Question candidate classification, normalization, and persistence run identically with AI disabled or enabled.
  - All 27 Gate 1 unit and integration tests pass without regressions.

---

## 3. Test Ledger & Verification Results

| Test Category | Previous Baseline | Audited & Verified | Status |
|---|---|---|---|
| **AI Verification Targeted Tests** (`test_study_verification_*.py`) | 35 passed | **42 passed** | PASS |
| **Study Bank Full Suite** (`test_study_*.py`) | 176 passed | **183 passed** | PASS |
| **Backend Full Test Suite** (`backend/tests/`) | 916 passed, 256 subtests | **923 passed, 256 subtests** | PASS |

---

## 4. Git Checkpoint Staging Plan

All changes are strictly bounded to the Study Bank subsystem, local configuration loading, regression tests, and documentation. No core vocabulary, extension, or Electron files are touched.

### Changed Files for Staging:
- `AGENTS.md` (subsystem documentation updates)
- `backend/app/config.py` (stdlib `load_dotenv` helper)
- `backend/app/study/doctor.py` (trigger and format updates)
- `backend/app/study/ingestion/normalization/normalizer.py`
- `backend/app/study/ingestion/validation/validator.py`
- `backend/app/study/migrations/0003_ai_verification.sql`
- `backend/app/study/verification/` (all Gate 2 modules)
- `backend/tests/test_study_db_infrastructure.py`
- `backend/tests/test_study_verification_*.py` (all Gate 2 test files)
- `.env.example`
- `docs/study-bank/02-decision-log.md`
- `docs/study-bank/06-m3-ai-verification.md`
- `docs/study-bank/07-m3-final-audit.md`

### Temporary Files to Exclude / Clean Up:
- Scratch patch script in `.gemini/antigravity/brain/...` (not in git repository).

---

## 5. Final Status & Conclusion

Milestone 3 Gate 2 has passed the focused data-integrity, compatibility, and security audit. All discovered issues have been resolved, verified with regression tests, and integrated cleanly with Gate 1.

**Subsystem status:** Safe, stable, and ready for Git checkpoint commit.
