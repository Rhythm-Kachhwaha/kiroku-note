# Kiroku Note — JLPT Question Bank: Architecture Decision Log (ADR)

**Document ID:** `docs/study-bank/02-decision-log.md`  
**Milestone:** Milestone 0 (Audit & Design)  
**Date:** 2026-10-30  
**Status:** Approved Baseline  

---

## Index of Architectural Decisions

- [ADR-SB-001: Separate SQLite Database (`study.db`) in Local User Data Directory](#adr-sb-001-separate-sqlite-database-studydb-in-local-user-data-directory)
- [ADR-SB-002: Ordered Forward-Only Migrations with `PRAGMA user_version` & Pre-Migration Backup](#adr-sb-002-ordered-forward-only-migrations-with-pragma-user_version--pre-migration-backup)
- [ADR-SB-003: Separation of Mutable Entities from Immutable Revision Snapshots](#adr-sb-003-separation-of-mutable-entities-from-immutable-revision-snapshots)
- [ADR-SB-004: Engine-Level Immutability Enforcement via SQLite Triggers](#adr-sb-004-engine-level-immutability-enforcement-via-sqlite-triggers)
- [ADR-SB-005: Relational Choices with Stable IDs; Answers Reference Choice IDs](#adr-sb-005-relational-choices-with-stable-ids-answers-reference-choice-ids)
- [ADR-SB-006: Sentence Ordering: Full Permutation Storage and Star Derivation](#adr-sb-006-sentence-ordering-full-permutation-storage-and-star-derivation)
- [ADR-SB-007: Text Grammar Anchor Pinning and Relational Integrity](#adr-sb-007-text-grammar-anchor-pinning-and-relational-integrity)
- [ADR-SB-008: SHA-256 Content-Addressed Media Storage Outside SQLite](#adr-sb-008-sha-256-content-addressed-media-storage-outside-sqlite)
- [ADR-SB-009: Strict Provenance: Three Distinct Identities](#adr-sb-009-strict-provenance-three-distinct-identities)
- [ADR-SB-010: Conflict Preservation and Near-Duplicate Candidates (No Auto-Merging)](#adr-sb-010-conflict-preservation-and-near-duplicate-candidates-no-auto-merging)
- [ADR-SB-011: Multi-Factor Derived Eligibility with Explicit Reason Codes](#adr-sb-011-multi-factor-derived-eligibility-with-explicit-reason-codes)
- [ADR-SB-012: Code-Based Format Registry & Discriminated Union Family Contracts](#adr-sb-012-code-based-format-registry--discriminated-union-family-contracts)
- [ADR-SB-013: Separation of Timed Exam Blocks from Scoring Sections](#adr-sb-013-separation-of-timed-exam-blocks-from-scoring-sections)
- [ADR-SB-014: Distinct Behavioral Contracts for Drill Mode vs Mock Exam Mode](#adr-sb-014-distinct-behavioral-contracts-for-drill-mode-vs-mock-exam-mode)
- [ADR-SB-015: Wall-Clock Pacing & Pause Tracking (Diagnostics Separated from Active Time)](#adr-sb-015-wall-clock-pacing--pause-tracking-diagnostics-separated-from-active-time)
- [ADR-SB-016: Absolute Cloud Queue & PostgreSQL Exclusion (Local-First Boundary)](#adr-sb-016-absolute-cloud-queue--postgresql-exclusion-local-first-boundary)
- [ADR-SB-017: Internal Integer Primary Keys with External Standard-Library ULIDs](#adr-sb-017-internal-integer-primary-keys-with-external-standard-library-ulids)
- [ADR-SB-018: Engine-Level STRICT Tables with Composite FKs and Sealed-At Trigger Immutability](#adr-sb-018-engine-level-strict-tables-with-composite-fks-and-sealed-at-trigger-immutability)
- [ADR-SB-019: Pre-Migration Verified Backups with Five-Backup Retention Policy](#adr-sb-019-pre-migration-verified-backups-with-five-backup-retention-policy)
- [ADR-SB-020: Read-Only Database Doctor for Diagnostic Health Audits](#adr-sb-020-read-only-database-doctor-for-diagnostic-health-audits)

---

### ADR-SB-001: Separate SQLite Database (`study.db`) in Local User Data Directory

**Context**:  
Kiroku Note currently stores vocabulary mining cards in `kiroku.db`. The question bank and examination system has distinct lifecycle, scale, relational complexity, and backup requirements. Introducing questions into `kiroku.db` would entangle vocabulary mining with examination attempts and risk regression during schema migrations.

**Decision**:  
Store all JLPT question bank, custom test, attempt, and provenance data in a separate SQLite database named `study.db`. This database will reside in Kiroku Note's standard user data directory (`%LOCALAPPDATA%\KirokuNote\data\study.db` in packaged Windows mode, or `<repo_root>/backend/data/study.db` in development mode).

**Consequences**:  
- Complete isolation from vocabulary mining tables and Anki sync flows.
- Independent migration cycles and zero risk of corrupting user vocabulary cards.
- Clean backup and restore routines specific to practice and test history.

---

### ADR-SB-002: Ordered Forward-Only Migrations with `PRAGMA user_version` & Pre-Migration Backup

**Context**:  
The existing Kiroku Note codebase manages `kiroku.db` schema imperatively inside `init_db()` using `CREATE TABLE IF NOT EXISTS` and ad-hoc column inspections. For `study.db`, which has 20+ interrelated relational tables, triggers, and views, schema evolution requires deterministic, transactional migrations.

**Decision**:  
Implement an ordered forward-only SQL migration runner using `PRAGMA user_version` (e.g. `001_initial_schema.sql`, `002_...`). Before applying any migration to an existing non-empty database, the migration engine automatically creates a timestamped database backup (`study.db.vX.backup_<timestamp>`).

**Consequences**:  
- Deterministic upgrade path and rollback/recovery safety.
- Clear audit trail of schema changes.
- Safe automated upgrades during application startup.

---

### ADR-SB-003: Separation of Mutable Entities from Immutable Revision Snapshots

**Context**:  
If a question or shared passage is edited to fix a typo or clarify an explanation, historical test attempts taken months prior must continue to render the exact text, choices, and anchors that the user originally answered. Updating questions in place destroys historical integrity.

**Decision**:  
Separate conceptual identity from content snapshots:
- Stable entities: `question` and `content_group` hold stable IDs, tags, categorization, and `current_revision_id`.
- Immutable revisions: `question_revision` and `group_revision` contain content fingerprints, prompt stems, parts, choices, and anchors.
- Historical attempts (`attempt_response`) pin both `(question_id, question_revision_id)` and `(content_group_id, pinned_group_revision_id)`.

**Consequences**:  
- Absolute historical reproducibility.
- Edits create a new revision number rather than mutating existing rows.
- Attempt replay displays verbatim what was tested at that moment in time.

---

### ADR-SB-004: Engine-Level Immutability Enforcement via SQLite Triggers

**Context**:  
Application-layer immutability checks can be accidentally bypassed by ad-hoc queries, faulty bulk scripts, or developer oversights.

**Decision**:  
Install `BEFORE UPDATE` and `BEFORE DELETE` triggers in SQLite on `question_revision`, `revision_choice`, `group_revision`, and `group_part`. These triggers invoke `SELECT RAISE(ABORT, '... is immutable')` to reject any modification attempt at the database engine level.

**Consequences**:  
- Guaranteed immutability regardless of the caller (Python service, raw SQL, or future CLI tools).
- Forced adherence to revision creation patterns.

---

### ADR-SB-005: Relational Choices with Stable IDs; Answers Reference Choice IDs

**Context**:  
Storing choices as a JSON array or indexing correct answers by 0-based array position (e.g. `correct_index = 2`) is fragile: sorting choices, reordering distractors, or rendering choices in randomized permutations causes subtle grading bugs.

**Decision**:  
Choices are stored as individual rows in `revision_choice` with stable UUIDs, display labels (`1`, `2`, `3`, `4`), ordinals, and explicit `is_correct` flags. Correct answers and user responses reference the stable `choice_id`.

**Consequences**:  
- Immunity to permutation errors during practice drills or tests.
- Clear relational tracking of which distractor was selected in analytics.

---

### ADR-SB-006: Sentence Ordering: Full Permutation Storage and Star Derivation

**Context**:  
JLPT Sentence Grammar 2 (文の組み立て) presents 4 sentence fragments and asks which fragment belongs at the star position (`★`). Conventional databases often store only the star answer, discarding the actual grammatical sentence. This prevents full-sentence explanation, strict grading, and linguistic validation.

**Decision**:  
In Family F2, each of the 4 choices stores its `fragment_order_position` (1, 2, 3, or 4) in the reconstructed grammatically correct sentence. The star position is identified in the prompt markup (`{star}`). The backend automatically validates that fragments form a valid permutation of `{1, 2, 3, 4}` and derives the official star answer (`source_derived`). If an imported source specifies an answer that contradicts the derived star fragment, a conflict is raised.

**Consequences**:  
- Supports both standard official star grading and optional strict full-order reconstruction grading.
- Guaranteed mathematical and grammatical consistency.

---

### ADR-SB-007: Text Grammar Anchor Pinning and Relational Integrity

**Context**:  
Passage-based text grammar (文章の文法) features multiple questions tied to specific blank numbers within a long passage. Storing blanks as loose string replacements leads to orphaned blanks or misaligned questions.

**Decision**:  
Group revisions define versioned `group_revision_anchor` rows with stable keys (e.g. `blank_35`). Questions in Family F4 must explicitly specify an `anchor_key`. Database and service-layer validation enforce that:
1. Every F4 question references an existing anchor in the linked group revision.
2. Every declared anchor in a group revision is covered by exactly one question.
3. No cross-group anchor references are permitted.

**Consequences**:  
- Eliminates orphaned questions or unfillable passage blanks.
- Ensures seamless rendering of interactive inline dropdowns or inputs.

---

### ADR-SB-008: SHA-256 Content-Addressed Media Storage Outside SQLite

**Context**:  
Storing large audio files and high-resolution images as BLOBs inside SQLite bloats the database file, degrades cache performance, and complicates backups.

**Decision**:  
All binary media is stored in a dedicated `study_media/` directory on disk, named by its SHA-256 hash (`sha256_<hash>.<ext>`). The database stores metadata (`asset` table) including relative path, MIME type, file size, duration, and dimensions. Asset relationships to questions and passages are maintained through relational join tables (`question_revision_asset`, `group_revision_asset`).

**Consequences**:  
- Automatic deduplication of identical audio/images across questions.
- High-performance streaming of audio via standard file handling.
- Fast database backups without binary bloat.

---

### ADR-SB-009: Strict Provenance: Three Distinct Identities

**Context**:  
Conflating an imported file's item ID with the question's content or canonical identity causes accidental data overwrites when the same question appears across multiple practice books or websites.

**Decision**:  
Maintain three strictly decoupled identities:
1. **Import Identity**: `import_item` (the raw record in an import batch).
2. **Normalized Content Fingerprint**: SHA-256 hash of normalized prompt stem + normalized choices/parts.
3. **Canonical Question Identity**: The permanent `question.id` UUID.

**Consequences**:  
- Multiple distinct sources can cite or contribute to a single canonical question.
- Content modifications produce new fingerprints without altering canonical question IDs.

---

### ADR-SB-010: Conflict Preservation and Near-Duplicate Candidates (No Auto-Merging)

**Context**:  
Different answer keys or textbook publishers occasionally disagree on the correct answer for ambiguous questions. Automated resolution or last-write-wins overwriting destroys auditability.

**Decision**:  
External answer claims are stored in `source_answer_claim`. If a new source claims a different answer than an existing revision, the conflict is flagged (`is_conflicted = 1`) and the question moves to `NEEDS_REVIEW`. Near-duplicate detection algorithms flag `duplicate_candidate` records for human review; automatic merging is prohibited.

**Consequences**:  
- Zero silent data loss or corrupted answer keys.
- Complete transparency for teachers and learners.

---

### ADR-SB-011: Multi-Factor Derived Eligibility with Explicit Reason Codes

**Context**:  
Storing a static `is_gradeable` or `is_eligible` boolean in the database invites state desynchronization (e.g. an asset is deleted from disk, but the question remains marked gradeable).

**Decision**:  
Question eligibility is computed dynamically:
- Fast candidate pre-filtering via SQL view `v_eligible_question_revisions`.
- Strict evaluation in Python returning an explicit list of stable reason codes (`NO_ANSWER`, `VALIDATION_FAILED`, `NEEDS_REVIEW`, `GRADER_UNIMPLEMENTED`, `REQUIRED_ASSET_MISSING`, `RETIRED`, `GROUP_INCONSISTENT`).
- A question is eligible for custom tests only if the reason code list is empty.

**Consequences**:  
- Self-healing: restoring a missing media file immediately restores question eligibility without touching database flags.
- Actionable diagnostics for question bank maintenance.

---

### ADR-SB-012: Code-Based Format Registry & Discriminated Union Family Contracts

**Context**:  
Hardcoding question formats across dozens of if-else statements or maintaining 25+ distinct database schemas for every JLPT sub-section creates unmaintainable, brittle code.

**Decision**:  
A central, code-based `FormatRegistry` defines metadata, option counts, allowed JLPT levels, default graders, and maps all official JLPT formats to the six core structural families (F1–F6). Pydantic discriminated unions (`Field(..., discriminator="structural_family")`) enforce family contracts during serialization and API transport.

**Consequences**:  
- Adding or adjusting format metadata does not require database schema migrations.
- Strongly-typed validation across the entire backend.

---

### ADR-SB-013: Separation of Timed Exam Blocks from Scoring Sections

**Context**:  
In official JLPT administration (e.g. N1 and N2), Language Knowledge (Vocabulary/Grammar) and Reading are administered together in a single 110-minute (or 105-minute) timed block, but are scored and reported as distinct categories.

**Decision**:  
Explicitly decouple timed execution blocks (`exam_section`) from scoring categories. Timers and section transitions operate on timed blocks; analytics and score reporting aggregate by category.

**Consequences**:  
- Matches authentic JLPT test timing rules exactly.
- Pacing diagnostics can track whether a user spent too much time on vocabulary at the expense of reading passages.

---

### ADR-SB-014: Distinct Behavioral Contracts for Drill Mode vs Mock Exam Mode

**Context**:  
Casual practice drills and realistic mock exams have fundamentally conflicting operational requirements (e.g. audio replay, instant explanations, time limits).

**Decision**:  
Formalize two distinct session execution modes:
- **Drill Mode**: Untimed or soft-timed; instant feedback available; audio repeatable and scrubbable; explanations accessible; review and retries enabled.
- **Mock Exam Mode**: Strict official block timers; sections auto-lock upon expiration; listening audio plays once strictly without seek/replay; no review of previous sections; score revealed only after full submission.

**Consequences**:  
- Clean separation of concerns in service logic.
- Authentic simulation of test-day psychological and time pressures.

---

### ADR-SB-015: Wall-Clock Pacing & Pause Tracking (Diagnostics Separated from Active Time)

**Context**:  
Browser/desktop focus-loss events (window blur) are noisy and unreliable for computing active test duration (e.g. user checking audio settings or multi-monitor setups).

**Decision**:  
Active question and section duration is computed exclusively using monotonic wall-clock elapsed time minus explicit user-initiated pause durations. Window focus-loss events are captured purely as optional diagnostics and are never subtracted from active study time.

**Consequences**:  
- Deterministic, tamper-resistant time measurements.
- Accurate pacing statistics (e.g. average seconds per reading question).

---

### ADR-SB-016: Absolute Cloud Queue & PostgreSQL Exclusion (Local-First Boundary)

**Context**:  
Kiroku Note has a separate cloud queue subsystem (`kiroku_cloud_queue/`) running PostgreSQL on Render/Neon for mobile vocabulary card capture.

**Decision**:  
The JLPT Question Bank, question revisions, content groups, and examination attempts are strictly personal local data. Under no circumstances may `study.db` tables or sync endpoints be introduced into `kiroku_cloud_queue`, Render, or Neon.

**Consequences**:  
- Preserves local-first privacy and offline operability.
- Avoids bandwidth bloat and complex cloud multi-tenant synchronization.


---

### ADR-SB-017: Internal Integer Primary Keys with External Standard-Library ULIDs

**Context**:  
Milestone 0 proposed TEXT UUIDs for all primary keys. In high-frequency joins, B-Tree lookups, and foreign key validations across 28+ tables, 36-character text primary keys significantly bloat SQLite indexes, degrade cache locality, and slow down composite join evaluations. Furthermore, external UUIDs lack chronological sortability.

**Decision**:  
Use native 64-bit `INTEGER PRIMARY KEY AUTOINCREMENT` for all internal relational references and composite foreign keys. Expose external identifiers generated via a standard-library-only Crockford Base32 ULID generator (`app.study.ulid.generate_ulid()`) for top-level entities (`question.external_id`, `content_group.external_id`, and `test_attempt.external_id`).

**Consequences**:  
- Maximum SQLite performance and compact B-Tree indexing.
- Chronologically sortable, URL-safe 26-character external identifiers for UI and API use.
- Zero external package dependencies.

---

### ADR-SB-018: Engine-Level STRICT Tables with Composite FKs and Sealed-At Trigger Immutability

**Context**:  
Milestone 0 relied on standard SQLite type affinity and loose single-column foreign keys, allowing potential runtime type mismatches and cross-question/group revision association errors. In addition, immutable revisions were vulnerable to silent modification if child records were added after a revision was sealed.

**Decision**:  
1. All 28 study tables use SQLite 3.37+ `STRICT` mode, enforcing engine-level column types (`INTEGER`, `TEXT`, `REAL`).
2. Enforce composite foreign keys ensuring relational alignment:
   - `question(content_group_id, level) -> content_group(id, level)`
   - `question_revision(question_id, format_code) -> question(id, format_code)`
   - `revision_answer(choice_id, question_revision_id) -> revision_choice(id, question_revision_id)`
   - `attempt_item(pinned_question_revision_id, question_id) -> question_revision(id, question_id)`
3. Revisions permit exactly one mutation: the one-way `sealed_at: NULL -> timestamp` transition.
4. Triggers on revision child tables prevent inserting any child records once the parent revision is sealed.

**Consequences**:  
- Complete prevention of cross-question or cross-group data corruption at the database engine level.
- True append-only revision integrity.

---

### ADR-SB-019: Pre-Migration Verified Backups with Five-Backup Retention Policy

**Context**:  
Schema migrations on production user databases risk irreversible data loss if power is interrupted or a statement fails mid-flight. Standard file copying of live SQLite databases under WAL mode can produce torn or corrupted database copies.

**Decision**:  
Implement an atomic, WAL-safe backup routine using SQLite's online backup API (`conn.backup()`). Before applying any forward migration to an existing database (`user_version > 0`), the runner generates a temporary backup in `backups/`, verifies it with `PRAGMA integrity_check`, atomically renames it to `study-vFROM-to-vTO-<UTC timestamp>.db`, and retains the 5 most recent verified backups while strictly prohibiting the deletion of the only verified backup. Restoration requires closing all connections, moving aside live files (`.db`, `-wal`, `-shm`), copying the backup, and verifying integrity.

**Consequences**:  
- Zero risk of schema upgrade data loss.
- Deterministic, tamper-resistant backup artifacts.

---

### ADR-SB-020: Read-Only Database Doctor for Diagnostic Health Audits

**Context**:  
Database inconsistencies (orphaned assets, missing disk files, hash mismatches, tampered migration checksums, or missing triggers) can cause subtle test failures or corrupt study sessions. Automated repair scripts often perform destructive fixes or mask deeper underlying issues.

**Decision**:  
Implement a strictly read-only diagnostic service (`app.study.doctor.run_doctor()`) that performs 10 independent audits covering low-level SQLite integrity, foreign keys, migration checksums, trigger completeness, format registry consistency, media file existence and hashes, orphan asset detection, question/group/anchor relationships, and source answer conflicts. The doctor reports structured findings with severity levels (`ERROR`, `WARNING`, `INFO`) and NEVER mutates data.

**Consequences**:  
- Safe, comprehensive diagnostic introspection for users and support without risking data alteration.
- Early warning system for data anomalies.
