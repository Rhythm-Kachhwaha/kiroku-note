# Kiroku Note — JLPT Question Bank: Milestone 1 Schema & Architecture Review

**Document ID:** `docs/study-bank/03-m1-schema-review.md`  
**Milestone:** Milestone 1 (Database Foundation)  
**Date:** 2026-10-30  
**Status:** Completed & Verified  

---

## 1. Executive Overview

This document reconciles the final implemented **Milestone 1 Database Foundation** against the preliminary Milestone 0 design proposal (`docs/study-bank/01-schema-and-contracts.md` and `docs/study-bank/02-decision-log.md`).

All binding corrections mandated for Milestone 1 were systematically evaluated, implemented, and verified. This review evaluates each architectural area, documents exact deviations from Milestone 0, and justifies the engineering rationale for every change.

---

## 2. Binding Architecture Evaluation & Deviations Matrix

| Design Area | Milestone 0 Preliminary Proposal | Milestone 1 Implemented Architecture | Status & Deviation Rationale |
|---|---|---|---|
| **Primary Keys & External IDs** | `TEXT PRIMARY KEY` (UUIDs across all tables) | Internal `INTEGER PRIMARY KEY AUTOINCREMENT` + external Crockford Base32 ULIDs on top-level entities (`question`, `content_group`, `test_attempt`) | **Corrected**. M0 text primary keys would bloat composite foreign keys and B-Tree indexes. Integer PKs maximize SQLite performance while external ULIDs (`app.study.ulid`) provide 26-char sortable IDs with zero external dependencies. |
| **Database Directory & Paths** | `get_data_dir() / "study.db"` and `study_media/` | `get_study_dir()` resolving to `get_app_data_dir() / "study"`, containing `study.db`, `media/`, and `backups/`; overridable via `KIROKU_STUDY_DIR` | **Corrected**. Consolidates all question bank data (database, content-addressed media, and verified backups) inside a dedicated, isolated directory, keeping user data clean and easily backupable. |
| **Connection & Transactions** | Standard Python sqlite3 with shared connection | `StudyDatabaseManager` with `isolation_level=None`, `row_factory=sqlite3.Row`, `PRAGMA foreign_keys=ON`, `PRAGMA journal_mode=WAL` (verifies engine returned 'wal'), busy timeout 10000, recursive triggers ON, `read()` and `write_tx()` (`BEGIN IMMEDIATE`) | **Hardened**. Completely prevents deferred read-then-write upgrade deadlocks. Prohibits `INSERT OR REPLACE` to prevent silent deletion trigger bypasses. |
| **Migrations & Checksums** | Imperative script execution with `PRAGMA user_version` | Ordered SQL files (`0001_initial.sql`, `0002_seed_formats_and_exams.sql`), `schema_migration` ledger with SHA-256 checksums, atomic statement execution via `sqlite3.complete_statement` (never `executescript`), checksum verification at startup, and rejection of future user_versions | **Hardened**. `executescript()` issues implicit commits which destroy atomic rollback on failure. Statement splitting via `sqlite3.complete_statement` ensures true transactional atomicity per migration. |
| **Pre-Migration Backups** | Timestamped copy on disk | Automated pre-migration backup before upgrading existing databases (`user_version > 0`) using SQLite online backup API (`conn.backup()`), verified via `PRAGMA integrity_check`, timestamped atomic rename, retaining 5 verified backups, never deleting the only backup | **Hardened**. File copying live WAL databases risks torn pages. Using SQLite's backup API guarantees consistent snapshots, and pre-verification ensures uncorrupted recovery points. |
| **Table Typing (STRICT Mode)** | Flexible dynamic typing | SQLite 3.37+ `STRICT` tables on all 28 relational tables, enforcing native column types (`INTEGER`, `TEXT`, `REAL`) | **Hardened**. Exploited development runtime (`SQLite 3.39.4`) capabilities to enforce compile-time type safety directly at the SQLite engine boundary. |
| **Composite Foreign Keys** | Single-column foreign keys | Composite foreign keys enforcing relational alignment across questions, groups, revisions, parts, anchors, choices, and attempts | **Enhanced**. Prevents subtle cross-entity association bugs at the database engine level (e.g. question cannot reference group of a different JLPT level, answer cannot select choice from another question revision). |
| **Revision Immutability** | Basic UPDATE/DELETE triggers on revisions | Comprehensive BEFORE UPDATE and BEFORE DELETE triggers across 11 tables, with one-way `sealed_at: NULL -> timestamp` transition and triggers preventing child record insertion once parent is sealed | **Hardened**. Guarantees true append-only revision integrity; once sealed, no choices, parts, anchors, or assets can be injected into a sealed revision. |
| **Media Storage** | Flat filenames `sha256_<hash>.<ext>` | Content-addressed directory tree `media/<sha[:2]>/<sha><ext>`, temporary streaming ingest, fsync before atomic `os.replace`, containment checks rejecting directory traversal | **Enhanced**. Two-character directory prefixing prevents filesystem degradation from thousands of files in a single flat directory. Traversal protection prevents directory escapes. |
| **Eligibility Model** | SQL view `v_eligible_question_revisions` + Python function | SQL view `v_question_eligibility` + deterministic Python evaluator `evaluate_eligibility()` returning 9 priority-ordered reason codes (`RETIRED` through `ANSWER_CONFLICT`), with file verification opt-in | **Aligned**. Guaranteed exact 1-to-1 parity between SQL view pre-filtering and Python evaluation across all 6 structural families. Optional missing assets do not cause ineligibility. |
| **Database Doctor** | Conceptually proposed | Fully implemented read-only `app.study.doctor.run_doctor()`, testing 10 health facets (SQLite integrity, foreign keys, checksums, triggers, format completeness, media existence/hashes, orphans, pin alignment) without mutating data | **Delivered**. Completely read-only diagnostic tool returning structured `DoctorFinding` entries (`ERROR`, `WARNING`, `INFO`). |

