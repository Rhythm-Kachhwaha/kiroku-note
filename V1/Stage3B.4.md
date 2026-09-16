# Stage 3B.4 — Multi-Dictionary Presentation Polish & Anki Template Alignment

## Step 1 Implementation Report: Persist Structured Dictionary Entries

### Overview
During the Stage 3B.4 audit ([`V1/Stage3B.4-Design.md`](file:///d:/Python/AnkiMiner/V1/Stage3B.4-Design.md)), an essential persistence gap was identified: `SaveCardRequest` previously lacked an `entries` field, causing structured dictionary entries (`currentDictionaryEntries`) captured from Yomitan to be discarded upon saving to SQLite. Consequently, reopening a card from History could not repopulate the rich Study View (`renderDetails()`).

Step 1 implements the complete, end-to-end preservation of structured dictionary entries across the frontend and backend without modifying the SQLite schema.

---

### Data Flow
```
CaptureResponse.entries
        ↓
Side Panel currentDictionaryEntries
        ↓
SaveCardRequest.entries (list[dict[str, Any]])
        ↓
CardService.save_card()
        ↓
CardDraft.entries
        ↓
SQLite meanings_json (TEXT JSON)
        ↓
History card reopened (GET /api/cards/{id} -> openSavedCard)
        ↓
Study View renders original structured dictionary data (renderDetails({ entries }))
```

---

### Changes Implemented

#### 1. Backend Schema & Models
- [`backend/app/schemas.py`](file:///d:/Python/AnkiMiner/backend/app/schemas.py):
  - Added `entries: list[dict[str, Any]] = Field(default_factory=list)` to `SaveCardRequest`.
  - Added `entries: list[dict[str, Any]] = Field(default_factory=list)` to `SaveCardResponse`.

#### 2. Backend Service & Persistence
- [`backend/app/services/card_service.py`](file:///d:/Python/AnkiMiner/backend/app/services/card_service.py):
  - In `save_card()`, passed `entries=request.entries` to `CardDraft`.
- [`backend/app/repositories/card_repository.py`](file:///d:/Python/AnkiMiner/backend/app/repositories/card_repository.py):
  - Updated `save_or_update()` to persist `meanings_json` on card update.
  - Added defensive fallback: if `draft.entries` is empty during an update, existing `meanings_json` is preserved rather than overwritten with `[]`.

#### 3. Frontend Extension (Side Panel)
- [`extension/sidepanel/sidepanel.js`](file:///d:/Python/AnkiMiner/extension/sidepanel/sidepanel.js):
  - In `saveCard()` event handler, added `entries: Array.isArray(currentDictionaryEntries) ? currentDictionaryEntries : []` to `/api/cards/save` payload.
  - In `openSavedCard(cardId)`, calls `renderDetails({ entries: body.entries })` if entries exist, or `clearDictionaryView()` if none exist.

---

### Compatibility & Safety

1. **Zero Database Schema Changes**: Leverages the existing `meanings_json TEXT NOT NULL DEFAULT '[]'` column in SQLite.
2. **Backward Compatibility**:
   - Omitting `entries` defaults to `[]`.
   - Cards saved previously with `meanings_json = "[]"` deserialize safely without errors.
   - Legacy callers that update cards without sending `entries` preserve existing stored dictionary data.
3. **Strict Scope Control**:
   - Zero modifications to Yomitan parsing or AST normalization.
   - Zero modifications to AnkiConnect, Anki card HTML generation, or templates (deferred to Step 2).
   - Zero modifications to video playback, media capture, or styling tokens.

---

### Verification

#### 1. Backend Automated Tests
- [`backend/tests/test_card_entries_persistence.py`](file:///d:/Python/AnkiMiner/backend/tests/test_card_entries_persistence.py): 8 dedicated unit and integration tests covering:
  - `SaveCardRequest` default `entries` is `[]`.
  - `save_card()` persists provided entries to SQLite.
  - Card retrieved via repository and REST API retains exact structured dictionary entries.
  - Updating a card preserves existing entries when omitted.
  - Deserialization of empty or legacy `meanings_json`.
- [`backend/tests/test_card_editor.py`](file:///d:/Python/AnkiMiner/backend/tests/test_card_editor.py): Tests 15, 16, 17 integrated into core suite.
- **Result**: `python -m pytest` $\rightarrow$ **184/184 tests passed** (100%).

#### 2. Frontend Automated Tests
- [`extension/tests/save-card-entries.test.js`](file:///d:/Python/AnkiMiner/extension/tests/save-card-entries.test.js): Verifies payload formation and safe empty array handling.
- [`extension/tests/sidepanel.test.js`](file:///d:/Python/AnkiMiner/extension/tests/sidepanel.test.js): Verifies contract for `currentDictionaryEntries` in save payload and restoration in `openSavedCard`.
- [`extension/tests/dictionary-study-view.test.js`](file:///d:/Python/AnkiMiner/extension/tests/dictionary-study-view.test.js): Confirms `renderDetails` works flawlessly with restored entries.
- **Result**: `node --test extension/tests/*.test.js` $\rightarrow$ **27/27 test suites passed** (100%).

---

## Step 2 Implementation Report: Dedicated AnkiFormatter Service

### Overview
Step 2 implements [`backend/app/services/anki_formatter.py`](file:///d:/Python/AnkiMiner/backend/app/services/anki_formatter.py), establishing an isolated, secure, and learner-focused presentation boundary for converting Kiroku's domain and dictionary data into sanitized HTML for Anki cards.

Per the specification, **AnkiConnect integration is deliberately deferred to Step 3**. This step creates and thoroughly verifies the standalone formatting engine without altering existing Anki sync behavior.

---

### Formatter Responsibilities

1. **`escape_html(text)`**
   - Universal HTML-escaping filter (`html.escape(str(text), quote=True)`).
   - Guarantees that user notes, dictionary text, and linguistic metadata cannot inject arbitrary markup, execute scripts, or break out of HTML attributes.

2. **`format_ruby_html(text, reading)`**
   - Converts bracket furigana (e.g. `朝[あさ]御[ご]飯[はん]を食[た]べる。`) into standard `<ruby>` elements: `<ruby>朝<rt>あさ</rt></ruby><ruby>御<rt>ご</rt></ruby>...`.
   - Correctly handles kana prefixes (e.g. `お父[とう]さん` $\rightarrow$ `お<ruby>父<rt>とう</rt></ruby>さん`).
   - Safely parses and re-escapes pre-existing `<ruby>` tags while converting adjacent bracket furigana.

3. **`format_meaning_html(meaning_text, entries)`**
   - Single sense: formats into `<div class="kn-meaning">...</div>` without unnecessary `<ol>` wrappers.
   - Multiple senses: formats into structured `<ol class="kn-meanings"><li>...</li></ol>`.
   - Preserves sense-bound grammatical classifications: `<span class="kn-pos">[{pos}]</span>` (e.g. `[1-dan, vt]`).
   - Preserves sense-bound tags and domain markers: `<span class="kn-tag">[{tags}]</span>` (e.g. `[usually kana, math]`).
   - Preserves input dictionary ordering and never drops valid senses.
   - Fallback: converts plain-text multi-line strings (`1. foo\n2. bar`) into semantic `<ol>` lists with stripped manual numbering.

4. **`format_example_html(japanese, translation, reading, example)`**
   - Formats example sentences into `<div class="kn-example-block">`.
   - Embeds ruby furigana in `<p class="kn-example-ja">` when reading/bracket notation exists.
   - Embeds translation in `<p class="kn-example-en">` when supplied separately.
   - Omit either sub-element cleanly if data is absent; returns empty string if both absent.

5. **`sanitize_media_tags(image, audio)`**
   - Validates filenames against safe character regex (`^[a-zA-Z0-9_\-\.]+$`) and whitelisted extensions (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.bmp` for images; `.wav`, `.mp3`, `.ogg`, `.m4a`, `.aac`, `.flac` for audio).
   - Rejects/strips attribute breakouts (`photo.jpg" onerror="alert(1)`), raw scripts, and disallowed extensions.
   - Emits safe `<img src="{filename}" class="kn-image">` and `[sound:{filename}]`.

6. **`format_basic_back(card, ...)`**
   - Synthesizes the learner-focused Back field for Anki's Basic model:
     1. Reading with compact pitch accent badge: `<span class="kn-kana">たべる</span> <span class="kn-pitch">[② Nakadaka]</span>`
     2. Hairline divider: `<hr class="kn-divider">`
     3. Structured meanings list or single-sense definition
     4. Example sentence block with ruby furigana and translation
     5. User hints (`<div class="kn-hint">`) and notes (`<div class="kn-notes">`)
     6. Media strip (`<div class="kn-media">`)
   - Oromits frequency ranks, JLPT levels, and dictionary source names from the card face to maintain high review efficiency with zero visual clutter.

---

### Security & Escaping Behavior

- **Zero Unescaped Concatenation**: All dynamic dictionary strings and user inputs are passed through `escape_html`.
- **Malicious Payload Defense**:
  - `<script>alert(1)</script>` $\rightarrow$ `&lt;script&gt;alert(1)&lt;/script&gt;`
  - `<img src=x onerror=alert(1)>` in media or fields $\rightarrow$ rejected or escaped.
  - Bracket furigana with XSS `<script>[alert(1)]` $\rightarrow$ `<ruby>&lt;script&gt;<rt>alert(1)</rt></ruby>`.

---

### Automated Verification Results

- **New Formatter Unit Tests ([`backend/tests/test_anki_formatter.py`](file:///d:/Python/AnkiMiner/backend/tests/test_anki_formatter.py))**:
  - 13 focused tests covering single meaning, multiple meanings, sense-bound POS, sense-bound tags, HTML/XSS escaping, ruby furigana, pitch badges, examples + translations, Basic back generation, media sanitization, empty/missing fields, multi-dictionary ordering preservation, and 25-sense polysemous words.
  - Result: **13 / 13 passed** in 0.09s.
- **Full Backend Test Suite (`python -m pytest`)**:
  - **197 / 197 tests passed** (100% pass across all 20 test files).
  - Existing AnkiConnect tests (`backend/tests/test_anki_connect.py`) remain 100% green (30/30 passed).
- **Full Extension Test Suite (`node --test extension/tests/*.test.js`)**:
  - **27 / 27 test suites passed** (100% pass).

---

---

### Next Step
- **Stage 3B.4 Step 3**: Integrate `AnkiFormatter` into `AnkiConnectService.map_card_to_fields()` & `CardService.sync_card()`. (COMPLETED)

---

## Stage 3B.4 Step 3: AnkiConnect Field Mapping Integration — Implementation Report

### Overview & Delivered Behavior
In Step 3, `AnkiFormatter` was integrated into `AnkiConnectService.map_card_to_fields()` and `CardService.sync_card()` to deliver structured HTML formatting to Anki notes while preserving the existing note model keyword detection matrix and compatibility with custom community note models.

1. **CardService Data Handoff**:
   - `CardService.sync_card()` passes structured `entries: card.entries` and `examples: card.examples` into the `card_data` dictionary passed to `AnkiConnectService.add_note()` / `map_card_to_fields()`.
2. **AnkiConnect Field Mapping Integration**:
   - `AnkiConnectService.map_card_to_fields()` consumes:
     - `format_basic_back`: Generates structured, responsive `.kn-card` HTML for standard Basic models (`Front`/`Back`), including kana reading, divider, structured meanings (`kn-meanings`), ruby-annotated examples, hints, notes, media, and pitch accent badges.
     - `format_meaning_html`: Formats structured multi-dictionary entries or falls back to legacy text for `Meaning`, `Glossary`, `VocabDef`, etc.
     - `format_example_html`: Formats sentences with `<ruby>` annotations; cleanly avoids duplicating the English translation when a dedicated sentence translation field exists in the target model.
     - `format_pitch_badge`: Formats pitch badges for custom models with dedicated pitch fields (`Pitch`, `PitchAccent`, `VocabPitch`).
     - `sanitize_media_tags`: Cleans and bounds media elements (`<img>` and `[sound:...]`), preventing XSS and invalid paths while keeping custom model output clean without extra wrapper classes.
     - `escape_html`: Escapes untrusted text on all raw values (expression, reading, hint, notes, translation).
3. **Hard Safety Constraint Preserved**:
   - The Anki model keyword detection matrix, priority order, and fallback behavior were strictly preserved without redesign or reordering.
   - Dedicated media fields (`Image`/`Picture`, `Audio`/`Sound`) are respected, with image fallback to `Notes`/`Back` only when dedicated fields are missing.

### Test Verification
- **Pytest Suite (`python -m pytest`)**:
  - **212 / 212 tests passed** (100% pass across all 20 backend test files).
  - All 45 tests in `backend/tests/test_anki_connect.py` passed, including 15 comprehensive integration tests covering:
    - Basic model Front/Back mapping with structured entries
    - Polysemous multi-entry cards
    - Custom models (Yomitan Default, Kaishi 1.5k, Anime/Japanese Mining, Core 2000)
    - Dedicated pitch accent fields
    - Dedicated sentence translation fields (preventing translation duplication)
    - Media fallbacks vs. dedicated image/audio fields
    - Ruby furigana in sentence fields
    - XSS escaping and malicious tag filtering
    - Legacy card dictionary compatibility
- **Extension Node Test Suite (`node --test extension/tests/*.test.js`)**:
  - **27 / 27 test suites passed** (100% pass).
- **Live AnkiConnect Verification**:
  - End-to-end verification against running local Anki (`http://127.0.0.1:8765`) verified note creation, Front/Back formatting, ruby markup, and clean deletion.

---

## Stage 3B.4 Step 4: Final Regression, Verification & Documentation — Report

### 1. Verification Scope & Summary
Step 4 performed comprehensive end-to-end regression testing, security auditing, multi-model compatibility verification, and invariant validation across the whole Stage 3B.4 surface area.

### 2. Automated Test Results
- **Full Backend Pytest Suite (`python -m pytest`)**:
  - **212 / 212 tests passed** (100% pass across all 20 test files in 6.38s).
  - `backend/tests/test_anki_formatter.py`: **13 / 13 passed**
  - `backend/tests/test_anki_connect.py`: **45 / 45 passed**
  - `backend/tests/test_card_entries_persistence.py`: **8 / 8 passed**
- **Extension Node Test Suite (`node --test extension/tests/*.test.js`)**:
  - **27 / 27 test suites passed** (100% pass across all extension test files).

### 3. Model Compatibility Matrix Verification
Verified determinism, field targeting, and fallback logic across standard and community Anki models without altering the keyword detection matrix:
- **Basic (`Front` / `Back`)**: Front gets `expression [reading]`; Back gets structured `.kn-card` HTML with kana reading, divider, `.kn-meanings` multi-sense list, `.kn-example-block` with ruby annotations, pitch badges, notes, and media.
- **Yomitan Default (`Expression`, `Reading`, `Glossary`, `Sentence`, `Audio`)**: Structured meaning in `Glossary`, ruby in `Sentence`, `[sound:...]` in `Audio`.
- **Anime / Japanese Mining (`VocabKanji`, `VocabFurigana`, `VocabDef`, `Sentence`, `SentenceAudio`, `SentenceImage`)**: Structured definition in `VocabDef`, clean `<img src="...">` in `SentenceImage`, `[sound:...]` in `SentenceAudio`.
- **Core 2000 (`Word`, `Kana`, `Meaning`, `Sentence-Expression`, `Sentence-English`)**: Word/Kana split, structured meaning, ruby sentence, dedicated English translation field without duplication.
- **Kaishi / Kaishi 1.5k (`Word`, `Reading`, `Meaning`, `Example Sentence`, `Example Sentence Meaning`)**: Dedicated example translation respected without duplicate translation text in example sentence.

### 4. Structured Dictionary & Polysemy Verification
- Tested with polysemous terms (e.g. `掛ける` with 50 senses across 6 dictionary entries, `食べる` with 5 entries).
- Verified senses ordering, sense-bound parts-of-speech, and sense-bound tags are preserved without dropping entries.
- Verified saving to SQLite and reopening from library/history restores all structured dictionary entries and senses intact.
- Verified legacy cards with empty/legacy `entries` continue to format gracefully into standard numbered lists.

### 5. Security & XSS Injection Defenses
- Verified that all dynamic values (expression, reading, meaning, hint, notes, translation, ruby furigana) pass through `escape_html`.
- Tested `<script>alert('xss')</script>`, `<img src=x onerror=...>`, attribute escaping, path traversal in media filenames (`../../etc/passwd`), and bracket ruby injection attacks (`漢字[<script>alert(1)</script>]`). All malicious tags were neutralized and rendered as escaped text or sanitized.

### 6. Media Behavior & Invariants
- Verified dedicated `Image`/`Picture` and `Audio`/`Sound` fields receive clean, unclassed tags (`<img src="...">` and `[sound:...]`).
- Verified image fallback appends to `Notes`/`Back` when dedicated image fields are absent.
- Verified safety invariant: audio is strictly excluded from `Notes` fallback to avoid stuffing raw sound tags into text fields.

### 7. Live AnkiConnect Verification
- Verified against active local AnkiConnect (`http://127.0.0.1:8765`) and live Yomitan (`http://127.0.0.1:19633`):
  - Capture `食べる` / `走る` $\rightarrow$ Save to SQLite $\rightarrow$ Restore $\rightarrow$ Sync to Anki $\rightarrow$ Verify note fields $\rightarrow$ Clean up temporary note.
  - All operations succeeded with 0 errors.

### 8. Stage 3B.4 Status
- **Stage 3B.4 is COMPLETE**:
  - Step 1: Structured Dictionary Persistence — Complete
  - Step 2: AnkiFormatter Service — Complete
  - Step 3: AnkiConnect Integration — Complete
  - Step 4: Final Regression, Verification & Documentation — Complete


