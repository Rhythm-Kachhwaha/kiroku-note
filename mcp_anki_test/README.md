# mcp_anki_test — ChatGPT MCP → Cloud Queue → Kiroku → Anki Prototype

A self-contained prototype for sending Japanese vocabulary cards from ChatGPT (e.g. on mobile) to your local Anki deck via Kiroku.

**Strict isolation guarantee**: this directory is 100% standalone. It does not modify, import, or depend on any existing Kiroku source files, schemas, or database tables. It communicates with Kiroku only through documented HTTP API endpoints (`/api/cards/save`, `/api/cards/{id}/sync`) over loopback.

---

## Architecture Overview

### 1. Target Cloud Architecture (Future Production)

When deployed to the cloud, your PC does **not** need to be on while studying on your phone:

```
[ChatGPT Mobile]
       │
       ▼ (HTTPS POST /mcp with Bearer token)
[Cloud MCP Server] (FastAPI in Cloud Run / Lambda / Modal)
       │
       ▼ (Enqueue card)
[Cloud Persistent Queue]  <── Source of truth for pending cards
       ▲
       │ (Fetch pending cards over HTTPS)
[Local PC Worker (worker.py)]  <── Runs on your PC when active
       │
       ▼ (Loopback HTTP: POST /api/cards/save)
[Local Kiroku Backend] (FastAPI port 21828)
       │
       ▼ (Loopback HTTP: POST /api/cards/{id}/sync)
[Local Anki (AnkiConnect)] (Port 8765)
```

1. **Study on mobile**: You ask ChatGPT to explain a word and add it to Anki.
2. **Cloud ingestion**: ChatGPT calls `send_vocab_card` on your cloud MCP server.
3. **Queue persistence**: The cloud MCP server puts the card into the cloud queue and returns immediately. Your PC can remain off.
4. **Local retrieval**: When you start your PC and run Kiroku, `worker.py` fetches pending cards from the cloud queue.
5. **Persistence & Sync**: The worker sends the cards to Kiroku's API. Kiroku saves them into its local database (`kiroku.db`) and syncs them to Anki via AnkiConnect.
6. **Queue Acknowledgment**: Only after Kiroku safely persists the card (or detects it as an existing duplicate) does the worker acknowledge (`ack`) the card in the cloud queue.

---

### 2. Current Implementation State

To allow thorough local verification **before** creating or paying for any cloud infrastructure:

| Component | Status | How it operates today |
|---|---|---|
| **MCP Server (`server.py`)** | **Runnable locally** | Accepts MCP protocol requests (`initialize`, `tools/list`, `tools/call`). Validates card and writes to `QueueAdapter`. |
| **Local Dev Queue (`LocalDevQueueAdapter`)** | **Runnable locally** | SQLite-backed queue (`mcp.db` in this folder). Simulates the queue locally for testing. |
| **Local Worker (`worker.py`)** | **Runnable locally** | Fetches from `QueueAdapter`, calls Kiroku loopback API, handles duplicates, retries, and acknowledgments. |
| **Cloud Queue Adapter (`CloudQueueAdapter`)** | **Interface Ready** | Concrete client ready for a cloud endpoint. If `QUEUE_BACKEND=cloud` without credentials, raises a descriptive `CloudQueueNotConfiguredError`. |
| **Kiroku Client (`kiroku_client.py`)** | **Runnable locally** | Async HTTP client calling Kiroku's loopback API with correct security headers. |

> [!IMPORTANT]
> **No cloud services have been deployed yet.**
> Mobile submissions while the PC is off will **only** work once the cloud queue and cloud MCP server are provisioned. In local testing mode (`QUEUE_BACKEND=local`), the server and worker run on your PC.

---

## Directory Layout

```
mcp_anki_test/
├── .env.example          # Environment variable template
├── .venv/                # Isolated virtual environment
├── requirements.txt      # Prototype dependencies (fastapi, uvicorn, httpx, pytest)
├── queue_adapter.py      # Queue interface, LocalDevQueueAdapter, CloudQueueAdapter
├── queue_db.py           # Local SQLite storage used by LocalDevQueueAdapter
├── kiroku_client.py      # Async HTTP client for Kiroku loopback API
├── server.py             # MCP server (receives tool calls -> pushes to queue)
├── worker.py             # Local worker (pulls from queue -> pushes to Kiroku)
├── pytest.ini            # Pytest configuration
├── README.md             # This guide
└── tests/
    ├── test_auth.py          # Authentication tests for MCP endpoint
    ├── test_mcp_protocol.py  # MCP protocol compliance & queueing tests
    ├── test_queue.py         # SQLite queue storage tests
    ├── test_queue_adapter.py # Queue adapter interface & error behavior tests
    └── test_worker.py        # Worker retry, duplicate, and sync tests
```

