# Kiroku Note — Cloud, Auth, Extension API & Database Audit

**Date:** 2026-11-18  
**Scope:** `D:\Python\AnkiMiner` only. Read-only audit; no source files changed. No Git commands run.  
**Coverage:** Cloudflare Worker auth/routes/Turso client, Neon catalog SQL and migration, desktop OAuth callback/token storage, Chromium extension queue and cloud fallback, Turso/PostgreSQL queue adapters, worker processing and tests.

## Executive assessment

The high-level split—Neon for canonical catalog data and Turso for learner state—is sound. The current implementation does **not yet enforce the handover's stated invariants consistently**. The highest-risk problems are: user identity can be spoofed on several study endpoints; the guest flow gives every guest the same user ID; sync push can acknowledge work that was never persisted; timestamp-only pull cursors can skip records; extension retries do not preserve operation IDs; and due-card hydration reads compressed BYTEA as JSON.

**Recommendation: do not treat multi-user cloud sync as production-safe until the P1 items below are fixed and covered by integration tests.** Existing focused tests pass, but several tests mock successful database responses and do not exercise the failure/concurrency cases identified here.

## Findings

### P1 — Fix before relying on multi-user cloud sync

#### 1. Study attempts and bookmarks allow unauthenticated identity spoofing
**Evidence:** `worker/index.js:2964-3062`. The attempts, responses, and bookmark handlers call `authenticateRequest` but do not reject an unauthenticated caller. They accept `body.user_id` or `?user_id=` as the effective identity. An unauthenticated client can write records under another user's ID and read that user's bookmarks. This contradicts the per-user isolation rule.

**Remedy:** Require a valid session/JWT/short-lived scoped token on every user-data route. Derive user ID exclusively from verified claims; ignore/reject client-supplied `user_id`. Bind attempts/responses/bookmarks to the authenticated owner and check ownership on every read/update. Add production-mode 401 and cross-user isolation tests.

#### 2. Guest authentication collapses all guests into one shared account
**Evidence:** `worker/auth.js:286-294` issues a seven-day JWT with `sub: 'cloud_learner'` without requiring sign-in. All guest browsers therefore share one Turso user partition. The API is public by design, but the identity is not unique.

**Remedy:** Either make guest mode strictly local-only, or issue a cryptographically random per-install/per-session subject and persist it safely. Do not use a constant subject for independent learners. Define an explicit guest migration/linking path when a user signs in.

#### 3. Sync push returns success even when Turso inserts fail
**Evidence:** `worker/index.js:3269-3320`. Each insert error is caught and logged, but the handler still returns `status: 'ok'` and reports every generated ID in `pushed`. `queryTurso` also returns `null` when DB credentials are absent rather than throwing. The extension treats HTTP success as durable acceptance and removes queued items. This can cause silent card loss during schema/config/database failures.

**Remedy:** Fail closed when Turso is not configured. Check every pipeline result and affected-row outcome. Return success only for committed IDs; return a non-2xx response or explicit per-item failures for rejected writes. Extension must remove only IDs explicitly confirmed durable. Add tests for missing credentials, HTTP 200 with a pipeline statement error, and one failed statement in a batch.

#### 4. Pull cursor is timestamp-only and can skip operations sharing a timestamp
**Evidence:** `worker/index.js:3323-3418`. A single `nowIso` is assigned to every item in a push batch. Pull filters with `created_at > sinceCursor` and orders only by `created_at`. If a page limit splits a batch with identical timestamps, the next page's strict-greater-than cursor excludes the remaining rows. This is especially likely with a push larger than the desktop's 50-item page size.

**Remedy:** Use a stable composite keyset cursor such as `(created_at, id)`, query with `created_at > ? OR (created_at = ? AND id > ?)`, and order by both columns. Prefer a monotonic sequence if schema changes are acceptable. Test >50 operations created in one push and verify every ID is pulled exactly once before ack.

#### 5. Extension cloud retries do not preserve the local queue item's ID
**Evidence:** `extension/background.js:20-86`. Local queue entries receive an ID, but cloud fallback sends only `{ ops: [cardPayload] }`, dropping that ID. `handleSyncPush` then generates a fresh random ID when none is supplied. If the server commits but the response is lost, retry creates a second operation; concurrent drains can do the same.

**Remedy:** Send `item.id` as the cloud operation ID and retain it across every retry. Make server conflict behavior immutable/idempotent: same ID + same payload is a harmless duplicate; same ID + different payload is a conflict, not a silent overwrite. Test timeout-after-commit and duplicate concurrent requests.

