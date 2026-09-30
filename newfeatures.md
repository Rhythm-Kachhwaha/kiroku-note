# Kiroku Note — Feature Implementation Guide

> **For coding agents:** Read `AGENTS.md`, `ARCHITECTURE.md`, and `PROGRESS.md` before touching any file. 
> Use superpowers when necessary.
> Features are sorted from simplest to most complex. Implement low-complexity items first or as asked by user to avoid
> destabilizing working systems. Each entry describes WHAT to do, WHY, and HOW with exact file targets.
> Run the full test suites after every feature: `python -m pytest -o pythonpath=backend backend/tests`
> and `node --test extension/tests/*.test.js`.
> **Agents: tick the checkbox below when a task is fully done and verified.**

---

## ✅ Task Progress Index

> Tick the box and write the completion date when a task passes all tests.

### Tier 1 — Trivial
- [x] **T1-A** — Add hover tooltips to the 3 header status dots (Yomitan / AnkiConnect / OCR) *(Already implemented & verified 2026-09-29)*
- [x] **T1-B** — Show "163 / 213 synced" label next to the History progress bar *(Implemented & verified 2026-09-29)*
- [x] **T1-C** — Add friendly empty-state messages when History/Quick Add/Dictionary is blank *(Implemented & verified 2026-09-29)*
- [x] **T1-D** — Hide blank/mostly-empty form tables in the dictionary view *(Implemented & verified 2026-09-29)*
- [x] **T1-E** — Add "→ Sentence" button on dictionary examples to insert into the Sentence field *(Already functionally implemented, UI label updated to "→ Sentence" & verified 2026-09-29)*

### Tier 2 — Low
- [x] **T2-A** — Show JLPT level (N3 etc.) as a pill on each History card row *(Implemented & verified 2026-09-29)*
- [x] **T2-B** — Add keyboard shortcut `Alt+Shift+K` to open the Side Panel *(Implemented & verified 2026-09-29)*
- [x] **T2-C** — Include verb type & transitivity on the Anki card HTML output *(Implemented & verified 2026-09-29)*
- [x] **T2-D** — Add a 🔊 speaker button on the hero card to play pronunciation via browser TTS *(Implemented & verified 2026-09-29)*
- [x] **T2-E** — Show OCR confidence score badge next to expression after OCR capture *(Evaluated per spec: manga-ocr model pipeline does not expose per-token confidence/logits; documented as Not Implemented in PROGRESS.md per constraint)*
- [x] **T2-F** — Add Export CSV button in History to download all cards as a file *(Implemented & verified 2026-09-29)*
- [x] **T2-G** — Add a single `/api/health` endpoint replacing the 3-4 separate startup checks *(Implemented & verified 2026-09-29)*
- [x] **T2-H** — Detect Japanese text on clipboard when panel opens and offer one-click capture *(Implemented & verified 2026-09-29)*
- [x] **T2-I** — Auto-trigger Sync All silently when AnkiConnect comes back online *(Implemented & verified 2026-09-29)*
- [x] **T2-J** — Add sort dropdown to History (by date / JLPT / deck / status) *(Implemented & verified 2026-09-29)*
- [x] **T2-K** — Fix wrong POS tags (desu/ashita/imi showing "verb") + reduce dictionary clutter *(Implemented & verified 2026-09-29)*

### Tier 3 — Medium
- [x] **T3-A** — `Alt+Enter` shortcut: saves card AND sends to Anki in one step *(Implemented & verified 2026-09-29)*
- [x] **T3-C** — 5-second Undo toast after deleting a card from History *(Implemented & verified 2026-09-29)*
- [x] **T3-E** — Sentence stepper (◀ 1/3 ▶) when a dictionary entry has multiple examples *(Implemented & verified 2026-09-29)*
- [x] **T3-F** — Stats panel in History: cards today/week, JLPT breakdown, deck distribution *(Implemented & verified 2026-09-30)*
- [x] **T3-G** — Save card template settings (furigana, JLPT badge etc.) per Anki deck *(Implemented & verified 2026-09-30)*
- [x] **T3-H** — Furigana density control: All / Advanced-only (hide N4/N5 kanji ruby) / None *(Implemented & verified 2026-09-29)*
- [x] **T3-I** — Store and show where/when a card was mined (Text / Video / OCR + source URL) *(Implemented & verified 2026-09-29)*
- [x] **T3-J** — Show live per-card ✓/✗ progress list during Sync All instead of just a count *(Implemented & verified 2026-09-29)*

### Tier 4 — Complex
- [x] **T4-A** — Checkboxes on History cards for bulk delete / bulk move to deck / bulk sync *(Implemented & verified 2026-09-30)*
- [x] **T4-B** — Search box in Video tab to find a word in the subtitle track and jump to it *(Implemented & verified 2026-09-30)*
- [x] **T4-C** — "Last 5 cues" panel in Video tab — click any recent subtitle to mine from it *(Implemented & verified 2026-09-30)*
- [ ] **T4-D** — "↺ Re-scan" button after OCR to re-use the last region without re-selecting
- [ ] **T4-E** — Stroke order SVG diagram inside existing kanji breakdown cards (KanjiVG data)
- [x] **T4-F** — "Mine sentence" button in Video tab to mine the whole current subtitle cue at once *(Implemented & verified 2026-09-30)*

### Tier 5 — LLM (Optional AI Assistant)
- [ ] **LLM-1** — Backend `LLMService` + `/api/llm/ask` + `/api/llm/status` endpoints
- [ ] **LLM-2** — "Translate sentence" button in Side Panel (shows translation below dictionary)
- [ ] **LLM-3** — "Best sense for context" button (LLM picks which dictionary meaning fits)
- [ ] **LLM-4** — "Explain grammar" button (explains grammar pattern in the captured sentence)
- [ ] **LLM-5** — "Memory hook" button (LLM generates a mnemonic for the current word)

---

## Complexity Tier Overview

| Tier | Label | Scope |
|---|---|---|
| 1 | **Trivial** | CSS/HTML/one-liner JS — zero logic risk |
| 2 | **Low** | Small self-contained JS or Python addition |
| 3 | **Medium** | Coordinated front+back change, new UI state |
| 4 | **Complex** | New system, significant new data flow |
| 5 | **LLM** | New optional service — see dedicated section |

---

---

# TIER 1 — Trivial

---

## T1-A: Status Dot Hover Tooltips

**What:** The 3 dots in the header (Yomitan · AnkiConnect · OCR) currently have no label. Add
`title="Yomitan: Connected"` / `"Offline"` tooltip strings that update dynamically alongside the
existing status dot class updates.

**Why:** Users — especially new ones — have no idea what the 3 dots represent without going to Settings.

