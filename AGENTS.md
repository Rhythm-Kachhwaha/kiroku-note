# Kiroku Note Agent Guide

Kiroku Note captures Japanese vocabulary and sentences locally, enriches them,
saves to SQLite, then optionally syncs to Anki. It is a Windows FastAPI backend,
Chromium extension, and Electron desktop shell. SQLite is source of truth;
AnkiConnect is never source of truth.

## Always

- Work one requested slice only. Read only its listed files; do not start a
  later slice. Stop and ask before changing a FINAL component, after two
  unexplained targeted-test failures, or before an extension-breaking contract.
- Keep changes within the card's expected scope. Use `STATUS.md` for at most
  five concise lines, then commit with the requested slice message.
- Never use emojis in UI, copy, logs, templates, or code. Use accessible SVG
  icons or plain text.
- Keep FastAPI/SQLite local-first. Keep dictionary providers behind
  `YomitanService` and `dictionary_provider.py`. Keep JLPT rules local.
- Preserve failed Anki syncs as locally saved cards.
- Do not edit FINAL components: Bottom Dock (including sliding pill) or Kanji
  Mastery section layout. New screens open from existing screens.
- Use existing tokens and `--ease-*`; honor reduced motion. Do not remove
  animations for performance work.
- Never commit study databases, study media, backups, generated build output,
  or secrets.

## Task router

| Area | Read map | Targeted tests |
| --- | --- | --- |
| Grammar | `docs/maps/grammar.md` | `backend/tests/test_grammar_*.py`, `extension/tests/*grammar*.test.js` |
| Vocabulary, cards, dictionary, Anki | `docs/maps/vocab.md` | `backend/tests/test_capture_*.py`, `test_cards_*.py`, `test_dictionary*.py`, `test_anki*.py` |
| Study | `docs/maps/study.md` | named `backend/tests/test_study_*.py` only |
| OCR | `docs/maps/ocr.md` | named `backend/tests/test_ocr_*.py` |
| LLM and secrets | `docs/maps/llm.md` | named `backend/tests/test_llm_*.py`, `test_secret_store.py` |
| Cloud queue | `docs/maps/cloud.md` | named `kiroku_cloud_queue/tests/*` only |
| Desktop shell | `docs/maps/desktop-shell.md` | named `desktop/tests/*.test.js` only |
| Desktop views and UI | `docs/maps/desktop-views.md`, `docs/maps/ui-rules.md` | named `desktop/tests/*.test.js` only |

## Test policy

Run only tests named by task instructions or directly affected tests. Never run
the full backend, desktop, or extension suite unless explicitly requested.
Backend targeted command: `$env:PYTHONPATH='.;backend'; python -m pytest <test> -q`.
Desktop targeted command: `node --test <test>`. Extension targeted command:
`node --test <test>`.

Ask the user before running the full backend suite, even if a task requests it.

## Efficient agent workflow

The user names the task; determine the smallest valid path without asking them
how to read files or save tokens. Work in this order: task, area map, files
named by the task, targeted test. Read no unrelated maps or documentation.

Use a skill only when the user names it, the platform requires it, or the task
directly matches its description. Do not load design or UI skills for backend,
documentation, tests, refactors, or configuration. For UI work, read
`docs/maps/ui-rules.md` first and load only one relevant skill unless the task
requires more.

Do not explore files, browse external sources, or inspect broad directories
unless the task requires it. After three substantive file reads, summarize only
what affects the task before reading more. Send one concise update before a
multi-step run and one result after it. The active slice card overrides broad
repository guidance.

## Maps

Read only the map for the active area. `docs/maps/ui-rules.md` is default UI
reference. Use design, animation, and visual-review skills only when a task
explicitly asks for design, animation, or UI polish. Archive is historical:
`docs/archive/`. Do not read other `docs/` files unless a task card explicitly
names them. See `STATUS.md` for current state and open issues.
