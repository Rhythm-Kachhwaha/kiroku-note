-- =============================================================================
-- Migration 0004: Acquisition Job & Item Tracking Schema
-- =============================================================================
-- Tracks web acquisition and crawling jobs, discovered exercise URLs,
-- fetch/parse/ingest stages, and retry states for Kiroku Study Bank.

CREATE TABLE IF NOT EXISTS acquisition_job (
    id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    target_category_url TEXT NOT NULL,
    jlpt_level TEXT NOT NULL,
    section_category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'crawling', 'completed', 'failed', 'paused')),
    total_discovered INTEGER NOT NULL DEFAULT 0,
    total_acquired INTEGER NOT NULL DEFAULT 0,
    total_failed INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE IF NOT EXISTS acquisition_job_item (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    exercise_url TEXT NOT NULL,
    exercise_title TEXT NOT NULL DEFAULT '',
    ordinal INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'fetched', 'parsed', 'ingested', 'failed')),
    cache_path TEXT DEFAULT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(job_id) REFERENCES acquisition_job(id) ON DELETE CASCADE,
    UNIQUE(job_id, exercise_url)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_acq_job_status ON acquisition_job(status);
CREATE INDEX IF NOT EXISTS idx_acq_item_status ON acquisition_job_item(job_id, status);

