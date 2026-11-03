# Kiroku Note: Agent Implementation Plan (Vertical Slices)

Derived only from the Audit Report and Remedy Plan. Save this as `docs/plans/IMPLEMENTATION.md` in the repo. An agent should read AGENTS.md (or its slimmed version), this file's Rules section, and **one slice card** per session. Nothing else unless the card says so.

## Rules for every session

1. **One slice per session.** Do not start the next slice, even if time remains. End by reporting.
2. **Read only what the card lists.** Use `grep -n` to find the lines you need, then view a line range. Do not open whole files over 400 lines, `PROGRESS.md`, `docs/archive/`, `grammar-audits/`, vendored `rive.js`/`rive.wasm`/`lottie`, or `.agents/skills` unless the card names them.
3. **Tests: targeted only.** Run the test commands in the card. Never run the full backend or desktop suite; CI does that. If a named test file does not exist, find it with `ls backend/tests | grep <area>` or `ls desktop/tests | grep <area>`, and create it if still missing.
4. **FINAL components are locked** (design\_decisions.md): the Bottom Dock including its sliding pill, and the Kanji Mastery section layout. Do not edit their markup, layout, colors or animation timing. Do not add items to the dock. New screens must be reachable from existing screens (reuse how Study opens its sub-screens).
5. **No UI redesign.** Use existing tokens, tactile components and the `--ease-*` motion tokens. No emoji. Honor `prefers-reduced-motion`.
6. **Do not remove animations.** Performance work keeps every animation; it changes how they are driven.
7. **Stop and ask the user** if: the change needs a FINAL component edited; a test fails twice for reasons you do not understand; more than 8 files need changing; a backend contract change would break the browser extension (do not touch `extension/` or `cloud` code, only read their API usage if needed).
8. **Finish checklist:** targeted tests pass; `git diff --stat` matches the card's expected files; add at most 5 lines to `STATUS.md` (what changed, what is left); commit with message `slice <ID>: <title>`.
9. **Reply format:** changed files, test result, 5-line summary, open issues. Do not re-print code.

### Prompt to start a slice

```
Implement slice <ID> from docs/plans/IMPLEMENTATION.md.
Read only: AGENTS.md, the slice card, and the files it lists.
Follow the Rules section. Do not run the full test suite.
Stop at the card's Done-when. Do not start another slice.
```

## Slice overview

| ID | Title | Layer | Size | Depends on | What you will see |
| :-- | :-- | :-- | :-- | :-- | :-- |
| S0 | Cheap agent sessions | docs, config | S | none | smaller AGENTS.md, no huge file reads |
| S1 | Question text renders blanks, underline, star, ruby | backend + desktop | M | none | practice and exam show real blanks |
| S2 | Vocab tokenizer: kana spellings and aliases | backend | S | none | ご飯 highlights as one word |
| S3a | Grammar spans, false positives, regex fix | backend | M | none | tight grammar highlights |
| S3b | Grammar: promote common reference-only points | backend data | M | S3a | ので, ことができる and others detected |
| S4 | Persistent Rive mascot | desktop | M | none | cat is there instantly when you return Home |
| S5a | Router keep-alive (Home and Vocab pilot) plus transition order | desktop | M | S4 | no rebuild flash on those tabs |
| S5b | Keep-alive for remaining tabs | desktop | M | S5a | same for Grammar, Kanji, Study, Test |
| S6 | CSS hygiene | desktop | S | none | less layout work, same look |
| S7 | Smooth stroke-order drawing | desktop | S | none | strokes draw along their path |
| S8 | Mascot and card idle cost | desktop | S | S4 | lower CPU, smoother tilt |
| S9 | GPU Rive renderer (human gate) | desktop | S | S4 | smoother cat rendering |
| S10 | Electron startup and dev reload | desktop | S | none | faster launch, faster dev saves |
| S11 | Progress screen | desktop | M | S1 | accuracy, weak areas from existing API |
| S12 | Mistakes notebook | backend + desktop | M | S1 | browse and re-practice mistakes |
| S13 | Question bank browser | desktop | M | S1 | find and report defective questions |
| S14 | Exam pause, resume, session recovery | desktop | M | none | resume after closing the app |
| S15 | Practice setup by category and format | backend + desktop | S | S1 | pick what to practice |

