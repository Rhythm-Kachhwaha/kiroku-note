# Contract: desktop-anime
Depends-on: desktop

## Purpose
Provides the desktop Anime immersion tab: Anime Library, continue-watching row, series watch history, inline episode inspector with JLPT difficulty breakdown, brutalist flashcard review screen, and real-time extension playback connection status.

## Boundaries
- View Component Lifecycle:
  - `mount(container)`: attaches to renderer root DOM, initializes universal JLPT level listener, queries backend info.
  - `render()`: renders container shell with connection stepper, continue-watching header, series library, and review modal.
  - `onShow()`: re-checks universal JLPT level and refreshes watch history if stale (>30s).
  - `unmount()`: cleans up interval timers, event listeners, and link store bindings.
- Episode Inspection & Study Actions:
  - `toggleEpisodeInspector(hash, forceReload)`: toggles inline accordion inspector with vocabulary/grammar analysis and caching.
  - `startReviewSession(type, epHash)`: launches brutalist flashcard study modal for episode words.
  - `handleReviewAction(action)`: processes 'known' or 'mine' actions on cards.
- Title & Localization Formatting:
  - `setTitleLang(lang)`: switches between 'en' and 'jp' series titles.
  - `getSeriesTitle(item, lang)`: resolves canonical or localized title.
  - `calculateWatchProgress(seriesOrEps)`: computes watch percentage (85% completion threshold).
- Subtitle Parsing:
  - `SubtitleParser.parseSubtitles(rawText, filename)`: parses SRT, VTT, ASS, SSA into normalized `{ startTime, endTime, text }` cues.

## State and storage
- In-memory state:
  - `episodeInspectorCache`: Map of cached episode inspection payloads keyed by episode hash.
  - `seriesList`, `sessions`: active watch history and continue-watching datasets.
  - `reviewSession`: active flashcard review session state.
- Persistent client keys:
  - `kiroku_anime_title_lang`: 'en' | 'jp' title display preference.
  - `kiroku_anime_pinned`, `kiroku_anime_bookmarks`: pinned series list in localStorage.
  - `kiroku_dumped_grammar`: set of ignored/dumped grammar patterns.
  - `learner_jlpt_level`: universal target JLPT study level.

## Dependencies
- Node.js & Electron runtime.
- Backend link endpoints: `/api/link/series`, `/api/link/sessions`, `/api/link/episodes/{hash}/inspect`, `/api/link/poster`.
- `SubtitleParser` (`desktop/src/ui/lib-shared/subtitle_parser.mjs`).

## Invariants
1. Offline resilience: If backend is offline or returns error, renders clean empty state without throwing unhandled exceptions.
2. Design tokens: Strict adherence to `tokens.css`; zero raw hex outside allowed tokens; tactile buttons with offset shadows.
3. No emoji: Strict plain text / SVG icons; no emoji characters anywhere in UI or copy.
4. Universal JLPT synchronization: Reacts to `kiroku:learner-level-changed` events by clearing cached episode inspections and re-rendering active inspectors with the updated target level.
5. Inspection isolation: Episode inspector cache is keyed by episode hash and cleared when learner level changes.

## Failure behavior
- Backend offline: Renders empty state banner ("No watch history yet") without uncaught exceptions or UI crash.
- Corrupted backend responses: Safely caught in try/catch blocks with fallbacks to empty arrays.
- Missing localStorage: Automatically falls back to in-memory storage dictionary so Node tests and headless runs execute without ReferenceError.

## Out of scope
- WebSocket streaming and legacy pairing codes (replaced by HTTP polling & LinkStore).
- Direct audio waveform playback manipulation (handled in study tab).