#### 6. Due-card hydration mishandles the canonical compressed BYTEA field
**Evidence:** `tools/migrate_to_neon.py:~355` defines `terms.content_blob BYTEA NOT NULL`; `kiroku_dictionary/schema.py:~95` writes zlib-compressed JSON. Other Worker lookups correctly select `encode(content_blob, 'base64')` and call `decompressBlobBase64` (`worker/index.js:717-730, 779+`). But `/api/user/progress/vocab/due` selects raw `content_blob` and calls `JSON.parse(canonical.content_blob)` (`worker/index.js:3526-3570`). A raw BYTEA value is not the uncompressed JSON string, so meanings will generally fail to hydrate and fall back to the term.

**Remedy:** Select `encode(content_blob, 'base64') AS blob_base64`, decode/decompress with the same tested helper used by dictionary lookup, and add a fixture using actual zlib-compressed bytes. Keep a regression test asserting the returned meaning, not merely expression and reading.

#### 7. Progress sync silently reports success after failed writes and is not retry-idempotent
**Evidence:** `worker/index.js:3584-3720`. Vocab/kanji/grammar writes catch and discard SQL errors; counters are incremented even if `queryTurso` returns null. Daily counters use additive upserts, and anime mined-card counts are additive. Retrying a request after a timeout can double-count daily activity/mined cards; Kanji review_count increments by one on every retry regardless of the supplied count. The route returns `ok: true` even for partial/zero persistence.

**Remedy:** Add a client-generated batch/event ID and a per-user idempotency ledger; apply each event once in a transaction/batch. Validate all records before writing, use batch pipeline/transaction semantics where available, report partial failures accurately, and do not increment synced counters until persistence is confirmed. Make stale-device updates deterministic (timestamp/version comparison) for vocab, grammar, and anime position.

#### 8. Token-bearing OAuth redirect is exposed in a URL and accepts any localhost port
**Evidence:** `worker/auth.js:249-280, 315-330, 400-490, 520-590`. The desktop JWT is placed in query parameters (`token`, `sub`, `email`, `name`). `isAllowedRedirect` accepts any port on `localhost` or `127.0.0.1` as long as the path is `/` or `/auth/callback`. This is not an external open redirect to an arbitrary Internet host, but it is a local callback interception/token exposure surface if a malicious local process or induced OAuth flow controls a listener on another loopback port. Query tokens can also land in browser history and diagnostic logs.

**Remedy:** Prefer Authorization Code + PKCE with a desktop-owned one-time verifier and a custom app protocol or authenticated local POST callback. If retaining loopback, bind the redirect to the exact listener/port and one-time challenge issued by the desktop, send the token in a POST body rather than the URL, and ensure it is never logged. Keep the existing state check.

#### 9. Long-lived extension token KV implementation is not bound in the Worker config
**Evidence:** `worker/auth.js:33-80` supports `USER_TOKENS_KV`, but `wrangler.toml` contains no `[[kv_namespaces]]` binding. Without that binding, tokens fall back to isolate-local Maps. Cloudflare isolates are ephemeral and not shared, so a token minted in one isolate may not validate in another or after restart.

**Remedy:** Provision and bind a KV namespace (or use a durable database-backed hashed token table). Store only a hash of the bearer token where feasible, support expiry/revocation, and add tests that mint and verify across distinct Worker instances.

#### 10. Static service API keys become a global user identity
**Evidence:** `worker/auth.js:193-227`. Any configured `CLOUD_QUEUE_API_KEY`, `SUBMIT_TOKEN`, or `PHONE_SECRET` is accepted by the common `authenticateRequest` function and becomes `sub: 'api-client'`. Because this helper is reused by user-progress and sync routes, a service key can access user-data routes as a shared identity rather than being restricted to its intended service endpoints.

**Remedy:** Separate service authentication from user authentication. Scope service credentials to exact routes/operations and reject them on learner progress, bookmarks, attempts, and other user-owned data. Prefer separate keys and explicit roles/scopes.

#### 11. Extension offline queue silently drops old cards at its 500-item cap
**Evidence:** `extension/background.js:20-40` appends to `kiroku_pending_cards` and removes the oldest entries when length exceeds 500. That directly violates the claimed zero-card-loss invariant.

**Remedy:** Do not evict unacknowledged operations. Use IndexedDB or another durable queue with bounded storage checks; when storage is exhausted, stop accepting captures and show a clear error/export option. Track explicit terminal failures separately from pending operations.

#### 12. Concurrent extension drains can race and overwrite queue state
**Evidence:** `extension/background.js:42-86` reads the whole queue, processes it, then writes a replacement array. There is no single-flight lock or per-item atomic claim. Multiple tabs/service-worker events can drain the same item and later overwrite each other's remaining arrays.