Size: S is about 2 to 4 hours of agent work, M about half a day to a day.

**Recommended order:** S0, S1, S4, S2, S3a, S5a, S3b, S6, S7, S8, S10, S9, S5b, S12, S11, S13, S14, S15.

---

## S0. Cheap agent sessions

**Goal:** every later session starts with about 2k to 5k tokens of context instead of 30k or more.

**Read:** `AGENTS.md`, `IGNORE.md`, `design_decisions.md`, a `ls` of the repo root and `docs/`.

**Do:**

1. Create `docs/maps/` with one file per area (grammar, vocab, study, ocr, llm, cloud, desktop-shell, desktop-views). Move the matching sections out of AGENTS.md into them unchanged, then fix the stale statements: tray exists, root DESIGN.md exists, desktop views live in `desktop/src/ui/views/`, desktop shell exists, and the two corrupted names `app.study.ingestion` and `app.study.verification`.
2. Rewrite AGENTS.md to 6 KB or less: purpose, FINAL list, emoji rule, the rules above in short form, a task router table (area -> map file -> test files), and the test policy.
3. Create `docs/maps/ui-rules.md` (3 KB or less) distilled from design\_decisions.md: tokens, FINAL list, motion rules. Make it the only default UI reading. Remove the instructions that require loading five skills, exploring external libraries and a visual polish pass on every task; keep them as opt-in phrases.
4. Move `PROGRESS.md`, `stitch.md`, `plan.md` and the root `DESIGN.md` into `docs/archive/`. Create `STATUS.md` (3 KB or less): current state, last 10 changes, open issues.
5. Add ignore rules for the agent tool(s) in use (for Claude Code, `permissions.deny` read rules in `.claude/settings.json`; for Cursor, `.cursorignore`). Exclude `docs/archive`, `grammar-audits`, `desktop/src/ui/vendor`, `desktop/src/ui/lib`, `*.riv`, `*.wasm`, screenshots.
6. Move `mode_selector_prototype.html`, `rive_inspector.html` and the two `verify_ui_playwright*.py` files out of `desktop/src/` into `tools/` (and check nothing references them with `grep -rn`).

**Files expected:** AGENTS.md, IGNORE.md, STATUS.md, `docs/maps/*`, moved docs, agent settings file.

**Verify:** `wc -c AGENTS.md` is 6144 or less; `grep -rn 'docs/maps' AGENTS.md` lists every map; no broken moved-file references (`grep -rn 'PROGRESS.md' --include=*.md --include=*.py --include=*.js . | head`).

**Done when:** a fresh session can find the grammar map, the UI rules and the test commands from AGENTS.md alone.

**Do not:** change any source code in this slice, and do not delete content, only move it.

---

## S1. Question text renders blanks, underline, star, ruby

**Problem:** the API returns raw markup (`{blank|35}`, `{u|...}`, `{star}`, `[base|reading]`), and the desktop passes it through an HTML sanitizer that does not understand it. The backend renderer `to_safe_html` exists but is never called, its `study-target-*` classes are not in the sanitizer allowlist, and no CSS defines them.

**Read:** `backend/app/study/markup/serializer.py` (the `to_safe_html` function and the classes it emits), `backend/app/api/study/converters.py`, `schemas.py`, and the SQL sites found by `grep -rn 'prompt_markup\|text_markup' backend/app/api/study desktop/src/ui | head -40`; `desktop/src/ui/utils/sanitizer.js`; the question render code in `desktop/src/ui/views/study.js` and `test.js` (grep for `sanitizePromptMarkup`).

