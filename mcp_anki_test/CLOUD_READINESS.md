# Cloud Readiness Audit & Deployment Plan

**Directory**: `mcp_anki_test/`  
**Status**: Local prototype fully tested & verified; Cloud deployment pending configuration  
**Date**: 2026-10-13  

---

## 1. Executive Summary

The **Kiroku Note MCP Ingestion Prototype** provides a mechanism to capture Japanese vocabulary cards from ChatGPT (e.g. while studying on mobile) and import them into your local Anki collection via Kiroku Note.

The fundamental design requirement is:
> **You can add cards to your study deck on your phone while your PC is powered off.** When you turn on your PC and run Kiroku, all pending cards automatically sync into your Anki deck.

All local components (`server.py`, `worker.py`, `queue_db.py`, `queue_adapter.py`, `kiroku_client.py`) have been developed, isolated, unit-tested (41/41 passing tests), and verified live through the complete chain to Anki Desktop.

This document details the audit of the current prototype, distinguishes implemented functionality from cloud placeholders, defines the technical requirements for the future cloud queue, provides cost-effective hosting recommendations, and lists all decisions requiring your approval before spending money or provisioning resources.

---

## 2. Target Architecture & Data Flow

```
Mobile Study (PC Offline)
┌────────────────────────┐
│  ChatGPT Mobile App    │
│  (User asks for card)  │
└───────────┬────────────┘
            │ HTTPS POST /mcp (Bearer Token)
            ▼
┌────────────────────────────────────────────────────────┐
│ Cloud MCP Server (server.py hosted in Cloud)           │
│ - Accepts MCP Streamable HTTP protocol                 │
│ - Validates expression, reading, meaning               │
│ - Enqueues card into Cloud Queue                       │
└───────────────────────────┬────────────────────────────┘
                            │ Outbound HTTPS POST /enqueue
                            ▼
┌────────────────────────────────────────────────────────┐
│ Persistent Cloud Queue (Cloud Queue / Database)        │
│ - Source of truth for pending cards                    │
│ - Stores cards durably while PC is OFF                 │
│ - Deduplicates identical pending submissions           │
└───────────────────────────▲────────────────────────────┘
                            │
Local Sync (PC Online)      │ HTTPS GET /pending (Outbound ONLY from PC)
┌───────────────────────────┴────────────────────────────┐
│ Local PC Worker (worker.py)                            │
│ - Runs on your PC when active                          │
│ - Initiates outbound HTTPS polling to cloud queue      │
│ - No open inbound ports on your home PC                │
└─────────────┬────────────────────────────┬─────────────┘
              │ Loopback POST /api/cards/save (21828)
              ▼                            │
┌───────────────────────────┐              │ HTTPS POST /ack/{id}
│ Local Kiroku Backend      │              │ (Only AFTER local save)
│ - SQLite persistence      │              ▼
│ - Duplicate identity check│      ┌───────────────────────┐
└─────────────┬─────────────┘      │ Acknowledged in Queue │
              │ Loopback POST (8765) └───────────────────────┘
              ▼
┌───────────────────────────┐
│ Local Anki (AnkiConnect)  │
│ - Note created in deck    │
└───────────────────────────┘
```

### Security Invariant
Your home PC **never** accepts incoming internet connections:
- AnkiConnect (`127.0.0.1:8765`) remains strictly locked to loopback.
- Kiroku Note (`127.0.0.1:21828`) remains strictly locked to loopback.
- `worker.py` only makes **outbound** requests: polling the cloud queue over HTTPS and calling Kiroku on loopback.
- No dynamic DNS, port forwarding, ngrok, or Cloudflare tunnels are ever required on your home network.

---

## 3. Implemented Features vs. Placeholders

| Component | Status | Current Local Implementation | Cloud Readiness / Remaining Work |
|---|---|---|---|
| **MCP Protocol Endpoint (`server.py`)** | **Implemented** | Streamable HTTP endpoint (`POST /mcp`, `GET /health`), Bearer token auth (`secrets.compare_digest`), card validation. | Ready to containerize as-is (e.g., Dockerfile / Cloud Run / Modal). |
| **Local Dev Queue (`LocalDevQueueAdapter`)** | **Implemented** | SQLite database (`mcp.db`), FIFO ordering, pending deduplication, dead-letter status (`failed` after 10 attempts). | For offline PC testing only. Does not receive mobile requests while PC is off. |
| **Cloud Queue Client (`CloudQueueAdapter`)** | **Interface Implemented** | Full async HTTP client (`/enqueue`, `/pending`, `/ack`, `/nack`, `/stats`), Bearer token auth, network error wrapping (`QueueError`), secret token sanitization. | Raises `CloudQueueNotConfiguredError` if environment variables are empty. Needs live endpoint. |
| **Local PC Worker (`worker.py`)** | **Implemented** | Pulls from queue adapter, verifies Kiroku health, saves to Kiroku, syncs to Anki, resilient against queue `ack` dropouts, duplicates auto-acknowledged. | Ready to run as a background service or launch alongside Kiroku on PC. |
| **Kiroku HTTP Client (`kiroku_client.py`)** | **Implemented** | Async loopback client (`/api/cards/save`, `/api/cards/{id}/sync`, `/api/health`) with `Host: 127.0.0.1:21828` security header. | Production-ready for local PC communication. |
| **Cloud Persistent Queue Service** | **Placeholder** | Simulated locally by `LocalDevQueueAdapter`. | **Not provisioned yet.** Needs selection and deployment of a durable cloud storage service. |
| **Cloud Hosting for MCP Server** | **Placeholder** | Runs locally via `uvicorn server:app --port 8100`. | **Not deployed yet.** Needs deployment to a container or serverless host. |

