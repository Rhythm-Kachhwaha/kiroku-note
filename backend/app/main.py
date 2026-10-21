import asyncio
import base64
import csv
import io
import logging
import os
import re
import time
from contextlib import asynccontextmanager

from typing import Any, Union

from fastapi import Body, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from app.config import APP_VERSION
from app.db.connection import db_session, init_db
from app.services.media_storage import MediaStorageService
from app.schemas import (
    AnkiDecksResponse,
    AnkiModelCapabilitiesResponse,
    AnkiModelsResponse,
    AnkiStatusResponse,
    BulkDeckUpdateRequest,
    BulkDeckUpdateResponse,
    BulkDeleteCardsRequest,
    BulkDeleteCardsResponse,
    BulkSyncCardsRequest,
    CaptureRequest,
    CaptureResponse,
    CardDetailResponse,
    CardListResponse,
    CardStatsResponse,
    DeleteCardResponse,
    HealthResponse,
    LLMConfigResponse,
    LLMConfigUpdateRequest,
    LLMRequest,
    LLMResponse,
    LLMSecretDeleteResponse,
    LLMSecretSaveRequest,
    LLMSecretSaveResponse,
    LLMStatusResponse,
    LLMTestRequest,
    LLMTestResponse,
    OcrRecognizeRequest,
    OcrRecognizeResponse,
    OcrStatusResponse,
    SaveCardRequest,
    SaveCardResponse,
    SyncAllResponse,
    SyncCardResponse,
    YomitanDictionariesResponse,
)
from app.config import (
    APP_VERSION,
    get_llm_api_key,
    get_llm_jlpt_level,
    get_llm_key_name,
    get_llm_model,
    get_llm_ollama_url,
    get_llm_provider,
    is_llm_configured,
    load_stored_llm_config,
    resolve_default_llm_model,
    resolve_llm_timeout,
    save_stored_llm_config,
    VALID_JLPT_LEVELS,
)
from app.services.card_service import CardService
from app.services.ocr_service import (
    OcrError,
    OcrResponseError,
    OcrService,
    OcrTimeoutError,
    OcrUnavailableError,
)
from app.services.jlpt_reference import JlptReferenceService
from app.services.llm_service import (
    LLMAPIError,
    LLMConnectionError,
    LLMError,
    LLMNotConfiguredError,
    LLMResponseError,
    LLMTimeoutError,
    get_llm_service,
)
from app.services.yomitan import YomitanError, YomitanService

# Debug mode: set KIROKU_DEBUG=1 to enable /docs, /redoc, and hot-reload.
# Off by default so production/distributed builds do not expose developer APIs.
_debug = os.getenv("KIROKU_DEBUG", "").strip().lower() in ("1", "true", "yes")

ALLOWED_ORIGIN_REGEX = r"^(chrome-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$"
ALLOWED_ORIGIN_PATTERN = re.compile(ALLOWED_ORIGIN_REGEX)
ALLOWED_HOST_PATTERN = re.compile(r"^(localhost|127\.0\.0\.1|testserver)(:\d+)?$", re.IGNORECASE)

from app.services.ocr_process_manager import OcrProcessManager


log = logging.getLogger("kiroku_backend")
CLOUD_AUTO_POLL_INTERVAL_SECONDS = 150.0


def _setup_cloud_queue_path() -> None:
    """Ensure kiroku_cloud_queue directory is on sys.path for both dev and frozen environments."""
    import sys
    from pathlib import Path

    if getattr(sys, "frozen", False):
        candidates = [
            Path(getattr(sys, "_MEIPASS", "")) / "kiroku_cloud_queue",
            Path(sys.executable).resolve().parent / "_internal" / "kiroku_cloud_queue",
            Path(sys.executable).resolve().parent / "kiroku_cloud_queue",
        ]
        for c in candidates:
            if c.exists() and str(c) not in sys.path:
                sys.path.insert(0, str(c))
    else:
        project_root = Path(__file__).resolve().parent.parent.parent
        cloud_queue_dir = project_root / "kiroku_cloud_queue"
        if str(cloud_queue_dir) not in sys.path and cloud_queue_dir.exists():
            sys.path.insert(0, str(cloud_queue_dir))


