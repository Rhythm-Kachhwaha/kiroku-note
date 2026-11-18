# Kiroku Note — Cloud, Auth, Extension & Desktop Audit

**Date:** 2026-11-18  
**Repository:** D:\Python\AnkiMiner  
**Scope:** Cloudflare Worker, OAuth/authentication, Turso, Neon hydration, Chromium extension, Electron auth/IPC/storage.  
**Git commands:** None.  
**Source files modified:** None.

## Executive verdict

**Not release-ready.** The inspected code contains sync correctness/data-loss risks and security issues. Passing tests do not eliminate these issues. No claim of 100% proof is possible from a source-level audit or mocked tests.

## Priority findings

| ID | Severity | Finding | Files / area | Remedy |
|---|---|---|---|---|
| S1 | Critical | Progress event deduplication is a check-then-act race; writes are not atomic. Concurrent retries can double-increment kanji/daily counters. Partial category failure can still return ok:true. | worker/index.js, /api/user/progress/sync | Reserve event ID and apply all event mutations atomically. Return explicit all-or-nothing/per-operation outcomes. |
| S2 | Critical | Op-log conflict overwrites payload for an existing (user_id,id) without checking content or resetting ack. A changed operation can remain ack=1 and never be pulled. | worker/index.js, handleSyncPush, handleOplogWrite | Immutable ID/payload semantics. Same payload = duplicate success; different payload = 409. Inspect every Turso pipeline result. |
| S3 | High | Extension queue uses asynchronous read-modify-write and can lose concurrent appends. Queue cleanup can remove a new same-ID entry created while drain is in flight. | extension/background.js | Transactional queue (prefer IndexedDB), immutable queue-entry identity, delete only exact accepted versions. |
| S4 | High | isAllowedJimakuUrl permits arbitrary HTTPS hosts after local-IP checks. FETCH_JIMAKU_API forwards caller-provided API key and method to that host. | extension/background.js | Strict host allowlist; Jimaku key only to Jimaku; GET-only downloads; timeout, response-size and redirect checks. |
| S5 | High | Subtitle track name/label is inserted into innerHTML without escaping. | extension/content/anime-hud.js | Create DOM nodes and assign external labels using textContent. Check all equivalent track renderers. |
| S6 | High | Desktop OAuth receives seven-day bearer JWT in loopback URL query. | worker/auth.js, desktop/src/main.js | Use short-lived single-use authorization code and state-bound exchange. Add no-store/no-referrer callback headers. |
| S7 | High | encryptToken returns plaintext if safeStorage is unavailable or encryption fails; the token is persisted by DesktopStore. | desktop/src/main.js, desktop/src/store.js | Fail closed or use OS credential manager. Never silently persist plaintext credentials. |
| S8 | High | handleSyncPull combines ack=0 with since_cursor; a client that advances cursor before all fetched rows are acked can strand older unacked rows. | worker/index.js | Lease/ack protocol or cursor semantics that never skip unacknowledged work. Test interrupted imports. |
| S9 | High | Some write paths inspect only HTTP success, not per-statement pipeline results; progress sync can report partial success as success. | worker/index.js | Validate each statement result, expose partial IDs, and make transaction boundaries explicit. |
| S10 | Medium | schemaInitialized is a module-global boolean, not associated with database identity. | worker/turso.js | Scope initialization by DB URL/schema version or guarantee one immutable binding per isolate and test it. |
| A1 | High | OAuth shared state/redirect cookies can race across concurrent login attempts. | worker/auth.js | Per-transaction state storage and state-bound redirect metadata. |
| A2 | Medium | User shortcut tokens fall back to isolate-local Maps when KV is not bound; non-durable across isolate/restart. KV is commented in repo Wrangler config (dashboard binding not verified). | worker/auth.js, wrangler.toml | Ensure durable KV/DB binding exists in deployed environment; test issuance under concurrency and rotation. |
| A3 | Medium | Logout clears cookie but does not revoke bearer JWT. | worker/auth.js | Token version/revocation or short-lived access + refresh design. |
| A4 | Medium | JWT validation lacks issuer/audience/token-purpose checks; expiry comparison permits the exact expiry second. | worker/auth.js | Validate iss, aud, iat, exp, token purpose, and use now >= exp. |
| D1 | High | Loopback OAuth page interpolates provider error text into HTML; body size is unbounded. | desktop/src/main.js | Escape/render as text; cap body bytes and validate content type/fields. |
| D2 | Medium | Desktop API proxy spreads renderer-provided headers over the main-process Authorization header. | desktop/src/api_proxy.js | Header allowlist; reserve Authorization/Host/Content-Length for main process. Add request/response size limits. |
| D3 | Medium | DesktopStore rewrites JSON directly and swallows save failures. | desktop/src/store.js | Atomic temp-file + rename, restrictive file permissions, propagate errors. |
| E1 | High | Extension injects scripts into all URLs/all frames; MAIN-world fullscreen hook also runs broadly. | extension/manifest.json | User-controlled global capture mode, optional host permissions and narrower MAIN-world injection. |
| E2 | Medium | Sudachi pending state represents a whole subtitle sentence as one token. | extension/content/video-mining.js | Render plain text until actual tokens arrive; retain caret-position fallback. Bound token cache. |
| E3 | Medium | YouTube bridge has permanent 500ms polling and repeated subtitle probes. | extension/content/adapters/youtube-bridge.js | Navigation-driven detection, retry backoff and request correlation/rate-limiting. |
| E4 | Medium | Video overlay delayed timer cleanup needs consistent cancellation. | extension/content/video-mining.js | Own all timer handles and clear them on unmount/player replacement. |
| E5 | Medium | Subtitle fetches lack bounded timeout/response size. | extension/background.js | Abort timeout, cap bytes, validate content type and redirects. |