---

## 4. Cloud Queue Technical Requirements

To ensure zero card loss, reliable retries, and seamless sync when your PC boots up, any cloud queue or database backend must satisfy these criteria:

1. **Durable Persistence**:
   - Submissions must be written to non-volatile disk/database (not purely ephemeral RAM) so that cards survive cloud container recycles or restarts.
2. **Authenticated HTTPS API**:
   - Ingestion (`/enqueue`) and polling (`/pending`, `/ack`) must require an API key or Bearer token over TLS (HTTPS).
3. **Queue-Level Idempotency & Deduplication**:
   - If a mobile user taps "Submit" twice or ChatGPT re-issues a tool call after a transient network blip, the queue must return the existing pending item ID rather than creating two identical pending records.
4. **Lease / Visibility Timeout or Single-Worker Guarantee**:
   - When the local worker fetches pending cards, those cards should either be leased (hidden from other consumers for e.g. 60 seconds) or acknowledged immediately after persistence to prevent double-processing.
5. **Safe Retries and Dead-Letter Threshold**:
   - If Kiroku is offline, the worker halts without burning retry attempts.
   - If an invalid card causes an API rejection (e.g. malformed data), the item is nacked and marked `failed` after max attempts (e.g. 5–10) so it does not block the queue.
6. **No Secret Leakage**:
   - Cloud credentials (`CLOUD_QUEUE_API_KEY`, `MCP_SECRET`) must never appear in error responses, URLs, query parameters, or debug logs.

---

## 5. Smallest Deployment Architectures & Cost Estimates

All cost figures are estimates based on standard free tiers as of 2026:

### Option A: Unified Serverless Microservice (Recommended)
Host a single lightweight FastAPI service in the cloud that runs both `server.py` and an embedded SQLite/PostgreSQL database for queueing:
- **Compute**: Google Cloud Run (free tier: 2 million requests/month) or Render (free web service) or Modal / Fly.io.
- **Database**: 
  - **Turso / libSQL**: Free tier includes 9 GB storage and 1 billion row reads/month.
  - **Supabase**: Free tier includes 500 MB PostgreSQL database.
- **Estimated Cost**: **$0.00 / month** (within free tier limits).
- **Pros**: Direct reuse of current `queue_db.py` query semantics; minimal moving parts; single cloud credential.

### Option B: Cloud MCP Server + Upstash Redis Queue
Host `server.py` on Cloud Run and use Upstash Redis as a lightweight REST-based FIFO queue:
- **Compute**: Google Cloud Run ($0/mo within free tier).
- **Queue**: Upstash Redis (free tier: 10,000 commands/day).
- **Estimated Cost**: **$0.00 / month**.
- **Pros**: Native queue primitives (`RPUSH`, `LPOP`, atomic operations); built-in REST API.
- **Cons**: Redis commands require a custom adapter subclass in `queue_adapter.py`.

### Option C: AWS SQS + Lambda / API Gateway
AWS standard serverless queue architecture:
- **Queue**: AWS SQS (free tier: 1 million requests/month).
- **Compute**: AWS Lambda (free tier: 1 million requests/month).
- **Estimated Cost**: **$0.00 / month** (effectively free for personal use).
- **Cons**: More complex AWS IAM permissions, API Gateway configuration, and AWS SDK credentials.

---

## 6. ChatGPT Mobile & MCP Integration Compatibility Notice

> [!IMPORTANT]
> **ChatGPT MCP Compatibility Consideration**:
> OpenAI's Developer Mode / Actions / Custom GPTs and ChatGPT Connectors allow connecting external HTTP APIs and OpenAPI endpoints. However:
> - Direct write-tool support via remote Streamable HTTP MCP servers in standard mobile chat depends on OpenAI's specific rollout of MCP connectors for your subscription tier (Plus / Team / Pro).
> - If ChatGPT mobile requires an **OpenAPI 3.0 specification** (Custom Actions) rather than native JSON-RPC MCP protocol, `server.py` can trivially expose a standard REST route (`POST /api/cards/enqueue`) alongside `/mcp` using the same underlying `queue_adapter`.
> - This flexibility ensures you will be able to capture cards from mobile regardless of which protocol connector ChatGPT requires.

---

## 7. Decisions and Next Steps

The target architecture and deployment parameters have been defined:
- **Target Stack**: Google Cloud Run (FastAPI Server) + Supabase (PostgreSQL Queue).
- **Target Anki Deck**: Set to `N3 vocabs` by default in `.env`, `.env.example`, `server.py`, and `queue_adapter.py`.
- **Deployment Checklist**: See [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) for the step-by-step pre-deployment checklist, Supabase SQL migration script, Dockerfile, and verification steps.

Before deploying:
1. Review the checklist in [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md).
2. Generate secure tokens for `MCP_SECRET` and `CLOUD_QUEUE_API_KEY` when ready to deploy.
3. Explicit user approval is required before provisioning any cloud accounts or executing `gcloud run deploy`.

