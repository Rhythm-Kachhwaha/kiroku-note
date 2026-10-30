-- -----------------------------------------------------------------------------
-- Migration 0006: JLPT Examination Engine
-- -----------------------------------------------------------------------------
-- Adds persistent exam blueprint versioning, section-level timing and attempt state,
-- draft item presentation state with mark-for-review tracking, and immutable
-- exam result and scoring snapshots.

-- 1. Versioned Exam Blueprint Storage
CREATE TABLE exam_blueprint (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK(level IN ('N1', 'N2', 'N3', 'N4', 'N5')),
    version TEXT NOT NULL,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (level, version)
) STRICT;

-- 2. Examination Section Attempt Lifecycle & Timing
CREATE TABLE exam_section_attempt (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL,
    section_code TEXT NOT NULL,
    block_order INTEGER NOT NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'paused', 'completed', 'expired')),
    allocated_time_seconds INTEGER NOT NULL,
    remaining_time_seconds INTEGER NOT NULL,
    started_at TEXT DEFAULT NULL,
    deadline_at TEXT DEFAULT NULL,
    paused_at TEXT DEFAULT NULL,
    completed_at TEXT DEFAULT NULL,
    total_elapsed_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (attempt_id) REFERENCES test_attempt(id) ON DELETE RESTRICT,
    UNIQUE (attempt_id, block_order),
    UNIQUE (attempt_id, section_code)
) STRICT;

-- 3. Exam Item State (Draft Choice Selection & Mark-For-Review per Attempt Item)
CREATE TABLE exam_item_state (
    attempt_item_id INTEGER PRIMARY KEY,
    section_attempt_id INTEGER NOT NULL,
    selected_choice_id INTEGER DEFAULT NULL,
    is_marked_for_review INTEGER NOT NULL DEFAULT 0 CHECK(is_marked_for_review IN (0, 1)),
    time_spent_ms INTEGER NOT NULL DEFAULT 0,
    last_action_at TEXT DEFAULT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (attempt_item_id) REFERENCES attempt_item(id) ON DELETE RESTRICT,
    FOREIGN KEY (section_attempt_id) REFERENCES exam_section_attempt(id) ON DELETE RESTRICT,
    FOREIGN KEY (selected_choice_id) REFERENCES revision_choice(id) ON DELETE RESTRICT
) STRICT;

-- 4. Immutable Exam Result & Scoring Snapshot
CREATE TABLE exam_result_snapshot (
    attempt_id INTEGER PRIMARY KEY,
    blueprint_level TEXT NOT NULL,
    blueprint_version TEXT NOT NULL,
    scoring_algorithm_version TEXT NOT NULL,
    is_complete INTEGER NOT NULL CHECK(is_complete IN (0, 1)),
    total_questions INTEGER NOT NULL,
    raw_correct INTEGER NOT NULL,
    raw_incorrect INTEGER NOT NULL,
    raw_unanswered INTEGER NOT NULL,
    raw_accuracy REAL NOT NULL,
    estimated_total_score INTEGER NOT NULL,
    overall_pass_threshold INTEGER NOT NULL,
    passed_overall INTEGER NOT NULL CHECK(passed_overall IN (0, 1)),
    passed_sectional INTEGER NOT NULL CHECK(passed_sectional IN (0, 1)),
    passed_overall_estimate INTEGER NOT NULL CHECK(passed_overall_estimate IN (0, 1)),
    readiness_assessment TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (attempt_id) REFERENCES test_attempt(id) ON DELETE RESTRICT
) STRICT;

-- -----------------------------------------------------------------------------
-- 5. Immutability & Section Closure Triggers
-- -----------------------------------------------------------------------------

CREATE TRIGGER trg_exam_result_snapshot_no_update
BEFORE UPDATE ON exam_result_snapshot
BEGIN
    SELECT RAISE(ABORT, 'exam_result_snapshot records are immutable.');
END;

CREATE TRIGGER trg_exam_result_snapshot_no_delete
BEFORE DELETE ON exam_result_snapshot
BEGIN
    SELECT RAISE(ABORT, 'exam_result_snapshot records cannot be deleted.');
END;

CREATE TRIGGER trg_exam_item_state_no_update_if_section_closed
BEFORE UPDATE ON exam_item_state
BEGIN
    SELECT CASE
        WHEN (SELECT status FROM exam_section_attempt WHERE id = OLD.section_attempt_id) IN ('completed', 'expired') THEN
            RAISE(ABORT, 'Cannot modify exam item state when exam section is completed or expired.')
    END;
END;

CREATE TRIGGER trg_exam_item_state_no_delete
BEFORE DELETE ON exam_item_state
BEGIN
    SELECT RAISE(ABORT, 'exam_item_state records cannot be deleted.');
END;
