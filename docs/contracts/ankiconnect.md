# Contract: ankiconnect
Depends-on: db

## Purpose
Manages bidirectional synchronization, note formatting, review logging, media storage, and communication between Kiroku's local SQLite database and the AnkiConnect HTTP API.

## Boundaries
- HTTP endpoints:
  - `GET /api/anki/status` -> `AnkiStatusResponse` (connected, version, endpoint_url, error)
  - `GET /api/anki/decks` -> `AnkiDecksResponse` (decks, connected)
  - `GET /api/anki/models` -> `AnkiModelsResponse` (models, connected)
  - `GET /api/anki/model-capabilities` -> `AnkiModelCapabilitiesResponse`
  - `POST /api/anki/sync-all` -> `SyncAllResponse` (synced_count, failed_count, results)
  - `POST /api/review/sync-anki` -> `{status, imported_count, flushed_count, failed_count, pulled_count, pushed_count}`
  - `POST /api/review/answer` -> records review, logs atomic review, triggers synchronous/queued Anki review sync
  - `GET /api/review/stats` -> `{total_cards, cards_due_today, reviews_due_count, new_count, learn_count, due_count, ...}` matching local SQLite truth
  - Background task `_anki_fsrs_auto_flush_task` (runs every 15s to flush offline queued reviews to Anki)
- RPC actions to AnkiConnect (`127.0.0.1:8765`):
  - `version` -> int/str
  - `deckNames` -> list[str]
  - `createDeck` -> int
  - `modelNames` -> list[str]
  - `modelFieldNames` -> list[str]
  - `notesInfo` -> list[dict]
  - `cardsInfo` -> list[dict]
  - `findNotes` -> list[int]
  - `findCards` -> list[int]
  - `addNote` -> int
  - `canAddNotes` -> list[bool]
  - `updateNoteFields` -> None
  - `storeMediaFile` -> str
  - `answerCards` -> list[bool]
  - `suspend` / `unsuspend` -> bool
  - `sync` -> None
- Internal Service methods:
  - `AnkiConnectService.is_connected() -> tuple[bool, str | None]`
  - `AnkiConnectService.add_note(deck_name, card_data, tags, model_name) -> int`
  - `AnkiConnectService.answer_card(card_id, ease) -> bool`
  - `AnkiConnectService.find_existing_note(deck_name, expression, reading) -> int | None`
  - `AnkiFSRSSyncService.sync_card_review(card_id, rating, log_id) -> dict`
  - `AnkiFSRSSyncService.flush_pending_reviews() -> dict`
  - `AnkiFSRSSyncService.pull_anki_reviews(deck_name) -> dict`
  - `AnkiFSRSSyncService.full_sync(deck_name) -> dict`

## State and storage
- SQLite tables:
  - `cards` (`anki_note_id`, `deck_name`, `normalized_deck_name`, `sync_status`, `sync_error`)
  - `card_fsrs` (`anki_card_id`, `sync_state`, `state`, `stability`, `difficulty`, `reps`, `lapses`, `due_date`, `is_suspended`, `buried_until`)
  - `review_logs` (`id`, `card_id`, `rating`, `state`, `scheduled_days`, `elapsed_days`, `reviewed_at`, `duration_ms`, `synced_to_anki`, `last_fsrs_snapshot`)
- Media directory: `data/media`
- In-memory lock: `_ANKI_FSRS_SYNC_LOCK` serializing concurrent two-way sync and flush operations
- Environment variable: `ANKI_CONNECT_URL` (default `http://127.0.0.1:8765`)

## Dependencies
- Module `db`: `app.db.connection.db_session`, `cards`, `card_fsrs`, `review_logs` tables
- Third-party Anki Desktop with AnkiConnect addon listening on port 8765 (JSON-RPC 2.0-like HTTP boundary)

## Invariants
- 1. SQLite is the local source of truth: AnkiConnect offline never deletes, resets, or corrupts local cards, FSRS states, or review logs.
- 2. Offline reviews done in Kiroku are preserved in `review_logs` (`synced_to_anki=0`) and flushed to Anki as soon as Anki opens.
- 3. Offline reviews on cards not yet in Anki trigger automatic note creation in Anki prior to answering the card.
- 4. Flushing pending reviews answers Anki with the user's latest review rating, marks all prior superseded logs as synced, and never replays old reviews in reverse or out-of-order.
- 5. Anki -> Kiroku review pull NEVER overwrites cards that have unsynced Kiroku reviews waiting in the queue.
- 6. Kiroku review stats (`cards_due_today`, `due_count`, `new_count`, `learn_count`) ALWAYS match Kiroku SQLite's actual due queue (`get_due_cards`), never creating phantom/false review sessions.
- 7. Two-way sync is strictly serialized via `_ANKI_FSRS_SYNC_LOCK` preventing race conditions or double-answering.
- 8. Duplicate deck names across hierarchy (e.g. `JLPT` vs `Japanese::JLPT`) resolve to the existing deck without duplicate deck creation.
- 9. Japanese/unicode characters in expressions, readings, meanings, tags, and deck names round-trip without corruption.
- 10. Persistent failures or deleted cards in Anki are dead-lettered / marked orphaned, never blocking the queue indefinitely.

## Failure behavior
- AnkiConnect offline/unreachable: raises `AnkiConnectionError` or returns `connected=False`; cards remain `sync_status='pending'`, reviews remain `synced_to_anki=0` / `sync_state='pending_anki'`.
- Missing/invalid field mapping: raises `AnkiError` or returns clear error message without corrupting local cards.
- Media upload failure: logs warning, continues note creation so core card is not lost.
- Deleted card in Anki: `get_cards_info` detects absence, resets `anki_card_id=None`, marks `sync_state="orphaned"` and review as synced so flush does not fail forever.

## Out of scope
- Managing Anki profile selection or starting the external Anki Desktop process.
- Direct manipulation of Anki's `.anki2` SQLite collection file (strictly communicates via AnkiConnect HTTP API).
- Altering fonts or animations defined in `final.md`.
