# Kiroku Note — Agent Implementation Plan (Revision 2)

**Scope:** Tokenization, grammar analysis, local dictionary independence, API security, Electron reliability, desktop information architecture, repository hygiene, asset licensing, and performance.

**Repository reviewed:** `Rhythm-Kachhwaha/kiroku-note`, `main` at `7b419f8` (review snapshot dated 3 Nov 2026). The uploaded review was exercised in a sandbox; this plan preserves its findings and implementation intent while incorporating the owner's decisions below.

**Explicit owner decisions**

1. **Sudachi dictionary size:** R1's gold-corpus benchmark decides `small` versus `core`. Do not decide by intuition and do not make Core an optional download by default. If Core proves necessary, present its measured install/storage cost and propose packaging options before changing the distribution model.
2. **Local API security:** Proceed with the three-stage rollout described in R7. Preserve rollback switches and avoid breaking the desktop/extension contract during migration.
3. **Mascot assets:** The Muza cat `.riv` came from the Rive marketplace and the Lottie cats came from LottieFiles / Lottie marketplace. This identifies the source platform, not the exact licence. Audit the specific asset pages, purchase/download records and terms. Do not assume that attribution alone grants redistribution rights.
4. **Gold corpus review:** The agent should prepare approximately 150 expected-answer cases in a reviewable format. The owner will use ChatGPT to review the expected answers. Do not treat generated labels as ground truth until reviewed.
5. **Dictionary architecture:** Remove runtime Yomitan API calls. Kiroku's own local dictionary becomes the vocabulary/kanji lookup source. Yomitan is no longer a required service or runtime dependency. SudachiPy supplies local sentence tokenization and morphology; it is not a dictionary replacement. Do not preserve a hidden Yomitan fallback.
6. **Electron EPIPE:** Fix the intermittent main-process crash caused by a timer callback calling `console.log` after the stdout pipe has closed. The exact reported stack points to `desktop/src/main.js:460` in the user's checkout; verify the current line and call site before editing.

**Evidence labels from the supplied review:** `[RAN]` executed in its sandbox; `[READ]` read from code; `[CHECK]` needs verification on the owner's Windows/Electron environment or against exact upstream asset records. These labels describe the review's evidence, not a guarantee that the current checkout has not changed since the reviewed commit.

---

## 0. Mandatory agent execution rules

Read `AGENTS.md`, then `IGNORE.md`, then only the relevant map and files named by the active slice. The repository already specifies one requested slice per task, targeted tests only, a small file budget, and one commit per slice. Follow those rules.

- Implement **one slice per agent task**. Do not silently continue into the next slice.
- Before changing code, inspect the current implementation and confirm the review finding still exists at the current HEAD. If it has already been fixed, report evidence and do not re-implement it.
- Keep each slice to approximately six changed files unless a clear dependency requires more. Split work rather than expanding a card.
- Run only the named/affected tests. Do not run full backend, desktop, or extension suites unless the owner explicitly authorizes it. Ask before a full backend suite.
- Commit each completed slice separately. Use `type(scope): description (R#)` and include a one-line test command/result in the commit body.
- Do not commit databases, user study data, media, backups, generated builds, credentials, or secrets.
- Do not change FINAL UI: the Bottom Dock/sliding pill and Kanji Mastery. Do not change Dock markup, layout, colors, geometry, timing, item count, or animation. No new Dock items. New screens/flows must be reached from existing screens.
- Preserve Kiroku's current visual language and tokens. No redesign, no gradients, no emoji in UI/logs/docs/code. Reuse existing `--ease-*` tokens and honor reduced motion. Do not remove animations as a performance shortcut.
- Keep SQLite as the local source of truth. AnkiConnect remains optional and must never become the source of truth.
- Do not introduce a Yomitan API fallback. Local dictionary + local tokenizer is the intended architecture.
- Do not invent dictionary definitions, JLPT labels, grammar answers, or gold expected answers. Flag uncertain cases for owner review.
- Stop and report if a change touches an unapproved FINAL component, risks user data, requires a breaking migration, or exceeds the slice scope.
- Final agent report: **at most 8 lines** — files changed, behavior, tests and results, manual checks still needed, open risks.

### Required implementation workflow

1. Read the task card and required repository instructions.
2. Confirm current code and tests still match the finding.
3. State the intended minimal change and acceptance checks.
4. Implement only the slice.
5. Run the exact targeted tests; add regression tests for the defect.
6. Inspect the diff for scope creep, data loss, secrets, and FINAL UI changes.
7. Commit with the slice ID and report the result.

---

## 1. Architecture decisions

### 1.1 Local dictionary and tokenizer are separate components

Kiroku already has a provider seam in `backend/app/services/dictionary_provider.py`, including `LocalDictionaryProvider` wrapping `kiroku_dictionary` and `YomitanHttpProvider`. The current local provider supports word/phrase lookup, term payloads, kanji payloads, and dictionary availability, but its `tokenize_with_inflection()` intentionally returns an empty list. Its own docstring says it cannot tokenize sentences.

Target architecture:

- **Dictionary lookup:** Kiroku's own local SQLite dictionary (`kiroku_dictionary` / `kiroku_dict.sqlite`) for word and kanji details.
- **Sentence tokenization:** SudachiPy, behind a tokenizer interface, for local morphological analysis and inflection details.
- **Grammar matching:** Kiroku's local grammar index and matcher. It must not need Yomitan to detect grammar patterns.
- **Persistence:** Existing SQLite/card/provenance behavior. No parallel card store.
- **UI/service health:** Report local dictionary and tokenizer readiness separately. Remove Yomitan availability as a requirement for core Desktop operation.

Do not conflate these responsibilities. Sudachi is not a replacement dictionary, and the local dictionary is not a sentence tokenizer.

### 1.2 Yomitan removal boundaries