**Files:**
- `extension/sidepanel/sidepanel.html` — add `title=""` attribute to each indicator dot element
- `extension/sidepanel/sidepanel.js` — wherever `checkYomitanStatus()`, `checkAnkiStatus()`,
  `checkOcrStatus()` set the indicator class, also set `element.title = "Yomitan: Connected"` etc.

**Constraints:** Zero new DOM elements needed. Do not add visible label text — just the tooltip.

---

## T1-B: History Progress Bar Label

**What:** The progress bar at the top of the History view (screenshot shows it partially filled)
has no label. Add a live text label next to it showing e.g. `163 / 213 synced`.

**Why:** The bar is unreadable without context. The card count and sync stats are already available
from the same API call that populates the history list.

**Files:**
- `extension/sidepanel/sidepanel.html` — add `<span id="history-sync-label"></span>` next to the
  progress bar element
- `extension/sidepanel/sidepanel.js` — in the history render function, after counting
  synced/total cards, set `historySyncLabel.textContent = \`${synced} / ${total} synced\``

**Constraints:** Read-only display. No new API calls — derive from the existing card list already fetched.

---

## T1-C: Empty State Illustrations (SVG)

**What:** When History has 0 cards, Quick Add has no suggestions, or Dictionary returns nothing —
replace the blank space with a small inline SVG illustration + a friendly message and an action hint.

**Why:** Empty states are the first experience for new users. Blank space looks broken.

**Suggested copy:**
- History empty: SVG of a small card stack icon + "No cards mined yet. Start mining to see your history here."
- Quick Add no results: "No matches found. Try a different reading or switch to EN mode."
- Dictionary offline: "Yomitan is offline. Connect Yomitan to get dictionary enrichment."

**Files:**
- `extension/sidepanel/sidepanel.css` — add `.empty-state { text-align: center; padding: 32px 16px; color: var(--text-muted); }`
- `extension/sidepanel/sidepanel.js` — in `renderHistory()`, `renderQuickAddSuggestions()`,
  and `renderDetails()` empty-result branches, replace existing empty string with the SVG+message block.

**Constraints:** SVGs must be inline (no external img src — violates CSP). Keep them < 200 bytes.

---

## T1-D: Dictionary Forms Table — Hide Blank Rows

**What:** The Yomitan dictionary sometimes outputs a "forms" section with a partially empty table
(screenshot 2 shows blank cells: `ø | 確り | 齷り` row with しっかり in first column but all
other cells empty). These blank tables add visual clutter and no useful information.

**Why:** Empty form tables are confusing and look like rendering errors. They come from Yomitan's
structured-content AST and cannot be prevented at the source; they must be filtered on render.

**Files:**
- `extension/sidepanel/sidepanel.js` — after the Yomitan AST is rendered into the dictionary
  container, run a post-render cleanup pass:
  ```js
  // After rendering each dict entry, remove tables where > 50% of td cells are empty
  container.querySelectorAll('table').forEach(table => {
    const cells = [...table.querySelectorAll('td')];
    const empty = cells.filter(td => td.textContent.trim() === '').length;
    if (empty / cells.length > 0.5) table.closest('.forms-section, tr')?.remove() ?? table.remove();
  });
  ```
- `extension/sidepanel/sidepanel.css` — add `.dict-forms-section:empty { display: none; }` as
  a safety fallback.

**Constraints:** Do not remove tables that have meaningful content in the majority of cells.
This is a display filter only — no backend change needed.

---

## T1-E: "Insert to Sentence" Button on Dictionary Examples

**What:** Dictionary entries show example sentences (screenshot 3 shows
`その語にはいくつかの意味がある。`). Currently only "Insert" (to Meaning) exists. Add a second
small button `"→ Sentence"` that inserts the example into `#field-example-sentence` instead.

**Why:** Sentence cards are common. The flow currently requires copy-pasting the example manually.

**Files:**
- `extension/sidepanel/sidepanel.js` — in the sense renderer that creates Insert buttons, add a
  second button alongside. On click: ensure `#optional-details` is opened first (call
  `optionalDetails.open = true` and unhide `#optional-fields` if needed), then set
  `fieldExampleSentence.value = exampleText; fieldExampleSentence.dispatchEvent(new Event('input'))`.
- `extension/sidepanel/sidepanel.css` — style `.btn-insert-sentence` consistently with existing
  `.btn-insert` using a different icon or label.

**Constraints:** `#field-example-sentence` lives inside the Optional Fields accordion which is
closed by default. The click handler must open the accordion before inserting. Preserve existing
Insert (to Meaning) behavior 100%. The new button is purely additive.

---

---

# TIER 2 — Low Complexity

---

## T2-A: JLPT Level Pill in History Card Rows

**What:** Each card in the History list shows deck name and sync status. Add the JLPT level
(e.g. `N3`) as a small pill in the card row if `jlpt_level` is stored on the card.

**Why:** 213 cards in the history, and the only metadata visible is deck name and SYNCED badge.
JLPT level is the most useful quick-scan filter.

**Files:**
- `extension/sidepanel/sidepanel.js` — in the history card row renderer, after the deck badge,
  conditionally add `<span class="pill-jlpt">N3</span>` if `card.jlpt_level` is truthy.
- Backend: Verify that `GET /api/cards` response includes `jlpt_level` per card. If not,
  `backend/app/repositories/card_repository.py` needs to include it in the `CardRecord` serialization.
- `extension/sidepanel/sidepanel.css` — `.history-jlpt-pill` using the existing `var(--accent-jlpt)` token.

**Constraints:** JLPT level is already stored in SQLite `meanings_json`. Deserialize it in the
repository layer — do not add a new column.

---

## T2-B: Keyboard Shortcut to Open / Focus Side Panel

**What:** Declare a Chrome Extension keyboard command so users can open/focus the Side Panel
without clicking the extension icon. Suggested default: `Alt+Shift+K`.

**Why:** Reaching for the toolbar icon during reading or video watching breaks focus and is
especially disruptive in full-screen video mode.

**Files:**
- `extension/manifest.json` — add a `"commands"` key:
  ```json
  "commands": {
    "open-side-panel": {
      "suggested_key": { "default": "Alt+Shift+K" },
      "description": "Open Kiroku Note side panel"
    }
  }
  ```
- `extension/background.js` — add listener:
  ```js
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'open-side-panel') {
      // tab is provided by the command callback; use tab.windowId directly
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
  });
  ```

**Constraints:** `chrome.sidePanel.open()` is MV3 API — verify it is already listed in
`manifest.json` `permissions`. Do not add new permissions beyond what is required.

---

## T2-C: Verb Metadata in Anki Card HTML

**What:** `VerbMetadata` (ichidan/godan, 自動詞/他動詞) is fully computed in `EnrichedTerm` and
shown in the hero badges. It is NOT included in the generated Anki card Back HTML. Add it.

