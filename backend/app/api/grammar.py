from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.schemas import (
    GrammarAnalyzeRequest, GrammarSetupCheckResponse,
)
from app.schemas_grammar import GrammarAnalyzeResponse
from app.services.grammar_service import GrammarService
from app.services.grammar_tracker import GrammarTrackerService
from app.study.grammar_drills import GrammarDrillService
from app.study.grammar_roadmap import GrammarRoadmapService

grammar_router = APIRouter(prefix="/api/grammar", tags=["grammar"])
_service = GrammarService()
_tracker = GrammarTrackerService()
_drills = GrammarDrillService(tracker_service=_tracker)
_roadmap = GrammarRoadmapService(tracker_service=_tracker)


class GrammarExplainRequest(BaseModel):
    text: str = ""
    sentence: str | None = None
    level: str | None = None


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


class GrammarDrillResultRequest(BaseModel):
    pattern_key: str
    modality: str
    is_correct: bool
    user_answer: str = ""
    expected_answer: str = ""
    context_sentence: str = ""


class BatchStatusRequest(BaseModel):
    pattern_keys: list[str]


class DrillVerifyRequest(BaseModel):
    modality: str
    pattern_key: str
    user_answer: str
    expected_answer: str | None = None
    context_sentence: str = ""
    drill_id: str | None = None


@grammar_router.post("/explain")
def explain_grammar(request: GrammarExplainRequest):
    sent = request.sentence or request.text or ""
    analysis = _service.analyze(
        sent,
        learner_level=request.level or "N5",
    )
    if isinstance(analysis, dict):
        points = analysis.get("points", [])
        analysis_data = analysis
    elif hasattr(analysis, "points"):
        points = [p.model_dump() if hasattr(p, "model_dump") else p for p in analysis.points]
        analysis_data = analysis.model_dump() if hasattr(analysis, "model_dump") else analysis
    else:
        points = []
        analysis_data = analysis

    return {
        "text": sent,
        "points": points,
        "analysis": analysis_data,
    }


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

@grammar_router.get("/syllabus")
def get_grammar_syllabus(
    level: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    return _tracker.get_syllabus(level=level, search=search, limit=limit, offset=offset)


@grammar_router.post("/drills")
def record_grammar_drill(request: GrammarDrillResultRequest):
    try:
        return _tracker.record_drill_outcome(
            pattern_key=request.pattern_key,
            modality=request.modality,
            is_correct=request.is_correct,
            user_answer=request.user_answer,
            expected_answer=request.expected_answer,
            context_sentence=request.context_sentence,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@grammar_router.get("/points/{pattern_key}/status")
def get_point_dual_track_status(pattern_key: str):
    status = _tracker.get_dual_track_status(pattern_key)
    if not status:
        raise HTTPException(status_code=404, detail="Pattern key not found")
    return status


@grammar_router.post("/batch-status")
def get_batch_dual_track_status(request: BatchStatusRequest):
    return {"results": _tracker.get_batch_dual_track_status(request.pattern_keys)}


@grammar_router.get("/drills/session")
def get_grammar_drill_session(
    modality: str | None = Query(default=None),
    level: str | None = Query(default=None),
    pattern_key: str | None = Query(default=None),
    count: int = Query(default=10, ge=1, le=20),
):
    """Generate anti-grind micro-session drills across proof modalities."""
    return _drills.generate_session(
        modality=modality,
        level=level,
        pattern_key=pattern_key,
        count=count,
    )


@grammar_router.post("/drills/verify")
def verify_grammar_drill(request: DrillVerifyRequest):
    """Verify learner answer, score inflection/nuance, and record dual-track mastery."""
    try:
        return _drills.verify_drill_answer(
            modality=request.modality,
            pattern_key=request.pattern_key,
            user_answer=request.user_answer,
            expected_answer=request.expected_answer,
            context_sentence=request.context_sentence,
            drill_id=request.drill_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@grammar_router.get("/roadmap/flow")
def get_grammar_roadmap_flow():
    """Progression Flow: Genki / Tae Kim sequence with dual-track badges."""
    return _roadmap.get_roadmap_flow()


@grammar_router.get("/roadmap/hubs")
def get_grammar_roadmap_hubs():
    """Conceptual Hubs: Particles, Conjugations, Giving/Receiving, Conjectures, Conditionals, Voice."""
    return _roadmap.get_conceptual_hubs()


@grammar_router.get("/points/{pattern_key}/card")
def get_grammar_point_mastery_card(pattern_key: str):
    """Point Mastery Card: big picture banner, formation block, nuance contrasts, mined anime/cards context."""
    card = _roadmap.get_point_mastery_card(pattern_key)
    if not card:
        raise HTTPException(status_code=404, detail=f"Grammar point '{pattern_key}' not found in reference index")
    return card

