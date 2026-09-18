import base64
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.db.connection import init_db
from app.services.media_storage import MediaStorageService
from app.schemas import (
    AnkiDecksResponse,
    AnkiModelCapabilitiesResponse,
    AnkiModelsResponse,
    AnkiStatusResponse,
    CaptureRequest,
    CaptureResponse,
    CardDetailResponse,
    CardListResponse,
    DeleteCardResponse,
    OcrRecognizeRequest,
    OcrRecognizeResponse,
    OcrStatusResponse,
    SaveCardRequest,
    SaveCardResponse,
    SyncAllResponse,
    SyncCardResponse,
)
from app.services.card_service import CardService
from app.services.ocr_service import (
    OcrError,
    OcrResponseError,
    OcrService,
    OcrTimeoutError,
    OcrUnavailableError,
)
from app.services.yomitan import YomitanError, YomitanService

# Debug mode: set KIROKU_DEBUG=1 to enable /docs, /redoc, and hot-reload.
# Off by default so production/distributed builds do not expose developer APIs.
_debug = os.getenv("KIROKU_DEBUG", "").strip().lower() in ("1", "true", "yes")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Kiroku Note Local API",
    lifespan=lifespan,
    docs_url="/docs" if _debug else None,
    redoc_url="/redoc" if _debug else None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["*"],
    allow_headers=["*"],
)


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
def sync_card(card_id: int) -> SyncCardResponse:
    service = CardService()
    try:
        return service.sync_card(card_id)
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