**Why:** The transitivity label (他動詞 / 自動詞 / 自他動詞) is critical SRS information for verbs.

**Files:**
- `backend/app/services/anki_formatter.py` — in `format_basic_back()`, after the POS badges block,
  add a conditional block: if `card.verb_metadata` and `card.verb_metadata.is_verb`, render:
  `<span class="kn-pos kn-verb-type">{verb_type}</span>` and
  `<span class="kn-pos kn-transitivity">{transitivity_label}</span>`.
- `backend/app/schemas.py` — verify `SaveCardRequest` / `SaveCardResponse` pass `verb_metadata`
  through. If not, add `verb_metadata: VerbMetadataSchema | None = None` where missing.
- `backend/app/services/anki_connect.py` — locate the function that maps a saved card to Anki
  note fields (search for calls to `anki_formatter`). Forward `verb_metadata` from the card
  record to the formatter call. Do not assume the function name `map_card_to_fields` — verify
  the actual name before editing.
- Add a Card Settings toggle `#setting-show-verb-type` (default: `true`) following the existing
  `show_jlpt` toggle pattern in `sidepanel.html` and `sidepanel.js`.

**Test:** Add cases to `backend/tests/test_anki_formatter.py` covering verb + non-verb cards,
transitive vs intransitive, and the toggle disabled state.

---

## T2-D: TTS Pronunciation Button

**What:** Add a small speaker icon button (🔊) in the hero showcase next to the expression.
Clicking it calls `window.speechSynthesis` with `lang: 'ja-JP'` for the current expression text.

**Why:** Zero external dependencies. Useful when no audio has been captured yet. Gives instant
pronunciation feedback.

**Files:**
- `extension/sidepanel/sidepanel.html` — add `<button id="btn-tts-play" aria-label="Play pronunciation">` 
  with an inline SVG speaker icon in the hero showcase section near `#expression`.
- `extension/sidepanel/sidepanel.js` — wire click handler:
  ```js
  btnTtsPlay.addEventListener('click', () => {
    const utt = new SpeechSynthesisUtterance(fieldExpression.value);
    utt.lang = 'ja-JP';
    window.speechSynthesis.speak(utt);
  });
  ```
- `extension/sidepanel/sidepanel.css` — style `#btn-tts-play` as a small ghost icon button using
  existing token `var(--text-muted)` with `var(--accent-primary)` hover.

**Constraints:** Hide the button when `fieldExpression.value` is empty. Do not add audio recording
or TTS caching — this is purely playback of the current expression value.

---

## T2-E: OCR Confidence Badge

**What:** After OCR capture, show the confidence score as a subtle badge (e.g. `92%`) next to
`#field-expression`. For confidence < 75%, use an orange warning style.

**Why:** OCR quality varies. The badge tells users when to manually verify/correct the text.

**Implementation notes:**
- `manga-ocr` does not natively return a confidence score, but the pipeline can be extended.
  Check the OCR daemon server file inside the `ocr/` directory (the server that handles
  `POST /recognize` requests from `OcrService`) — if `MangaOcr` returns logits or probability,
  extract max softmax as a confidence proxy. If not available, mark this feature "Not Implemented
  — model does not expose per-token confidence" in PROGRESS.md and skip.
- If confidence IS available: add `confidence: float` to `OcrRecognizeResponse` schema and
  `backend/app/schemas.py`, pass it through `OcrService`, return it in `/api/ocr/recognize`.
- Extension: in `handleOcrCropProcess()` in `sidepanel.js`, after populating `#field-expression`,
  show/hide a `#ocr-confidence-badge` element with the value.

**Constraint:** If `manga-ocr` does not expose confidence, document this as "Not Implemented —
model does not expose per-token confidence" in PROGRESS.md and skip.

---

## T2-F: CSV / TSV Export from History

**What:** Add an "Export" button in the History header that downloads all visible (filtered) cards
as a CSV file with columns: `expression, reading, meaning, jlpt_level, deck, sync_status, created_at`.

**Why:** Local backup, migration, study sharing. Entirely offline. Does not touch Anki or SQLite
beyond a read query.

**Files:**
- `backend/app/main.py` — add `GET /api/cards/export` accepting optional `deck` and `status`
  query params, returning `text/csv` content-type response with all matching cards.
- `extension/sidepanel/sidepanel.html` — add `<button id="btn-export-cards">Export CSV</button>`
  in the History header row next to Sync All.
- `extension/sidepanel/sidepanel.js` — on click, call `/api/cards/export?deck=...&status=...`
  and trigger a browser download via `URL.createObjectURL(new Blob([csvText], { type: 'text/csv' }))`.

**Test:** Add `backend/tests/test_cards_export.py` covering empty, filtered, and full exports.

---

## T2-G: Backend Unified Health Endpoint

**What:** Add `GET /api/health` returning a single structured JSON object:
`{ "status": "ok", "version": str, "yomitan": bool, "ankiconnect": bool, "ocr": bool, "db": bool }`.
The `version` value must be read dynamically from `backend/app/config.py` (or wherever the
current version string is defined) — never hardcode a version number in the endpoint.

**Why:** The extension currently makes 3-4 separate status checks on startup (Yomitan, AnkiConnect,
OCR each separately). A single health call reduces startup latency and eliminates race conditions.

**Files:**
- `backend/app/main.py` — add the `GET /api/health` route. Reuse existing `YomitanService`,
  `AnkiConnectService`, and `OcrService` availability checks already implemented.
- `backend/app/schemas.py` — add `HealthResponse` Pydantic schema.
- `extension/sidepanel/sidepanel.js` — in the startup initialization sequence, replace the
  sequential individual status checks with a single `fetch('/api/health')` call. Parse the
  single response and update all 3 indicator dots at once.

**Constraint:** The existing individual check endpoints (`/api/ocr/status`, etc.) must remain
intact for backward compatibility. The health endpoint is additive.

---

## T2-H: Clipboard Auto-Capture

**What:** When the Side Panel receives focus, check the clipboard for Japanese text. If found,
offer a one-click "Capture from clipboard" suggestion bar at the top of the Text mining view.

**Why:** Users frequently copy Japanese text from PDFs, apps, or translators that Kiroku's
content script cannot reach. This is a major friction point for those sources.

**Files:**
- `extension/sidepanel/sidepanel.js` — listen for panel focus using both
  `window.addEventListener('focus', ...)` and `document.addEventListener('visibilitychange', ...)`
  (use `visibilitychange` as the primary trigger in MV3 side panels — `focus` is not reliably
  fired in all Chromium builds for side panels). On trigger, call `navigator.clipboard.readText()`
  and check if the result contains Japanese characters (`/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)`).
- If Japanese text is detected, show `#clipboard-suggestion-bar` (new element in HTML):
  `"Clipboard: 意味する — Capture? [Yes] [Dismiss]"`.