async def _execute_cloud_poll_cycle() -> dict[str, Any]:
    """
    Execute one cycle of cloud sync:
    1. Drain pending vocabulary cards from cloud queue to local SQLite without pushing to Anki.
    2. If Anki is open, sync real study statistics and mirror cards/reviews to the cloud.
    All steps gracefully skip when Anki is closed or cloud queue is unconfigured.
    """
    summary: dict[str, Any] = {
        "status": "ok",
        "fetched": 0,
        "processed": 0,
        "duplicates": 0,
        "failed": 0,
        "skipped_offline": False,
        "anki_stats_synced": False,
        "anki_mirror_status": "skipped",
        "message": "Sync cycle completed.",
    }
    _setup_cloud_queue_path()
    try:
        from worker import process_batch, sync_anki_stats_to_cloud
        from anki_mirror import sync_anki_mirror
        from queue_adapter import CloudQueueNotConfiguredError, QueueError, get_queue_adapter
    except ImportError as e:
        log.debug("Cloud queue modules not importable: %s", e)
        summary.update(status="error", message=f"Cloud queue module unavailable: {e}")
        return summary

    try:
        adapter = get_queue_adapter()
    except CloudQueueNotConfiguredError as exc:
        summary.update(status="not_configured", message=str(exc))
        return summary
    except Exception as exc:
        log.debug("Cloud queue adapter not configured or failed to initialize: %s", exc)
        summary.update(status="error", message=str(exc))
        return summary

    # Step 1: Pull and drain pending cards to local SQLite
    try:
        batch_res = await process_batch(adapter=adapter, auto_sync=False)
        summary.update(
            fetched=batch_res.total_fetched,
            processed=batch_res.processed,
            duplicates=batch_res.duplicates,
            failed=batch_res.failed,
            skipped_offline=batch_res.skipped_offline,
        )
        if batch_res.processed > 0:
            log.info("Cloud auto-poll imported %d card(s) to local database.", batch_res.processed)
    except CloudQueueNotConfiguredError:
        log.debug("Cloud queue not configured; skipping auto-poll.")
        summary.update(status="not_configured", message="Cloud queue is not configured.")
        return summary
    except QueueError as q_err:
        log.warning("Cloud queue auto-poll error: %s", q_err)
        summary.update(status="error", message=f"Cloud queue error: {q_err}")
    except Exception as exc:
        log.debug("Cloud auto-poll exception: %s", exc)
        summary.update(status="error", message=f"Cloud queue sync failed: {exc}")

    # Step 2: Sync Anki stats to cloud (gracefully skips if Anki is closed)
    try:
        summary["anki_stats_synced"] = await sync_anki_stats_to_cloud(adapter=adapter, sync_mirror=False)
    except Exception as exc:
        log.debug("Background Anki stats sync skipped or failed: %s", exc)

    # Step 3: Mirror Anki cards and status (leeches, lapses, state, new cards) to cloud
    try:
        mirror_res = await sync_anki_mirror(adapter, full=False)
        summary["anki_mirror_status"] = mirror_res.status
        if mirror_res.status == "ok":
            log.info(
                "Anki mirror sync: seen=%d, changed=%d, pushed=%d, daily=%d",
                mirror_res.cards_seen,
                mirror_res.cards_changed,
                mirror_res.cards_pushed,
                mirror_res.daily_rows_pushed,
            )
        elif mirror_res.status == "offline":
            log.debug("Anki is offline; skipping card mirror sync.")
        else:
            log.debug("Anki mirror sync status: %s (%s)", mirror_res.status, mirror_res.message)
    except Exception as exc:
        summary["anki_mirror_status"] = "error"
        log.debug("Background Anki card mirror sync skipped or failed: %s", exc)

    if summary["status"] == "ok":
        if summary["processed"]:
            summary["message"] = f"Imported {summary['processed']} new card(s) from cloud queue."
        elif summary["anki_mirror_status"] == "offline":
            summary["message"] = "No new cloud cards; Anki is offline."
        else:
            summary["message"] = "Sync complete; cloud queue is up to date."
    return summary


