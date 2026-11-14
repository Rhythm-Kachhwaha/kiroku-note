# Kiroku Note — Changelog

All notable changes to Kiroku Note Desktop, PWA, and Cloud Infrastructure are documented in this file.

---

## [2.1.0] - 2026-11-14

### Added
- **Mobile PWA Ergonomics**:
  - Implemented `responsive.css` featuring fluid typography scaling with CSS `clamp()`.
  - Added mobile safe area insets (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`).
  - Enforced minimum 44px tap targets for all touch buttons and rail navigation links.
  - Added physical tactile haptics (`desktopAPI.haptic.tap()` and `notification()`) via `navigator.vibrate`.
  - Added touch swipe-to-dismiss gesture for notifications and error alert banners.
  - Added native PWA install prompt handler (`desktopAPI.pwa.promptInstall()`).

- **Settings: Sync & Analytics (Render Dashboard Consolidation)**:
  - Ported Queue Inspector directly into `Settings -> Sync & Analytics` with real-time pending, leased, acknowledged, and failed counters.
  - Added PC Worker heartbeat indicator and live recent op-log stream table with manual retry affordance.
  - Ported Anki Mirror statistics with card category distribution, retention percentage, and daily streak tracking.
  - Implemented 30-day activity SVG heat-map rendering daily study volume and manga reading.

- **Edge Security & Hardening**:
  - Configured strict Content Security Policy (CSP), `X-Content-Type-Options: nosniff`, and `X-Frame-Options: DENY` on Cloudflare Worker responses.
  - Implemented token-bucket rate limiter enforcing 30 requests/minute per IP on `/auth/*` and `/api/oplog/write`.
  - Implemented sanitized crash telemetry endpoint (`POST /api/telemetry/report`) with optional Sentry forwarding.
  - Added OAuth origin validation allowlist restricting redirects to trusted origins (`*.workers.dev`, custom domains, localhost).

- **MangaOCR Model Streaming & Versioning**:
  - Added GitHub Release assets CDN streaming fallback in Service Worker with CacheStorage pre-caching.
  - Added model versioning guard (`X-Model-Version`) to automatically purge stale weights.
  - Added WebGPU inference benchmarking and execution provider tracking in `ocr_worker.js`.

- **Quality Guard & CI/CD**:
  - Added contract verification test `desktop/tests/final_contract_guard.test.js`.
  - Added end-to-end PWA simulation test `desktop/tests/pwa.e2e.test.js`.
  - Created `.github/workflows/ci.yml` matrix covering Python Turso worker, contract guards, desktop tests, PWA build, and Wrangler dry-run.

### Deprecated
- **Render Dashboard**: Decommissioned legacy Render web service and PostgreSQL database in favor of Turso libSQL and Cloudflare Workers edge architecture.