- On "Yes" click: call `identify(clipboardText)` directly.
- `extension/sidepanel/sidepanel.html` — add `<div id="clipboard-suggestion-bar" hidden>` near
  the top of `#text-mining-view`.

**Constraints:** Only read clipboard on panel becoming visible — do not poll. Dismiss automatically
if user starts typing or selects text on the page. Requires `"clipboardRead"` permission in
`manifest.json` — check if already declared before adding it.

---

## T2-I: Auto-Sync on AnkiConnect Reconnect

**What:** When the AnkiConnect status transitions from offline → online (detected during the
existing periodic polling), automatically trigger a background Sync All for `pending` cards —
without requiring the user to click anything.

**Why:** Users forget to sync after reopening Anki. The tool should handle this silently.

**Files:**
- `extension/sidepanel/sidepanel.js` — in `checkAnkiStatus()`, track the previous status in a
  module-level variable `let prevAnkiStatus = false`. When `prevAnkiStatus === false` and the
  new status is `true`, call `triggerSyncAll({ silent: true })` — a flag to suppress the UI
  progress modal for the auto-sync case (but still update card statuses after).

**Constraints:** Only trigger if there are `pending` cards (check count before calling). Do not
trigger during an active manual Sync All. Do not trigger on initial panel open.

---

## T2-J: Sort History List

**What:** Add a sort dropdown in the History header: `Date mined ↓ | Date mined ↑ | JLPT level |
Deck name | Sync status`.

**Why:** 213 cards in insertion order is not useful for reviewing what to study next.

**Files:**
- `extension/sidepanel/sidepanel.html` — add `<select id="history-sort-select">` in the History
  header row.
- `extension/sidepanel/sidepanel.js` — in `renderHistory()`, sort the fetched card array before
  rendering based on the selected sort key. Persist sort preference in `chrome.storage.local`.
- Backend: `GET /api/cards` already supports `limit` and `offset`. Add optional `sort` and
  `order` query params in `backend/app/main.py` and `CardRepository.get_cards()`. Alternatively
  sort client-side for simplicity (acceptable for < 500 cards).

---

## T2-K: POS Tag Display Fix + Dictionary View Declutter

### Part A — POS Tag Accuracy Fix

**What:** The hero badge and dictionary tag system currently misclassifies some words:
- **です (desu)** shows `verb` — it is a copula/auxiliary, not a content verb.
- **明日 (ashita)** shows `verb` — it is a noun/adverb; there is no verbal usage.
- **意味 (imi)** shows `verb · suru` — it is primarily a **noun**; suru-compound is secondary.

**Root cause:** `verb_metadata.py`'s `parse_verb_metadata()` is too aggressive — it fires on any
entry that has a `suru` POS tag (including suru-nouns like 意味) and on auxiliary verbs like
desu. The hero badge renderer then displays `verb` as the primary POS without checking whether
`noun` is the dominant/first listed tag.

**Fix (backend — `backend/app/services/verb_metadata.py`):**
- `is_verb` must only be `True` when the entry's **primary sense** has an explicit verb conjugation
  class (`1-dan`, `5-dan`, `kuru`, `suru-verb` — distinct from `suru` as an inflection marker on nouns).
- Add a guard: if tags contain `noun` or `adverb` AND the only verb marker is `suru` used as an
  inflection suffix (not `vs` / `vt` / `vi`), set `is_verb = False` and `verb_type = None`.
- Copula tokens (`cop`, `aux`, `aux-verb`) when attached to です-like entries: set `is_verb = False`;
  surface as `aux` or omit the verb badge entirely.

**Fix (frontend — `extension/sidepanel/sidepanel.js` `updateHeroBadges()`):**
- Priority order for the POS badge: `noun` > `adverb` > `verb` > `aux`.
  If `noun` is in the POS list, show `noun` (add `· suru` suffix only if `is_verb` is also true).
- Never show `verb` alone for a word whose Yomitan POS list starts with `noun`.

**Test:** Add cases to `backend/tests/test_verb_metadata.py` for: です, 明日, 意味, する (should
be verb), 食べる (should be verb), 元気 (noun — should NOT be verb despite `suru` in Jitendex tags).

---

### Part B — Dictionary View Declutter

**What:** The dictionary view (screenshot 1) is visually noisy. Specific problems:
1. The POS tag pills (`adverb`, `to-adverb`, `suru`, `kana`, `mimetic`) repeat per sense even
   when all senses share the same tags — they should appear once at the entry level.
2. Sub-bullet sense lists (① ■ tightly, ■ firmly, ■ securely) use dense nested bullets that
   make scanning harder.
3. The `+31 more dicts` badge draws the eye but provides no actionable interaction in most cases.

**Fix — CSS only (no JS change for items 1-2):**
- `extension/sidepanel/sidepanel.css` — reduce font size of repeated POS tag pills from the
  current size to `11px` and mute their color to `var(--text-faint)` when they appear inside a
  sense block (not at entry level). Use selector `.dict-sense-tags .kn-pos { font-size: 11px; opacity: 0.6; }`.
- Reduce `line-height` and margin on sub-bullet `■` items inside senses (`.dict-sense-gloss-list li`)
  to `1.3` and `margin: 0` to tighten the vertical rhythm.
- Cap the `+N more dicts` badge opacity to `0.5` and reduce font size to `11px` — it is secondary
  information: `.dict-extra-dicts-badge { opacity: 0.5; font-size: 11px; }`.

**Constraints:** Do not change the underlying data. These are purely visual density adjustments.
Verify readability on the しっかり screenshot as a test case after applying.

---


---

## T3-A: Smart Save Shortcut (Save + Queue Sync in One Action)

**What:** A keyboard shortcut `Alt+Enter` (when focus is in the Side Panel) that performs:
1. `POST /api/cards/save` — same as clicking Save
2. Immediately follows with `POST /api/anki/sync` for that card ID

This collapses the two-step Save → Send to Anki into a single action.

**Why:** Directly reduces the mining cycle. The 10-second target depends on low-action paths.

**Files:**
- `extension/sidepanel/sidepanel.js` — add a `keydown` listener on the side panel document for
  `Alt+Enter` (guard: `!event.target.matches('textarea, input[type=text]')` to avoid conflicts).
  The handler calls the existing `saveCard()` and chains `.then(() => triggerAnkiSync())` using
  the returned `card_id`.
- `extension/sidepanel/sidepanel.html` — update the Save button tooltip to show `Alt+Enter`.

**Constraints:** This must respect the SQLite-first invariant — save MUST complete before sync
begins. Use Promise chaining, not parallel calls. If save fails, do not attempt sync.

---

## Tier3 - B is removed coz of redundancy ignore the T3-B