## Sync and data correctness details

### Progress sync

/api/user/progress/sync checks event_id first, mutates rows, then inserts the event marker. Concurrent identical events can both pass the check. Kanji review_count and daily activity use increments, so duplicate application changes totals. The endpoint returns ok:true if any progress category succeeds, even when others fail. There is also unreachable duplicate response code after the main return.

**Required fix:** transactionally claim an event and write all event effects together; ensure retry returns the prior result without reapplying. Validate array sizes, numeric fields, identifiers and timestamps.

### Op log and queue

handleSyncPush and handleOplogWrite conflict behavior mutates existing payloads. handleOplogWrite direct pipeline path checks only res.ok, not statement results. handleSyncPush processes operations serially. handleSyncAck sends one query per ID. The extension queue sends cards serially, potentially spending 3 seconds on each offline local request before trying cloud. kiroku-api.js direct cloud fallback should also be checked for stable operation IDs and response-body validation.

**Required fix:** stable UUID at first capture; batched transactional push/ack; per-ID success; no deletion without explicit acceptance; transactional local queue; bounded batch sizes.

### Cursor behavior

An unacked record can become permanently older than a persisted since_cursor after a page is fetched and the desktop fails to acknowledge every item. Pull/ack pagination must be redesigned or cursor state must be advanced only after all prior records are safely imported and acknowledged.

## Auth and desktop details

- isAllowedRedirect() constrains OAuth redirect hosts to localhost/127.0.0.1 and paths / or /auth/callback; no ordinary external open redirect or external SSRF was evidenced in this path.
- The bearer token in the loopback URL remains a local-exposure risk.
- OAuth uses shared cookies for state and redirect metadata; simultaneous flows can overwrite each other.
- Shortcut token Maps are isolate-local if KV is absent. The checked wrangler.toml comments out the KV declaration; a dashboard binding may still exist and must be verified.
- safeStorage fallback persists raw token in the desktop JSON store.
- api_proxy.js validates path/method but allows caller headers to override trusted headers.
- DesktopStore.save() writes directly to the target file and returns false on errors without propagating them.

## Database architecture and performance

### Positive foundations

- Turso user tables generally use user-first composite primary keys.
- user_vocab_progress has (user_id,due_at) index matching due-review filtering/order.
- Hydration uses one Neon ANY($1::bigint[]) query for up to 200 IDs; this is a sound shape and avoids per-vocabulary N+1 queries.

### Mismatches and optimization

1. user_study_cards.term_ref is TEXT and cloud handleSaveCard writes the raw expression, not a canonical vocabulary ID. This contradicts the stated normalized-reference model.
2. handleSaveCard accepts several card fields but its Turso upsert persists only term reference and custom sentence, then returns the larger object as though it were saved.
3. Neon hydration selects both encode(content_blob,'base64') and content_blob, transferring the payload twice. Return one representation only.
4. Grammar analysis downloads/scans the full grammar_index on every sentence. Cache versioned immutable data or build an indexed matcher (trie/Aho–Corasick) and cap sentence length.
5. Op-log pull ordering may need (user_id,ack,created_at,id) index evaluation. Lease filters should be checked against real query plans before adding more indexes.
6. Queue push/ack and progress sync have serial Turso roundtrips. Batch where safe and use transactions for correctness.
7. Token hydration decompression is sequential; use bounded concurrency only after measuring Worker CPU/memory and payload sizes.
8. Rate limiter is a per-isolate Map, not a global rate limiter. It can be bypassed across isolates and requires expiry/capacity management. Use Cloudflare rate limiting or a durable shared mechanism.

