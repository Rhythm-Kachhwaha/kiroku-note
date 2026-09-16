# Kiroku Note — V1.0 Stage 3B.4 Audit & Technical Design Specification
## Multi-Dictionary Presentation Polish & Anki Template Alignment

**Document Path:** `V1/Stage3B.4-Design.md`  
**Execution Type:** Audit & Technical Design Only (Zero Source Code Changes)  
**Date:** 2026-09-16  
**Status:** Audit Complete / Ready for Review  

---

## 1. Executive Summary & Audit Scope

### 1.1 Purpose of Stage 3B.4 Audit
Following the completion of:
- **Stage 3A:** Dictionary architecture research & AST technical design (`V1/Stage3A.md`)
- **Stage 3B.1:** Backend AST normalizer & provider-neutral domain models (`V1/Stage3B1.md`)
- **Stage 3B.2.1:** CardService multi-sense draft synthesis (`synthesize_default_meaning`, `synthesize_default_example`)
- **Stage 3B.3.1a & 3B.3.1b:** Structured Dictionary Study View Renderer & Quick-Insert actions
- **Stage 3B.3.2 & Stage 4:** Side Panel Precision Dark Utility visual design system overhaul

The dictionary ingestion and frontend presentation systems are functional, verified, and visually polished in the Chromium Side Panel.

However, the transition of enriched linguistic data from the **Card Draft / SQLite persistence** layer into **AnkiConnect note fields and rendered Anki cards** remains unaligned:
1. `synthesize_default_meaning` produces plain-text multi-line strings (`1. foo\n2. bar`) that lose their line structure in Anki because Anki fields render as HTML and collapse raw newlines into spaces.
2. The Anki note field mapper uses an ad-hoc, unescaped `<br><br>` joining strategy for Basic cards and dumps raw strings into custom Japanese note models.
3. Valuable sense-bound linguistic metadata (such as transitive/intransitive classifications, parts of speech, and ruby furigana) present in the Side Panel Study View completely vanishes when cards are exported to Anki.
4. User input and dictionary strings are interpolated into Anki fields without HTML entity escaping, creating markup distortion and security risks.
5. In the card editor workflow, newly saved cards do not persist the structured `entries` payload to SQLite because `SaveCardRequest` omits the field.

This document provides a complete audit of the dictionary-to-Anki pipeline, establishes clear boundaries, evaluates product decisions regarding metadata density, and defines a safe, incremental implementation sequence.

---

## 2. Current Anki / Card Pipeline Trace

The complete lifecycle of dictionary information from capture to rendered Anki card is traced below:

```
[ Japanese Webpage Text Selection / Video Subtitle Cue ]
                        │
                        ▼ (chrome.runtime message: JAPANESE_TEXT_CAPTURED)
[ extension/sidepanel/sidepanel.js ]
                        │
                        ▼ (POST /api/capture {"text": "...", "deck_name": "Default"})
[ backend/app/main.py -> CardService.capture_term() ]
                        │
                        ├──> [ YomitanService.identify() -> POST /tokenize (127.0.0.1:19633) ]
                        │     Returns: IdentifiedTerm(expression, reading, source_text, deinflected_text)
                        │
                        ├──> [ YomitanService.enrich() -> POST /termEntries (127.0.0.1:19633) ]
                        │     Returns: EnrichedTerm(expression, reading, entries: list[DictionaryEntry])
                        │
                        ├──> [ CardService.synthesize_default_meaning(entries) ]
                        │     Selects primary dictionary entry; produces plain-text string:
                        │     - Single-sense: "movie, film"
                        │     - Multi-sense:  "1. to eat\n2. to live on"
                        │
                        ├──> [ CardService.synthesize_default_example(entries) ]
                        │     Extracts first available example sentence and translation.
                        │
                        └──> [ CardRepository.find_by_identity(expression, reading, deck_name) ]
                              Checks SQLite duplicate collision via NFC-normalized tuple.
                        │
                        ▼ (HTTP 200: CaptureResponse JSON)
[ extension/sidepanel/sidepanel.js: renderDetails(body) ]
  - Populates Card Editor inputs: #field-expression, #field-reading, #field-meaning, #field-example-*
  - Renders Study View into #meanings:
      * Dictionary source badge (Jitendex) + "+N more dicts" pill
      * Pitch accent badges (⓪ Heiban, ② Nakadaka)
      * Frequency badges (Netflix #180, BCCWJ #320)
      * Numbered senses (1..4 inline, 5..N in <details> progressive disclosure accordion)
      * Sense-bound POS badges ([1-dan, vt]) and tags ([usually kana], [math])
      * Ruby furigana in examples (<ruby>朝<rt>あさ</rt></ruby>)
      * [Insert] action buttons for Meaning and Example
                        │
                        ▼ (User clicks [Save Card] -> POST /api/cards/save with SaveCardRequest)
[ backend/app/services/card_service.py: save_card() ]
  - Persists image and audio files to local storage (app/services/media_storage.py)
  - Constructs CardDraft(expression, reading, meaning, hint, example_*, image, audio, tags, notes...)
  - Calls CardRepository.save_or_update(draft) -> writes row to SQLite `cards` table
  * DEFECT IDENTIFIED: SaveCardRequest omits `entries`; SQLite meanings_json receives empty "[]"
                        │
                        ▼ (User clicks [Send to Anki] -> POST /api/cards/{id}/sync)
[ backend/app/services/card_service.py: sync_card() ]
  1. Retrieves card record from SQLite (authoritative local source)
  2. Queries AnkiConnect via find_existing_note(deck_name, expression, reading)
  3. Uploads media files via store_media_file(clean_filename, data_bytes)
  4. Builds card_data dict:
       {
         "expression": card.expression,
         "reading": card.reading,
         "meaning": card.meaning,
         "hint": card.hint,
         "example_sentence": card.example_sentence,
         "example_translation": card.example_translation,
         "image": clean_image_file,
         "audio": clean_audio_file,
         "tags": card.tags,
         "notes": card.notes,
       }
  5. Calls AnkiConnectService.add_note(deck_name, card_data, tags, model_name)
                        │
                        ▼
[ backend/app/services/anki_connect.py: map_card_to_fields() ]
  - Inspects Anki model fields via modelFieldNames
  - Case A: Basic model ("front" and "back"):
      Front = "{expression} [{reading}]"
      Back  = "<br><br>".join([meaning, "Hint: {hint}", "{example}<br>{trans}", "Notes: {notes}", <img>, [sound:]])
  - Case B: Custom Japanese note model (e.g. Kaishi, Core 2k, Japanese Mining):
      Matches keywords to Expression, Reading, Meaning, Sentence, Image, Audio fields
                        │
                        ▼ (JSON-RPC addNote to 127.0.0.1:8765)
[ AnkiConnect Desktop Engine ]
  - Inserts note into Anki SQLite collection (`collection.anki2`)
  - Associates note with target Deck and Model
                        │
                        ▼
[ Rendered Anki Card in Anki Desktop / AnkiMobile / AnkiWeb ]
  - Card webview evaluates HTML template:
      Front Side: {{Front}} or {{Expression}}
      Back Side:  {{Back}} or {{Meaning}} + {{Sentence}} + {{SentenceImage}} + {{SentenceAudio}}
```

---

## 3. Current Multi-Dictionary Behavior

### 3.1 Primary Dictionary Selection
- In `backend/app/services/yomitan.py`:
  - The AST normalizer checks for `isPrimary` on the incoming Yomitan root entries and definition blocks.
  - Each `DictionaryEntry` stores `is_primary: bool = False` (or `True` if Yomitan marked it as the primary/top dictionary).
- In `backend/app/services/card_service.py`:
  - `synthesize_default_meaning` scans for the first entry matching `e.is_primary` that contains non-empty glosses. If none has `is_primary=True`, it falls back to the first entry with valid glosses.
  - `synthesize_default_example` prioritizes examples from `is_primary` entries via `sorted(entries, key=lambda e: not e.is_primary)`.
- In `extension/sidepanel/sidepanel.js`:
  - `primaryEntry = entries.find(e => e.is_primary) || entries[0]`.

### 3.2 Secondary Dictionary Representation
- In `CaptureResponse`:
  - All entries from all configured dictionaries are included in the `entries` array.
- In Side Panel Study View:
  - Secondary dictionaries are rendered as subsequent `.study-entry` blocks below the primary entry.
  - Each block displays the dictionary's own name, pitch accents, frequency ranks, and senses.
  - Senses > 4 are tucked into a progressive disclosure accordion (`Show N more senses...`).
- In Anki Output:
  - **Completely Absent.** The Anki note creation flow receives only the synthesized `meaning` string (which derived solely from the primary dictionary). Secondary dictionaries do not appear on the Anki card unless the user manually copied a secondary sense into the Meaning editor field.

### 3.3 Dictionary Attribution & Names
- Attribution (`entry.dictionary` and `entry.dictionary_alias`) is preserved through the domain model and displayed in the Side Panel header pills (e.g., `Jitendex`, `新明解国語辞典`).
- In Anki, dictionary attribution is **never sent or recorded**. Neither the Basic model back field nor custom model fields receive source dictionary tags.

### 3.4 Study View vs. Anki Card Alignment
- **Discrepancy:** The Side Panel Study View presents a rich, multi-dictionary comparative view with pitch accent curves, corpus frequency ranks, sense-specific grammatical categories, and ruby-annotated examples.
- In contrast, the Anki card currently receives only a bare text string with unformatted numbers (`1. to eat\n2. to live on`) and plain text example sentences without ruby.