---

## T3-C: Undo Last Card Delete (Soft Delete)

**What:** After clicking the `×` delete button on a history card, instead of immediately deleting
from SQLite, show a 5-second "Undo" toast. If the user clicks Undo, restore the card. After 5
seconds without undo, the delete commits.

**Why:** Accidental deletion is irreversible and frustrating. The 5-second window costs nothing.

**Implementation approach:**
- **Option A (simpler):** Client-side undo only. Remove the card from the UI immediately, store
  the card object in memory, and start a 5-second timer. On Undo: re-add to UI and call
  `POST /api/cards/save` to re-create it. On timer expiry: call `DELETE /api/cards/{id}`.
  This is simple but requires a "re-save" roundtrip.
- **Option B (cleaner):** Add a `deleted_at` timestamp column to SQLite. `DELETE` in the API
  sets `deleted_at = now()` and excludes these from `GET /api/cards`. A background job (or
  startup cleanup in `init_db()`) purges rows where `deleted_at` is older than 10 minutes.
  The "Undo" action calls a new `POST /api/cards/{id}/restore` endpoint that clears `deleted_at`.

**Recommended:** Option A for now (no schema migration). Document Option B as the upgrade path.

**Files (Option A):**
- `extension/sidepanel/sidepanel.js` — refactor `deleteCard()` to use a deferred commit pattern
  with a toast and `clearTimeout` on Undo click.
- `extension/sidepanel/sidepanel.html` — add `<div id="undo-toast" hidden>` toast element.

---

## T3-D is removed : redundant 

## T3-E: Example Sentence Selector (1 of N)

**What:** When a dictionary entry has multiple example sentences, show a `◀ 1/3 ▶` stepper
instead of displaying only the first example. The stepper cycles through all available examples.

**Why:** Auto-selected examples are often archaic or formal. Users should pick the most natural one.

**Files:**
- `extension/sidepanel/sidepanel.js` — in the Reference View sense renderer, detect if
  `sense.examples.length > 1`. If so, render the sentence block with navigation buttons and
  track `currentExampleIndex` per sense (store in a `Map<senseId, index>`).
- Each stepper button click: update `currentExampleIndex`, re-render just the example block.
- The "Insert to Sentence" button (T1-E) should always use the currently displayed example.

---

## T3-F: Mining Stats Dashboard

**What:** A small stats panel inside the History tab, collapsed by default, showing:
- Cards mined today / this week / all-time
- Sync ratio (synced vs pending vs failed)
- JLPT level breakdown (horizontal bar chart: N5 / N4 / N3 / N2 / N1 / Unknown)
- Top 3 decks by card count

**Why:** Motivation, habit formation, and understanding your own mining patterns.

**Implementation:**
- `backend/app/main.py` — add `GET /api/cards/stats` returning aggregated counts. SQL queries
  using `GROUP BY`, `COUNT(*)`, `DATE(created_at)`. No new columns needed.
- `backend/app/schemas.py` — `CardStatsResponse` with nested counts.
- `extension/sidepanel/sidepanel.html` — add `<details id="history-stats-details">` at the top
  of `#history-section` with a summary `"Stats ▸"`.
- `extension/sidepanel/sidepanel.js` — fetch stats on expand, render using inline SVG bar charts
  (vanilla, no charting library). Cache result for 30 seconds to avoid re-fetching on every toggle.

**Test:** `backend/tests/test_cards_stats.py` covering empty database, single-deck, multi-deck,
and JLPT distribution scenarios.

---

## T3-G: Per-Deck Card Template Profiles

**What:** Allow different Card Settings (Show JLPT, Show furigana, Show hint, Show verb type)
to be saved per Anki deck. Switching decks in the editor auto-loads that deck's settings profile.

**Why:** A JLPT N3 study deck and an anime sentence mining deck need completely different card
styles. Currently one setting applies globally.

**Files:**
- `extension/sidepanel/sidepanel.js` — change `STORAGE_KEY_CARD_TEMPLATE_SETTINGS` from a flat
  object to a keyed object: `{ "Default": { show_jlpt: true, ... }, "N3 vocabs": { ... } }`.
- On `change` event of `fieldDeckSelect`, call `loadDeckTemplateSettings(deckName)` which reads
  the stored profile for that deck (falling back to global defaults if no profile exists).
- In the Settings popover, add a `"Save as default for this deck"` button that writes the current
  settings under the current deck key.

**Constraints:** No backend changes needed. Purely `chrome.storage.local`.

---

## T3-H: Furigana Density Control

**What:** A toggle in Card Settings: `Furigana: All kanji | Advanced-only (N3+) | None`.
Advanced-only mode suppresses ruby markup on N4/N5 kanji (common kanji advanced learners know).

**Why:** Furigana on 食べる or 見る is noise for N3+ learners. Too much furigana trains reading-bypass.

**Files:**
- `backend/app/services/anki_formatter.py` — in `format_basic_back()` and `format_kanji_html()`,
  accept a `furigana_mode: str` parameter. In `ruby_html()` helper, look up the kanji JLPT level
  using `JlptReferenceService.lookup_kanji(char)`. If level is N4 or N5 and mode is
  `"advanced_only"`, return the plain kanji without `<ruby>` tags.
- `backend/app/services/anki_connect.py` — pass `furigana_mode` from `card_settings` to formatter.
- `extension/sidepanel/sidepanel.html` — add `<select id="setting-furigana-mode">` with the 3
  options in the Card Settings popover.
- Update `renderCardPreviewDOM()` in `sidepanel.js` to apply the same logic client-side for live preview.

---

## T3-I: Source Attribution on Cards

**What:** Store and display where and when a card was mined: source type (Text / Video / OCR /
Quick Add), source URL or page title, and timestamp.

**Why:** Context helps memory. Knowing "I mined this from Demon Slayer ep 3" improves retention.
Also useful for auditing your card quality later.

**Backend:**
- `backend/app/schemas.py` — add `source_type: str | None` and `source_url: str | None` to
  `SaveCardRequest`. First verify whether these fields already exist in the schema and SQLite
  table before adding them — do not duplicate existing columns.
- `backend/app/repositories/card_repository.py` — add `source_type` and `source_url` columns
  if missing (migration with `ALTER TABLE` guarded by column existence check).

**Frontend:**
- `extension/sidepanel/sidepanel.js` — in `identify()`, when sending `POST /api/cards/save`,
  include `source_type: currentMiningTab` and `source_url: document.URL` from the active tab
  (via `chrome.tabs.query`).
- History view: show a small source icon (📄 text / 🎬 video / 🔲 OCR) and the source domain.

---

## T3-J: Bulk Sync Feedback — Per-Card Status Stream

**What:** During "Sync All", show a live scrolling status list of cards being synced, with a ✓
or ✗ per card as each resolves, instead of only a final summary count.

