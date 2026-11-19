"""API endpoints for FSRS Spaced Repetition reviews, deck settings, and Anki sync."""
from __future__ import annotations

import json
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

class CardActionRequest(BaseModel):
    card_id: int

class UnburyRequest(BaseModel):
    deck_name: Optional[str] = None

class CreateDeckRequest(BaseModel):
    deck_name: str

@review_router.get("/queue")
def get_review_queue(
    deck_name: str = Query("Default"),
    limit: Optional[int] = Query(None, ge=1)
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
    from app.db.connection import db_session
    with db_session(repo.db_path) as conn:
        card_row = conn.execute("SELECT id, deck_name FROM cards WHERE id = ?", (req.card_id,)).fetchone()
        if not card_row:
            raise HTTPException(status_code=404, detail="Card not found")
        card_deck = dict(card_row).get("deck_name") or "Default"

    fsrs = repo.get_or_create_fsrs(req.card_id)
    now_utc = datetime.now(timezone.utc)
    now_str = now_utc.isoformat()

    last_review_str = fsrs.get("last_review")
    if last_review_str:
        try:
            last_review_dt = datetime.fromisoformat(last_review_str.replace("Z", "+00:00"))
            actual_elapsed = max(0, (now_utc.date() - last_review_dt.date()).days)
        except Exception:
            actual_elapsed = int(fsrs.get("elapsed_days") or 0)
    else:
        actual_elapsed = int(fsrs.get("elapsed_days") or 0)

    settings = repo.get_deck_settings(card_deck)
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
        elapsed_days=actual_elapsed,
        state=CardState(fsrs.get("state", 0))
    )
    
    if record.scheduled_days == 0:
        due_date = now_utc.strftime("%Y-%m-%d")
    else:
        due_date = (now_utc + timedelta(days=record.scheduled_days)).strftime("%Y-%m-%d")
        
    auto_sync_enabled = bool(settings.get("auto_sync_anki", 1))
    fsrs_update = {
        "state": int(record.next_state),
        "stability": record.stability,
        "difficulty": record.difficulty,
        "reps": record.reps,
        "lapses": record.lapses,
        "elapsed_days": actual_elapsed,
        "scheduled_days": record.scheduled_days,
        "last_review": now_str,
        "due_date": due_date,
    }
    if auto_sync_enabled:
        fsrs_update["sync_state"] = "pending_anki"
    
    snapshot_str = json.dumps({
        "state": fsrs.get("state", 0),
        "stability": fsrs.get("stability", 0.0),
        "difficulty": fsrs.get("difficulty", 0.0),
        "elapsed_days": fsrs.get("elapsed_days", 0),
        "scheduled_days": fsrs.get("scheduled_days", 0),
        "reps": fsrs.get("reps", 0),
        "lapses": fsrs.get("lapses", 0),
        "last_review": fsrs.get("last_review"),
        "due_date": fsrs.get("due_date")
    })
    log_data = {
        "rating": req.rating,
        "state": fsrs.get("state", 0),
        "scheduled_days": record.scheduled_days,
        "elapsed_days": fsrs.get("elapsed_days", 0),
        "duration_ms": req.duration_ms,
        "last_fsrs_snapshot": snapshot_str
    }
    _, log_id = repo.apply_review_atomic(req.card_id, fsrs_update, log_data)
    
    sync_res = None
    if auto_sync_enabled:
        try:
            sync_service = AnkiFSRSSyncService(review_repo=repo)
            sync_res = sync_service.sync_card_review(req.card_id, req.rating, log_id=log_id)
            if isinstance(sync_res, dict) and sync_res.get("status") == "synced" and repo.has_pending_anki_reviews():
                flush_res = sync_service.flush_pending_reviews()
                sync_res["flushed_older_count"] = flush_res.get("flushed_count", 0)
        except Exception as e:
            repo.update_card_fsrs(req.card_id, {"sync_state": "pending_anki"})
            sync_res = {"status": "queued", "reason": "sync_exception", "error": str(e)}
            
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

@review_router.get("/decks")
def get_decks() -> Dict[str, Any]:
    repo = ReviewRepository()
    return {"decks": repo.get_available_decks()}

@review_router.post("/decks/create")
def create_deck_endpoint(req: CreateDeckRequest) -> Dict[str, Any]:
    deck_name = req.deck_name.strip()
    if not deck_name:
        raise HTTPException(status_code=400, detail="Deck name cannot be empty")
    try:
        from app.services.anki_connect import AnkiConnectService
        anki = AnkiConnectService()
        if anki.is_available():
            anki.create_deck(deck_name)
    except Exception:
        pass
    repo = ReviewRepository()
    res = repo.create_deck(deck_name)
    return {"status": "ok", "deck_name": deck_name, "settings": res}

@review_router.post("/bury")
def bury_card_endpoint(req: CardActionRequest) -> Dict[str, Any]:
    repo = ReviewRepository()
    repo.bury_card(req.card_id)
    return {"status": "ok", "card_id": req.card_id}

@review_router.post("/unbury")
def unbury_cards_endpoint(req: Optional[UnburyRequest] = Body(None)) -> Dict[str, Any]:
    repo = ReviewRepository()
    deck_name = req.deck_name if req else None
    count = repo.unbury_cards(deck_name)
    return {"status": "ok", "unburied_count": count}

@review_router.post("/suspend")
def suspend_card_endpoint(req: CardActionRequest) -> Dict[str, Any]:
    repo = ReviewRepository()
    fsrs = repo.get_or_create_fsrs(req.card_id)
    repo.suspend_card(req.card_id)
    anki_res = None
    anki_card_id = fsrs.get("anki_card_id")
    if anki_card_id:
        try:
            from app.services.anki_connect import AnkiConnectService
            anki = AnkiConnectService()
            if anki.is_available():
                anki.suspend_cards([anki_card_id])
                anki_res = "suspended_in_anki"
        except Exception as e:
            anki_res = f"error: {e}"
    return {"status": "ok", "card_id": req.card_id, "anki": anki_res}

@review_router.post("/unsuspend")
def unsuspend_card_endpoint(req: CardActionRequest) -> Dict[str, Any]:
    repo = ReviewRepository()
    fsrs = repo.get_or_create_fsrs(req.card_id)
    repo.unsuspend_card(req.card_id)
    anki_res = None
    anki_card_id = fsrs.get("anki_card_id")
    if anki_card_id:
        try:
            from app.services.anki_connect import AnkiConnectService
            anki = AnkiConnectService()
            if anki.is_available():
                anki.unsuspend_cards([anki_card_id])
                anki_res = "unsuspended_in_anki"
        except Exception as e:
            anki_res = f"error: {e}"
    return {"status": "ok", "card_id": req.card_id, "anki": anki_res}

@review_router.post("/undo")
def undo_review_endpoint() -> Dict[str, Any]:
    repo = ReviewRepository()
    res = repo.undo_last_review()
    if not res:
        raise HTTPException(status_code=400, detail="No reviews to undo")
    return res
