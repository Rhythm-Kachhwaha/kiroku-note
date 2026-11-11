"""Service layer for canonical word state tracking, encounter summaries, and Anki FSRS hydration."""
from __future__ import annotations

from datetime import datetime, timezone
import logging
from pathlib import Path
from typing import Any, Sequence

from app.config import get_anki_known_min_interval, get_anki_max_lapses
from app.repositories.word_state_repository import (
    MANUAL_OVERRIDE_STATES,
    WordStateRecord,
    WordStateRepository,
    WordStatesIndex,
    normalize_word_expression,
    normalize_word_reading,
)
from app.services.anki_connect import AnkiConnectService, AnkiConnectionError

logger = logging.getLogger(__name__)


def evaluate_anki_card_mastery(
    card_metrics: dict[str, Any],
    *,
    known_min_interval: int | None = None,
    max_lapses: int | None = None,
    existing_state: str | None = None,
) -> tuple[str, str, int, int]:
    """
    Compute dynamic (word_state, anki_status, interval, lapses) from Anki card metrics.

    Rules:
    - Suspended (queue == -1 or suspended=True) -> anki_status='suspended', demote to 'learning' (or 'seen').
    - Flagged (flags > 0) -> anki_status='flagged', demote to 'learning' (or 'seen').
    - Active with interval >= known_min_interval and lapses < max_lapses -> ('known', 'active').
    - Active otherwise (reps > 0 or interval < known_min_interval or lapses >= max_lapses) -> ('learning', 'active').
    """
    min_interval = (
        int(known_min_interval)
        if known_min_interval is not None
        else get_anki_known_min_interval()
    )
    lapses_limit = (
        int(max_lapses)
        if max_lapses is not None
        else get_anki_max_lapses()
    )

    interval = int(card_metrics.get("interval") or 0)
    lapses = int(card_metrics.get("lapses") or 0)
    queue = int(card_metrics.get("queue") or 0)
    reps = int(card_metrics.get("reps") or 0)
    flags = int(card_metrics.get("flags") or 0)
    suspended = bool(card_metrics.get("suspended")) or queue == -1

    if suspended:
        demoted = "learning" if (existing_state in ("known", "learning") or reps > 0) else "seen"
        return demoted, "suspended", interval, lapses

    if flags > 0:
        demoted = "learning" if (existing_state in ("known", "learning") or reps > 0) else "seen"
        return demoted, "flagged", interval, lapses

    if interval >= min_interval and lapses < lapses_limit:
        return "known", "active", interval, lapses

    return "learning", "active", interval, lapses


def aggregate_note_cards_mastery(
    cards_metrics: Sequence[dict[str, Any]],
    *,
    known_min_interval: int | None = None,
    max_lapses: int | None = None,
    existing_state: str | None = None,
) -> tuple[str, str, int, int]:
    """
    Aggregate mastery across all Anki cards belonging to a note/word.

    If at least one card is active (not suspended and flags == 0), evaluates the
    strongest active card; only demotes for suspended/flagged when no active cards remain.
    """
    if not cards_metrics:
        return "seen", "deleted", 0, 0

    active_cards = [
        c
        for c in cards_metrics
        if not (bool(c.get("suspended")) or int(c.get("queue") or 0) == -1)
        and int(c.get("flags") or 0) == 0
    ]

    if active_cards:
        evaluated = [
            evaluate_anki_card_mastery(
                c,
                known_min_interval=known_min_interval,
                max_lapses=max_lapses,
                existing_state=existing_state,
            )
            for c in active_cards
        ]
        # Prefer known over learning, then higher interval, then fewer lapses
        return max(
            evaluated,
            key=lambda item: (1 if item[0] == "known" else 0, item[2], -item[3]),
        )

    # All cards are suspended or flagged
    suspended_cards = [
        c
        for c in cards_metrics
        if bool(c.get("suspended")) or int(c.get("queue") or 0) == -1
    ]
    chosen = suspended_cards[0] if suspended_cards else cards_metrics[0]
    return evaluate_anki_card_mastery(
        chosen,
        known_min_interval=known_min_interval,
        max_lapses=max_lapses,
        existing_state=existing_state,
    )