---

## 4. Current Multi-Sense Formatting

### 4.1 Synthesis Logic Across Vocabulary Types
The table below documents how `CardService.synthesize_default_meaning` currently converts different dictionary terms:

| Linguistic Category | Benchmark Term | Card Draft `meaning` Value | Current Rendered Anki Output |
| :--- | :--- | :--- | :--- |
| **Single-Sense Word** | `映画` (`えいが`) | `movie, film` | `movie, film` (Rendered cleanly on single line) |
| **Polysemous Verb** | `食べる` (`たべる`) | `1. to eat\n2. to live on (e.g. one's salary), to make a living` | `1. to eat 2. to live on (e.g. one's salary), to make a living`<br>⚠️ **Lines collapse into single run-on sentence in HTML!** |
| **Highly Polysemous Term** | `掛ける` (`かける`)<br>(25 distinct senses in Jitendex) | 25 lines separated by `\n` (`1. to hang up...\n2. to put on...\n...25. to multiply`) | ⚠️ Massive 25-line text block collapsed into an unreadable wall of text in Anki webview. |

### 4.2 Critical Formatting Defects Identified

1. **Newline Collapsing in Anki Webview:**
   - Anki fields are evaluated as HTML by Anki's rendering engine.
   - `synthesize_default_meaning` produces plain text with ASCII `\n`.
   - In HTML without CSS `white-space: pre-line;` (which default Anki templates do NOT have), browser engines treat `\n` as standard whitespace (a single space).
   - Consequently, `1. to eat\n2. to live on` renders as `1. to eat 2. to live on` on a single wrapped line.

2. **Crude `<br><br>` Concatenation in Basic Model:**
   - In `AnkiConnectService.map_card_to_fields`:
     ```python
     back_parts = []
     if meaning: back_parts.append(meaning)
     if hint: back_parts.append(f"Hint: {hint}")
     if example:
         if example_trans: back_parts.append(f"{example}<br>{example_trans}")
         else: back_parts.append(example)
     if notes: back_parts.append(f"Notes: {notes}")
     field_map[back_field] = "<br><br>".join(back_parts)
     ```
   - This creates oversized double line breaks between sections, while senses within `meaning` have zero line breaks.

3. **Loss of Sense-Bound Grammatical Classifications:**
   - In `synthesize_default_meaning`, parts of speech (`1-dan verb`, `transitive`, `intransitive`, `suffix`) and usage tags (`usually kana`, `archaic`, `slang`, `math`) are completely omitted.
   - Example: For `掛ける`, sense 8 (`to multiply`) loses the `[math]` domain tag. Senses with transitive/intransitive distinctions lose their grammatical cues.

4. **Example Sentences Lack Ruby Annotations in Anki:**
   - In `yomitan.py`, ruby furigana is preserved as bracket notation (`映[えい]画[が]`) in `ExampleSentence.reading`.
   - In `sidepanel.js`, `renderRubyText` converts this into semantic `<ruby>` elements for display in the Side Panel.
   - But `synthesize_default_example` extracts only `example.japanese` (plain text) into `example_sentence`.
   - When synced to Anki, the example sentence is sent without furigana or ruby markup.

---

## 5. Current HTML Generation Architecture

### 5.1 Audit of HTML Generation Locations
HTML generation is currently fragmented and unstructured across the repository:

| Layer | File | HTML Generation Behavior | Verdict |
| :--- | :--- | :--- | :--- |
| **Yomitan Normalizer** | `backend/app/services/yomitan.py` | Data only. Produces frozen dataclasses. Strips AST nodes to clean text and bracket furigana. | **CLEAN** (Preserves separation of concerns) |
| **CardService** | `backend/app/services/card_service.py` | String manipulation only (`\n`, `, `). Zero HTML generation. | **CLEAN** (Business logic only) |
| **SQLite Persistence** | `backend/app/repositories/card_repository.py` | Stores strings and JSON text. Zero HTML generation. | **CLEAN** (Data repository only) |
| **AnkiConnect Service** | `backend/app/services/anki_connect.py`<br>(lines 397–499) | Constructs ad-hoc HTML strings: `<img src="...">`, `<br><br>`, `<br>`, `[sound:...]`. Mixed directly inside field mapping logic. | ⚠️ **SMELL** (Presentation markup hardcoded in transport service) |
| **Side Panel Extension** | `extension/sidepanel/sidepanel.js` | Uses safe DOM APIs (`document.createElement`, `textContent`, `renderRubyText`). Zero raw string HTML injection. | **CLEAN** (Declarative client rendering) |

### 5.2 Recommended Architecture Boundary
HTML formatting for Anki should NOT be scattered inside `AnkiConnectService` or mixed into SQLite storage.

