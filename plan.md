# Kiroku Desktop: UX audit and implementation plan

Audited the pushed repo (`main`, commit `6140a53`, desktop shell under `desktop/src/ui`). If your local copy is ahead of GitHub, some findings may already be fixed. I read all eight views, the router, shell, CSS, preload, both API clients, and compared them against the backend routes. I could not launch Electron in the sandbox, so animation causes below are from reading code and ranked by confidence. Confirm them with the DevTools Performance panel before refactoring.

## 1. Your problems, with root causes

### Vocab does not use the known / should-know backend

The backend already has a lot: a `known_words` table, mined-word tracking, a learner JLPT level (`get_learner_jlpt_level`, default N4), an OpenJLPT vocab and kanji dataset, `/api/jlpt/batch`, and `/api/subtitle/annotate`, which tokenizes any text and tags every token `should_know`, `mined`, or `unstyled`. The desktop Vocab view loads `/api/known-words` into a Set and uses it for one thing: flipping a button between "Mark Known" and "Known Word". The tokenizer, the learner level, the JLPT batch lookup, and card stats are never called. So the page is a search box plus an Anki form, and the thing that makes Kiroku smart is invisible.

### Grammar is a stack of six cards shaped like an API response

Header with caps eyebrow, title and subtitle; analyzer card; black token card; detail card; syllabus card; distribution bar. All of it is on one scrolling page, with 12 bilingual labels ("Learning (学習中)"), a "Click any token" hint, and a distribution bar that shows "-- / -- MASTERED" until data arrives. Nothing tells you what to do first. The data layer is good (analyze, syllabus, mastery PATCH, encounters are all wired). The page structure is the problem.

### Test and Study have no modes, and they create sessions just by being opened

`TestView.mount()` calls `loadExamSession('N3')` and `StudyView.mount()` calls `createPracticeSession('N3', 10)`. Opening the tab creates a real server-side session and starts a countdown. Every visit leaves an abandoned session in history and analytics. The backend can do much more than the UI asks for:

- `POST /practice/sessions` accepts `level`, `category`, `format_code`, `question_count`, and `session_type` (`practice`, `casual`, `drill`, `trouble`, `review`, `weak_area`, `bookmarked`), plus `incorrect_only` and `bookmarked_only`.
- Adaptive selection already deprioritizes questions you rated Easy twice in a row.
- `/bank/summary` returns per-level counts, `/exam/readiness` and `/exam/blueprints/{level}` describe what an exam needs, and there is pause/resume, exam history, analytics, bookmarks, and incorrect-history.

The desktop `studyClient` never calls `getBankSummary`, `getExamReadiness`, `getLearningOverview`, `getSettings`, pause or resume. It has no methods at all for weak-area, bookmark, or incorrect sessions, analytics, or history. The mode chooser you expected does not exist because the UI never asks.

### Kanji shows everything at once

Five stacked regions: search card (input, button, six level pills, a chip row), a stroke engine card titled "KanjiVG Stroke Order Engine", a hero card (glyph, JLPT pill, grade pill, meanings, frequency rank), a readings table with a radical row, and a compounds card. Plus a mascot slot. The useful part is the stroke player and the compounds-to-mine list. Everything else is metadata competing with them.

### Animations feel rough: ranked causes

1. **The page transition animates the entire viewport.** The router calls `startViewTransition` and styles only `::view-transition-*(root)`. Nothing has a `view-transition-name`, so the fixed top chrome and the bottom dock are part of the snapshot and slide 24px with the content. (High confidence.)
2. **Views unmount and rebuild with `innerHTML`, then fill in after async fetches.** Grammar has 16 `innerHTML` writes, Kanji 11, Test 11, Study 10. Every state change (next question, selecting a token, switching a level) replaces the DOM, so there is no element continuity to animate, focus and scroll reset, and content pops in after the transition ends. (High.)
3. **The slide is 24px at 0.22s with a fade.** That reads as a flicker, not as moving between places. (High.)
4. **Press effects animate `box-shadow`.** The hard-offset shadow design animates a paint-triggering property and an 80ms `ease-out` is too short to be perceived as motion. Hover also translates by 1px. (Medium.)
5. **Question to question is an instant swap** in Test and Study, with no enter or exit. Timers and feedback use nine ad-hoc `setTimeout` calls. (High.)
6. Only two `@media` breakpoints families exist for 2,302 lines of CSS, so the window-resize behavior you will use (normal and full-size) is under-designed. (Medium.)