**Why:** With 213 cards, Sync All is a black box. Users can't tell if it's stuck or progressing.

**Files:**
- `extension/sidepanel/sidepanel.js` — the existing Sync All calls `POST /api/cards/sync-all`.
  Change the implementation to sync cards individually in a loop (or use Server-Sent Events if
  the backend supports it). After each card: append a status row to a `<ul id="sync-progress-list">`.
- Alternative (simpler): The backend `sync-all` response already returns itemized results. Render
  the result array as a scrollable list after completion instead of just the count summary.

---

---

# TIER 4 — Complex

---

## T4-A: History Multi-Select & Bulk Operations

**What:** Checkboxes on each history card row for multi-select. A bulk action bar appears when
any are selected, with actions: Delete selected, Move to deck (re-save with new deck), Sync selected.

**Why:** Managing 200+ cards one-by-one is impractical. Bulk operations are standard in any card library.

**Files:**
- `extension/sidepanel/sidepanel.html` — add `<input type="checkbox" class="history-select-cb">` in each card row.
- `extension/sidepanel/sidepanel.js` — track selected card IDs in `Set<string>`. Show/hide
  `#bulk-action-bar` based on selection state. Wire bulk action buttons.
- `backend/app/main.py` — add `DELETE /api/cards/bulk` accepting `{ card_ids: [string] }` and
  `POST /api/cards/bulk-sync` accepting a list of card IDs.
- `backend/app/repositories/card_repository.py` — add `delete_many(ids)` and `get_many(ids)` methods.

**Test:** Backend tests for bulk delete and bulk sync. Extension tests for selection state management.

---

## T4-B: Subtitle In-Track Search / Jump

**What:** A search input in the Video tab that lets users type a word/phrase and jump the video
to the first subtitle cue containing it. Results show a list of timestamps with the cue text.

**Why:** Users know a specific word appears in an episode. This lets them find and mine it
directly without scrubbing the full video.

**Files:**
- `extension/sidepanel/sidepanel.html` — add `<input id="subtitle-search-input">` and
  `<ul id="subtitle-search-results">` in the Video tab.
- `extension/sidepanel/sidepanel.js` — on input change (debounced 300ms), filter the loaded
  subtitle cue array for cues whose text includes the search term. Render matching cues as
  timestamp + text rows. On row click: `chrome.tabs.sendMessage(tabId, { type: 'SEEK_TO', ms: cue.startMs })`.
- `extension/content/video-mining-poc.js` — add handler for `SEEK_TO` message that sets
  `video.currentTime = ms / 1000` (this is user-initiated, exempt from playback invariants).

---

## T4-C: Subtitle History Hover Panel (Last 5 Cues)

**What:** In the Video tab, show a list of the 5 most recently played subtitle cues. Each row
shows the cue text and is hoverable/clickable to mine words from it.

**Why:** Users frequently miss a word in a fast-paced subtitle and realize it a few seconds later.
Retroactive mining from recent cues is highly valuable.

**Files:**
- `extension/content/video-mining-poc.js` — maintain a `recentCues = []` circular buffer (max 5).
  On each `SUBTITLE_CUE_CHANGED` event, prepend the cue to the buffer and send
  `{ type: 'RECENT_CUES_UPDATED', cues: recentCues }` to the side panel.
- `extension/sidepanel/sidepanel.js` — listen for `RECENT_CUES_UPDATED` and re-render
  `#recent-cues-list`. Each row: hoverable Japanese text that calls `identify(word)` on click.
- `extension/sidepanel/sidepanel.html` — add `<div id="recent-cues-section">` in `#video-mining-view`.

---

## T4-D: OCR Region Re-use ("Re-scan" Button)

**What:** After an OCR capture populates the Expression field, store the last OCR region
coordinates. Show a `↺ Re-scan` button that fires another OCR request using the same region
without making the user drag a new selection box.

**Why:** OCR is imperfect. Quick retry is a frequent action, especially on stylized manga fonts.

**Files:**
- `extension/sidepanel/sidepanel.js` — after a successful OCR crop in `handleOcrCropProcess()`,
  store `lastOcrBounds = { left, top, width, height, devicePixelRatio }` in a module variable.
- `extension/sidepanel/sidepanel.html` — add `<button id="btn-ocr-rescan" hidden>↺ Re-scan</button>`
  near `#field-expression`.
- On `#btn-ocr-rescan` click: send `OCR_REGION_SELECTED` message to background with
  `lastOcrBounds`, triggering `chrome.tabs.captureVisibleTab` + crop + recognize pipeline again.
- Show the button only when `lastOcrBounds !== null`. Clear when user starts a new OCR selection.

---

## T4-E: Stroke Order Diagrams (KanjiVG)

**What:** The card preview and Anki output already show individual kanji breakdown cards for each
kanji in a compound (e.g. 意 and 味 are rendered as separate breakdown blocks showing onyomi,
kunyomi, meaning, stroke count, and grade). Add a KanjiVG stroke order SVG diagram to each
existing kanji breakdown block.

**Why:** The stroke count is already displayed ("13 strokes") but with no visual. The breakdown
cards are the perfect insertion point — no new UI section needed.

**Implementation:**
- Download the KanjiVG dataset from https://github.com/KanjiVG/kanjivg (CC BY-SA 3.0).
  SVG files are named by Unicode codepoint e.g. `05610.svg` for 意 (U+610F → `0610f.svg`).
- Bundle a curated subset (~2,000 most frequent kanji by KANJIDIC frequency rank — already
  present in the existing kanji data) as a SQLite table or compact JSON in `backend/app/data/`.
  Do NOT bundle all 6,400 SVGs in the extension (CSP and size constraints).
- `backend/app/main.py` — add `GET /api/kanji/strokes/{character}` returning the SVG string.
  Cache responses in memory (LRU, max 500 entries) since the same kanji are requested repeatedly.
- `extension/sidepanel/sidepanel.js` — in the function that renders individual kanji breakdown
  blocks (search for where `KANJIDIC`, `onyomi`, or `stroke` data is rendered to DOM), after the
  stroke count badge, fetch `/api/kanji/strokes/{char}` and inject the returned SVG inline.
  Use a per-character in-memory cache (`Map<char, svgString>`) to avoid duplicate fetches within
  the same session.
- `extension/sidepanel/sidepanel.css` — `.stroke-order-svg { width: 56px; height: 56px;
  opacity: 0.85; }` `.stroke-order-svg path { stroke: var(--accent-reading); fill: none; }`

**Data preparation script:** Write a one-time Python script `backend/scripts/import_kanjivg.py`
that reads KanjiVG SVG files, strips animation metadata, and inserts cleaned SVG strings into
the data store keyed by character Unicode codepoint.