**Architectural Principle:**
- **SQLite is the source of truth for semantic card data** (plain text expressions, readings, meanings, examples, media paths, and structured JSON entries).
- **Anki HTML formatting belongs in a dedicated, isolated service layer** (e.g., `AnkiFormatter` or `AnkiCardPresenter`) invoked at the moment of Anki field mapping.
- This keeps SQLite records pure, searchable, and independent of Anki template changes, while guaranteeing that notes dispatched to AnkiConnect contain semantic, sanitized, and beautiful HTML.

---

## 6. Current Media Representation

### 6.1 Media Storage & Serialization
1. **Screenshots / Images:**
   - Captured by the extension as base64 JPEG data URLs (`data:image/jpeg;base64,...`).
   - Saved locally by `MediaStorageService` in `backend/data/media/` as deterministic files (e.g. `kiroku_img_1726481234_abc123.jpg`).
   - Stored in SQLite `cards.image` as the relative filename `kiroku_img_*.jpg`.
   - Synchronized to Anki's media collection via AnkiConnect `storeMediaFile`.
   - Mapped to Anki model image fields as `<img src="kiroku_img_*.jpg">`.
   - Fallback: If the target model has no dedicated image field, the `<img>` tag is appended to `Back` or `Notes` via `<br><br><img ...>`.

2. **Audio Recordings:**
   - Captured by the extension as 16-bit mono PCM encoded to standard WAV base64 data URLs (`data:audio/wav;base64,...`).
   - Saved locally by `MediaStorageService` as `kiroku_audio_*.wav`.
   - Stored in SQLite `cards.audio` as the relative filename `kiroku_audio_*.wav`.
   - Synchronized to Anki via `storeMediaFile`.
   - Mapped to Anki model audio fields as `[sound:kiroku_audio_*.wav]`.
   - Fallback: If no dedicated audio field exists, appended to `Back` or `Notes`.

### 6.2 Media Display Findings
- **Anki Image Sizing:** Raw `<img>` tags inserted into Anki fields without styling or template CSS can cause high-resolution screenshots (e.g. 1080p video frames) to overflow the Anki review window.
- **Audio Autoplay:** In Anki, `[sound:filename.wav]` on the back of a card triggers native autoplay upon card flip, which matches standard Japanese SRS mining workflows.

---

## 7. Current Custom-Model Compatibility

### 7.1 Model Discovery & Auto-Resolution
In `backend/app/services/anki_connect.py`:
1. `resolve_note_model()` checks:
   - Environment override `ANKI_NOTE_MODEL`
   - Models containing `"mining"` or `"vocab"` that have both prompt and answer fields
   - Standard `"Basic"` model
   - Models containing `"japanese"`
   - Fallback to any model supporting prompt + answer, or `"Basic"`, or the first available model.
2. `get_model_capabilities()` inspects target models for image, audio, and sentence field support.
3. Explicit model selection in the Side Panel (`#field-model-select`) overrides automatic resolution.

### 7.2 Field Mapping Matrix
`map_card_to_fields()` performs fuzzy keyword matching against the target model's field names (case-insensitive, ignoring spaces, hyphens, and underscores):

| Semantic Field | Keyword Matching Patterns in Anki Models | Current Fallback Behavior |
| :--- | :--- | :--- |
| **Expression** | `expression`, `japanese`, `word`, `front`, `kanji`, `vocabkanji`, `vocab`, `targetword`, `vocabulary`, `headword` | Populates first field of model |
| **Reading** | `reading`, `furigana`, `kana`, `vocabfurigana`, `vocabreading`, `kanareading`, `readingfurigana` | Merged into Front for Basic: `映画 [えいが]` |
| **Meaning** | `meaning`, `glossary`, `english`, `definition`, `back`, `vocabdef`, `vocabmeaning`, `meaningglossary`, `primarymeaning`, `englishmeaning` | Populates second field of model if empty |
| **Hint** | `hint` | Appended to Back with `Hint: ` prefix |
| **Example Sentence** | `examplesentence`, `sentenceexpression`, `sentence`, `sentences`, `example`, `examples` | Appended to Back in Basic model |
| **Example Translation** | `exampletranslation`, `sentencetranslation`, `sentenceenglish`, `examplesentencemeaning`, `translation` | Appended below example in Basic model |
| **Notes** | `notes`, `note`, `comment` | Appended to Back in Basic model |
| **Image** | `image`, `picture`, `sentenceimage`, `sentencepicture`, `vocabimage`, `vocabpicture`, `screenshot`, `photo`, `snapshot`, `illustration`, `images`, `pictures` | Appended to `notes` or `back` fallback |
| **Audio** | `sentenceaudio`, `sentencesound`, `sentenceaudiofile`, `audio`, `sound`, `vocabaudio`, `vocabsound`, `wordaudio`, `targetaudio`, `voice`, `pronunciation` | Appended to `notes` or `back` fallback |

