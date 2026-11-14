# Render Web Service Retirement & Migration Guide

This guide documents the procedures for safely decommissioning the legacy Render web service and PostgreSQL database used by previous versions of Kiroku Note.

---

## 1. Context & Architecture Migration

Previously, Kiroku Note used:
- A Render Web Service (FastAPI / Uvicorn server) for op-log queue ingestion.
- A Render PostgreSQL database for tracking op-log items and mirror statistics.
- A standalone HTML dashboard hosted on Render.

All these capabilities have now been consolidated:
- **Queue Ingestion & Storage**: Handled directly by Turso libSQL edge database and Cloudflare Workers (`worker/index.js`).
- **Dashboard & Inspector**: Ported directly into `Settings -> Sync & Analytics` in both the PWA and Windows Desktop apps.
- **Worker Sync Loop**: The local Python worker (`kiroku_cloud_queue/worker.py`) communicates directly with Turso libSQL with sub-millisecond latency.

---

## 2. Pre-Retirement Checklist

Before deleting resources in the Render dashboard:
1. **Verify Queue Drain**:
   - Start the local Python worker:
     ```powershell
     $env:PYTHONPATH = ".;backend;kiroku_cloud_queue"
     python kiroku_cloud_queue/worker.py
     ```
   - In the PWA or Desktop app under `Settings -> Sync & Analytics`, verify that:
     - Pending count is `0`.
     - Leased count is `0`.
2. **Export Legacy Database Records (Optional)**:
   - If historical op-log records from PostgreSQL need to be archived:
     ```bash
     pg_dump -h <render-postgres-host> -U <user> -d <dbname> -t op_log -t anki_cards > render_archive.sql
     ```
   - Store the archive securely offline.

---

## 3. Retiring Services in Render Dashboard

1. Log into your Render dashboard at `https://dashboard.render.com`.
2. Navigate to your Kiroku web service:
   - Select **Settings**.
   - Scroll down to the danger zone.
   - Click **Suspend Service** (or **Delete Web Service** once suspended and verified).
3. Navigate to your PostgreSQL database instance:
   - Select **Settings**.
   - Click **Delete Database**.
4. Confirm deletion.

---

## 4. Client & Shortcut Configuration Updates

### iOS Shortcuts
- If you use iOS Shortcuts to send vocabulary into Kiroku Note, update the webhook URL from:
  `https://kiroku-server.onrender.com/api/oplog/write`
  to your Cloudflare Worker URL:
  `https://<your-worker>.workers.dev/api/oplog/write`
- Use your configured Bearer API key (`CLOUD_QUEUE_API_KEY`) in the Authorization header.

### Windows Desktop Companion
- The Windows desktop app connects locally to `http://127.0.0.1:8000` (FastAPI) and AnkiConnect (`http://127.0.0.1:8765`), operating independently of Render.

