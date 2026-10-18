# kiroku_cloud_queue — iPhone Shortcut → Cloud Queue → Kiroku → Anki Pipeline

A resilient, local-first pipeline for capturing Japanese vocabulary cards from ChatGPT on mobile (iOS) and synchronizing them into your local Anki collection via Kiroku.

**Strict isolation guarantee**: This directory is 100% standalone. It communicates with Kiroku only through documented HTTP API endpoints (`POST /api/cards/save`, `POST /api/cards/{id}/sync`) over loopback. It does not modify any core Kiroku source files, schemas, or databases.

---

## 1. Architecture & End-to-End Workflow

```
[iPhone: iOS 18.6 Shortcut]
   │  1. Double-tap back triggers Shortcut
   │  2. Reads clipboard (produced by ChatGPT '保存' command)
   ▼
[Cloud FastAPI Server: POST /submit]  (Cloud Run / VPS / Local Dev)
   │  3. Validates Bearer token (SUBMIT_TOKEN)
   │  4. Accepts text/plain or application/json (max 64KB)
   │  5. Computes stable SHA-256 idempotency key
   ▼
[Durable Persistent Queue: Postgres / SQLite]
   │  6. Commits card to 'queued_cards' table (status: 'pending')
   │  7. PC can remain offline while cards accumulate
   ▲
   │  8. Worker claims batch with 60s recoverable lease (status: 'claimed')
[Windows Local PC Worker: worker.py]
   │  9. Maps card fields including 'sentence_meaning' -> 'example_translation'
   ▼
[Local Kiroku Backend: port 21828]  (POST /api/cards/save)
   │ 10. Persists card to local SQLite (kiroku.db)
   │ 11. Triggers sync via AnkiConnect (POST /api/cards/{id}/sync)
   ▼
[Local Anki Desktop: port 8765]
   │ 12. Adds note to target deck: 'N3 vocabs'
   │ 13. Resolves duplicates safely without creating double notes
   ▼
[Cloud Queue Ack]  (POST /ack/{item_id} with claim_token)
   14. Card state transitions to 'completed' in durable storage
```

---

## 2. Confirmed iPhone Shortcut Setup

Tested and verified on iOS 18.6 with ChatGPT Go:

1. **In ChatGPT**: After studying Japanese, enter `保存`. ChatGPT outputs a JSON vocabulary card.
2. **Copy JSON**: Copy the JSON block to the iOS clipboard.
3. **Double-Tap Back**: Trigger the iOS Shortcut via Back Tap (`Settings` → `Accessibility` → `Touch` → `Back Tap` → `Double Tap`).

### Shortcut Action Configuration
- **Action 1**: `Get Clipboard`
- **Action 2**: `Get Contents of URL`:
  - **URL**: `https://<YOUR-CLOUD-ENDPOINT>/submit`
  - **Method**: `POST`
  - **Headers**:
    - `Authorization`: `Bearer <YOUR_SUBMIT_TOKEN>`
  - **Request Body**: `File`
  - **File**: `Clipboard` (iOS automatically transmits this as `Content-Type: text/plain`)

### Vocabulary Card JSON Payload
```json
{
  "expression": "映画",
  "reading": "えいが",
  "meaning": "movie; film",
  "sentence": "昨日、映画を見た。",
  "sentence_meaning": "I watched a movie yesterday."
}
```

---

## 3. Cloud API Specification

### `POST /submit` (alias `/enqueue`)
- **Authentication**: `Authorization: Bearer <SUBMIT_TOKEN>`
- **Content-Type**: `text/plain` (default from iOS Shortcut) or `application/json`
- **Max Body Size**: 64 KB (enforced against denial of service)
### `POST /submit` (alias `/enqueue`)
- **Authentication**: `Authorization: Bearer <SUBMIT_TOKEN>`
- **Content-Type**: `text/plain` (default from iOS Shortcut) or `application/json`
- **Max Body Size**: 64 KB (enforced against denial of service)
- **Validation**: Only `expression` is strictly required (non-empty string). The remaining fields (`reading`, `meaning`, `sentence`, `sentence_meaning`) are optional and default to empty strings if omitted. Preserves exact Japanese Unicode without normalization or translation.
- **Idempotency**: Automatic content deduplication via SHA-256 hash. Accidental double-taps reuse the existing queue ID and return `is_duplicate: true`.
- **Response (200 OK)**:
  ```json
  {
    "status": "queued",
    "id": "e9a7e6cf-...",
    "is_duplicate": false,
    "expression": "映画",
    "message": "Card for '映画' successfully queued."
  }
  ```

### `GET /pending?limit=20`
- **Authentication**: `Authorization: Bearer <WORKER_TOKEN>`
- **Semantics**: Atomically claims pending or expired-lease cards using `claim_token` and `lease_expires_at` (default 60s). Protects against multiple workers and crashed instances.