**Not verified against live service:** Turso/Neon schema, deployed KV bindings, query plans, real payload sizes, real latency, Cloudflare deployment secrets and live endpoint behavior. The ANY(bigint[]) syntax is source-reviewed and mock-tested, not live-driver verified.

## Extension specifics

- manifest.json: <all_urls>, all_frames, match_about_blank, broad MAIN-world fullscreen injection and clipboardRead permission create a broad attack surface. Preserve general mining only with clear user opt-in and minimize MAIN-world coverage.
- background.js: queueCardLocally() is an asynchronous read-modify-write race; drain deletion by ID can remove a newer record; serial per-card drain is slow. Existing max-queue cap avoids silent eviction and should remain.
- isAllowedJimakuUrl() rejects selected local IP patterns but accepts arbitrary HTTPS hosts. Do not forward Jimaku Authorization to CDN URLs.
- anime-hud.js: subtitle track metadata is interpolated into HTML.
- video-mining.js: one whole-sentence token is used while Sudachi is pending; cache growth and timer cleanup need attention.
- youtube-bridge.js: 500ms perpetual interval and repeated probes are avoidable.
- hud-popup.js: inspected dynamic word/sentence paths generally escape inserted content; not classified as confirmed XSS in this audit.
- Fetches for subtitle acquisition need abort deadlines and content-size bounds.

## API contracts / placeholders

Several Worker fallback endpoints are placeholders rather than durable implementations: learner GET returns fixed N3 defaults, learner PUT echoes the submitted body, known-words routes return empty data or success without persistence, grammar stats/setup-check/encounters return fixed synthetic responses, and Anki status/decks return disconnected/empty results. Ensure clients do not interpret these responses as genuine persisted cloud state.

The grammar analyzer has a basic string-match fallback and returns empty points on exception; it should not be represented as equivalent to the full local grammar analysis backend without explicit degraded-mode signaling.

## Test results

Commands executed from D:\Python\AnkiMiner (no Git commands):

- node --test worker/tests/*.test.js — **59 passed, 0 failed**. These are mocked/harness tests, not live cloud database tests.
- node --test extension/tests/*.test.js — **exit code 1**. Failures include backend-port centralization, customizable layout, dictionary-study-view, HUD sentence/popup behavior, interactive sandbox, OCR background routing and video-tab selector checks. Some tests appear stale relative to current markup or lack browser APIs/mocks; the OCR test specifically failed because its VM context had no fetch. The video-token tests assert a contract that differs from the current pending-token fallback and expose a real usability issue.
- node --test desktop/tests/*.test.js — **exit code 1**. Numerous Anime view tests and API/OpenAPI contract tests fail. Some appear to inspect an older layout/source contract; the API contract and lifecycle failures require investigation against current backend and packaging state. This is not a clean suite.

The test suites use mocks and static contracts. No real Google/GitHub OAuth, Cloudflare production deployment, live Turso, live Neon, multi-device stress, real Chrome profile, or packaged Electron end-to-end test was completed.

## Fix order before release

1. S1/S2: Make progress and op-log event processing atomic and idempotent.
2. S3/S8/S9: Repair extension queue and pull/ack correctness; test crashes, concurrent captures and duplicate requests.
3. S4/S5: Close the subtitle credential egress path and HTML injection.
4. S6/S7/D1/D2: Harden OAuth callback transport, token persistence and IPC headers.
5. Fix extension tokenization fallback, lifecycle and YouTube polling.
6. Correct placeholder API contracts and Neon payload duplication.
7. Run live Turso/Neon EXPLAIN and latency tests, plus real multi-device and browser/desktop integration tests.
8. Re-run the full extension and desktop suites and repair or explicitly retire stale tests.

## Release gate

Do not label these folders fully fixed until all Critical/High findings are addressed, regression tests cover the failure modes, the extension and desktop suites pass (or stale tests are deliberately updated with evidence), and live integration checks validate deployed bindings and database behavior. “100% foolproof” cannot be guaranteed; the practical standard is explicit threat modeling, tested invariants, and monitored failure recovery.