**Anki card output:** Also embed the stroke SVG in the kanji breakdown section of the Anki card
HTML via `anki_formatter.py`. The SVG must be self-contained with inline `style` (no external
CSS class references — Anki strips class-based CSS from card HTML).

**Constraint:** Add proper attribution in `README.md` and `backend/app/data/KANJIVG_NOTICE.md`.
License: **CC BY-SA 3.0** — must be declared. Do not claim MIT anywhere.

---


---

## T4-F: Sentence-Level Mining from Subtitle Cue

**What:** A "Mine full sentence" button in the Video tab active cue preview that sends the entire
current subtitle cue text directly into `identify()` with the full cue pre-filled as the
example sentence field.

**Why:** Currently: hover word → card draft → manually paste sentence from cue preview. This
collapses it to one click.

**Files:**
- `extension/sidepanel/sidepanel.html` — add `<button id="btn-mine-full-sentence">Mine sentence</button>`
  in `#video-mining-view` next to the cue preview.
- `extension/sidepanel/sidepanel.js` — on click: take `currentVideoCueText`, call
  `identify(mostProminentWord)` (use simple heuristic: longest kanji compound in the cue), and
  pre-fill `fieldExampleSentence.value = currentVideoCueText`.
- The "most prominent word" heuristic: split on `Intl.Segmenter` word boundaries, pick the
  longest segment that is not pure punctuation or kana.

---

---

# TIER 5 — LLM Integration (Separate Section)

---

## LLM Overview

LLM integration is **entirely optional**. The full mining pipeline must function without it.
The LLM is a companion assistant, not a dictionary replacement.

**Primary use cases:**
1. Translate a full Japanese sentence or OCR-captured paragraph to English
2. Explain which dictionary sense fits the current sentence context
3. Explain a grammar pattern in a captured sentence
4. Generate a mnemonic for the current word

**Prohibited uses** (do not implement):
- Replacing Yomitan for readings, JLPT, or dictionary lookup (LLMs hallucinate these)
- Generating audio or pitch accent data
- Any feature that requires LLM to be available for the app to function

---

## Hardware Constraints (i7 9th gen, GTX 1650 4GB VRAM, 16GB RAM)

| Approach | VRAM needed | Speed | Quality | Cost |
|---|---|---|---|---|
| Groq API (Llama 3.1 8B) | 0 (cloud) | ✅ ~100 tok/s | ✅ Excellent | ✅ Free |
| Gemini Flash 2.0 API | 0 (cloud) | ✅ Fast | ✅ Excellent | ✅ Free (15 RPM) |
| Ollama `qwen2.5:1.5b` | ~1 GB | 🟡 ~20 tok/s | 🟡 Good for translation | ✅ Free |
| Ollama `gemma2:2b` | ~1.5 GB | 🟡 ~15 tok/s | 🟡 Decent | ✅ Free |
| Ollama `llama3.2:3b` | ~2 GB | 🟡 ~12 tok/s | ✅ Good | ✅ Free |
| Any 7B Q4 model (CPU only) | 0 VRAM, ~4 GB RAM | 🔴 ~3 tok/s | ✅ Good | ✅ Free |

**Recommendation:** Default to **Groq API** (free tier, no credit card, sign up at console.groq.com).
Offer **Ollama** as the offline/private fallback. The user configures which provider in Settings.

---

## LLM Architecture

```
Extension Side Panel
  └── POST /api/llm/ask
        └── LLMService (backend/app/services/llm_service.py)
              ├── GroqProvider
              ├── GeminiProvider
              ├── OllamaProvider (http://localhost:11434)
              └── NoneProvider (returns 501 — default when not configured)
```

**Key principle:** The extension NEVER calls any LLM API directly. All calls go through the
local FastAPI backend (`/api/llm/ask`). API keys are stored in backend config only — never in
`chrome.storage.local` or extension code.

---

## LLM Implementation Plan

### Step 1: Backend Service (`backend/app/services/llm_service.py`)

Create `LLMService` with a provider-pattern design:

```python
# backend/app/services/llm_service.py
from dataclasses import dataclass
from typing import Literal

LLMProvider = Literal["groq", "gemini", "ollama", "none"]

@dataclass
class LLMResponse:
    text: str
    provider: str
    model: str

class LLMService:
    def __init__(self, provider: LLMProvider, api_key: str | None, endpoint: str | None): ...
    
    async def ask(self, prompt: str, system: str | None = None) -> LLMResponse: ...
    
    def is_configured(self) -> bool: ...
```

Provider implementations use only Python standard library `urllib` (matching AnkiConnectService
pattern — zero new pip dependencies for Groq/Gemini since both have simple JSON REST APIs).

For Ollama: `POST http://localhost:11434/api/generate` with `{ model, prompt, stream: false }`.
For Groq: `POST https://api.groq.com/openai/v1/chat/completions` with Bearer token.
For Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`.

### Step 2: Configuration (`backend/app/config.py`)

Add to existing config resolution pattern:
```python
LLM_PROVIDER = os.environ.get("KIROKU_LLM_PROVIDER", "none")
LLM_API_KEY = os.environ.get("KIROKU_LLM_API_KEY", None)
LLM_OLLAMA_ENDPOINT = os.environ.get("KIROKU_OLLAMA_URL", "http://localhost:11434")
LLM_MODEL = os.environ.get("KIROKU_LLM_MODEL", None)  # auto-selects per provider if None
```

Default models per provider (used when `LLM_MODEL` is not set):
- Groq: `llama-3.1-8b-instant`
- Gemini: `gemini-2.0-flash`
- Ollama: `qwen2.5:1.5b`

### Step 3: API Endpoints (`backend/app/main.py`)

```
POST /api/llm/ask
  Body: { task: "translate" | "explain_sense" | "explain_grammar" | "mnemonic",
          text: str,                # the Japanese sentence / word
          context?: str,            # surrounding sentence for sense disambiguation
          word?: str }              # specific word being mined (for explain_sense)
  Returns: { result: str, provider: str, model: str } | { error: str, code: "not_configured" }
```

**Built-in system prompts per task (in the service, not the extension):**
- `translate`: `"Translate the following Japanese text to English naturally. Reply with only the translation."`
- `explain_sense`: `"The word '{word}' appears in this Japanese sentence: '{text}'. The dictionary gives these meanings: '{context}'. Which meaning best fits the sentence? Reply in one sentence."`
- `explain_grammar`: `"Explain the grammar pattern used in this Japanese sentence in simple English for a language learner: '{text}'"`
- `mnemonic`: `"Create a simple, memorable English mnemonic for remembering the Japanese word '{word}' which means '{context}'. Be creative and brief."`

### Step 4: Pydantic Schemas (`backend/app/schemas.py`)

```python
class LLMRequest(BaseModel):
    task: Literal["translate", "explain_sense", "explain_grammar", "mnemonic"]
    text: str
    context: str | None = None
    word: str | None = None

