# Scenario checklists per module

Adapt each line to the contract: make it concrete, with an observable pass condition.
Items marked (seen) are failure classes that actually occurred in this project's history.
Target 8–15 relevant scenarios. Never invent scenarios just to satisfy a minimum count.

## Contents
db, cloud-auth, sync, extension, ankiconnect, desktop, smoke (end-to-end)

---

## db

- Fresh DB: all migrations run from empty; schema matches the contract.
- Upgrade: DB from the previous released version migrates without data loss.
- Migrations are idempotent (run twice — no error, no duplicate rows/columns).
- Failing statement inside a transaction rolls back everything (no half-applied state).
- Constraints: unique keys, NOT NULL, foreign keys actually enforced.
- Tenant isolation: user A's query can never return user B's rows (test every read path that takes a user id).
- Backup then restore yields identical row counts and checksums.
- Concurrent writers (two connections) do not corrupt or deadlock; WAL mode where used.
- Large row/payload and empty/NULL/unicode/emoji text round-trip unchanged.
- Schema creation is NOT run on every request (cold-start cost, repeated DDL).

---

## cloud-auth (worker, OAuth, tokens)

- Login completes from each client: web, extension, desktop. Response carries every credential the client needs. (seen: two Set-Cookie headers where the second replaced the first)
- Authenticated request works with cookie, with Bearer, and rejects with neither.
- Expired token → 401, client clears session; refresh/renewal path works.
- Forged/tampered JWT rejected; JWT signed with the repo's default/dev secret rejected in production mode. (seen: default secret fallback in verification)
- Missing secret/env var in production fails closed (503/401), never falls back to a dev identity. (seen: shared dev_user fallback)
- Revoked token rejected on the next request; logout invalidates server-side.
- OAuth state/CSRF: missing or mismatched state rejected; auth code single-use; code expires; PKCE verifier checked if stored.
- Redirect allowlist: arbitrary redirect_uri rejected; known extension/desktop/web redirects accepted.
- CORS: disallowed origin gets no credentialed CORS headers; every method the clients use (incl. PATCH) is allowed. (seen: reflect-any-origin with credentials)
- User ids are provider-namespaced; same person on two providers is handled deliberately.
- Per-user isolation on every authenticated route: user A cannot read/write user B's data; service credentials cannot act as a user. (seen: global unauthenticated in-memory caches)
- Rate limit: per-user budget does not block normal sync volume; auth endpoints still limited.
- Cold isolate/multi-instance: flows that rely on in-memory state still work when two requests hit different instances.

---

## sync

- Push one card → pull on a second device → appears exactly once.
- Push response reports success iff rows were actually written; failure returns non-2xx. (seen: success committed but 500 returned)
- Idempotency: same batch pushed twice creates no duplicates and no error.
- Edit propagates: a changed card (same identity) updates the cloud copy and other devices (last-writer-wins by updated_at). (seen: ON CONFLICT DO NOTHING dropped edits)
- Delete propagates as a tombstone; a stale device does not resurrect a deleted card.
- Per-device cursors: device B still receives a card after device A has pulled it. (seen: global ack consumed ops)
- A device does not re-download its own pushes.
- Offline queue: cards saved offline sync later, in order, without loss; a permanently failing item is dead-lettered, not retried forever.
- Large backlog (1,000 cards): completes with no 429/413, request count and wall-time under agreed budgets (record them).
- Payload over the size limit is split or rejected clearly, never stalls the same batch repeatedly.
- Pagination: has_more/cursor cover boundary cases (page exactly full, identical timestamps, empty).
- Clock skew between devices does not lose or reorder edits.
- Auth expiry mid-sync: stops cleanly, resumes after re-login, no partial duplicate state.

---

## extension (MV3)

- Fresh install: first-run state sane; no errors in the service worker console.
- Login from side panel completes and the token is stored under the single agreed key; UI shows signed-in state.
- Expired/invalid stored token detected on open (validated against /auth/me), UI returns to signed-out.
- Service worker is killed and restarted mid-task: pending work and auth state survive (nothing important only in memory).
- Save card with desktop backend on, off, and slow: exactly one card results; offline queue drains later. (seen: double-write to local and cloud)
- Message passing: every message type in the contract gets a response (including error responses); no unhandled promise rejections.
- Content script on a page with strict CSP, in an iframe, and with the site's own key handlers: selection capture still works.
- Permissions in manifest match what the code uses; no host permission broader than needed.
- Storage quota/limit: behaviour when approaching the limit is defined (drop oldest or block new, never silent corruption).
- Sidepanel module files remain separate (never merged/bundled into a monolith). (Kiroku: NEVER MERGE SIDEPANEL rule)
- Background service worker message handler covers all message types listed in the contract with no unhandled case.

---

## ankiconnect

- AnkiConnect available: card pushed → note created with correct deck, model, fields, tags.
- AnkiConnect unavailable: error returned clearly, card queued locally, no crash.
- Duplicate note: handled per configured policy (skip/update/error); behaviour matches contract.
- Large media attachment (audio/image): uploaded correctly or rejected with a clear error.
- Field mapping: every field in the contract maps to a valid Anki field; missing/renamed Anki field returns a clear error.
- Tag normalisation: Japanese/unicode tags round-trip unchanged.
- Retry logic: a transient AnkiConnect failure retries the configured number of times then dead-letters, not retries forever.

---

## desktop (Electron shell)

- App launches cold: window appears, no uncaught exceptions in main or renderer console.
- DB file missing on launch: created fresh with correct schema (not a crash).
- DB file corrupted on launch: error surfaced to user, not a silent hang.
- IPC: every channel in the contract has a handler; unrecognised channels return an error, not silence.
- Local-first save: card saved with no network → persisted in local DB → confirmed in UI.
- Sync triggered: local queue flushed to cloud, UI shows synced state.
- Offline mode: app usable with no network; sync queued; no crash or freeze.
- Update/restart: app can be relaunched without DB migration errors.
- Window state (size, position) persisted and restored across restarts.
- Fonts and animations defined in `final.md` are not altered. (Kiroku: final.md lock rule)

---

## smoke (end-to-end, cross-module)

Run after all modules are frozen. Each item exercises a full user journey.

- New user: register → login → save first card → open in Anki.
- Return user: login on a second device → all previous cards appear.
- Edit card: change on device A → sync → updated on device B.
- Delete card: delete on device A → sync → gone on device B (tombstone).
- Offline save: save card offline → go online → card syncs, appears in Anki.
- Session expiry: token expires mid-use → user prompted to re-login → work resumes.

