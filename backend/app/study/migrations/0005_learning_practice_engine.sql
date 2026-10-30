-- -----------------------------------------------------------------------------
-- Migration 0005: Learning & Practice Engine
-- -----------------------------------------------------------------------------
-- Enhances the practice persistence foundation with full practice session support,
-- deterministic grading audit trails, attempt item presentation tracking,
-- decoupled difficulty feedback, and adaptive repetition scheduling state.

DROP TRIGGER IF EXISTS trg_response_insert_check;
DROP TRIGGER IF EXISTS trg_response_no_update;
DROP TRIGGER IF EXISTS trg_response_no_delete;
DROP TRIGGER IF EXISTS trg_attempt_item_no_update;
DROP TRIGGER IF EXISTS trg_attempt_item_no_delete;
DROP TRIGGER IF EXISTS trg_attempt_item_choice_order_no_update;
DROP TRIGGER IF EXISTS trg_attempt_item_choice_order_no_delete;
DROP TRIGGER IF EXISTS trg_attempt_item_validate;
DROP TRIGGER IF EXISTS trg_attempt_item_choice_order_validate;

DROP TABLE IF EXISTS response;
DROP TABLE IF EXISTS attempt_item_choice_order;
DROP TABLE IF EXISTS attempt_item;
DROP TABLE IF EXISTS test_attempt;

-- 1. Practice & Exam Sessions
CREATE TABLE test_attempt (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE NOT NULL,
    session_type TEXT NOT NULL DEFAULT 'practice' CHECK(session_type IN ('practice', 'casual', 'exam')),
    status TEXT NOT NULL DEFAULT 'created' CHECK(status IN ('created', 'in_progress', 'completed', 'abandoned')),
    level TEXT DEFAULT NULL CHECK(level IN ('N1', 'N2', 'N3', 'N4', 'N5') OR level IS NULL),
    category TEXT DEFAULT NULL,
    format_code TEXT DEFAULT NULL,
    recipe_snapshot_json TEXT DEFAULT NULL,
    seed INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at TEXT DEFAULT NULL,
    completed_at TEXT DEFAULT NULL,
    total_elapsed_ms INTEGER NOT NULL DEFAULT 0,
    last_active_at TEXT DEFAULT NULL
) STRICT;

-- 2. Items Pinned in Session
CREATE TABLE attempt_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    pinned_question_revision_id INTEGER NOT NULL,
    group_id INTEGER DEFAULT NULL,
    pinned_group_revision_id INTEGER DEFAULT NULL,
    anchor_key TEXT DEFAULT NULL,
    group_position INTEGER DEFAULT NULL,
    presented_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (attempt_id) REFERENCES test_attempt(id) ON DELETE RESTRICT,
    FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY (group_id) REFERENCES content_group(id) ON DELETE RESTRICT,
    FOREIGN KEY (pinned_question_revision_id, question_id) REFERENCES question_revision(id, question_id) ON DELETE RESTRICT,
    FOREIGN KEY (pinned_group_revision_id, group_id) REFERENCES group_revision(id, group_id) ON DELETE RESTRICT,
    UNIQUE (attempt_id, position),
    UNIQUE (id, pinned_question_revision_id)
) STRICT;

-- 3. Display Choice Ordering per Item
CREATE TABLE attempt_item_choice_order (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_item_id INTEGER NOT NULL,
    choice_id INTEGER NOT NULL,
    display_position INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (attempt_item_id) REFERENCES attempt_item(id) ON DELETE RESTRICT,
    FOREIGN KEY (choice_id) REFERENCES revision_choice(id) ON DELETE RESTRICT,
    UNIQUE (attempt_item_id, display_position),
    UNIQUE (attempt_item_id, choice_id)
) STRICT;

-- 4. Graded Responses (Append-only)
CREATE TABLE response (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_item_id INTEGER UNIQUE NOT NULL,
    selected_choice_id INTEGER DEFAULT NULL,
    pinned_question_revision_id INTEGER NOT NULL,
    is_correct INTEGER NOT NULL DEFAULT 0 CHECK(is_correct IN (0, 1)),
    grading_status TEXT NOT NULL DEFAULT 'graded' CHECK(grading_status IN ('graded', 'invalid', 'unsupported')),
    submitted_answer TEXT DEFAULT NULL,
    canonical_choice_id INTEGER DEFAULT NULL,
    time_spent_ms INTEGER NOT NULL DEFAULT 0,
    answered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (attempt_item_id) REFERENCES attempt_item(id) ON DELETE RESTRICT,
    FOREIGN KEY (selected_choice_id, pinned_question_revision_id) REFERENCES revision_choice(id, question_revision_id) ON DELETE RESTRICT,
    FOREIGN KEY (canonical_choice_id) REFERENCES revision_choice(id) ON DELETE RESTRICT
) STRICT;

-- 5. User Difficulty Feedback
CREATE TABLE attempt_item_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_item_id INTEGER UNIQUE NOT NULL,
    difficulty_rating TEXT NOT NULL CHECK(difficulty_rating IN ('easy', 'normal', 'hard')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (attempt_item_id) REFERENCES attempt_item(id) ON DELETE RESTRICT
) STRICT;

