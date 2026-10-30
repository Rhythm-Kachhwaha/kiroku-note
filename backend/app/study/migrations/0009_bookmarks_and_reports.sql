-- -----------------------------------------------------------------------------
-- Migration 0009: Bookmarks, Question Reports, and Extended Provenance Indexes
-- -----------------------------------------------------------------------------
-- Adds persistent question bookmarking, issue reporting ledger, and
-- query indexes for weak-area practice and bank search.

-- 1. Question Bookmarks
CREATE TABLE IF NOT EXISTS question_bookmark (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE CASCADE,
    UNIQUE (question_id)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_question_bookmark_qid ON question_bookmark(question_id);
CREATE INDEX IF NOT EXISTS idx_question_bookmark_created ON question_bookmark(created_at);

-- 2. Question Reports Ledger
CREATE TABLE IF NOT EXISTS question_report (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE NOT NULL,
    question_id INTEGER NOT NULL,
    question_revision_id INTEGER DEFAULT NULL,
    issue_type TEXT NOT NULL CHECK(issue_type IN (
        'incorrect_answer',
        'bad_explanation',
        'wrong_format',
        'typo_or_content',
        'audio_media_issue',
        'other'
    )),
    details TEXT NOT NULL,
    suggested_correction TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'investigating', 'resolved', 'dismissed')),
    resolution_notes TEXT DEFAULT NULL,
    reported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    resolved_at TEXT DEFAULT NULL,
    FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY (question_revision_id) REFERENCES question_revision(id) ON DELETE SET NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_question_report_qid ON question_report(question_id);
CREATE INDEX IF NOT EXISTS idx_question_report_status ON question_report(status);
CREATE INDEX IF NOT EXISTS idx_question_report_reported_at ON question_report(reported_at);

-- 3. Query Optimization Indexes for Bank Search & Filtering
CREATE INDEX IF NOT EXISTS idx_question_category_level ON question(category, level, status);
CREATE INDEX IF NOT EXISTS idx_source_name ON source(name);

