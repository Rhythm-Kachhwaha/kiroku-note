# Drift Report: Split Modules vs Canonical Runtime

This report lists differences between split modules and runtime canonical files for link, subtitle, and video domains.

## Video Mining
- Runtime canonical: `extension/content/video-mining.js` (3090 lines)
- Split source files: `extension/content/video-mining/{controller,controls,detector,main,overlay,sync}.js` (sum: 3044 lines)
- Comparison: Features [A3], [A6], and [A7] added HUD and auto subtitle detection to `video-mining.js`.
- Runtime injection: `background.js` `VIDEO_MINING_SCRIPTS` injects `video-mining.js` directly along with `link-bridge.js` and lib helpers. The split files are not loaded by the extension at runtime.

## Side Panel
- Runtime canonical: `extension/sidepanel/sidepanel.js` (12449 lines), loaded directly via `<script src="sidepanel.js">` in `sidepanel.html`.
- Split modules: `extension/sidepanel/modules/{core,dictionaries,card-preview,video-tab,layout,ask-tab}.js` (sum: 12335 lines).
- Missing in split modules:
  - `ensureSecondaryYomitanIndicator` (present in `sidepanel.js`)
  - `checkSetupChecklist` (present in `sidepanel.js`)
- Subtitle/Link/Video functionality: Core video tab and subtitle controls are present in both, but `sidepanel.html` never loads `modules/*`.

## Summary
Per Decision D1, runtime files `sidepanel.js` and `content/video-mining.js` are canonical for execution. Split copies are retained untouched per project architecture rules.

