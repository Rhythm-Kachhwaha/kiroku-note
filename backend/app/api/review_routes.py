"""API endpoints for FSRS Spaced Repetition reviews, deck settings, and Anki sync."""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Body, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.services.fsrs_engine import FSRSEngine, Rating, CardState
from app.repositories.review_repository import ReviewRepository
from app.services.anki_fsrs_sync import AnkiFSRSSyncService

review_router = APIRouter(prefix="/api/review", tags=["Review"])

class ReviewAnswerRequest(BaseModel):
    card_id: int
    rating: int = Field(..., ge=1, le=4)
    duration_ms: Optional[int] = None

class BoostLimitsRequest(BaseModel):
    deck_name: str = "Default"
    add_new: int = 0
    add_reviews: int = 0

class SyncAnkiRequest(BaseModel):
    deck_name: Optional[str] = None

@review_router.get("/queue")
def get_review_queue(
    deck_name: str = Query("Default"),
    limit: Optional[int] = Query(None, ge=1, le=200)
) -> Dict[str, Any]:
    repo = ReviewRepository()
    settings = repo.get_deck_settings(deck_name)
    engine = FSRSEngine(
        easy_initial_cap_days=settings.get("easy_initial_cap_days", 6),
        desired_retention=settings.get("desired_retention", 0.90),
        max_interval_days=settings.get("max_interval_days", 365)
    )
    cards = repo.get_due_cards(deck_name=deck_name, limit=limit)
    for c in cards:
        preview = engine.get_intervals_preview(
            stability=c.get("stability", 0.0),
            difficulty=c.get("difficulty", 0.0),
            reps=c.get("reps", 0),
            lapses=c.get("lapses", 0),
            elapsed_days=c.get("elapsed_days", 0),
            state=CardState(c.get("fsrs_state", 0))
        )
        c["intervals"] = preview
    return {"cards": cards, "count": len(cards)}

@review_router.post("/answer")
def answer_card(req: ReviewAnswerRequest) -> Dict[str, Any]:
    repo = ReviewRepository()
    fsrs = repo.get_or_create_fsrs(req.card_id)
    settings = repo.get_deck_settings()
    engine = FSRSEngine(
        easy_initial_cap_days=settings.get("easy_initial_cap_days", 6),
        desired_retention=settings.get("desired_retention", 0.90),
        max_interval_days=settings.get("max_interval_days", 365)
    )
    record = engine.schedule(
        rating=Rating(req.rating),
        stability=fsrs.get("stability", 0.0),
        difficulty=fsrs.get("difficulty", 0.0),
        reps=fsrs.get("reps", 0),
        lapses=fsrs.get("lapses", 0),
        elapsed_days=fsrs.get("elapsed_days", 0),
        state=CardState(fsrs.get("state", 0))
    )
    
    now_utc = datetime.now(timezone.utc)
    now_str = now_utc.isoformat()
    if record.scheduled_days == 0:
        due_date = now_utc.strftime("%Y-%m-%d")
    else:
        due_date = (now_utc + timedelta(days=record.scheduled_days)).strftime("%Y-%m-%d")
        
    repo.update_card_fsrs(req.card_id, {
        "state": int(record.next_state),
        "stability": record.stability,
        "difficulty": record.difficulty,
        "reps": record.reps,
        "lapses": record.lapses,
        "elapsed_days": record.scheduled_days,
        "scheduled_days": record.scheduled_days,
        "last_review": now_str,
        "due_date": due_date
    })
    
    repo.log_review(
        card_id=req.card_id,
        rating=req.rating,
        state=fsrs.get("state", 0),
        scheduled_days=record.scheduled_days,
        elapsed_days=fsrs.get("elapsed_days", 0),
        duration_ms=req.duration_ms
    )
    
    sync_res = None
    if settings.get("auto_sync_anki", 1):
        try:
            sync_service = AnkiFSRSSyncService(review_repo=repo)
            sync_res = sync_service.sync_card_review(req.card_id, req.rating)
        except Exception as e:
            sync_res = {"status": "error", "error": str(e)}
            
    return {
        "status": "ok",
        "card_id": req.card_id,
        "record": asdict(record),
        "due_date": due_date,
        "sync": sync_res
    }

@review_router.get("/settings")
def get_settings(deck_name: str = Query("Default")) -> Dict[str, Any]:
    repo = ReviewRepository()
    return repo.get_deck_settings_with_explanations(deck_name)

@review_router.put("/settings")
def update_settings(updates: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    repo = ReviewRepository()
    deck_name = str(updates.get("deck_name") or "Default")
    repo.update_deck_settings(deck_name, updates)
    return repo.get_deck_settings_with_explanations(deck_name)

@review_router.post("/boost-limits")
def boost_limits(req: BoostLimitsRequest) -> Dict[str, Any]:
    repo = ReviewRepository()
    return repo.boost_limits_today(
        deck_name=req.deck_name,
        add_new=req.add_new,
        add_reviews=req.add_reviews
    )

@review_router.post("/sync-anki")
def sync_anki(req: Optional[SyncAnkiRequest] = Body(None)) -> Dict[str, Any]:
    deck_name = req.deck_name if req else None
    sync_service = AnkiFSRSSyncService()
    return sync_service.full_sync(deck_name)

@review_router.get("/stats")
def get_stats(deck_name: str = Query("Default")) -> Dict[str, Any]:
    repo = ReviewRepository()
    return repo.get_review_stats(deck_name)