### 7.3 Compatibility Assessment
- The existing keyword dictionary covers **all major Japanese community Anki note types**:
  - *Kaishi 1.5k / Kaishi Japanese*
  - *Core 2k/6k/10k*
  - *Yomitan Default Anki Template*
  - *Anime Cards / Japanese Mining Note*
  - *Standard Basic (Front/Back)*
- Any improvements to card formatting MUST preserve this keyword mapping without breaking custom models.

---

## 8. Security Findings

### 8.1 Audit of HTML Injection & XSS Vulnerabilities

1. **Unescaped User & Dictionary Input in Anki Fields:**
   - In `map_card_to_fields`:
     `card.get("expression")`, `card.get("meaning")`, `card.get("example_sentence")`, etc., are interpolated directly into HTML strings without `html.escape()`.
   - *Risk Scenario:* If a user captures text containing `<script>`, `<iframe>`, or HTML entities, or if dictionary glosses contain literal comparison symbols (e.g. `A < B` in math/grammar definitions), the characters are parsed as unclosed or hostile HTML elements in Anki's Chromium webview.
   - *Severity:* **Medium/High** (Markup distortion, potential XSS in Anki webview).

2. **Media Filename Sanitization:**
   - In `map_card_to_fields`:
     `img_file = os.path.basename(raw_img)`
     `formatted_img = f'<img src="{img_file}">'`
   - `os.path.basename` prevents directory traversal attacks, but if `img_file` contained quotes (`" onmouseover="..."`), attribute breakout could theoretically occur.
   - *Fix:* Ensure filenames contain only alphanumeric characters, underscores, and dots before interpolation.

3. **Extension Side Panel Sanitization:**
   - The Side Panel implementation (`sidepanel.js`) strictly uses `document.createElement`, `textContent`, and safe DOM node appending.
   - It **never** uses `innerHTML` for dictionary text or captured terms.
   - *Status:* **SECURE.**

### 8.2 Security Recommendations
- Centralize all Anki HTML generation behind an escaping filter:
  ```python
  import html

  def escape_anki_html(text: str) -> str:
      return html.escape(text, quote=True)
  ```
- Any intentional HTML markup emitted by Kiroku (such as `<ruby>`, `<rt>`, `<ol>`, `<li>`, `<span class="...">`) must be generated programmatically from sanitized tokens, never by raw string concatenation of untrusted input.

---

## 9. Clear Audit Categorization

### 9.1 ALREADY WORKING
- **Yomitan AST Normalizer:** Robust, depth-clamped parser extracting sense-bound POS, tags, notes, ruby example pairs, pitch accents, and frequency ranks.
- **Provider-Neutral Domain Dataclasses:** Strongly typed models (`DictionaryEntry`, `DictionarySense`, `PitchAccent`, `FrequencyRank`, `ExampleSentence`).
- **Basic Multi-Sense Synthesis:** `CardService.synthesize_default_meaning` and `synthesize_default_example` for card drafts.
- **Side Panel Precision Dark Utility Design System:** 4px spacing scale, dark canvas, Noto Sans JP typography, accessible contrast, responsive breakpoints (320px–600px).
- **Side Panel Study View:** Structured display of multiple dictionaries, pitch pills, frequency pills, sense-bound POS badges, progressive disclosure for >4 senses, quick-insert buttons, and ruby rendering.
- **SQLite Core Persistence:** Thread-safe, WAL-mode SQLite storage with duplicate identity checking (`normalized_expression`, `normalized_reading`, `normalized_deck_name`).
- **AnkiConnect Integration:** Full health check, deck creation, model discovery, model capability detection, and duplicate detection.
- **Media Pipeline:** Video frame capture, audio recording, local disk persistence, and Anki media collection synchronization (`storeMediaFile`).

### 9.2 ACTUALLY MISSING
- **Structured Entries Dropped on Card Save:** `SaveCardRequest` in `backend/app/schemas.py` does not include `entries`. When a user saves a card from the editor, SQLite `meanings_json` receives `"[]"`, permanently dropping the structured dictionary metadata from local history.
- **Anki Multi-Sense Formatting Engine:** Anki note fields currently receive plain text with raw `\n`, which collapses into a single line in Anki's HTML webview. Semantic HTML lists (`<ol>`, `<li>`, `<br>`) are completely missing.
- **HTML Escaping in Anki Exporter:** User input and dictionary strings are injected into Anki fields without `html.escape()`.
- **Sense-Bound POS & Tag Presentation in Anki:** High-value linguistic distinctions (transitive `[vt]`, intransitive `[vi]`, grammatical tags) are stripped during draft synthesis and never reach Anki.
- **Ruby Furigana in Anki Examples:** Ruby annotations captured in `ExampleSentence.reading` (`映[えい]画[が]`) are discarded when populating the card editor and Anki sync.
- **Clean Basic Note Card Layout:** The default Basic model back field is an unstyled dump of `<br><br>` concatenated strings without visual hierarchy.

