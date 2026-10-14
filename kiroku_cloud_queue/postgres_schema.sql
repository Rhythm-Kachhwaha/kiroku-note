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
