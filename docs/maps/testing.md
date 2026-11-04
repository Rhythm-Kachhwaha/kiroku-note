# Testing map

1. **Testing policy** — Prefer behavior and contract tests over fragile source-substring grep checks.
2. **FINAL lock tests** — `desktop/tests/final_lock.test.js` guards locked byte-identical components.
3. **Backend suite** — `$env:PYTHONPATH='.;backend'; python -m pytest <test> -q`.
4. **Desktop suite** — `node --test <test>`. Run only directly affected or card-named tests.
5. **Extension suite** — `node --test extension/tests/<name>.test.js`.
6. **Headless & CI** — Skip GUI-dependent lifecycle and transport tests when no display is available.