async def _cloud_auto_poll_task(interval_seconds: float = CLOUD_AUTO_POLL_INTERVAL_SECONDS) -> None:
    """
    Background worker loop:
    Waits 5 seconds after startup for backend socket binding, then performs an initial poll.
    Thereafter, polls every interval_seconds (default 2.5 minutes / 150s) until cancelled.
    """
    try:
        await asyncio.sleep(5.0)
        await _execute_cloud_poll_cycle()
        while True:
            await asyncio.sleep(interval_seconds)
            await _execute_cloud_poll_cycle()
    except asyncio.CancelledError:
        log.debug("Cloud auto-poll background task cancelled.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # On Kiroku backend startup: if OCR addon is installed, trigger one non-blocking start attempt
    pm = OcrProcessManager.get_instance()
    if pm.is_installed():
        pm.start(wait_for_health=False)

    # Start background cloud queue, stats, and card mirror sync every 2.5 minutes.
    poll_task = asyncio.create_task(
        _cloud_auto_poll_task(interval_seconds=CLOUD_AUTO_POLL_INTERVAL_SECONDS)
    )

    yield

    # On Kiroku backend shutdown: clean up background task and child OCR subprocess
    poll_task.cancel()
    try:
        await poll_task
    except (asyncio.CancelledError, Exception):
        pass
    pm.stop()


app = FastAPI(
    title="Kiroku Note Local API",
    lifespan=lifespan,
    docs_url="/docs" if _debug else None,
    redoc_url="/redoc" if _debug else None,
)


@app.middleware("http")
async def validate_request_security(request: Request, call_next):
    # 1. Host header validation (prevent DNS rebinding)
    host = request.headers.get("host")
    if host and not ALLOWED_HOST_PATTERN.match(host):
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Forbidden: Invalid Host header."},
        )

    # 2. State-changing methods Origin validation (prevent cross-site forged requests)
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("origin")
        if origin and not ALLOWED_ORIGIN_PATTERN.match(origin):
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Forbidden: Untrusted Origin."},
            )

    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)


_health_cache: dict[str, Any] = {
    "timestamp": 0.0,
    "response": None,
}
HEALTH_CACHE_TTL_SECONDS = 3.0


def clear_health_cache() -> None:
    """Helper to clear health cache for testing or manual refresh."""
    _health_cache["timestamp"] = 0.0
    _health_cache["response"] = None


