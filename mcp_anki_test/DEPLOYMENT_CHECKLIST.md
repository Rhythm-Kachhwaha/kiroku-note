# Deployment Checklist: Google Cloud Run + Supabase PostgreSQL

**Project**: Kiroku Note — ChatGPT MCP to Anki Ingestion  
**Directory**: `mcp_anki_test/`  
**Target Stack**: Google Cloud Run (FastAPI Server) + Supabase (PostgreSQL Queue) + Local PC Worker  
**Intended Destination Deck**: `N3 vocabs`  
**Status**: Pre-Deployment Audit Complete. No cloud resources or accounts provisioned yet.

---

## 1. Separation of Concerns: Implemented vs. Remaining Work

| Layer | Component | Status | Location / Details |
|---|---|---|---|
| **Local Prototype** | MCP Protocol & Tool Handling | **COMPLETED & TESTED** | `server.py` handles `initialize`, `tools/list`, and `tools/call` for `send_vocab_card`. 43/43 tests passing. |
| **Local Prototype** | Deck Routing | **COMPLETED & TESTED** | Configured for `N3 vocabs` by default, with per-card override support through `VocabCard` and `server.py`. |
| **Local Prototype** | Queue Abstraction | **COMPLETED & TESTED** | `CloudQueueAdapter` ready with authenticated HTTPS REST client, network error wrapping (`QueueError`), and secret token sanitization. |
| **Local Prototype** | Local PC Worker | **COMPLETED & TESTED** | `worker.py` polls queue, respects Kiroku liveness, prevents duplicates, syncs to Anki, and handles network dropouts during `ack`. |
| **Local Prototype** | Loopback Client | **COMPLETED & TESTED** | `kiroku_client.py` connects only to local Kiroku backend (`127.0.0.1:21828`). |
| **Cloud Infrastructure** | Supabase PostgreSQL Project | **PENDING USER APPROVAL** | Free-tier Supabase project not created yet. DDL migration prepared below. |
| **Cloud Infrastructure** | Cloud Run Container | **PENDING USER APPROVAL** | Dockerfile and container deployment to Google Cloud Run not executed. |
| **Cloud Infrastructure** | Secrets & Auth Tokens | **PENDING USER APPROVAL** | Production `MCP_SECRET` and `CLOUD_QUEUE_API_KEY` not generated or stored. |
| **Client Integration** | ChatGPT Mobile / Go Connection | **PENDING USER TESTING** | ChatGPT custom MCP connector / Custom GPT Action setup pending cloud URL. |

---

## 2. Incompatibility & ChatGPT Plan Audit (ChatGPT Go & Write Actions)

### Key Findings:
1. **ChatGPT Go Plan & Tool Execution**:
   - ChatGPT Go is a budget consumer tier. Custom MCP connectors (and developer mode) are typically restricted to ChatGPT Plus, Team, Enterprise, or specific developer beta workspaces.
   - Write tools (like `send_vocab_card` which mutates state) require function calling and action execution support. If your current plan restricts custom developer connectors or write tools, the native MCP endpoint cannot be invoked from chat.
2. **Dual-Protocol Fallback Architecture (Recommended)**:
   - While remote MCP is still rolling out across different subscription tiers, **Custom GPT Actions (OpenAPI 3.0 / REST)** have been standard and supported across ChatGPT tiers that support GPTs for over a year.
   - `server.py` can expose both:
     - `POST /mcp` (Streamable HTTP for native MCP connectors)
     - `POST /api/cards` (REST endpoint with OpenAPI schema for Custom GPT Actions)
   - Both endpoints push directly to the same underlying Supabase queue. This guarantees mobile ingestion works regardless of whether ChatGPT connects via MCP or Custom Actions.
3. **Transport Protocol**:
   - Current `server.py` implements **Streamable HTTP** (`POST /mcp`). If a client requires legacy SSE (`GET /sse`), an SSE stream handler can be attached without altering tool logic.
4. **Authentication**:
   - Single-tenant Bearer authentication (`Authorization: Bearer <token>`) is supported by Custom GPT Actions and custom developer MCP endpoints. Full multi-tenant marketplace deployment would require OAuth 2.1 with PKCE, which is unnecessary for personal use.

---

## 3. Step-by-Step Deployment Checklist

### Phase 1: Supabase PostgreSQL Setup (Estimated time: 5 minutes)
*No cost (Supabase Free Tier: 500 MB database, unlimited API requests)*

