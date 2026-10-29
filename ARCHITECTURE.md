# Kiroku Note Architecture

## System overview

Kiroku Note is a local-first vocabulary mining pipeline. A Chromium/Brave extension captures Japanese text and presents the resulting card in its Side Panel. A local FastAPI backend identifies and enriches the term, persists the card in SQLite, and synchronizes it to Anki through AnkiConnect. SQLite remains authoritative if external local services are unavailable.

## Components and responsibilities

| Component | Responsibilities | Must not own |
| --- | --- | --- |
| Extension content script | Page interaction, hover/selection capture, and page lifecycle handling | Dictionary logic, persistence, Anki calls |
| Extension Side Panel | Card display/editing, keyboard-first interaction, extension-to-backend requests | JLPT rules, direct Yomitan or AnkiConnect calls |
| FastAPI routes | Validate requests and expose stable local API contracts | Provider-specific request shaping |
| Backend services | Identification, enrichment orchestration, persistence and sync coordination | UI behavior |
| `YomitanService` | Endpoint configuration, Yomitan requests, and normalized results | UI or card persistence policy |
| JLPT service | Resolve N5/N4/N3/N2/N1/Unknown from a replaceable local dataset | UI display rules |
| SQLite | Cards, lifecycle/sync state, duplicate identity, and local history | External synchronization |
| AnkiConnect service | Deck/note operations, external duplicate checks, and sync result translation | Source-of-truth storage |
| `OcrService` | OCR daemon discovery, request proxying, status reporting, and response normalization | Model loading or raw vendor engine logic |

## Side Panel and extension boundary

The Side Panel is the only extension UI and is approximately 400–600px wide. It uses vanilla HTML/CSS/JavaScript and follows `DESIGN.md` as the visual foundation: restrained warm/coral accents, typography/spacing discipline, modest radii, and low-chrome utility surfaces. The product requirement for a dark, developer-tool Side Panel takes precedence over `DESIGN.md`'s marketing-page cream default; do not copy its marketing layouts into the panel.

The content script observes user-initiated mining behavior, captures relevant page text, and passes capture data through extension message passing. The Side Panel owns focus and editing interactions: Ctrl/Cmd+Enter adds a card, Ctrl/Cmd+K focuses the word, Ctrl/Cmd+Shift+M focuses meaning, and Esc closes optional fields. Exact shortcuts may be revised only when implementation demonstrates a better interaction.

## Capture and backend flow

1. The user opens Miner Side Panel and activates mining mode via the extension shortcut.
2. The content script detects selected or hovered Japanese subtitle/text and sends capture context to the Side Panel.
3. The Side Panel calls a local FastAPI capture/identification endpoint.
4. The backend delegates Japanese identification to `YomitanService`.
5. The backend normalizes expression, reading, meaning, and other available enrichment, then asks the JLPT service for a level.
6. The API returns a provider-neutral card draft to the Side Panel for editing.

The extension/backend API is local and versioned by explicit request/response schemas. It exchanges application concepts (capture text/context and card drafts), not raw Yomitan or AnkiConnect payloads. Routes validate input and return actionable local-service failures without exposing provider details unnecessarily.

## Data, lifecycle, and duplicate prevention
The backend owns card lifecycle transitions. The frontend may request an action, but it must not decide whether a card is persisted, pending, synced, or failed.

Card fields include front/expression and meaning, plus optional reading, hint, example sentence, translation, image, audio, tags, notes, and justified mining fields. The card lifecycle is:

`capture -> enrich -> save to SQLite -> sync to Anki`

Persist the card before attempting Anki synchronization. If AnkiConnect is unavailable or rejects an operation, retain the card locally and mark it pending or failed for later sync.

Duplicate prevention is first-class. The proposed per-deck identity is normalized expression + reading + deck. Before creating a note, check SQLite and, when necessary, AnkiConnect so a reset local database does not create a duplicate note in Anki. Identity normalization, checks, and race-safe persistence belong in backend/database services, not the UI.

## External service boundaries

### Dictionary (`YomitanService`, `DictionaryProvider` & `kiroku_dictionary`)

