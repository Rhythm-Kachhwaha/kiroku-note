Completed : 1, 2, 3, 4, 5, 6, 7, 8
# KIROKU PLAN (agent-only; terse)

## LOAD PROTOCOL (read this header only, then your slice)
User says "do slice N" -> run ONE command, read its output, nothing else from this file.
PowerShell:
`$n=N;$s=$false;$p=$false;Get-Content implementation_plan.md|%{if($_ -eq '---SLICES---'){$s=$true;return};if(!$s){$_;return};if($_ -match '^(## SLICE |# PART)'){$p=($_ -match "^## SLICE $n ")};if($p){$_}}`
bash:
`awk -v n=N '/^---SLICES---$/{s=1;next} !s{print;next} /^(## SLICE |# PART)/{p=($0 ~ "^## SLICE "n" ")} p' implementation_plan.md`
Then: read AGENTS.md -> IGNORE.md -> the slice's `read:` map -> `own:` files. Nothing else.

## GLOBAL RULES
- One slice. No next slice. Touch only `own:` files (+ new files in own dirs). Needing another file = stop, report.
- agents must verify the current code before implementing a slice, because earlier slices can make later evidence stale.
- ANIMATIONS: never reduce, remove, shorten, simplify or add "reduced" variants. Existing `prefers-reduced-motion` code stays untouched. Perf work may change drivers only.
- FINAL (byte-identical, never edit): Bottom Dock (`shell/bottom_dock.js`, dock rules in `shell/shell.css`) and Kanji Mastery block (`kanji.js` mastery section + its CSS). Home page and dock items untouched. New screens open from existing screens.
- UI: English labels, no emoji (SVG/plain text), tokens from `tokens.css` only (no raw hex), `--ease-*` tokens, no micro-pills in buttons/headings, badges = real metadata only.
- New backend routes: new file `backend/app/api/<area>.py`, auto-registered (after slice 2). New schemas: new `backend/app/schemas_<area>.py`. Never edit `main.py`, `schemas.py` (exceptions named in slice).
- Never edit `desktop/tests/fixtures/openapi.json`; slice 49 regenerates it. Run only named tests.
- Python deps: pin in `backend/requirements.txt`, add license line to `THIRD_PARTY_NOTICES.md`.
- Tests: backend `$env:PYTHONPATH='.;backend'; python -m pytest <file> -q`; JS `node --test <file>`. Never full suites.
- Commit: `type(scope): summary [K<n>]` (type = feat|fix|test|docs|refactor|perf|chore; summary <=60 chars, imperative, specific).
- STATUS.md: replace your line, max 5 lines total. Final report <=5 lines: changed, tests, risks.
- Not independently verified by planner: Electron UI visuals (no screenshots taken). Verify visually only if slice says.
- on top of this plan, write the slice that has been completed. (example : "Completed : 1,2,3")

## PHASES / PARALLEL LANES
Lane = one agent at a time. Different lanes may run simultaneously if their `own:` sets are disjoint (they are, by design).
- P0 (merge in this order inside lane): BE lane: 1 -> 2. FE-CSS lane: 4 -> 5 -> 6. QA lane: 3. DOC lane: 7. (BE, FE-CSS, QA, DOC run in parallel.)
- P1 (needs P0 done): TOK: 8 -> 9 -> 10 -> 11. GRAM: 12 -> 13. (14 needs 10+12.) KANJI-BE: 15. PDF: 16 -> 17. SEC: 18. All parallel.
- P2 (needs 6; each view lane parallel): VOCAB-FE 19 (needs 10). GRAM-FE 20 (needs 14). KANJI-FE 21 (needs 15). STUDY-FE 22 (needs 17). TEST-FE 23. SET-FE 24.
- P3 gamification: JRN-BE 25 -> 26 -> 27 -> 28. JRN-FE 29 -> 30 -> 31 (needs 22, 25-28). 32, 33 (needs 24), 34 after 29.
- P4 link: 35 first (spec+fixtures). Then parallel: LINK-BE 36 -> 40; EXT 37; DESK-FE 38 -> 39 (needs 19). THEATER 42 -> 43 (own main process). 41, 44, 45, 46, 47 after deps.
- LAST (serial): 48 extension split (needs 37,41), 49 integration.
Hot shared files and sole owners: `desktop/src/preload.js` + `main.js` IPC allowlist -> slice 2b-edit lives in slice 3? NO: owned by slice 38 only (adds `/api/link`, `/api/journey` prefix passthrough once). `desktop/src/ui/router.js` -> nobody (views register inside own file). `bundle.css` -> after slice 4 nobody edits it (it becomes @import list). `docs/maps/*` -> each slice edits only its own map.
Never run together: 8 with 10 (same file) - already chained. 22 with 29 (same view) - chained by deps.

---SLICES---

# PART A - FIXES

