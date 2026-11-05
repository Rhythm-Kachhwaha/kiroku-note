Completed : 1, 2, 3, 4, 5, 6, 7
# LOAD PROTOCOL (agent: read this block only, then ONE slice)
User says "do slice N" -> never read the whole file.
1. Read lines 1-16 only (this block + RULES).
2. Load slice N only. PowerShell:
   `$t=Get-Content "implementation plan.md" -Raw -Encoding UTF8; [regex]::Match($t,'(?ms)^## SLICE N \|.*?(?=^## SLICE |^# (GROUP|PART)|\z)').Value`
   bash: `awk '/^## SLICE N \|/{p=1;next} /^## SLICE |^# (GROUP|PART)/{p=0} p' "implementation plan.md"`
3. deps: check line 1 "Completed" only. Missing dep -> stop, tell user.
4. Same GROUP, next slice: reuse files already read; do not re-read. Group ctx: `ctx:` line under `# GROUP` (load once per group).
5. Done -> add N to line 1, one STATUS.md line (<=5 total), commit `type(scope): summary [N<n>]`.
RULES: AGENTS.md + IGNORE.md + final.md apply (fonts/animations/Bottom Dock/Kanji Mastery locked; never reduce animations; no emoji; no secrets). Tests: only slice-named tests. Slice order inside a GROUP is mandatory. Lanes A,B,C,D run in parallel; E after A-D; F,G after Part 1.
LANES: A=G1->G7 (extension files) | B=G2->G3 (backend core: config/main/yomitan/dictionary) | C=G4 | D=G5 | E=G6 | F=G8,G10 | G=G9
CONFLICT MAP: G1.s3 + G2 + G3 all touch backend/app/config.py|main.py -> only lane B edits them; G1.s3 edits config.py first, then lane B continues.
NOTE: AGENTS.md says `implementation_plan.md` but file is `implementation plan.md` -> fixed in slice 23.
NEW TEST TYPES (create where a slice says so): boot-in-real-mode (extension), client-profile matrix (backend), endpoint audit (desktop->OpenAPI), golden lookups (dictionary fixture DB), generated-PDF fixtures, invariant/property tests (grammar spans).

# PART 1 - FIXES

# GROUP G1 | EXT-BOOT (lane A) | ctx: extension/sidepanel/sidepanel.html, sidepanel.js, manifest.json, tests/helpers/source.js

