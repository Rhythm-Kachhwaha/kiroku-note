# iPhone Shortcut → Cloud Queue → Kiroku → Anki Pipeline Implementation Plan

> **Goal:** Complete the end-to-end pipeline allowing an iPhone Shortcut to submit Japanese vocabulary cards via `text/plain` POST to an authenticated cloud queue service, durably storing jobs in a persistent database (PostgreSQL/SQLite) with leases and idempotency, drained by a local Windows worker into Kiroku and Anki (`N3 vocabs` deck).

## Architecture Diagram

```mermaid
graph TD
    subgraph "iPhone Capture"
        A[ChatGPT Japanese Word / 保存] -->|Copy JSON| B[iOS Shortcut]
        B -->|POST text/plain or JSON + Bearer token| C[Cloud FastAPI /submit]
    end

    subgraph "Cloud Service (Cloud Run / VPS)"
        C -->|Validate & Deduplicate| D[(Persistent Queue: Postgres / SQLite)]
        D -->|Lease Claim & Timeout| E[GET /pending]
        F[POST /ack or /nack] -->|Commit State Transition| D
    end

    subgraph "Local Windows PC"
        G[Local Worker: worker.py] -->|Outbound HTTPS Poll| E
        G -->|Save Card with sentence_meaning| H[Local Kiroku API: port 21828]
        H -->|Check Duplicates & Save| I[(SQLite: kiroku.db)]
        H -->|Sync Note| J[AnkiConnect: port 8765]
        J -->|Add Note to 'N3 vocabs'| K[Anki Desktop]
        G -->|Confirm Success| F
    end
```

## Global Constraints
- Directory: Strictly inside `D:\Python\AnkiMiner\kiroku_cloud_queue\` (and `PROGRESS.md` at root).
- Target deck: `N3 vocabs`.
- Content-Types supported on `/submit`: `text/plain` (iPhone Shortcut default) and `application/json`.
- Required card fields: `expression`, `reading`, `meaning`, `sentence`, `sentence_meaning` (non-empty strings, exact Japanese Unicode preserved).
- Auth: Constant-time Bearer token validation with separate phone and worker tokens supported.
- Leases: Atomic claims with configurable timeouts (e.g. 60s) so crashed workers do not lock items.
- Duplicate policy: Local duplicate cards in Kiroku are safely acknowledged without creating duplicate Anki notes.
