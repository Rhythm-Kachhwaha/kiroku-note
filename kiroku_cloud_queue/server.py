"""
server.py -- Cloud Queue API & MCP Server for Japanese vocabulary card ingestion.

Endpoints:
  - POST /submit (alias /enqueue):
      Public HTTPS submission endpoint for iPhone Shortcuts & mobile clients.
      Accepts text/plain (UTF-8 JSON) or application/json.
      Authenticated via Bearer token (SUBMIT_TOKEN / PHONE_SECRET).
  - GET  /pending:
      Worker endpoint to fetch and atomically claim pending jobs with leases.
      Authenticated via Bearer token (WORKER_TOKEN / MCP_SECRET).
  - POST /ack/{item_id}:
      Worker endpoint to acknowledge successful downstream persistence.
  - POST /nack/{item_id}:
      Worker endpoint to report processing failure and manage retries.
  - GET  /stats:
      Queue statistics (pending, claimed, completed, failed counts).
  - GET  /health:
      Public health check endpoint.
  - POST /mcp:
      Streamable HTTP MCP endpoint for ChatGPT conversations.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import sys
from contextlib import asynccontextmanager
from typing import Any, Optional

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import HTMLResponse, JSONResponse

from queue_adapter import (
    CloudQueueNotConfiguredError,
    QueueError,
    VocabCard,
    get_queue_adapter,
)
from queue_store import BaseQueueStore, get_queue_store
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("kiroku_cloud_queue_server")


from env_utils import load_env_file

_load_env_file = load_env_file
load_env_file()

# ---------------------------------------------------------------------------
# Configuration & Constants
# ---------------------------------------------------------------------------
MCP_SECRET = os.getenv("MCP_SECRET", "")
ANKI_DECK_NAME = os.getenv("ANKI_DECK_NAME", "N3 vocabs")
MAX_PAYLOAD_SIZE = 65536  # 64 KB

SERVER_INFO = {
    "name": "kiroku-anki-mcp",
    "version": "1.1.0",
}
PROTOCOL_VERSION = "2024-11-05"

# Global Queue Store (initialized gracefully, finalized in lifespan)
try:
    store: Optional[BaseQueueStore] = get_queue_store()
except Exception as exc:
    log.warning("Could not initialize default queue store at import time: %s", exc)
    store = None

# ---------------------------------------------------------------------------
# Authentication Utilities
# ---------------------------------------------------------------------------

def _extract_bearer_token(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Bearer authorization header.",
        )
    return auth[len("Bearer "):].strip()


def _authenticate_submit(request: Request) -> None:
    """Validate token for iPhone Shortcut / public card submissions."""
    token = _extract_bearer_token(request)
    submit_tokens = [
        t for t in [
            os.getenv("SUBMIT_TOKEN"),
            os.getenv("PHONE_SECRET"),
        ] if t
    ]
    if not submit_tokens:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server submission authentication secret (SUBMIT_TOKEN) not configured.",
        )
    if not any(secrets.compare_digest(token, st) for st in submit_tokens):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid submission authentication token.",
        )


def _authenticate_worker(request: Request) -> None:
    """Validate token for local worker operations (pending, ack, nack, stats)."""
    token = _extract_bearer_token(request)
    worker_tokens = [
        t for t in [
            os.getenv("WORKER_TOKEN"),
            os.getenv("WORKER_SECRET"),
            os.getenv("CLOUD_QUEUE_API_KEY"),
        ] if t
    ]
    if not worker_tokens:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server worker authentication secret (WORKER_TOKEN) not configured.",
        )
    if not any(secrets.compare_digest(token, wt) for wt in worker_tokens):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid worker authentication token.",
        )


# ---------------------------------------------------------------------------
# MCP Tool Definition
# ---------------------------------------------------------------------------
TOOLS = [
    {
        "name": "send_vocab_card",
        "description": (
            "Send a Japanese vocabulary card to the queue for local import into Kiroku and Anki. "
            "The card is stored persistently in the queue and processed by your local Kiroku "
            "worker when your PC is online."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "The Japanese word or phrase (kanji/kana form).",
                },
                "reading": {
                    "type": "string",
                    "description": "Furigana/kana reading of the expression.",
                },
                "meaning": {
                    "type": "string",
                    "description": "English meaning or definition.",
                },
                "sentence": {
                    "type": "string",
                    "description": "Optional example sentence containing the expression.",
                },
                "sentence_meaning": {
                    "type": "string",
                    "description": "Optional English translation of the example sentence.",
                },
                "deck_name": {
                    "type": "string",
                    "description": "Optional target Anki deck name. Defaults to 'N3 vocabs'.",
                },
            },
            "required": ["expression"],
        },
    }
]


async def handle_send_vocab_card(args: dict[str, Any]) -> dict[str, Any]:
    expression = (args.get("expression") or "").strip()
    reading = (args.get("reading") or "").strip()
    meaning = (args.get("meaning") or "").strip()
    sentence = (args.get("sentence") or "").strip()
    sentence_meaning = (args.get("sentence_meaning") or "").strip()
    deck_name = (args.get("deck_name") or os.getenv("ANKI_DECK_NAME", "N3 vocabs")).strip() or "N3 vocabs"

    if not expression:
        return {"status": "error", "message": "expression is required and must not be blank."}

    card = VocabCard(
        expression=expression,
        reading=reading,
        meaning=meaning,
        sentence=sentence,
        sentence_meaning=sentence_meaning,
        deck_name=deck_name,
    )

    adapter = get_queue_adapter()
    try:
        queue_id = await adapter.enqueue(card)
        log.info("Enqueued vocab card '%s' with queue_id=%s", expression, queue_id)
        return {
            "status": "queued",
            "queue_id": str(queue_id),
            "expression": expression,
            "message": (
                f"Card for '{expression}' successfully queued (ID: {queue_id}). "
                "Your local Kiroku worker will import it to Anki when active."
            ),
        }
    except CloudQueueNotConfiguredError as exc:
        log.error("Cloud queue is not configured: %s", exc)
        return {
            "status": "error",
            "message": str(exc),
        }
    except QueueError as exc:
        log.error("Queue error while enqueuing card: %s", exc)
        return {
            "status": "error",
            "message": f"Failed to enqueue card: {exc}",
        }


# ---------------------------------------------------------------------------
# FastAPI Lifecycle & App
# ---------------------------------------------------------------------------

from fastapi.middleware.cors import CORSMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    global store
    if store is None:
        store = get_queue_store()
    try:
        store.init_db()
    except Exception as exc:
        log.warning("Database schema initialization warning: %s", exc)
    log.info("Server started with queue store: %s", type(store).__name__ if store else "None")
    yield
    if store and hasattr(store, "close"):
        try:
            store.close()
        except Exception:
            pass


app = FastAPI(title="Kiroku Cloud Queue API", lifespan=lifespan, docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Public Submission Endpoint (iPhone Shortcut & Webhook)
# ---------------------------------------------------------------------------

@app.post("/submit")
@app.post("/enqueue")
async def submit_card_endpoint(request: Request) -> JSONResponse:
    """
    Accepts text/plain (UTF-8 JSON from iPhone Shortcut) or application/json.
    Strictly validates Japanese vocabulary card payload and commits to persistent queue.
    """
    _authenticate_submit(request)

    content_length = request.headers.get("content-length")
    if content_length:
        try:
            cl_int = int(content_length)
            if cl_int > MAX_PAYLOAD_SIZE:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Payload exceeds maximum allowable size of {MAX_PAYLOAD_SIZE} bytes.",
                )
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid Content-Length header.",
            )

    body_bytes = await request.body()
    if len(body_bytes) > MAX_PAYLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Payload exceeds maximum allowable size of {MAX_PAYLOAD_SIZE} bytes.",
        )

    try:
        text = body_bytes.decode("utf-8-sig").strip()
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload must be valid UTF-8 text.",
        )

    # First attempt: standard JSON parsing
    payload: Optional[dict[str, Any]] = None
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            payload = parsed
    except Exception:
        pass

    # If first attempt didn't produce a dict, apply iOS clipboard cleaning
    if payload is None:
        candidate = text
        # Strip markdown code blocks (e.g. ```json ... ```)
        if candidate.startswith("```"):
            lines = candidate.splitlines()
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            candidate = "\n".join(lines).strip()

        # Replace iOS smart/curly quotes with standard ASCII quotes
        candidate = (
            candidate.replace("“", '"')
            .replace("”", '"')
            .replace("„", '"')
            .replace("‘", "'")
            .replace("’", "'")
        )

        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                payload = parsed
        except Exception:
            pass

        # If wrapped in surrounding prose (e.g. ChatGPT chat copy), extract the outermost JSON object
        if payload is None:
            start_idx = candidate.find("{")
            end_idx = candidate.rfind("}")
            if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                try:
                    parsed = json.loads(candidate[start_idx : end_idx + 1])
                    if isinstance(parsed, dict):
                        payload = parsed
                except Exception:
                    pass

        # If URL-encoded, unquote and re-attempt
        if payload is None and ("%" in candidate or "+" in candidate):
            import urllib.parse
            unquoted = urllib.parse.unquote_plus(candidate)
            try:
                parsed = json.loads(unquoted)
                if isinstance(parsed, dict):
                    payload = parsed
            except Exception:
                start_idx = unquoted.find("{")
                end_idx = unquoted.rfind("}")
                if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                    try:
                        parsed = json.loads(unquoted[start_idx : end_idx + 1])
                        if isinstance(parsed, dict):
                            payload = parsed
                    except Exception:
                        pass

        # If key-value bullet points (e.g. copied from markdown summary)
        if payload is None and ":" in candidate:
            kv_candidate: dict[str, Any] = {}
            for line in candidate.splitlines():
                line = line.strip().lstrip("-*•").strip()
                if ":" in line:
                    k, v = line.split(":", 1)
                    k = k.strip().strip("'\"").lower().replace(" ", "_")
                    v = v.strip().strip("'\"")
                    if k and v:
                        kv_candidate[k] = v
            if "expression" in kv_candidate:
                payload = kv_candidate

        # If user copied just a single Japanese expression/word
        if payload is None and candidate and len(candidate) <= 100 and "{" not in candidate and ":" not in candidate and "\n" not in candidate:
            payload = {"expression": candidate}

    if not isinstance(payload, dict):
        preview = text[:100] if text else "<EMPTY BODY>"
        log.warning("Malformed card payload (%d bytes): %r", len(body_bytes), preview)
        try:
            from datetime import datetime, timezone
            dump_file = Path(__file__).parent / "last_failed_payload.txt"
            with open(dump_file, "w", encoding="utf-8") as f:
                f.write(f"TIMESTAMP: {datetime.now(timezone.utc).isoformat()}\n")
                f.write(f"CONTENT-TYPE: {request.headers.get('content-type')}\n")
                f.write(f"BYTES_LEN: {len(body_bytes)}\n")
                f.write(f"RAW_BODY:\n{text}\n")
        except (OSError, IOError) as write_err:
            log.debug("Could not write diagnostic last_failed_payload.txt: %s", write_err)
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Malformed payload: received {preview!r}. Copy the JSON card to your clipboard before running Shortcut.",
        )

    expression_val = payload.get("expression")
    if not isinstance(expression_val, str) or not expression_val.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Field 'expression' is required and must be a non-empty string.",
        )

    # Validate types of known textual fields if provided
    string_field_names = [
        "reading", "meaning", "sentence", "example_sentence",
        "sentence_meaning", "example_translation", "notes",
        "hint", "context", "source_text", "jlpt_level", "jlpt",
        "deck_name", "model_name",
    ]
    for fn in string_field_names:
        if fn in payload and payload[fn] is not None and not isinstance(payload[fn], str):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Field '{fn}' must be a string if provided.",
            )

    card = VocabCard.from_dict(payload)

    try:
        item_id, is_duplicate = store.enqueue(card)
        log.info("Successfully queued card for '%s' (item_id=%s, duplicate=%s)", card.expression, item_id, is_duplicate)
        return JSONResponse({
            "status": "queued",
            "id": item_id,
            "is_duplicate": is_duplicate,
            "expression": card.expression,
            "message": f"Card for '{card.expression}' successfully queued.",
        })
    except Exception as exc:
        log.exception("Database error persisting card: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to commit card to durable storage.",
        )


# ---------------------------------------------------------------------------
# Worker Queue Endpoints (Local Windows PC Worker Interface)
# ---------------------------------------------------------------------------

@app.get("/pending")
async def fetch_pending_endpoint(request: Request, limit: int = 20) -> JSONResponse:
    """Worker endpoint to fetch pending cards and atomically claim leases."""
    _authenticate_worker(request)
    limit = min(max(1, limit), 100)
    items = store.claim_pending(limit=limit)
    return JSONResponse({
        "status": "ok",
        "items": [
            {
                "id": it.id,
                "card": it.card.to_dict(),
                "status": it.status,
                "attempts": it.attempts,
                "claim_token": getattr(it, "claim_token", ""),
                "error": it.error,
                "created_at": it.created_at,
                "updated_at": it.updated_at,
            }
            for it in items
        ],
    })


@app.post("/ack/{item_id}")
async def ack_item_endpoint(item_id: str, request: Request) -> JSONResponse:
    """Worker endpoint to acknowledge successful downstream processing in Kiroku/Anki."""
    _authenticate_worker(request)
    claim_token: Optional[str] = None
    try:
        body = await request.json()
        if isinstance(body, dict):
            claim_token = body.get("claim_token")
    except Exception:
        pass

    success = store.ack(item_id, claim_token=claim_token)
    if not success:
        return JSONResponse(
            {"status": "error", "message": f"Item {item_id} not found or claim token expired/invalid."},
            status_code=status.HTTP_404_NOT_FOUND,
        )
    return JSONResponse({"status": "ok", "id": item_id})


@app.post("/nack/{item_id}")
async def nack_item_endpoint(item_id: str, request: Request) -> JSONResponse:
    """Worker endpoint to release claim or report processing failure."""
    _authenticate_worker(request)
    error = ""
    claim_token: Optional[str] = None
    try:
        body = await request.json()
        if isinstance(body, dict):
            error = str(body.get("error", ""))
            claim_token = body.get("claim_token")
    except Exception:
        pass

    success = store.nack(item_id, error=error, claim_token=claim_token)
    return JSONResponse({"status": "ok", "id": item_id, "recorded": success})


@app.get("/stats")
async def stats_endpoint(request: Request) -> JSONResponse:
    """Worker/diagnostic endpoint for queue metrics."""
    _authenticate_worker(request)
    return JSONResponse(store.stats())


@app.get("/recent")
async def recent_cards_endpoint(request: Request, limit: int = 20) -> JSONResponse:
    """
    Returns the most recently submitted cards, newest first.
    Authenticated with SUBMIT_TOKEN (same token used by iPhone Shortcut).
    """
    _authenticate_submit(request)
    limit = min(max(1, limit), 50)
    items = store.recent(limit=limit)
    return JSONResponse({
        "status": "ok",
        "items": items,
        "count": len(items),
    })


# ---------------------------------------------------------------------------
# Mobile & Desktop Web Dashboard (Read-Only)
# ---------------------------------------------------------------------------

_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Kiroku">
  <title>Kiroku · Recent Cards</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0b0d13;
      --surface: #141722;
      --surface-hover: #1b2030;
      --border: #232838;
      --text: #f1f3f9;
      --text-muted: #828a9e;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.15);
      --green: #22c55e;
      --green-bg: rgba(34, 197, 94, 0.12);
      --yellow: #f59e0b;
      --yellow-bg: rgba(245, 158, 11, 0.12);
      --red: #ef4444;
      --red-bg: rgba(239, 68, 68, 0.12);
      --radius: 12px;
      --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      --font-ja: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", Meiryo, sans-serif;
    }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-ui);
      min-height: 100vh;
      padding: max(1.25rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(2rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .brand-icon {
      font-size: 1.35rem;
      background: var(--accent-glow);
      color: var(--accent);
      width: 36px;
      height: 36px;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }
    h1 {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    h1 span {
      color: var(--accent);
      font-size: 0.85em;
      font-weight: 500;
      margin-left: 0.3rem;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    button.icon-btn {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text-muted);
      border-radius: 8px;
      padding: 0.45rem 0.65rem;
      font-size: 0.82rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      transition: all 0.15s ease;
    }
    button.icon-btn:hover, button.icon-btn:active {
      color: var(--text);
      background: var(--surface-hover);
      border-color: var(--text-muted);
    }
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.5rem;
      margin-bottom: 1.25rem;
    }
    .stat-pill {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.55rem 0.6rem;
      text-align: center;
    }
    .stat-num {
      font-size: 1.1rem;
      font-weight: 700;
      line-height: 1.2;
    }
    .stat-lbl {
      font-size: 0.68rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-top: 0.15rem;
    }
    .stat-num.done { color: var(--green); }
    .stat-num.pending { color: var(--yellow); }
    .stat-num.failed { color: var(--red); }
    .stat-num.total { color: var(--text); }

    /* FUTURE_SCOPE: All-time universal stats & local PC sync section placeholder */
    #future-stats-panel {
      display: none; /* Reserved for local backend sync & AnkiConnect metrics */
    }

    #token-box {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.15rem;
      margin-bottom: 1.25rem;
    }
    #token-box h2 {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 0.35rem;
    }
    #token-box p {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 0.85rem;
      line-height: 1.4;
    }
    .token-input-row {
      display: flex;
      gap: 0.5rem;
    }
    .token-input-row input {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      padding: 0.55rem 0.75rem;
      font-size: 0.85rem;
      outline: none;
      font-family: monospace;
    }
    .token-input-row input:focus {
      border-color: var(--accent);
    }
    .token-input-row button {
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 0.55rem 1rem;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    #card-list {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .card-item {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.85rem 1rem;
      transition: border-color 0.15s ease, background-color 0.15s ease;
    }
    .card-item:active {
      background: var(--surface-hover);
    }
    .card-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.2rem;
    }
    .expr-wrap {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .expr {
      font-family: var(--font-ja);
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .reading {
      font-family: var(--font-ja);
      font-size: 0.88rem;
      color: var(--text-muted);
    }
    .status-badge {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.2rem 0.5rem;
      border-radius: 20px;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
    }
    .status-badge.completed {
      background: var(--green-bg);
      color: var(--green);
      border: 1px solid rgba(34, 197, 94, 0.25);
    }
    .status-badge.pending, .status-badge.claimed {
      background: var(--yellow-bg);
      color: var(--yellow);
      border: 1px solid rgba(245, 158, 11, 0.25);
    }
    .status-badge.failed {
      background: var(--red-bg);
      color: var(--red);
      border: 1px solid rgba(239, 68, 68, 0.25);
    }
    .meaning {
      font-size: 0.9rem;
      color: var(--text);
      line-height: 1.35;
      margin-bottom: 0.35rem;
    }
    .meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.72rem;
      color: var(--text-muted);
      border-top: 1px dashed rgba(255, 255, 255, 0.06);
      padding-top: 0.35rem;
      margin-top: 0.35rem;
    }
    .deck-tag {
      background: rgba(255, 255, 255, 0.05);
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
    }
    .error-box {
      font-size: 0.75rem;
      color: var(--red);
      background: var(--red-bg);
      border-radius: 6px;
      padding: 0.35rem 0.5rem;
      margin-top: 0.4rem;
    }
    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-muted);
    }
    .empty-state .icon {
      font-size: 2.2rem;
      margin-bottom: 0.6rem;
      opacity: 0.6;
    }
    .empty-state p {
      font-size: 0.85rem;
      line-height: 1.5;
    }
    footer {
      text-align: center;
      margin-top: 2rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
    }
    .dot-live {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      display: inline-block;
      animation: pulse 2s infinite ease-in-out;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-icon">記</div>
        <div>
          <h1>Kiroku <span>Cloud</span></h1>
        </div>
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="refresh-btn" onclick="fetchRecent(true)" title="Refresh now">
          <span id="refresh-icon">↻</span> Refresh
        </button>
        <button class="icon-btn" onclick="toggleTokenBox()" title="Configure Access Token">
          ⚙ Key
        </button>
      </div>
    </header>

    <div class="stats-bar" id="stats-bar">
      <div class="stat-pill"><div class="stat-num total" id="stat-total">-</div><div class="stat-lbl">Recent</div></div>
      <div class="stat-pill"><div class="stat-num done" id="stat-done">-</div><div class="stat-lbl">Synced</div></div>
      <div class="stat-pill"><div class="stat-num pending" id="stat-pending">-</div><div class="stat-lbl">Pending</div></div>
      <div class="stat-pill"><div class="stat-num failed" id="stat-failed">-</div><div class="stat-lbl">Failed</div></div>
    </div>

    <!-- FUTURE_SCOPE: Hook container for all-time universal statistics -->
    <div id="future-stats-panel"></div>

    <div id="token-box" style="display: none;">
      <h2>Submit Token Configuration</h2>
      <p>Enter your <code>SUBMIT_TOKEN</code> or <code>PHONE_SECRET</code>. Saved only in your device's <code>localStorage</code>.</p>
      <div class="token-input-row">
        <input type="password" id="token-input" placeholder="Paste Bearer token..." autocomplete="off">
        <button onclick="saveToken()">Save</button>
      </div>
    </div>

    <div id="card-list">
      <div class="empty-state">
        <div class="icon">⏳</div>
        <p>Loading recent cards...</p>
      </div>
    </div>

    <footer>
      <span class="dot-live"></span>
      <span id="footer-status">Auto-refresh active (30s)</span>
    </footer>
  </div>

  <script>
    const STORAGE_KEY = 'kiroku_submit_token';

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function timeAgo(dateString) {
      if (!dateString) return '';
      const now = new Date();
      const past = new Date(dateString);
      const diffSec = Math.floor((now.getTime() - past.getTime()) / 1000);
      if (isNaN(diffSec) || diffSec < 0) return 'just now';
      if (diffSec < 45) return 'just now';
      if (diffSec < 90) return '1m ago';
      if (diffSec < 3600) return Math.floor(diffSec / 60) + 'm ago';
      if (diffSec < 7200) return '1h ago';
      if (diffSec < 86400) return Math.floor(diffSec / 3600) + 'h ago';
      return Math.floor(diffSec / 86400) + 'd ago';
    }

    function getToken() {
      return localStorage.getItem(STORAGE_KEY) || '';
    }

    function toggleTokenBox() {
      const box = document.getElementById('token-box');
      box.style.display = box.style.display === 'none' ? 'block' : 'none';
      if (box.style.display === 'block') {
        const inp = document.getElementById('token-input');
        inp.value = getToken();
        inp.focus();
      }
    }

    function saveToken() {
      const val = document.getElementById('token-input').value.trim();
      if (val) {
        localStorage.setItem(STORAGE_KEY, val);
        document.getElementById('token-box').style.display = 'none';
        fetchRecent(true);
      }
    }

    async function fetchRecent(manual = false) {
      const token = getToken();
      const listEl = document.getElementById('card-list');
      const footerStatus = document.getElementById('footer-status');

      if (!token) {
        document.getElementById('token-box').style.display = 'block';
        listEl.innerHTML = `
          <div class="empty-state">
            <div class="icon">🔑</div>
            <p><strong>Submit token required</strong><br>Enter your token above to view recent cards.</p>
          </div>
        `;
        return;
      }

      if (manual) {
        footerStatus.textContent = 'Updating...';
      }

      try {
        const resp = await fetch('/recent?limit=25', {
          headers: {
            'Authorization': 'Bearer ' + token
          }
        });

        if (resp.status === 401) {
          document.getElementById('token-box').style.display = 'block';
          listEl.innerHTML = `
            <div class="empty-state">
              <div class="icon">🚫</div>
              <p><strong>Invalid Token</strong><br>The token was rejected. Please re-enter your submit token above.</p>
            </div>
          `;
          footerStatus.textContent = 'Auth failed';
          return;
        }

        if (!resp.ok) {
          throw new Error('Server responded with HTTP ' + resp.status);
        }

        const data = await resp.json();
        const items = data.items || [];

        let completedCount = 0;
        let pendingCount = 0;
        let failedCount = 0;

        items.forEach(it => {
          if (it.status === 'completed') completedCount++;
          else if (it.status === 'failed') failedCount++;
          else pendingCount++;
        });

        document.getElementById('stat-total').textContent = items.length;
        document.getElementById('stat-done').textContent = completedCount;
        document.getElementById('stat-pending').textContent = pendingCount;
        document.getElementById('stat-failed').textContent = failedCount;

        if (items.length === 0) {
          listEl.innerHTML = `
            <div class="empty-state">
              <div class="icon">📥</div>
              <p><strong>No cards submitted yet</strong><br>Use your iPhone Shortcut to send vocabulary here.</p>
            </div>
          `;
        } else {
          listEl.innerHTML = items.map(item => {
            const st = item.status || 'pending';
            let badgeClass = 'pending';
            let badgeText = 'Queued';
            if (st === 'completed') {
              badgeClass = 'completed';
              badgeText = 'Synced';
            } else if (st === 'failed') {
              badgeClass = 'failed';
              badgeText = 'Failed';
            } else if (st === 'claimed') {
              badgeClass = 'pending';
              badgeText = 'Processing';
            }

            return `
              <div class="card-item">
                <div class="card-top">
                  <div class="expr-wrap">
                    <span class="expr">${escapeHtml(item.expression)}</span>
                    ${item.reading ? `<span class="reading">${escapeHtml(item.reading)}</span>` : ''}
                  </div>
                  <span class="status-badge ${badgeClass}">${badgeText}</span>
                </div>
                ${item.meaning ? `<div class="meaning">${escapeHtml(item.meaning)}</div>` : ''}
                <div class="meta-row">
                  <span class="deck-tag">${escapeHtml(item.deck_name || 'N3 vocabs')}</span>
                  <span>${timeAgo(item.created_at)}</span>
                </div>
                ${item.error ? `<div class="error-box">⚠ ${escapeHtml(item.error)}</div>` : ''}
              </div>
            `;
          }).join('');
        }

        const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        footerStatus.textContent = 'Updated at ' + nowStr + ' · auto-refreshes every 30s';
      } catch (err) {
        footerStatus.textContent = 'Connection error. Retrying in 30s...';
        if (manual) {
          listEl.innerHTML = `
            <div class="empty-state">
              <div class="icon">⚡</div>
              <p><strong>Could not connect to server</strong><br>${escapeHtml(err.message)}<br><small style="color:var(--text-muted)">If hosted on Render free tier, server may be waking up.</small></p>
            </div>
          `;
        }
      }
    }

    // Auto-refresh interval
    fetchRecent();
    setInterval(() => fetchRecent(false), 30000);
  </script>
</body>
</html>"""


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard_endpoint() -> HTMLResponse:
    """
    Public read-only dashboard page. Token is entered once client-side
    and stored in localStorage. Calls GET /recent via fetch().
    """
    return HTMLResponse(content=_DASHBOARD_HTML)