Dictionary access is encapsulated behind `YomitanService` and the `DictionaryProvider` abstraction boundary (`backend/app/services/dictionary_provider.py`):
1. **`YomitanHttpProvider`** (default): Connects to the local Yomitan HTTP daemon on port `19633` (`http://127.0.0.1:19633`).
2. **`LocalDictionaryProvider`**: Pluggable local dictionary provider backed by `kiroku_dictionary`, a zero-daemon standalone SQLite engine.
3. **`DICTIONARY_BACKEND` configuration**:
   - `yomitan` (default): Preserves existing Yomitan HTTP behavior byte-for-byte.
   - `local`: Direct lookup through `kiroku_dict.sqlite`.
   - `auto`: Attempts Yomitan HTTP first, gracefully falling back to the local dictionary engine when Yomitan is unavailable.

`kiroku_dictionary/` is a top-level, standalone Python package strictly decoupled from `backend/app` with zero third-party dependencies (Python standard library only: `sqlite3`, `json`, `zipfile`, `re`, `unicodedata`, `dataclasses`, `zlib`, `threading`):
- **Cleanroom Implementation**: Built under MIT license with no GPL-3.0 code from Yomitan.
- **SQLite Storage**: Stores Jitendex (terms) and KANJIDIC (kanji) with zlib level-6 compressed verbatim AST blobs and minimal B-tree indexes (`term`, `reading`, `norm_reading`), operating in read-only WAL mode.
- **Morphological Deinflector**: Table-driven deinflector handling godan verbs across all rows, ichidan verbs, suru/kuru irregulars, adjectives (`adj-i`), te/ta forms, polite forms, causative, passive, potential, volitional, imperative, conditional, and colloquial contractions (`ちゃう`, `てる`, `とく`).
- **Payload Adapter**: Formats internal entries into verbatim Yomitan AST payload structures so that `normalize_term_entries_response` and `normalize_kanji_entries_response` remain the single source of truth for AST parsing without modification.
- **Cloud Readiness**: Directly importable in cloud container environments (such as Render or cloud web workers) without requiring a browser extension or GUI daemon.

### JLPT

JLPT resolution comes from a local replaceable vocabulary-level dataset/service and returns N5, N4, N3, N2, N1, or Unknown. It is independent of Yomitan and never hardcoded in the frontend.

### AnkiConnect

AnkiConnect's default endpoint is `http://127.0.0.1:8765` (configurable via `ANKICONNECT_URL`). `AnkiConnectService` is the sole integration boundary and encapsulates all JSON-RPC transport using Python standard library `urllib`.

The card synchronization flow enforces:
1. **SQLite-first persistence**: Cards must be saved in SQLite before any AnkiConnect operation. An AnkiConnect outage, error, or rejection leaves the local card intact with `sync_status = 'failed'`.
2. **Explicit user trigger**: Saving a card does not automatically push to Anki; the user explicitly triggers synchronization via the "Send to Anki" action.
3. **Sync lifecycle state machine**:
   - `pending`: Local card saved, not yet synchronized.
   - `syncing`: In-flight synchronization request.
   - `synced`: Successfully created in Anki or linked to an existing matching note, with `anki_note_id` and `synced_at` populated.
   - `failed`: AnkiConnect returned an error, timed out, or connection was refused, with `sync_error` diagnostic saved. Recoverable via retry.
4. **Duplicate detection across resets**: Before creating a note, `AnkiConnectService` queries candidates with `findNotes` and inspects actual fields with `notesInfo`. Matching normalized expression and reading in the target deck links the existing `anki_note_id` without creating a duplicate.
### OCR (`OcrService` & `OcrProcessManager`)

The standalone OCR daemon's default endpoint is `http://127.0.0.1:21829` (configurable via `KIROKU_OCR_URL` or `KIROKU_OCR_PORT`). `OcrService` is the sole integration boundary in the core backend. It handles health checking, availability detection, image byte forwarding, and response normalization. `OcrProcessManager` handles discovery of the optional `KirokuOCR.exe` binary, non-blocking startup with bounded timeout, failure cooldowns to prevent restart loops, and graceful cleanup on backend shutdown.

