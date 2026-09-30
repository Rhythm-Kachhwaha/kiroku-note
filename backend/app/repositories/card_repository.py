"""Card repository handling SQLite persistence and duplicate checks."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any

from app.db.connection import db_session, init_db
from app.services.card_normalizer import get_duplicate_identity, normalize_deck, normalize_expression, normalize_reading
from app.services.verb_metadata import VerbMetadata, parse_verb_metadata


@dataclass
class CardDraft:
    expression: str
    reading: str
    meaning: str = ""
    hint: str = ""
    example_sentence: str = ""
    example_translation: str = ""
    image: str = ""
    audio: str = ""
    tags: str = ""
    notes: str = ""
    source_text: str = ""
    deinflected_text: str = ""
    source_type: str = ""
    source_url: str = ""
    deck_name: str = "Default"
    model_name: str = ""
    entries: list[Any] = field(default_factory=list)
    examples: list[Any] = field(default_factory=list)
    kanji_entries: list[Any] = field(default_factory=list)
    card_settings: dict[str, Any] | None = None
    status: str = "saved"
    sync_status: str = "pending"
    anki_note_id: int | None = None
    sync_error: str = ""
    synced_at: str | None = None
    jlpt_level: str | None = None
    verb_metadata: Any = None
    id: int | None = None


@dataclass
class CardRecord:
    id: int
    expression: str
    reading: str
    meaning: str
    hint: str
    example_sentence: str
    example_translation: str
    image: str
    audio: str
    tags: str
    notes: str
    source_text: str
    deinflected_text: str
    deck_name: str
    normalized_expression: str
    normalized_reading: str
    normalized_deck_name: str
    meanings_json: str
    examples_json: str
    status: str
    created_at: str
    updated_at: str
    model_name: str = ""
    source_type: str = ""
    source_url: str = ""
    sync_status: str = "pending"
    anki_note_id: int | None = None
    sync_error: str = ""
    synced_at: str | None = None
    entries: list[dict] = field(default_factory=list)
    examples: list[dict] = field(default_factory=list)
    kanji_entries: list[dict] = field(default_factory=list)
    card_settings: dict[str, Any] | None = None
    jlpt_level: str | None = None
    verb_metadata: VerbMetadata | None = None


def _serialize_items(items: list[Any]) -> list[Any]:
    serialized = []
    for item in items:
        if is_dataclass(item):
            d = asdict(item)
            d.pop("raw_content", None)
            d.pop("raw_tags", None)
            serialized.append(d)
        elif hasattr(item, "model_dump"):
            d = item.model_dump()
            d.pop("raw_content", None)
            d.pop("raw_tags", None)
            serialized.append(d)
        elif isinstance(item, dict):
            d = dict(item)
            d.pop("raw_content", None)
            d.pop("raw_tags", None)
            serialized.append(d)
        else:
            serialized.append(str(item))
    return serialized


_jlpt_reference_service = None


def _get_jlpt_reference():
    global _jlpt_reference_service
    if _jlpt_reference_service is None:
        try:
            from app.services.jlpt_reference import JlptReferenceService
            _jlpt_reference_service = JlptReferenceService()
        except Exception:
            _jlpt_reference_service = False
    return _jlpt_reference_service if _jlpt_reference_service is not False else None


def _serialize_meanings(
    entries: list[Any],
    kanji_entries: list[Any] | None = None,
    card_settings: dict[str, Any] | None = None,
    jlpt_level: str | None = None,
    verb_metadata: Any = None,
) -> str:
    serialized_entries = _serialize_items(entries)
    data: dict[str, Any] = {"entries": serialized_entries}
    if kanji_entries:
        data["kanji_entries"] = _serialize_items(kanji_entries)
    if card_settings:
        data["card_settings"] = card_settings
    if jlpt_level:
        data["jlpt_level"] = jlpt_level
    if verb_metadata:
        if hasattr(verb_metadata, "to_dict"):
            data["verb_metadata"] = verb_metadata.to_dict()
        elif hasattr(verb_metadata, "model_dump"):
            data["verb_metadata"] = verb_metadata.model_dump()
        elif isinstance(verb_metadata, dict):
            data["verb_metadata"] = verb_metadata
    if len(data) == 1 and "entries" in data and not card_settings and not jlpt_level and not verb_metadata:
        return json.dumps(serialized_entries, ensure_ascii=False)
    return json.dumps(data, ensure_ascii=False)


def _serialize_to_json(items: list[Any]) -> str:
    return json.dumps(_serialize_items(items), ensure_ascii=False)


def _row_to_record(row: sqlite3.Row) -> CardRecord:
    meanings_raw = row["meanings_json"] if "meanings_json" in row.keys() else "[]"
    examples_raw = row["examples_json"] if "examples_json" in row.keys() else "[]"
    entries: list[dict] = []
    kanji_entries: list[dict] = []
    card_settings: dict[str, Any] | None = None
    try:
        parsed_meanings = json.loads(meanings_raw) if meanings_raw else []
        if isinstance(parsed_meanings, dict):
            entries = parsed_meanings.get("entries", []) if isinstance(parsed_meanings.get("entries"), list) else []
            kanji_entries = parsed_meanings.get("kanji_entries", []) if isinstance(parsed_meanings.get("kanji_entries"), list) else []
            card_settings = parsed_meanings.get("card_settings", None) if isinstance(parsed_meanings.get("card_settings"), dict) else None
        elif isinstance(parsed_meanings, list):
            entries = parsed_meanings
            kanji_entries = []
    except Exception:
        entries = []
        kanji_entries = []
    try:
        examples = json.loads(examples_raw) if examples_raw else []
    except Exception:
        examples = []

    jlpt_level = None
    if isinstance(parsed_meanings, dict):
        jlpt_level = parsed_meanings.get("jlpt_level")

    if not jlpt_level and entries:
        for e in entries:
            for t in (e.get("tags") or []):
                t_str = str(t)
                if t_str.lower().startswith("jlpt-n") and len(t_str) == 7:
                    jlpt_level = t_str[5:].upper()
                    break
                elif t_str.lower().startswith("n") and len(t_str) == 2 and t_str[1].isdigit():
                    jlpt_level = t_str.upper()
                    break
            if jlpt_level:
                break

    if not jlpt_level and kanji_entries:
        for k in kanji_entries:
            stats = k.get("stats") or {}
            if stats.get("jlpt") and str(stats.get("jlpt")).upper().startswith("N"):
                jlpt_level = str(stats.get("jlpt")).upper()
                break

    if not jlpt_level and row["expression"]:
        ref = _get_jlpt_reference()
        if ref and hasattr(ref, "lookup_word_with_kanji_fallback"):
            try:
                jlpt_level = ref.lookup_word_with_kanji_fallback(row["expression"])
            except Exception:
                jlpt_level = None

    verb_metadata: VerbMetadata | None = None
    if isinstance(parsed_meanings, dict):
        vm_raw = parsed_meanings.get("verb_metadata")
        if isinstance(vm_raw, dict):
            try:
                verb_metadata = VerbMetadata(
                    is_verb=bool(vm_raw.get("is_verb")),
                    verb_type=vm_raw.get("verb_type"),
                    is_transitive=bool(vm_raw.get("is_transitive")),
                    is_intransitive=bool(vm_raw.get("is_intransitive")),
                    transitivity_label=str(vm_raw.get("transitivity_label") or "none"),
                )
            except Exception:
                verb_metadata = None

    if verb_metadata is None and entries:
        all_pos: list[str] = []
        for e in entries:
            all_pos.extend(e.get("parts_of_speech") or [])
            for s in (e.get("senses") or []):
                all_pos.extend(s.get("parts_of_speech") or [])
            all_pos.extend(e.get("tags") or [])
        if all_pos:
            verb_metadata = parse_verb_metadata(all_pos)

    def _get(key: str, default: str = "") -> str:
        return row[key] if key in row.keys() and row[key] is not None else default

    anki_note_id = row["anki_note_id"] if "anki_note_id" in row.keys() and row["anki_note_id"] is not None else None
    synced_at = row["synced_at"] if "synced_at" in row.keys() and row["synced_at"] is not None else None

    return CardRecord(
        id=row["id"],
        expression=row["expression"],
        reading=row["reading"],
        meaning=_get("meaning"),
        hint=_get("hint"),
        example_sentence=_get("example_sentence"),
        example_translation=_get("example_translation"),
        image=_get("image"),
        audio=_get("audio"),
        tags=_get("tags"),
        notes=_get("notes"),
        source_text=row["source_text"],
        deinflected_text=row["deinflected_text"],
        source_type=_get("source_type", ""),
        source_url=_get("source_url", ""),
        deck_name=row["deck_name"],
        normalized_expression=row["normalized_expression"],
        normalized_reading=row["normalized_reading"],
        normalized_deck_name=row["normalized_deck_name"],
        meanings_json=meanings_raw or "[]",
        examples_json=examples_raw or "[]",
        status=row["status"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        model_name=_get("model_name", ""),
        sync_status=_get("sync_status", "pending"),
        anki_note_id=anki_note_id,
        sync_error=_get("sync_error", ""),
        synced_at=synced_at,
        entries=entries,
        examples=examples,
        kanji_entries=kanji_entries,
        card_settings=card_settings,
        jlpt_level=jlpt_level,
        verb_metadata=verb_metadata,
    )


class CardRepository:
    """Repository boundary for Card persistence in SQLite."""

    def __init__(self, db_path: Path | str | None = None):
        self._db_path = db_path
        init_db(self._db_path)

    def find_by_identity(self, expression: str, reading: str, deck_name: str | None = None) -> CardRecord | None:
        """Find a card by its normalized duplicate identity."""
        norm_expr, norm_read, norm_deck = get_duplicate_identity(expression, reading, deck_name)
        with db_session(self._db_path) as conn:
            row = conn.execute(
                """
                SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                       image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                       normalized_expression, normalized_reading, normalized_deck_name,
                       meanings_json, examples_json, status, created_at, updated_at,
                       sync_status, anki_note_id, sync_error, synced_at, source_type, source_url
                FROM cards
                WHERE normalized_expression = ? AND normalized_reading = ? AND normalized_deck_name = ?
                """,
                (norm_expr, norm_read, norm_deck),
            ).fetchone()
            if row:
                return _row_to_record(row)
        return None

    def get_by_id(self, card_id: int) -> CardRecord | None:
        """Retrieve a card by its database ID."""
        with db_session(self._db_path) as conn:
            row = conn.execute(
                """
                SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                       image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                       normalized_expression, normalized_reading, normalized_deck_name,
                       meanings_json, examples_json, status, created_at, updated_at,
                       sync_status, anki_note_id, sync_error, synced_at, source_type, source_url
                FROM cards
                WHERE id = ?
                """,
                (card_id,),
            ).fetchone()
            if row:
                return _row_to_record(row)
        return None

    def count(self) -> int:
        """Count total stored cards."""
        with db_session(self._db_path) as conn:
            row = conn.execute("SELECT COUNT(*) AS total FROM cards").fetchone()
            return int(row["total"]) if row else 0

    def save_or_update(self, draft: CardDraft) -> tuple[CardRecord, bool, bool, bool]:
        """
        Save a new card draft, update an existing card, or return duplicate collision.
        Returns:
            tuple[CardRecord, bool, bool, bool]: (record, is_new, is_duplicate, is_updated)
        """
        norm_expr, norm_read, norm_deck = get_duplicate_identity(draft.expression, draft.reading, draft.deck_name)
        now_utc = datetime.now(timezone.utc).isoformat()
        meanings_json = _serialize_meanings(draft.entries, draft.kanji_entries, draft.card_settings, draft.jlpt_level, getattr(draft, "verb_metadata", None))
        examples_json = _serialize_to_json(draft.examples)

        with db_session(self._db_path) as conn:
            if draft.id is not None:
                # Editing existing card: verify card exists
                existing = conn.execute("SELECT id, meanings_json, examples_json FROM cards WHERE id = ?", (draft.id,)).fetchone()
                if existing:
                    # Check for identity collision with another card
                    collision = conn.execute(
                        """
                        SELECT id FROM cards
                        WHERE normalized_expression = ? AND normalized_reading = ? AND normalized_deck_name = ? AND id != ?
                        """,
                        (norm_expr, norm_read, norm_deck, draft.id),
                    ).fetchone()
                    if collision:
                        collision_card = self.get_by_id(collision["id"])
                        if collision_card:
                            return collision_card, False, True, False

                    meanings_json_to_save = meanings_json if (draft.entries or draft.kanji_entries or draft.card_settings) else (existing["meanings_json"] if "meanings_json" in existing.keys() and existing["meanings_json"] else "[]")
                    examples_json_to_save = examples_json if draft.examples else (existing["examples_json"] if "examples_json" in existing.keys() and existing["examples_json"] else "[]")

                    # Update existing card
                    conn.execute(
                        """
                        UPDATE cards SET
                            expression = ?,
                            reading = ?,
                            meaning = ?,
                            hint = ?,
                            example_sentence = ?,
                            example_translation = ?,
                            image = ?,
                            audio = ?,
                            tags = ?,
                            notes = ?,
                            source_type = CASE WHEN ? != '' THEN ? ELSE source_type END,
                            source_url = CASE WHEN ? != '' THEN ? ELSE source_url END,
                            deck_name = ?,
                            model_name = ?,
                            normalized_expression = ?,
                            normalized_reading = ?,
                            normalized_deck_name = ?,
                            meanings_json = ?,
                            examples_json = ?,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            draft.expression,
                            draft.reading,
                            draft.meaning,
                            draft.hint,
                            draft.example_sentence,
                            draft.example_translation,
                            draft.image,
                            draft.audio,
                            draft.tags,
                            draft.notes,
                            draft.source_type or "",
                            draft.source_type or "",
                            draft.source_url or "",
                            draft.source_url or "",
                            normalize_deck(draft.deck_name),
                            draft.model_name or "",
                            norm_expr,
                            norm_read,
                            norm_deck,
                            meanings_json_to_save,
                            examples_json_to_save,
                            now_utc,
                            draft.id,
                        ),
                    )
                    conn.commit()
                    updated = self.get_by_id(draft.id)
                    if updated:
                        return updated, False, False, True

            # Saving new card draft: first check duplicate
            existing_record = self.find_by_identity(draft.expression, draft.reading, draft.deck_name)
            if existing_record:
                return existing_record, False, True, False

            try:
                cursor = conn.execute(
                    """
                    INSERT INTO cards (
                        expression, reading, meaning, hint, example_sentence, example_translation,
                        image, audio, tags, notes, source_text, deinflected_text, source_type, source_url,
                        deck_name, model_name, normalized_expression, normalized_reading, normalized_deck_name,
                        meanings_json, examples_json, status, sync_status, anki_note_id,
                        sync_error, synced_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        draft.expression,
                        draft.reading,
                        draft.meaning,
                        draft.hint,
                        draft.example_sentence,
                        draft.example_translation,
                        draft.image,
                        draft.audio,
                        draft.tags,
                        draft.notes,
                        draft.source_text,
                        draft.deinflected_text,
                        draft.source_type or "",
                        draft.source_url or "",
                        normalize_deck(draft.deck_name),
                        draft.model_name or "",
                        norm_expr,
                        norm_read,
                        norm_deck,
                        meanings_json,
                        examples_json,
                        draft.status,
                        draft.sync_status,
                        draft.anki_note_id,
                        draft.sync_error,
                        draft.synced_at,
                        now_utc,
                        now_utc,
                    ),
                )
                conn.commit()
                inserted_id = cursor.lastrowid
            except sqlite3.IntegrityError:
                # Concurrent insertion race condition - return existing
                existing_record = self.find_by_identity(draft.expression, draft.reading, draft.deck_name)
                if existing_record:
                    return existing_record, False, True, False
                raise

        new_card = self.get_by_id(inserted_id)
        if not new_card:
            raise RuntimeError(f"Card row {inserted_id} could not be retrieved after insert.")
        return new_card, True, False, False

    def save(self, draft: CardDraft) -> tuple[CardRecord, bool]:
        """Backward-compatible save method returning (record, is_new)."""
        record, is_new, _, _ = self.save_or_update(draft)
        return record, is_new

    def mark_syncing(self, card_id: int) -> CardRecord | None:
        """Mark a card's sync_status as syncing."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with db_session(self._db_path) as conn:
            conn.execute(
                "UPDATE cards SET sync_status = 'syncing', updated_at = ? WHERE id = ?",
                (now_utc, card_id),
            )
            conn.commit()
        return self.get_by_id(card_id)

    def mark_synced(self, card_id: int, anki_note_id: int) -> CardRecord | None:
        """Mark a card as successfully synced to Anki."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with db_session(self._db_path) as conn:
            conn.execute(
                """
                UPDATE cards SET
                    sync_status = 'synced',
                    anki_note_id = ?,
                    sync_error = '',
                    synced_at = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (anki_note_id, now_utc, now_utc, card_id),
            )
            conn.commit()
        return self.get_by_id(card_id)

    def mark_failed(self, card_id: int, error_message: str) -> CardRecord | None:
        """Mark a card as failed to sync to Anki."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with db_session(self._db_path) as conn:
            conn.execute(
                """
                UPDATE cards SET
                    sync_status = 'failed',
                    sync_error = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (error_message, now_utc, card_id),
            )
            conn.commit()
        return self.get_by_id(card_id)

    def set_anki_note_id(self, card_id: int, anki_note_id: int) -> CardRecord | None:
        """Associate an Anki note ID with a card."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with db_session(self._db_path) as conn:
            conn.execute(
                "UPDATE cards SET anki_note_id = ?, updated_at = ? WHERE id = ?",
                (anki_note_id, now_utc, card_id),
            )
            conn.commit()
        return self.get_by_id(card_id)

    def get_pending_or_failed_cards(self, deck_name: str | None = None) -> list[CardRecord]:
        """Retrieve all cards with sync_status in ('pending', 'failed'), optionally filtered by deck."""
        with db_session(self._db_path) as conn:
            if deck_name and deck_name.strip() and deck_name.strip().lower() != "all":
                rows = conn.execute(
                    """
                    SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                           image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                           normalized_expression, normalized_reading, normalized_deck_name,
                           meanings_json, examples_json, status, created_at, updated_at,
                           sync_status, anki_note_id, sync_error, synced_at, source_type, source_url
                    FROM cards
                    WHERE sync_status IN ('pending', 'failed') AND deck_name = ?
                    ORDER BY id ASC
                    """,
                    (deck_name.strip(),),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                           image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                           normalized_expression, normalized_reading, normalized_deck_name,
                           meanings_json, examples_json, status, created_at, updated_at,
                           sync_status, anki_note_id, sync_error, synced_at, source_type, source_url
                    FROM cards
                    WHERE sync_status IN ('pending', 'failed')
                    ORDER BY id ASC
                    """
                ).fetchall()
            return [_row_to_record(row) for row in rows]

    def get_recoverable_cards(self, deck_name: str | None = None) -> list[CardRecord]:
        """Retrieve pending, failed, and previously synced cards for external-state verification."""
        with db_session(self._db_path) as conn:
            deck_clause = ""
            params: tuple[str, ...] = ()
            if deck_name and deck_name.strip() and deck_name.strip().lower() != "all":
                deck_clause = " AND deck_name = ?"
                params = (deck_name.strip(),)
            rows = conn.execute(
                f"""
                SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                       image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                       normalized_expression, normalized_reading, normalized_deck_name,
                       meanings_json, examples_json, status, created_at, updated_at,
                       sync_status, anki_note_id, sync_error, synced_at, source_type, source_url
                FROM cards
                WHERE (sync_status IN ('pending', 'failed')
                       OR (sync_status = 'synced' AND anki_note_id IS NOT NULL)){deck_clause}
                ORDER BY id ASC
                """,
                params,
            ).fetchall()
            return [_row_to_record(row) for row in rows]

    def get_sync_state(self, card_id: int) -> dict[str, Any] | None:
        """Retrieve the sync state of a card."""
        card = self.get_by_id(card_id)
        if not card:
            return None
        return {
            "id": card.id,
            "sync_status": card.sync_status,
            "anki_note_id": card.anki_note_id,
            "sync_error": card.sync_error,
            "synced_at": card.synced_at,
            "deck_name": card.deck_name,
            "model_name": card.model_name,
        }

    def list_cards(
        self,
        search: str | None = None,
        deck_name: str | None = None,
        sync_status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[CardRecord]:
        """
        List cards with optional search query and filters.
        Results are ordered by id DESC (newest cards first).
        """
        query = """
            SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                   image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                   normalized_expression, normalized_reading, normalized_deck_name,
                   meanings_json, examples_json, status, created_at, updated_at,
                   sync_status, anki_note_id, sync_error, synced_at, source_type, source_url
            FROM cards
        """
        conditions = []
        params: list[Any] = []

        if search and search.strip():
            term = f"%{search.strip()}%"
            conditions.append(
                "(expression LIKE ? OR reading LIKE ? OR meaning LIKE ? OR example_sentence LIKE ? OR notes LIKE ? OR tags LIKE ?)"
            )
            params.extend([term, term, term, term, term, term])

        if deck_name and deck_name.strip() and deck_name.strip().lower() != "all":
            conditions.append("deck_name = ?")
            params.append(deck_name.strip())

        if sync_status and sync_status.strip() and sync_status.strip().lower() != "all":
            conditions.append("sync_status = ?")
            params.append(sync_status.strip().lower())

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY id DESC LIMIT ? OFFSET ?"
        params.extend([min(500, max(1, limit)), max(0, offset)])

        with db_session(self._db_path) as conn:
            rows = conn.execute(query, params).fetchall()
            return [_row_to_record(row) for row in rows]

    def count_cards(
        self,
        search: str | None = None,
        deck_name: str | None = None,
        sync_status: str | None = None,
    ) -> int:
        """Count cards matching optional search query and filters."""
        query = "SELECT COUNT(*) AS total FROM cards"
        conditions = []
        params: list[Any] = []

        if search and search.strip():
            term = f"%{search.strip()}%"
            conditions.append(
                "(expression LIKE ? OR reading LIKE ? OR meaning LIKE ? OR example_sentence LIKE ? OR notes LIKE ? OR tags LIKE ?)"
            )
            params.extend([term, term, term, term, term, term])

        if deck_name and deck_name.strip() and deck_name.strip().lower() != "all":
            conditions.append("deck_name = ?")
            params.append(deck_name.strip())

        if sync_status and sync_status.strip() and sync_status.strip().lower() != "all":
            conditions.append("sync_status = ?")
            params.append(sync_status.strip().lower())

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        with db_session(self._db_path) as conn:
            row = conn.execute(query, params).fetchone()
            return int(row["total"]) if row else 0

    def get_saved_decks(self) -> list[str]:
        """Retrieve unique deck names from saved cards."""
        with db_session(self._db_path) as conn:
            rows = conn.execute("SELECT DISTINCT deck_name FROM cards ORDER BY deck_name ASC").fetchall()
            return [row["deck_name"] for row in rows if row["deck_name"]]

    def delete(self, card_id: int) -> bool:
        """Delete a card row from SQLite by id. Returns True if deleted, False if not found."""
        with db_session(self._db_path) as conn:
            cursor = conn.execute("DELETE FROM cards WHERE id = ?", (card_id,))
            conn.commit()
            return cursor.rowcount > 0

    def delete_many(self, ids: list[int | str]) -> int:
        """Delete multiple card rows by id. Returns count of rows deleted."""
        valid_ids = [int(i) for i in ids if str(i).isdigit() or (isinstance(i, int) and not isinstance(i, bool))]
        if not valid_ids:
            return 0
        placeholders = ",".join("?" for _ in valid_ids)
        with db_session(self._db_path) as conn:
            cursor = conn.execute(f"DELETE FROM cards WHERE id IN ({placeholders})", valid_ids)
            conn.commit()
            return cursor.rowcount

    def get_many(self, ids: list[int | str]) -> list[CardRecord]:
        """Retrieve multiple cards by id."""
        valid_ids = [int(i) for i in ids if str(i).isdigit() or (isinstance(i, int) and not isinstance(i, bool))]
        if not valid_ids:
            return []
        placeholders = ",".join("?" for _ in valid_ids)
        with db_session(self._db_path) as conn:
            rows = conn.execute(
                f"""
                SELECT id, expression, reading, meaning, hint, example_sentence, example_translation,
                       image, audio, tags, notes, source_text, deinflected_text, deck_name, model_name,
                       normalized_expression, normalized_reading, normalized_deck_name,
                       meanings_json, examples_json, status, created_at, updated_at,
                       sync_status, anki_note_id, sync_error, synced_at, source_type, source_url
                FROM cards
                WHERE id IN ({placeholders})
                ORDER BY id DESC
                """,
                valid_ids,
            ).fetchall()
            return [_row_to_record(row) for row in rows]

    def update_deck_many(self, ids: list[int | str], deck_name: str) -> int:
        """Update target deck for multiple cards."""
        valid_ids = [int(i) for i in ids if str(i).isdigit() or (isinstance(i, int) and not isinstance(i, bool))]
        if not valid_ids or not deck_name or not deck_name.strip():
            return 0
        norm_deck = normalize_deck(deck_name)
        now_utc = datetime.now(timezone.utc).isoformat()
        placeholders = ",".join("?" for _ in valid_ids)
        with db_session(self._db_path) as conn:
            cursor = conn.execute(
                f"""
                UPDATE cards SET
                    deck_name = ?,
                    normalized_deck_name = ?,
                    updated_at = ?
                WHERE id IN ({placeholders})
                """,
                [deck_name.strip(), norm_deck, now_utc, *valid_ids],
            )
            conn.commit()
            return cursor.rowcount

    def get_stats(self) -> dict[str, Any]:
        """
        Aggregate mining statistics:
        - cards mined today, this week, all-time
        - sync ratio (synced vs pending vs failed)
        - JLPT level breakdown (N5, N4, N3, N2, N1, Unknown)
        - top 3 decks by card count
        """
        with db_session(self._db_path) as conn:
            time_row = conn.execute(
                """
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN DATE(created_at) = DATE('now') THEN 1 ELSE 0 END) as today,
                    SUM(CASE WHEN DATE(created_at) >= DATE('now', '-7 days') THEN 1 ELSE 0 END) as this_week
                FROM cards
                """
            ).fetchone()
            total = int(time_row["total"]) if time_row and time_row["total"] is not None else 0
            today = int(time_row["today"]) if time_row and time_row["today"] is not None else 0
            this_week = int(time_row["this_week"]) if time_row and time_row["this_week"] is not None else 0

            sync_rows = conn.execute(
                "SELECT sync_status, COUNT(*) as cnt FROM cards GROUP BY sync_status"
            ).fetchall()
            sync_counts = {"synced": 0, "pending": 0, "failed": 0, "total": total}
            for row in sync_rows:
                st = str(row["sync_status"]).lower()
                c = int(row["cnt"])
                if st in sync_counts:
                    sync_counts[st] = c
                elif st == "syncing":
                    sync_counts["pending"] += c

            deck_rows = conn.execute(
                """
                SELECT deck_name, COUNT(*) as cnt
                FROM cards
                GROUP BY deck_name
                ORDER BY cnt DESC, deck_name ASC
                LIMIT 3
                """
            ).fetchall()
            top_decks = [
                {"deck_name": str(r["deck_name"]), "count": int(r["cnt"])}
                for r in deck_rows
            ]

            card_rows = conn.execute(
                "SELECT id, expression, meanings_json FROM cards"
            ).fetchall()
            jlpt_breakdown = {
                "N5": 0,
                "N4": 0,
                "N3": 0,
                "N2": 0,
                "N1": 0,
                "Unknown": 0,
            }
            ref = _get_jlpt_reference()
            for r in card_rows:
                lvl = None
                raw_m = r["meanings_json"]
                try:
                    parsed = json.loads(raw_m) if raw_m else {}
                except Exception:
                    parsed = {}

                if isinstance(parsed, dict):
                    lvl = parsed.get("jlpt_level")
                    if not lvl and "entries" in parsed:
                        for e in (parsed.get("entries") or []):
                            for t in (e.get("tags") or []):
                                t_str = str(t)
                                if t_str.lower().startswith("jlpt-n") and len(t_str) == 7:
                                    lvl = t_str[5:].upper()
                                    break
                                elif t_str.lower().startswith("n") and len(t_str) == 2 and t_str[1].isdigit():
                                    lvl = t_str.upper()
                                    break
                            if lvl:
                                break
                    if not lvl and "kanji_entries" in parsed:
                        for k in (parsed.get("kanji_entries") or []):
                            stats = k.get("stats") or {}
                            if stats.get("jlpt") and str(stats.get("jlpt")).upper().startswith("N"):
                                lvl = str(stats.get("jlpt")).upper()
                                break
                elif isinstance(parsed, list):
                    for e in parsed:
                        for t in (e.get("tags") or []):
                            t_str = str(t)
                            if t_str.lower().startswith("jlpt-n") and len(t_str) == 7:
                                lvl = t_str[5:].upper()
                                break
                            elif t_str.lower().startswith("n") and len(t_str) == 2 and t_str[1].isdigit():
                                lvl = t_str.upper()
                                break
                        if lvl:
                            break

                if not lvl and r["expression"] and ref and hasattr(ref, "lookup_word_with_kanji_fallback"):
                    try:
                        lvl = ref.lookup_word_with_kanji_fallback(r["expression"])
                    except Exception:
                        lvl = None

                lvl_clean = str(lvl).upper() if lvl else "UNKNOWN"
                if lvl_clean in ("N1", "N2", "N3", "N4", "N5"):
                    jlpt_breakdown[lvl_clean] += 1
                else:
                    jlpt_breakdown["Unknown"] += 1

            return {
                "total": total,
                "today": today,
                "this_week": this_week,
                "timeframe": {
                    "today": today,
                    "this_week": this_week,
                    "total": total,
                },
                "sync_ratio": sync_counts,
                "jlpt_breakdown": jlpt_breakdown,
                "top_decks": top_decks,
            }