Remove Yomitan HTTP calls from Kiroku's runtime paths, including tokenization, term lookup, kanji lookup, dictionary discovery, grammar enrichment, health checks, settings, desktop startup, and extension integration where those calls are part of Kiroku's required workflow.

Before deleting code, search every usage of `YomitanHttpProvider`, `YomitanService`, `YOMITAN_ENDPOINT`, port `19633`, `/tokenize`, `/termEntries`, `/kanjiEntries`, Yomitan health/status fields, and Yomitan settings. Classify each result as:

- application runtime dependency to remove;
- compatibility/data-format adapter that can remain locally without calling Yomitan;
- documentation, tests, legacy migration path, or historical note to update/archive.

Preserve the Yomitan-shaped payload adapter if it is a useful internal schema compatibility layer; it must be generated from Kiroku's own dictionary and must not perform HTTP requests. Do not remove user data or dictionary source data merely because a file/name contains “Yomitan”.

Do not break existing card shapes, extension contracts, dictionary payload consumers, or saved user settings without a migration. Migrate settings safely and make old Yomitan configuration inert/retired with a clear one-time compatibility path where needed.

### 1.3 SudachiPy decision

Proceed with SudachiPy behind `KIROKU_TOKENIZER=auto|sudachi|legacy` during rollout. Legacy remains a temporary fallback until the gold corpus and Windows packaging acceptance gates pass. The final product should use local tokenization by default and must not fall back to Yomitan.

- Pin `sudachipy>=0.7,<0.8` with a V1 dictionary release. SudachiPy 0.7 requires dictionary format V1; pin compatible versions together.
- Use mode C initially, then validate against Kiroku's compound/word behavior.
- Wrap the tokenizer in a cached, thread-safe singleton.
- Keep the public `AnnotatedToken` response schema unchanged unless a separately reviewed contract change is required.
- Preserve surface, dictionary form, reading, POS, normalized form, and source character offsets.
- The Core dictionary measured in the review was 76.9 MB download / 202 MB unpacked. Small's measured wheel was 42.5 MB; unpacked size was not measured. Gold corpus results decide which is selected.
- Windows PyInstaller bundling and startup/memory must be measured on Windows.

### 1.4 Licensing and notices

The supplied review reports SudachiPy and SudachiDict as Apache-2.0, with a UniDic BSD-style notice and NEologd data acknowledgments in SudachiDict's `LEGAL` file. Verify the exact pinned releases and include all applicable notices in `THIRD_PARTY_NOTICES.md`.

Do not assume the licence of a runtime applies to animation content. Rive runtime code and `.riv` creative assets are different items with different rights. Likewise, free public Lottie animations and paid Marketplace assets do not necessarily have the same redistribution permissions.

---

## 2. Review findings to preserve

The implementation slices below address these review findings. Re-check each against current HEAD before acting.

### 2.1 Vocabulary / tokenizer

- **T1 [H]:** Wrong lemma for irregular/ambiguous inflections (`行って/行った → 行う`).
- **T2 [H]:** Kana-reading alias table creates false words (`いた→板`, `や→哉`, `な→名`, `た→他`).
- **T3 [H]:** Inflection chains are fragmented (`ている`, `ていた`, `ながら`, `やすい`, `なさい`, `ように`).
- **T4 [M]:** `_match_inflected_span` hardcodes a small suffix list and `身について` special case.
- **T5 [M]:** Unknown multi-kanji runs lose per-kanji JLPT styling.
- **T6 [M]:** Dictionary entries such as `今日は` can swallow the following particle.
- **T7 [M]:** Existing regression set is too narrow (three paragraphs).
- **T8 [L]:** Class-level `_openjlpt_cache` can leak state between tests.

### 2.2 Grammar

- **G1 [H]:** Regex prefix may cross particles and inflate grammar spans.
- **G2 [H]:** Compound forms such as `たくない`, `たくなかった`, `なくて`, and `なければ` are missing or not correctly detected.
- **G3 [H]:** Degraded/offline responses can be cached and replayed after provider recovery.
- **G4 [M]:** Duplicate/near-duplicate points can appear over the same span.
- **G5 [M]:** Cache lacks TTL/pruning and tokenizer-aware identity.
- **G6 [M]:** Grammar currently depends on Yomitan sentence tokenization; Desktop has no robust local sentence tokenizer when Yomitan is down. Solve with Sudachi and local matcher.
- **G7 [M]:** Matcher cost measured at 34–44 ms/sentence; video overlays call it per cue.
- **G8 [L]:** `STATUS.md` reports stale test status; update only if current verification supports it.
- Grammar reference index still contains N5/N4 `reference_only` entries that do not match text. The complete key list should live in the grammar map/tracker rather than `STATUS.md`.

### 2.3 Backend / local API security

- **B1 [M]:** Study API uses a per-launch bearer token, while legacy mutating routes may not. Review found roughly 24 exposed routes (card deletion, LLM configuration, Anki sync, OCR start, etc.).
- **B2 [M]:** Extension origin matching accepts broad `chrome-extension://.*`; requests without `Origin` need deliberate policy.
- **B3 [M]:** Many broad exception handlers end with `pass`, hiding failures in cache, health, sync, and other paths.
- **B4 [L]:** `/api/health` may rebuild services and probe them on every request instead of reusing singletons.
- **B5 [L]:** Verify `bank.py` SQL interpolation of `where_term` cannot be influenced by user input; use bound parameters if it can.
- **B6 [L/deferred]:** Cloud queue token concerns are deferred by owner; do not expand this plan into cloud queue redesign.

### 2.4 Desktop / Electron

