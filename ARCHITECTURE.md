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

### Yomitan

Yomitan's default endpoint is `http://127.0.0.1:19633`. `YomitanService` is the sole integration boundary. Tokenization and dictionary lookup are separate operations; normalize both request and response forms before returning application data. Unavailability and malformed/unsupported responses must degrade gracefully. No other layer may depend on Yomitan-specific endpoints or payload shapes.

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