- [ ] **1.1. Create Project**:
  - Sign in to [database.new](https://database.new) (Supabase).
  - Create a new project (e.g. `kiroku-anki-queue`). Choose a region close to you.
  - Set a secure database password (save in your password manager).
- [ ] **1.2. Run Queue Schema Migration**:
  - In Supabase Dashboard → **SQL Editor**, run the following DDL script:

```sql
-- Kiroku Note Cloud Queue Schema
CREATE TABLE IF NOT EXISTS queued_cards (
    id BIGSERIAL PRIMARY KEY,
    expression TEXT NOT NULL,
    reading TEXT NOT NULL DEFAULT '',
    meaning TEXT NOT NULL DEFAULT '',
    sentence TEXT NOT NULL DEFAULT '',
    deck_name TEXT NOT NULL DEFAULT 'N3 vocabs',
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    error TEXT NOT NULL DEFAULT '',
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient polling and deduplication
CREATE INDEX IF NOT EXISTS idx_queued_cards_status 
    ON queued_cards (status, attempts);

CREATE INDEX IF NOT EXISTS idx_queued_cards_pending_dedup 
    ON queued_cards (expression, reading, deck_name) 
    WHERE status = 'pending';
```

- [ ] **1.3. Retrieve Credentials**:
  - In Project Settings → **API**:
    - Project URL (e.g., `https://xyzcompany.supabase.co`)
    - `service_role` secret key (for Cloud Run queue read/write) or Connection String (URI).

---

### Phase 2: Packaging Cloud Run Container (Estimated time: 5 minutes)
*No cost (Google Cloud Run Free Tier: 2 million requests/month, 360,000 GB-seconds memory)*

- [ ] **2.1. Create `Dockerfile` inside `mcp_anki_test/`**:
  ```dockerfile
  FROM python:3.11-slim
  WORKDIR /app
  COPY requirements.txt .
  RUN pip install --no-cache-dir -r requirements.txt
  COPY . .
  EXPOSE 8080
  ENV PORT=8080
  CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}"]
  ```

- [ ] **2.2. Generate Secure Tokens**:
  - Generate a random 32-character token for `MCP_SECRET`:
    ```powershell
    python -c "import secrets; print(secrets.token_urlsafe(32))"
    ```
  - Generate a random 32-character token for `CLOUD_QUEUE_API_KEY`:
    ```powershell
    python -c "import secrets; print(secrets.token_urlsafe(32))"
    ```

---

### Phase 3: Cloud Run Deployment (Estimated time: 5 minutes)

- [ ] **3.1. Deploy via Google Cloud CLI (`gcloud`)**:
  ```bash
  gcloud run deploy kiroku-anki-mcp \
      --source . \
      --region us-central1 \
      --allow-unauthenticated \
      --set-env-vars "MCP_SECRET=<your-mcp-secret>,QUEUE_BACKEND=cloud,ANKI_DECK_NAME=N3 vocabs,SUPABASE_URL=<your-supabase-url>,SUPABASE_KEY=<your-supabase-key>"
  ```
  *(Note: `--allow-unauthenticated` allows Cloud Run to receive public web traffic; requests to `/mcp` and `/enqueue` are still strictly protected by your `MCP_SECRET` and `CLOUD_QUEUE_API_KEY` Bearer tokens).*

- [ ] **3.2. Verify Health Check**:
  ```bash
  curl -X GET "https://<your-cloud-run-url>/health"
  ```
  *Expected Response*: `{"status": "ok", "backend": "cloud", ...}`

---

### Phase 4: Local PC Worker Configuration (Estimated time: 2 minutes)

- [ ] **4.1. Update `mcp_anki_test/.env` on your local PC**:
  ```ini
  MCP_SECRET=<your-mcp-secret>
  ANKI_DECK_NAME=N3 vocabs
  QUEUE_BACKEND=cloud
  CLOUD_QUEUE_URL=https://<your-cloud-run-url>
  CLOUD_QUEUE_API_KEY=<your-cloud-queue-api-key>
  WORKER_POLL_INTERVAL=10
  ```

- [ ] **4.2. Verify Outbound Fetch (PC Online)**:
  ```powershell
  cd D:\Python\AnkiMiner\mcp_anki_test
  .venv\Scripts\python.exe worker.py --once
  ```

---

### Phase 5: Client Integration (ChatGPT)

- [ ] **5.1. Test Native MCP Connector (if supported on your tier)**:
  - In ChatGPT Settings → Connectors / Developer Mode, enter:
    - URL: `https://<your-cloud-run-url>/mcp`
    - Authorization Header: `Bearer <your-mcp-secret>`
- [ ] **5.2. Fallback to Custom GPT Action (if ChatGPT Go lacks native MCP write tools)**:
  - In ChatGPT → Explore GPTs → Create GPT → Configure → **Add Action**.
  - Authentication: **API Key** → **Bearer** → enter `<your-mcp-secret>`.
  - Schema: Import OpenAPI schema from `https://<your-cloud-run-url>/openapi.json`.
- [ ] **5.3. End-to-End Mobile Test**:
  - On phone: Tell ChatGPT *"Add vocabulary card for 勉強 (reading: べんきょう, meaning: study, sentence: 日本語を勉強する)"*.
  - Verify card is queued in Supabase `queued_cards`.
  - Start PC worker: verify card is imported into Anki deck `N3 vocabs`.

---

## 4. Cost and Safety Summary

- **Total Estimated Monthly Cost**: **$0.00 / month**
  - Supabase Free Tier: $0/mo (up to 500 MB data, pause after 1 week of zero queries).
  - Google Cloud Run Free Tier: $0/mo (up to 2 million requests/month).
- **Security Invariant**:
  - No ports (neither 21828 nor 8765) are exposed to the internet.
  - The local worker initiates outbound HTTPS traffic only.
