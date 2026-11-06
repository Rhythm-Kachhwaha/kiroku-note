# Kiroku Note

Local-first Japanese capture: FastAPI + SQLite (truth) + Chromium extension + Electron.
Dictionary: `YomitanService` + `dictionary_provider.py`; JLPT stays local; Anki optional.

## Rules

- NEVER MERGE SIDEPANEL: No agent is ever allowed to merge, bundle, concatenate, or combine `extension/sidepanel/modules/*.js` into a single file, or restore/recreate `sidepanel.js` as a monolith. Sidepanel modules must remain separate.
- One slice only. Read only card-named files. Touch only own: files. Do not start another slice.
- Stop/ask: FINAL change; two unexplained targeted-test failures; contract break; scope beyond card.
- Commit: `type(scope): summary [N<n>]` (summary <=60 chars). `STATUS.md`: max 5 concise lines.
- No emoji in UI, copy, logs, templates, code; use SVG/plain text. Never commit study DB/secrets.
- FINAL: Bottom Dock/sliding pill and Kanji Mastery. Do not alter markup, layout, geometry, timing.
- FINAL: Read `final.md`. Fonts and animations defined in `final.md` are locked contracts. Never alter fonts or reduce animations; if the user asks, STOP and ask again.
- Use existing tokens and `--ease-*`; honor reduced motion. Keep animations; drivers only.

## Route

| Area | Map | Tests |
|---|---|---|
| grammar | `docs/maps/grammar.md` | `backend/tests/test_grammar_*.py`; `extension/tests/*grammar*.test.js` |
| vocab/cards/Anki | `docs/maps/vocab.md` | `test_capture_*`, `test_cards_*`, `test_dictionary*`, `test_anki*` |
| study | `docs/maps/study.md` | `backend/tests/test_study_*.py` |
| ocr / llm | `docs/maps/ocr.md`; `llm.md` | `test_ocr_*`, `test_llm_*`, `test_secret_store.py` |
| cloud | `docs/maps/cloud.md` | `kiroku_cloud_queue/tests/*` |
| desktop shell/UI | `docs/maps/desktop-shell.md`; `desktop-views.md`; `ui-rules.md` | `desktop/tests/*.test.js` |
| link / journey | `docs/maps/link.md`; `journey.md` | `test_link_*`, `test_journey_*` |
| testing | `docs/maps/testing.md` | `desktop/tests/final_lock.test.js` |

## Execution

Order: task → `IGNORE.md` → `final.md` → area map → card-named files → targeted test.
Plan slices: load via implementation plan.md LOAD PROTOCOL.
`docs/maps/ui-rules.md` is sole active UI reference; `docs/archive/` is historical.
Load skills only if user-named/task-matched. No design skills for backend/docs/tests.
After 3 reads, report findings before more. One update before multi-step; one result after.
After you're done with whole task provide : End note explaining user what happened and what changed in simple words, and how its gonna benefit end user.

## Tests

Only card-named/directly affected tests. Never full suite without explicit user request.
Backend: `$env:PYTHONPATH='.;backend'; python -m pytest <test> -q`. Desktop/ext: `node --test <test>`.