- **F1 [H]:** Router mount failure can leave blank host / stale view instance because `view.mount()` is not guarded.
- **F2 [M]:** Rapid navigation may interleave asynchronous mounts.
- **F3 [M]:** Hash/history updates can trigger duplicate navigation.
- **F4 [M]:** Electron is pinned at `^34` in the reviewed snapshot; check supported current stable and security fixes before upgrading.
- **F5 [M]:** Renderer CSP has inline-script and broad localhost-port allowances; `sandbox:false` needs review before safely changing it.
- **F6 [M]:** Mascot `.riv` is around 12.5 MB and adds cold-start decode cost. Persistence fix is already present; do not redo it. Measure cold start before optimizing.
- **F7 [L]:** Large frontend files and uncertain CSS source-of-truth; confirm before refactoring.
- **F8 [L]:** Extension side panel files are large; no broad rewrite.
- **F9 [L]:** Recheck dynamic HTML escaping in touched code; do not perform a speculative rewrite.
- **NEW E1 [H]:** Main-process `EPIPE: broken pipe, write` in `console.log` from a `setTimeout` callback in `desktop/src/main.js` (reported line 460 in the owner's checkout). A closed stdout/stderr pipe must not crash Electron's main process.

### 2.5 Repository, assets, and agent workflow

- **L1 [M]:** Large binaries in Git history include a 38.8 MB dictionary zip, 12.5 MB `.riv`, and duplicated `rive.wasm`; `.git` about 69 MB in review.
- **L2 [M]:** Mascot assets lack per-file provenance/licence records.
- **L3 [M]:** No comprehensive root `THIRD_PARTY_NOTICES.md` for binaries, fonts, Rive runtime, WanaKana, dictionary assets, and data.
- **L4 [L]:** Commit message conventions drift.
- **A1 [H]:** Large root-level planning/architecture documents create avoidable agent context. Archive old plans and make root docs opt-in reads.
- **A2 [M]:** `STATUS.md` contains long data inventories; keep it short and move lists to maps/tracker.
- **A3 [M]:** `.cursorignore` and `IGNORE.md` drift and omit large generated/design material.
- **A4 [M]:** No standard agent card template.
- **A5 [M]:** Too many overlapping vendored UI skills; remove inapplicable iOS skill and retain minimal useful set.
- **A6 [L]:** Map links can silently become stale.
- **A7 [L]:** Agent final reports need a length cap.

---

## 3. Vertical slices

Each slice is one standalone agent card. Slice order is in Section 4. Do not bundle multiple slices into a single implementation task.

### R1 — Gold corpus and comparison harness (no production behavior change)

**Severity:** H (foundation)  
**Dependencies:** None  
**Files:** `backend/tests/fixtures/tokenizer_gold.json`, `backend/tests/test_tokenizer_gold.py`, `tools/compare_tokenizers.py` (confirm paths exist before creating).

**Implement**

- Build roughly 150 reviewable cases across JLPT N5–N2.
- Include the review's 17 everyday failure examples, the existing three-paragraph corpus, inflection chains, particles, compounds, loanwords, names, mixed Latin/digits, punctuation, and sentence-level grammar spans.
- Each case should include source sentence, expected token surfaces, expected dictionary forms/lemmas, readings when known, relevant POS/inflection annotations, expected grammar pattern/concept IDs, and expected character spans.
- Label uncertain answers as `needs_owner_review`; do not quietly invent them.
- Produce a simple human-review format (JSON plus a Markdown/CSV review sheet if useful) so the owner can send the cases through ChatGPT and verify them efficiently.
- Compare legacy tokenizer, Sudachi small, and Sudachi core when available. Report segmentation/lemma/span errors, dictionary size, load time, tokenization latency, and memory where measurable.
- Keep expected-answer provenance: generated draft, machine suggestion, owner-reviewed. Tests must only enforce owner-reviewed expected answers as authoritative.
- Known legacy defects may be `xfail(strict=True)` where appropriate; fixing a defect should make the test pass rather than remain xfailed.

**Done when**

- Harness runs offline with deterministic output.
- About 150 cases exist, with all unreviewed cases explicitly marked.
- Owner has a reviewable expected-answer file.
- No production runtime behavior changes.

### R2 — Local Sudachi tokenizer adapter and dictionary-size decision

**Severity:** H  
**Dependencies:** R1  
**Files:** new `backend/app/services/tokenizers/{base,legacy,sudachi}.py`, `subtitle_annotator.py`, `config.py`, requirements/packaging files, `THIRD_PARTY_NOTICES.md`, named tests.

**Implement**

- Define a stable internal morpheme record: `surface`, `lemma`, `reading`, `pos`, `start`, `end`, `normalized`.
- Wrap Sudachi mode C behind a cached, thread-safe singleton.
- Add `KIROKU_TOKENIZER=auto|sudachi|legacy` for controlled rollout. `auto` selects Sudachi when installed and otherwise uses the legacy tokenizer; no Yomitan fallback.
- Keep existing public `AnnotatedToken` schema unchanged.
- Report active tokenizer, dictionary variant, and readiness in health/status.
- Pin SudachiPy `>=0.7,<0.8` and a compatible V1 `sudachidict_*` release.
- Compare small vs core on the owner-reviewed gold corpus. **The benchmark decides**; do not default to Core merely because it has a larger dictionary.
- Add Apache-2.0, UniDic BSD notice and NEologd acknowledgments to third-party notices, based on exact pinned package contents.
- Validate packaged dictionary resolution and PyInstaller bundling on Windows.

**Done when**

- Existing annotator tests pass with both engines where the legacy mode remains supported.
- Gold corpus results show the selected small/core decision and explain the measured quality/size trade-off.
- Added startup time target is under 300 ms on the target Windows machine, or any miss is documented and accepted before continuing.
- PyInstaller build can tokenize a Japanese sentence on Windows.
- No change to public annotation response schema.

### R3 — Sudachi token merging and Kiroku product rules

**Severity:** H  
**Dependencies:** R2  
**Files:** `tokenizers/sudachi.py`, new `tokenizers/merge.py`, `subtitle_annotator.py`, named annotator tests, gold fixture.

**Implement**

- Merge verb/adjective plus auxiliary chains into user-meaningful tokens, including `ている`, `ていた`, `たい`, `ない`, `ます`, passive, and causative forms.
- Keep `ながら`, `やすい`, `なさい`, and `ように` separable where grammar annotation needs them, with enough token metadata to match grammar spans correctly.
- Use Sudachi dictionary form, reading, POS and offsets as primary morphology facts.
- JLPT lookup order: dictionary form, then normalized form, then surface.
- Replace unsafe kana-reading alias matching with normalized-form aliasing and a small explicit alias list, including `ご飯→御飯` and `綺麗/奇麗` if supported by current data.
- Preserve unknown tokens rather than dropping them.
- Keep compound kanji runs useful as word tokens while retaining per-character kanji-level styling.
- Exclude standalone particles from vocab cards; preserve existing mined-card matching and status precedence.
- Remove hardcoded suffix list and one-off `身について` behavior when the new morphology rules fully cover the case.

**Done when**

- At least 90% of reviewed legacy failure cases pass, and all reviewed critical cases pass.
- `行った` resolves to `行く`; `いた→板`-style false positives are gone.
- Existing regression corpus remains green.
- No particle is incorrectly emitted as an independent vocabulary card.

### R4 — Grammar span correctness and missing compound forms

**Severity:** H  
**Dependencies:** R1; may use Sudachi token spans when R2/R3 are ready, but do not block the matcher fix unnecessarily.  
**Files:** `grammar_matcher.py`, `test_grammar_matcher_spans.py`, `test_grammar_acceptance_gate.py`, gold fixture.

**Implement**

- Derive grammar span boundaries from token/morpheme sequences instead of broad Japanese-character regex prefixes.
- Start at the first token of the maximal contiguous predicate/auxiliary chain that ends at the match; stop at particles, punctuation, clause boundaries, and unrelated lexical tokens.
- Add correct recognition for `たくない`, `たくなかった`, `なくて`, and `なければ` families, including relevant conjugation variants supported by the existing grammar dataset.
- Dedupe duplicate points by `concept_id` or identical concept/span, without collapsing legitimately distinct meanings.
- In no-token mode, use a conservative bounded literal fallback that does not cross particles such as は, が, を, に, へ, で, と, も or punctuation.
- Preserve ambiguity guards and `also_possible` behavior for valid overlapping analyses.

**Done when**

- The four reported sentences produce exact spans: `なりたい`, `言っていた`, `困っている`, and `行きたくなかった`.
- No span begins before a preceding particle/clause boundary.
- The grammar acceptance gate and reviewed gold span cases pass.

### R5 — Grammar cache correctness and fully local grammar analysis

**Severity:** H/M  
**Dependencies:** R2 for local tokenizer; R4 for expected spans. Cache correctness can be implemented first as a small independent sub-slice if needed.  
**Files:** `grammar_service.py`, `dictionary_provider.py` or new tokenizer selector, named grammar-service tests.

**Implement**

- Never cache responses marked degraded/limited/offline or otherwise produced without the selected local tokenizer when the result is not authoritative.
- Include tokenizer identity/version and grammar-index version in cache keys.
- Add TTL and bounded pruning; clean stale entries safely at startup or during cache maintenance.
- Use Sudachi for local sentence tokenization when grammar analysis needs tokens.
- Remove calls to Yomitan for grammar tokenization and grammar dictionary enrichment. Use Kiroku's local dictionary only where dictionary notes are a relevant feature; do not call an unavailable remote API.
- Return an explicit tokenizer source/status such as `sudachi` or `none`; do not report `yomitan` after migration.
- Do not claim local dictionary word lookup provides tokenization.

**Done when**

- A degraded result cannot poison the cache and reappear after the backend recovers.
- Cache invalidates when tokenizer or grammar index changes.
- Grammar analysis works with Yomitan entirely stopped/uninstalled.
- API response accurately identifies local tokenizer status.

### R6 — Electron router robustness

**Severity:** H  
**Dependencies:** None  
**Files:** `desktop/src/ui/router.js`, new `desktop/tests/router_robustness.test.js`.

**Implement**

- Wrap asynchronous `view.mount()` in error handling.
- On failure, retain the previous usable view where possible and show a themed error state with Retry.
- Serialize navigation; latest requested navigation wins.
- Guard hash/history synchronization with a navigation token so a hash update cannot initiate a duplicate navigation.
- Ensure failed mounts clean up partially-created hosts and never leave stale `currentViewInstance` state.
- Log failures through the existing logging/telemetry abstraction without creating a new UI design.

**Done when**

- Throwing `mount()` shows recoverable error UI and a later navigation succeeds.
- Rapid A→B→C navigation ends on C with one visible host.
- Hash changes trigger exactly one navigation.
- Dock markup, pill, layout, and timings remain untouched.

### R7 — Local API protection (three-stage rollout; approved)

**Severity:** M  
**Dependencies:** None, but coordinate with the extension contract and existing launch-token mechanism.  
**Files:** `main.py` middleware, `config.py`, extension manifest/background/auth flow, `desktop/src/preload.js`, named backend and extension tests.

**Purpose in plain language:** Today the local backend can accept some legacy write operations without proving that the request came from the running Kiroku desktop app or its paired extension. R7 closes that gap gradually so the extension does not suddenly stop working.

**Stage 1 — Pin allowed extension identity**

- Replace broad `chrome-extension://.*` acceptance with an explicit allowlist setting.
- Shipped extension ID is the default; allow a deliberate developer override for unpacked development builds.
- Do not trust an Origin header alone as authentication. Keep host/origin validation and the per-launch bearer token as distinct controls.
- Add tests for allowed ID, foreign extension ID, missing Origin, and normal desktop requests.
- Rollback flag restores the previous origin policy temporarily if required.

**Stage 2 — Warn-only token audit**

- Require token on legacy mutating routes in a warn-only mode first.
- Log route identifiers and missing-token counts, but never log the token, credentials, request bodies containing secrets, or sensitive card content.
- Inventory all legacy mutating routes and classify them; read-only routes need an explicit decision too.
- Add counters/status in System Doctor or existing diagnostics.
- Rollback flag disables warn-only instrumentation if it causes issues.

**Stage 3 — Pair extension and enforce**

- Implement a one-time pairing flow so the authorized extension obtains the per-launch token from the desktop through a controlled, origin-checked channel.
- Persist only what is required for the current launch/session; do not create a long-lived plaintext secret store in extension storage.
- Enforce token verification on legacy mutating endpoints.
- Keep a narrowly-scoped emergency rollback flag, disabled by default in release builds, with a clear diagnostic warning when activated.
- Verify that the desktop and paired extension work; foreign extensions and tokenless local curl mutations are rejected.

**Done when**

- All three stages are tested separately.
- The final enforcement mode rejects an unpaired/foreign extension and tokenless local mutation requests.
- Desktop and correctly paired extension remain functional.
- Each stage has a documented rollback flag and a removal/expiry condition so temporary compatibility code does not become permanent.

### R8 — Stop silently swallowing hot-path exceptions

**Severity:** M  
**Dependencies:** None  
**Files:** Named exception-handler locations in backend cache, health, sync, annotator initialization and secret/LLM configuration paths; targeted tests.

**Implement**

- Replace `except Exception: pass` in the named hot paths with appropriate structured warning/debug logs and counters exposed through System Doctor.
- Do not log secrets, API keys, auth tokens, full user card text, or private study data.
- For intentionally benign exception suppression, add a short comment explaining why it is safe.
- Do not mechanically rewrite every broad exception handler in the repository. Start with the review's 52 handlers and prioritize operationally important paths.

**Done when**

- Silent exception handlers in `backend/app` drop by at least half, focusing on hot paths.
- Expected benign cases remain intentionally suppressed with comments.
- System Doctor exposes useful counts without leaking private content.
- Relevant targeted tests remain green.

### R9 — Study tab: Practice | Bank | Mistakes | Progress

**Severity:** M  
**Dependencies:** None  
**Files:** `desktop/src/ui/views/study.js`, its existing styles, named desktop view test.

**Implement**

- Add segmented control inside the existing Study screen: **Practice | Bank | Mistakes | Progress**.
- Reuse existing render functions per segment; do not rebuild study features from scratch.
- Convert question report form into a drawer opened from a Bank row or in-drill flag.
- Make Bookmarked a filter chip in Bank and Practice.
- Add “Practice these” from weak-area rows, navigating to Practice with the relevant trouble preset.
- Preserve state when switching segments.
- Honor reduced motion and reuse current UI tokens/easing.

**Done when**

- Each segment mounts independently and switching does not lose expected state.
- Existing study behavior and targeted tests pass.
- No Dock or Kanji Mastery markup/style changes.

### R10 — Grammar detail panel and token diagnostics

**Severity:** M  
**Dependencies:** R4  
**Files:** `desktop/src/ui/views/grammar.js`, existing styles, named desktop test.

**Implement**

- Selecting a grammar point opens a focused detail panel with **Meaning | Examples | Formation | Seen in your cards**.
- Move token flow behind a **Tokens** diagnostic toggle.
- Add a “Seen in your cards” filter on the grammar index.
- Use grammar spans fixed by R4 for sentence highlighting.

**Done when**

- Selecting a point shows one focused panel.
- Token toggle state persists for the session.
- Highlight ranges match the corrected backend spans.
- No unrelated navigation or Dock change.

### R11 — Vocab: Capture | Inventory and gaps shelf

**Severity:** M  
**Dependencies:** R2/R3 and local dictionary migration where token/lookup behavior is used.  
**Files:** `vocab_main.js`, `vocab_history.js`, relevant styles/tests; keep route IDs unchanged.

**Implement**

- Add in-view segmented control **Capture | Inventory**.
- Capture: Quick Add first; text annotator becomes a collapsed “Annotate a passage” section.
- Inventory: existing history table with the gaps shelf moved to the top as “Gaps for your level” and a mine action.
- Keep existing route IDs and deep links working.
- Ensure dictionary enrichment uses the Kiroku local dictionary, not Yomitan.

**Done when**

- Both legacy routes still resolve.
- Mining from a gap adds one card exactly once.
- Lookup/capture works with Yomitan stopped and no extension-based Yomitan service.

### R12 — Settings regroup and remove Yomitan dependency

**Severity:** M  
**Status:** Deferred — owner decision; do not implement in this cycle.  
**Dependencies:** R2 and local dictionary migration.  
**Files:** `settings.js`, existing styles, relevant settings/service tests.

**Implement**

- Organize Settings into **Preferences** (study levels, AI provider, Anki defaults) and **Connections and health** (Backend, Local Dictionary, Tokenizer, Anki, OCR/Manga-OCR where still applicable, System Doctor).
- Remove Yomitan provider settings and health status from normal product UI after all runtime call sites have migrated.
- Migrate old saved Yomitan endpoint/provider values safely; do not wipe unrelated settings.
- Add tokenizer selection/status only while fallback rollout remains necessary; once stable, remove temporary user-facing legacy selector if the owner-facing product decision is to standardize on local Sudachi.
- Merge the two JLPT level controls only if code confirms they write the same underlying value.

**Done when**

- Every prior non-Yomitan setting remains reachable and saves correctly.
- Local dictionary and tokenizer readiness are visible separately.
- Yomitan is not required for core Desktop or extension workflows.
- System Doctor shows no false Yomitan dependency.

### R13 — Test tab availability and deep links

**Severity:** M  
**Dependencies:** None  
**Files:** `test.js`, `study_api_client.js` only if existing endpoints cannot provide section counts; named tests.

**Implement**

- Show per-section question availability before starting an official-format simulation.
- Make clear which sections will be short/incomplete.
- Add “Open question bank” from the incomplete-bank empty state.
- Add “Review mistakes” from results, filtered to that attempt.
- Pin the resume banner at the top.

**Done when**

- Users see section availability before starting.
- No empty state is a dead end.
- Existing exam scoring and attempt state are unchanged.

### R14 — Repository and legal hygiene (split into small cards)

**Severity:** M/L  
**Dependencies:** R2 and the mascot asset audit; no broad one-shot refactor.  
**Files:** separate cards for notices, asset registry, binary handling, duplicate runtime removal, Electron upgrade, CSP.

**R14a — Third-party notices**

Create/update `THIRD_PARTY_NOTICES.md` for all shipped code, data, fonts and assets, including Sudachi/SudachiDict, UniDic notice, NEologd acknowledgments, existing CC BY-SA datasets, Jitendex/JMdict/KANJIDIC sources, KanjiVG, Tatoeba, fonts, WanaKana, Rive runtime, and other bundled libraries. Record version/source/license and required attribution for each. Do not list an asset as cleared until exact terms are verified.

**R14b — Mascot and animation asset audit**

- Produce an asset register with filename, creator, source URL/item page, date acquired, free/paid status, exact licence/terms version, attribution requirement, modification permission, app embedding permission, raw-file redistribution permission, and proof/receipt path.
- For LottieFiles, distinguish free public animations under the Lottie Simple License from paid Marketplace animations. Free public assets under the Simple License can generally be used commercially and redistributed, but the same licence must accompany the animation/derivative and downstream recipients cannot be given extra restrictions. Marketplace assets can be used in apps/projects but the raw animation file generally cannot be re-distributed, resold, sublicensed, or provided as a standalone file. Verify the actual item and acquisition records; do not infer that all Lottie assets share one licence.
- For the Muza `.riv`, obtain the exact Rive item page and purchase/download licence. Marketplace origin and a request to attribute are not enough evidence of redistribution rights. Determine separately whether embedding the `.riv` inside the Kiroku installer/release is permitted. If not clear, seek written permission or replace the asset with one whose redistribution terms permit app bundling.
- Do not publish restricted raw asset files on GitHub, in release ZIPs, or in public package registries unless the licence expressly permits it. A compiled/in-app embedding may still count as redistribution; do not assume packaging changes the legal result.
- Preserve the user's intended in-app mascot/animation behavior where licensing allows. Do not remove or redesign the mascot as an unrequested workaround.

**R14c — Large binary management**

- Investigate the 38.8 MB Jitendex/Yomitan dictionary zip, 12.5 MB `.riv`, and duplicate `rive.wasm` reported in Git history.
- Determine which artifacts are actually needed at runtime and whether each can be fetched during a controlled build/release step, stored with Git LFS, or removed from the repository.
- Do not remove an asset before replacement/download/build paths are verified.
- Remove only a confirmed duplicate `rive.wasm`; verify the active import path and packaging output.
- History rewriting is optional and disruptive. Do not rewrite Git history without separate explicit approval.

**R14d — Electron maintenance**

- Check current supported stable Electron and the project's Node/Chromium compatibility.
- Upgrade from the reviewed `^34` only in a dedicated card after checking release notes and native dependencies.
- Run targeted desktop tests and Windows packaged smoke test.

**R14e — Renderer security posture**

- Review CSP: remove `'unsafe-inline'` scripts if the current app can support nonces/hashes or external scripts; restrict `connect-src` to the actual backend port rather than any localhost port.
- Evaluate enabling `sandbox:true`; inspect preload APIs and required capabilities first. Do not flip it blindly.
- Test the packaged Windows app after each security setting change.

**Done when**

- Notice file and asset register accurately describe shipped material.
- No asset with unclear redistribution rights is bundled in a public release without owner/legal clearance.
- A fresh clone/build obtains required external artifacts through documented, licence-compliant steps.
- Duplicate runtime binary is removed only after active path verification.
- Electron/CSP changes pass targeted tests and a Windows smoke test.

### R15 — Agent efficiency pack

**Severity:** M  
**Dependencies:** None; can be split into independent sub-cards.  
**Files:** `IGNORE.md`, `.cursorignore`, `STATUS.md`, docs maps, new `docs/cards/TEMPLATE.md`, relevant skills folder, map-path test.

**Implement**

- Move large old plan documents to `docs/archive/` and make `ARCHITECTURE.md` and `README.md` read-only-when-named in `IGNORE.md`; retain the current agent instruction file.
- Shorten `STATUS.md` to five concise lines. Move long grammar-key inventories to `docs/maps/grammar.md` or a structured tracker.
- Make `IGNORE.md` the single source of truth and generate/synchronize `.cursorignore` from it.
- Add large/noisy paths missing from ignore policy: `docs/design/`, `docs/desktop-wireup/`, duplicated `desktop/tests/fixtures/openapi.json`, grammar master JSON files, `docs/study-bank/`, `docs/Audio`, `docs/Frame`, and `.agents/` where appropriate.
- Add `docs/cards/TEMPLATE.md` with Goal, Files (max 6), Test command, Done-when, Out-of-scope, and Report format (maximum 8 lines).
- Remove the inapplicable `ios-design` skill. Keep one clearly selected taste/design skill plus `animate` only if those are still useful and do not load for non-UI tasks. Do not remove skills without confirming they are not referenced by active agent workflows.
- Add a small test that every repository path named in `docs/maps/*.md` exists.
- Avoid loading long reports or archived docs into every agent session.

**Done when**

- Cold agent workflow needs only `AGENTS.md`, `IGNORE.md`, one area map and the active card.
- Ignore sources are synchronized and map-path test passes.
- STATUS is concise and does not contain large data inventories.

### R16 — Performance: measure before optimizing

**Severity:** L  
**Dependencies:** R2/R4 for representative local tokenization and correct spans; health/local dictionary wiring should be stable first.  
**Files:** named profiling target(s), grammar matcher, health service only as required, performance tests/benchmark.

**Implement**

- Profile `match_sentence` on the gold corpus.
- If profiling confirms regex compilation/cache churn, precompile grammar regexes at index load and pre-filter candidate points by a character/index structure.
- Re-measure warm and cold behavior; do not blindly assume Python's regex cache is the cause.
- Reuse backend service singletons in `/api/health`; avoid recreating `YomitanService` (which should be removed from runtime), CardService, OcrService, or local dictionary/tokenizer objects on every health request.
- Measure mascot cold-start using existing performance marks. If cold fetch/decode is material, start prefetch while `loading.html` is visible. Do not remove animation or change its appearance.
- Record before/after timing and memory on Windows where the target runtime matters.

**Done when**

- Grammar analysis approaches the review's target of about 10 ms/sentence on the gold corpus, or the measured result and reason for missing target are documented.
- Health endpoint cost is lower and service lifetimes are explicit.
- Mascot optimization is based on before/after cold-start measurements.

### R17 — Commit convention

**Severity:** L  
**Dependencies:** R15 card template.

**Implement**

- Use `type(scope): what changed (slice id)` with a one-line body naming the targeted test command and result.
- Examples: `fix(grammar): clip spans at particle boundaries (R4)`; `chore(agents): archive old plans and trim STATUS (R15)`.
- Optional commit-msg hook only if the repository already has a suitable hook mechanism; do not add tooling solely for cosmetic enforcement.

**Done when**

- The agent card template contains the convention.
- Commits for these slices follow it.

### R18 — Electron main-process EPIPE resilience

**Severity:** H  
**Dependencies:** None  
**Files:** `desktop/src/main.js` (verify current path/call site), focused `desktop/tests` test if main-process logic can be isolated.

**Reported error**

```text
A JavaScript error occurred in the main process
Uncaught Exception:
Error: EPIPE: broken pipe, write
    at Socket._write (node:internal/net:61:18)
    at writeOrBuffer (node:internal/streams/writable:572:17)
    at _write (node:internal/streams/writable:501:10)
    at Writable.write (node:internal/streams/writable:510:10)
    at console.value (node:internal/console/constructor:303:16)
    at console.log (node:internal/console/constructor:378:26)
    at Timeout._onTimeout (D:\Python\AnkiMiner\desktop\src\main.js:460:23)
```

**Likely cause to verify**

A timer callback calls `console.log` after the process stdout pipe has closed or its parent terminal/launcher has gone away. `EPIPE` is a writable-stream error. The main process should not crash merely because diagnostic output can no longer be written.

**Implement**

- Inspect the current `main.js` around the reported timer callback and identify whether it is a periodic heartbeat, health poll, startup status log, or another timer.
- Determine whether the output is written to `console.log`/`console.error` or a custom stream. Do not assume the line number still matches the current source.
- Replace unconditional console writes in the recurring callback with Kiroku's existing logger if one exists. The logger must tolerate closed stdout/stderr and should prefer a file/app log location appropriate to Electron.
- If no suitable logger exists, add a small guarded logging helper that safely handles stream closure and suppresses only expected `EPIPE`/closed-stream failures. Do not swallow unrelated exceptions silently.
- Ensure the recurring timer is not left running after app shutdown/window lifecycle teardown. Clear it in the appropriate `before-quit`/shutdown cleanup path.
- Do not add a broad `uncaughtException` handler that hides arbitrary application bugs. Handle the known logging stream failure at the write boundary.
- Add a unit test around the logger/timer callback using a mock writable stream that emits or throws `EPIPE`. Assert that the app's operational callback continues or exits cleanly and that non-EPIPE errors remain visible.
- Verify behavior in packaged Windows Electron when launched from Start Menu and when launched from a terminal whose pipe is closed.

**Done when**

- A closed stdout/stderr pipe cannot take down the Electron main process through the reported timer log.
- Non-EPIPE failures still surface through the normal error-reporting path.
- Timers/intervals are stopped during shutdown.
- A Windows packaged smoke test confirms the fix.

---

## 4. Suggested implementation order

| Phase | Slices | Reason |
|---|---|---|
| 1. Baseline and immediate stability | R1, R6, R18, R15 | Gold corpus gates later correctness work; router/EPIPE are reliability issues; agent context savings benefit every later task. |
| 2. Local tokenizer foundation | R2 → R3 | R2 introduces Sudachi behind the contract and makes the gold-corpus-driven small/core decision; R3 applies Kiroku word/inflection rules. |
| 3. Grammar correctness and local independence | R4, then R5 | Fix span logic and compound forms; make grammar analysis local and cache-safe. R4 can begin before R3 if the matcher is token-independent, but final acceptance must use local Sudachi tokens. |
| 4. Dictionary/Yomitan retirement | Local dictionary migration audit and implementation across R5, R11, R12 | Remove Yomitan HTTP/runtime dependency only after local lookup and tokenizer paths are verified. Keep this split into small named cards; no hidden Yomitan fallback. |
| 5. Desktop information architecture | R9, R11, R13, then R10 and R12 | Work one screen per card; grammar details depend on R4; Settings reflects the local tokenizer/dictionary architecture. |
| 6. Security and operational hardening | R7 staged 1→2→3, R8 | R7 has explicit owner approval; stages must be independently testable and reversible. |
| 7. Legal, packaging and performance | R14 sub-cards, R16, R17 | Asset rights and third-party notices before release packaging; profile only after local tokenizer/matcher behavior is stable. |

**Important sequencing rule:** Do not delete the Yomitan provider and settings before all call sites have migrated to Kiroku Dictionary + Sudachi and their targeted tests pass. The final architecture must have no runtime Yomitan API dependency, but removal must be safe and staged.

---

## 5. Owner decisions already resolved

| Original question | Owner decision | Agent instruction |
|---|---|---|
| Should R1 decide small vs core, or Core be optional? | R1 decides. | Benchmark first; do not select Core or optional-download packaging by assumption. |
| Approve staged local API lockdown? | Approved. | Implement R7 in three tested stages with rollback flags. |
| Where did mascot assets come from? | Muza `.riv`: Rive marketplace. Lottie cats: LottieFiles / Lottie marketplace. | Audit each exact item and acquisition record. Platform/source alone does not settle redistribution. |
| Review about 150 gold expected answers? | Yes, using ChatGPT to help. | Generate draft labels, expose uncertain cases, preserve provenance, and wait for owner review before making them authoritative. |
| Keep Yomitan API? | No. Use Kiroku's own dictionary. | Remove runtime HTTP calls and Yomitan-required workflows. Sudachi handles sentence morphology; local Kiroku dictionary handles definitions/kanji. |
| EPIPE main process error? | Intermittent Windows Electron crash. | Implement R18 to make logging safe and stop recurring timers cleanly. |

---

## 6. Asset-licensing research notes for the agent

These notes guide the audit but do not replace examination of the exact asset item pages, purchase receipts, and the licence version applicable when each file was downloaded.

### LottieFiles

- LottieFiles says free public downloadable animations are covered by the **Lottie Simple License**, which permits commercial use, modification, and distribution, but modified/distributed animation files remain under that same licence and users may not impose extra restrictions. Attribution is optional but encouraged.
- LottieFiles' Marketplace guidance says purchasers may use purchased animations in apps/projects and modify them, but may not transfer, re-distribute, resell, license, sublicense, or offer the downloaded animation file to third parties. Premium animations similarly permit commercial project use but prohibit redistribution of the animation file itself.
- Therefore: free public Simple-License cats and paid Marketplace cats must be treated separately. Do not bundle a paid Marketplace raw JSON/file in a public installer or repository unless the exact applicable licence expressly authorizes that distribution. Do not assume that a private download or an attribution note changes the restriction.

Official references:
- https://lottiefiles.com/page/license
- https://help.lottiefiles.com/animation-licensing-basics-
- https://lottiefiles.com/page/upload-guidelines
- https://help.lottiefiles.com/hc/en-us/articles/24484503354137-premium-animations

### Rive

- Rive runtime source code is separately licensed (the reviewed runtime repository publishes MIT terms); this does **not** automatically license `.riv` files created or sold by other authors.
- A `.riv` downloaded from the Rive marketplace needs its own creator/item licence and any marketplace purchase terms. The agent must retrieve exact item metadata and proof of acquisition before recommending public bundling.
- If app embedding is allowed but raw file redistribution is not, ask whether the particular licence treats shipping a `.riv` inside an installer as redistribution. Do not presume that a packaged asset is exempt.

Official reference for runtime-code distinction:
- https://github.com/rive-app/rive-runtime/blob/main/LICENSE
- https://help.rive.app/runtimes/overview (confirm current runtime docs as needed)

---

## 7. Manual acceptance checklist (Windows owner environment)

The agent should explicitly report which checks require the owner's machine. Do not claim these passed in a Linux/sandbox-only run.

- [ ] Sudachi small/core comparison run on the owner-reviewed gold corpus.
- [ ] Selected Sudachi dictionary loads and tokenizes after Windows PyInstaller packaging.
- [ ] Startup time and memory measured on Windows.
- [ ] Vocabulary annotation, dictionary lookup and kanji lookup work with Yomitan stopped and ultimately uninstalled.
- [ ] Grammar analysis and video-cue annotation work using local Sudachi tokens only.
- [ ] No Yomitan endpoint/port health dependency remains in the shipped Desktop workflow.
- [ ] Extension pairing and API token enforcement work through all R7 stages.
- [ ] Foreign extension ID and tokenless mutation are rejected in enforcement mode.
- [ ] Router survives failed view mount and rapid tab changes.
- [ ] Packaged app does not crash when stdout/stderr pipe closes; EPIPE is safely handled.
- [ ] Mascot and Lottie asset rights recorded for exact files; no uncleared asset included in public release.
- [ ] Electron upgrade/CSP/sandbox changes, if implemented, pass Windows packaged smoke test.
- [ ] FINAL Bottom Dock and Kanji Mastery remain unchanged.

---

## 8. Explicit out of scope

- PDF/OCR import work (already planned separately; this revision does not reopen it).
- Home page placement advice or redesign.
- Bottom Dock/sliding pill changes.
- Kanji Mastery changes.
- Cloud queue redesign/security work that the owner explicitly deferred.
- Framework migrations or wholesale rewrites of the large desktop/extension files.
- Removing or replacing the mascot as a shortcut for asset licensing or performance work.
- Automatic approval of grammar/tokenizer gold answers.
- Full-suite test runs without owner approval.

---

## 9. Agent completion report template

Keep the final response to 8 lines maximum:

1. **Slice:** R# and short title.
2. **Verified finding:** still present / already fixed, with current code evidence.
3. **Changed:** key files and behavior.
4. **Tests:** exact command and pass/fail result.
5. **Manual checks:** Windows/Electron/extension checks still required.
6. **Data/API safety:** migrations or compatibility behavior, if any.
7. **Risks:** remaining limitations or licence uncertainty.
8. **Commit:** hash and conventional commit message.