The browser extension talks exclusively to Kiroku's port `21828` (`/api/ocr/status`, `/api/ocr/recognize`) and never directly to port `21829`. Heavy machine-learning dependencies (`manga-ocr`, `torch` CPU, `transformers`) reside strictly inside the standalone OCR companion package (`packaging/kiroku_ocr.spec`, `installer/kiroku_ocr_setup.iss`) and are loaded lazily on CPU only. If the OCR addon is absent or stopped, the core application functions completely normally.

### Windows distribution (`run_tray.py`)

The Windows distribution launches the existing FastAPI application inside a small `pystray` host. The tray owns process lifecycle actions (start, restart, quit), loopback service status labels, and the optional per-user `HKCU` startup entry. It does not move backend, OCR, dictionary, Anki, or persistence responsibilities into the desktop shell. PyInstaller produces an onedir `KirokuNote` payload; the optional OCR payload remains separate.

## Architectural decisions

### ADR-001: Chromium extension + Side Panel is the application shell

The extension keeps mining next to the page and makes Side Panel the single application UI. Content scripts handle page interaction; the panel handles card work.

### ADR-002: SQLite is the local source of truth and cards are persisted before Anki synchronization

Local persistence protects cards from AnkiConnect outages and enables pending sync.

### ADR-003: Prevent duplicate vocabulary cards per deck using normalized expression + reading + deck

Both local and, when needed, Anki checks protect against duplicate notes across local database resets.

### ADR-004: Isolate Yomitan behind a service boundary

Dictionary/API changes must not leak beyond `YomitanService`.

### ADR-005: Use vanilla HTML/CSS/JavaScript for the frontend

React and Electron are intentionally excluded to keep the extension small and aligned with its browser-native shell.

### ADR-006: OCR is strictly an input source to the canonical capture pipeline

OCR captures visible page screenshots, crops user-selected regions with High-DPI coordinate scaling, and requests recognition via the core backend (`/api/ocr/recognize`). The recognized Japanese text feeds directly into the standard `identify(text)` pipeline (`POST /api/capture`). No duplicate card editors, custom Yomitan paths, or separate OCR databases exist.

### ADR-007: OCR is an isolated, optional companion process with managed lifecycle

The core Kiroku Note distribution (~50 MB) does not bundle PyTorch or manga-ocr. The OCR component is distributed as an optional standalone add-on (`KirokuOCR.exe`). `GET /api/ocr/status` is strictly observational. `POST /api/ocr/recognize` performs a single bounded startup attempt if the add-on is installed but offline, guarded by failure cooldowns.

### Subtitle Acquisition (`SubtitleProvider` & `SubtitleParser`)

Subtitle acquisition is an input source providing Japanese cue streams into the unified mining pipeline. `SubtitleProvider` offers a provider-agnostic interface (`getTracks()`, `loadTrack(id)`) across:
- `LocalFileSubtitleProvider`: User-dropped `.srt`, `.vtt`, `.ass`, `.ssa` files.
- `YouTubeSubtitleProvider`: Native and auto-generated Japanese caption tracks extracted via player response metadata.
- `NetflixSubtitleProvider`: Intercepted live `timedtext` streams from Netflix web players.
- `JimakuSubtitleProvider`: Search and direct download of community anime subtitle tracks via Jimaku API (`https://jimaku.cc/api/*`).

`SubtitleParser` normalizes diverse subtitle formats into standard `Cue` objects (`startMs`, `endMs`, `text`, `rawText`), stripping format-specific tags (`{\pos}`, `{\fad}`, `<v Speaker>`, etc.), speaker prefixes (`山田:`, `CHARACTER：`), and duplicate cues. Subtitle text interactions in the video overlay or Side Panel directly invoke `POST /api/capture` to feed the standard card draft and enrichment flow.

### Subtitle Annotation & Active Subtitle Word Status Highlighting

The Subtitle Annotation subsystem provides real-time vocabulary tokenization and learner status classification across subtitle cues, synchronizing between the FastAPI backend, the Side Panel, and the live video overlay.