---

## 3. Detailed Technical Audit by Subsystem

### 3.1 Relational Schema & Composite Foreign Keys

The relational schema comprises 28 tables defined in `backend/app/study/migrations/0001_initial.sql` and seeded in `0002_seed_formats_and_exams.sql`.

Crucial composite foreign keys enforced:
1. `question(content_group_id, level) REFERENCES content_group(id, level) ON DELETE RESTRICT`  
   *Guarantee:* A question at level `N3` cannot link to a reading passage at level `N2`.
2. `question(format_code, level) REFERENCES format_level(format_code, level) ON DELETE RESTRICT`  
   *Guarantee:* Questions can only be created with formats verified for that specific JLPT level (e.g. `word_formation` is strictly restricted to `N2`).
3. `question_revision(question_id, format_code) REFERENCES question(id, format_code) ON DELETE RESTRICT`  
   *Guarantee:* A revision cannot alter the structural format of its parent question.
4. `revision_answer(choice_id, question_revision_id) REFERENCES revision_choice(id, question_revision_id) ON DELETE RESTRICT`  
   *Guarantee:* A canonical answer cannot point to a choice belonging to a different revision.
5. `group_revision_anchor(part_id, group_revision_id) REFERENCES group_revision_part(id, group_revision_id) ON DELETE RESTRICT`  
   *Guarantee:* An anchor within a passage revision must point to a text part within the exact same passage revision.
6. `group_revision_asset(part_id, group_revision_id) REFERENCES group_revision_part(id, group_revision_id) ON DELETE RESTRICT`  
   *Guarantee:* An asset associated with a group part belongs to the same group revision.
7. `source_answer_claim(choice_id, question_revision_id) REFERENCES revision_choice(id, question_revision_id) ON DELETE RESTRICT`  
   *Guarantee:* External answer claims cannot cite distractors from another revision.
8. `attempt_item(pinned_question_revision_id, question_id) REFERENCES question_revision(id, question_id) ON DELETE RESTRICT`  
   *Guarantee:* Historical test attempts pin the exact revision of the question tested.
9. `attempt_item(pinned_group_revision_id, group_id) REFERENCES group_revision(id, group_id) ON DELETE RESTRICT`  
   *Guarantee:* Historical test attempts pin the exact revision of the shared passage.
