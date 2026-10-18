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
from datetime import datetime, timezone
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


def _authenticate_recent(request: Request) -> None:
    """Validate token for recent cards / dashboard inspection (accepts SUBMIT_TOKEN or WORKER_TOKEN)."""
    token = _extract_bearer_token(request)
    allowed_tokens = [
        t for t in [
            os.getenv("SUBMIT_TOKEN"),
            os.getenv("PHONE_SECRET"),
            os.getenv("WORKER_TOKEN"),
            os.getenv("WORKER_SECRET"),
            os.getenv("CLOUD_QUEUE_API_KEY"),
        ] if t
    ]
    if not allowed_tokens:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server authentication secret (SUBMIT_TOKEN or WORKER_TOKEN) not configured.",
        )
    if not any(secrets.compare_digest(token, at) for at in allowed_tokens):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
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
    Authenticated with SUBMIT_TOKEN or WORKER_TOKEN.
    """
    _authenticate_recent(request)
    limit = min(max(1, limit), 50)
    items = store.recent(limit=limit)
    return JSONResponse({
        "status": "ok",
        "items": items,
        "count": len(items),
    })


@app.post("/api/stats/anki")
@app.post("/stats/anki")
async def save_anki_stats_endpoint(request: Request) -> JSONResponse:
    """Worker endpoint to push local Anki study metrics snapshot to cloud."""
    _authenticate_worker(request)
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Malformed JSON body: {exc}",
        )
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload must be a JSON object.",
        )
    store.save_anki_stats(payload)
    return JSONResponse({
        "status": "ok",
        "saved_at": payload.get("synced_at") or datetime.now(timezone.utc).isoformat(),
    })


@app.get("/api/stats/anki")
@app.get("/stats/anki")
async def get_anki_stats_endpoint(request: Request) -> JSONResponse:
    """Dashboard/client endpoint to retrieve latest Anki study metrics snapshot."""
    _authenticate_recent(request)
    data = store.get_anki_stats()
    if not data:
        return JSONResponse({
            "status": "empty",
            "message": "No Anki statistics synced yet. Run local worker with Anki open to sync.",
        })
    return JSONResponse({
        "status": "ok",
        "stats": data,
    })


# ---------------------------------------------------------------------------
# Anki Mirror Endpoints (Worker Write & Dashboard Read)
# ---------------------------------------------------------------------------

@app.post("/api/anki/cards")
async def save_anki_cards_endpoint(request: Request) -> JSONResponse:
    """Worker endpoint to push mirrored Anki card rows in batches (max 500)."""
    _authenticate_worker(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Malformed JSON body: {exc}")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Payload must be a JSON object.")

    cards = payload.get("cards", [])
    if not isinstance(cards, list):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="'cards' must be a list.")

    if len(cards) > 500:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Batch size limit exceeded: maximum 500 cards per request (received {len(cards)}).",
        )

    inserted = store.upsert_anki_cards(cards)
    return JSONResponse({
        "status": "ok",
        "inserted": inserted,
        "count": len(cards),
    })


@app.post("/api/anki/daily")
async def save_anki_daily_endpoint(request: Request) -> JSONResponse:
    """Worker endpoint to push daily review and card growth metrics (max 1000)."""
    _authenticate_worker(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Malformed JSON body: {exc}")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Payload must be a JSON object.")

    days = payload.get("days", [])
    if not isinstance(days, list):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="'days' must be a list.")

    if len(days) > 1000:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Batch size limit exceeded: maximum 1000 daily entries per request (received {len(days)}).",
        )

    inserted = store.upsert_anki_daily(days)
    return JSONResponse({
        "status": "ok",
        "inserted": inserted,
        "count": len(days),
    })


@app.post("/api/anki/reconcile")
async def reconcile_anki_cards_endpoint(request: Request) -> JSONResponse:
    """Worker endpoint to reconcile mirrored cards against all live Anki card IDs."""
    _authenticate_worker(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Malformed JSON body: {exc}")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Payload must be a JSON object.")

    card_ids = payload.get("card_ids")
    if not isinstance(card_ids, list):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="'card_ids' must be a list of integer IDs.")

    deleted = store.reconcile_anki_cards(card_ids)
    return JSONResponse({
        "status": "ok",
        "deleted": deleted,
        "reconciled_total": len(card_ids),
    })


@app.post("/api/anki/meta")
async def save_anki_meta_endpoint(request: Request) -> JSONResponse:
    """Worker endpoint to record sync metadata (key/value pairs or 'meta' mapping)."""
    _authenticate_worker(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Malformed JSON body: {exc}")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Payload must be a JSON object.")

    if "meta" in payload and isinstance(payload["meta"], dict):
        for k, v in payload["meta"].items():
            store.set_anki_meta(str(k), str(v))
    elif "key" in payload and "value" in payload:
        store.set_anki_meta(str(payload["key"]), str(payload["value"]))
    else:
        for k, v in payload.items():
            store.set_anki_meta(str(k), str(v))

    return JSONResponse({"status": "ok"})


@app.get("/api/cards")
async def query_cards_endpoint(
    request: Request,
    q: Optional[str] = None,
    state: Optional[str] = None,
    label: Optional[str] = None,
    deck: Optional[str] = None,
    jlpt: Optional[str] = None,
    due_within: Optional[int] = None,
    sort: str = "difficulty",
    dir: str = "desc",
    limit: int = 30,
    offset: int = 0,
) -> JSONResponse:
    """Dashboard endpoint to search, filter, and paginate mirrored Anki cards."""
    _authenticate_recent(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")

    limit = min(max(1, limit), 100)
    offset = max(0, offset)

    filters: dict[str, Any] = {}
    if q is not None and q.strip():
        filters["q"] = q.strip()
    if state is not None and state.strip():
        filters["state"] = state.strip()
    if label is not None and label.strip():
        filters["label"] = label.strip()
    if deck is not None and deck.strip():
        filters["deck"] = deck.strip()
    if jlpt is not None and jlpt.strip():
        filters["jlpt"] = jlpt.strip()
    if due_within is not None:
        filters["due_within"] = due_within

    try:
        items, total = store.query_anki_cards(
            filters=filters,
            sort=sort,
            dir=dir,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    status_data = store.get_anki_status()
    return JSONResponse({
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
        "synced_at": status_data.get("synced_at"),
    })


@app.get("/api/cards/{card_id}")
async def get_card_endpoint(card_id: int, request: Request) -> JSONResponse:
    """Dashboard endpoint to fetch a single mirrored card detail."""
    _authenticate_recent(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")

    card = store.get_anki_card(card_id)
    if not card:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Card {card_id} not found.")

    return JSONResponse({
        "status": "ok",
        "card": card,
    })


@app.get("/api/stats/overview")
async def get_stats_overview_endpoint(request: Request, range: str = "90d") -> JSONResponse:
    """Dashboard endpoint returning all comprehensive Anki stats series for the Stats tab."""
    _authenticate_recent(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")

    overview = store.get_stats_overview(range_key=range)
    return JSONResponse(overview)


@app.get("/api/anki/status")
async def get_anki_status_endpoint(request: Request) -> JSONResponse:
    """Dashboard endpoint returning mirror sync freshness, card count, and last reconcile."""
    _authenticate_recent(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")

    status_data = store.get_anki_status()
    return JSONResponse(status_data)


# ---------------------------------------------------------------------------
# Cloud Study Mode Endpoints (Extra Practice)
# ---------------------------------------------------------------------------

@app.get("/api/study/session")
async def get_study_session_endpoint(
    request: Request,
    mode: str = "weakest",
    level: Optional[str] = None,
    limit: int = 20,
    card_ids: Optional[str] = None,
    custom_ids: Optional[str] = None,
) -> JSONResponse:
    """Dashboard endpoint to seed a cloud study session."""
    _authenticate_recent(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")

    raw_ids = card_ids or custom_ids
    parsed_ids: Optional[list[int]] = None
    if raw_ids:
        try:
            parsed_ids = [int(x.strip()) for x in raw_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="card_ids must be comma-separated integers.")

    limit = min(max(1, limit), 100)
    cards = store.get_study_session(mode=mode, level=level, limit=limit, custom_card_ids=parsed_ids)
    return JSONResponse({
        "status": "ok",
        "mode": mode,
        "count": len(cards),
        "cards": cards,
    })


@app.post("/api/study/review")
async def record_study_review_endpoint(request: Request) -> JSONResponse:
    """Dashboard endpoint to record an extra-practice review using 5-box Leitner scheduling."""
    _authenticate_recent(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Malformed JSON body: {exc}")

    if not isinstance(payload, dict):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Payload must be a JSON object.")

    card_id = payload.get("card_id")
    if not isinstance(card_id, int):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="'card_id' must be an integer.")

    rating = payload.get("rating")
    if not isinstance(rating, int) or rating not in (1, 2, 3, 4):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="'rating' must be 1 (Again), 2 (Hard), 3 (Good), or 4 (Easy).")

    time_ms = payload.get("time_ms", 0)
    session_id = payload.get("session_id")
    review_uuid = payload.get("review_uuid")

    try:
        result = store.record_study_review(
            card_id=card_id,
            rating=rating,
            time_ms=int(time_ms) if isinstance(time_ms, (int, float)) else 0,
            session_id=str(session_id) if session_id else None,
            review_uuid=str(review_uuid) if review_uuid else None,
        )
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Card {card_id} not found in mirror.")

    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Card {card_id} not found in mirror.")

    return JSONResponse({"status": "ok", **result})


@app.get("/api/study/summary")
async def get_study_summary_endpoint(request: Request) -> JSONResponse:
    """Dashboard endpoint returning cloud practice stats (practiced today, 7d, box distribution)."""
    _authenticate_recent(request)
    if store is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Queue store not initialized.")

    summary = store.get_study_summary()
    return JSONResponse({"status": "ok", **summary})
# ---------------------------------------------------------------------------
# Mobile & Desktop Web Dashboard (Read-Only)
# ---------------------------------------------------------------------------

from dashboard_template import DASHBOARD_HTML as _DASHBOARD_HTML


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