1. **`SubtitleAnnotatorService` (`backend/app/services/subtitle_annotator.py`)**:
   - Backend service encapsulating dictionary-backed tokenization (`kiroku_dictionary.deinflect`), JLPT level classification, and status determination.
   - Caches known vocabulary in memory (`mined_words` from `cards` and user-marked words from `known_words`).
   - Token status hierarchy:
     - `mined`: The word (lemma or surface) matches an existing card in SQLite.
     - `should-know` (or `should_know`): The word is at or below the user's target JLPT level (default N5) and is neither mined nor marked known.
     - `unstyled`: The word is above the learner's JLPT level, already marked known, a function word, or unclassified.

2. **Endpoints & Database Schema**:
   - `POST /api/subtitle/annotate`: Batch tokenizes and annotates subtitle cues, returning token boundaries (`start`, `end`), surface, lemma, reading, normalized status, and JLPT level.
   - `GET /api/known-words`: Retrieves mined and marked known words with deterministic SHA-256 ETag HTTP 304 caching.
   - `POST /api/known-words/mark`: Inserts a Japanese word into the SQLite `known_words` table (`word TEXT PRIMARY KEY, created_at TEXT`) and updates in-memory annotator cache.
   - `DELETE /api/known-words/mark/{word}`: Deletes a word from `known_words` and updates the annotator cache.

3. **3-State Highlighting & Yomitan Preservation**:
   - Subtitle cues rendered in the Side Panel active preview (`#video-current-cue-preview`) and the live video overlay (`#ankiminer-subtitle-overlay`) use lightweight inline `<span>` elements:
     - `.sub-token.mined` / `.video-sub-token.mined`: Accent warm amber `#d4884f` with subtle 1px dashed/dotted underline.
     - `.sub-token.should-know` / `.video-sub-token.should-know`: Soft green `#5db872` with subtle 1px underline.
     - `.sub-token.unstyled` / `.video-sub-token.unstyled`: Inherits clean subtitle color without decoration.
   - Spans are strictly `display: inline` with transparent backgrounds, 0 margins, and 0 padding to preserve 100% of Yomitan character range detection and hover auto-pause.
   - Unannotated cues gracefully fall back to plain text rendering.

4. **Video Tab Declutter, Auto-Collapsing Card Workspace & Grammar Slot**:
   - **Auto-Collapsing Card Workspace**: Controlled by `video_workspace_collapse_mode` (`auto_collapse` [default], `keep_open`, `dont_show`). On the Video tab, after card creation/saving or 5 seconds of inactivity or active subtitle cue change, `#card-editor-section` collapses to a 1-line chip (`#video-collapsed-card-chip`) showing expression, reading, and save status. A focus guard prevents collapse during active editing. Text and Quick Add tabs are strictly isolated and never collapse.
   - **Reserved `#active-sub-grammar-slot`**: Positioned directly below the active subtitle preview container, providing an accessible container for upcoming grammar point explanations without disrupting token layout.
   - **Missed Should-Know Words Drawer (`#video-missed-words-drawer`)**: A collapsible drawer aggregated as cues play. Collects deduplicated `should-know` tokens from recent cues (excluding mined and known words). Provides a count badge (`#video-missed-words-badge`), a `[Mine]` action triggering standard card identification, and a `[Mark Known]` action persisting to `POST /api/known-words/mark` and decrementing the badge.

## Architectural decisions

### ADR-001: Chromium extension + Side Panel is the application shell

The extension keeps mining next to the page and makes Side Panel the single application UI. Content scripts handle page interaction; the panel handles card work.

### ADR-002: SQLite is the local source of truth and cards are persisted before Anki synchronization

Local persistence protects cards from AnkiConnect outages and enables pending sync.

### ADR-003: Prevent duplicate vocabulary cards per deck using normalized expression + reading + deck

Both local and, when needed, Anki checks protect against duplicate notes across local database resets.

### ADR-004: Isolate Yomitan behind a service boundary

Dictionary/API changes must not leak beyond `YomitanService`.

### ADR-005: Use vanilla HTML/CSS/JavaScript for the frontend

React and Electron are intentionally excluded to keep the extension small and aligned with its browser-native shell.

### ADR-006: OCR is strictly an input source to the canonical capture pipeline

OCR captures visible page screenshots, crops user-selected regions with High-DPI coordinate scaling, and requests recognition via the core backend (`/api/ocr/recognize`). The recognized Japanese text feeds directly into the standard `identify(text)` pipeline (`POST /api/capture`). No duplicate card editors, custom Yomitan paths, or separate OCR databases exist.