10. `response(selected_choice_id, pinned_question_revision_id) REFERENCES revision_choice(id, question_revision_id) ON DELETE RESTRICT`  
    *Guarantee:* A learner's response cannot record a choice from a different revision.

### 3.2 Sealed-At Revision Immutability Triggers

To eliminate any window where an authoring tool or ad-hoc query could inject choices or alter stems after a revision has been finalized:
- `question_revision` and `group_revision` have a nullable `sealed_at` column.
- While `sealed_at IS NULL`, children (`revision_choice`, `group_revision_part`, `group_revision_anchor`, `question_revision_asset`, `group_revision_asset`) can be inserted.
- Once `sealed_at` is updated to a non-NULL timestamp, the `trg_*_insert_sealed` triggers abort any subsequent `INSERT` on child tables.
- `trg_question_revision_update` and `trg_group_revision_update` strictly allow only the transition `sealed_at: NULL -> value`; any other column update aborts.
- `DELETE` is permanently blocked on all revision and child tables.

### 3.3 Media Storage & Content-Addressed Sharding

In Milestone 0, files were named `sha256_<hash>.<ext>` inside a single flat directory. In Milestone 1, `MediaStore` organizes assets into a two-level prefix tree:
```
media/
  tmp/
    ingest_<uuid>.tmp
  4b/
    4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a.webm
  e3/
    e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.png
```
Security & Performance:
- Ingestion streams to `media/tmp/`, computes SHA-256 simultaneously, flushes, fsyncs, and uses atomic `os.replace`.
- Prevents directory entry exhaustion on Windows NTFS filesystems.
- Relative paths are validated with `_validate_path_contained()` to prevent directory traversal attacks (e.g. `../`).

### 3.4 Dynamic Eligibility Evaluation & Parity

Eligibility evaluation is decoupled from static flags:
1. SQL View `v_question_eligibility` aggregates pre-filter conditions (`has_current_revision`, `validation_status`, `has_answer`, `missing_required_assets_count`, `group_inconsistent`, `has_answer_conflict`).
2. Python evaluator `evaluate_eligibility(q_id, conn, verify_files=False)` deterministically evaluates and returns stable reason codes in exact priority order:
   - `RETIRED`
   - `NO_CURRENT_REVISION`
   - `VALIDATION_FAILED`
   - `NEEDS_REVIEW`
   - `NO_ANSWER`
   - `GRADER_UNIMPLEMENTED`
   - `REQUIRED_ASSET_MISSING`
   - `GROUP_INCONSISTENT`
   - `ANSWER_CONFLICT`
3. Optional assets: An asset with `is_required = 0` does NOT trigger `REQUIRED_ASSET_MISSING` if absent.
4. User-entered resolution: When a learner or teacher enters a canonical answer with `answer_origin = 'user_entered'`, existing source claim conflicts are treated as resolved.

---

## 4. Packaging, Exclusion & Distribution Verification

In accordance with Section 5 of Milestone 1 specifications:
1. **`.gitignore`**:
   - `study.db*`, `backend/study/`, `backend/data/study/`, and `study-v*-to-v*.db*` are explicitly excluded.
2. **`packaging/kiroku_backend.spec`**:
   - Bundles `app/study/migrations/*.sql` into `datas`.
   - Never bundles live databases, `media/`, or `backups/`.
3. **`installer/kiroku_setup.iss`**:
   - Explicitly preserves `{localappdata}\KirokuNote\study`, `media`, and `backups` during installs and uninstalls.
4. **Automated Verification**:
   - Covered by `backend/tests/test_study_exclusion_and_packaging.py`.

---

## 5. Milestone 1 Sign-Off

All Milestone 1 requirements are completely satisfied:
- Dedicated database path resolution and WAL connection manager implemented.
- Forward-only migration engine with SHA-256 checksum verification operational.
- WAL-safe online backups and safe recovery routines in place.
- Relational schema, composite foreign keys, STRICT tables, and immutability triggers verified.
- Content-addressed media store and provenance conflict preservation implemented.
- Eligibility SQL view and Python evaluator parity verified across all 6 structural families.
- Read-only database doctor functional.
- Documentation and architecture review complete.
- Implementation stopped strictly at Milestone 1 boundaries.

