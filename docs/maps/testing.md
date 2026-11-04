# Testing Strategy and Conventions

1. Prefer behavior tests over source-grep checks: instantiate views/components, dispatch user actions, and assert DOM state or API calls.
2. Source-substring assertions (`content.includes(...)`) are reserved exclusively for locked FINAL files (e.g., bottom dock and Kanji mastery blocks) to guarantee byte invariants.
3. For desktop UI tests in Node, use `desktop/tests/helpers/dom.js` to provide lightweight DOM mocks without heavyweight dependencies like jsdom.
4. Run only targeted tests during development: backend with `$env:PYTHONPATH='.;backend'; python -m pytest <test> -q`, desktop/extension with `node --test <test>`.
5. Backend tests must honor markers: `@pytest.mark.network` for tests needing internet, `@pytest.mark.windows` for Windows-specific flows.
6. Extension tests must assert DOM structures and client API contracts without altering verified browser behavior.
7. Endpoints and schemas are verified against `desktop/tests/fixtures/openapi.json` without manually editing fixture files.
8. GUI-dependent tests (Electron window launch, real transport) must skip gracefully on headless Linux CI when `DISPLAY` is missing.
9. Mocking external services (Yomitan, AnkiConnect) should use contract-compliant fixtures instead of ad-hoc payloads.
10. Test suite hygiene: keep tests deterministic, fast, isolated, and free of persistent side-effects or leftover temporary files.