### 9.3 OPTIONAL POLISH
- **Embedded Anki CSS Styling:** Including lightweight, scoped CSS rules in Basic note templates matching Kiroku's Precision Dark Utility aesthetics.
- **Custom Model Optional Field Mapping:** Auto-populating dedicated `Pitch`, `PitchAccent`, `Frequency`, or `JLPT` fields when present in advanced community note types.
- **Configurable Anki Export Options:** User settings toggling whether sense POS tags, pitch accents, or example furigana are included in Anki exports.

---

## 10. Problems Worth Fixing in Stage 3B.4

We isolate four core problems that deliver the greatest impact on learning quality and card readability without introducing architectural bloat:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PROBLEMS WORTH FIXING                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  Problem 1: Multi-Sense HTML Collapsing in Anki                             │
│    -> Replace raw \n with semantic HTML (<ol>/<li> or clean line breaks)     │
│       so multi-sense definitions are immediately readable on the card.      │
│                                                                             │
│  Problem 2: Preserving Sense-Bound POS & Tags in Anki Output                 │
│    -> Include compact, subtle grammatical badges (e.g. [vt], [noun]) in      │
│       Anki definitions so learners know how to use the word.                │
│                                                                             │
│  Problem 3: Structured Entries Dropped in SaveCardRequest                   │
│    -> Allow SaveCardRequest to receive and persist `entries` so saved cards │
│       retain their full multi-dictionary history in SQLite.                 │
│                                                                             │
│  Problem 4: Unescaped HTML & Lack of Dedicated Presentation Layer           │
│    -> Create a clean, centralized `AnkiFormatter` with proper HTML escaping │
│       and clean layout for Basic and Custom note types.                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Proposed Anki Card Design & Product Direction

### 11.1 Design Philosophy: The Learner-Focused Card
The Anki card should **NOT** simply dump the entire Side Panel DOM into Anki. During daily spaced-repetition reviews, the user has roughly 5 to 10 seconds to recall the word. Visual clutter, massive metadata strips, and raw corpus numbers create cognitive fatigue.

The Anki card must follow a strict, scannable **Learner Hierarchy**:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            ANKI CARD HIERARCHY                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  FRONT SIDE                                                                 │
│  ──────────                                                                 │
│  1. Japanese Expression (Large, prominent Japanese font)                    │
│  2. Optional Hint / Context sentence (if configured)                        │
│                                                                             │
│  BACK SIDE                                                                  │
│  ─────────                                                                  │
│  1. Japanese Expression + Kana Reading (with optional pitch downstep)       │
│  2. Clean, Numbered Meanings with subtle POS badges ([vt], [n])             │
│  3. Example Sentence (with clean ruby furigana)                             │
│  4. Example Translation (subtle, secondary text)                            │
│  5. Media Strip (Video screenshot frame + audio replay)                     │
│  6. Notes (if user added personal mnemonics)                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 11.2 Evaluation of Metadata on Anki Cards
In accordance with user guidelines, we evaluate which metadata belongs on the Anki card:

| Metadata Field | Recommendation for Anki Card | Rationale |
| :--- | :--- | :--- |
| **Part-of-Speech (POS)** | **INCLUDE (Compact)** | Essential for Japanese grammar (distinguishing transitive vs intransitive verb pairs like 落とす/落ちる, or noun vs na-adjective). Formatted compactly: `<span class="pos">[vt]</span>`. |
| **Sense Tags / Domain** | **INCLUDE (When present)** | High value for understanding specific meanings (e.g. `[math]`, `[archaic]`, `[usually kana]`). |
| **Pitch Accent** | **INCLUDE COMPACT / OPTIONAL** | Tokyo pitch downstep number and pattern (e.g. `[② Nakadaka]`) next to the reading. Invaluable for pronunciation; minimal visual footprint. |
| **Frequency Ranks** | **OMIT FROM CARD (Keep in Panel)** | Corpus rankings (`Netflix #180`, `BCCWJ #320`) are useful for the mining decision in the Side Panel, but useless trivia during daily flashcard review. |
| **JLPT Level** | **OMIT BY DEFAULT (Deferred)** | JLPT service is currently deferred. If a model has a dedicated `JLPT` field, map it; otherwise omit from default card face. |
| **Dictionary Source** | **OMIT FROM CARD FACE** | Knowing whether a definition came from Jitendex or Kenkyusha does not help vocabulary recall. Omit from card face to prevent clutter. |
| **Ruby Furigana in Example** | **INCLUDE** | Greatly assists reading complex kanji in context without requiring manual dictionary lookups during review. |