### The mascot is colorless because the asset is a black silhouette

`svg_cat.svg` is a traced single-fill `#000000` shape drawn on a `#141311` background. There is no face, no eyes, and nothing to separate it from the ground, so only the drop-shadow shows. Two assets already in the repo are better starting points: `Black Cat Green Eyes Peeping.svg` (body `#20272c`, eyes `#d8a300`) and `Cat typing.svg`. Dark cats on a dark app need a lit stage and a rim light, covered in section 3.

## 2. More issues I found

- **Raw placeholder text is rendering.** `renderAssetSlot` emits `[MASCOT: kanji-stroke-observing]` and similar for five slots (Kanji, Test, Study, Vocab, Settings), and there is no CSS for `.mascot-slot` anywhere. Those literal strings are on screen today, and the Grammar cat SVG has no size rules.
- **Keydown listener leak in Study.** `loadPracticeSession`'s `finally` block runs `this.handleKeyDown = this.handleKeyDown.bind(this)` after the listener was added. `unmount()` then removes the new function, not the registered one, so every visit to Study leaves a live handler behind. The same `finally` also resets `activeBlobUrls = []`, so audio blob URLs are never revoked.
- **The identity is still the extension's.** Tokens are "Sumi & Washi": vermilion, ink, paper, hard offset shadows on everything. You said the desktop app should have no relation to the extension look. The tokens file also carries about 70 unused underscore-named Stitch variables.
- **Bilingual labels and caps eyebrows everywhere.** About 43 labels pair English with Japanese ("Mine to Anki (新規単語)", "Tokenized Structure · 構文解析"). You decided on English-only labels. There are also uppercase mono eyebrows and many middle-dot meta strings.
- **The playful font will not render English.** `Mochiy Pop One` and the Zen fonts are bundled as Japanese subsets only, so Latin text in display styles falls back to a system sans. Your "fun" display type works only on kana and kanji.
- **Everything is a bordered card.** `.tactile-card` wraps all sections with the same border and offset shadow, so there is no hierarchy between what you press, what you read, and what is background. That is what makes it feel like a SaaS kit.
- **Navigation.** Home has no destinations; the dock is the only way anywhere. History hides behind a small button inside Vocab. The 1 to 6 number-key navigation is disabled on Test and Study, which is right, but nothing replaces it.
- **Nothing shows how much you have done.** Cards, grammar, practice, and exam data all exist; there is no Stats screen.

## 3. Design direction (checked against the brief)

**Idea:** Kiroku is a black cat's night study nook. The app should feel closer to a handheld game or sticker book than a tool: chunky things you press, flat black reading surfaces, one character who reacts to you.

**First draft, and what I changed.** The first draft kept hard-offset sticker cards everywhere and made Home a grid of six tiles. That is the SaaS-card kit and a dashboard in costume. Revised: only pressable things are chunky; reading surfaces are flat pitch black with no border; everything else sits on the ground with no box. Home is no longer a grid; destinations are small objects around the cat.

### Tokens

- Color
  - Soot `#000000`: reading surfaces (dictionary, kanji stage, passages, question prompts)
  - Truffle `#26170D`: app ground, a deep chocolate, not near-black
  - Milk `#FFF1DC`: text and light surfaces
  - Marmalade `#FF8A1F`: primary pressables
  - Cat-eye `#F2C230`: eyes, highlights, "should know"
  - Matcha `#9ACD5B`: known, correct
  - Cherry `#FF5C7A`: wrong, error (semantic only)
  - Palettes are derived from the two you liked (Spiced Mocha, Choco Truffle) but brightened so they read as playful and keep contrast. Verify AA contrast for Milk on Truffle and Soot, and for Soot text on Marmalade, before locking.