-- 6. Question Adaptive Repetition State
CREATE TABLE question_adaptive_state (
    question_id INTEGER PRIMARY KEY,
    total_attempts INTEGER NOT NULL DEFAULT 0,
    total_correct INTEGER NOT NULL DEFAULT 0,
    consecutive_correct_easy INTEGER NOT NULL DEFAULT 0,
    last_attempted_at TEXT DEFAULT NULL,
    last_session_id INTEGER DEFAULT NULL,
    last_rating TEXT DEFAULT NULL CHECK(last_rating IN ('easy', 'normal', 'hard') OR last_rating IS NULL),
    last_is_correct INTEGER DEFAULT NULL CHECK(last_is_correct IN (0, 1) OR last_is_correct IS NULL),
    priority_score REAL NOT NULL DEFAULT 100.0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY (last_session_id) REFERENCES test_attempt(id) ON DELETE SET NULL
) STRICT;

-- -----------------------------------------------------------------------------
-- Recreate Immutability & Validation Triggers
-- -----------------------------------------------------------------------------

CREATE TRIGGER trg_attempt_item_no_update
BEFORE UPDATE ON attempt_item
BEGIN
    SELECT CASE
        -- Only presented_at is allowed to transition from NULL -> timestamp once
        WHEN OLD.presented_at IS NOT NULL AND NEW.presented_at != OLD.presented_at THEN
            RAISE(ABORT, 'presented_at cannot be updated once set.')
        WHEN NEW.attempt_id != OLD.attempt_id
          OR NEW.position != OLD.position
          OR NEW.question_id != OLD.question_id
          OR NEW.pinned_question_revision_id != OLD.pinned_question_revision_id
          OR COALESCE(NEW.group_id, -1) != COALESCE(OLD.group_id, -1)
          OR COALESCE(NEW.pinned_group_revision_id, -1) != COALESCE(OLD.pinned_group_revision_id, -1)
          OR COALESCE(NEW.anchor_key, '') != COALESCE(OLD.anchor_key, '')
          OR COALESCE(NEW.group_position, -1) != COALESCE(OLD.group_position, -1)
          OR NEW.created_at != OLD.created_at THEN
            RAISE(ABORT, 'attempt_item core fields cannot be updated.')
    END;
END;

CREATE TRIGGER trg_attempt_item_no_delete
BEFORE DELETE ON attempt_item
BEGIN
    SELECT RAISE(ABORT, 'attempt_item records cannot be deleted.');
END;

CREATE TRIGGER trg_attempt_item_choice_order_no_update
BEFORE UPDATE ON attempt_item_choice_order
BEGIN
    SELECT RAISE(ABORT, 'attempt_item_choice_order records are immutable.');
END;

CREATE TRIGGER trg_attempt_item_choice_order_no_delete
BEFORE DELETE ON attempt_item_choice_order
BEGIN
    SELECT RAISE(ABORT, 'attempt_item_choice_order records cannot be deleted.');
END;

CREATE TRIGGER trg_response_insert_check
BEFORE INSERT ON response
BEGIN
    SELECT CASE
        WHEN (SELECT status FROM test_attempt ta JOIN attempt_item ai ON ai.attempt_id = ta.id WHERE ai.id = NEW.attempt_item_id) NOT IN ('created', 'in_progress') THEN
            RAISE(ABORT, 'Cannot add response to an attempt that is not active or in progress.')
    END;
END;

CREATE TRIGGER trg_response_no_update
BEFORE UPDATE ON response
BEGIN
    SELECT RAISE(ABORT, 'response records are append-only and cannot be updated.');
END;

CREATE TRIGGER trg_response_no_delete
BEFORE DELETE ON response
BEGIN
    SELECT RAISE(ABORT, 'response records cannot be deleted.');
END;

CREATE TRIGGER trg_attempt_item_validate
BEFORE INSERT ON attempt_item
BEGIN
    SELECT CASE
        -- Standalone question validation: must have NULL group references
        WHEN (SELECT content_group_id FROM question WHERE id = NEW.question_id) IS NULL THEN
            CASE
                WHEN NEW.group_id IS NOT NULL OR NEW.pinned_group_revision_id IS NOT NULL OR NEW.anchor_key IS NOT NULL THEN
                    RAISE(ABORT, 'Standalone questions must have group_id, pinned_group_revision_id, and anchor_key NULL in attempt_item.')
            END
        -- Grouped question validation
        WHEN (SELECT content_group_id FROM question WHERE id = NEW.question_id) IS NOT NULL THEN
            CASE
                WHEN NEW.group_id IS NULL OR NEW.group_id != (SELECT content_group_id FROM question WHERE id = NEW.question_id) THEN
                    RAISE(ABORT, 'attempt_item group_id must match the question content_group_id.')
                WHEN NEW.pinned_group_revision_id IS NULL THEN
                    RAISE(ABORT, 'attempt_item pinned_group_revision_id is required for grouped questions.')
                WHEN NEW.anchor_key IS NOT NULL AND (SELECT COUNT(*) FROM group_revision_anchor WHERE group_revision_id = NEW.pinned_group_revision_id AND anchor_key = NEW.anchor_key) = 0 THEN
                    RAISE(ABORT, 'attempt_item anchor_key does not exist in the pinned group revision.')
            END
    END;
END;

CREATE TRIGGER trg_attempt_item_choice_order_validate
BEFORE INSERT ON attempt_item_choice_order
BEGIN
    SELECT CASE
        WHEN (SELECT question_revision_id FROM revision_choice WHERE id = NEW.choice_id) != (SELECT pinned_question_revision_id FROM attempt_item WHERE id = NEW.attempt_item_id) THEN
            RAISE(ABORT, 'choice_id must belong to the attempt item pinned question revision.')
    END;
END;