@app.get("/api/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    now = time.monotonic()
    if (
        _health_cache["response"] is not None
        and (now - _health_cache["timestamp"]) < HEALTH_CACHE_TTL_SECONDS
    ):
        return _health_cache["response"]

    # 1. Database check
    db_ok = False
    try:
        with db_session() as conn:
            conn.execute("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False

    # 2. Yomitan check
    yomitan_ok = False
    try:
        yomitan_service = YomitanService()
        yomitan_ok = yomitan_service.check_availability()
    except Exception:
        yomitan_ok = False

    # 3. AnkiConnect check
    anki_ok = False
    try:
        card_service = CardService()
        anki_status = card_service.get_anki_status()
        anki_ok = bool(anki_status.connected)
    except Exception:
        anki_ok = False

    # 4. Standalone OCR check
    ocr_ok = False
    try:
        ocr_service = OcrService()
        ocr_status = ocr_service.get_status()
        ocr_ok = bool(ocr_status.available)
    except Exception:
        ocr_ok = False

    response = HealthResponse(
        status="ok",
        version=APP_VERSION,
        yomitan=yomitan_ok,
        ankiconnect=anki_ok,
        ocr=ocr_ok,
        db=db_ok,
    )
    _health_cache["timestamp"] = time.monotonic()
    _health_cache["response"] = response
    return response


@app.post("/api/cloud/poll")
async def trigger_cloud_poll() -> dict[str, Any]:
    """Manually trigger a cloud poll cycle to pull cards and sync Anki stats & mirror."""
    asyncio.create_task(_execute_cloud_poll_cycle())
    return {"status": "ok", "message": "Cloud sync initiated"}


@app.post("/api/capture", response_model=CaptureResponse)
def capture_term(request: CaptureRequest) -> CaptureResponse:
    service = CardService(yomitan_service=YomitanService())
    try:
        if request.auto_save:
            return service.capture_and_save(request.text, request.deck_name)
        return service.capture_term(request.text, request.deck_name)
    except YomitanError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error


@app.post("/api/cards/save", response_model=SaveCardResponse)
@app.post("/api/card/save", response_model=SaveCardResponse)
def save_card(request: SaveCardRequest) -> SaveCardResponse:
    service = CardService()
    return service.save_card(request)


@app.get("/api/yomitan/dictionaries", response_model=YomitanDictionariesResponse)
def get_available_yomitan_dictionaries() -> YomitanDictionariesResponse:
    service = YomitanService()
    dicts = service.discover_available_dictionaries()
    return YomitanDictionariesResponse(available_dictionaries=dicts)


@app.get("/api/dictionary/search-english")
def search_dictionary_english(
    query: str = Query(default="", max_length=100),
    limit: int = Query(default=20, ge=1, le=50),
):
    jlpt_service = JlptReferenceService()
    entries = jlpt_service.search_english(query=query, limit=limit)
    return {"entries": entries, "count": len(entries)}


@app.get("/api/anki/status", response_model=AnkiStatusResponse)
def get_anki_status() -> AnkiStatusResponse:
    service = CardService()
    return service.get_anki_status()


@app.get("/api/anki/decks", response_model=AnkiDecksResponse)
def get_anki_decks() -> AnkiDecksResponse:
    service = CardService()
    return service.get_anki_decks()


@app.get("/api/anki/models", response_model=AnkiModelsResponse)
def get_anki_models() -> AnkiModelsResponse:
    service = CardService()
    return service.get_anki_models()


@app.get("/api/anki/model-capabilities", response_model=AnkiModelCapabilitiesResponse)
def get_anki_model_capabilities(model_name: str | None = None) -> AnkiModelCapabilitiesResponse:
    service = CardService()
    caps = service.get_model_capabilities(model_name=model_name)
    return AnkiModelCapabilitiesResponse(**caps)


@app.post("/api/cards/{card_id}/sync", response_model=SyncCardResponse)
def sync_card(card_id: int, force: bool = False) -> SyncCardResponse:
    service = CardService()
    try:
        return service.sync_card(card_id, force=force)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error


@app.post("/api/cards/sync-all", response_model=SyncAllResponse)
@app.post("/api/anki/sync-all", response_model=SyncAllResponse)
def sync_all_cards(deck_name: str | None = None) -> SyncAllResponse:
    service = CardService()
    return service.sync_all(deck_name=deck_name)



@app.get("/api/cards", response_model=CardListResponse)
def list_cards(
    search: str | None = None,
    deck: str | None = None,
    deck_name: str | None = None,
    sync_status: str | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> CardListResponse:
    service = CardService()
    target_deck = deck or deck_name
    return service.list_cards(
        search=search,
        deck_name=target_deck,
        sync_status=sync_status,
        limit=limit,
        offset=offset,
    )


@app.get("/api/cards/export")
def export_cards_csv(
    deck: str | None = None,
    deck_name: str | None = None,
    filter_status: str | None = Query(default=None, alias="status"),
    sync_status: str | None = None,
    search: str | None = None,
) -> Response:
    service = CardService()
    target_deck = deck or deck_name
    target_status = filter_status or sync_status
    records = service.repository.list_cards(
        search=search,
        deck_name=target_deck,
        sync_status=target_status,
        limit=100000,
        offset=0,
    )
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["expression", "reading", "meaning", "jlpt_level", "deck", "sync_status", "created_at"])
    for r in records:
        writer.writerow([
            r.expression or "",
            r.reading or "",
            r.meaning or "",
            r.jlpt_level or "",
            r.deck_name or "",
            r.sync_status or "",
            r.created_at or "",
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="kiroku_cards.csv"'},
    )


@app.get("/api/cards/stats", response_model=CardStatsResponse)
def get_cards_stats() -> CardStatsResponse:
    service = CardService()
    return service.get_stats()


@app.delete("/api/cards/bulk", response_model=BulkDeleteCardsResponse)
def delete_cards_bulk(
    request: Union[BulkDeleteCardsRequest, list[int]] = Body(...),
) -> BulkDeleteCardsResponse:
    if isinstance(request, BulkDeleteCardsRequest):
        raw_ids = request.card_ids
    elif isinstance(request, list):
        raw_ids = request
    else:
        raw_ids = []
    service = CardService()
    count, deleted_ids = service.delete_many_cards(raw_ids)
    return BulkDeleteCardsResponse(deleted_count=count, deleted=True, card_ids=deleted_ids)


@app.post("/api/cards/bulk-sync", response_model=SyncAllResponse)
def sync_cards_bulk(
    request: Union[BulkSyncCardsRequest, list[int]] = Body(...),
) -> SyncAllResponse:
    if isinstance(request, BulkSyncCardsRequest):
        raw_ids = request.card_ids
    elif isinstance(request, list):
        raw_ids = request
    else:
        raw_ids = []
    service = CardService()
    return service.sync_many_cards(raw_ids)


@app.post("/api/cards/bulk-deck", response_model=BulkDeckUpdateResponse)
def update_deck_bulk(request: BulkDeckUpdateRequest) -> BulkDeckUpdateResponse:
    service = CardService()
    count, updated_ids = service.update_deck_many(request.card_ids, request.deck_name)
    return BulkDeckUpdateResponse(updated_count=count, deck_name=request.deck_name, card_ids=updated_ids)


@app.get("/api/cards/{card_id}", response_model=CardDetailResponse)
def get_card(card_id: int) -> CardDetailResponse:
    service = CardService()
    card = service.get_card(card_id)
    if not card:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Card with ID {card_id} does not exist.")
    return card


@app.delete("/api/cards/{card_id}", response_model=DeleteCardResponse)
def delete_card(card_id: int) -> DeleteCardResponse:
    service = CardService()
    deleted = service.delete_card(card_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Card with ID {card_id} does not exist.")
    return DeleteCardResponse(id=card_id, deleted=True)


@app.get("/api/media/{filename}")
def get_media_file(filename: str) -> FileResponse:
    storage = MediaStorageService()
    file_path = storage.get_media_path(filename)
    if not file_path or not file_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Media file '{filename}' not found.")

    ext = file_path.suffix.lower()
    media_types = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".webm": "audio/webm",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
    }
    media_type = media_types.get(ext, "application/octet-stream")
    return FileResponse(file_path, media_type=media_type)


@app.get("/api/ocr/status", response_model=OcrStatusResponse)
def get_ocr_status() -> OcrStatusResponse:
    service = OcrService()
    status_obj = service.get_status()
    return OcrStatusResponse(
        available=status_obj.available,
        installed=status_obj.installed,
        engine=status_obj.engine,
        device=status_obj.device,
        model_loaded=status_obj.model_loaded,
        error=status_obj.error,
    )


@app.post("/api/ocr/start", response_model=OcrStatusResponse)
def start_ocr_engine() -> OcrStatusResponse:
    pm = OcrProcessManager.get_instance()
    started = pm.start(wait_for_health=True, timeout_seconds=15.0)
    service = OcrService()
    status_obj = service.get_status()
    if not started and not status_obj.available:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=status_obj.error or "Failed to start OCR engine daemon.",
        )
    return OcrStatusResponse(
        available=status_obj.available,
        installed=status_obj.installed,
        engine=status_obj.engine,
        device=status_obj.device,
        model_loaded=status_obj.model_loaded,
        error=status_obj.error,
    )


@app.post("/api/ocr/stop", response_model=OcrStatusResponse)
def stop_ocr_engine() -> OcrStatusResponse:
    pm = OcrProcessManager.get_instance()
    pm.stop()
    service = OcrService()
    status_obj = service.get_status()
    return OcrStatusResponse(
        available=False,
        installed=status_obj.installed,
        engine=status_obj.engine,
        device=status_obj.device,
        model_loaded=False,
        error=None,
    )


@app.post("/api/ocr/recognize", response_model=OcrRecognizeResponse)
def recognize_image(request: OcrRecognizeRequest) -> OcrRecognizeResponse:
    raw_image = request.image.strip()
    if "," in raw_image and raw_image.startswith("data:"):
        _, b64_part = raw_image.split(",", 1)
    else:
        b64_part = raw_image

    try:
        image_bytes = base64.b64decode(b64_part, validate=True)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 image data: {exc}",
        ) from exc

    if not image_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Decoded image data is empty.",
        )

    service = OcrService()
    try:
        result = service.recognize(image_bytes)
        return OcrRecognizeResponse(
            text=result.text,
            engine=result.engine,
            device=result.device,
            duration_ms=result.duration_ms,
            error=result.error,
        )
    except OcrUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(error),
        ) from error
    except OcrTimeoutError as error:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=str(error),
        ) from error
    except OcrResponseError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OCR recognition error: {error}",
        ) from error