**Do:**

1. Backend: add a helper in `converters.py` that calls `to_safe_html`. Add optional string fields `prompt_html` and `text_html` (default empty) next to each markup field in the DTOs for bank, practice, exam, supporting and analytics responses, and fill them where the DTOs are built. Keep the raw markup fields unchanged.
2. Desktop: add one shared function (in `sanitizer.js` or a new `utils/study_text.js`) that returns sanitized `*_html` when present, otherwise the escaped raw text. Replace direct `sanitizePromptMarkup(prompt_markup)` calls in practice, exam, passages and choices with it.
3. Allow the classes the serializer emits (`study-target-blank`, `study-target-underline`, `study-target-star`, and any others you find in its output) in the sanitizer allowlist.
4. CSS in `bundle.css`, using existing tokens: blank as an inline box with a minimum width, bottom border and the number inside; star as a boxed star; underline as a 2 px underline; ruby with `rt` at a smaller size and no line-height jump. No new colors.
5. Add `backend/scripts/audit_markup_render.py`, read-only: open study.db, render every stored question and choice, and print counts of items that still contain `{`, `[...|...]`, or that contain `＿＿`, `___` or `（　）` but produced no blank node.

**Expected files:** `converters.py`, `schemas.py`, 3 to 5 route files, `sanitizer.js`, `study.js`, `test.js`, `bundle.css`, one new test file each side, one script.

**Verify:** `pytest backend/tests/test_study_markup_html.py -q` (create it: one golden case per format family using samples from `grep -rn '{blank|' backend/tests | head`), and `node --test desktop/tests/sanitizer.test.js` (create: allowed classes survive, scripts are stripped).

**Done when:** a practice question and an exam question that contain a blank, an underline, a star and ruby show boxes and underlines, with no literal braces or bracket-pipe text on screen. Report the audit script's counts to the user.

**Do not:** change the markup language, the database, or the raw fields.

---

## S2. Vocab tokenizer: kana spellings and aliases

**Problem:** the annotator looks words up only by their written headword. The bundled table has 御飯 (ごはん) but not ご飯, and the reading is never used as a key, so ご飯 falls back to the single kanji 飯 (a different word). Same for わたし (only 私 is stored).

**Read:** `backend/app/services/subtitle_annotator.py` (the dictionary-building code and `annotate_text`); `ls backend/tests | grep -i annot` for the existing test. Query `backend/app/data/jlpt_reference.sqlite` read-only.

**Do:**

1. When the dictionary is built, add alias keys: each kana reading as a key for entries whose headword contains kanji; the 御 prefix as ご and お; katakana to hiragana normalization. Mark alias entries so exact surface matches always win.
2. Homophone rule: apply an alias only when it maps to one entry, or to entries that share the same level (take that level). If it is ambiguous, do not highlight.
3. If the output schema allows, stop emitting a lone-kanji token from inside a longer unmatched run. If that would change the response shape, skip this step and note it in STATUS.md.
4. Add a small variant table for known spelling variants (for example 綺麗 and 奇麗) so such gaps are one data line each.

**Expected files:** `subtitle_annotator.py`, one test file.

**Verify:** the annotator test file plus a new parametrized test with: ご飯, わたし, お金, ありがとう, ごちそうさま, 食べさせられた, 勉強しています. Assert ご飯 yields one token matching the 御飯 entry (reading ごはん, N5) and never a bare 飯 token.

**Done when:** the new cases pass and no existing annotator test changes expectations.

**Do not:** replace the dictionary or add dependencies. Real segmentation through Yomitan or `kiroku_dictionary` is a separate later slice.

---

## S3a. Grammar spans, false positives, regex fix

**Problem (confirmed):** highlight spans run back across particles. `友達と公園に行っている` reports `ている` covering the whole sentence; `寿司を食べたい` reports `たい` starting at 寿司. Single-kana patterns match inside other words (`だ` inside です and ください; ここ inside ここに). The generated regex for た-form and ない-form prefixes has a reversed character range, which raises `re.error` and is swallowed, so those patterns can never match.