**Remedy:** Add a service-worker single-flight guard plus durable per-item states/leases in IndexedDB. Update/delete only the exact acknowledged IDs, never replace the entire queue from a stale snapshot. Test simultaneous drain calls and enqueue-during-drain.

### P2 — Important reliability, security, and performance work

#### 13. Alias sync routes bypass the configured rate limiter
**Evidence:** `worker/index.js:74-82` rate-limits `/api/sync/*`, but the same handlers are also mounted at `/sync/push`, `/sync/pull`, and `/sync/ack` (`3425-3430`). The extension currently calls `/sync/push`, so it bypasses that middleware. Authentication still runs in the handler, but rate limiting does not.

**Remedy:** Apply rate limiting to both route prefixes (or use one canonical prefix and remove aliases). Add a test proving equivalent limits on both paths.

#### 14. Turso schema initialization does not inspect individual DDL pipeline errors
**Evidence:** `worker/turso.js:176-205`. The batched schema initializer treats any HTTP 2xx as complete and sets `schemaInitialized = true` without inspecting each result. Its sequential fallback logs individual failures and still sets the flag. A partially created schema can therefore be cached as initialized for the isolate.

**Remedy:** Inspect every pipeline result for statement errors; mark initialized only when all required DDL succeeds. If fallback is used, propagate failures and allow a later retry. Add a mock response with HTTP 200 and one DDL error.

#### 15. The legacy TursoQueueAdapter leases and acknowledges without user scoping
**Evidence:** `kiroku_cloud_queue/turso_adapter.py:100-169, 171-224`. `fetch_pending(user_id=None)` omits the user filter by default; claim, ack, and nack predicates use `id` but not the composite `(user_id,id)` key. The queue adapter factory can select this adapter for `QUEUE_BACKEND=turso` (`queue_adapter.py:652-675`). In a multi-user database this is a global consumer, not a tenant-scoped consumer.

**Remedy:** Require a user/tenant ID in the adapter constructor and every queue operation. Select and carry both keys; include both in claim/ack/nack predicates. If the intended model is one shared consumer, explicitly authorize it as a service role and route each item to its owning local account rather than treating it as the currently signed-in user.

#### 16. Desktop pull is an unleased competing-consumer queue, not a multi-device change feed
**Evidence:** `handleSyncPull` selects all unacked records for a user; ack marks the shared row globally. Two desktops for the same user can race, and the first ack prevents the second from receiving that operation. This is acceptable only for a single active desktop consumer, not multi-device replication.

**Remedy:** Decide the product semantics. For multi-device sync, use per-device cursors/ack state or a durable event log with consumer-specific offsets. For a single desktop only, document and enforce a single consumer lease.

#### 17. Per-item progress writes create avoidable Turso roundtrips
**Evidence:** `worker/index.js:3608-3708` executes one HTTP pipeline request per vocab, kanji, and grammar item, sequentially. A batch of 200 reviews can cause hundreds of edge-to-Turso requests.

**Remedy:** Validate and normalize the batch, then send bounded pipeline batches (e.g. 50–100 statements) or a single transactional batch where supported. Preserve per-item error visibility and idempotency. Keep the due query index `(user_id,due_at)`, which is appropriate for the current filter/order pattern.

#### 18. Bookmark insertion is not idempotent
**Evidence:** `worker/index.js:3039-3062` performs a plain INSERT with no conflict handling. Repeated clicks/retries can create duplicate bookmarks if the table does not enforce a unique key.

**Remedy:** Add a unique constraint on `(user_id, question_id)` and use `ON CONFLICT DO NOTHING`. Return whether the row was newly inserted.

#### 19. Auth cookie parser can throw on malformed percent encoding
**Evidence:** `worker/auth.js:180-191` calls `decodeURIComponent` on cookie values without a local catch. A malformed Cookie header can turn an auth check into an exception/500.

**Remedy:** Catch decode errors per cookie and ignore malformed values. Add malformed-cookie regression tests.

#### 20. Rate limiter is isolate-local and therefore not a production-wide limit
**Evidence:** `worker/index.js:20-51` stores buckets in a module-level Map. Cloudflare can run multiple isolates/regions and discard them independently, so the 30/minute threshold is best-effort per isolate, not per IP globally.

**Remedy:** Use Cloudflare Rate Limiting binding or a durable distributed limiter for sensitive auth and write endpoints. Keep local memory only as a secondary burst guard.