### ADR-007: OCR is an isolated, optional companion process with managed lifecycle

The core Kiroku Note distribution (~50 MB) does not bundle PyTorch or manga-ocr. The OCR component is distributed as an optional standalone add-on (`KirokuOCR.exe`). `GET /api/ocr/status` is strictly observational. `POST /api/ocr/recognize` performs a single bounded startup attempt if the add-on is installed but offline, guarded by failure cooldowns.

### ADR-008: Subtitle acquisition is an input source to the canonical capture pipeline

Subtitle tracks from all sources (local files, YouTube CC, Netflix timedtext, Jimaku API) are parsed and normalized into standard cue streams. Hovering or clicking Japanese words in subtitle cues invokes the exact same `POST /api/capture` endpoint as text selection and OCR. No separate subtitle databases, custom card editors, or alternate enrichment paths exist. External subtitle search API keys (Jimaku) are stored strictly locally in `chrome.storage.local` with SSRF-safe background proxying.

## Anki Card Mirror & Cloud Queue Subsystem

The cloud queue repository (`kiroku_cloud_queue/`) provides mobile-to-desktop capture and serves as a mobile-friendly companion dashboard (`/dashboard`) deployed on FastAPI/PostgreSQL (Neon) or SQLite:

```
[Anki Desktop (127.0.0.1:8765)]
       │ AnkiConnect (read-only, non-blocking via asyncio.to_thread)
       ▼
[anki_mirror.py (inside worker.py / backend poll)] ──(POST /api/jlpt/batch)──> [Kiroku Backend :21828]
       │
       │ HTTPS / Worker Bearer Token (batches of 500 cards, 1000 daily rows)
       ▼
[Cloud Service (FastAPI / Render)]
       │
       ▼
[Cloud Database (Neon Postgres / SQLite)]
 (tables: anki_cards, anki_daily, anki_meta, cloud_study_state, cloud_study_reviews)
       │
       ▼
[Web Dashboard (Phone / Desktop)]
 (Tabs: Queue, Cards, Rich Stats Inline SVGs, Leitner Extra Practice)
```

### ADR-009: One-way Read-Only Anki Card Mirror & Revlog Semantics

The card mirror is strictly one-way and read-only: Anki Desktop to the cloud database. The cloud service never modifies, reschedules, or writes cards back to Anki Desktop.

1. **Storage Parity**: Mirrors card fields into `anki_cards` and daily historical metrics into `anki_daily` across both SQLite and PostgreSQL schemas identically. Raw Anki review logs remain on the user's PC to preserve Neon free-tier storage; only aggregated daily counts and card rows are transmitted. Each card stores clean primary text (definition, reading, example sentence) alongside sanitized `raw_html` (preserving ruby furigana, pitch accent patterns, and structured sections) and `has_media` indicator.
2. **Revlog Semantics**:
   - `ivl < 0`: Represents learning steps in seconds (not mature); treated as non-mature learning cards.
   - `type`: Retention mathematics strictly enforce `type == 1` (standard reviews). Types 3 (filtered/cram) and 4 (manual reschedule) are excluded from retention calculations.
   - **Day Rollover**: Defaults to 4:00 AM local time (`ANKI_DAY_ROLLOVER_HOUR = 4`), configurable via environment variable.
   - **Imported Card IDs**: Card IDs correspond to millisecond creation timestamps. Shared/imported decks retain original epoch IDs, so historical growth curves for imported decks represent card creation rather than import dates.
3. **FSRS-Aware Difficulty Scoring**:
   - Ease factors are ignored because the user operates under FSRS.
   - 0-100 score formula combines:
     - Lapse pressure: `min(1.0, lapses / 6.0) * 0.40`
     - Recent again rate: exponential recency decay weighting over the last 10 reviews (`* 0.35`)
     - Answer time pressure: `min(1.0, avg_time_ms / 15000.0) * 0.10`
     - Low interval pressure: `(1.0 - min(1.0, interval_days / 90.0)) * 0.15`
     - Real FSRS blend: if `cardsInfo` returns native FSRS difficulty (0..1), blends 50% FSRS score with 50% heuristic score.
   - Difficulty labels: `leech` (`is_leech=True` only, via `tag:leech` or `lapses >= 8`), `hard` (score >= 60.0 without the leech flag), `normal` (30.0..59.9), `easy` (10.0..29.9), `solid` (<10.0 and interval >= 21), and `new` (`reps == 0`).