from app.services.kanji_strokes import get_kanji_strokes_service


@app.get("/api/kanji/strokes/{character}")
def get_kanji_strokes(character: str) -> Response:
    """Return stroke order SVG for a kanji character or hex codepoint."""
    service = get_kanji_strokes_service()
    svg = service.get_stroke_svg(character)
    if not svg:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stroke diagram not found for character: {character}",
        )
    return Response(content=svg, media_type="image/svg+xml; charset=utf-8")


@app.post("/api/jlpt/batch")
async def batch_jlpt_lookup(request: Request) -> JSONResponse:
    """Batch lookup JLPT levels for a list of vocabulary expressions."""
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Malformed JSON: {exc}")

    if isinstance(body, list):
        expressions = body
    elif isinstance(body, dict):
        expressions = body.get("expressions", [])
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Body must be a list of expressions or a dict containing 'expressions'.",
        )

    if not isinstance(expressions, list):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'expressions' must be a list.",
        )

    service = JlptReferenceService()
    results: dict[str, Any] = {}
    for expr in expressions:
        if isinstance(expr, str) and expr.strip():
            clean_str = expr.strip()
            results[clean_str] = service.lookup_word_with_kanji_fallback(clean_str)
        elif expr is not None:
            results[str(expr)] = None

    return JSONResponse({"status": "ok", "levels": results})


