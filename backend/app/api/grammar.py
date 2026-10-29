from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.schemas import (
    GrammarAnalyzeRequest, GrammarAnalyzeResponse, GrammarSetupCheckResponse,
)
from app.services.grammar_service import GrammarService
from app.services.grammar_tracker import GrammarTrackerService

grammar_router = APIRouter(prefix="/api/grammar", tags=["grammar"])
_service = GrammarService()
_tracker = GrammarTrackerService()


class EncounterRequest(BaseModel):
    pattern_key: str
    display: str = ""
    sentence: str
    source: str = "text"
    source_title: str | None = None
    video_timestamp_ms: int | None = None
    level: str | None = None
    card_id: int | None = None


class PointStatusRequest(BaseModel):
    status: str


@grammar_router.post("/analyze", response_model=GrammarAnalyzeResponse)
def analyze_grammar(request: GrammarAnalyzeRequest) -> GrammarAnalyzeResponse:
    return _service.analyze(
        request.sentence,
        learner_level=request.learner_level,
        show_basic_particles=request.show_basic_particles,
        source=request.source,
        hide_known=request.hide_known,
        designated_dictionary=request.designated_dictionary,
        show_below_level=request.show_below_level,
    )


@grammar_router.post("/setup-check", response_model=GrammarSetupCheckResponse)
def grammar_setup_check() -> GrammarSetupCheckResponse:
    return _service.setup_check()


@grammar_router.post("/encounters")
def record_grammar_encounter(request: EncounterRequest):
    return _tracker.record_encounter(**request.model_dump())


@grammar_router.get("/points")
def get_grammar_points(
    status: str | None = Query(default=None),
    level: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    return {"points": _tracker.get_points(
        status=status, level=level, search=search, limit=limit, offset=offset,
    )}


@grammar_router.get("/stats")
def get_grammar_stats():
    return _tracker.get_stats()


@grammar_router.patch("/points/{pattern_key}")
def update_grammar_point(pattern_key: str, request: PointStatusRequest):
    try:
        point = _tracker.update_point_status(pattern_key, request.status)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if point is None:
        raise HTTPException(status_code=404, detail="Grammar point not found")
    return point


@grammar_router.get("/points/{pattern_key}/encounters")
def get_grammar_encounters(pattern_key: str):
    return {"encounters": _tracker.get_point_encounters(pattern_key)}