- Type
  - Latin display: DynaPuff (OFL, puffy, chunky)
  - Japanese display: Mochiy Pop One (already bundled)
  - Body and UI: Zen Maru Gothic (rounded; Latin and Japanese in one family)
  - Headwords and kanji stage: Klee One (pen-written, textbook-like, suits stroke order)
  - All vendored as local woff2; the app is offline. Check each license file into `assets/fonts` as you do now.
  - Scale: 12 / 14 / 16 / 20 / 28 / 44 / 72. Body lines under 70 characters.
- Shape and press
  - Pressable: thick outline, solid color, 3px "lip" underneath drawn as a pseudo-element. Pressing translates the face down into the lip, using transform only.
  - Reading surface: flat Soot, large radius, no border.
  - Level stickers N5 to N1 are a fixed five-color set used identically everywhere.
- Motion
  - Durations 90 / 160 / 280 / 480 ms. Spring feel via CSS `linear()` easing (Electron 34 ships a Chromium that supports it).
  - Animate transform and opacity only.
  - Motion answers actions: press, correct, wrong, save, flip, stroke draw. No entrance fade on sections.
  - One orchestrated moment: the cat on Home.
- Icons: a hand-built pixel icon set on a 16px grid with `shape-rendering: crispEdges`, about 14 icons. No emoji, per your AGENTS.md rule.
- Copy: English only, sentence case, plain verbs. Japanese appears only as content (the word, the example, the kanji), never as a second label.

### Principles

1. One character, many moods. The cat is the memorable thing; everything around it stays quiet.
2. Only pressable things are chunky.
3. One main object per screen: the word, the sentence, the kanji, the question.
4. Detail opens on demand, in a sheet, not stacked below.
5. Status has one color language across every screen: Matcha known, Cat-eye should know, Marmalade mined, uncolored new.

## 4. Screen designs

### Home: a launcher with the cat

```
   kiroku                                   settings

          .-moon-.        Quick add    Vocab
         (  cat   )       Grammar      Kanji
          '------'        Practice     Exam
        ~~ ledge ~~       Listening    Stats
```

- The cat sits on a lit moon disc so a black body reads, with a 2px Milk rim light at about 35% opacity and Cat-eye eyes.
- Destinations are small, slightly tilted stickers (pixel icon plus one word, no big buttons), each with its own idle micro-motion (a pencil nudge, a bell wobble). Hovering one makes the cat look toward it; pupils follow the cursor otherwise.
- Narrow window (about 500x750): the cat on top, stickers in two columns beneath. Wide window: cat left, stickers right. Both use container queries, not viewport media queries.
- The speech bubble stays but says something useful ("12 words waiting for Anki") or nothing.
- The bottom dock becomes icon-only, with the cat head as Home and labels on the active item only. It gets its own `view-transition-name` so it never moves.

### Vocab: the word desk

- Top: one search field that types romaji to kana live (keep WanaKana and the あ / ア / A mode), with a small switch beside it: **Word | Text**.
- **Word** mode: the headword large (Klee One), reading, pitch, and a status sticker from the shared color language. Status comes from known words, mined cards, the JLPT level for that word, and your learner level. The known toggle gets a small pop. Senses sit on a Soot surface. "Add to Anki" opens as a drawer with fields prefilled; one primary action, "Save card", which saves locally first and then tries Anki.
- **Text** mode: paste a paragraph; `/api/subtitle/annotate` colors every token by status. Click a token to jump to its word. This makes use of the should-know and mined logic the extension already has.
- A small "I'm at N4" stepper in the header sets the learner level.
- A quiet shelf under the desk, "Should know, not yet seen": words at or below your level that you have neither marked nor mined (needs the new endpoint below).
- History stays reachable from a visible button, not hidden.

### Grammar: the sentence lab

- Empty state: the typing cat, a sentence box, and one sample sentence in a speech bubble.
- After analysis: the sentence set large; matched patterns are underlined in their level color. Tapping one slides a side sheet in from the right (pattern, one-line meaning, formation as small chips, two examples, "seen N times", and a three-state segmented control New / Learning / Got it).
- Second tab, **Patterns**: level pills and search on top, rows with a mastery dot, one thin progress line under the pills ("N4: 23 of 60 got it"). The distribution bar and all captions go away.
- Optional button in the sheet: "Explain this sentence" using `/api/llm/ask`, shown only when an LLM is configured.

### Kanji: the trace table

