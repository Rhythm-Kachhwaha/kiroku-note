-- =============================================================================
-- Migration 0003: AI Question Verification Schema
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Verification Run Ledger
-- -----------------------------------------------------------------------------
CREATE TABLE verification_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE NOT NULL,
    question_id INTEGER NOT NULL,
    question_revision_id INTEGER NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
        'not_verified',
        'pending',
        'agreement',
        'ai_agreement_unconfirmed',
        'model_disagreement',
        'source_answer_conflict',
        'source_claim_conflict',
        'question_ambiguous',
        'verification_failed',
        'needs_human_review',
        'human_approved',
        'human_corrected',
        'human_rejected'
    )),
    comparison_scenario TEXT DEFAULT NULL CHECK(comparison_scenario IS NULL OR comparison_scenario IN (
        'scenario_a_agreement',
        'scenario_b_ai_agreement_unconfirmed',
        'scenario_c_model_disagreement',
        'scenario_d_source_answer_conflict',
        'scenario_e_model_disagreement',
        'scenario_f_source_claim_conflict',
        'scenario_g_question_ambiguous',
        'scenario_h_model_failure'
    )),
    model_a_provider TEXT NOT NULL,
    model_a_model TEXT NOT NULL,
    model_b_provider TEXT NOT NULL,
    model_b_model TEXT NOT NULL,
    model_a_choice_key TEXT DEFAULT NULL,
    model_b_choice_key TEXT DEFAULT NULL,
    source_answer_keys_json TEXT NOT NULL DEFAULT '[]',
    is_ambiguous INTEGER NOT NULL DEFAULT 0 CHECK(is_ambiguous IN (0, 1)),
    error_message TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY (question_revision_id, question_id) REFERENCES question_revision(id, question_id) ON DELETE RESTRICT,
    UNIQUE (question_revision_id, attempt_number)
) STRICT;

CREATE INDEX idx_verification_run_revision ON verification_run(question_revision_id);
CREATE INDEX idx_verification_run_status ON verification_run(status);

-- -----------------------------------------------------------------------------
-- 2. Individual Model Responses & Execution Log
-- -----------------------------------------------------------------------------
CREATE TABLE verification_model_response (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    model_slot TEXT NOT NULL CHECK(model_slot IN ('model_a', 'model_b')),
    stage TEXT NOT NULL CHECK(stage IN ('independent_solve', 'source_verify', 'explanation')),
    provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    selected_choice_key TEXT DEFAULT NULL,
    confidence TEXT DEFAULT NULL CHECK(confidence IS NULL OR confidence IN ('high', 'medium', 'low')),
    question_validity TEXT DEFAULT NULL CHECK(question_validity IS NULL OR question_validity IN ('valid', 'ambiguous', 'defective')),
    ambiguity_detected INTEGER NOT NULL DEFAULT 0 CHECK(ambiguity_detected IN (0, 1)),
    reasoning_markup TEXT NOT NULL DEFAULT '',
    choice_analysis_json TEXT NOT NULL DEFAULT '{}',
    source_assessment_json TEXT NOT NULL DEFAULT '{}',
    raw_response_text TEXT NOT NULL DEFAULT '',
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    token_usage_json TEXT NOT NULL DEFAULT '{}',
    error_message TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (run_id) REFERENCES verification_run(id) ON DELETE RESTRICT,
    UNIQUE (run_id, model_slot, stage)
) STRICT;

CREATE INDEX idx_verification_model_response_run ON verification_model_response(run_id);

-- -----------------------------------------------------------------------------
-- 3. AI Generated & Human Approved Explanations
-- -----------------------------------------------------------------------------
CREATE TABLE question_explanation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE NOT NULL,
    question_id INTEGER NOT NULL,
    question_revision_id INTEGER NOT NULL,
    run_id INTEGER DEFAULT NULL,
    generated_by_slot TEXT NOT NULL CHECK(generated_by_slot IN ('model_a', 'model_b', 'human', 'consensus')),
    provider TEXT NOT NULL DEFAULT 'unknown',
    model_name TEXT NOT NULL DEFAULT 'unknown',
    target_choice_key TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    correct_choice_analysis TEXT NOT NULL DEFAULT '',
    distractor_analysis_json TEXT NOT NULL DEFAULT '{}',
    grammar_notes TEXT NOT NULL DEFAULT '',
    kanji_vocabulary_notes TEXT NOT NULL DEFAULT '',
    reading_context_notes TEXT NOT NULL DEFAULT '',
    is_human_approved INTEGER NOT NULL DEFAULT 0 CHECK(is_human_approved IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY (question_revision_id, question_id) REFERENCES question_revision(id, question_id) ON DELETE RESTRICT,
    FOREIGN KEY (run_id) REFERENCES verification_run(id) ON DELETE SET NULL
) STRICT;

CREATE INDEX idx_question_explanation_revision ON question_explanation(question_revision_id);

-- -----------------------------------------------------------------------------
-- 4. Human Review Decisions Ledger
-- -----------------------------------------------------------------------------
CREATE TABLE verification_human_decision (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE NOT NULL,
    run_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    question_revision_id INTEGER NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('accept', 'correct', 'ambiguous', 'defective', 'reject', 'reverify')),
    selected_choice_key TEXT DEFAULT NULL,
    human_explanation TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    reviewer_id TEXT NOT NULL DEFAULT 'local_user',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (run_id) REFERENCES verification_run(id) ON DELETE RESTRICT,
    FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY (question_revision_id, question_id) REFERENCES question_revision(id, question_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX idx_verification_human_decision_run ON verification_human_decision(run_id);
CREATE INDEX idx_verification_human_decision_rev ON verification_human_decision(question_revision_id);

-- -----------------------------------------------------------------------------
-- 5. Immutability & Audit Triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_verification_run_no_delete
BEFORE DELETE ON verification_run
BEGIN
    SELECT RAISE(ABORT, 'verification_run records cannot be deleted.');
END;

CREATE TRIGGER trg_verification_model_response_no_update
BEFORE UPDATE ON verification_model_response
BEGIN
    SELECT RAISE(ABORT, 'verification_model_response records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_verification_model_response_no_delete
BEFORE DELETE ON verification_model_response
BEGIN
    SELECT RAISE(ABORT, 'verification_model_response records cannot be deleted.');
END;

CREATE TRIGGER trg_verification_human_decision_no_update
BEFORE UPDATE ON verification_human_decision
BEGIN
    SELECT RAISE(ABORT, 'verification_human_decision records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_verification_human_decision_no_delete
BEFORE DELETE ON verification_human_decision
BEGIN
    SELECT RAISE(ABORT, 'verification_human_decision records cannot be deleted.');
END;

CREATE TRIGGER trg_question_explanation_no_delete
BEFORE DELETE ON question_explanation
BEGIN
    SELECT RAISE(ABORT, 'question_explanation records cannot be deleted.');
END;

