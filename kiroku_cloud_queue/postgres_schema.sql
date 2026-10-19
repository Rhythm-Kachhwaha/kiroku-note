-- ==============================================================================
-- Kiroku Cloud Queue — PostgreSQL Schema Migration (Supabase / Cloud Run / RDS)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS queued_cards (
    id               VARCHAR(64) PRIMARY KEY,
    idempotency_key  VARCHAR(64) UNIQUE,
    expression       TEXT NOT NULL,
    reading          TEXT NOT NULL DEFAULT '',
    meaning          TEXT NOT NULL DEFAULT '',
    sentence         TEXT NOT NULL DEFAULT '',
    sentence_meaning TEXT NOT NULL DEFAULT '',
    deck_name        TEXT NOT NULL DEFAULT 'N3 vocabs',
    status           VARCHAR(32) NOT NULL DEFAULT 'pending',  -- 'pending', 'claimed', 'completed', 'failed'
    attempts         INTEGER NOT NULL DEFAULT 0,
    claim_token      VARCHAR(64),
    claimed_at       TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    error            TEXT NOT NULL DEFAULT '',
    payload_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for high-throughput atomic worker lease polling
CREATE INDEX IF NOT EXISTS idx_qc_status_lease ON queued_cards (status, lease_expires_at);

-- Index for instant idempotency lookups
CREATE INDEX IF NOT EXISTS idx_qc_idempotency ON queued_cards (idempotency_key);

-- Table for latest Anki study statistics snapshot
CREATE TABLE IF NOT EXISTS anki_stats (
    id               VARCHAR(64) PRIMARY KEY,
    payload_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to automatically update updated_at timestamp on row modification
CREATE OR REPLACE FUNCTION update_queued_cards_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_queued_cards_updated_at ON queued_cards;
CREATE TRIGGER trigger_update_queued_cards_updated_at
BEFORE UPDATE ON queued_cards
FOR EACH ROW
EXECUTE FUNCTION update_queued_cards_updated_at();

-- ==============================================================================
-- Mirrored Anki Cards, Daily Statistics Series, Metadata & Cloud Study
-- ==============================================================================

CREATE TABLE IF NOT EXISTS anki_cards (
    card_id             BIGINT PRIMARY KEY,
    note_id             BIGINT NOT NULL,
    deck_name           TEXT NOT NULL,
    model_name          TEXT NOT NULL,
    expression          TEXT NOT NULL,
    reading             TEXT NOT NULL DEFAULT '',
    meaning             TEXT NOT NULL DEFAULT '',
    sentence            TEXT NOT NULL DEFAULT '',
    sentence_meaning    TEXT NOT NULL DEFAULT '',
    jlpt_level          VARCHAR(16) DEFAULT NULL,
    state               VARCHAR(32) NOT NULL,
    queue_code          INTEGER NOT NULL DEFAULT 0,
    interval_days       INTEGER NOT NULL DEFAULT 0,
    reps                INTEGER NOT NULL DEFAULT 0,
    lapses              INTEGER NOT NULL DEFAULT 0,
    again_count_10      INTEGER NOT NULL DEFAULT 0,
    reviews_10          INTEGER NOT NULL DEFAULT 0,
    again_rate_10       REAL NOT NULL DEFAULT 0.0,
    avg_time_ms         INTEGER NOT NULL DEFAULT 0,
    difficulty_score    REAL DEFAULT NULL,
    difficulty_label    VARCHAR(32) NOT NULL DEFAULT 'new',
    is_leech            BOOLEAN NOT NULL DEFAULT FALSE,
    fsrs_difficulty     REAL DEFAULT NULL,
    fsrs_stability      REAL DEFAULT NULL,
    fsrs_retrievability REAL DEFAULT NULL,
    due_in_days         INTEGER DEFAULT NULL,
    raw_html            TEXT NOT NULL DEFAULT '',
    has_media           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL,
    first_review_at     TIMESTAMPTZ DEFAULT NULL,
    last_review_at      TIMESTAMPTZ DEFAULT NULL,
    mod_at              TIMESTAMPTZ NOT NULL,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ac_diff_label ON anki_cards (difficulty_label);
CREATE INDEX IF NOT EXISTS idx_ac_state ON anki_cards (state);
CREATE INDEX IF NOT EXISTS idx_ac_deck ON anki_cards (deck_name);
CREATE INDEX IF NOT EXISTS idx_ac_jlpt ON anki_cards (jlpt_level);
CREATE INDEX IF NOT EXISTS idx_ac_diff_score ON anki_cards (difficulty_score);
CREATE INDEX IF NOT EXISTS idx_ac_lapses ON anki_cards (lapses);
CREATE INDEX IF NOT EXISTS idx_ac_due ON anki_cards (due_in_days);
CREATE INDEX IF NOT EXISTS idx_ac_created ON anki_cards (created_at);

CREATE TABLE IF NOT EXISTS anki_card_media (
    card_id     BIGINT PRIMARY KEY REFERENCES anki_cards(card_id) ON DELETE CASCADE,
    media_name  TEXT NOT NULL,
    mime_type   VARCHAR(32) NOT NULL DEFAULT 'image/webp',
    image_webp  BYTEA NOT NULL,
    size_bytes  INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anki_daily (
    day                  VARCHAR(10) PRIMARY KEY, -- YYYY-MM-DD
    reviews              INTEGER NOT NULL DEFAULT 0,
    again                INTEGER NOT NULL DEFAULT 0,
    hard                 INTEGER NOT NULL DEFAULT 0,
    good                 INTEGER NOT NULL DEFAULT 0,
    easy                 INTEGER NOT NULL DEFAULT 0,
    time_ms              BIGINT NOT NULL DEFAULT 0,
    true_retention_num   INTEGER NOT NULL DEFAULT 0,
    true_retention_den   INTEGER NOT NULL DEFAULT 0,
    mature_retention_num INTEGER NOT NULL DEFAULT 0,
    mature_retention_den INTEGER NOT NULL DEFAULT 0,
    new_cards_added      INTEGER NOT NULL DEFAULT 0,
    total_cards          INTEGER NOT NULL DEFAULT 0,
    n_new                INTEGER NOT NULL DEFAULT 0,
    n_learning           INTEGER NOT NULL DEFAULT 0,
    n_young              INTEGER NOT NULL DEFAULT 0,
    n_mature             INTEGER NOT NULL DEFAULT 0,
    n_suspended          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS anki_meta (
    key        VARCHAR(64) PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cloud_study_state (
    card_id      BIGINT PRIMARY KEY REFERENCES anki_cards(card_id) ON DELETE CASCADE,
    box          INTEGER NOT NULL DEFAULT 1,
    due_at       TIMESTAMPTZ NOT NULL,
    times_seen   INTEGER NOT NULL DEFAULT 0,
    again_count  INTEGER NOT NULL DEFAULT 0,
    last_result  INTEGER NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ DEFAULT NULL,
    streak       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cloud_study_reviews (
    id          VARCHAR(64) PRIMARY KEY,
    card_id     BIGINT NOT NULL REFERENCES anki_cards(card_id) ON DELETE CASCADE,
    reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    rating      INTEGER NOT NULL,
    time_ms     INTEGER NOT NULL DEFAULT 0,
    session_id  VARCHAR(64) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_csr_card_id ON cloud_study_reviews (card_id);
CREATE INDEX IF NOT EXISTS idx_csr_reviewed_at ON cloud_study_reviews (reviewed_at);

