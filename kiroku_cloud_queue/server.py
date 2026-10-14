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
from fastapi.responses import JSONResponse

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