- The stage: a big Soot surface with the kanji drawn as a ghost; tap to animate strokes, scrub with stroke dots instead of a slider.
- Under it: meaning on one line, On and Kun readings as two chips. Radical, grade, rank, and the JLPT detail tuck into one info popover.
- Compounds below, five rows with a mine button each, "Show more" for the rest.
- Browse is a **kanji wall**: a grid of tiles by level (one segmented control), tinted by how many of your cards contain that kanji. That is the actual reason to open this screen: seeing what you have and have not met.
- Later: a stroke-order quiz that reuses the KanjiVG data (front-end only).

### Practice: two doors, nothing starts until you press Start

One "Practice" entry replaces Test and Study as a pair of choices:

- **Casual:** level chips with counts from the bank summary (zero-count levels disabled), format chips, count 5 / 10 / 20, and a session type: Fresh, Weak spots, Bookmarked, Mistakes. All map to existing request fields. No clock.
- **Exam:** level, a readiness line from `/exam/readiness`, section timings from `/exam/blueprints`, a resume card if a session is paused, and the last results from `/exam/history`. Start requires a confirm.
- **In session:** one question at a time, prompt on Soot, four chunky answer keys with 1 to 4 hotkeys. Casual: correct pops Matcha, wrong shakes once in Cherry and opens the explanation; then three small faces for Easy / Normal / Hard that feed the adaptive scheduler. Exam: no feedback until submit, per-question timing, a flag, and the question palette behind a "Q 12 of 40" button.
- **Results:** cat pose chosen from the score; per-section time; the estimate is labeled an estimate, never official.

### Stats: the notebook

Not a dashboard. A paw-print calendar (one stamp per study day), a line on cards mined and waiting for Anki, grammar got-it count per level, practice accuracy by format, and exam history. A single scroll, no tiles.

### Settings

Group into four sections with English-only labels (Anki, Dictionary, OCR, AI). Keep the diagnostics. Mascot is the mechanic pose.

## 5. Mascot system

- One layered SVG per pose on a shared 512x512 canvas, with consistent ids: `#head #ear-l #ear-r #eye-l #eye-r #pupil-l #pupil-r #tail #paw-l #paw-r #body`, and set `transform-origin` on each. Then blinking, tail sway, and cursor-tracking pupils are CSS and a few lines of JS. This is cheaper and smoother than Lottie for idle motion; keep Lottie only for the results celebration, or drop `lottie.min.js`.
- Poses: sitting (Home), typing (Grammar), peeping (Kanji), reading (Vocab), proctor (Exam), cheer (Practice), celebrating (Results), sleeping (empty states), confused (errors).
- For your Pinterest collection: use them as reference and redraw or commission your own versions. Most of what is on Pinterest is not licensed for reuse, and your own layered files are what the animation system needs anyway.
- Every pose has a lit stage behind it (moon disc, cushion, or lamp glow) so black on Truffle reads.

## 6. Backend gaps

**Wired in the backend but missing in the desktop client:**

- Weak-area, bookmark, and incorrect-history sessions; bookmarks endpoints; analytics and learning overview; bank summary; exam readiness, blueprints, history, pause and resume.
- `/api/subtitle/annotate` for pasted text; `/api/jlpt/batch` for word levels.
- `/api/llm/ask` (the extension has Ask; desktop has none).
- `/api/ocr/recognize` for drop-an-image-to-mine.
- `/api/cloud/pull` and `/api/cloud/poll` for the phone queue inbox.
- The bank import preview and commit endpoints (your PDF, website, and paste flow).

**New backend work needed:**

1. `GET /api/vocab/gaps?level=` returns OpenJLPT words at or below the level that are not in known or mined. Powers the shelf and a drill source.
2. `GET /api/vocab/coverage` returns known, mined, and total per level.
3. `GET` and `PUT /api/learner` for level and preferences. Today the level is read from the LLM config keys, which is the wrong home for it.
4. `GET /api/known-words/detail` returning level, source, and created\_at, plus bulk mark (paste a list or an Anki export). The current endpoint returns bare strings.
5. `GET /api/kanji/seen` returning kanji found in mined cards and known words, with counts, for the wall.
6. `GET /api/activity/daily` aggregating cards created, practice attempts, and grammar encounters per day, for the paw calendar.
7. Grammar to bank bridge: filter bank questions by grammar pattern key and start a "practice this pattern" session. I did not confirm whether the bank query already supports a pattern filter; check, and add it if not.
8. Undo window for destructive actions such as bulk delete (client-side delayed commit is enough).

