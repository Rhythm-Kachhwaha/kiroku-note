# Desktop views

Desktop UI lives in `desktop/src/ui/`; views live in `desktop/src/ui/views/` and share the shell. Reuse validated vanilla web UI with desktop overrides focused on Quick Add and History. Keep SQLite authoritative and preserve simultaneous browser-extension access.

The Bottom Dock and Kanji Mastery section are FINAL. Do not change their markup, layout, colors, or animation timing. Screens must be reached from existing screens rather than by adding dock items.

Use only named desktop tests: `node --test desktop/tests/<name>.test.js`.

## Desktop Endpoint Audit Results

| Method | Endpoint | Status | OpenAPI | Source |
|---|---|---|---|---|
| GET | `/api/anki/decks` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/anki/models` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/anki/status` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/capture` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/capture` | ok | yes | desktop/src/ui/views/watch_primer.js |
| GET | `/api/cards` | ok | yes | desktop/src/ui/services/api_client.js |
| DELETE | `/api/cards/bulk` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/cards/bulk-sync` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/cards/export` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/cards/save` | ok | yes | desktop/src/ui/services/link_mine.js |
| POST | `/api/cards/save` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/cards/stats` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/cards/sync-all` | ok | yes | desktop/src/ui/services/api_client.js |
| DELETE | `/api/cards/{card_id}` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/cards/{card_id}` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/cards/{card_id}/sync` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/dictionary/provision` | ok | yes | desktop/src/ui/views/settings.js |
| GET | `/api/dictionary/search-english` | ok | yes | desktop/src/ui/services/api_client.js |
| PUT | `/api/dictionary/settings` | ok | yes | desktop/src/ui/views/settings.js |
| GET | `/api/dictionary/status` | ok | yes | desktop/src/ui/views/settings.js |
| POST | `/api/grammar/analyze` | ok | yes | desktop/src/ui/views/vocab_watch.js |
| POST | `/api/grammar/analyze` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/grammar/points` | ok | yes | desktop/src/ui/services/api_client.js |
| PATCH | `/api/grammar/points/{pattern_key}` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/grammar/points/{pattern_key}/encounters` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/grammar/stats` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/grammar/syllabus` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/health` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/kanji/browse` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/kanji/compounds/{character}` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/kanji/details/{character}` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/kanji/seen` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/kanji/strokes/{character}` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/known-words` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/known-words/mark` | ok | yes | desktop/src/ui/services/link_mine.js |
| POST | `/api/known-words/mark` | ok | yes | desktop/src/ui/services/api_client.js |
| DELETE | `/api/known-words/mark/{word}` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/learner` | ok | yes | desktop/src/ui/services/api_client.js |
| PUT | `/api/learner` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/link/primer` | ok | yes | desktop/src/ui/views/watch_primer.js |
| POST | `/api/link/recap` | ok | yes | desktop/src/ui/views/watch_primer.js |
| GET | `/api/llm/config` | ok | yes | desktop/src/ui/services/api_client.js |
| PUT | `/api/llm/config` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/llm/status` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/llm/test` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/ocr/start` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/ocr/status` | ok | yes | desktop/src/ui/services/api_client.js |
| POST | `/api/ocr/stop` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/study/v1/analytics/weak-areas` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/bank/import/commit` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/bank/import/pdf/inspect` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/bank/import/pdf/{import_id}/pages` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/bank/import/pdf/{import_id}/preview` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/bank/import/preview` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/bank/questions` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/bank/questions/{id}` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/bank/questions/{id}/provenance` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/bank/questions/{id}/reports` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/bank/summary` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/dashboard/overview` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/diagnostics` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/exam/history` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/exam/readiness` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/exam/sessions` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/exam/sessions/{id}` | 400 | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/exam/sessions/{id}/complete` | ok | yes | desktop/src/ui/services/study_client.js |
| PUT | `/api/study/v1/exam/sessions/{id}/items/{item}/answer` | ok | yes | desktop/src/ui/services/study_client.js |
| PUT | `/api/study/v1/exam/sessions/{id}/items/{item}/flag` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/exam/sessions/{id}/result` | 400 | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/exam/sessions/{id}/sections/{section}/pause` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/exam/sessions/{id}/sections/{section}/resume` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/exam/sessions/{id}/sections/{section}/start` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/exam/sessions/{id}/sections/{section}/submit` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/history/incorrect` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/history/incorrect/{question_id}` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/media/{asset_id_or_sha256}` | 400 | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/practice/sessions` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/practice/sessions/{id}` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/practice/sessions/{id}/abandon` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/practice/sessions/{id}/answer` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/practice/sessions/{id}/complete` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/study/v1/practice/sessions/{id}/feedback` | ok | yes | desktop/src/ui/services/study_client.js |
| GET | `/api/study/v1/settings` | ok | yes | desktop/src/ui/services/study_client.js |
| PATCH | `/api/study/v1/settings` | ok | yes | desktop/src/ui/services/study_client.js |
| POST | `/api/subtitle/annotate` | ok | yes | desktop/src/ui/views/vocab_watch.js |
| POST | `/api/subtitle/annotate` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/vocab/coverage` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/vocab/daily-word` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/vocab/gaps` | ok | yes | desktop/src/ui/services/api_client.js |
| GET | `/api/yomitan/dictionaries` | ok | yes | desktop/src/ui/services/api_client.js |
