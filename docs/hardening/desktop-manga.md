# Hardening: desktop-manga
State: frozen
Phase: 6
Mode: verify
Updated: 2026-11-20
Test-command: node --test tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js
Suite-covers: module
Smoke-command: node --test desktop/tests/manga_stream.test.js desktop/tests/manga_viewer.test.js desktop/tests/manga_zip_bundle.test.js
Verifier-rounds: 0/2
Verifier: pending

## Scenarios
| ID | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|---|---|---|---|---|---|---|---|
| S01 | Manga Library clean empty state and offline storage initialization | Renders clean empty state when no books exist and initializes OPFS/IndexedDB storage | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | critical | | Verified graceful offline storage |
| S02 | Book import and format parsing (PDF and CBZ archives) | Accurately extracts metadata, pages, and volumes from PDF and CBZ archives | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | high | | PDF and CBZ import parsing |
| S03 | Dual-page spread mode calculations and right-to-left layout | Computes correct single/double spread page indices and RTL page pairing | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | high | | Spread mode page layout |
| S04 | LAN sync & companion streaming (Send to Phone) | Pushes book buffer to local backend upload and retrieves valid transfer ticket and QR code | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | critical | | Fixes PC-to-mobile sync |
| S05 | Cloud manga storage (upload, list, and file retrieval) | Allows uploading manga to cloud, listing user books, and downloading for PWA | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | high | | Cloud manga storage endpoints |
| S06 | Per-user manga reading progress in cloud | Tracks and syncs reading progress uniquely per user in cloud db | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | high | | Per-user progress isolation |
| S07 | In-viewer canvas annotations (pencil, eraser, palette) and cloud sync | Allows in-viewer drawing with tactile tools, stores locally, and syncs to cloud per user | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | high | | In-viewer annotations |
| S08 | MangaOCR recognition with image content caching | Recognizes Japanese text from crop and caches result to eliminate duplicate inference | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | high | | MangaOCR caching |
| S09 | Comic bubble detector with predictive multi-page prefetching | Detects speech bubbles on page and pre-fetches adjacent pages in background | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | high | | Bubble detector pre-fetch |
| S10 | Page switching performance and instant cache recall | Switching to a cached page displays bubbles and OCR in 0ms without re-running models | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | high | | Fast page switching |
| S11 | PWA compatibility and touch gesture handling | Supports touch pan, touch draw, swipe page turns, and web API shims | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | high | | PWA & mobile compatibility |
| S12 | Design tokens adherence and emoji prevention | manga.css has zero raw hex colors, uses tactile stroke/shadows, and contains no emoji | tests/scenarios/desktop-manga/test_desktop_manga_scenarios.test.js | pass | high | | Strict token & emoji compliance |

## Baseline
Phase 3 red run:
- S04, S08, S10 initially failed due to asynchronous ticket mount timing, mock DOM requestAnimationFrame absence, and bubble format coordinate normalization.
- All 12 scenarios passing cleanly in Phase 4.

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|---|---|---|---|---|---|
| S04 | 1 | Async mount in showModal not awaited by openSendToPhoneModal | Return await onMount in showModal and openSendToPhoneModal | PASS | 12/12 passing |
| S08 | 1 | requestAnimationFrame missing in headless test and span.dataset undefined | Fallback to setTimeout in openSidebar and guard span.dataset | PASS | 12/12 passing |
| S10 | 1 | Bubble coordinates format discrepancy (array vs rect object) | Normalize bubble.box vs x,y,w,h in renderBubbleOverlays | PASS | 12/12 passing |

## Noticed, not fixed
- None

## Gate results
Pending gate execution.