**Read:** `backend/app/services/grammar_matcher.py` in full (about 300 lines), plus the token structure it receives from `grammar_service.py` (grep for `tokenize`).

**Do:**

1. Fix the reversed range (`\u30a1-\u309f`) in the prefix character classes and add a test that compiles every regex the builder can generate.
2. Span anchoring: when tokens are available, locate the token that holds the match start, then move the start left only across tokens that belong to the same predicate (verb stem, adjective stem, auxiliary, suru-noun) and never across a particle token. When tokens are unavailable, keep current behavior and set `span_approx=true` on the result if the model has room for it.
3. Suppression: for single-kana or very short patterns, require that the match aligns with token boundaries on both sides when tokens exist. This removes だ inside です/ください and ここ inside ここに.
4. Fix the cache branch that re-filters with `_hide_known(cached)`: it should filter the already level-filtered list.

**Expected files:** `grammar_matcher.py`, `grammar_service.py` (cache line only), one test file.

**Verify:** `pytest backend/tests/test_grammar_matcher_spans.py -q` (create). Use these cases and assert that no returned span contains a case-particle token (は, を, に, で, と, が, も) and that the match end is unchanged: `友達と公園に行っている`, `寿司を食べたい`, `私は日本語を勉強している`, `ここに名前を書いてください`, `毎日運動するようにしている`, `食べなければならない`.

**Done when:** those cases pass and the Grammar tab shows tight highlights (user checks one sentence).

---

## S3b. Grammar: promote common reference-only points

**Problem (confirmed):** 222 of 900 grammar points are `reference_only` and never match. Basics are included: ので (N5), ことができる (N4), ようにする (N4).

**Read:** find the data with `grep -rln 'reference_only' backend/app | head`; the matcher spec format in `grammar_matcher.py`; one file from `grammar-audits/` for expected behavior (do not read the others).

**Do:**

1. List the `reference_only` points at N5 and N4 into STATUS.md (keys only).
2. Promote up to **30** per session to `auto`, starting with ので, から, ために, ことができる, ようにする, giving each correct variants and, where the matcher supports it, the required previous form.
3. Create `backend/tests/data/grammar_regression.json`: at least 40 sentences with the expected set of point keys, including the six sentences from S3a, and a test that runs them all in one go.
4. Leave the remainder in STATUS.md for the next session.

**Verify:** `pytest backend/tests/test_grammar_regression.py -q`.

**Done when:** `雨が降ったので家にいた。` returns ので, `日本語を話すことができる。` returns ことができる, and the regression test passes.

---

## S4. Persistent Rive mascot

**Problem:** the cat file is 12.5 MB. Every return to Home destroys the Rive instance, copies the 12.5 MB buffer (`buffer.slice(0)`) and parses it again on the main thread, so the cat is blank until the first frame.

**Read:** `desktop/src/ui/rive_mascot.js`; in `desktop/src/ui/views/home.js` only the mascot mount and unmount sections (`grep -n 'mascot\|rive' home.js` then view those ranges); `desktop/src/index.html`.

**Do:**

1. Add `desktop/src/ui/shell/mascot_host.js` with `ensureCreated()`, `attach(slotEl)`, `detach()`, `pause()`, `resume()`, `destroy()`. It owns one container element, one canvas and one Rive instance created once.
2. In `index.html` add a hidden stash element for the host. `attach` moves the host element into the Home slot and calls `resume()`; `detach` moves it back to the stash and calls `pause()`. Moving the canvas keeps its context.
3. Parse once with `new rive.RiveFile({ buffer })` and create the Rive instance from that file (check the vendored API with one `grep -n 'RiveFile' desktop/src/ui/vendor/rive.js`). Remove the per-mount `buffer.slice(0)`.
4. Create the host after first paint (`requestIdleCallback` with a timeout), not at script load.
5. In `home.js`, replace mascot creation and cleanup with attach and detach. Keep the state-machine inputs, reduced-motion path, fallback image, speech-bubble timing and hover tilt exactly as they are.
6. On attach, call the surface resize once. Add `performance.mark('mascot:attach')` and `performance.mark('mascot:visible')` behind the existing perf debug flag.