### 11.3 Visual Styling (Basic Model & Default Card)
For users syncing to Anki's standard Basic (Front/Back) model, the back field should render with clean, inline CSS compatible with Anki Desktop, AnkiMobile (iOS), and AnkiDroid:

```html
<div class="kn-card">
  <!-- Reading & Pitch -->
  <div class="kn-reading">
    <span class="kn-kana">たべる</span>
    <span class="kn-pitch">[② 中高]</span>
  </div>

  <hr class="kn-divider">

  <!-- Meanings List -->
  <ol class="kn-meanings">
    <li>
      <span class="kn-pos">[1-dan, vt]</span>
      to eat; to consume
    </li>
    <li>
      <span class="kn-pos">[1-dan, vt]</span>
      to live on (e.g. one's salary); to make a living
    </li>
  </ol>

  <!-- Example Sentence with Ruby -->
  <div class="kn-example-block">
    <p class="kn-example-ja"><ruby>朝<rt>あさ</rt>御<rt>ご</rt>飯<rt>はん</rt></ruby>を<ruby>食<rt>た</rt></ruby>べる。</p>
    <p class="kn-example-en">To eat breakfast.</p>
  </div>

  <!-- Media -->
  <div class="kn-media">
    <img src="kiroku_img_123.jpg" class="kn-image">
    [sound:kiroku_audio_123.wav]
  </div>
</div>
```

---

## 12. Proposed HTML Generation Boundary

### 12.1 Dedicated Formatting Module: `AnkiFormatter`
To eliminate ad-hoc string concatenation from `AnkiConnectService` and maintain clean service boundaries:

```
[ CardRecord (SQLite) ]
           │
           ▼
[ app/services/anki_formatter.py: AnkiFormatter ]
  ├── format_meaning_html(meaning_text, entries=None) -> str (Safe HTML <ol>/<li>)
  ├── format_example_html(sentence, reading_with_ruby, translation) -> str (Safe <ruby>)
  ├── format_basic_back(card, formatted_meaning, formatted_example, ...) -> str
  └── sanitize_media_tags(image_filename, audio_filename) -> tuple[str, str]
           │
           ▼
[ app/services/anki_connect.py: AnkiConnectService.map_card_to_fields() ]
  - Takes sanitized, pre-formatted strings
  - Maps deterministically to resolved model fields
           │
           ▼
[ AnkiConnect JSON-RPC addNote ]
```

### 12.2 Responsibilities of Each Layer
1. **`card_repository.py`:** Pure SQLite data access. Stores and returns raw strings and JSON entries.
2. **`card_service.py`:** Orchestrates capture, identification, local saving, and sync lifecycle. Passes card record and entries to the formatter.
3. **`anki_formatter.py` (New dedicated module):** Responsible for all HTML rendering, escaping, semantic list construction, ruby markup generation, and responsive card wrapping for Anki.
4. **`anki_connect.py`:** Pure HTTP / JSON-RPC client. Resolves models, checks duplicates, maps formatted fields to model field names, and dispatches notes.

---

## 13. Proposed Field & Template Strategy

### 13.1 Strategy for Basic Model (`Front`, `Back`)
- **Front Field:**
  `{expression}` (or `{expression} [{reading}]` if expression contains kanji and reading differs).
- **Back Field:**
  A structured, beautifully formatted HTML block:
  1. Reading header with optional pitch accent badge.
  2. Semantic `<ol class="kn-meanings">` with clean numbered items and compact `[pos]` tags.
  3. Example sentence block with `<ruby>` annotations and translation.
  4. User hint and notes (if present).
  5. Image `<img src="..." style="max-width:100%; border-radius:4px;">` and Audio `[sound:...]`.

### 13.2 Strategy for Custom Japanese Models (e.g. Kaishi, Mining, Core 2k)
Custom models already define dedicated fields (`Expression`, `Reading`, `Meaning`, `Sentence`, `SentenceImage`, `SentenceAudio`).
- **Meaning Field:**
  Format as clean HTML:
  - If single-sense: `glosses` with optional `[pos]` tag.
  - If multi-sense: clean `<ol class="kn-meanings"><li>...</li></ol>` or `<div class="kn-sense">1. ...</div>`.
  - Escaped against XSS.
- **Sentence Field:**
  - If the model uses plain sentence fields: preserve clean Japanese text.
  - If bracket ruby exists in `ExampleSentence.reading` and the model field is `SentenceExpression` or `Sentence`: emit safe `<ruby>` markup or standard Japanese bracket notation depending on model conventions.
- **Media Fields:**
  - `Image`: `<img src="{filename}">`
  - `Audio`: `[sound:{filename}]`

---

## 14. Compatibility & Persistence Strategy

