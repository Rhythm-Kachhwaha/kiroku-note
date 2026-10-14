"""
server.py -- MCP server for Japanese vocabulary card ingestion.

Protocol:  MCP Streamable HTTP transport (2025-03-26 / 2024-11-05 protocol version)
Endpoint:  POST /mcp
Auth:      Authorization: Bearer <MCP_SECRET>
Tool:      send_vocab_card(expression, reading, meaning, sentence?)

Role in Target Architecture:
  - Runs in the cloud (or locally during development).
  - Receives vocabulary card submissions from ChatGPT conversations.
  - Enqueues cards into the persistent queue (cloud queue in production, local dev queue in testing).
  - Decoupled from Kiroku and Anki: Kiroku on the user's PC does NOT need to be reachable
    when ChatGPT calls this server. A separate local worker (worker.py) retrieves pending cards
    and forwards them to Kiroku when the PC is online.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse

from queue_adapter import (
    CloudQueueNotConfiguredError,
    QueueError,
    VocabCard,
    get_queue_adapter,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mcp_anki_server")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MCP_SECRET = os.getenv("MCP_SECRET", "")
ANKI_DECK_NAME = os.getenv("ANKI_DECK_NAME", "N3 vocabs")

SERVER_INFO = {
    "name": "kiroku-anki-mcp",
    "version": "1.1.0",
}

PROTOCOL_VERSION = "2024-11-05"

# ---------------------------------------------------------------------------
# MCP Tool Definition (Static)
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
                "deck_name": {
                    "type": "string",
                    "description": "Optional target Anki deck name. Defaults to 'N3 vocabs'.",
                },
            },
            "required": ["expression", "reading", "meaning"],
        },
    }
]


# ---------------------------------------------------------------------------
# Tool Handler
# ---------------------------------------------------------------------------

async def handle_send_vocab_card(args: dict[str, Any]) -> dict[str, Any]:
    """
    Validate vocabulary card arguments and enqueue to the configured queue adapter.
    """
    expression = (args.get("expression") or "").strip()
    reading = (args.get("reading") or "").strip()
    meaning = (args.get("meaning") or "").strip()
    sentence = (args.get("sentence") or "").strip()
    deck_name = (args.get("deck_name") or os.getenv("ANKI_DECK_NAME", "N3 vocabs")).strip() or "N3 vocabs"


    if not expression:
        return {"status": "error", "message": "expression is required and must not be blank."}
    if not meaning:
        return {"status": "error", "message": "meaning is required and must not be blank."}

    card = VocabCard(
        expression=expression,
        reading=reading,
        meaning=meaning,
        sentence=sentence,
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

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Verify adapter initializes safely on startup
    adapter = get_queue_adapter()
    backend_name = os.getenv("QUEUE_BACKEND", "local")
    log.info("MCP server started with queue backend: '%s' (%s)", backend_name, type(adapter).__name__)
    yield


app = FastAPI(title="MCP Anki Ingestion Server", lifespan=lifespan, docs_url=None, redoc_url=None)


def _authenticate(request: Request) -> None:
    """Validate Bearer token from MCP client. Raises 401 on failure."""
    if not MCP_SECRET:
        raise RuntimeError(
            "MCP_SECRET environment variable is not set. "
            "Set it before starting the server."
        )
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Bearer token.")
    token = auth[len("Bearer "):]
    if not secrets.compare_digest(token, MCP_SECRET):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")


def _mcp_result(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _mcp_error(req_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


@app.post("/mcp")
async def mcp_endpoint(request: Request) -> JSONResponse:
    """
    Unified Streamable HTTP MCP endpoint.
    Handles: initialize, tools/list, tools/call
    """
    _authenticate(request)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(_mcp_error(None, -32700, "Parse error: body is not valid JSON."))

    method = body.get("method", "")
    req_id = body.get("id")
    params = body.get("params") or {}

    # --- initialize ---
    if method == "initialize":
        return JSONResponse(_mcp_result(req_id, {
            "protocolVersion": PROTOCOL_VERSION,
            "serverInfo": SERVER_INFO,
            "capabilities": {"tools": {}},
        }))

    # --- tools/list ---
    if method == "tools/list":
        return JSONResponse(_mcp_result(req_id, {"tools": TOOLS}))

    # --- tools/call ---
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

    # --- notifications/initialized (no response needed, return 200) ---
    if method == "notifications/initialized":
        return JSONResponse({})

    # --- unknown method ---
    return JSONResponse(
        _mcp_error(req_id, -32601, f"Method not found: {method!r}"),
        status_code=200,
    )


@app.get("/health")
async def health() -> JSONResponse:
    """Public health endpoint (no auth). Used by health checks."""
    backend_name = os.getenv("QUEUE_BACKEND", "local")
    adapter = get_queue_adapter()
    stats: dict[str, Any] = {}
    is_configured = True

    try:
        stats = await adapter.stats()
    except CloudQueueNotConfiguredError:
        is_configured = False
        stats = {"warning": "Cloud queue is not configured yet"}
    except Exception as exc:
        stats = {"error": str(exc)}

    return JSONResponse({
        "status": "ok",
        "backend": backend_name,
        "adapter": type(adapter).__name__,
        "is_configured": is_configured,
        "queue_stats": stats,
    })
