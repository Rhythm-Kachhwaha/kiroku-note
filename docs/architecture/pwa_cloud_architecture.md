# Kiroku Note PWA & Cloud Queue Architecture

This document describes the end-to-end architecture connecting the Kiroku Note Progressive Web App (PWA), Cloudflare Worker edge router, Turso libSQL edge database, and the local Windows companion worker.

---

## 1. System Topology Overview

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Layer (Mobile PWA & Windows Desktop)"]
        PWA["Mobile PWA (Safari / Chrome)"]
        Desktop["Windows Desktop Companion (Electron)"]
        OPFS["OPFS Manga Cache"]
        OCR["On-Device MangaOCR (WebGPU / WASM)"]
    end

    subgraph EdgeLayer ["Edge Layer (Cloudflare Workers)"]
        CFWorker["Edge Worker (kiroku-pwa)"]
        AuthModule["OAuth 2.0 Guard (JWT + HttpOnly Cookie)"]
        RateLimiter["Token-Bucket Rate Limiter (30 req/min)"]
        MetricsEndpoint["/api/metrics Aggregator"]
        StaticAssets["Static Precaching (App Shell & Offline Fonts)"]
    end

    subgraph EdgeDatabase ["Edge Persistence (Turso libSQL)"]
        OpLog["op_log (Durable Leases, Ack/Nack)"]
        AnkiMirror["anki_mirror & anki_stats"]
    end

    subgraph LocalPC ["Local PC Companion"]
        WorkerPy["Python Worker (kiroku_cloud_queue/worker.py)"]
        SQLiteLocal[(Local SQLite: kiroku.db)]
        AnkiApp["Anki Desktop (:8765 AnkiConnect)"]
    end

    PWA -->|Fetch + Session Cookie| CFWorker
    Desktop -->|Local IPC & Sync| WorkerPy
    PWA --> OPFS
    PWA --> OCR

    CFWorker --> RateLimiter
    RateLimiter --> AuthModule
    AuthModule --> MetricsEndpoint
    AuthModule -->|Direct libSQL Query| OpLog
    AuthModule -->|Direct libSQL Query| AnkiMirror

    WorkerPy -->|Long Poll & Claim Leases| OpLog
    WorkerPy -->|Write Extracted Note| SQLiteLocal
    WorkerPy -->|Push Cards| AnkiApp
    WorkerPy -->|Atomic Ack / Heartbeat| OpLog
```

---

## 2. Authentication & Session Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Learner
    participant PWA as Client (PWA)
    participant Worker as Cloudflare Worker (/auth/*)
    participant OAuth as Identity Provider (Google / GitHub)

    User->>PWA: Click "Sign in with Google / GitHub"
    PWA->>Worker: GET /auth/google
    Worker->>OAuth: Redirect to OAuth Consent Screen
    OAuth-->>User: Present Login & Permission Prompt
    User->>OAuth: Authorize Application
    OAuth->>Worker: GET /auth/callback/google?code=...
    Worker->>OAuth: Exchange code for access token & user profile
    Worker->>Worker: Sign HMAC-SHA256 JWT Token
    Worker-->>PWA: Set-Cookie: session=...; HttpOnly; Secure; SameSite=Lax
    Worker-->>PWA: Redirect to / (Authenticated App Shell)
    PWA->>Worker: GET /api/metrics (Authenticated via Cookie)
    Worker-->>PWA: 200 OK (Queue & Anki Stats)
```

---

## 3. Vocabulary Mining & Durable Lease Lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant PWA as Client (PWA)
    participant Edge as Cloudflare Worker (/api/oplog/write)
    participant Turso as Turso libSQL (op_log)
    participant PC as Local Python Worker (worker.py)
    participant Anki as AnkiConnect (:8765)

    PWA->>Edge: POST /api/oplog/write (Expression: 猫, Sentence: ...)
    Edge->>Turso: INSERT INTO op_log (id, payload, ack=0, lease_id=NULL)
    Edge-->>PWA: 200 OK (Item Enqueued)

    loop Worker Polling Loop (Every 5s)
        PC->>Turso: SELECT * FROM op_log WHERE ack=0 AND lease_expires_at < now LIMIT 5
        PC->>Turso: UPDATE op_log SET lease_id=..., lease_expires_at=now+60s WHERE id=...
        Turso-->>PC: Leased OpLog Items
        PC->>Anki: ankiConnect.addNote(deck="N3", front="猫", back="cat")
        Anki-->>PC: Note ID Created
        PC->>Turso: UPDATE op_log SET ack=1, acked_at=now WHERE id=... AND lease_id=...
    end
```