4. **Read-Only Whitelist Guarantee**:
   - `AnkiClient` enforces an immutable whitelist of approved read actions (`version`, `deckNames`, `findCards`, `cardsInfo`, `cardsModTime`, `getReviewsOfCards`, `cardReviews`, `getLatestReviewID`, `getNumCardsReviewedByDay`, `getNumCardsReviewedToday`, `getDeckStats`, `getActiveProfile`, `retrieveMediaFile`).
   - Any other action name raises `PermissionError` immediately before network dispatch, guaranteeing the mirror cannot modify the user's Anki collection.
5. **Reconcile Safety & Profile Guards**:
   - Reconcile never proceeds if Anki returns 0 cards (preventing accidental total wiping of the cloud database).
   - If the returned card count is less than 50% of the previous mirrored count (recorded in `anki_meta`), the deletion step is skipped, a warning is logged, and `reconcile_skipped_reason` is set in status, unless deliberately overridden via `--allow-shrink`.
   - If `getActiveProfile` indicates an Anki profile change compared to saved metadata, synchronization is safely skipped to prevent cross-profile contamination.
6. **Compressed WebP Media Pipeline & Storage Protection**:
   - Note fields referencing local images (`<img src="...">`) trigger retrieval via `retrieveMediaFile`.
   - Client-side compression via `Pillow`: RGBA/RGB normalization, downscale to max 800px on the longest dimension, and encoding to WebP at quality 75 (~15-30KB per image).
   - Compressed blobs are stored in an isolated `anki_card_media` table, keeping the primary `anki_cards` table fast and index-friendly.
   - Storage protection: `POST /api/anki/media/flush?min_interval_days=21` and CLI flag `--flush-mature-media` prune images for mature cards (`interval_days >= 21`) while preserving vocabulary card text.

### ADR-010: Leitner 5-box Cloud Extra Practice Mode

Cloud study mode provides a separate "extra practice" study environment over mirrored vocabulary cards.

1. **Isolation from Anki Scheduling**: Practice results in the cloud are persisted in `cloud_study_state` and `cloud_study_reviews` and never modify Anki card intervals, ease factors, or review history.
2. **Leitner 5-Box Intervals**:
   - Box 1: 10 minutes (re-queued in the active session after 3-5 cards)
   - Box 2: 1 day
   - Box 3: 3 days
   - Box 4: 7 days
   - Box 5: 14 days
3. **Rating Transitions**:
   - 1 (Again): Drop to Box 1, streak resets to 0.
   - 2 (Hard): Retains current box, re-shown in same session.
   - 3 (Good): Advances +1 box (max 5), streak += 1.
   - 4 (Easy): Advances +2 boxes (max 5), streak += 1.
4. **Dedicated Cloud Analytics**:
   - Real-time performance tracking via `GET /api/study/summary` exposing total reviews, reviews today, accuracy percentage, consecutive daily practice streak, and live Leitner box counts.
5. **Offline Resilience & Idempotency**: Mobile client generates `review_uuid` per rating tap, allowing duplicate POST retries without inflating review counts or corrupting intervals.
6. **Speech Synthesis**: Japanese audio pronunciation relies exclusively on native browser `speechSynthesis` (`ja-JP` voice) without hosting or transmitting audio media.





### Grammar cards and learning tracking

Grammar cards use the `cards.card_kind` discriminator (default `vocab`) and preserve the existing local-first save/sync boundary. Grammar-specific Anki formatting is isolated in `anki_formatter.py`; the AnkiConnect mapper selects it only for `card_kind=grammar`. Grammar learning state is local SQLite state in `grammar_points` and explicit user-engagement examples in `grammar_encounters`, exposed through `/api/grammar/points`, `/api/grammar/points/{pattern_key}`, and encounter endpoints.