# ============================================================================
# LLM Assistant Endpoints
# ============================================================================

def _build_llm_config_response() -> LLMConfigResponse:
    provider = get_llm_provider()
    model = get_llm_model() or resolve_default_llm_model(provider)
    ollama_url = get_llm_ollama_url()
    key_name = get_llm_key_name()
    configured = is_llm_configured()

    if os.environ.get("KIROKU_LLM_PROVIDER"):
        source = "env"
    elif load_stored_llm_config().get("provider"):
        source = "stored"
    else:
        source = "default"

    timeout = resolve_llm_timeout()
    jlpt_level = get_llm_jlpt_level()

    # Never expose raw key or key preview in responses
    return LLMConfigResponse(
        provider=provider,
        model=model,
        ollama_url=ollama_url,
        configured=configured,
        has_key=configured,
        key_name=key_name,
        key_preview=None,
        provider_source=source,
        timeout=timeout,
        jlpt_level=jlpt_level,
    )


@app.get("/api/llm/status", response_model=LLMStatusResponse)
def get_llm_status() -> LLMStatusResponse:
    """Check if backend LLM assistant is configured and return provider/model/key_name."""
    service = get_llm_service()
    key_name = get_llm_key_name()
    return LLMStatusResponse(
        configured=service.is_configured(),
        provider=service.provider_name,
        model=service.model_name,
        key_name=key_name,
    )