---

## Quickstart: Running Automated Tests

Run the full isolated test suite inside the prototype venv:

```powershell
cd D:\Python\AnkiMiner\mcp_anki_test
.venv\Scripts\python.exe -m pytest tests/ -v
```

Expected output: **37 passed** (covering auth, MCP protocol, queue adapters, worker retries, duplicate handling, and offline safety).

---

## Local End-to-End Testing Workflow

To test the entire workflow locally without deploying to the cloud:

### Step 1: Configure `.env`

```powershell
cd D:\Python\AnkiMiner\mcp_anki_test
Copy-Item .env.example .env
```

Edit `.env` and set:
```ini
MCP_SECRET=my-secret-test-token
QUEUE_BACKEND=local
```

### Step 2: Start Kiroku Backend (Optional / Test Live)

If you want live Anki integration, ensure Anki is open and start Kiroku in a terminal:
```powershell
cd D:\Python\AnkiMiner
python run_backend.py
```

*(Note: All unit tests mock Kiroku and Anki, so this step is only needed if you want live end-to-end card creation).*

### Step 3: Start the MCP Server

In a new terminal:
```powershell
cd D:\Python\AnkiMiner\mcp_anki_test
.venv\Scripts\Activate.ps1
$env:MCP_SECRET="my-secret-test-token"
$env:QUEUE_BACKEND="local"
uvicorn server:app --port 8100
```

### Step 4: Submit a Vocabulary Card via MCP

In a separate terminal or PowerShell window, submit a card using `curl` / `Invoke-RestMethod`:

```powershell
$headers = @{
    "Authorization" = "Bearer my-secret-test-token"
    "Content-Type"  = "application/json"
}

$body = @{
    "jsonrpc" = "2.0"
    "id"      = 1
    "method"  = "tools/call"
    "params"  = @{
        "name"      = "send_vocab_card"
        "arguments" = @{
            "expression" = "約束"
            "reading"    = "やくそく"
            "meaning"    = "promise"
            "sentence"   = "約束を守る"
        }
    }
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://127.0.0.1:8100/mcp" -Method Post -Headers $headers -Body $body
```

You will receive an MCP response confirming the card is queued:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"status\": \"queued\", \"queue_id\": \"1\", \"expression\": \"約束\", \"message\": \"Card for '約束' successfully queued (ID: 1). Your local Kiroku worker will import it to Anki when active.\"}"
      }
    ],
    "isError": false
  }
}
```

### Step 5: Run the Worker to Process the Card

To drain the queue in one shot:
```powershell
cd D:\Python\AnkiMiner\mcp_anki_test
.venv\Scripts\python.exe worker.py --once
```

Or to run the worker in continuous polling mode:
```powershell
.venv\Scripts\python.exe worker.py --interval 5
```

The worker connects to Kiroku, saves the card, syncs to Anki, and acknowledges the item in the queue.

---

## Future Cloud Deployment Steps (Overview)

When you are ready to enable mobile study while your PC is off, follow these steps:

1. **Choose a Cloud Queue Provider**:
   - **Option A (Lightweight REST / Serverless)**: A small FastAPI app on Cloud Run, Render, or Modal with a SQLite/PostgreSQL/Supabase database.
   - **Option B (Serverless Queue)**: Upstash Redis (free tier) or AWS SQS with an HTTP API Gateway.
2. **Deploy `server.py` to the Cloud**:
   - Deploy `server.py` and `queue_adapter.py` as a web container on Cloud Run, Render, or Fly.io.
   - Set environment variables on the cloud service:
     - `MCP_SECRET=<your-chosen-secret>`
     - `QUEUE_BACKEND=cloud`
     - `CLOUD_QUEUE_URL=<your-cloud-queue-url>`
     - `CLOUD_QUEUE_API_KEY=<your-cloud-queue-key>`
3. **Connect ChatGPT to the Cloud MCP Server**:
   - In ChatGPT Settings → Connectors / Developer Mode, enter the cloud URL (e.g. `https://my-anki-mcp.run.app/mcp`) and your Bearer token.
4. **Configure Local Worker on your PC**:
   - In `mcp_anki_test/.env`, set:
     ```ini
     QUEUE_BACKEND=cloud
     CLOUD_QUEUE_URL=https://my-cloud-queue.com
     CLOUD_QUEUE_API_KEY=<your-cloud-queue-key>
     ```
   - Whenever your PC is on and Kiroku is running, keep `worker.py` running in the background (or launch it along with Kiroku). It will automatically retrieve any cards you queued on your phone and import them into Anki.
