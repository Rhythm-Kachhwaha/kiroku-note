# Contract: sync
Depends-on: db, cloud-auth

## Purpose
Bidirectional, conflict-free synchronization of Japanese study cards, tombstones (deletions), and learner progress between local SQLite clients (Desktop, Extension) and Turso edge database via Cloudflare Worker.

## Boundaries
- `POST /api/sync/push`, `POST /sync/push`: Batch push card mutations (saves, updates, deletes/tombstones). Request: `{ ops: [...] }` or `[ ... ]` (max 100 items, 512KB). Response: `{ status: 'ok'|'partial', pushed: N, ids: [...], failed: [...], cursor: string }`.
- `GET /api/sync/pull`, `GET /sync/pull`: Incremental pull of changes for authenticated user. Query params: `since_cursor` / `cursor`, `limit` (max 500, default 50), optional `device_id`. Response: `{ items: [...], count: N, cursor: string, has_more: bool }`.
- `POST /api/sync/ack`, `POST /sync/ack`: Acknowledge processed ops. Request: `{ ids: [...] }` (max 100 items). Response: `{ status: 'ok', acked: N }`.
- `POST /api/user/progress/sync`: Daily study activity and reviews sync. Request: `{ sync_id, daily, vocab_reviews, ... }`. Response: `{ ok: true, synced: N }`.
- `GET /api/user/progress/summary`: Returns user study counts (vocab, kanji, streak). Response: `{ ok: true, summary: { ... } }`.
- Local Python API: `POST /api/cloud/sync/push-batch`, `POST /api/cloud/sync/pull-batch`, `POST /api/cloud/sync/run`, `POST /api/cloud/sync/progress`, `GET /api/cloud/sync/status`.
- Extension client exports: `queueCardLocally(payload)`, `drainPendingCardsQueue()`, `getStoredCloudToken()`.
- Desktop coordinator: `SyncCoordinator.runSync({ showOverlay, onProgress })`.

## State and storage
- Cloud edge state (Turso libSQL):
  - `user_op_log`: `(user_id, id, op_type, payload, lease_id, lease_expires_at, ack, error, attempts, created_at, acked_at)`.
  - `user_study_cards`: `(user_id, term_ref, deck_id, state, stability, difficulty, reps, lapses, due_at, last_reviewed_at, custom_sentence)`.
  - `user_daily_stats`: `(user_id, date, reviews, time_ms, again_count, good_count)`.
  - `user_vocab_progress`: `(user_id, vocab_id, state, stability, difficulty, reps, lapses, last_review_at, due_at)`.
- Local Desktop SQLite state:
  - `cards`: local primary truth table.
  - `card_cloud_sync`: `(card_id, cloud_op_id, synced_at)`.
  - `deleted_cards`: `(id, card_id, expression, reading, deck_name, deleted_at, pushed_at)`.
  - `cloud_sync_meta`: `(key, value, updated_at)` storing `last_pull_cursor`.
- Extension local storage:
  - `chrome.storage.local`: `kiroku_pending_cards` (offline queue), `kiroku_dead_letter_cards` (failed items after 10 retries or 409 conflict).

## Dependencies
- Cloudflare Worker runtime and Web Crypto API.
- Turso LibSQL client (`worker/turso.js`) for persistent multi-tenant op log and progress.
- Local SQLite database with WAL mode and atomic transactions (`backend/app/db/connection.py`).
- HTTP/REST networking (httpx in Python, fetch in Extension / Desktop).

## Invariants
- Tenant isolation: User A can NEVER push, pull, view, modify, or acknowledge User B's cards or progress.
- Conflict-free resolution via Last-Writer-Wins (LWW): When concurrent or subsequent updates occur for the same card identity, the newest edit (by `updated_at`/`created_at`) wins and updates the cloud state; edits must never be silently dropped by `DO NOTHING`.
- Tombstone precedence: A deletion (`card_delete` with `deleted_at`) prevents stale devices from resurrecting deleted cards unless an edit has a strictly newer timestamp.
- Per-device cursor independence: Device B pulling with its own cursor must receive updates even if Device A has already pulled and acknowledged the same op.
- Idempotency: Resending the same push batch or pulling the same cursor range produces identical database state without duplicate cards or unexpected errors.
- Self-push suppression: When `device_id` is provided on push/pull, a device does not re-download its own pushed operations.
- Batch limits and safety: Sync push batches are capped at 100 items and 512KB payload; requests exceeding limits fail fast with 413.
- Fast synchronization: Desktop batch push and pull processes optimal batch sizes (up to 100 items per batch) to achieve sub-second latency comparable to Anki sync.
- Extension offline resilience: Cards captured while offline queue in `kiroku_pending_cards`; draining transfers to local backend if online, or cloud worker if offline from desktop; invalid/poison items dead-letter after 10 attempts without blocking subsequent cards.

## Failure behavior
- Missing or invalid authentication token in production returns 401 Unauthorized (`{ error: 'Unauthorized' }`).
- Service role attempting to sync personal user cards returns 403 Forbidden.
- Database outage or missing Turso configuration in production returns 503 Service Unavailable.
- Payload over 512KB or batch > 100 items returns 413 Payload Too Large.
- Network interruption mid-sync fails atomically at the batch boundary; already-committed batches and updated cursors persist cleanly.
- Extension network failure leaves unsaved items in `kiroku_pending_cards` to retry on next drain.

## Out of scope
- Direct binary media asset (audio/image) blob replication over Turso op log (media blobs are uploaded separately to R2 / media endpoints or stored locally).
- Third-party AnkiWeb cloud sync (handled separately by `anki_mirror.py` or AnkiConnect).
- Non-user global telemetry/analytics.