### `POST /ack/{item_id}`
- **Authentication**: `Authorization: Bearer <WORKER_TOKEN>`
- **Body**: `{"claim_token": "..."}`
- **Semantics**: Conditionally transitions status to `completed` if the claim token matches the active lease.

### `POST /nack/{item_id}`
- **Authentication**: `Authorization: Bearer <WORKER_TOKEN>`
- **Body**: `{"error": "...", "claim_token": "..."}`
- **Semantics**: Records failure diagnostic. If attempts reach `MAX_ATTEMPTS` (5), transitions status to `failed` (dead-letter); otherwise returns item to `pending` to be retried.

### `GET /stats`
- **Authentication**: `Authorization: Bearer <WORKER_TOKEN>`
- **Response**: `{"pending": 0, "claimed": 0, "completed": 12, "failed": 0}`

### `GET /health`
- **Public** (no authentication required). Confirms database connectivity without leaking tokens.

---

## 4. Anki Mirror & Cloud Study Endpoints

### Worker Endpoints (`Authorization: Bearer <WORKER_TOKEN>`)
- `POST /api/anki/cards`: Upsert mirrored cards in batches of up to 500 cards.
- `POST /api/anki/daily`: Upsert daily activity and historical reconstructed growth/retention series in batches of up to 1000 days.
- `POST /api/anki/reconcile`: Full card ID list reconciliation. Removes cards deleted from Anki Desktop and cleans orphaned study states.
- `POST /api/anki/meta`: Store sync metadata (timestamps, total cards count, rollover hour).

### Dashboard & Phone Endpoints (`Authorization: Bearer <SUBMIT_TOKEN>` or `<WORKER_TOKEN>`)
- `GET /api/cards`: Browse mirrored cards with search (`q`), filters (`state`, `label`, `deck`, `jlpt`, `due_within`), and sorted server-side pagination (`sort`, `dir`, `limit`, `offset`).
- `GET /api/cards/{card_id}`: Fetch single card detail including all text fields, lapses, reps, again rates, answer times, and interval.
- `GET /api/stats/overview?range=30d|90d|1y|all`: Returns all comprehensive series (growth curve, state breakdown, true retention, answer buttons, due forecast, difficulty distribution, weak words top 20, JLPT coverage, queue activity) in a single fast payload (<25ms).
- `GET /api/anki/status`: Returns mirror sync freshness (`synced_at`), total mirrored card count, and last full reconcile timestamp.
- `GET /api/study/session?mode=weakest|leeches|jlpt|recent|never_practiced|cloud_due|custom&limit=20`: Seed an extra-practice study session.
- `POST /api/study/review`: Record a 5-box Leitner review rating (`rating`: 1=Again, 2=Hard, 3=Good, 4=Easy) with client `review_uuid` idempotency.
- `GET /api/study/summary`: Returns study mode performance (reviewed today, 7d count, box distribution, hardest practiced cards).

---

## 5. Local Windows Worker Configuration & CLI Flags

The local worker runs on your Windows PC and connects outbound over HTTPS to drain cards into Kiroku and sync the Anki card mirror:

1. Configure `.env`:
   ```ini
   QUEUE_BACKEND=cloud
   CLOUD_QUEUE_URL=https://<your-cloud-endpoint>
   CLOUD_QUEUE_API_KEY=<your-worker-token>
   KIROKU_URL=http://127.0.0.1:21828
   ```

2. Run in single-batch mode:
   ```powershell
   .venv\Scripts\python.exe worker.py --once
   ```

3. Run in continuous background polling mode (auto-syncs cards and reviews every 300s):
   ```powershell
   .venv\Scripts\python.exe worker.py --interval 10
   ```

4. Mirror sync CLI flags:
   - `--sync-cards`: Run an incremental Anki mirror sync and exit immediately.
   - `--full-resync`: Force a full reconciliation sync (re-verifies all card IDs and reconstructs daily historical series).

---

## 6. Running Automated Tests

Run the complete isolated test suite:

```powershell
cd D:\Python\AnkiMiner\kiroku_cloud_queue
.venv\Scripts\python.exe -m pytest tests/ -v
```

All 181 tests cover:
- Authentication, security validation, and request body limits
- Payload parsing (`text/plain` and `application/json`), UTF-8 Japanese decoding, error reporting
- Idempotency, deduplication, and atomic lease claims
- Worker draining, Kiroku API mapping, and duplicate handling
- Pure compute functions (field mapping, cleaning, FSRS difficulty scoring, daily series reconstruction)
- Anki mirror worker sync with mock AnkiConnect (full sync, incremental sync, reconciliation, offline handling)
- Dual storage parity (SQLite and PostgreSQL)
- Cards search, filtering, and pagination
- Leitner 5-box cloud study mode transitions, idempotency, and sessions
- Dashboard template HTML/CSS/JS syntax validation via `node --check` and strict zero-emoji assertion