class LLMResponse(BaseModel):
    result: str
    provider: str
    model: str

class LLMStatusResponse(BaseModel):
    configured: bool
    provider: str
    model: str | None
```

Also add `GET /api/llm/status` so the extension can check if LLM is configured before showing the UI.

### Step 5: Extension Side Panel UI

**Settings popover — new "AI Assistant" section:**
```html
<div class="card-settings-group">
  <div class="settings-group-label">AI ASSISTANT</div>
  <div class="settings-row">
    <label>Provider</label>
    <select id="llm-provider-display" disabled>
      <!-- Read-only display of backend config — user sets env vars -->
    </select>
  </div>
  <div id="llm-status-label">Not configured</div>
  <a href="#" id="llm-setup-link">Setup guide</a>
</div>
```

Note: The API key is NEVER entered in the Side Panel. The Settings UI is read-only display
of the backend's configuration status. Users set `KIROKU_LLM_PROVIDER` and `KIROKU_LLM_API_KEY`
as environment variables (or via a future config file). This keeps keys out of extension storage.

**In the Text Mining / Card Editor view:**

Add a collapsible `<details id="llm-assist-section">` below the dictionary section (not in the
card editor — this is reference material, not card data):

```html
<details id="llm-assist-section">
  <summary>AI Assistant</summary>
  <div class="llm-actions-row">
    <button id="btn-llm-translate">Translate sentence</button>
    <button id="btn-llm-explain-sense">Best sense for context</button>
    <button id="btn-llm-grammar">Explain grammar</button>
    <button id="btn-llm-mnemonic">Memory hook</button>
  </div>
  <div id="llm-result-display" hidden></div>
  <div id="llm-loading-indicator" hidden>Thinking…</div>
</details>
```

Show `#llm-assist-section` only when `GET /api/llm/status` returns `configured: true`.

**JS wiring (`sidepanel.js`):**
```js
async function callLLM(task) {
  llmResultDisplay.hidden = true;
  llmLoadingIndicator.hidden = false;
  try {
    const resp = await fetch(`${BACKEND_BASE_URL}/api/llm/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task,
        text: fieldExampleSentence.value || fieldExpression.value,
        context: currentDictionaryMeaningSummary,
        word: fieldExpression.value
      })
    });
    const data = await resp.json();
    llmResultDisplay.textContent = data.result;
    llmResultDisplay.hidden = false;
  } catch (err) {
    llmResultDisplay.textContent = 'AI assistant unavailable.';
    llmResultDisplay.hidden = false;
  } finally {
    llmLoadingIndicator.hidden = true;
  }
}
```

The LLM result is **display-only reference material**. It is never automatically inserted into
card fields. Users may manually copy text from `#llm-result-display` if they want it on their card.

### Step 6: Setup Guide for Users

Add `docs/llm-setup.md` explaining:
1. Sign up at console.groq.com (free, no credit card)
2. Create API key
3. Set environment variable: `KIROKU_LLM_PROVIDER=groq` and `KIROKU_LLM_API_KEY=gsk_...`
4. Restart Kiroku backend
5. Verify: green "AI: Groq (llama-3.1-8b)" label appears in Settings

For Ollama offline setup:
1. Install Ollama from ollama.com (free)
2. Run: `ollama pull qwen2.5:1.5b` (downloads ~1GB)
3. Set: `KIROKU_LLM_PROVIDER=ollama` (no API key needed)
4. Restart Kiroku backend

### Step 7: Tests

- `backend/tests/test_llm_service.py`:
  - Provider `none` returns 501 gracefully
  - `GroqProvider` with mocked `urllib` response parses correctly
  - `OllamaProvider` with mocked response parses correctly
  - Invalid task returns 400
  - Empty text returns 422 (validation)
  - Timeout handled gracefully (5s timeout on all providers)

---

## LLM Priority

| Sub-feature | Dependency | Priority |
|---|---|---|
| `LLMService` + `/api/llm/ask` backend | Nothing | Implement first |
| `/api/llm/status` endpoint | `LLMService` | With backend |
| Settings status display | Status endpoint | After backend |
| Translate sentence button | All of above | After settings |
| Explain sense / grammar / mnemonic | Translate done | After translate |

---

---

# Summary Priority Matrix

| ID | Feature | Tier | Impact | Effort |
|---|---|---|---|---|
| T1-A | Status dot tooltips | 1 | Medium | Trivial |
| T1-B | History progress bar label | 1 | Medium | Trivial |
| T1-C | Empty state illustrations | 1 | Medium | Trivial |
| T1-D | Dictionary forms table — hide blank rows | 1 | High | Trivial |
| T1-E | "Insert to Sentence" button | 1 | High | Trivial |
| T2-A | JLPT pill in history rows | 2 | High | Low |
| T2-B | Keyboard shortcut to open panel | 2 | High | Low |
| T2-C | Verb metadata in Anki card | 2 | High | Low |
| T2-D | TTS pronunciation button | 2 | Medium | Low |
| T2-E | OCR confidence badge | 2 | Medium | Low |
| T2-F | CSV/TSV export | 2 | Medium | Low |
| T2-G | Unified health endpoint | 2 | Medium | Low |
| T2-H | Clipboard auto-capture | 2 | High | Low |
| T2-I | Auto-sync on AnkiConnect restore | 2 | High | Low |
| T2-J | Sort history list | 2 | Medium | Low |
| T2-K | POS tag fix + dictionary declutter | 2 | High | Low |
| T3-A | Smart Save shortcut (Alt+Enter) | 3 | High | Medium |
| T3-B | Replay last cue shortcut (R) | 3 | High | Medium |
| T3-C | Undo card delete | 3 | High | Medium |
| T3-D | Pitch accent visual diagram | 3 | High | Medium |
| T3-E | Example sentence selector | 3 | High | Medium |
| T3-F | Mining stats dashboard | 3 | Medium | Medium |
| T3-G | Per-deck template profiles | 3 | Medium | Medium |
| T3-H | Furigana density control | 3 | Medium | Medium |
| T3-I | Source attribution on cards | 3 | Medium | Medium |
| T3-J | Bulk sync feedback stream | 3 | Medium | Medium |
| T4-A | History multi-select & bulk ops | 4 | High | High |
| T4-B | Subtitle in-track search/jump | 4 | High | High |
| T4-C | Subtitle history hover panel | 4 | Medium | High |
| T4-D | OCR region re-use button | 4 | Medium | High |
| T4-E | Stroke order diagrams (KanjiVG) | 4 | Medium | High |
| T4-F | Sentence-level subtitle mining | 4 | High | High |
| LLM | Full LLM integration | 5 | High | High |
