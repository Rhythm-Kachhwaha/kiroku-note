"""Capture API routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.schemas import CaptureRequest, CaptureResponse
from app.services.card_service import CardService
from app.services.yomitan import YomitanError, YomitanService

router = APIRouter(tags=["capture"])


@router.post("/api/capture", response_model=CaptureResponse)
def capture_term(request: CaptureRequest) -> CaptureResponse:
    """Capture a term (optionally auto-saving it as a card)."""
    import app.main
    yomitan_cls = getattr(app.main, "YomitanService", YomitanService)
    service = CardService(yomitan_service=yomitan_cls())
    try:
        if request.auto_save:
            return service.capture_and_save(request.text, request.deck_name)
        return service.capture_term(request.text, request.deck_name)
    except YomitanError as error:
        code = getattr(error, "code", None)
        detail = {"code": code, "message": str(error)} if code else str(error)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail
        ) from error
