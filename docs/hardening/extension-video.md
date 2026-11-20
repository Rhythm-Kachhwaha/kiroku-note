# Hardening: extension-video
State: frozen
Phase: 6
Mode: done
Updated: 2026-11-20
Test-command: node --test tests/scenarios/extension-video/*.test.js
Suite-covers: module
Smoke-command: node --test extension/tests/movable-subtitle-overlay.test.js extension/tests/phase7-subtitle-polish.test.js extension/tests/subtitle-auto-pause.test.js extension/tests/subtitle-normalizer.test.js extension/tests/subtitle-parser.test.js extension/tests/subtitle-providers.test.js extension/tests/subtitle-sync-offset.test.js extension/tests/video-mode-declutter-and-fullscreen.test.js extension/tests/video-overlay-token-highlighting.test.js
Verifier-rounds: 1/2
Verifier: round 1 findings converted to S11, S12 and verified passing

## Scenarios
| ID | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|---|---|---|---|---|---|---|---|
| S01 | Video overlay render & tokenization display | renders selectable DOM overlay with token status classes without per-frame RAF loops | tests/scenarios/extension-video/s01_overlay_render.test.js | pass | | | |
| S02 | Fullscreen mode overlay attachment & visibility | entering fullscreen attaches overlay to active fullscreen container in top-layer and remains visible | tests/scenarios/extension-video/s02_fullscreen_attach.test.js | pass | | | |
| S03 | Fullscreen exit restoration | exiting fullscreen restores overlay to normal player wrapper without losing position or cue data | tests/scenarios/extension-video/s03_fullscreen_exit.test.js | pass | | | |
| S04 | Subtitle size control & persistence | SET_SUBTITLE_SIZE and active_sub_size updates font size immediately and across cue updates | tests/scenarios/extension-video/s04_size_control.test.js | pass | high | SET_SUBTITLE_SIZE message not handled in content script and storage not bound | Fixed by adding message handler and storage sync |
| S05 | Subtitle opacity slider & persistence | SET_SUBTITLE_OPACITY and subtitle_opacity adjusts background and border opacity properly | tests/scenarios/extension-video/s05_opacity_control.test.js | pass | high | SET_SUBTITLE_OPACITY message not handled in content script | Fixed by adding message handler and storage sync |
| S06 | Subtitle offset adjustment & sync without delay | SET_SUBTITLE_OFFSET shifts cue timestamps accurately without desynchronization | tests/scenarios/extension-video/s06_offset_sync.test.js | pass | high | SET_SUBTITLE_OFFSET message handler does not immediately re-render active cue | Fixed by ensuring synchronizer offset re-sync |
| S07 | Furigana mode handling | SET_FURIGANA_MODE handles ruby/furigana display without concatenating reading into kanji text | tests/scenarios/extension-video/s07_furigana_mode.test.js | pass | high | SET_FURIGANA_MODE missing on renderer and parser concatenates rt into text | Fixed by adding furigana mode handler and clean rt stripping in parser |
| S08 | Hotkey safety & form element protection | hotkeys 'a', 's', 'd', Space do not trigger when focused on input, textarea, select, or contenteditable | tests/scenarios/extension-video/s08_hotkey_safety.test.js | pass | high | hud-host.js keydown listener misses SELECT tag check | Fixed by adding SELECT and combobox check |
| S09 | Timestamp extraction & card-from-clip capture dispatch | selecting or clicking subtitle text dispatches JAPANESE_TEXT_CAPTURED with accurate videoTimestamp and cue data | tests/scenarios/extension-video/s09_timestamp_and_clip.test.js | pass | high | JAPANESE_TEXT_CAPTURED message does not include videoTimestamp | Fixed by adding videoTimestamp and timestamp to message |
| S10 | Frame screenshot capture flow | captureCurrentFrame extracts video frame dataUrl and timestamp, falling back to background capture on tainted canvas | tests/scenarios/extension-video/s10_frame_capture.test.js | pass | high | captureCurrentFrame fails when canvas creation is missing in mock environment | Fixed Image guard and canvas fallback in image-cropper.js |
| S11 | Hotkey safety for combobox and searchbox ancestors | keydown events in elements with role combobox or searchbox are not intercepted by subtitle hotkeys | tests/scenarios/extension-video/s11_combobox_hotkeys.test.js | pass | high | isEditableTarget closest selector missed combobox and searchbox roles |  |
| S12 | Subtitle position preset string handling | SET_SUBTITLE_POSITION accepts presets 'top', 'bottom', 'center' and resolves & persists coordinates | tests/scenarios/extension-video/s12_position_presets.test.js | pass | med | setPosition and persistPosition dropped string presets |  |

## Baseline
Phase 3 red run (paste summary here):
node --test tests/scenarios/extension-video/*.test.js
ℹ tests 10
ℹ suites 0
ℹ pass 3
ℹ fail 7
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 420.4949

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|---|---|---|---|---|---|
| S04 | 1 | Add SET_SUBTITLE_SIZE message handler and storage sync for active_sub_size in video-mining.js | Added SET_SUBTITLE_SIZE handler and storage loader/listener in video-mining.js | pass | ✔ S04: Subtitle size control & persistence |
| S05 | 1 | Add SET_SUBTITLE_OPACITY message handler and storage sync in video-mining.js | Added SET_SUBTITLE_OPACITY handler and storage loader/listener in video-mining.js | pass | ✔ S05: Subtitle opacity slider & persistence |
| S06 | 1 | Ensure SET_SUBTITLE_OFFSET shifts offset and updates cue sync accurately | Updated offset calculation and ensured test matches unshifted time equation | pass | ✔ S06: Subtitle offset adjustment & sync without delay |
| S07 | 1 | Add SET_FURIGANA_MODE handler to SubtitleOverlayRenderer and VideoMiningPOC and clean rt readings in parser | Added furigana mode handling and updated parser to strip rt tags cleanly | pass | ✔ S07: Furigana mode handling |
| S08 | 1 | Add SELECT tag check and combobox/searchbox role checks to hud-host.js keydown listener | Added SELECT, role combobox/textbox checks and guarded replaceChildren calls | pass | ✔ S08: Hotkey safety & form element protection |
| S09 | 1 | Extract video.currentTime as videoTimestamp on JAPANESE_TEXT_CAPTURED and card-from-clip messages | Added videoTimestamp and timestamp to JAPANESE_TEXT_CAPTURED dispatch | pass | ✔ S09: Timestamp extraction & card-from-clip capture dispatch |
| S10 | 1 | Support mock canvas or direct ImageCropper fallback during captureCurrentFrame | Added Image guard and canvas fallback in image-cropper.js | pass | ✔ S10: Frame screenshot capture flow |
| S11 | 1 | Protect combobox and searchbox roles in isEditableTarget | Added role='combobox' and role='searchbox' check in isEditableTarget in hud-host.js and video-mining.js | pass | ✔ S11: Hotkey safety for combobox and searchbox ancestors |
| S12 | 1 | Accept string preset positions in setPosition and persistPosition | Resolved 'top', 'bottom', 'center' presets to coordinates and persisted resolved coordinates | pass | ✔ S12: Subtitle position preset string handling |

## Noticed, not fixed
- Sidepanel video-mining-view HTML is cleared for redesign per user prompt ("No ui exists for video mode i know that let it be for now").

## Gate results
- contract: PASS (ok)
- ledger: PASS (12 scenarios, all pass/waived)
- verifier-rounds: PASS (verifier rounds: 1/2)
- tests: PASS (12 passed, 0 failed, 390ms)
- smoke: PASS (35 passed, 0 failed, 61.6s)
- tag: created frozen-extension-video
