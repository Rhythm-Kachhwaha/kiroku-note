# Contract: db
Depends-on: none

## Purpose
Local single-user SQLite database initialization, connection lifecycle, schema migrations, and transaction management for Kiroku Note.

## Boundaries
- `get_db_connection(db_path: Path | str | None = None) -> sqlite3.Connection`: Creates and configures a SQLite connection with WAL journal mode, foreign key enforcement, row factory (`sqlite3.Row`), busy timeout (10000ms), and normal synchronous mode.
- `db_session(db_path: Path | str | None = None) -> Iterator[sqlite3.Connection]`: Context manager yielding a managed connection; automatically rolls back on exception, commits on clean exit, and ensures connection is closed.
- `init_db(db_path: Path | str | None = None) -> None`: Idempotently initializes core schema, runs incremental column migrations, backfills JLPT levels, recovers interrupted sync states ('syncing' -> 'pending'), and ensures auxiliary tables.
- `ensure_*_table(conn: sqlite3.Connection) -> None`: Auxiliary idempotency helpers ensuring specialized tables exist (`user_kanji_compounds`, review tables, cloud sync tables, word states, encounters, vocab practice, study modes).
- `record_unresolved_token(...) -> int | None`, `record_unresolved_tokens(...) -> int`, `list_unresolved_tokens(...) -> list[dict]`: Helper functions for persistence and retrieval of out-of-vocabulary tokens.

## State and storage
- Persistent file storage: SQLite database file resolved via `get_db_path()` (typically `%LOCALAPPDATA%/KirokuNote/data/kiroku.db` or `backend/data/kiroku.db`, overridden by `KIROKU_DB_PATH` / `ANKIMINER_DB_PATH`).
- WAL journal files: `<db_path>-wal` and `<db_path>-shm`.
- Core tables: `cards`, `known_words`, `grammar_cache`, `grammar_points`, `grammar_encounters`, `grammar_drill_results`, `unresolved_tokens`, `word_states`, `word_encounters`, `word_categories`, `vocab_practice_results`, `word_sets`, `word_set_items`, `study_burst_sessions`, `study_burst_attempts`, `user_kanji_compounds`, `card_fsrs`, `review_logs`, `deck_settings`, `card_cloud_sync`, `deleted_cards`, `cloud_sync_meta`.

## Dependencies
- Standard library: `sqlite3`, `pathlib`, `contextlib`, `datetime`, `json`.
- `app.config.get_db_path`: Resolves target DB filepath from platform defaults or env vars.
- `app.services.jlpt_reference.JlptReferenceService` (optional): Used during `backfill_cards_jlpt_level`.

## Invariants
- Foreign keys MUST always be enabled (`PRAGMA foreign_keys = ON;`).
- All disk-backed database connections MUST use WAL journal mode (`PRAGMA journal_mode = WAL;`) and `synchronous = NORMAL` with `busy_timeout = 10000`.
- All query rows MUST be returned as dictionary-accessible rows (`conn.row_factory = sqlite3.Row`).
- `init_db()` MUST be strictly idempotent: executing multiple times on empty or populated databases produces identical schema state without errors, duplicates, or data loss.
- Transaction failures inside `db_session` MUST automatically roll back, preventing any partial writes.
- Composite uniqueness constraints (e.g., `(normalized_expression, normalized_reading, normalized_deck_name)` on `cards`, `(sequence_id, category, subtype)` on `word_categories`) MUST be strictly enforced.
- Cascading deletes (`ON DELETE CASCADE`) MUST automatically remove dependent child rows when parent rows are deleted.
- Non-ASCII Japanese text, Unicode characters, emojis, null bytes in strings, and empty strings MUST round-trip without corruption.
- Concurrent read/write connections MUST operate safely under WAL mode without deadlocking or database corruption.

## Failure behavior
- Corrupted or unreadable database files raise a descriptive `RuntimeError` stating connection failure and potential corruption.
- Transaction errors inside `db_session` trigger rollback before re-raising the original exception; connections are closed in `finally`.
- Unfinished sync operations stuck in `'syncing'` are automatically recovered to `'pending'` on `init_db()`.
- Missing parent directories are created automatically on connection initialization.

## Out of scope
- Multi-tenant user data isolation (local database is strictly single-user per application profile).
- Remote network synchronization and cloud authentication (handled by cloud queue and sync services).
- Study question bank database (`study.db` is maintained as a separate isolated database under `app.study.connection`).