@app.get("/api/llm/config", response_model=LLMConfigResponse)
def get_llm_config() -> LLMConfigResponse:
    """Return active LLM configuration metadata without secrets."""
    return _build_llm_config_response()


@app.put("/api/llm/config", response_model=LLMConfigResponse)
def update_llm_config(request: LLMConfigUpdateRequest) -> LLMConfigResponse:
    """Update stored LLM settings in user data directory. Secrets are routed strictly to SecretStore."""
    stored = load_stored_llm_config()
    if request.provider is not None:
        new_provider = request.provider.strip().lower()
        if stored.get("provider") != new_provider and request.model is None:
            stored.pop("model", None)
        stored["provider"] = new_provider
    if request.model is not None:
        stored["model"] = request.model.strip()
    if request.key_name is not None:
        if request.key_name.strip() == "":
            stored.pop("key_name", None)
        else:
            stored["key_name"] = request.key_name.strip()
    if request.ollama_url is not None:
        stored["ollama_url"] = request.ollama_url.strip().rstrip("/")
    if request.timeout is not None:
        stored["timeout"] = max(5.0, min(180.0, float(request.timeout)))
    if request.jlpt_level is not None:
        norm_level = request.jlpt_level.strip().upper()
        if norm_level in VALID_JLPT_LEVELS:
            stored["jlpt_level"] = norm_level

    # Securely handle api_key if supplied
    if request.api_key is not None:
        from app.services.secret_store import get_secret_store
        store = get_secret_store()
        raw_key = request.api_key.strip()
        if raw_key == "":
            store.delete_secret("llm_api_key")
        else:
            store.set_secret("llm_api_key", raw_key)
        # Ensure raw key is removed from stored dict
        stored.pop("api_key", None)

    save_stored_llm_config(stored)
    return _build_llm_config_response()


@app.post("/api/llm/secret", response_model=LLMSecretSaveResponse)
@app.post("/api/llm/key", response_model=LLMSecretSaveResponse)
def save_llm_secret(request: LLMSecretSaveRequest) -> LLMSecretSaveResponse:
    """
    Save or replace the LLM API key in OS secure storage (Windows DPAPI).
    The plaintext key is not retained, logged, or exposed in any response.
    """
    key = request.api_key.strip()
    if not key:
        raise HTTPException(status_code=422, detail="API key must not be empty.")

    req_provider = request.provider.strip().lower() if request.provider and request.provider.strip() else None
    provider = req_provider or get_llm_provider()
    if provider == "none":
        provider = "groq"

    # Light validation without blocking non-standard valid keys
    if provider == "groq" and len(key) < 10:
        raise HTTPException(status_code=422, detail="Invalid Groq API key format.")

    from app.services.secret_store import get_secret_store
    store = get_secret_store()
    store.set_secret("llm_api_key", key)

    stored = load_stored_llm_config()
    stored["provider"] = provider
    if request.key_name is not None and request.key_name.strip():
        stored["key_name"] = request.key_name.strip()
    elif not stored.get("key_name"):
        stored["key_name"] = f"Kiroku {provider.capitalize()}"
    save_stored_llm_config(stored)

    model = get_llm_model(provider=provider) or resolve_default_llm_model(provider)
    key_name = stored.get("key_name")

    return LLMSecretSaveResponse(
        ok=True,
        configured=is_llm_configured(),
        provider=provider,
        model=model,
        key_name=key_name,
        message="API key configured securely.",
    )


