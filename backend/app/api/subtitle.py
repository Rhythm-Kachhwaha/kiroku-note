"""Subtitle Annotation and Known Words API Routes.

Provides endpoints for:
- POST /api/subtitle/annotate: batch tokenization and status annotation of subtitle cues.
- GET /api/known-words: retrieve mined and marked known words with ETag 304 caching.
- POST /api/known-words/mark: mark a vocabulary term as known.
- DELETE /api/known-words/mark/{word}: unmark a previously marked known word.
"""
from __future__ import annotations

import datetime
import hashlib
import logging
import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from app.config import get_learner_jlpt_level
from app.db.connection import db_session
from app.schemas import (
    AnnotatedCueResponse,
    AnnotatedTokenResponse,
    KnownWordsResponse,
    MarkKnownWordRequest,
    MarkKnownWordResponse,
    SubtitleAnnotateRequest,
    SubtitleAnnotateResponse,
)
from app.services.subtitle_annotator import get_subtitle_annotator_service

logger = logging.getLogger(__name__)

subtitle_router = APIRouter(tags=["subtitles"])


@subtitle_router.post(
    "/api/subtitle/annotate",
    response_model=SubtitleAnnotateResponse,
    summary="Batch annotate subtitle cues with vocabulary tokenization and learner status",
)
def annotate_subtitles(request: SubtitleAnnotateRequest) -> SubtitleAnnotateResponse:
    """Batch tokenize and annotate subtitle cues with status (should_know, mined, unstyled)."""
    effective_level = (
        request.learner_level
        if request.learner_level is not None
        else get_learner_jlpt_level()
    )
    effective_ignore_fn = (
        True
        if request.ignore_function_words is None
        else request.ignore_function_words
    )

    annotator = get_subtitle_annotator_service()
    formatted_cues: list[AnnotatedCueResponse] = []

    for idx, cue in enumerate(request.cues):
        annotated_cue = annotator.annotate_cue(
            cue,
            learner_level=effective_level,
            ignore_function_words=effective_ignore_fn,
        )

        formatted_tokens = [
            AnnotatedTokenResponse(
                start=tok.get("start_char", 0),
                end=tok.get("end_char", 0),
                surface=tok.get("surface", ""),
                lemma=tok.get("lemma", ""),
                reading=tok.get("reading", ""),
                status=tok.get("status", "unstyled"),
                jlpt_level=tok.get("jlpt_level"),
            )
            for tok in annotated_cue.get("tokens", [])
        ]

        cue_id = getattr(cue, "id", None)
        if cue_id is None and isinstance(cue, dict):
            cue_id = cue.get("id")
        if cue_id is None:
            cue_id = str(idx)

        formatted_cues.append(
            AnnotatedCueResponse(
                id=cue_id,
                tokens=formatted_tokens,
            )
        )

    return SubtitleAnnotateResponse(version=1, cues=formatted_cues)


@subtitle_router.get(
    "/api/known-words",
    response_model=KnownWordsResponse,
    summary="Get mined and marked known words with ETag HTTP 304 caching",
)
def get_known_words(request: Request) -> Response:
    """Return lists of mined words and marked known words with ETag support."""
    mined_words_set: set[str] = set()
    marked_known_set: set[str] = set()

    with db_session() as conn:
        cursor = conn.cursor()
        try:
            rows = cursor.execute(
                "SELECT expression, normalized_expression FROM cards"
            ).fetchall()
            for r in rows:
                expr = str(r["normalized_expression"] or r["expression"] or "").strip()
                if expr:
                    mined_words_set.add(expr)
        except sqlite3.OperationalError:
            pass

        try:
            rows = cursor.execute(
                "SELECT word FROM known_words"
            ).fetchall()
            for r in rows:
                w = str(r["word"] or "").strip()
                if w:
                    marked_known_set.add(w)
        except sqlite3.OperationalError:
            pass

    mined_words = sorted(list(mined_words_set))
    marked_known = sorted(list(marked_known_set))

    # Deterministic ETag hash over sorted lists
    hash_payload = f"{mined_words}|{marked_known}".encode("utf-8")
    etag = f'"{hashlib.sha256(hash_payload).hexdigest()[:16]}"'

    # Check client If-None-Match header
    client_etag = request.headers.get("if-none-match")
    if client_etag:
        req_clean = client_etag.strip().strip('"')
        cur_clean = etag.strip('"')
        if client_etag == etag or req_clean == cur_clean:
            return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers={"ETag": etag})

    return JSONResponse(
        content={
            "etag": etag,
            "mined_words": mined_words,
            "marked_known": marked_known,
        },
        headers={"ETag": etag},
    )


@subtitle_router.post(
    "/api/known-words/mark",
    response_model=MarkKnownWordResponse,
    summary="Mark a Japanese word as known and update annotator in-memory cache",
)
def mark_known_word(request: MarkKnownWordRequest) -> MarkKnownWordResponse:
    """Insert word into known_words table and update annotator cache."""
    word = request.word.strip()
    if not word:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Word must not be empty.",
        )

    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    with db_session() as conn:
        conn.execute(
            "INSERT INTO known_words (word, created_at) VALUES (?, ?) ON CONFLICT(word) DO NOTHING",
            (word, now),
        )
        conn.commit()

    annotator = get_subtitle_annotator_service()
    annotator.add_mined_word(word)
    annotator.reload_mined_words()

    return MarkKnownWordResponse(ok=True, word=word)


@subtitle_router.delete(
    "/api/known-words/mark/{word}",
    response_model=MarkKnownWordResponse,
    summary="Unmark a word from known_words and update annotator in-memory cache",
)
def unmark_known_word(word: str) -> MarkKnownWordResponse:
    """Delete word from known_words table and update annotator cache."""
    clean_word = word.strip()
    if not clean_word:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Word must not be empty.",
        )

    with db_session() as conn:
        conn.execute("DELETE FROM known_words WHERE word = ?", (clean_word,))
        conn.commit()

    annotator = get_subtitle_annotator_service()
    annotator.reload_mined_words()

    return MarkKnownWordResponse(ok=True, word=clean_word)