### 14.1 Preserving Existing Saved Cards & Database Schema
- **Zero SQLite Table Alterations:** The SQLite schema already has `meanings_json TEXT NOT NULL DEFAULT '[]'` and all required card columns (`meaning`, `example_sentence`, `image`, `audio`, etc.).
- **Updating `SaveCardRequest`:**
  Add an optional `entries: list[dict[str, Any]] = Field(default_factory=list)` to `SaveCardRequest` in `backend/app/schemas.py`.
  - If provided by the frontend during `Save Card`, it is serialized into `meanings_json`.
  - If omitted (e.g. from existing test fixtures or legacy callers), it safely defaults to `[]`.
- **Existing Cards Deserialization:**
  All existing records in `cards` table continue to deserialize with 100% compatibility.

### 14.2 Fail-Soft Degradation
- If AnkiConnect is offline, cards save locally in SQLite with `sync_status = "pending"`.
- If a custom model lacks dedicated media fields, images and audio fall back to the Back/Notes field without data loss.
- If a card has custom user-edited text in `#field-meaning`, `AnkiFormatter` formats the user's text with clean line breaks (`<br>` or `<li>`) without forcing dictionary defaults.

---

## 15. Comprehensive Test Plan

### 15.1 Backend Test Matrix (`backend/tests/`)
| Test File | Target Scenario | Verification Criteria |
| :--- | :--- | :--- |
| `test_anki_formatter.py` | Single-sense word formatting | Produces clean, escaped HTML string without unnecessary `<ol>` wrappers. |
| `test_anki_formatter.py` | Multi-sense word formatting | Produces `<ol class="kn-meanings">` with distinct `<li>` elements and `<br>` safety. |
| `test_anki_formatter.py` | Highly polysemous word (25 senses) | Formats senses cleanly; verifies no runaway markup or truncation. |
| `test_anki_formatter.py` | XSS / HTML entity escaping | Text containing `<script>alert(1)</script>` or `A < B` is strictly escaped to `&lt;script&gt;` and `&lt;`. |
| `test_anki_formatter.py` | Ruby text formatting | Bracket notation `映[えい]画[が]` converts to valid `<ruby>映<rt>えい</rt>画<rt>が</rt></ruby>`. |
| `test_anki_formatter.py` | Basic model Back field synthesis | Synthesizes complete back block with reading, meanings, example, and media. |
| `test_anki_connect.py` | Regression against all community note models | Verifies Kaishi, Core 2k, Japanese Mining, and Basic models pass with formatted content. |
| `test_card_service_persistence.py` | `entries` persistence in `save_card` | Verifies `SaveCardRequest` with `entries` correctly populates `meanings_json` in SQLite. |

### 15.2 Extension Test Matrix (`extension/tests/`)
| Test File | Target Scenario | Verification Criteria |
| :--- | :--- | :--- |
| `sidepanel.test.js` | Save Card payload inspection | Verifies `currentDictionaryEntries` is included in the payload sent to `/api/cards/save`. |
| `sidepanel.test.js` | History card reopening | Verifies reopening a saved card with persisted `entries` calls `renderDetails` and renders the Study View. |

---

## 16. Smallest Safe Implementation Sequence

The implementation of Stage 3B.4 should be executed in these small, verifiable steps:

- [ ] **Step 1: SaveCardRequest Schema & Persistence (`backend/app/schemas.py`, `backend/app/services/card_service.py`)**
  - Add optional `entries: list[dict[str, Any]] = Field(default_factory=list)` to `SaveCardRequest`.
  - Pass `draft.entries = request.entries` in `CardService.save_card()`.
  - Send `entries: currentDictionaryEntries` in `sidepanel.js` `saveCard()`.
  - *Verification:* Test that saving a card and reopening it from history retains full Study View rendering.

- [ ] **Step 2: Dedicated Anki Formatter Engine (`backend/app/services/anki_formatter.py`)**
  - Implement `format_meaning_html()`: converts plain text or structured senses into safe, semantic HTML lists.
  - Implement `format_ruby_html()`: converts bracket furigana into standard `<ruby>` tags.
  - Implement `format_basic_back_html()`: constructs an organized, learner-focused back field for Basic cards.
  - Add comprehensive unit tests in `tests/test_anki_formatter.py` covering single-sense, multi-sense, ruby, and XSS escaping.

- [ ] **Step 3: AnkiConnect Field Mapping Integration (`backend/app/services/anki_connect.py`)**
  - Refactor `map_card_to_fields()` to consume `AnkiFormatter` for `Back`, `Meaning`, and `Sentence` values.
  - Ensure all existing custom model keyword tests continue to pass without regression.

- [ ] **Step 4: Full Regression Testing & Documentation Update**
  - Run full backend test suite (`python -m pytest`).
  - Run full extension test suite (`node --test extension/tests/*.test.js`).
  - Update `PROGRESS.md` recording delivered behavior and baseline results.

---
*End of Stage 3B.4 Audit & Technical Design Specification.*