A Listening screen also needs an audio component (replay count, speed); the media endpoint exists.

## 7. Implementation phases

Each phase is independent enough to hand to a coding agent as its own prompt, in this order.

### Phase 0: fixes that do not need redesign

- Remove or hide `[MASCOT:...]` placeholders; size the Grammar cat.
- Fix the Study listener rebind and blob URL reset.
- Stop creating sessions on mount in Test and Study; show a temporary chooser.
- Name the dock and top chrome as separate view transitions so they stay put.
- Copy pass: English-only labels, sentence case, remove caps eyebrows.
- **Done when:** no `[MASCOT:` text in the DOM; opening Practice triggers zero POSTs (add a test); the keydown listener count is stable after 20 tab switches; a frame capture shows the dock stationary during navigation.

### Phase 1: design system v2

- New tokens, vendored fonts, press component with the lip, pixel icon set, motion tokens.
- Delete the unused Stitch variables; split `bundle.css` into per-view files; remove the universal card border.
- **Done when:** no view uses the old vermilion or ink tokens; every pressable uses the one component; Latin display text renders in DynaPuff in a screenshot test.

### Phase 2: mascot system and Home

- Layered pose SVGs for sitting, typing, peeping; the lit stage; blink, tail, and pupil tracking; sticker launcher; icon-only dock.
- **Done when:** the cat is clearly visible at 500x750 and 1920x1080; navigating to any destination takes one click; with reduced motion on, nothing loops.

### Phase 3: Practice hub

- Casual and Exam choosers wired to bank summary, readiness, blueprints, history, and the session types; in-session motion; results.
- Add the missing `studyClient` methods.
- **Done when:** nothing is created before Start; Weak spots, Bookmarked, and Mistakes sessions start correctly; exam shows no feedback until submit; resume works after a restart.

### Phase 4: Vocab desk (with backend items 1 to 4)

- Status language, Word and Text modes, learner level stepper, shelf, drawer for Anki.
- **Done when:** a pasted paragraph is colored by status with correct precedence (should know over mined); toggling known updates the paragraph without a reload; the shelf lists only unseen words at or below the learner level.

### Phase 5: Grammar lab

- Sentence-first flow, side sheet, Patterns tab, progress line, optional explain.
- **Done when:** analyzing a sentence and opening a pattern is two interactions; the sheet slides without a full re-render; keyboard focus returns to the token on close.

### Phase 6: Kanji trace table (with backend item 5)

- Stage, chips, popover, compounds, wall.
- **Done when:** the default screen has at most three regions; the wall tints from your cards; the stroke animation holds 60 fps.

### Phase 7: Stats, Listening, Import, Cloud inbox, Ask (with backend items 6 to 8)

- Build in that order; each is a small screen and a separate prompt.

### Phase 8: motion and performance pass

- Profile every tab switch and question change: no task over 50 ms, no layout shift after the transition ends, press effects on the compositor.
- Test at 500x750, 1280x800, and 1920x1080 with screenshots; keep `verify_ui_playwright.py` current.
- **Done when:** reduced-motion mode removes all non-essential movement but keeps state changes legible.

## 8. Technology recommendation

Stay with the plain ES modules for the shell, Home, and Settings. For the stateful views (Practice, Grammar, Vocab) adopt Preact with htm, vendored as local files with no build step, and mount them from the existing router. The router can host both kinds during migration, so you move one view at a time and never rewrite all eight. The reason is item 2 in the animation causes: patching state in place is what makes the question-to-question and token-to-sheet motion possible. If you would rather not add a runtime, a 3 KB DOM-morphing helper achieves most of the same continuity.

## 9. Open questions

- Do you want Test and Study merged into one "Practice" tab as proposed, or kept as separate dock items with the chooser inside each?
- Is the dock allowed to go icon-only, or do you want labels always visible?
- Should the cat react to answers (nod, flinch), or stay calm during exams?
