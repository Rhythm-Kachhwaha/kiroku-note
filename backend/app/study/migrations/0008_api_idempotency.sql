-- -----------------------------------------------------------------------------
-- Migration 0008: API Mutation Idempotency Ledger
-- -----------------------------------------------------------------------------
-- Stores immutable idempotency records for mutation requests under /api/study/v1.
-- Guarantees safe request retries without duplicating sessions, items, or grading results.

CREATE TABLE IF NOT EXISTS api_mutation_idempotency (
    client_request_id TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    resource_id TEXT,
    payload_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('processing', 'completed', 'failed')),
    status_code INTEGER,
    response_body TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX IF NOT EXISTS idx_api_idempotency_lookup ON api_mutation_idempotency(client_request_id, operation, payload_hash);
CREATE INDEX IF NOT EXISTS idx_api_idempotency_created ON api_mutation_idempotency(created_at);

