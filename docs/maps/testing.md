# Testing map

1. **Testing policy** — Prefer behavior and contract tests over fragile source-substring grep checks; use `desktop/tests/helpers/dom.js` for lightweight fake DOM in Node tests.
2. **FINAL lock tests** — `desktop/tests/final_lock.test.js` guards locked byte-identical components (bottom dock and Kanji mastery). Source-substring assertions are reserved for locked invariants.
3. **Backend suite** — Run with `$env:PYTHONPATH='.;backend'; python -m pytest <test> -q` (install dependencies with `pip install -r requirements-dev.txt`). Honor pytest markers: `network` for online/live resources, `windows` for Windows-specific flows.
4. **Desktop suite** — Run with `node --test desktop/tests/<name>.test.js`. Target only directly affected or card-named tests.
5. **Extension suite** — Run with `node --test extension/tests/<name>.test.js`. Assert DOM structures and client API contracts without breaking browser behaviors.
6. **Headless & CI** — Skip GUI-dependent lifecycle and transport tests gracefully on Linux CI when DISPLAY is absent.
7. **OpenAPI contract** — Endpoints and schemas are verified against `desktop/tests/fixtures/openapi.json` without manual ad-hoc edits.
8. **Service isolation** — Mock external services (Yomitan, AnkiConnect) with contract-compliant fixtures; do not fabricate study data.
9. **Test suite hygiene** — Keep tests deterministic, fast, isolated, and free of persistent side-effects or leftover temporary files.
10. **Targeted testing only** — Never run full backend/desktop/extension suites unless explicitly requested.
11. **Commit message hooks** — Activate format checks with `git config core.hooksPath .githooks`. Verifies `type(scope): summary [N<n>]` format via `tools/check_commit_msg.py`.
