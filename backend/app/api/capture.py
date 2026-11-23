"""Capture API routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.schemas import CaptureRequest, CaptureResponse, DictionaryEntry, Sense
from app.services.card_service import CardService
from app.services.yomitan import YomitanError, YomitanService

router = APIRouter(tags=["capture"])


def _fallback_capture(text: str) -> CaptureResponse | None:
    text = (text or "").strip()
    if not text:
        return None
    try:
        import json
        from pathlib import Path
        import sqlite3

        candidates = [
            Path(__file__).resolve().parent.parent / "data" / "jlpt_reference.sqlite",
            Path("/app/backend/app/data/jlpt_reference.sqlite"),
            Path("/app/app/data/jlpt_reference.sqlite"),
            Path("backend/app/data/jlpt_reference.sqlite"),
        ]
        db_path = next((p for p in candidates if p.exists()), None)
        if not db_path:
            return None
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT * FROM vocab WHERE word = ? OR reading = ? LIMIT 1", (text, text))
        row = cur.fetchone()
        if row:
            meanings = json.loads(row["meanings"]) if row["meanings"] else []
            examples = json.loads(row["examples"]) if row["examples"] else []
            senses = [Sense(index=i + 1, glosses=[m]) for i, m in enumerate(meanings)]
            entry = DictionaryEntry(
                dictionary="JLPT Reference",
                term=row["word"],
                reading=row["reading"],
                senses=senses,
            )
            return CaptureResponse(
                expression=row["word"],
                reading=row["reading"],
                meaning="; ".join(meanings),
                jlpt_level=row["level"],
                example_sentence=examples[0].get("ja", "") if examples else "",
                example_translation=examples[0].get("en", "") if examples else "",
                entries=[entry],
                status="draft",
            )
        cur.execute("SELECT * FROM kanji WHERE character = ? LIMIT 1", (text[0],))
        krow = cur.fetchone()
        if krow:
            meanings = json.loads(krow["meanings"]) if krow["meanings"] else []
            onyomi = json.loads(krow["onyomi"]) if krow["onyomi"] else []
            kunyomi = json.loads(krow["kunyomi"]) if krow["kunyomi"] else []
            return CaptureResponse(
                expression=krow["character"],
                reading=onyomi[0] if onyomi else (kunyomi[0] if kunyomi else ""),
                meaning="; ".join(meanings),
                jlpt_level=krow["level"],
                status="draft",
            )
    except Exception:
        pass
    return None


@router.post("/api/capture", response_model=CaptureResponse)
def capture_term(request: CaptureRequest) -> CaptureResponse:
    """Capture a term (optionally auto-saving it as a card)."""
    from app.services.yomitan import get_dictionary_service
    dict_svc = get_dictionary_service()
    service = CardService(yomitan_service=dict_svc)
    try:
        if request.auto_save:
            return service.capture_and_save(request.text, request.deck_name)
        return service.capture_term(request.text, request.deck_name)
    except (YomitanError, Exception) as error:
        fallback = _fallback_capture(request.text)
        if fallback:
            return fallback
        code = getattr(error, "code", None)
        detail = {"code": code, "message": str(error)} if code else str(error)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail
        ) from error


@router.get("/api/dictionary/lookup")
def lookup_dictionary(term: str = "", keyword: str = ""):
    """Lookup term in dictionary and return rich entries and kanji."""
    q = (term or keyword or "").strip()
    if not q:
        return {"query": "", "entries": [], "kanji": []}
    from app.services.yomitan import get_dictionary_service
    dict_svc = get_dictionary_service()
    service = CardService(yomitan_service=dict_svc)
    try:
        captured = service.capture_term(q)
        return {
            "query": q,
            "entries": [e.model_dump() for e in getattr(captured, "entries", [])],
            "kanji": [k.model_dump() for k in getattr(captured, "kanji_entries", [])],
            "meaning": captured.meaning,
            "reading": captured.reading,
            "expression": captured.expression,
        }
    except Exception:
        fallback = _fallback_capture(q)
        if fallback:
            return {
                "query": q,
                "entries": [e.model_dump() for e in getattr(fallback, "entries", [])],
                "kanji": [],
                "meaning": fallback.meaning,
                "reading": fallback.reading,
                "expression": fallback.expression,
            }
        return {"query": q, "entries": [], "kanji": []}