# ---------------------------------------------------------------------------
# MCP Streamable HTTP Endpoint (ChatGPT Protocol)
# ---------------------------------------------------------------------------

def _authenticate_mcp(request: Request) -> None:
    secret = os.getenv("MCP_SECRET", "") or MCP_SECRET
    if not secret:
        log.error("MCP_SECRET environment variable is not configured.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MCP endpoint is not configured (MCP_SECRET is unset).",
        )
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token.")
    token = auth[len("Bearer "):]
    if not secrets.compare_digest(token, secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")


def _mcp_result(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _mcp_error(req_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


@app.post("/mcp")
async def mcp_endpoint(request: Request) -> JSONResponse:
    _authenticate_mcp(request)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(_mcp_error(None, -32700, "Parse error: body is not valid JSON."))

    method = body.get("method", "")
    req_id = body.get("id")
    params = body.get("params") or {}

    if method == "initialize":
        return JSONResponse(_mcp_result(req_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "serverInfo": SERVER_INFO,
            "capabilities": {"tools": {}},
        }))

    if method == "tools/list":
        return JSONResponse(_mcp_result(req_id, {"tools": TOOLS}))

    if method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments") or {}

        if tool_name == "send_vocab_card":
            result = await handle_send_vocab_card(arguments)
            text = json.dumps(result, ensure_ascii=False)
            return JSONResponse(_mcp_result(req_id, {
                "content": [{"type": "text", "text": text}],
                "isError": result.get("status") == "error",
            }))

        return JSONResponse(
            _mcp_error(req_id, -32601, f"Unknown tool: {tool_name!r}"),
            status_code=200,
        )

    if method == "notifications/initialized":
        return JSONResponse({})

    return JSONResponse(
        _mcp_error(req_id, -32601, f"Method not found: {method!r}"),
        status_code=200,
    )


# ---------------------------------------------------------------------------
# Health Endpoint
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> JSONResponse:
    """Public health endpoint. Verifies database connectivity without leaking credentials."""
    backend_name = os.getenv("QUEUE_BACKEND", "local")
    db_status = "connected"
    q_stats: dict[str, Any] = {}
    try:
        q_stats = store.stats()
    except Exception as exc:
        db_status = f"error: {exc}"
        q_stats = {"error": str(exc)}

    return JSONResponse({
        "status": "ok",
        "backend": backend_name,
        "database": db_status,
        "is_configured": True,
        "queue_stats": q_stats,
    })


# ---------------------------------------------------------------------------
# CLI Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="Kiroku Cloud Queue Ingestion Server")
    default_host = "0.0.0.0" if (os.getenv("RENDER") or os.getenv("PORT")) else os.getenv("QUEUE_HOST", "127.0.0.1")
    parser.add_argument(
        "--host",
        default=default_host,
        help="Host interface to bind (default: 0.0.0.0 in cloud/Render, else 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("QUEUE_PORT", os.getenv("PORT", os.getenv("MCP_PORT", "8100")))),
        help="Port to bind (default: 8100)",
    )
    args = parser.parse_args()

    log.info("Starting Kiroku Cloud Queue server on %s:%d ...", args.host, args.port)
    uvicorn.run("server:app", host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()