## SLICE 1 | Side panel boot fix
lane: A | deps: - | read: extension/tests/helpers/source.js, git show 972dec9 --stat
own: extension/sidepanel/sidepanel.html, sidepanel.js, sidepanel/modules/**, extension/content/video-mining.js, extension/tests/helpers/source.js
evidence: Slice 48 changed html to `<script type="module" src="sidepanel.js">`. sidepanel.js (12089 lines, no imports) declares `function escapeHtml` at lines ~6261 and ~11356 -> SyntaxError in module mode -> whole side panel dead (Text/Video/capture all dead). sidepanel/modules/*.js (~12k lines) are unused copies; tests read source via helper so they stayed green. content/video-mining.js (2914 lines) is not in manifest (stale; split files content/video-mining/*.js are).
do:
1. Diff both escapeHtml bodies; keep the safer one (escapes & < > " '), delete the other.
2. Decision (do not deviate): single source of truth = sidepanel.js as CLASSIC script. Revert html to `<script src="sidepanel.js">`. Delete sidepanel/modules/*.js (dead duplicates). Real module split is out of scope.
3. Point tests/helpers/source.js at sidepanel.js; fix tests that referenced modules/.
4. Verify content/video-mining.js unused (grep manifest+tests); delete if unused; update tests that name it.
5. `node --check` sidepanel.js in classic mode; check no other duplicate top-level function/const names (script: regex scan).
test: `node --test extension/tests/extension-packaging.test.js extension/tests/capture-screenshot.test.js extension/tests/quick-add.test.js` (run from repo root).
done: panel script parses; no modules/ dir; tests green.

## SLICE 2 | Boot-in-real-mode tests (new type)
lane: A | deps: 1 | read: extension/tests/helpers/*
own: extension/tests/boot_real_mode.test.js (new), extension/tests/helpers/dom_boot.js (new)
evidence: 256/260 ext tests passed while the panel could not load; no test executes html-declared scripts in their declared mode.
do:
1. Test A: parse every `<script src>` in sidepanel.html honoring `type=module` (spawn `node --check` with/without --input-type=module). Fail on any error.
2. Test B: concat manifest content_scripts[0].js in order, parse (detect cross-file const redeclare).
3. Test C: every script path in html + manifest exists.
4. Test D: run sidepanel.js top-level in `vm` with existing MockElement harness; assert no throw; click tab buttons Text/Video; assert panels toggle.
5. Fix extension/tests/hero-view.test.js (3 failing subtests; run from repo root; find root cause first, fix code if real bug else stale assertion).
test: `node --test extension/tests/boot_real_mode.test.js extension/tests/hero-view.test.js`
done: pass; deliberately re-adding a duplicate function makes Test A fail (check manually, revert).

## SLICE 3 | Extension trusted by default (pinned ID)
lane: A->B handoff | deps: 1 | read: backend/app/config.py (lines 20-100), docs/link-protocol.md (auth part), release/build-extension.ps1, installer/extension_instructions.txt
own: extension/manifest.json, backend/app/config.py, tools/gen_extension_key.py (new), backend/tests/test_extension_origin_default.py (new), installer/extension_instructions.txt
evidence: default KIROKU_EXTENSION_ORIGIN_POLICY=allowlist with empty KIROKU_EXTENSION_IDS -> POST from `chrome-extension://<id>` returns 403 "Untrusted Origin" (reproduced via TestClient). Unpacked extension ID is path-dependent (manifest has no `key`), so allowlisting an ID is impossible for end users. Desktop launches backend with no extension env.
do:
1. tools/gen_extension_key.py: generate RSA key, print manifest `key` (base64 public) + derived extension ID. Private pem stays OUTSIDE repo (print path hint; add to .gitignore). Ask user to run it once; agent writes only the public key + ID.
2. manifest.json: add `"key"`. config.py: `DEFAULT_EXTENSION_IDS=(<id>,)` merged into get_allowed_extension_ids(); dev IDs still via KIROKU_DEV_EXTENSION_IDS.
3. Keep legacy rollback env semantics unchanged.
4. Tests: default env -> pinned ID POST /api/capture is not 403 (use fake provider); random ID still 403; GET allowed; CORS preflight ok for pinned ID.
5. Update installer/extension_instructions.txt (ID is stable; no env needed).
test: `$env:PYTHONPATH='.;backend'; python -m pytest backend/tests/test_extension_origin_default.py backend/tests/test_legacy_api_auth.py backend/tests/test_backend_security_and_health.py -q`
done: reproduced 403 now 200/503-by-dictionary-only.

## SLICE 4 | Pairing UX + remembered token + visible errors
lane: A | deps: 3 | read: backend/app/api/system.py (lines 150-225), extension/sidepanel/sidepanel.js (lines 25-80), extension/link/link-client.js (lines 40-110), desktop/src/main.js (grep pairing)
own: extension/sidepanel/sidepanel.js, sidepanel.html (settings block only), extension/link/link-client.js, backend/app/config.py (is_extension_pairing_enabled default only)
evidence: link WebSocket (role ext) needs a `link:rw` token from pairing; pairing is off by default (KIROKU_EXTENSION_PAIRING_ENABLED unset); token is session-only (chrome.storage.session) -> re-pair every browser restart; 403/401 from backend produce no explanation in the panel.
do:
1. Pairing enabled by default (env can disable). Pairing only matters for link/legacy token mode; normal capture works without it (slice 3).
2. Settings: "Remember on this browser" checkbox (default off) -> store token in chrome.storage.local instead of session; "Forget" button calls revoke path/clears storage.
3. Central fetch wrapper (core fetch override in sidepanel.js): on 401/403 from backend show one inline banner with cause (untrusted origin / needs pairing) + action; on network failure show "Kiroku backend not running". Debounce banner.
4. link-client: surface "needs pairing" state to desktop-independent status chip.
test: `node --test extension/tests/legacy-api-auth.test.js extension/tests/boot_real_mode.test.js` + backend `test_legacy_api_auth.py`.
done: unpaired extension still captures; banners render in mock harness.

# GROUP G2 | DICT (lane B) | ctx: backend/app/services/{yomitan.py,dictionary_provider.py,kanji_service.py,card_service.py}, api/{capture,system}.py, kiroku_dictionary/*

## SLICE 5 | Kiroku dictionary is the default; Yomitan is optional secondary
lane: B | deps: 3 | read: backend/app/services/yomitan.py (lines 130-230, 380-410), dictionary_provider.py
own: backend/app/services/yomitan.py, dictionary_provider.py, backend/app/config.py (new getter only), backend/app/api/system.py (health), backend/tests/test_dictionary_backend_modes.py (new)
evidence: `DICTIONARY_BACKEND` default is "yomitan" (yomitan.py:147). Clean install -> POST /api/capture = 503 "Yomitan is unavailable" (reproduced). Modes are yomitan|local|auto only; health flag `yomitan` is the only dictionary signal.
do:
1. Default backend `local`. Modes: `local` (default), `local+yomitan` (Yomitan used only to ADD entries/fill misses; never blocks), `yomitan` (legacy), `auto` = alias of `local+yomitan`. Env + persisted setting `dictionary.yomitan_secondary` (bool, default false) in app config store.
2. Health: add `dictionary:{backend,db_present,db_path,jitendex,kanjidic,yomitan_secondary,yomitan_reachable}`; keep old `yomitan` key for compat.
3. Missing DB error text: actionable ("Run provisioning in Settings > Dictionary") and HTTP 503 with code `DICT_DB_MISSING`.
4. Yomitan unreachable in local+yomitan must never raise to the user.
test: new test + `test_dictionary_discovery.py test_capture_integration.py test_backend_security_and_health.py`.
done: capture works with only the local DB present; Yomitan off by default.

## SLICE 6 | One DB resolver + one service instance
lane: B | deps: 5 | read: dictionary_provider.py (lines 35-82), kanji_service.py (lines 15-45), api/capture.py, main.py (grep `YomitanService(`)
own: kiroku_dictionary/paths.py (new, stdlib only), dictionary_provider.py, kanji_service.py, api/capture.py, api/system.py, main.py (only `YomitanService()` call sites), backend/tests/test_dictionary_paths.py (new)
evidence: two resolvers with different candidate lists (provider: env/frozen/repo/cloud_queue/LOCALAPPDATA/home; kanji: data dir first). `capture_term` builds `YomitanService()` + `CardService` per request -> LocalDictionaryProvider/DictionaryEngine and SQLite connection recreated every call; main.py:450 same.
do:
1. kiroku_dictionary/paths.py `resolve_db_path(custom=None)`; priority: arg > KIROKU_DICT_SQLITE > <data_dir>/kiroku_dict.sqlite > frozen exe/_MEIPASS > repo root > cloud_queue > LOCALAPPDATA. Both modules call it.
2. Module-level cached factory `get_dictionary_service()` (thread-safe, resettable like system.py `_health_*` reset). Replace per-request construction in capture.py, main.py:450, system.py.
3. Engine already thread-local connections; keep. Add `engine.close()` on shutdown (lifespan).
test: new test (same path from both callers; factory returns same instance; reset works) + `test_capture_*`, `test_kanji_routes.py`.
done: one resolver, no per-request construction (assert via counter in test).

## SLICE 7 | Selection identify without Yomitan
lane: B | deps: 6 | read: dictionary_provider.py (identify, lines 235-275), kiroku_dictionary/lookup.py (lookup_terms, mode), backend/app/services/tokenizers/sudachi.py
own: dictionary_provider.py, kiroku_dictionary/lookup.py (only if scan-mode bug), backend/tests/test_dictionary_identify.py (new)
evidence: LocalDictionaryProvider.identify raises "...Full-sentence tokenization requires Yomitan" for any selection containing 。！？、 newline or >30 chars with space; engine `scan` mode exists but unused; unknown Japanese text falls back to returning the raw selection as headword/reading (no error). Selecting `学校に行きました` style phrases is the common text-mining case.
do:
1. Replace guard: if direct word lookup hits -> use it. Else run Sudachi (mode C, existing adapter) on the selection, pick token at selection start (skip punctuation/particle-only unless whole selection), take its lemma, deinflect via kiroku_dictionary.deinflect, lookup.
2. Multi-token selection: prefer longest dictionary hit from selection start via `scan`; else first content token.
3. No hit: raise typed error `DICT_TERM_NOT_FOUND` (not raw fallback); fallback to raw text only when selection is single kana word with no entry (keep current behaviour for that case).
4. Verify (report in done line): ご飯 resolves to one headword (earlier user report: tokenizer returned only 飯).
test: new test with fixture DB (slice 10 builds it; until then monkeypatch engine) + `test_capture_integration.py`.
done: sentence-like selections identify; no "requires Yomitan" string remains (grep).

## SLICE 8 | Dictionary DB provisioning (first run)
lane: B | deps: 6 | read: kiroku_dictionary/build.py, importer.py, ATTRIBUTION_NOTICE.md, packaging/kiroku_backend.spec, installer/kiroku_setup.iss, desktop/src/ui/views/settings.js (structure only)
own: kiroku_dictionary/provision.py (new), backend/app/api/dictionary.py (new, register in registry), desktop/src/ui/views/settings.js (Dictionary section), packaging/kiroku_backend.spec, installer/kiroku_setup.iss, backend/tests/test_dictionary_provision.py (new)
evidence: kiroku_dict.sqlite is gitignored, not built or shipped by installer/spec; build needs manually placed Jitendex + KANJIDIC zips. No first-run path -> every fresh install hits DICT_DB_MISSING.
do:
1. STOP and ask user for: official download URLs, expected SHA-256, and whether to download at runtime or ship prebuilt DB in installer. Do not guess URLs. Both sources are CC BY-SA 4.0: show attribution in UI + installer.
2. provision.py: download (stdlib urllib, resumable not needed), verify hash, build via importer to temp file, run integrity check + sample lookups, atomic rename into data dir; progress callback.
3. API: `GET /api/dictionary/status`, `POST /api/dictionary/provision` (desktop token required; background thread; poll status), `DELETE` not needed.
4. Desktop Settings > Dictionary: status, Provision button + progress, attribution text, "Yomitan secondary" toggle placeholder (wired in slice 9).
5. Spec/installer: include chosen option.
test: new test with local fixture zips (synthetic, tiny; no licensed data committed) + http server stub.
done: fresh data dir -> provision -> capture works.

## SLICE 9 | Yomitan optional secondary (wiring)
lane: B | deps: 5,8 | read: yomitan.py (merge/enrich parts), extension/lib/yomitan-reference-renderer.js (head), extension settings dictionary block
own: backend/app/services/yomitan.py, backend/app/api/dictionary.py, extension/sidepanel/sidepanel.js (dictionary settings + health dots only), desktop settings.js (toggle only), tests
evidence: UI shows Yomitan status dot as the primary dictionary health; entries from Yomitan and local are not labeled by source; `designated_dictionary` setting assumes Yomitan names.
do:
1. Backend: `PUT /api/dictionary/settings {yomitan_secondary}`; when on, entries from Yomitan are appended after local entries with `source:"yomitan"`; local-first dedupe by (term,reading).
2. Extension + desktop: primary dot = Kiroku dictionary; separate secondary dot visible only if enabled; no error toast when Yomitan is off/unreachable.
3. Card Preview dictionary list labels source; Yomitan entries never required for card creation.
test: backend new test + `node --test extension/tests/dictionary-selection.test.js extension/tests/dictionary-study-view.test.js`.
done: toggle on/off round-trips; capture unaffected when Yomitan down.

## SLICE 10 | Dictionary golden + perf tests (new type)
lane: B | deps: 7 | read: kiroku_dictionary/importer.py (input format), backend/tests/test_dictionary_discovery.py
own: backend/tests/fixtures/dict/ (synthetic Yomitan-format zips, new), backend/tests/conftest_dict.py (new), backend/tests/test_dictionary_golden.py (new)
do:
1. Build tiny fixture DB at test time from synthetic zips (never commit licensed data).
2. Golden cases: 食べました->食べる; 行って->行く; 高くなかった->高い; ご飯 single entry; 学校に行く selection; 食べさせられたくなかった; katakana loanword; kana-only; okurigana variant; no-hit error code.
3. Perf: 200 sequential captures p95 < 50ms after warm (marker `perf`, skipped in default run).
4. Regression: `get_dictionary_service()` constructed once.
test: `python -m pytest backend/tests/test_dictionary_golden.py -q`
done: pass.

# GROUP G3 | BE-CONTRACT (lane B, after G2) | ctx: backend/app/main.py, api/registry.py, desktop/src/process_manager.js, desktop/src/main.js

## SLICE 11 | Desktop launches backend with correct env
lane: B | deps: 3,5 | read: desktop/src/process_manager.js (lines 215-240), run_backend.py, .env.example
own: desktop/src/process_manager.js, desktop/tests/process_manager*.test.js, .env.example, run_backend.py (docs/env only)
evidence: process manager sets only KIROKU_HOST/PORT/STUDY_API_TOKEN. Dictionary backend, extension IDs, pairing, data dirs rely on defaults or user .env. `.env.example` has no dictionary/extension keys.
do:
1. Pass through: KIROKU_DICT_SQLITE (if set), DICTIONARY_BACKEND unset (default local), KIROKU_EXTENSION_PAIRING_ENABLED=1.
2. .env.example: add dictionary, yomitan secondary, extension origin/pairing, legacy token mode sections (commented).
3. Log (redacted) the resolved dictionary DB path at backend start (run_backend.py).
test: `node --test desktop/tests/process_manager*.test.js`
done: pass.

## SLICE 12 | Client-profile contract tests (new type)
lane: B | deps: 3,11 | read: backend/tests/test_legacy_api_auth.py, docs/maps/link.md
own: docs/maps/clients.md (new), backend/tests/test_client_contract.py (new)
evidence: the backend serves extension (Origin chrome-extension, optional paired token), desktop (IPC proxy, Origin http://127.0.0.1:port, bearer study token), and tools (no Origin). Changes for desktop (R7 security) silently broke the extension; no test covers both.
do:
1. clients.md: table `route -> clients (ext|desk|both) -> auth` generated from OpenAPI (script prints skeleton; agent fills client column).
2. Matrix test: profiles {ext pinned origin no token, ext + paired token, desk bearer, no-origin local, foreign origin} x modes {legacy token off|warn|enforce} x representative route per row of clients.md. Assert expected status class.
3. Test asserts every OpenAPI route appears in clients.md (new route without a row fails).
test: `python -m pytest backend/tests/test_client_contract.py -q`
done: pass; failing rows listed in done line become Part-1 bugs fixed here if tiny, else reported.

## SLICE 13 | Desktop endpoint audit (new type)
lane: B | deps: 12 | read: desktop/src/ui/services/*client.js (grep paths), desktop/tests/fixtures/openapi.json (grep only)
own: tools/audit_desktop_endpoints.py (new), desktop/tests/desktop_endpoints.test.js (new), docs/maps/desktop-views.md (append results)
evidence: user reports some desktop features "straight up don't work" since backend changes; cause unknown.
do:
1. Script: regex-extract every `/api/...` path+method used in desktop/src/ui/**; check each exists in backend OpenAPI; call each GET/safe route via TestClient with desktop headers; classify: ok / 404 / 405 / 422 / 5xx / auth.
2. Output table into docs/maps/desktop-views.md; fix trivial mismatches (path typos, renamed routes, missing auth header); anything bigger -> add `FOUND:` lines under this slice and stop.
3. Node test asserts no desktop-used path is missing from the committed OpenAPI fixture (regenerate fixture via existing tool; fixture is read-only otherwise).
test: `python tools/audit_desktop_endpoints.py` + `node --test desktop/tests/desktop_endpoints.test.js`
done: zero 404/405 for desktop-used routes.

# GROUP G4 | GRAMMAR (lane C) | ctx: backend/app/services/grammar_matcher.py, grammar_service.py, grammar_tracker.py, backend/tests/test_grammar_*.py

## SLICE 14 | Grammar span invariant (inverted spans)
lane: C | deps: - | read: docs/maps/grammar.md, grammar_matcher.py (span construction)
own: grammar_matcher.py, backend/tests/test_grammar_span_invariants.py (new)
evidence: `たところで` sentences (彼は来たところで帰った。, 今さら言ったところで遅い。) return span start=15,end=8,text='' (start>end). 3 tests in test_grammar_matcher.py fail.
do:
1. Find where end is computed from a different token base than start (regex vs token offsets); fix.
2. Post-filter in match_sentence: drop spans with not (0<=start<end<=len) or text != sentence[start:end]; log once at debug.
3. Property test: for every example sentence in the master dataset (read via grammar_reference service, not by opening the 100KB+ json), all spans satisfy the invariant. Marker `slow` if >5s.
test: `python -m pytest backend/tests/test_grammar_span_invariants.py backend/tests/test_grammar_matcher.py -q`
done: 0 inverted spans.

## SLICE 15 | Canonical pattern keys
lane: C | deps: 14 | read: grammar_matcher.py, grammar_reference.py, grammar_tracker.py, backend/tests/test_grammar_acceptance_gate.py
own: grammar_reference.py, grammar_matcher.py, grammar_tracker.py, tests, desktop/src/ui/views/grammar.js (consumer fix only)
evidence: dataset key is `てしまう / ちゃう` (combined). Tests expect `てしまう`; acceptance gate (忘れてしまう。) and matcher tests fail by key mismatch. Combined keys leak to tracker DB, extension grammar cards, desktop.
do:
1. grep consumers of pattern_key (backend, extension/sidepanel grammar tracker, desktop grammar.js) before editing.
2. Define `pattern_key` = first alternative, `pattern_aliases` = rest; display unchanged. Keep response field compat: add `pattern_aliases`.
3. Migrate persisted tracker rows (old combined key -> canonical) idempotently; no data loss; test migration.
4. Update acceptance corpus expectations only if canonical differs from intent; never loosen precision/recall gates.
test: `python -m pytest backend/tests/test_grammar_acceptance_gate.py backend/tests/test_grammar_matcher.py backend/tests/test_grammar_routes.py -q` + `node --test extension/tests/*grammar*.test.js desktop/tests/*grammar*.test.js`
done: pass.

# GROUP G5 | PDF-TEXT (lane D) | ctx: backend/app/study/ingestion/staged_import.py, adapters/pdf_text.py, backend/app/api/study_pdf.py, desktop/src/ui/views/study_import.js. OCR is OUT OF SCOPE: never add OCR; keep skipped_ocr as informational only.

## SLICE 16 | Page route classification
lane: D | deps: - | read: docs/maps/study.md, staged_import.py (lines 120-170)
own: staged_import.py, backend/app/api/study_pdf.py, backend/tests/test_study_pdf_import.py, test_study_pdf_text_api.py
evidence: adapter sets page confidence 0.2 for pages with <=10 chars; staged_import treats confidence<0.5 as `garbled_text_layer` -> `skipped_ocr`; preview skips them. Title/short/answer pages are silently dropped. `japanese_ratio` computed but unused; `force_ocr` stored but unused.
do:
1. garbled only if replacement indicators (U+FFFD, `(cid:`) present; sparse pages -> route `short_text` (readable, included).
2. Low japanese_ratio (<0.1, chars>=40) -> flag `non_japanese` (included, flagged), not skipped.
3. force_ocr pages: keep text if present, flag `ocr_requested_unavailable`; skipped list reasons surfaced.
4. Skipped reasons enum in one place; preview response lists `skipped[{page_number,reason}]` (exists) + counts.
test: `python -m pytest backend/tests/test_study_pdf_import.py backend/tests/test_study_pdf_text_api.py -q`
done: 8-char page included; image-only page skipped with reason.

## SLICE 17 | Extraction cache + TTL cleanup
lane: D | deps: 16 | read: staged_import.py (extract_document, cleanup_expired), study_pdf.py
own: staged_import.py, study_pdf.py, backend/app/main.py (lifespan hook only, one line), tests
evidence: get_pdf_pages and preview_pdf_import call `extract_document` each request (re-parses up to 200 pages / 25MB). TTL 1h; verify cleanup_expired is actually invoked (grep) - if never, files accumulate.
do:
1. Cache ExtractedDocument per (import_id, sha256): small in-memory LRU (2 docs) + invalidate on TTL cleanup.
2. Call cleanup_expired on startup and every N requests/staging call.
3. Pages endpoint pagination unchanged (20/req).
test: new test counts extraction calls across 3 requests = 1; cleanup test.
done: pass.

## SLICE 18 | Text quality fixtures (new type: generated PDFs)
lane: D | deps: 16 | read: backend/app/study/ingestion/adapters/pdf_text.py, helper `extract_page_coordinates` module (grep import)
own: backend/tests/fixtures/pdf_gen.py (new), backend/tests/test_study_pdf_text_quality.py (new), requirements-dev.txt (add reportlab, dev only)
evidence: ExtractedLine has `direction` horizontal|vertical but vertical handling is unverified; ruby, 2-column, repeated headers untested on real PDFs. Font available in repo: desktop/src/ui/assets/fonts/hina-mincho.ttf (verify glyph coverage; else ask user for a CJK TTF).
do:
1. Generate fixtures with reportlab: horizontal paragraphs, tategaki column set, ruby over kanji, two columns, repeating header/footer, mixed Latin/JP.
2. Report which fail (reading order, ruby inline, header strip). Fix only cheap, safe ones in extraction ordering.
3. Vertical text: if not solvable cheaply, detect and add page flag `vertical_text_suspected` and show warning in UI (slice 19). Do not fake correctness.
test: `python -m pytest backend/tests/test_study_pdf_text_quality.py -q`
done: failures either fixed or documented as flags.

## SLICE 19 | PDF import UI feedback
lane: D | deps: 16,18 | read: desktop/src/ui/views/study_import.js, docs/maps/desktop-views.md (study section)
own: desktop/src/ui/views/study_import.js, desktop/tests/study_import*.test.js
do:
1. Per-page row: route badge (text / short / flagged / skipped + reason), page select defaults to readable pages only.
2. Summary: "N pages readable, M skipped (image-only: ...)" ; vertical warning from slice 18.
3. Error states: IMPORT_EXPIRED -> re-upload prompt; PDF_EXTRACTION_FAILED message; size/page-limit message with limits.
4. Keep all existing animations; no new fonts.
test: `node --test desktop/tests/study_import*.test.js desktop/tests/final_lock.test.js`
done: pass.

# GROUP G6 | HYGIENE (lane E) | ctx: backend/pytest.ini, backend/requirements.txt, desktop/tests/, extension/tests/, docs/maps/testing.md

## SLICE 20 | Backend test hygiene (clean install)
lane: E | deps: - | read: docs/maps/testing.md
own: requirements-dev.txt (new or extend), backend/pytest.ini, backend/tests/test_llm_service.py, test_llm_settings_api.py, test_real_subtitles_benchmark.py, test_map_paths.py, docs/maps/*.md
evidence: clean install: TestClient tests ERROR (httpx missing; not in requirements). Linux run: 10 failed/1284 passed. LLM secret tests need Windows DPAPI (secret_store uses ctypes.windll) but test_llm_config_get_and_put and 3 in test_llm_settings_api are not marked windows. test_real_subtitles_benchmark needs a populated local DB (mined>0). test_map_paths fails: docs/maps list nonexistent files (journey.py, journey_service, gamification, link_service, extension/src/*.js, desktop views journey/link, kiroku_cloud_queue/*.db).
do:
1. requirements-dev.txt: pytest, httpx. README/testing.md: install line.
2. Mark windows tests `windows` + skipif non-win32; add marker `needs_local_db` and skip when absent.
3. docs/maps: mark not-yet-existing files `(planned)`; fix stale paths (extension/src/*) to real ones; test_map_paths ignores `(planned)`.
4. Optional (ask first): non-Windows secret store fallback (keyring-less file with OS perms) - only report, do not build.
test: `python -m pytest backend/tests/test_map_paths.py backend/tests/test_llm_service.py backend/tests/test_llm_settings_api.py -q`
done: Linux run only real failures remain (list in done line).

## SLICE 21 | Desktop test fixes
lane: E | deps: - | read: desktop/tests/router_robustness.test.js, router_keepalive.test.js, guard_no_mock_data.test.js (rule only), desktop/src/ui/services/link_client.js
own: desktop/tests/** (router tests + helpers), desktop/src/ui/services/link_client.js
evidence: 5 failures: router tests (4) throw `document.getElementById is not a function` (mock lacks it; router.js:18 calls it) while final.md requires them green; guard test finds `catch (_) {}` x2 in link_client.js.
do:
1. Add getElementById to the test DOM mock; do NOT edit router.js (locked by final.md).
2. link_client.js: replace empty catches with `catch (err) { console.debug('[LinkClient] ...', err); }` matching guard rule.
test: `node --test desktop/tests/router_robustness.test.js desktop/tests/router_keepalive.test.js desktop/tests/guard_no_mock_data.test.js desktop/tests/final_lock.test.js`
done: pass.

## SLICE 22 | Repo-wide test runner, cwd-safe tests, line endings, honest STATUS
lane: E | deps: 20,21 | read: package.json, .gitignore (head), `git ls-files --eol | findstr mixed`
own: package.json, tools/run_all_tests.py (new), extension/tests/**, desktop/tests/** (path fixes only), .gitattributes (new), backend/app/main.py (line endings only), STATUS.md
evidence: extension tests fail when run from extension/ (relative path to sidepanel.html); STATUS says 260/260 green while root run was 256/260 ext + 217/224 desktop + 10 backend failures. main.py has mixed CR/CRLF terminators.
do:
1. Tests resolve paths via `path.resolve(__dirname, ...)`.
2. tools/run_all_tests.py: runs backend (-m "not network"), extension, desktop from repo root; prints one summary line; `--write-status` writes it to STATUS.md.
3. `.gitattributes`: `* text=auto`; normalize files reported mixed (separate commit `chore(repo): normalize line endings`).
4. package.json scripts: `test`, `test:backend`, `test:ext`, `test:desktop`.
test: `python tools/run_all_tests.py`
done: STATUS.md reflects real counts.

## SLICE 23 | Commit + agent-doc hygiene
lane: E | deps: 22 | read: AGENTS.md, .github/ (ls only)
own: AGENTS.md, tools/check_commit_msg.py (new), .githooks/commit-msg (new), .github/workflows/tests.yml (new if absent), docs/maps/testing.md
evidence: AGENTS.md routes plans to `implementation_plan.md` but file is `implementation plan.md`. Log has non-conforming subjects ("all slice done", "plan update", "Slice 49: Integration", raw "feat: ..." without tag) against rule `type(scope): summary [K<n>]`.
do:
1. AGENTS.md: plan path -> `implementation plan.md`; tag format `[N<n>]` for this plan; keep line count flat (token budget).
2. commit-msg hook validates format (<=60 char summary), documented one-liner `git config core.hooksPath .githooks`.
3. CI: windows-latest runs run_all_tests.py (skip network/windows-only as marked). Skip if a workflow already runs tests.
test: `python tools/check_commit_msg.py "fix(ext): boot [N1]"` ok / bad examples fail.
done: pass.

# GROUP G7 | EXT-DECLUTTER (lane A, after G1) | ctx: extension/sidepanel/sidepanel.html, sidepanel.js, sidepanel.css, tests quick-add/ask/history

## SLICE 24 | Remove Ask, History, Quick tabs from the UI (code stays)
lane: A | deps: 1,2 | read: sidepanel.js (switchMiningTab ~9815; tab wiring ~9984-10012; restore savedTab ~9958; btnAskFromText ~10000), sidepanel.html (lines 28-40, panels), sidepanel.css (tab-nav grid)
own: sidepanel.html, sidepanel.js (tab wiring only), sidepanel.css (tab bar layout only), extension/tests/*(tab assertions)
evidence: top bar has 5 tabs Text/Video/Quick/Ask/History. Coupling: switchMiningTab validTabs includes all; `hideEditor` is keyed on history/ask; `btnAskFromText` (Text tab) calls switchMiningTab("ask") -> would land on hidden panel; saved tab restore could restore a retired tab; `loadHistory()` is called from ~25 save/sync flows (needs history DOM to exist); Quick Add input module self-initializes.
do:
1. Do NOT delete panels/JS. Mark tab buttons `hidden`+`data-retired="1"`; panels keep `hidden`. Keep ids so existing code never null-refs.
2. `RETIRED_TABS=["quickadd","ask","history"]`: switchMiningTab maps them to "text" (so savedTab restore + any stray call is safe).
3. Hide entry points into retired tabs: `btnAskFromText`, subtitle/missed-word "ask" buttons (grep `switchMiningTab("ask")` and ask-mode triggers). Keep a single constant `RETIRED_UI_ENABLED=false` gating them so re-enabling is one flip.
4. CSS: tab bar becomes 2 equal tabs (Text, Video) + settings gear; no layout shift in Text view.
5. Update tests asserting tab presence: assert retired + hidden; keep their behavior tests by enabling the constant in the harness.
test: `node --test extension/tests/quick-add.test.js extension/tests/subtitle-selection-and-ask-mode.test.js extension/tests/boot_real_mode.test.js extension/tests/customizable-layout.test.js`
done: only Text|Video visible; capture/save/history counters still update silently; no console errors in mock boot.

## SLICE 25 | Keep cloud pull + stats reachable
lane: A | deps: 24 | read: sidepanel.html (history cloud subnav ~636-650, stats block ~606), sidepanel.js (cloud pull handler grep `API_CLOUD_PULL_URL`), tests cloud
own: sidepanel.html, sidepanel.js (move handlers' DOM only), sidepanel.css (settings block)
evidence: cloud-queue pull button + cloud count badge + sync-all progress live only in the History panel. Hiding History removes the only way to pull iPhone-queued cards or bulk-sync to Anki.
do:
1. Add Settings > "Cards" section: Pull from cloud (with badge), Sync all to Anki (with progress), card count + synced count. Reuse same element ids via relocation (move DOM nodes, not clone) or forward clicks to the hidden originals.
2. Keep Save->Anki auto flow unchanged.
test: `node --test extension/tests/*cloud*.test.js extension/tests/history*.test.js extension/tests/deck-aware-duplicate-ui.test.js` (names via glob; skip missing)
done: pull/sync reachable from Settings; tests green.

# PART 2 - FEATURES (after Part 1)

# GROUP G8 | ANIME (lane F) | ctx: desktop/src/ui/views/anime.js, services/link_client.js, link_store.js, backend/app/link/*, backend/app/schemas_link*.py, docs/maps/link.md

## SLICE 26 | Anime controls parity (protocol already supports it)
lane: F | deps: 4,13 | read: docs/maps/link.md, anime.js (controls), schemas_link.py (cmd.* names)
own: anime.js, desktop/src/ui/styles/views/anime.css (or the file anime styles live in), link_store.js, desktop/src/hotkeys.js (actions only), desktop/tests/anime*.test.js
evidence: protocol has cmd.rate, cmd.loop, cmd.offset, cmd.clip, cmd.toggle, cmd.cue; anime.js UI exposes only play/pause, +-5s, prev/next/replay cue.
do:
1. Add: speed (0.75/1/1.25/1.5), loop current line toggle, subtitle offset -100/0/+100ms, clip button (mine, slice 29).
2. Local keys while view focused: Space, Left/Right (cue), R replay, L loop; also register as optional global actions in hotkeys.js (off by default).
3. Disabled state + tooltip when extension disconnected; reflect state from video.state.
test: `node --test desktop/tests/anime*.test.js desktop/tests/final_lock.test.js`
done: all new commands emit correct cmd.* payloads (assert in test with fake client).

## SLICE 27 | Transcript strip with known-word coloring
lane: F | deps: 26 | read: backend/app/api/link_analysis.py, link/analysis.py (response shape), link_store.js
own: anime.js, anime css, link_store.js
do:
1. Scrolling cue list (from cue.list), active line highlighted, click -> cmd.seek; virtualize beyond 300 cues.
2. Token coloring from /api/link/cues/{hash}: known / should-know / mined / unknown (reuse colors from vocab tokens); toggle to hide.
3. Filters: "only lines with <=1 unknown", "only lines with grammar above my level".
4. Grammar chips per cue from /api/link/cue-grammar.
test: new `desktop/tests/anime_transcript.test.js`.
done: pass; no layout jank (keep existing animations, additive only).

## SLICE 28 | Episode timeline + resume
lane: F | deps: 27 | read: backend/app/link/episode.py, schemas_link_episode.py, watch_primer.js (head)
own: backend/app/link/episode.py, schemas_link_episode.py, backend/app/api/link_episode.py, anime.js, watch_primer.js, tests
do:
1. Unknown-density sparkline under the player (per-cue unknown count), click to seek; mark easiest/hardest 5 lines.
2. EpisodeRecord gets `last_position_ms`; save every 15s while playing (throttled), restore on reopen ("Resume at 12:40").
3. Series grouping from source name (strip episode markers); watch history list in Anime tab with known% per episode.
test: `python -m pytest backend/tests/test_link_episode.py -q` + new desktop test.
done: pass.

## SLICE 29 | Mine from Anime tab
lane: F | deps: 26,27 | read: desktop/src/ui/services/link_mine.js, docs/maps/link.md (mine part)
own: anime.js, link_mine.js, tests
do:
1. One-click mine active line (sentence + screenshot + audio via cmd.clip/clip.result); hover/click a token -> mine word with that sentence.
2. "Queue gap words" button: add all unknown content words of current line/episode to a review list (not auto-cards); list shows count, mine-all, undo.
3. Session mined counter; duplicate detection reuses existing card duplicate check.
test: `node --test desktop/tests/*link*mine*.test.js` (+ new).
done: pass.

## SLICE 30 | Smart pause + session stats
lane: F | deps: 27 | read: desktop/src/hotkeys.js (study-pause), backend/app/link/session.py
own: anime.js, link/session.py, backend/app/api/link.py (stats endpoint only), tests
do:
1. Setting: auto-pause on lines containing unknown/gap words (threshold N) and optional auto-replay once.
2. Persist per-session stats (watch seconds, lines seen, words mined, gap words seen) in a `link_session_stat` table, exposed `GET /api/link/sessions?limit`. Plain data only; do NOT build gamification/journey now.
test: `python -m pytest backend/tests/test_link_hub.py backend/tests/test_link_episode.py -q`
done: pass.

## SLICE 31 | Theater polish (verify first)
lane: F | deps: 26 | read: docs/maps/desktop-views.md (theater), theater.js (head only)
own: theater.js, theater_view.js, tests
do: verify then add only what is missing: recent files list, drag-drop subtitle file onto player, next-episode (same folder, natural sort), remember volume/rate, subtitle offset hotkeys shared with slice 26.
test: `node --test desktop/tests/*theater*.test.js desktop/tests/final_lock.test.js`
done: pass.

# GROUP G9 | EXT-FEAT (lane G) | ctx: extension/sidepanel/sidepanel.js, background.js, manifest.json

## SLICE 32 | Quick Add absorbed into Text hero
lane: G | deps: 24 | read: sidepanel.js (quickadd block grep `quickadd`), sidepanel.html (hero area text-mining-view lines 79-111), lib/wanakana.js usage
own: sidepanel.html (hero), sidepanel.js (hero input wiring), css, tests quick-add.test.js
evidence: user wants typing in the Text-tab hero with suggestion picking instead of a separate Quick tab; tab hidden in slice 24 but capability must remain reachable.
do:
1. Hero word becomes click-to-edit input; romaji->kana via WanaKana (JP/EN toggle like quick add); suggestions dropdown from existing identify/candidate calls; Enter/click selects -> normal capture flow.
2. Reuse quickadd code paths; no new endpoint.
3. Esc restores previous hero; no layout shift when idle.
test: `node --test extension/tests/quick-add.test.js extension/tests/hero-view.test.js`
done: pass.

## SLICE 33 | Offline capture queue
lane: G | deps: 4 | read: background.js (capture relay), sidepanel.js (capture error path)
own: background.js, sidepanel.js (error path), tests
evidence: when backend is closed, select-to-capture shows an error and the word is lost.
do:
1. On network failure store {text, sentence, url, ts} in chrome.storage.local (cap 200, dedupe).
2. Badge count on action icon; on backend health OK (poll 15s only while queue non-empty) replay in order; show summary toast.
3. Settings: view/clear queue.
test: new `extension/tests/offline_queue.test.js`.
done: pass.

## SLICE 34 | Narrow content-script injection (optional, risky; ask user before starting)
lane: G | deps: 1,2 | read: manifest.json, content/video-mining/detector.js
own: manifest.json, background.js, content/**, tests
evidence: 15 scripts injected into every frame of every page (`<all_urls>`, all_frames, match_about_blank) plus `<all_urls>` host permission -> heavy on page load and broad permission.
do: keep content.js (selection capture) on all pages; inject video-mining set via `chrome.scripting.executeScript` only when a `<video>` is detected or user opens Video tab; keep adapters for YouTube/Netflix static. Measure before/after.
test: `node --test extension/tests/extension-packaging.test.js extension/tests/video-mining-integration.test.js extension/tests/boot_real_mode.test.js`
done: no regression in video tests; report load-time delta.

# GROUP G10 | SETUP (lane F) | ctx: backend/app/api/system.py, desktop/src/ui/views/settings.js, extension settings block

## SLICE 35 | Setup checklist (one place to see why something is broken)
lane: F | deps: 5,8,13 | read: system.py health, settings.js (structure only)
own: backend/app/api/system.py (new route only), desktop settings.js (checklist block), extension sidepanel (banner reuse), tests
evidence: this review found failures with no user-visible cause (origin 403, dictionary DB missing, pairing off, Yomitan down, tokenizer dict missing, PDF dep missing).
do:
1. `GET /api/setup/checklist` -> [{id,ok,detail,fix_action}] for: dictionary DB, tokenizer dict, extension origin/pairing, Anki reachable, PDF dependency (pypdf), data dir writable, optional Yomitan/OCR (informational).
2. Desktop Settings: checklist with fix buttons (Provision dictionary, copy pairing code). Extension: banner links to it when any required item fails.
test: new `backend/tests/test_setup_checklist.py` + desktop test.
done: pass.

# DEFERRED (do not start): Part B gamification (journey/ink/stamps/quests), PDF OCR, Chrome Web Store.
