# Contract: extension-cloud
Depends-on: extension-auth, sync

## Purpose
Extension client cloud operations, offline card queueing, and fallback synchronization: provides reliable card mining and capture under varying network topologies (local desktop backend reachable, local backend offline + cloud edge worker reachable, or fully offline). Handles local SQLite card save with asynchronous cloud push notification, seamless fallback to Cloudflare Worker `/sync/push` with JWT Bearer authentication when desktop backend is offline, and durable queueing in `chrome.storage.local` under `kiroku_pending_cards` with mutex concurrency locks (`withQueueLock`) when both local and cloud endpoints are unavailable. Supports queue draining via periodic background alarms (`kiroku_sync_drain`) and message-triggered flushes (`DRAIN_PENDING_QUEUE`), dead-letter queue containment (`kiroku_dead_letter_cards`) for permanent conflicts (HTTP 409) or maximum retry thresholds, and sidepanel cloud synchronization/pull (`/api/cloud/pull`).

## Boundaries
- Input: Runtime messages (`QUEUE_CARD`, `DRAIN_PENDING_QUEUE`, `HUD_MINE`), periodic alarms (`kiroku_sync_drain`), API calls via `KirokuApi` (`saveCard`, `capture`, `syncUserProgress`, `syncAnimePlayback`), sidepanel refresh trigger (`triggerRefreshCloudQueue`).
- Output: Stored queue keys in `chrome.storage.local` (`kiroku_pending_cards`, `kiroku_dead_letter_cards`), HTTP requests to local backend (`http://127.0.0.1:21828/api/cards/save`, `/api/cloud/pull`) and Cloudflare Worker (`https://kiroku-note.rhythmkach.workers.dev/sync/push`, `/api/capture`), runtime response messages (`{ ok: boolean, queued?: boolean, sync_destination?: string, syncedCount?: number }`).

## State and storage
- `chrome.storage.local` keys:
  - Pending cards queue: `kiroku_pending_cards` (array of `{ id, queue_entry_id, payload, timestamp, attempts? }`, capped at 1000 items)
  - Dead letter queue: `kiroku_dead_letter_cards` (array of failed items after 10 retries or 409 conflict, capped at 50 items)
  - Auth token keys (read-only consumer): `kiroku_auth_token`, `kiroku.cloud.auth_token`, `kiroku_cloud_token`, `kiroku.extension.session_token`, `kiroku.extension.auth_token`, `kiroku_auth_session`
- In-memory concurrency locks:
  - `queueLockPromise` / `withQueueLock`: serializes read-modify-write operations on `kiroku_pending_cards`
  - `isDrainingQueue`: re-entrancy guard preventing concurrent queue drain cycles

## Dependencies
- Local Kiroku Backend (`http://127.0.0.1:21828`):
  - `POST /api/cards/save`
  - `POST /api/cloud/pull`
- Cloudflare Edge Worker (`https://kiroku-note.rhythmkach.workers.dev`):
  - `POST /sync/push`
  - `POST /api/capture`
- Chrome Extension APIs: `chrome.storage.local`, `chrome.runtime`, `chrome.alarms`, `chrome.tabs`.
- Predecessor module contracts: `extension-auth` (token persistence), `cloud-auth` (JWT verification), `sync` (sync protocol).

## Invariants
1. Three-tier fallback hierarchy: Save operations attempt (1) local backend, (2) cloud worker if local offline and authenticated, (3) offline local queue (`kiroku_pending_cards`) if cloud unavailable.
2. Queue serialization and atomicity: Concurrent writes or drains never clobber newly queued items; all queue mutations go through `withQueueLock`.
3. Safe queue drain acknowledgement: Draining marks and removes items based on specific `queue_entry_id` / identity match, ensuring items added during an in-flight drain are never lost.
4. Permanent failure containment (dead-lettering): Cards returning HTTP 409 (payload mismatch) or exceeding 10 failed drain attempts are moved to `kiroku_dead_letter_cards` and evicted from `kiroku_pending_cards` to prevent infinite retry loops.
5. Queue capacity protection: The queue rejects new items once it reaches the safety limit of 1000 unacknowledged cards to avoid unbounded storage growth.
6. Token resolution precedence: `getStoredCloudToken()` checks primary canonical key `kiroku_auth_token` before legacy keys and passes bearer authorization header on cloud push.
7. Modularity invariant: Sidepanel modules in `extension/sidepanel/modules/*.js` remain separate and `sidepanel.js` monolith is never created or restored.
8. Single capture outcome: A card save produces exactly one confirmed destination indicator (`local`, `cloud`, or `queued`), avoiding duplicate writes.

## Failure behavior
- Local backend unreachable: Seamlessly transitions to cloud worker if token present, or enqueues locally.
- Cloud edge network failure/offline: Enqueues into `kiroku_pending_cards` without throwing uncaught exceptions to caller.
- HTTP 409 Conflict from cloud worker: Dead-letters card immediately into `kiroku_dead_letter_cards` with diagnostic error message.
- Storage capacity reached (1000 items): `queueCardLocally` returns `false` and logs warning without dropping existing queued cards.
- Background alarm trigger during drain: Re-entrancy guard `isDrainingQueue` drops duplicate drain execution cleanly.

## Out of scope
- Server-side D1/Turso database transaction management (owned by `cloud-auth` and `sync`).
- Local SQLite schema migrations (owned by `db`).
- Desktop UI rendering and tab routing (owned by `desktop`).
- OAuth login exchange and session verification (owned by `extension-auth`).