**Expected files:** `mascot_host.js` (new), `rive_mascot.js`, `home.js`, `index.html`, `desktop/tests/mascot_host.test.js` (state machine only, with a fake Rive).

**Verify:** `node --test desktop/tests/mascot_host.test.js`.

**Done when:** the test passes and, in the app, Home to Vocab to Home shows the cat immediately with no fade-in or loading state. Ask the user to confirm visually and to check memory after 20 switches.

**Do not:** reduce or remove any mascot animation, and do not touch the `.riv` file.

---

## S5a. Router keep-alive (Home and Vocab pilot) plus transition order

**Problem:** `navigateToTab` unmounts the old view and builds a new one each time, then refetches. The view transition captures an empty incoming page, and the hash is set only after the transition finishes.

**Read:** `desktop/src/ui/router.js`; the mount/unmount functions of `views/home.js` and `views/vocab_main.js` (grep for `addEventListener`, `removeEventListener`, `mount`, `unmount`).

**Do:**

1. Give views an optional lifecycle: `mount()` once, then `onShow()` and `onHide()`. The router keeps instances of views that opt in (`keepAlive = true`), hides them with the `hidden` attribute and calls the hooks. Views that do not opt in behave exactly as now.
2. In Home and Vocab, move global listeners (window mousemove, keydown, visibilitychange, resize observers) from mount/unmount into `onShow/onHide`, and make them idempotent. Preserve scroll position and input text.
3. On show, refresh data only if older than 30 seconds, and update changed parts without replacing the whole subtree.
4. Transition order: build the incoming view's shell inside the transition callback so the snapshot is not empty, fill data after, and set `location.hash` before awaiting `transition.finished`.
5. Add a debug counter of active listeners to prove there are no duplicates after 20 switches.

**Verify:** `node --test desktop/tests/router_keepalive.test.js` (create, with fake views: mount called once, onShow/onHide balanced, non-keepAlive views still remount).

**Done when:** switching Home and Vocab back and forth does not re-run `mount`, scroll and typed text persist, and the listener counter stays constant. User confirms the transition looks the same.

**Do not:** change the slide distance, spring curve or duration.

---

## S5b. Keep-alive for remaining tabs

Same method as S5a for Grammar, Kanji, Study, Test. Rules: change lifecycle only, no layout or visual change (Kanji layout is FINAL); never keep an active exam session view alive in a way that continues a timer while hidden (pause on `onHide`); Settings stays remount-on-open. One view per commit inside the slice. **Verify:** extend `router_keepalive.test.js` with each view's opt-in flag. **Done when:** every tab switch shows existing content instantly and the listener counter is stable.

---

## S6. CSS hygiene

**Read:** `grep -n 'transition: all\|will-change' desktop/src/ui/styles/bundle.css desktop/src/ui/shell/shell.css`.

**Do:**

1. Replace each `transition: all` (7) with the explicit properties that actually change, using the existing `--ease-*` tokens and unchanged durations.
2. Remove `will-change: width` in `bundle.css`. Leave the dock rule in `shell.css` untouched (FINAL).
3. Add `contain: layout paint` to view root containers and cards, and `content-visibility: auto` with `contain-intrinsic-size` to the history table and syllabus list. Do not add it to the Kanji grid (FINAL layout).
4. Do not animate `box-shadow`, `filter` or `backdrop-filter`; if a fade exists, move it to a pseudo-element's `opacity` only where it already animates.

**Verify:** `grep -c 'transition: all' desktop/src/ui/styles/bundle.css` is 0; `node --test desktop/tests` for any existing CSS or token test that names these files only.

