# Kiroku Note

Local-first Japanese capture: FastAPI + SQLite + Chromium extension + Electron.
SQLite is source of truth. AnkiConnect is optional integration, never truth.
Dictionary access: `YomitanService` + `dictionary_provider.py`; JLPT data/rules stay local.

## Rules

- One requested slice only. Read only card-named files. Do not start another slice.
- Stop/ask: FINAL change; two unexplained targeted-test failures; extension-breaking contract; scope beyond card.
- `STATUS.md`: max 5 concise lines. Commit with requested slice message.
- No emoji in UI, copy, logs, templates, or code; use SVG/plain text.
- Keep failed Anki syncs as local cards. Never commit study DB/media/backups, builds, or secrets.
- FINAL: Bottom Dock/sliding pill and Kanji Mastery. Do not alter markup, layout, color, geometry, timing, or dock items. New screens open from existing screens.
- Use existing tokens and `--ease-*`; honor reduced motion. Keep animations; performance work may change drivers only.

## Route

| Area | Map | Tests |
|---|---|---|
| grammar | `docs/maps/grammar.md` | `backend/tests/test_grammar_*.py`; `extension/tests/*grammar*.test.js` |
| vocab/cards/dictionary/Anki | `docs/maps/vocab.md` | `test_capture_*`, `test_cards_*`, `test_dictionary*`, `test_anki*` |
| study | `docs/maps/study.md` | named `backend/tests/test_study_*.py` |
| ocr | `docs/maps/ocr.md` | named `backend/tests/test_ocr_*.py` |
| llm/secrets | `docs/maps/llm.md` | named `test_llm_*`, `test_secret_store.py` |
| cloud | `docs/maps/cloud.md` | named `kiroku_cloud_queue/tests/*` |
| desktop shell | `docs/maps/desktop-shell.md` | named `desktop/tests/*.test.js` |
| desktop UI | `docs/maps/desktop-views.md`; `docs/maps/ui-rules.md` | named `desktop/tests/*.test.js` |

## Execution

Order: task → `IGNORE.md` → area map → card-named files → targeted test.
No unrelated maps/docs/files, broad directory scans, external browsing, or exploration.
`docs/maps/ui-rules.md` is sole active UI reference; other `docs/` files only when card-named. `docs/archive/` is historical.
Load a skill only if user-named, platform-required, or task-description match. No design/UI skills for backend, docs, tests, refactors, config. UI: read UI rules, then load one relevant skill unless task requires more.
After 3 substantive reads, retain/report only task-relevant findings before more reads. One short update before multi-step work; one result after.
Card overrides broad guidance.

## Tests

Only card-named/directly affected tests. Never full backend/desktop/extension suite without explicit user request. Ask user before full backend suite even if card requests it.
Backend: `$env:PYTHONPATH='.;backend'; python -m pytest <test> -q`.
Desktop/extension: `node --test <test>`.