#### 21. Neon hydration and SQL-over-HTTP behavior are only mock-tested
**Evidence:** `queryNeon` sends `{ query, params }` to the Neon SQL HTTP endpoint; the hydration test mocks a string JSON `content_blob` and therefore misses the actual BYTEA/zlib representation. The current test does not validate real array parameter encoding for `ANY($1::bigint[])`.

**Remedy:** Add an integration test against a disposable Neon branch or a contract-faithful HTTP fixture that includes array parameters and BYTEA output. For 200 IDs, current payload size is likely modest; the main risk is type/serialization correctness, not the raw parameter count. Chunk only if measured payload/latency requires it.

#### 22. Neon/Worker catalog query/index coverage needs migration parity checks
**Evidence:** `tools/migrate_to_neon.py` defines a primary key on `terms.id` and indexes `term`, `reading`, `norm_term`, and `norm_reading`; the hydration lookup on `id` is backed by the primary key. The Turso due query is backed by `idx_uvp_user_due(user_id,due_at)`. These two access paths are sensibly indexed. However, the handover's table names and current Worker SQL are not fully aligned (the Worker also queries `jlpt_vocab`, `kanji`, `grammar_index`, and other tables), so deployment schema parity remains a separate release check.

**Remedy:** Maintain a checked-in canonical migration/schema manifest and run schema-drift checks against a disposable database in CI. Verify every Worker query's table/column/index dependencies against the deployed Neon schema before release.

## Answers to the handover's four explicit questions

1. **JWT / OAuth redirect exfiltration:** No arbitrary external-host redirect was found in `isAllowedRedirect`; it is restricted to loopback hosts and two paths. However, accepting any loopback port and placing the JWT in query parameters leaves a local callback interception and URL leakage surface. Use PKCE/one-time challenge and POST delivery.
2. **Concurrent push / ON CONFLICT:** The composite primary key `(user_id,id)` is a good uniqueness boundary, but updating payload on conflict is not sufficient for idempotency when payloads differ. The extension currently drops its stable queue ID, so retries generate new IDs. Preserve IDs, reject payload mismatches, and make writes durable before acknowledging.
3. **Turso indexing / quota:** The due-review index `(user_id,due_at)` matches the due query. Composite primary keys cover user+vocab/kanji/grammar point lookups. The larger performance problem is sequential per-record HTTP roundtrips and missing batching, not the current due index. Add workload-based EXPLAIN/query metrics before adding more indexes.
4. **Neon hydration / 200 IDs:** A 200-element bigint array is not inherently excessive. The concrete defect is that the selected BYTEA is parsed as JSON without base64 decoding and zlib decompression. Add a real BYTEA/array contract test; chunking is secondary unless measurements show a limit.

## Verification performed

| Area | Command | Result |
|---|---|---:|
| Worker edge, auth, progress, hydration, Turso schema | `node --test worker/tests/edge_user_sync.test.js worker/tests/turso_user_progress.test.js worker/tests/worker_edge.test.js` | **53 passed, 0 failed** |
| Extension offline queue and API security | `node --test extension/tests/extension_cloud_sync.test.js extension/tests/kiroku-api-security.test.js` | **7 passed, 0 failed** |
| Cloud queue / Postgres / Turso / worker / Anki mirror | `python -m pytest -q kiroku_cloud_queue/tests` | **125 passed, 10 skipped** |
| Desktop filtered auth/token glob | `node --test --test-concurrency=1 desktop/tests/auth*.test.js desktop/tests/*oauth*.test.js desktop/tests/*token*.test.js` | **7 passed, 0 failed** (glob matched design-token tests; no dedicated OAuth test file matched) |

**Important test limitation:** Worker tests use mocked fetch/Turso/Neon responses. They establish current handler behavior under those fixtures, not production database correctness, concurrency guarantees, or deployed secret/binding configuration. No live production writes were performed.

## Suggested remediation order

1. Enforce auth-derived identity on attempts/bookmarks and remove the shared guest subject.
2. Make sync push fail closed; preserve extension operation IDs; fix timestamp keyset pagination.
3. Make progress sync idempotent and surface partial persistence failures.
4. Fix BYTEA/zlib hydration and add realistic fixtures.
5. Secure desktop OAuth callback delivery and configure persistent token storage.
6. Remove silent queue eviction and add atomic extension drain coordination.
7. Scope the Turso queue adapter; decide single-consumer vs per-device sync semantics.
8. Fix rate-limit aliases, schema-init error handling, and batch progress writes.
9. Add production-like integration tests and deployed schema/binding checks.

---
**Audit boundary:** This report is based on source inspection and the focused tests listed above. It is not a penetration test of deployed Cloudflare/Neon/Turso accounts, and it does not claim that uninspected external dashboard settings or secrets are configured correctly.