## SLICE 1 | Backend test hygiene
lane: BE | deps: - | read: docs/maps/study.md
own: backend/tests/**, backend/pytest.ini (new), backend/tests/conftest.py
evidence: backend run = 17 failures: 4 network (test_study_m5b_pipeline, Keenable fetch), 5 Windows-only (`ctypes.windll` in test_llm_settings_api/test_llm_service), 4 cwd-relative paths/missing artifacts (test_study_acquisition_m7b), 1 stale CORS test (R7 made extension origin legacy-only), 3 real tokenizer regressions (do NOT touch; slices 9/10).
do:
1. pytest.ini: markers `network`, `windows`; default `-m "not network"`.
2. Mark m5b tests `network`; mark windll tests `windows` + `skipif(sys.platform!='win32')`.
3. m7b: build paths from `Path(__file__)`; if committed artifact absent, `skip` with reason (do not fabricate data).
4. CORS test: set the legacy extension-origin env/config used by `get_allowed_origin_regex` in the fixture; assert allowed. Add test: default config rejects extension origin.
5. Leave tokenizer-regression tests failing (expected until 9/10).
test: `test_study_api_security_and_media.py`, `test_study_acquisition_m7b.py`, `test_llm_settings_api.py` (llm files edit = markers only, no logic).
done: only the 3 tokenizer tests fail in a backend run on Linux.

## SLICE 2 | Router auto-registry + main.py split
lane: BE | deps: 1 | read: docs/maps/study.md
own: backend/app/main.py, backend/app/api/** (new files), backend/app/api/registry.py (new)
evidence: main.py 1519 lines (routes inline); every new feature would collide on it.
do:
1. `api/registry.py`: `discover_routers()` imports every `app/api/*.py` exposing `router`; main.py includes them.
2. Move inline routes of main.py into `api/system.py` (health, pairing, diagnostics), `api/capture.py`, `api/known_words.py` by area. Pure move: same paths, methods, response models, middleware order.
3. Keep middleware/CORS/auth in main.py. No behavior change.
test: `python tools/export_openapi.py` output equals `desktop/tests/fixtures/openapi.json` paths set (diff only ordering). Run `backend/tests/test_subtitle_routes.py`, `test_grammar_routes.py`.
done: main.py < 500 lines; OpenAPI path set identical.

## SLICE 3 | JS stale tests + source-grep policy
lane: QA | deps: - | read: docs/maps/desktop-views.md
own: desktop/tests/**(except fixtures/openapi.json), extension/tests/**
evidence: desktop 8/159 fail (home x4 stale vs redesign, grammar source-string test, contract drift [slice 49], electron lifecycle/real-transport need display), extension 5 fail + 3 cancelled (sidepanel subnav/emoji/hero tests stale). 471 desktop assertions are source-substring checks; 20/32 desktop and 68/81 extension files read source text.
do:
1. Fix/replace the 4 stale Home tests to assert current DOM only (do not edit home.js).
2. Extension 5 failing tests: decide per test whether code or test is stale by reading git log -3 for the file; fix test unless code violates AGENTS/ui-rules.
3. Electron lifecycle/real-transport: `skip` when `process.env.DISPLAY`/no GUI (Linux CI) with reason; keep on win32.
4. New helper `desktop/tests/helpers/dom.js` (jsdom-free minimal fake DOM already used? reuse existing pattern) - for NEW tests only. Write `docs/maps/testing.md` (10 lines): prefer behavior tests; source-substring tests only for locked FINAL files.
5. Do not mass-rewrite the 471 assertions.
test: the changed files only.
done: no failures except contract drift + GUI-skipped.

## SLICE 4 | Split bundle.css per view
lane: FE-CSS | deps: - | read: docs/maps/ui-rules.md
own: desktop/src/ui/styles/**, desktop/src/index.html, desktop/tests/design_tokens.test.js (path fixes only)
evidence: bundle.css 6297 lines, hand-edited, 39 commits of churn, no build step; any two UI agents conflict.
do:
1. Create `styles/views/{shared,vocab,grammar,kanji,study,test,settings,home,shell-extras}.css`. Move rules verbatim by selector ownership (grep selector prefixes). Dock rules stay in shell.css. Kanji Mastery rules move byte-identical into `views/kanji.css` under a `/* FINAL:KANJI-MASTERY START/END */` marker pair.
2. `bundle.css` becomes ordered `@import` list preserving original cascade order (verify by diffing computed rule order: concatenation of imports == original after whitespace normalize).
3. Handmade utility classes (`.text-warm-paper`, `.font-bold`, `.mt-1`...) -> `views/shared.css` section `UTILITIES`.
4. Update tests that read bundle.css text to read the concatenated imports.
test: `desktop/tests/design_tokens.test.js`, `screen_kanji.test.js`, `verify_dock_animation` (py, if runnable).
done: zero rule text changes; visual no-op.

## SLICE 5 | FINAL lock test + restore design ledger
lane: FE-CSS | deps: 4 | read: docs/maps/ui-rules.md
own: desktop/tests/final_lock.test.js (new), docs/maps/ui-rules.md
evidence: design_decisions.md deleted in a7add90; lost palette-role map, exact FINAL specs, change protocol. Kanji stroke commits (475650d, 260addb) touched kanji.js after FINAL.
do:
1. final_lock.test.js: sha256 of (a) FINAL marker block in views/kanji.css, (b) dock rules block in shell.css, (c) `bottom_dock.js`, (d) kanji mastery section markup function (extract by marker comments you add as no-op comments). Hashes in `desktop/tests/final_lock.hashes.json`. Test fails on mismatch with message "FINAL locked: ask owner".
2. Restore to ui-rules.md (max +30 lines): palette roles (iron-core=code/debug wells; industrial-aqua=grammar clauses/particles/N3 accents; rust-signal=errors/destructive/timer<5min; heat-marker=streak/progress/hard badge; architectural-cream=table heads/inactive pills), FINAL specs summary (dock: 6 items, pill 9999px, 1.5px stroke, 4px hard shadow; mastery: collapsed default, grid-rows 0fr->1fr 220ms, limit select 36/100/all), change protocol (FINAL change requires owner confirmation then hash update).
3. Diff `git log -p -- desktop/src/ui/views/kanji.js` since a7add90^^^ for any change inside the mastery section; report if any.
test: final_lock.test.js.
done: hashes committed from current state.

## SLICE 6 | Token pass + rule violations
lane: FE-CSS | deps: 4,5 | read: docs/maps/ui-rules.md
own: desktop/src/ui/styles/views/*.css (except FINAL blocks), desktop/src/ui/views/*.js (style strings + pill markup only), tokens.css (add tokens only)
evidence: 356 raw hex in bundle.css; inline JS style hex fallbacks (test.js:208-213,412); settings.js "Active"/"Checking..." pills in card headers (rule: no micro-tags in headings); `tactile.css` 5 hex.
do:
1. For each raw hex: map to existing token; if none, add `--name` to tokens.css. Skip FINAL blocks and dock.
2. Replace JS inline `style=` hex with classes (`.is-correct`, `.is-wrong`, `.notice-gold`) in views/test.css/shared.css.
3. Status pills inside headings -> small status dot component `.status-dot[data-state]` placed right-aligned in card header row (not inside heading text). "Active" tag removed (current level pill already shows state).
4. Add `tools/check_tokens.py`: fails on raw hex outside tokens.css/FINAL blocks.
test: `design_tokens.test.js`, `final_lock.test.js`, `screen_settings.test.js`.
done: check_tokens passes; no visible color change except pill->dot.

## SLICE 7 | Repo hygiene + agent routing
lane: DOC | deps: - | read: AGENTS.md
own: root *.md plans, docs/archive/**, docs/maps/**, AGENTS.md, STATUS.md, .gitignore
evidence: root `plan.md` 50KB, `Kiroku Note Agent Implementation Plan (Vertical Slices).md` 29KB, `Kiroku_Note_Web_Mining_and_PDF_Import_Implementation_Plan.md` 44KB, docs/design/IMPLEMENTATION_PLAN.md 51KB, docs/superpowers/plans = token magnets; `desktop/tests/verification_report.json` committed; commits like "black screen fix"/"Housekeeping".
do:
1. `git mv` the 4 old plan files to `docs/archive/plans/` (spaces removed from names). Add them to IGNORE.md pointer already covered by docs/archive/.
2. `git rm --cached desktop/tests/verification_report.json`; add to .gitignore.
3. Add maps: `docs/maps/link.md`, `docs/maps/journey.md`, `docs/maps/testing.md`(if absent) as 8-line stubs (paths + tests) and rows in AGENTS.md Route table.
4. AGENTS.md: add commit format line, and "plan slices: load via implementation_plan.md LOAD PROTOCOL".
test: none.
done: AGENTS.md < 45 lines.

## SLICE 8 | Sudachi thread-safety + shared sentence analysis
lane: TOK | deps: 2 | read: docs/maps/vocab.md
own: backend/app/services/tokenizers/**(except merge.py), backend/app/services/sentence_analysis.py (new), backend/tests/test_tokenizer_threading.py (new)
evidence: VERIFIED: 8 threads on one SudachiPy Tokenizer -> `SudachiError: Tokenizer is already in use`. `get_sudachi_tokenizer` shares one instance per variant across FastAPI threadpool; subtitle annotate + grammar analyze concurrently can 500. Annotator and grammar tokenize the same text separately (grammar unmerged, vocab merged) -> divergence.
do:
1. `SudachiTokenizer`: `threading.local()` tokenizer per thread (share the Dictionary), keep `get_sudachi_tokenizer` API.
2. `sentence_analysis.py`: `analyze(text, variant) -> SentenceAnalysis{morphemes, merged}`; LRU 2048 keyed (text, variant, merge_version). Both services will call it (14, 10).
3. Test: 16 threads x 500 calls, zero errors; cache hit test.
test: `test_tokenizer_threading.py`, `test_subtitle_annotator.py`.
done: threading test passes.

## SLICE 9 | Merge rules + lemma normalization
lane: TOK | deps: 8 | read: docs/maps/vocab.md
own: backend/app/services/tokenizers/merge.py, backend/tests/test_tokenizer_merge.py (new)
evidence: small dict splits お+茶, お+母+さん (core joins; core is 2x slower, 193MB vs 110MB per THIRD_PARTY_NOTICES) -> fix with rules, keep small default. `待てない` lemma=待てる (expected 待つ). `美味しい` -> 美味 regression (test_subtitle_routes).
do:
1. Merge 接頭辞 (お/ご/御) + following noun/adjective unit -> one unit, lemma = prefix+base; 接尾辞 (さん, ちゃん, くん, たち, 達, 的, 化, 中) attach to preceding noun unit.
2. Potential-form lemma fix: if lemma is a 一段 potential (…える) of a godan verb whose base is in OpenJLPT vocab/mined set, use the godan base. Use `kiroku_dictionary.deinflect` candidates ranked by vocab presence, not by hardcoded verbs.
3. Fix 美味しい: do not split adjective stem+しい; cover by test with 美味しい, 楽しい, 難しい.
4. No hardcoded surface lists beyond `_SEPARATE`. Do not edit annotator here.
test: `test_tokenizer_merge.py` (assert table: お茶, お母さん, 先生たち, 待てない->待つ, 美味しい), existing merge tests.
done: those pass.

## SLICE 10 | Sudachi-primary vocab annotator
lane: TOK | deps: 8,9 | read: docs/maps/vocab.md
own: backend/app/services/subtitle_annotator.py, backend/app/schemas_subtitle.py (new), backend/app/api/subtitle.py, backend/tests/test_subtitle_annotator.py, test_subtitle_routes.py, test_real_subtitles_benchmark.py
evidence: VERIFIED: `ごはんを食べる` -> ご/は/ん (vocab has 御飯, reading ごはん; no reading index, 3 hardcoded aliases). Sudachi only supplies merged predicate spans; word detection = greedy longest-match over OpenJLPT vocab (8334 words). Same lemma 見る -> N3 in `見た`, N5 in `見`. `日本語` not in vocab -> no level. Hacks: `身について`, suffix list in `_match_inflected_span`, `_EXPLICIT_ALIASES`. `dictionary_match` computed but ignored. Status precedence hides "mined" when word is also N5.
do:
1. Build cached indexes: by_word, by_norm (NFKC+hiragana), by_reading (hiragana reading -> [(word,level)]).
2. Per merged unit (from `sentence_analysis.analyze`): lookup order lemma -> normalized_form -> surface -> (kana-only unit) by_reading using Sudachi reading_form; accept reading hit only if unique or POS-compatible. Same lemma must always yield same level.
3. OOV units (Sudachi `is_oov`) keep greedy fallback only for those spans. Legacy tokenizer mode keeps old path (rename `_annotate_legacy`).
4. Unknown kanji words: add `est_level` = hardest kanji level (from kanji table) with `level_source: "vocab"|"kanji_est"`. `status="should_know"` only for `vocab`.
5. Additive response fields: `known: bool` (mined or known_words), `pos: str`, `level_source`, `est_level`. Keep `status` semantics unchanged (extension contract).
6. Delete hacks once gold (slice 11) cases pass; if slice 11 not merged yet, keep them behind `LEGACY_HACKS=True` constant.
7. Annotate endpoint: cap cues per request (500), reject larger with 413.
test: `test_subtitle_annotator.py`, `test_subtitle_routes.py`, `test_real_subtitles_benchmark.py`. Add cases: ごはん, 御飯, ご飯, お茶, 待てない, 美味しい, 日本語, 見た/見る level equality, ラーメン.
done: the 3 tokenizer regressions pass.

## SLICE 11 | Gold corpus gate
lane: TOK | deps: 10 | read: docs/maps/vocab.md
own: backend/tests/test_tokenizer_gold.py, backend/tests/fixtures/tokenizer_gold.json, tools/compare_tokenizers.py, tools/gold_review.py (new)
evidence: all 150 cases `needs_owner_review`; tests assert `expected` fields are EMPTY and `owner_reviewed == []` -> test fails the moment owner reviews anything; no accuracy gate exists.
do:
1. `gold_review.py`: fills `expected` from current pipeline as `machine_suggestion`, prints per-case diff, interactive y/n/edit writes `owner_reviewed`.
2. Rewrite tests: unreviewed cases may have suggestions; reviewed cases must match exactly (surfaces, lemmas, levels); add accuracy summary + threshold constant (start 0.90 on reviewed set, ignored when reviewed < 20).
3. Remove "expected must be empty" assertions.
test: test_tokenizer_gold.py.
done: owner can review incrementally without breaking tests.

## SLICE 12 | Grammar matcher engine
lane: GRAM | deps: 8 | read: docs/maps/grammar.md
own: backend/app/services/grammar_matcher.py, backend/tests/test_grammar_matcher*.py, backend/tests/fixtures/grammar_sentences.json (new)
evidence (VERIFIED, learner N1 probe): 雨が降りそうです -> `だ` (no そうだ); 早く寝たほうがいい -> span `いい` only; そんなことをするはずがない -> span `ない`; 合格するために毎日勉強している -> ている span starts at 合格; 歌がうまいだけでなく -> だけでなく includes うまい + false まい; `だ` matches inside です; 行かせていただきます -> false ていた/ている; なければならない also emits ば and ない. Matcher is regex over raw text; Sudachi used only for boundary checks on matches <=2 chars; token `pos` passed as one joined string.
do:
1. Add matcher type `morph`: sequence items `{lemma|surface, pos_prefix?, form?, optional?}` evaluated on Sudachi morphemes; span = first..last morpheme; start extends left only over the same predicate chain (stop at particles 助詞).
2. Boundary guard for ALL regex matches: match must start/end on morpheme boundaries; reject match fully inside one morpheme whose lemma != pattern (kills まい in うまい, だ in です).
3. Suppress contained weaker candidates: if span A strictly contains span B and B's pattern is a component (ば in なければ, ない in ならない, ている in ていただく) drop B unless `show_all`.
4. Fix spans: ほうがいい/たほうがいい start at verb; はずがない start at preceding predicate; ている start = nearest predicate head in same clause (no crossing を/に/が/は boundaries beyond the predicate chain).
5. Seed fixture `grammar_sentences.json` (20 sentences with expected pattern_key+span text):
 日本に行ったことがあります=たことがある[行ったことがあります]; 雨が降りそうです=そうだ(appearance)[降りそうです] no だ; 彼は医者だそうです=そうだ(hearsay)[医者だそうです]; 勉強しなければならない=なければならない[勉強しなければならない] no ば/ない; 早く寝たほうがいい=たほうがいい[寝たほうがいい]; この本は読みやすいです=やすい[読みやすい] no だ; 学校に行く前に=前に[行く前に]; 試験に合格するために毎日勉強している=ために[合格するために]+ている[勉強している]; 先生に褒められて嬉しかった=受身[褒められ]; 彼が来るかどうかわからない=かどうか[来るかどうか]; 忙しいのに手伝ってくれた=のに[忙しいのに]+てくれる[手伝ってくれた]; 雨が降っても行きます=ても[降っても]; 食べたり飲んだりした=たり〜たり[食べたり飲んだりした]; ごはんを食べながら=ながら[食べながら]; 歌がうまいだけでなく=だけでなく[うまいだけでなく] no まい; 行かせていただきます=使役+ていただく no ていた/ている; そんなことをするはずがない=はずがない[するはずがない]; 言わなければよかったのに=なければよかった+のに. (Items needing data from slice 13 are marked xfail until 13.)
test: test_grammar_matcher.py, test_grammar_matcher_spans.py, test_grammar_regression.py, test_grammar_acceptance_gate.py + new fixture test.
done: non-xfail fixture sentences pass; existing grammar tests pass.

## SLICE 13 | Grammar dataset: reference_only -> matchers
lane: GRAM | deps: 12 | read: docs/maps/grammar.md
own: backend/app/data/master_grammar_dataset.json, backend/app/data/master_grammar_provenance.json, backend/app/data/grammar_reference.sqlite (rebuilt), tools/build_grammar_index.py, tools/reconcile_grammar_dataset.py, tools/grammar_coverage.py
evidence: 222/900 points `reference_only` (never match) incl. のに, ので, てくれる, てあげる, てくださる/ていただく, ことにする, ようにする, させられる; たり〜たり stored as `たりたり`; 2 rows for のに; 650 `auto` matchers built from escaped variants (high false-positive risk).
do:
1. Convert reference_only rows to `morph` matchers, priority N5->N3 then N2/N1; keep `reference_only` only for genuinely non-matchable (discourse) points, each with a reason field.
2. Fix keys: たり〜たり (discontinuous), merge duplicate のに rows (keep concept_id), split そうだ properly.
3. For each `auto` matcher of length <=3 chars add guard or morph spec; list remaining ones in `docs/grammar-auto-risk.md` (<=40 lines).
4. Add 3 positive + 2 negative examples per converted point into fixture file.
5. Rebuild sqlite via tools; update coverage report; reference_only count must fall below 60.
test: test_grammar_reference.py, test_grammar_coverage.py, test_master_grammar_reconciliation.py, fixture test.
done: all slice-12 xfails pass.

## SLICE 14 | Grammar service/API
lane: GRAM | deps: 10,12 | read: docs/maps/grammar.md
own: backend/app/services/grammar_service.py, backend/app/api/grammar.py, backend/tests/test_grammar_service.py, test_grammar_routes.py
evidence: `setup_check` hardcodes `yomitan_available: False` and tokenizes "日" per call; cache stores per-level responses (24h, 1000 rows); tokens passed with joined pos string.
do:
1. Use `sentence_analysis.analyze` (shared with vocab); pass structured tokens to matcher.
2. Return `tokens` (surface, lemma, reading, pos, level, known) in analyze response (additive) for UI visualizer + Watch panel.
3. `setup_check`: report tokenizer variant/status from cached status; `yomitan_available` = real provider probe or remove field if unused by desktop (grep desktop first).
4. Bump cache key with matcher/dataset version so slice 12/13 changes invalidate cache.
test: test_grammar_service.py, test_grammar_routes.py.
done: pass; response backward compatible.

## SLICE 15 | Kanji service hardening
lane: KANJI-BE | deps: 2 | read: docs/maps/vocab.md
own: backend/app/services/kanji_service.py, backend/app/services/kanji_strokes.py, backend/app/services/jlpt_reference.py, backend/tests/test_kanji*.py
evidence: `browse` returns empty on ANY exception (violates R8 surfacing); `DICT_PATH` falls back to cwd-relative; compounds use `LIKE '%c%'` full scan; new sqlite connection per call; level from two sources (jlpt_reference vs kiroku_dict) with different shapes.
do:
1. Use `record_operational_failure` in browse; return `error` field instead of silent empty.
2. Resolve dict path via config data dir; no cwd fallback.
3. Compounds: build in-memory index once (`char -> top terms by score`) lazily with LRU; or table `kanji_compound` if dictionary builder allows (own only service; report if builder change needed).
4. Reuse one read-only connection per thread.
5. Add `get_batch(chars)` (for Vocab/Grammar drawer in 21).
test: test_kanji*.py + add: missing db -> explicit error, compounds speed (<50ms warm).
done: pass.

## SLICE 16 | PDF-1 dependency, errors, staging
lane: PDF | deps: 2 | read: docs/maps/study.md
own: backend/app/study/ingestion/staged_import.py, backend/app/study/ingestion/adapters/pdf_text.py, backend/app/study/ingestion/adapters/pdf_coordinates.py, backend/requirements.txt, backend/tests/test_study_pdf_import.py
evidence: pypdf/PyPDF2 not in requirements; `ImportError` not caught by `inspect_upload` (only ValueError/StagedImportError) -> 500; PyPDF2 deprecated; dedupe returns old metadata (stale `expires_at`, ignores `force_ocr_pages`); staging in %TEMP%.
do:
1. Add `pypdf>=4,<6` to requirements (+ notices). Prefer pypdf, PyPDF2 fallback only.
2. Wrap ImportError -> `StagedImportError("PDF support not installed")` -> 400/503 code `PDF_SUPPORT_MISSING`.
3. Dedupe path: refresh TTL, apply new force flags.
4. Stage under app data dir (`config` helper) not tempdir; cleanup on startup.
5. Page record adds `has_text: bool`, `route` unchanged. OCR routes marked `skipped_ocr` (no OCR work).
test: test_study_pdf_import.py, test_study_ingestion_adapters.py.
done: pass.

## SLICE 17 | PDF-2 text extraction + preview bridge
lane: PDF | deps: 16 | read: docs/maps/study.md
own: backend/app/api/study_pdf.py (new), backend/app/study/ingestion/staged_import.py (extend), backend/tests/test_study_pdf_text_api.py (new)
evidence: inspect returns only per-page stats; no endpoint returns text; staged file never reaches `/bank/import/preview` (pasted text/JSON only) -> PDF import is a dead end. No desktop route.
do:
1. `GET /api/study/v1/bank/import/pdf/{import_id}/pages?from&to` -> per page: markup text (ruby/underline markup from pdf_coordinates), line list with bbox, flags, route. Cap 20 pages/request.
2. `POST /api/study/v1/bank/import/pdf/{import_id}/preview` body {pages[], default_level, source_name} -> builds IngestInput(PASTED_TEXT with page markers or PDF_TEXT) and returns existing `ImportPreviewResponse`; never commits.
3. Pages with route image_only/garbled/force_ocr are excluded and listed in `skipped` with reason (no OCR).
4. Expired/unknown id -> 404 code `IMPORT_EXPIRED`.
test: new test + fixture PDF made with pypdf in test (as existing tests).
done: preview from PDF returns questions for a synthetic text PDF.

## SLICE 18 | Persisted pairing tokens
lane: SEC | deps: 2 | read: docs/maps/desktop-shell.md
own: backend/app/services/legacy_api_auth.py, backend/tests/test_legacy_api_auth*.py
evidence: tokens + pairings in memory only -> extension must re-pair after every backend restart; `KIROKU_LEGACY_TOKEN_MODE` default `off`. Link (35-47) needs stable tokens.
do:
1. Persist sha256(token) + created_at + label + scopes in SQLite table `extension_token` (main DB, same pattern as other tables); load on start; revoke deletes row.
2. Add scope `link:rw`; pairing returns scopes requested (default legacy:write only; link only if requested).
3. Do NOT change default mode; report current default to owner in final line.
test: legacy auth tests (find with grep -l legacy_api_auth backend/tests).
done: restart keeps token valid in test.

## SLICE 19 | Vocab tab placement
lane: VOCAB-FE | deps: 6,10 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/vocab_main.js, vocab_history.js, styles/views/vocab.css, desktop/tests/screen_vocab_*.test.js
evidence: segments Capture/Inventory exist; "Annotate a passage" is a collapsed block inside Capture; no known/gap/new legend; Inventory gaps shelf exists (R11).
do:
1. Segments: Capture | Inventory | Watch. Watch = empty state card "Link not connected" now (content in 39).
2. Capture: Quick Add hero first; "Read a passage" below as full section (not collapsed block): 3 token states (known = mined/known_words, gap = should_know and not known, new), legend, click token -> existing add flow. Use `known` field from slice 10.
3. Inventory: filters row (level, source, status), gaps shelf top, "Drill these" button -> opens Study Practice prefilled (query param `?words=`), no logic duplication.
4. Keep every existing animation/transition.
test: screen_vocab_main.test.js, screen_vocab_history.test.js.
done: pass; manual: 3 segments switch without reload.

## SLICE 20 | Grammar tab placement
lane: GRAM-FE | deps: 6,14 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/grammar.js, styles/views/grammar.css, desktop/tests/screen_grammar.test.js
evidence: analyzer, syllabus, visualizer, point detail on one page; "Seen in your cards" buried as 4th point-tab; source-string test fails (visualizer overlap guard).
do:
1. Segments: Analyze | Syllabus | Seen. Analyze = input + visualizer + result chips. Syllabus = level pills + list + point detail. Seen = encounters sorted by count, per-point link to detail.
2. Point detail tabs: Meaning | Formation | Examples (remove Cards tab; moved to Seen).
3. Add "Practice this" button -> Study Practice filtered by pattern_key (deep link, no inline drill).
4. Show token chips from `tokens` (slice 14) with level color via tokens (aqua for particles/clauses per ui-rules).
5. Fix/replace failing source-string test with behavior test.
test: screen_grammar.test.js, batch_c_quality.test.js.
done: pass.

## SLICE 21 | Kanji outside locked area
lane: KANJI-FE | deps: 6,15 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/kanji_drawer.js (new), styles/views/kanji-drawer.css (new), desktop/tests/kanji_drawer.test.js (new). kanji.js: NOT editable except one exported-hook line if absolutely required -> ask owner.
evidence: Kanji Mastery FINAL; kanji info is only reachable inside Kanji tab.
do:
1. Drawer component `openKanjiDrawer(char)`: strokes animation (reuse stroke player API read-only), readings, level, meanings, compounds (from `get_batch`/compounds).
2. Expose via `window.kirokuUi.openKanji` registered in own file; Vocab/Grammar/Study call it (their slices add click handlers only if hook exists).
3. "Weak kanji" row: kanji appearing in Mistakes (read from study API) with count.
test: kanji_drawer.test.js, final_lock.test.js.
done: FINAL hashes unchanged.

## SLICE 22 | Study tab placement + PDF import UI
lane: STUDY-FE | deps: 6,17 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/study.js, desktop/src/ui/views/study_import.js (new), styles/views/study.css, desktop/src/ui/services/study_client.js, desktop/tests/screen_study.test.js
evidence: study.js 1513 lines; Progress analytics duplicated with Test; import exists only as API (preview/commit) with no UI; PDF has no UI.
do:
1. Segments: Practice | Bank | Mistakes | Progress (Progress renamed Journey in 29; keep id `progress`).
2. Bank: add "Import" panel (collapsed section): drop zone (PDF, paste, JSON), PDF flow = upload -> page list (route shown as plain text, image-only pages marked "needs OCR - not available") -> select pages -> preview -> existing commit flow.
3. Mistakes: each row gets cross-links "Open grammar point" / "Open kanji" when metadata exists.
4. Split study.js: move each segment renderer to `views/study_*.js` files (verbatim logic) to cut agent token cost; no behavior change.
5. Uses study API via existing `study_api_client` path `/api/study/v1/...` (already allowed in preload).
test: screen_study.test.js, study_api_client.test.js.
done: pass.

## SLICE 23 | Test tab placement
lane: TEST-FE | deps: 6 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/test.js, styles/views/test.css, desktop/tests/screen_test.test.js
evidence: test.js 1159 lines; setup -> exam only; no history; section timing only inside results; hex fallbacks in inline style.
do:
1. Setup screen top: readiness line (pass-estimate from study progress API; honest wording "estimate, not official").
2. Add "History" section (past attempts: date, level, score, per-section pass) reading existing exam API.
3. Results: keep sectional breakdown; add "Retake weak section" -> starts section-only exam when API supports (else hide).
4. Remove inline style strings (done in 6; verify).
test: screen_test.test.js.
done: pass.

## SLICE 24 | Settings regroup
lane: SET-FE | deps: 6 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/settings.js, styles/views/settings.css, desktop/tests/screen_settings.test.js
evidence: single long page of 7+ cards ("messy"); tokenizer variant/status not surfaced anywhere; Yomitan card still first-class though Yomitan mostly removed.
do:
1. Left rail sections: Level | Dictionary & Anki | Language engine | Link | Rewards | Diagnostics. Rail = in-page anchors (scrollspy); rails for Link/Rewards render "coming" empty until 38/33.
2. Language engine: tokenizer mode (auto/sudachi/legacy), dictionary small/core with status dot, thread/ready state from `/api/health` or tokenizer status endpoint (add small route in `api/system_tokenizer.py` only if absent).
3. Yomitan card -> collapsed "Legacy dictionary provider" at bottom of Dictionary & Anki.
4. Do not touch OCR/LLM card internals (move containers only, no logic edits).
test: screen_settings.test.js.
done: pass.

# PART B - GAMIFICATION ("Your Record")
Concept: Kiroku = record. Ink (effort), Stamps (mastery book), Daily Ritual (3 adaptive quests, rest days, no guilt), Weekly Gauntlet (own worst items), Comprehension meter (anime), Seen-Again bonus. Local-only, no leaderboards, no hearts/loss pressure. All data DERIVED by read-only pulls from existing tables (no edits to card/study/grammar code). Mascot reacts; animations additive.

## SLICE 25 | Journey ledger + API
lane: JRN-BE | deps: 2 | read: docs/maps/journey.md
own: backend/app/journey/{__init__,db,models,service}.py (new), backend/app/api/journey.py (new), backend/app/schemas_journey.py (new), backend/tests/test_journey_ledger.py (new)
do:
1. Tables (main DB, create-if-not-exists like other modules): `journey_event(id, ts, kind, ref_key, ink, meta_json, dedupe_key UNIQUE)`, `journey_cursor(source, cursor)`, `journey_day(day PK, ritual_done, ink, rest)`.
2. `award(kind, ref_key, base_ink, day)`: diminishing returns (per ref_key per day: 100%,50%,0), daily soft cap 400 ink; dedupe by dedupe_key.
3. API: `GET /api/journey/summary` {ink_total, ink_today, streak, best_streak, rest_left, level_ring}, `GET /api/journey/calendar?days=120`, `GET /api/journey/events?limit`.
4. Ink table constants in one dict `INK` (mine new word 10, correct practice 3 (6 if previously missed), mistake fixed 8, grammar first seen in content 8, exam section 30, watch minute 2 cap 40/day, seen-again 5).
test: new test (dedupe, diminishing, cap, summary).
done: pass.

## SLICE 26 | Derivers (pull-based, parallel-safe)
lane: JRN-BE | deps: 25 | read: docs/maps/journey.md
own: backend/app/journey/derivers/*.py (new), backend/tests/test_journey_derivers.py
evidence: avoids editing card/study/grammar code owned by other lanes.
do:
1. `sync()` called by `GET /api/journey/summary` and every 60s by desktop; reads source rows since cursor: `cards` (READ-ONLY SQL; find schema in backend/app/db/connection.py; do not import card_service), study.db attempt/answer tables via existing `app.study` read helpers, `grammar_points`/encounter table, `known_words`.
2. One deriver per source emitting `award()`; idempotent via dedupe_key = source:id.
3. Failures logged via record_operational_failure; never raise to API.
test: derivers test with temp DBs.
done: pass.

## SLICE 27 | Quests, ritual streak, rest days
lane: JRN-BE | deps: 26 | read: docs/maps/journey.md
own: backend/app/journey/quests.py (new), backend/tests/test_journey_quests.py
do:
1. 3 quests/day chosen at first request of the day from user's state: gap words available -> "Mine 3 gap words"; open mistakes -> "Fix 5 mistakes"; grammar encountered but not drilled -> "Drill 1 grammar point"; fallback "Complete 10 practice answers"; watch available -> "Watch 10 min".
2. Ritual done = >=2 of 3 quests complete. Streak counts ritual days. Rest day: auto-use up to 2/month on a missed day, never shaming; streak display shows rest as hollow mark.
3. `GET /api/journey/quests`, `POST /api/journey/rest` (manual rest).
test: quests test (day rollover with injected clock).
done: pass.

## SLICE 28 | Stamp book data
lane: JRN-BE | deps: 27 | read: docs/maps/journey.md
own: backend/app/journey/stamps.py (new), backend/tests/test_journey_stamps.py
do:
1. Pages = domain x level: vocab N5-N1 (from OpenJLPT), kanji N5-N1, grammar N5-N1. Item stamped when: vocab/kanji in mined or known; grammar point status known OR drilled correct 3x.
2. `GET /api/journey/stamps` -> pages {domain, level, total, stamped, items[{key, stamped_ts}]} (items paged).
3. Page complete >=100% emits `journey_event kind=page_complete` once (ink 100).
test: stamps test with fixture.
done: pass.

## SLICE 29 | Journey UI (Study > Progress)
lane: JRN-FE | deps: 22,25-28 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/study_journey.js (new), styles/views/journey.css (new), desktop/src/ui/services/journey_client.js (new), desktop/tests/screen_journey.test.js (new)
do:
1. In Progress segment: Today ritual card (3 quests with progress ticks), streak + ink counters, ink calendar heatmap (120 days), "Stamp book" entry card -> opens 30. Existing Progress analytics stay below.
2. Uses `/api/journey/*`; requires preload passthrough from slice 38 -> if 38 not merged, use window.fetch to backend via existing `desktopAPI` generic request if present; else stop and report.
3. Streak flame uses heat-marker token; rest day hollow mark. Animations: count-up on ink, tick draw on quest complete (additive CSS/SVG).
test: screen_journey.test.js.
done: pass.

## SLICE 30 | Stamp book screen
lane: JRN-FE | deps: 29 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/stamp_book.js (new), styles/views/stamps.css (new), desktop/tests/stamp_book.test.js (new)
do:
1. Opens from Journey card (not dock). Pages tabs by domain; level chips; grid of hanko slots (kana/kanji/word); empty = faint outline, stamped = vermilion seal.
2. Stamp press animation on newly stamped (translate+scale+ink bleed via CSS/SVG; reuse tactile press physics).
3. Virtualize grid (>=500 items): render visible rows only.
test: stamp_book.test.js.
done: pass.

## SLICE 31 | Reward layer + mascot reactions
lane: JRN-FE | deps: 29 | read: docs/maps/desktop-shell.md
own: desktop/src/ui/shell/reward_layer.js (new), desktop/src/ui/styles/views/reward.css (new), desktop/tests/reward_layer.test.js (new). mascot_host.js: read-only; add reactions only through its existing public API; if none exists, add ONE exported `triggerMascot(name)` and report.
do:
1. Overlay container appended to body (outside dock, z-index below modals): toast "+N ink" (stack max 3, 2.2s), page-complete banner.
2. Rate-limit: max 1 mascot reaction / 20s; reactions only on ritual done, page complete, streak milestones (7/30/100).
3. No sounds here (33).
test: reward_layer.test.js, mascot_host.test.js, final_lock.test.js.
done: pass; dock hash unchanged.

## SLICE 32 | Weekly Gauntlet
lane: JRN-BE+FE | deps: 29 | read: docs/maps/journey.md
own: backend/app/journey/gauntlet.py (new), backend/app/api/journey_gauntlet.py (new), desktop/src/ui/views/study_gauntlet.js (new), tests for both
do:
1. Monday: pick 10 items from user's worst (study mistakes + overdue gap words + weak grammar).
2. Gauntlet = practice session using existing Practice engine with preset question list; completion => weekly seal (stamp type `gauntlet`) + 80 ink; fail = nothing lost, retry anytime.
3. Card in Journey: "This week's 10".
test: backend test with fixture; JS render test.
done: pass.

## SLICE 33 | Reward settings
lane: SET-FE | deps: 24,31 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/settings.js (Rewards section only), desktop/tests/screen_settings.test.js
do: toggles: reward toasts (default on), mascot reactions (on), sound (default OFF; sound files not included - toggle disabled with "no sound pack" until added), daily ritual size (2|3), reset journey (confirm modal, calls `DELETE /api/journey` - add endpoint in journey api file with test).
done: pass.

## SLICE 34 | Readiness gates + level ceremony
lane: JRN-BE+FE | deps: 29, 23 | read: docs/maps/journey.md
own: backend/app/journey/readiness.py (new), desktop/src/ui/views/study_journey.js (append), tests
do:
1. Readiness ring per level from: stamp coverage, last 3 exam estimates, accuracy last 14 days. Honest label "estimate".
2. When ring >=90% for level L: unlock "Gate L" card suggesting official-format exam attempt; passing estimate awards seal + ceremony animation (stamp press + mascot reaction).
test: backend readiness test.
done: pass.

# PART C - ANIME LINK (extension <-> desktop)
Feasibility: YES. Hub = FastAPI WebSocket on 127.0.0.1:21828. Extension SW holds WS (heartbeat 20s, backoff reconnect). Desktop renderer connects as role `desk`. Playback of DRM sites (Netflix/Crunchyroll) inside Electron NOT planned (stock Electron lacks Widevine; castLabs fork = legal/maintenance burden) -> companion mode (remote + live panel). Non-DRM (local files, YouTube, open HLS/MP4) can play inside Kiroku (Theater). Translation/LLM features out of scope.

## SLICE 35 | Link protocol spec + fixtures
lane: LINK-BE | deps: 2 | read: docs/maps/link.md
own: docs/link-protocol.md (new, <=120 lines), backend/tests/fixtures/link/*.json (new), extension/tests/fixtures/link/ (copy), desktop/tests/fixtures/link/ (copy), backend/app/schemas_link.py (new)
do: define envelope `{v:1,id,ts,type,src:"ext|desk|hub",sid,seq,payload}`; types:
- `hello{role,token,client}`/`hello.ok{sid}`; `bye`; `ack{id,ok,err}`.
- ext->desk: `video.attach{tab,site,title,duration,drm:bool}`, `video.state{t,paused,rate,vol,muted}` (<=4Hz playing, immediately on change), `cue.list{hash,cues[{i,s,e,text}]}` (chunk <=500 cues, <=1MB), `cue.active{i}`, `clip.result{reqId,image_b64?,audio_b64?}`.
- desk->ext: `cmd.play|pause|toggle`, `cmd.seek{t|delta}`, `cmd.cue{delta|i}`, `cmd.loop{s,e,count}`, `cmd.rate{v}`, `cmd.offset{ms}`, `cmd.clip{reqId,s,e,want[]}`.
- Rules: only `desk` may send `cmd.*`; payload <=64KB except cue.list; unknown type -> ack err; rate limit 30 msg/s/client; token only in `hello` (never URL).
- Pydantic models mirror this; JSON fixtures for every type (valid + 5 invalid).
test: fixtures validate against schemas_link.py (test file new).
done: spec + fixtures merged FIRST; slices 36-41 code against fixtures.

## SLICE 36 | Link hub backend
lane: LINK-BE | deps: 18,35 | read: docs/maps/link.md
own: backend/app/api/link.py (new), backend/app/link/{hub,session}.py (new), backend/tests/test_link_hub.py (new)
do:
1. `WS /api/link/ws`: Origin check (127.0.0.1/localhost, chrome-extension://<paired>, file/Electron), first message must be `hello` within 3s with token (ext: `link:rw` scope; desk: desktop control token). Else close 4401.
2. Hub: one active ext video session per tab, many desk clients; route per rules; keep last `video.state`/`cue.active`/`cue.list` per session to replay to new desk client.
3. `GET /api/link/status` {connected_ext, sessions[{tab,title,site}], desk_clients}.
4. Backpressure: drop `video.state` older than latest per session when client slow.
test: test_link_hub.py with Starlette TestClient websockets (auth fail, routing, replay, role enforcement, rate limit).
done: pass.

## SLICE 37 | Extension link client
lane: EXT | deps: 35 | read: docs/maps/link.md
own: extension/link/link-client.js (new), extension/content/link-bridge.js (new), extension/background.js (add import + message wiring only), extension/manifest.json (add files only), extension/tests/link_*.test.js (new)
evidence: video-mining-poc.js already implements seek/play/pause (lines ~1779-2460) and onMessage commands; adapters exist for YouTube/Netflix.
do:
1. background: WS client (token from pairing storage), heartbeat 20s, exp backoff 1s..30s, reconnect on SW wake; relay content messages <-> WS.
2. link-bridge.js (content): attaches to active video via existing detection exposed as `window.__kirokuVideo` (add a 5-line read-only export at end of video-mining-poc.js ONLY; no other edits), emits video.state/cue.active/cue.list, executes cmd.* by calling existing handlers; DRM site flag from adapter list.
3. Do not alter mining behavior. Offline = silent no-op.
test: node tests using fixtures (mock WS, mock video).
done: pass.

## SLICE 38 | Desktop link client + store
lane: DESK-FE | deps: 35 | read: docs/maps/desktop-shell.md
own: desktop/src/ui/services/link_client.js (new), desktop/src/ui/services/link_store.js (new), desktop/src/preload.js (ONLY: pass-through for `/api/journey` + WS URL/token getter), desktop/src/main.js (ONLY: allowlist `/api/journey`,`/api/link` prefixes near line ~726/895), desktop/tests/link_client.test.js (new)
do:
1. WS connect via `desktopAPI.getLinkEndpoint()` (returns ws URL + desktop token, main process only).
2. Store: sessions, current video state, cue list, active cue, connection status; event emitter; auto-reconnect.
3. Status exposed to Settings Link section (24) and Vocab Watch (39).
test: link_client.test.js with fake WebSocket + fixtures.
done: pass.

## SLICE 39 | Watch segment (live sentence panel + controls)
lane: VOCAB-FE | deps: 19,38 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/vocab_watch.js (new), styles/views/watch.css (new), desktop/tests/vocab_watch.test.js (new); one import line in vocab_main.js
do:
1. States: not connected (how-to pair), connected-no-video, watching.
2. Watching layout: large active line (token chips: known/gap/new colors, click = dictionary popover, add-card button), previous/next line peek, controls bar (play/pause, -5/+5, prev/next cue, replay cue, loop cue, speed, subtitle offset -100/0/+100), session header (site, title, time).
3. Analysis via `/api/subtitle/annotate` (40 prefetches); grammar chips from `/api/grammar/analyze` for current line (collapsible).
4. Keyboard: Space, Left/Right (cue), R (replay), L (loop) when panel focused.
5. Hover-pause toggle: send pause while hovering a token (setting).
test: vocab_watch.test.js.
done: pass.

## SLICE 40 | Live analysis pipeline
lane: LINK-BE | deps: 14,36 | read: docs/maps/link.md
own: backend/app/link/analysis.py (new), backend/app/api/link_analysis.py (new), backend/tests/test_link_analysis.py (new)
do:
1. On `cue.list` receipt (hash): background task annotates all cues in chunks (reuse annotator + sentence cache), stores in memory LRU by hash; `GET /api/link/cues/{hash}?from&to` returns annotated tokens + per-cue known% + gap word list.
2. `GET /api/link/cue-grammar?hash&i` cached grammar points per cue (uses GrammarService).
3. Never block WS loop (run in threadpool; uses thread-local tokenizers from 8).
test: test_link_analysis.py.
done: pass.

## SLICE 41 | Mine from desktop via link
lane: DESK-FE | deps: 37,38,40,39 | read: docs/maps/link.md
own: desktop/src/ui/views/vocab_watch.js (add), desktop/src/ui/services/link_mine.js (new), extension/link/clip.js (new), tests
evidence: card creation endpoints already exist - call them as-is; DO NOT edit card_service.
do:
1. "Add card" on token or "Mine line": desktop sends `cmd.clip{s,e,want:[image,audio]}`; extension captures using existing capture utils, returns `clip.result`.
2. Desktop posts the existing capture/card API with sentence, source title, timestamp, image/audio; on success token turns known immediately.
3. Failure -> inline error with retry; card still created without media.
test: link_mine.test.js (mock clip + mock API).
done: pass.

## SLICE 42 | Theater tier 1 (local files/open video)
lane: THEATER | deps: 6 | read: docs/maps/desktop-views.md
own: desktop/src/ui/views/theater.js (new), desktop/src/ui/lib-shared/subtitle_parser.mjs (new; port of extension/lib/subtitle-parser.js, same tests), styles/views/theater.css, desktop/tests/theater.test.js
do:
1. Opens from Vocab > Watch ("Open a video file"). `<video>` player (Electron ships H.264/AAC): file picker (mp4/mkv/webm; mkv codec limits shown as plain error), subtitle load (.srt/.ass/.vtt) + Jimaku search (port `extension/lib/jimaku-provider.js` fetch through main process), sidecar auto-detect same filename.
2. Reuses Watch panel component (same token/controls) with a local `PlayerAdapter` implementing the cmd set (so 39 UI works unchanged for both link and theater).
3. Clip capture: canvas screenshot + audio segment via MediaRecorder on `video.captureStream()`.
4. Remember last position per file hash.
test: theater.test.js + parser tests ported.
done: pass.

## SLICE 43 | Theater tier 2 (site in Kiroku, non-DRM)
lane: THEATER-MAIN | deps: 42,37 | read: docs/maps/desktop-shell.md
own: desktop/src/theater_view.js (new), desktop/src/theater_preload.js (new), desktop/src/main.js (ONLY: register theater IPC; owner lane for main.js = THEATER-MAIN after 38), desktop/tests/theater_view.test.js
do:
1. `WebContentsView` (sandbox:true, contextIsolation:true, nodeIntegration:false, partition `persist:theater`), host allowlist user-approved per site (first open asks), `setWindowOpenHandler` deny, navigation limited to approved hosts.
2. theater_preload.js exposes ONLY link-bridge (contextBridge): injects the same `link-bridge.js` logic (shared module) so extension is not needed inside Kiroku.
3. Extension button "Open in Kiroku" sends URL to desktop via link (`cmd.openTheater{url}` added to spec as optional extension).
4. DRM detection: if EME/protected media detected, show plain message "Protected video: play in browser, Kiroku will follow via Link" and keep Link companion mode. Do NOT attempt Widevine/DRM bypass.
test: theater_view.test.js (mock electron).
done: pass.

## SLICE 44 | Episode Primer + Recap
lane: LINK-BE+FE | deps: 40,42 | read: docs/maps/link.md
own: backend/app/link/episode.py (new), backend/app/api/link_episode.py (new), desktop/src/ui/views/watch_primer.js (new), tests
do:
1. Primer (before watching, when subtitle file/cue.list known): top 20 gap words (frequency in episode x not known x level<=learner+1) and top 5 grammar points; "Mine all" shortcut = adds via existing card API sequentially; 5-question mini quiz built from those words using existing dictionary glosses (no LLM).
2. Recap (on session end): lines watched, % known (before/after mining), words mined, gap words still unseen; "Review mined words" -> Study Practice deep link.
3. Persist per-episode record `link_episode(hash,title,site,known_pct,mined,minutes,ts)`.
test: backend test + JS render test.
done: pass.

## SLICE 45 | Global hotkeys + study-pause
lane: THEATER-MAIN | deps: 38 | read: docs/maps/desktop-shell.md
own: desktop/src/hotkeys.js (new), desktop/src/main.js (ONLY: register/unregister), Settings Link section strings in settings.js (add rows only), tests
do:
1. Optional (default off) `globalShortcut` map: pause/play, prev/next cue, replay cue, loop; sends `cmd.*` via link client in renderer IPC.
2. Study-pause: setting "Pause when line has >= N gap words" (default off, N=2); applies to link and theater.
test: hotkeys.test.js with mock electron.
done: pass.

## SLICE 46 | Immersion metrics -> Journey
lane: JRN-BE | deps: 29,40 | read: docs/maps/journey.md
own: backend/app/journey/derivers/watch.py (new), tests
do:
1. Deriver from `link_episode`/session ticks: watch minutes (2 ink/min cap 40/day), cleared lines (all tokens known) count, comprehension meter per episode (known% trend vs previous episode of same title).
2. Seen-Again: when a token in a cue matches a word mined >24h ago and not yet counted today -> 5 ink + event for toast (max 5/day).
3. Quest "Watch 10 min" completes from this.
test: derivers test.
done: pass.

## SLICE 47 | Link security review
lane: SEC | deps: 36-43 | read: docs/maps/link.md
own: backend/tests/test_link_security.py (new), docs/link-protocol.md (append "Threat model" <=30 lines)
do: tests: unauth WS closes 4401; wrong Origin rejected; ext cannot send cmd.*; oversize frames closed; token never logged; hub binds 127.0.0.1 only; theater webview cannot reach `desktopAPI`; DNS-rebinding host header rejected. Fix findings only inside link files; report others.
test: test_link_security.py.
done: pass.

# PART D - CLOSE-OUT

## SLICE 48 | Extension monolith split
lane: EXT | deps: 37,41 | read: docs/maps/vocab.md
own: extension/sidepanel/**, extension/content/video-mining-poc.js (rename -> video-mining.js), extension/manifest.json, extension/tests/**
evidence: sidepanel.js 12,089 lines; video-mining-poc.js 2,910 lines named "poc"; 68/81 extension tests read source text; `<all_urls>` content scripts + duplicate youtube/netflix host perms.
do:
1. Split sidepanel.js by tab/feature into `sidepanel/modules/*.js` loaded as ES modules (`<script type=module>`); verbatim moves, no logic edits.
2. Content scripts cannot use ES modules: split video-mining into ordered plain files listed in manifest; keep `window.__kirokuVideo` export.
3. Update source-reading tests to read the new file set via a helper `extension/tests/helpers/source.js`.
4. Manifest: report (do not change) host permission reductions to owner.
test: full extension suite (explicitly approved for this slice only).
done: pass count equals pre-split count.

## SLICE 49 | Integration
lane: INT | deps: all | read: docs/maps/testing.md
own: desktop/tests/fixtures/openapi.json (regen via tools/export_openapi.py), STATUS.md, docs/maps/*.md final touch
do:
1. Regenerate OpenAPI fixture; run backend, desktop, extension suites once (explicitly approved for this slice only); list failures, fix only drift-related ones, report others.
2. final_lock.test.js must pass unchanged.
3. Verify `tools/check_tokens.py`, tokenizer thread test, grammar fixture, link hub tests.
4. STATUS.md: 5 lines.
done: all green or failures listed with owner slice.