@app.delete("/api/llm/secret", response_model=LLMSecretDeleteResponse)
@app.delete("/api/llm/key", response_model=LLMSecretDeleteResponse)
def delete_llm_secret() -> LLMSecretDeleteResponse:
    """
    Delete the LLM API key from OS secure storage.
    If an environment variable (KIROKU_LLM_API_KEY) is present, backend will fall back to it.
    """
    from app.services.secret_store import get_secret_store
    store = get_secret_store()
    store.delete_secret("llm_api_key")

    stored = load_stored_llm_config()
    stored.pop("key_name", None)
    save_stored_llm_config(stored)

    provider = get_llm_provider()
    model = get_llm_model() or resolve_default_llm_model(provider)

    return LLMSecretDeleteResponse(
        ok=True,
        configured=is_llm_configured(),
        provider=provider,
        model=model,
        message="API key removed.",
    )


@app.post("/api/llm/test", response_model=LLMTestResponse)
def test_llm_connection(request: LLMTestRequest = Body(default=None)) -> LLMTestResponse:
    """Execute a 1-token dummy query to verify provider connectivity and credentials."""
    req = request or LLMTestRequest()
    provider = req.provider or get_llm_provider()
    api_key = req.api_key if req.api_key is not None else get_llm_api_key()
    ollama_url = req.ollama_url or get_llm_ollama_url()
    model = req.model or get_llm_model() or resolve_default_llm_model(provider)

    if provider == "none":
        return LLMTestResponse(
            ok=False,
            provider="none",
            model=None,
            error="No LLM provider configured.",
        )

    if provider in ("groq", "gemini") and not api_key:
        return LLMTestResponse(
            ok=False,
            provider=provider,
            model=model,
            error=f"{provider.capitalize()} API key is required.",
        )

    service = get_llm_service(
        provider=provider,
        api_key=api_key,
        ollama_url=ollama_url,
        model=model,
        timeout=10.0,
    )

    start = time.perf_counter()
    try:
        _, prov, mdl = service.ask(task="chat", text="1")
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        return LLMTestResponse(
            ok=True,
            provider=prov,
            model=mdl,
            duration_ms=duration_ms,
        )
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        return LLMTestResponse(
            ok=False,
            provider=provider,
            model=model,
            duration_ms=duration_ms,
            error=str(exc),
        )


@app.post("/api/llm/ask", response_model=LLMResponse)
def ask_llm(request: LLMRequest) -> LLMResponse:
    """Execute an assistant task prompt (translate, explain sense/grammar, mnemonic, answer questions, chat)."""
    service = get_llm_service()
    if not service.is_configured():
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="LLM assistant is not configured. Please set KIROKU_LLM_PROVIDER.",
        )

    try:
        result_text, provider_name, model_name = service.ask(
            task=request.task,
            text=request.text,
            context=request.context,
            word=request.word,
            messages=request.messages,
            mode=request.mode,
            jlpt_level=request.jlpt_level,
        )
        return LLMResponse(
            result=result_text,
            provider=provider_name,
            model=model_name,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except LLMNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=str(exc),
        ) from exc
    except LLMTimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=str(exc),
        ) from exc
    except LLMConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except (LLMAPIError, LLMResponseError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"LLM execution error: {exc}",
        ) from exc

@app.post("/api/cloud/pull")
async def pull_cloud_queue() -> JSONResponse:
    """
    Run the same best-effort queue, Anki stats, and card mirror sync as the background poller.
    Newly pulled cloud cards remain local and pending; they are not automatically sent to Anki.
    """
    return JSONResponse(await _execute_cloud_poll_cycle())


@app.get("/dashboard")
def get_dashboard_redirect() -> Response:
    """Convenience redirect from local backend to the Cloud Queue Dashboard."""
    from fastapi.responses import RedirectResponse
    cloud_url = os.getenv("CLOUD_QUEUE_URL", "https://kiroku-cloud-queue.onrender.com").rstrip("/")
    token = os.getenv("WORKER_TOKEN", os.getenv("SUBMIT_TOKEN", ""))
    target = f"{cloud_url}/dashboard"
    if token:
        target += f"?token={token}"
    return RedirectResponse(url=target)

