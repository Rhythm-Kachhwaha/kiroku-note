# Grammar

1. **Entry point** — `backend/app/api/grammar.py` exposes `/api/grammar/analyze`, setup, points, stats and encounter endpoints.
2. **Core logic** — `backend/app/services/grammar_service.py`, `grammar_matcher.py`, `grammar_reference.py`, and `grammar_tracker.py`.
3. **API/integration** — the router is included by `backend/app/main.py`; `extension/sidepanel/sidepanel.js` and content/video controllers request and render analysis.
4. **Data/configuration** — `backend/app/data/grammar_reference.sqlite`, `backend/app/data/master_grammar_dataset.json`, `backend/app/data/master_grammar_provenance.json`, `backend/app/data/openjlpt_grammar/`, and grammar attribution notices. The dataset strictly enforces the easiest-supported-level rule (N5 > N4 > N3 > N2 > N1).
5. **Tests** — `backend/tests/test_grammar_*.py`, `backend/tests/test_master_grammar_reconciliation.py`, `extension/tests/*grammar*.test.js`, and `tools/grammar_coverage.py`.
6. **Build/runtime dependencies** — `tools/reconcile_grammar_dataset.py` reconciles all 848 reference audit entries with OpenJLPT and curated seeds; `tools/build_grammar_index.py` compiles the master dataset into the checked-in `grammar_reference.sqlite` index; the PyInstaller spec must continue bundling it. Do not regenerate or move the database during unrelated refactors.
