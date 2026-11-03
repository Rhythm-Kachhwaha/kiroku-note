# Vocabulary, cards, dictionary and Anki

1. **Entry point** — capture and save requests originate in `extension/sidepanel/sidepanel.js` and `extension/content/content.js`; backend entrypoints are `/api/capture`, `/api/cards/*`, dictionary routes and Anki routes in `backend/app/main.py`.
2. **Core logic** — `backend/app/services/card_service.py`, `card_normalizer.py`, `anki_formatter.py`, `media_storage.py`, and `verb_metadata.py`; persistence is `backend/app/repositories/card_repository.py`.
3. **API/integration** — `backend/app/services/yomitan.py` is the Yomitan HTTP boundary; `dictionary_provider.py` selects Yomitan/local/auto providers; `anki_connect.py` is the AnkiConnect boundary.
4. **Data/configuration** — SQLite is resolved by `config.py`; local dictionary resources are in `kiroku_dictionary/` and `kiroku_dict.sqlite`; card media is resolved by `media_storage.py`.
5. **Tests** — `backend/tests/test_capture_*.py`, `test_cards_*.py`, `test_card_*.py`, `test_dictionary*.py`, `test_yomitan*.py`, `test_anki*.py`, `test_sync_*.py`, plus corresponding extension tests.
6. **Build/runtime dependencies** — preserve duplicate identity, SQLite-first saves, pending/failed sync states, Anki external duplicate checks, and all manifest-declared browser message paths.

## Media and subtitles

1. **Entry point** — browser content scripts and Side Panel media controls in `extension/content/`, `extension/lib/`, and `extension/sidepanel/`.
2. **Core logic** — `backend/app/services/subtitle_annotator.py`, `media_storage.py`, and the capture/media helpers in the extension.
3. **API/integration** — `backend/app/api/subtitle.py` owns subtitle annotation and known-word routes; `main.py` registers it.
4. **Data/configuration** — SQLite card/known-word tables and the configured media directory; subtitle providers and parsers are in `extension/lib/`.
5. **Tests** — `backend/tests/test_subtitle_*.py`, media/audio/frame stage tests, and extension subtitle/capture/video tests.
6. **Build/runtime dependencies** — `extension/manifest.json` must list every content script and library in load order; do not mix browser code into backend services.