**Done when:** the grep is clean and the user sees no visual difference on Home, Vocab, Study.

---

## S7. Smooth stroke-order drawing

**Problem:** the stroke player in `kanji.js` advances with `setInterval` every 450 ms and snaps each stroke on, instead of drawing it.

**Read:** `desktop/src/ui/views/kanji.js`, the stroke player section only (`grep -n 'setInterval\|stroke' kanji.js`).

**Do:**

1. Replace the interval with the Web Animations API: for each stroke path, animate `stroke-dashoffset` from its `getTotalLength()` to 0 over 250 to 400 ms with the ease-out token, then start the next stroke on `animation.finished`.
2. Keep the same colors, widths and final state as before. Respect `prefers-reduced-motion` by showing strokes instantly.
3. Cancel running animations on close, replay, and when navigating away.
4. Do not add controls or change layout. This is inside a FINAL section, so only the player logic may change. If any change touches layout markup or styles, stop and ask.

**Verify:** if the sequencing is separable, a node test with fake paths that asserts order and cancellation; otherwise state it is a manual check.

**Done when:** strokes visibly draw along their path in sequence, and replay and close work without leftover timers.

---

## S8. Mascot and card idle cost

**Depends on S4. Read:** the tilt, resize and card-controller code in `home.js`; `mascot_host.js`.

**Do:**

1. Hover tilt: attach the pointer listener only while the pointer is inside the mascot area plus a margin; do the transform write once per frame with `requestAnimationFrame`, easing toward the target (lerp) so it glides between mouse events. Same maximum tilt as now.
2. Resize observer: debounce to one frame and call the surface resize only when the pixel size changed.
3. Pause the mascot and the card animations when `document.hidden` is true or the window is minimized. Pause cards that scroll out of view with `IntersectionObserver`.

**Verify:** `node --test desktop/tests/mascot_host.test.js` extended with pause on hidden; manual check of CPU with the window hidden.

**Done when:** idle CPU on Home is visibly lower and the tilt looks smoother, not different.

---

## S9. GPU Rive renderer (needs human check)

**Do:**

1. Replace the vendored `@rive-app/canvas` files with the `@rive-app/webgl2` build (update `desktop/package.json` and the copied `rive.js` and `rive.wasm`). Keep a single copy of the wasm; before deleting the duplicate in `ui/lib`, grep for every reference.
2. If WebGL context creation fails, fall back to the previous canvas build automatically.
3. Make no changes to mascot logic.

**Human gate:** the user must look at the cat and confirm there are no rendering differences (blend, edges, masks) before this is committed to main. If anything differs, keep the canvas build and report.

**Done when:** the user confirms, and a note in STATUS.md records which build is active.

---

## S10. Electron startup and dev reload

**Read:** `desktop/src/main.js` window creation, load and dev-watcher sections (`grep -n 'show\|ready-to-show\|reloadIgnoringCache\|loadFile' main.js`).

**Do:**

1. Show the window on `ready-to-show` instead of calling `show()` immediately, with a short timeout fallback.
2. Dev watcher: reload with cache (or hot-swap CSS only) instead of `reloadIgnoringCache`, so saving a file does not re-download the 12.5 MB cat.
3. Load the Lottie script only when a view that needs it mounts.
4. Optional second step, only if the first three are done: replace the two-page startup (`loading.html` then `index.html`) with one document and a loading overlay. Stop and ask before doing this one if it touches the backend health logic.

**Verify:** `node --test desktop/tests` files that name `main.js` window options, if any; otherwise manual launch.

**Done when:** the app launches without a white flash and a dev save reloads quickly.

---

## S11. Progress screen

**Depends on S1. Read:** `getLearningOverview` in `desktop/src/ui/services/study_client.js` and its backend route and response schema; how `study.js` opens sub-screens.

**Do:**