class WordStateService:
    """High-level service managing canonical word states, encounters, and Anki FSRS sync."""

    def __init__(
        self,
        db_path: Path | str | None = None,
        repository: WordStateRepository | None = None,
        dict_engine: Any = None,
    ):
        self.repository = repository or WordStateRepository(db_path=db_path)
        self._db_path = db_path if db_path is not None else self.repository._db_path
        self._dict_engine = dict_engine
        self._dict_engine_checked = dict_engine is not None

    def _get_dict_engine(self) -> Any:
        if self._dict_engine is not None or self._dict_engine_checked:
            return self._dict_engine
        self._dict_engine_checked = True
        try:
            from app.services.dictionary_provider import resolve_dictionary_db_path
            from kiroku_dictionary import DictionaryEngine

            dict_path = resolve_dictionary_db_path()
            if dict_path.is_file():
                self._dict_engine = DictionaryEngine(str(dict_path))
        except Exception as exc:
            logger.debug("Optional DictionaryEngine init skipped in WordStateService: %s", exc)
            self._dict_engine = None
        return self._dict_engine

    def _resolve_identity(
        self,
        *,
        expression: str,
        reading: str = "",
        sequence_id: int | None = None,
        index: WordStatesIndex | None = None,
    ) -> tuple[int | None, str, str]:
        norm_expr = normalize_word_expression(expression)
        norm_read = normalize_word_reading(reading)
        if sequence_id is not None:
            return int(sequence_id), norm_read, norm_expr

        engine = self._get_dict_engine()
        if engine is not None and norm_expr:
            try:
                canon = engine.resolve_canonical(norm_expr, reading=norm_read)
                if canon is not None:
                    return (
                        int(canon.sequence_id),
                        normalize_word_reading(canon.reading),
                        normalize_word_expression(canon.term) or norm_expr,
                    )
            except Exception as exc:
                logger.debug("Canonical resolution skipped for '%s': %s", norm_expr, exc)

        if index is not None and norm_expr and norm_read:
            existing_matches = index.by_expr_reading_any.get((norm_expr, norm_read), [])
            if len(existing_matches) == 1:
                rec = existing_matches[0]
                return rec.sequence_id, rec.reading, rec.expression

        return None, norm_read, norm_expr

    def get_word_state(
        self,
        *,
        sequence_id: int | None = None,
        reading: str = "",
        expression: str = "",
    ) -> WordStateRecord | None:
        index = self.repository.get_word_states_index()
        resolved_seq, resolved_read, resolved_expr = self._resolve_identity(
            expression=expression,
            reading=reading,
            sequence_id=sequence_id,
            index=index,
        )
        rec = self.repository.get_word_state(
            sequence_id=resolved_seq,
            reading=resolved_read,
            expression=resolved_expr,
        )
        if rec is None and sequence_id is None and expression:
            rec = self.repository.get_word_state(
                sequence_id=None,
                reading=reading,
                expression=expression,
            )
        return rec

    def set_user_word_state(
        self,
        *,
        state: str,
        expression: str = "",
        reading: str = "",
        sequence_id: int | None = None,
    ) -> WordStateRecord:
        index = self.repository.get_word_states_index()
        resolved_seq, resolved_read, resolved_expr = self._resolve_identity(
            expression=expression,
            reading=reading,
            sequence_id=sequence_id,
            index=index,
        )
        return self.repository.set_user_word_state(
            state=state,
            expression=resolved_expr,
            reading=resolved_read,
            sequence_id=resolved_seq,
        )

    def list_word_states(
        self,
        *,
        state: str | None = None,
        include_blacklisted: bool = True,
        search: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[WordStateRecord]:
        return self.repository.list_word_states(
            state=state,
            include_blacklisted=include_blacklisted,
            search=search,
            limit=limit,
            offset=offset,
        )

    def get_stats(self) -> dict[str, Any]:
        return self.repository.get_stats()

    def log_encounter(
        self,
        *,
        expression: str,
        reading: str = "",
        sequence_id: int | None = None,
        sentence: str = "",
        source_media: str = "",
        timestamp: str | None = None,
    ) -> int:
        return self.repository.log_encounter(
            expression=expression,
            reading=reading,
            sequence_id=sequence_id,
            sentence=sentence,
            source_media=source_media,
            timestamp=timestamp,
        )

    def log_encounters(
        self,
        encounters: Sequence[dict[str, Any]],
        *,
        default_sentence: str = "",
        default_source_media: str = "",
        timestamp: str | None = None,
    ) -> int:
        return self.repository.log_encounters(
            encounters,
            default_sentence=default_sentence,
            default_source_media=default_source_media,
            timestamp=timestamp,
        )

    def get_encounter_summary(
        self,
        *,
        sequence_id: int | None = None,
        reading: str = "",
        expression: str = "",
        recent_limit: int = 10,
    ) -> dict[str, Any]:
        return self.repository.get_encounter_summary(
            sequence_id=sequence_id,
            reading=reading,
            expression=expression,
            recent_limit=recent_limit,
        )

    def apply_anki_card_metrics(
        self,
        cards_metrics: Sequence[dict[str, Any]],
        *,
        known_min_interval: int | None = None,
        max_lapses: int | None = None,
        reconcile_deleted: bool = False,
        expected_identities: Sequence[tuple[int | None, str, str]] | None = None,
    ) -> dict[str, Any]:
        """
        Hydrate word_states from Anki card metrics and apply automatic demotions.

        Supports grouping multiple Anki cards per word/note and optional deleted-card
        demotion when reconciling a full Anki sync or expected note set.
        """
        index = self.repository.get_word_states_index()
        grouped: dict[tuple[int | None, str, str], list[dict[str, Any]]] = {}

        for card in cards_metrics:
            expr = str(card.get("expression") or "").strip()
            reading = str(card.get("reading") or "").strip()
            seq_raw = card.get("sequence_id")
            seq_arg = int(seq_raw) if seq_raw is not None else None
            if seq_arg is None and not expr:
                continue

            resolved_seq, resolved_read, resolved_expr = self._resolve_identity(
                expression=expr,
                reading=reading,
                sequence_id=seq_arg,
                index=index,
            )
            key = (
                resolved_seq,
                resolved_read,
                resolved_expr if resolved_seq is None else "",
            )
            enriched_card = dict(card)
            enriched_card["_resolved_expr"] = resolved_expr
            grouped.setdefault(key, []).append(enriched_card)

        summary: dict[str, Any] = {
            "connected": True,
            "synced": 0,
            "known": 0,
            "learning": 0,
            "demoted": 0,
            "suspended": 0,
            "flagged": 0,
            "deleted": 0,
            "skipped_override": 0,
        }
        now_iso = datetime.now(timezone.utc).isoformat()
        seen_identities: set[tuple[int | None, str, str]] = set()

        for (seq_id, norm_read, fallback_expr), group_cards in grouped.items():
            expr_val = next(
                (c.get("_resolved_expr") for c in group_cards if c.get("_resolved_expr")),
                fallback_expr,
            )
            seen_identities.add((seq_id, norm_read, expr_val if seq_id is None else ""))

            existing = self.repository.get_word_state(
                sequence_id=seq_id,
                reading=norm_read,
                expression=expr_val,
            )
            if existing is not None and existing.state in MANUAL_OVERRIDE_STATES:
                summary["skipped_override"] += 1
                continue

            existing_state = existing.state if existing is not None else None
            target_state, anki_status, interval, lapses = aggregate_note_cards_mastery(
                group_cards,
                known_min_interval=known_min_interval,
                max_lapses=max_lapses,
                existing_state=existing_state,
            )

            self.repository.upsert_word_state(
                expression=expr_val,
                reading=norm_read,
                sequence_id=seq_id,
                state=target_state,
                anki_interval=interval,
                anki_lapses=lapses,
                anki_status=anki_status,
                respect_manual_override=True,
                now_iso=now_iso,
            )
            summary["synced"] += 1
            if target_state == "known":
                summary["known"] += 1
            elif target_state == "learning":
                summary["learning"] += 1

            if anki_status == "suspended":
                summary["suspended"] += 1
                if existing_state == "known" or target_state != "known":
                    summary["demoted"] += 1
            elif anki_status == "flagged":
                summary["flagged"] += 1
                if existing_state == "known" or target_state != "known":
                    summary["demoted"] += 1

        if reconcile_deleted:
            for existing in self.repository.list_anki_backed_states():
                ident = (
                    existing.sequence_id,
                    existing.reading,
                    existing.expression if existing.sequence_id is None else "",
                )
                if ident in seen_identities:
                    continue
                if existing.state in MANUAL_OVERRIDE_STATES:
                    summary["skipped_override"] += 1
                    continue
                if existing.state in ("known", "learning") or existing.anki_status in (
                    "active",
                    "suspended",
                    "flagged",
                ):
                    self.repository.upsert_word_state(
                        expression=existing.expression,
                        reading=existing.reading,
                        sequence_id=existing.sequence_id,
                        state="seen",
                        anki_lapses=existing.anki_lapses,
                        anki_status="deleted",
                        clear_anki_interval=True,
                        respect_manual_override=True,
                        now_iso=now_iso,
                    )
                    summary["demoted"] += 1
                    summary["deleted"] += 1

        if expected_identities:
            for exp_seq, exp_read, exp_expr in expected_identities:
                resolved_seq, resolved_read, resolved_expr = self._resolve_identity(
                    expression=exp_expr,
                    reading=exp_read,
                    sequence_id=exp_seq,
                    index=index,
                )
                ident = (
                    resolved_seq,
                    resolved_read,
                    resolved_expr if resolved_seq is None else "",
                )
                if ident in seen_identities:
                    continue
                existing = self.repository.get_word_state(
                    sequence_id=resolved_seq,
                    reading=resolved_read,
                    expression=resolved_expr,
                )
                if existing is None or existing.state in MANUAL_OVERRIDE_STATES:
                    if existing is not None and existing.state in MANUAL_OVERRIDE_STATES:
                        summary["skipped_override"] += 1
                    continue
                if existing.state in ("known", "learning") or existing.anki_status in (
                    "active",
                    "suspended",
                    "flagged",
                ):
                    self.repository.upsert_word_state(
                        expression=existing.expression,
                        reading=existing.reading,
                        sequence_id=existing.sequence_id,
                        state="seen",
                        anki_lapses=existing.anki_lapses,
                        anki_status="deleted",
                        clear_anki_interval=True,
                        respect_manual_override=True,
                        now_iso=now_iso,
                    )
                    summary["demoted"] += 1
                    summary["deleted"] += 1

        return summary

    def sync_from_anki(
        self,
        *,
        anki_service: AnkiConnectService | None = None,
        deck_name: str | None = None,
        query: str | None = None,
        note_ids: list[int] | None = None,
        known_min_interval: int | None = None,
        max_lapses: int | None = None,
        reconcile_deleted: bool | None = None,
    ) -> dict[str, Any]:
        """
        Pull card review metrics from AnkiConnect and hydrate word_states.

        Automatically reconciles deleted cards when performing a full collection sync
        (when deck_name, query, and note_ids are all unspecified).
        """
        anki = anki_service or AnkiConnectService()
        connected, error_msg = anki.is_connected()
        if not connected:
            return {
                "connected": False,
                "error": error_msg or "AnkiConnect is unreachable.",
                "synced": 0,
                "known": 0,
                "learning": 0,
                "demoted": 0,
                "suspended": 0,
                "flagged": 0,
                "deleted": 0,
                "skipped_override": 0,
            }

        cards_metrics = anki.get_card_metrics(
            query=query,
            deck_name=deck_name,
            note_ids=note_ids,
        )
        full_sync = (
            reconcile_deleted
            if reconcile_deleted is not None
            else (deck_name is None and query is None and note_ids is None)
        )
        return self.apply_anki_card_metrics(
            cards_metrics,
            known_min_interval=known_min_interval,
            max_lapses=max_lapses,
            reconcile_deleted=full_sync,
        )

    def sync_cards_from_anki(
        self,
        cards: Sequence[Any],
        *,
        anki_service: AnkiConnectService | None = None,
        known_min_interval: int | None = None,
        max_lapses: int | None = None,
    ) -> dict[str, Any]:
        """Hydrate FSRS state for a specific sequence of local CardRecord entries."""
        anki = anki_service or AnkiConnectService()
        note_cards = [c for c in cards if getattr(c, "anki_note_id", None) is not None]
        if not note_cards:
            return {
                "connected": True,
                "synced": 0,
                "known": 0,
                "learning": 0,
                "demoted": 0,
                "suspended": 0,
                "flagged": 0,
                "deleted": 0,
                "skipped_override": 0,
            }

        note_ids = [int(c.anki_note_id) for c in note_cards]
        try:
            cards_metrics = anki.get_card_metrics(note_ids=note_ids)
        except AnkiConnectionError as exc:
            return {
                "connected": False,
                "error": str(exc),
                "synced": 0,
                "known": 0,
                "learning": 0,
                "demoted": 0,
                "suspended": 0,
                "flagged": 0,
                "deleted": 0,
                "skipped_override": 0,
            }
        by_note_id: dict[int, tuple[str, str]] = {
            int(c.anki_note_id): (str(c.expression or ""), str(c.reading or ""))
            for c in note_cards
        }
        for metric in cards_metrics:
            nid = metric.get("note_id")
            if nid is not None and int(nid) in by_note_id:
                local_expr, local_read = by_note_id[int(nid)]
                if not metric.get("expression"):
                    metric["expression"] = local_expr
                if not metric.get("reading"):
                    metric["reading"] = local_read

        expected = [(None, str(c.reading or ""), str(c.expression or "")) for c in note_cards]
        return self.apply_anki_card_metrics(
            cards_metrics,
            known_min_interval=known_min_interval,
            max_lapses=max_lapses,
            reconcile_deleted=False,
            expected_identities=expected,
        )
