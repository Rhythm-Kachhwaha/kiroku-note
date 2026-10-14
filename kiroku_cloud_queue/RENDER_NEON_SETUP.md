# Deploying Kiroku Cloud Queue on Render + Neon

This guide explains how to deploy the Kiroku Cloud Queue service to **Render** (for hosting the FastAPI web service) and **Neon** (for serverless PostgreSQL database persistence).

---

## 1. Architecture & Why Render + Neon

- **Neon (Database)**: Serverless PostgreSQL that scales to zero when idle, includes SSL by default, and provides generous free storage (0.5 GiB) perfectly suited for card queues.
- **Render (API Host)**: Hosts the lightweight FastAPI service on a public HTTPS URL (`https://<service-name>.onrender.com`), enabling iPhone Shortcuts, mobile webhooks, and ChatGPT MCP to submit vocabulary cards from anywhere over cellular or Wi-Fi.
- **Local PC Worker**: The worker (`worker.py`) runs on your local Windows PC when you are studying. It pulls pending cards from Render, calls your local Kiroku Yomitan engine to automatically enrich definitions and kanji breakdowns, saves them safely into Kiroku's SQLite database, and syncs them directly into Anki Desktop.

```
[ iPhone / Webhook / LLM ]
         |
         | HTTPS POST /submit (Bearer SUBMIT_TOKEN)
         v
[ Render Web Service ] <======> [ Neon Serverless PostgreSQL ]
(FastAPI on Render.com)         (queued_cards table auto-initialized)
         ^
         |
         | HTTPS GET /pending (Bearer WORKER_TOKEN)
         v
[ Local Windows Worker ]
(worker.py on PC)
         |
         | Local Enrichment & Persistence
         v
[ Kiroku Local Backend (127.0.0.1:21828) ]
         |
         +--> Yomitan Dictionary & Kanji Breakdown
         +--> Kiroku Local SQLite (cards table)
         +--> AnkiConnect (Anki Desktop)
```

---

## 2. Step 1: Create Your Neon PostgreSQL Database

1. Sign up or log in at **[neon.tech](https://neon.tech)**.
2. Click **Create Project**:
   - **Name**: `kiroku-queue` (or any name you choose)
   - **Region**: Choose the region closest to you (e.g. `US East (Ohio)` or `AWS Frankfurt`)
   - **Postgres version**: `16` or `17` (default)
3. On the project dashboard, locate the **Connection Details** box.
4. Select **Connection string** and ensure **Pooled connection** or direct connection is selected.
5. Copy the connection string. It will look like:
   ```text
   postgresql://neondb_owner:npg_AbCdEf123456@ep-cool-butterfly-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
   *(Note: The server auto-normalizes `postgres://` to `postgresql://` and automatically creates the table and indexes on its first start).*

---

## 3. Step 2: Deploy to Render

### Option A: Using the Render Blueprint (`render.yaml`)

1. Push your repository branch to GitHub.
2. In the **[Render Dashboard](https://dashboard.render.com/)**, click **New +** -> **Blueprint**.
3. Select your repository. Render will automatically detect `kiroku_cloud_queue/render.yaml`.
4. In the environment variables prompt:
   - Set `DATABASE_URL`: Paste your Neon connection string.
   - Note the generated values for `SUBMIT_TOKEN` and `WORKER_TOKEN`.
5. Click **Apply**.

---

### Option B: Manual Web Service Setup on Render

1. In the **[Render Dashboard](https://dashboard.render.com/)**, click **New +** -> **Web Service**.
2. Connect your GitHub repository.
3. Configure the settings:
   - **Name**: `kiroku-cloud-queue`
   - **Region**: Same region as your Neon database (or closest)
   - **Branch**: `main`
   - **Root Directory**: `kiroku_cloud_queue`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn server:app --host 0.0.0.0 --port $PORT`
   - **Plan**: `Free`
4. Under **Advanced** -> **Health Check Path**, enter: `/health`
5. Under **Environment Variables**, add:
   - `DATABASE_URL`: `postgresql://...` (your Neon connection string)
   - `SUBMIT_TOKEN`: A secure random token (e.g., `kiroku_sub_secret_998877`)
   - `WORKER_TOKEN`: A secure random token (e.g., `kiroku_wrk_secret_112233`)
   - `ANKI_DECK_NAME`: `N3 vocabs` (or your target Anki deck name)
6. Click **Create Web Service**.
7. Once deployed, Render will provide a public URL like:
   ```text
   https://kiroku-cloud-queue.onrender.com
   ```

---

## 4. Step 3: Verify the Deployment

Run a quick health check from your terminal:
```bash
curl https://kiroku-cloud-queue.onrender.com/health
```
Expected response:
```json
{
  "status": "ok",
  "backend": "cloud",
  "database": "connected",
  "is_configured": true,
  "queue_stats": {
    "pending": 0,
    "claimed": 0,
    "completed": 0,
    "failed": 0
  }
}
```

---

## 5. Step 4: Configure iPhone Shortcut

In the iOS Shortcuts app on your iPhone:

1. Create a Shortcut named **"Kiroku Cloud Add"**.
2. Add an action: **Get Contents of URL**:
   - **URL**: `https://kiroku-cloud-queue.onrender.com/submit`
   - **Method**: `POST`
   - **Headers**:
     - `Authorization`: `Bearer <YOUR_SUBMIT_TOKEN>`
     - `Content-Type`: `application/json; charset=utf-8`
   - **Request Body**: `File` or `Text` -> Select **Clipboard** or **Shortcut Input**.
3. **Optional Entries Support**:
   You can send a complete JSON object, or just the word itself:
   ```json
   {
     "expression": "刹那"
   }
   ```
   Or even plain text containing just the word `刹那`. The server automatically parses it, and when the worker processes the card, Kiroku's Yomitan pipeline will look up the reading (`せつな`), meaning (`a moment, an instant`), dictionary definitions, and kanji breakdowns (`刹`, `那`).

---

## 6. Step 5: Run the Worker on Your Windows PC

On your local PC where Kiroku backend and Anki Desktop run:

1. In your `kiroku_cloud_queue` folder or in your Windows terminal, set the cloud queue URL and token:

   **PowerShell:**
   ```powershell
   $env:CLOUD_QUEUE_URL = "https://kiroku-cloud-queue.onrender.com"
   $env:CLOUD_QUEUE_API_KEY = "<YOUR_WORKER_TOKEN>"
   ```

2. Run the worker:
   ```powershell
   .\kiroku_cloud_queue\.venv\Scripts\python.exe kiroku_cloud_queue\worker.py --backend cloud --interval 15
   ```
   Or run a single batch on demand:
   ```powershell
   .\kiroku_cloud_queue\.venv\Scripts\python.exe kiroku_cloud_queue\worker.py --backend cloud --once
   ```

3. Open the Kiroku Chrome Extension Side Panel:
   - Click the **Cloud** subnav tab under **History** to view all synced cloud cards.
   - Click **Sync Cloud Cards** to push pending cloud cards directly to Anki!

---

## 7. Security Best Practices

- **Token Separation**: Always use different tokens for `SUBMIT_TOKEN` (on your phone) and `WORKER_TOKEN` (on your PC). Even if your phone token is compromised, nobody can fetch or clear pending cards.
- **No Direct Anki/SQLite Exposure**: Render and Neon never touch your local Anki database or Kiroku SQLite. All local database writes happen strictly on your local PC via `worker.py`.