1. Add a Progress sub-screen reachable from the Study screen (not the dock). Show only fields the API already returns: accuracy by level and by format, weak areas, time per section, and any streak or count it provides. Do not invent metrics.
2. Add an empty state for no history. Use existing cards and pills.
3. Put formatting helpers in a small module and test them.

**Verify:** `node --test desktop/tests/study_progress.test.js` (create).

**Done when:** with real data the screen renders, with none it shows the empty state.

---

## S12. Mistakes notebook

**Depends on S1. Read:** the Mistakes Review mode code in the practice backend (`grep -rn 'mistake' backend/app/api/study backend/app/study | head -20`) and `study.js`.

**Do:**

1. Check whether a read-only list endpoint exists. If not, add `GET /practice/mistakes` with filters for level, format and limit, returning question id, rendered prompt (`prompt_html`), your answer, the correct answer, explanation and time.
2. Add a Mistakes sub-screen from Study: a filterable list, a detail view with the explanation, and a button that starts a practice session from the selected mistakes.

**Verify:** `pytest backend/tests/test_study_mistakes_api.py -q` (create) and a node test for the list filter helper.

**Done when:** wrong answers from a practice session appear in the list and can be re-practiced.

---

## S13. Question bank browser

**Depends on S1. Read:** `searchQuestions` and `getQuestionProvenance` in `study_client.js`; the bank routes `GET /bank/questions`, `/bank/questions/{id}`, `/provenance`, and `POST /bank/questions/{id}/reports`.

**Do:**

1. Add a Bank sub-screen from Study: list with level, format and status filters and paging; a detail drawer showing the rendered question, choices, answer, provenance and verification status.
2. Add a report-defect action using the existing reports endpoint. Editing questions is out of scope (revisions are sealed).

**Verify:** `node --test desktop/tests/bank_browser.test.js` (create, for filter and paging helpers).

**Done when:** you can find a question, see where it came from, and report it.

**Out of scope:** importing PDFs or web pages. That belongs to a separate plan.

---

## S14. Exam pause, resume, session recovery

**Read:** `pauseExamSection`, `resumeExamSection`, and the practice get and abandon methods in `study_client.js`; their backend routes; `test.js` session start and end.

**Do:**

1. Wire a Pause control to `pauseExamSection` and a Resume path to `resumeExamSection` using the existing exam UI.
2. On opening Study, check for an active practice or exam session. If one exists, show a card with Resume and Abandon (abandon through the existing call).
3. Put the recovery decision (resume, offer, ignore stale sessions older than a set age) in a pure function and test it.

**Verify:** `node --test desktop/tests/session_recovery.test.js` (create).

**Done when:** closing the app mid-exam and reopening offers to resume at the right section with the timer paused.

---

## S15. Practice setup by category and format

**Depends on S1. Read:** `createPracticeSession` call and its backend request schema; `GET /bank/summary`; the practice setup UI in `study.js`.

**Do:**

1. Add category and format selectors to the practice setup, using the existing pill pattern. Show the number of eligible questions before starting.
2. If the backend request has no category or format filter, add optional parameters with defaults that keep current behavior.
3. Replace the exam setup's loose format matching (`startsWith`, `includes`) with exact code comparison.

**Verify:** `pytest backend/tests/test_study_practice_engine.py -q -k filter` plus a node test for the eligible-count helper.

**Done when:** you can start a grammar-only N4 session and the count shown matches the session size cap.

---

## Parking lot (needs the user's confirmation before any agent touches it)

- Dock pill width animation moved to a compositor-friendly transform (FINAL component).
- Kanji accordion `grid-template-rows` animation (FINAL; cheap today).
- Any new dock item or new top-level tab.
- Real segmentation for the vocab tokenizer through Yomitan or `kiroku_dictionary`, and the remaining `reference_only` grammar points beyond the first 30.
- Splitting `main.py`, `home.js`, `vocab_main.js` and `bundle.css`. Do these opportunistically inside the slice that already edits them, never as a standalone refactor.
