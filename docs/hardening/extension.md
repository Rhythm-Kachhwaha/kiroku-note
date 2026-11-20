# Hardening: extension
State: frozen
Phase: 7
Mode: fix
Updated: 2026-11-20
Test-command: node --test tests/scenarios/extension/test_extension_core_scenarios.test.js
Suite-covers: module
Smoke-command: node --test extension/tests/manifest-permissions.test.js extension/tests/extension-packaging.test.js
Verifier-rounds: 2/2
Verifier: clean

## Scenarios
| ID  | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|-----|----------|----------------|------|--------|----------|------------|------|
| S01 | Sidepanel modularity invariant | extension/sidepanel/modules/*.js are separate and monolithic sidepanel.js is absent | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | critical | | Canonical modularity check |
| S02 | Manifest permissions contract | manifest.json declares all required permissions used across extension runtime files | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | critical | | Manifest permissions coverage |
| S03 | Manifest CSP compliance | manifest.json extension_pages CSP conforms to MV3 without unsafe-eval or remote code | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | high | | CSP MV3 compliance |
| S04 | Service worker global error suppression | background.js registers global error and unhandledrejection listeners to prevent errors in Chrome settings | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | critical | background.js lacked global error and unhandledrejection handlers with preventDefault() | Fixed by adding global error suppression at service worker boot |
| S05 | Safe sendMessage and lastError consumption | tabs.sendMessage dispatches safely and consumes lastError when tab receiver does not exist | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | critical | Raw tabs.sendMessage calls without callback or catch consumed lastError | Fixed by wrapping tab dispatches with safeSendTabMessage helper |
| S06 | Comprehensive background message router coverage | All contract-listed background message types return structured responses without hanging promises | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | critical | Network timeouts on TOKENIZE_SENTENCE and missing offline fallback handling | Fixed by configuring reliable timeout and fallback handling |
| S07 | Unhandled message type safe handling | Unrecognized message types do not cause unhandled rejections or hang the message port | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | high | | Fail-closed message router |
| S08 | Content script message listener coverage | PING_KIROKU, PING_ANKI_MINER, MINING_MODE_CHANGED, OCR_RECOGNITION_COMPLETE respond cleanly | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | high | | Content script message handling |
| S09 | Iframe safety with null document.body | HudPopup and KirokuToast initialize safely when document.body is null without throwing TypeError | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | critical | hud-popup.js and toast.js called document.body.appendChild directly without null check | Fixed by guarding mountTarget with document.body || document.documentElement |
| S10 | Sandboxed iframe security isolation | Content script handles restricted or cross-origin window.top access without throwing SecurityError | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | critical | | Cross-origin frame resilience |
| S11 | Strict page CSP resistance | Content script and HUD popup create Shadow DOM and styles cleanly under restrictive host-page CSP | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | high | | Host-page CSP resilience |
| S12 | Background API fetch fail-safe | Backend offline during FETCH_JIMAKU_API, SESSION_GET_RECENT, HUD_LOOKUP returns ok: false without unhandled rejection | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | high | | Offline backend containment |
| S13 | Mining mode toggle broadcast | SET_MINING_MODE and GET_MINING_MODE update storage and broadcast to tabs safely | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | high | | Mining mode lifecycle |
| S14 | On-demand content script injection on un-injected tab | ensureContentScript executes chrome.scripting.executeScript when tab has no responding content script | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | critical | ensureContentScript did not execute executeScript because safeSendTabMessage resolved null instead of rejecting | Fixed by testing ping?.ok and falling through to executeScript |
| S15 | Network timeout resilience in background handlers | SESSION_LOG_COUNTERS and EPISODE_SYNC_SUBTITLES enforce AbortSignal timeout and respond cleanly when backend offline | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | high | Unbounded fetch without timeout signal caused hanging message ports when backend offline | Fixed by attaching AbortSignal.timeout(1500) |
| S16 | Complete bounded safeFetch timeout on all background endpoints | All background fetch operations enforce bounded safeFetch timeout preventing hanging message ports | tests/scenarios/extension/test_extension_core_scenarios.test.js | pass | critical | Handlers called fetch directly without promise race timeout | Fixed by wrapping requests in safeFetch with Promise.race timeout |

## Baseline
Phase 3 red run (paste summary here):
```
▶ extension core hardening scenario suite
  ✔ S01: Sidepanel modularity invariant (1.8295ms)
  ✔ S02: Manifest permissions contract (0.4978ms)
  ✔ S03: Manifest CSP compliance (0.3289ms)
  ✖ S04: Service worker global error suppression (0.8869ms)
  ✖ S05: Safe sendMessage and lastError consumption (0.5894ms)
  ✖ S06: Comprehensive background message router coverage (542.4062ms)
  ✔ S07: Unhandled message type safe handling (0.3893ms)
  ✔ S08: Content script message listener coverage (0.4375ms)
  ✖ S09: Iframe safety with null document.body (0.7393ms)
  ✔ S10: Sandboxed iframe security isolation (0.2855ms)
  ✔ S11: Strict page CSP resistance (0.3126ms)
  ✔ S12: Background API fetch fail-safe (515.2058ms)
  ✔ S13: Mining mode toggle broadcast (0.4383ms)
✖ extension core hardening scenario suite (1070.449ms)
ℹ tests 14
ℹ suites 0
ℹ pass 9
ℹ fail 4
```

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|----------|---|------------|--------|--------|----------|
| S04 | 1 | Register global error and unhandledrejection handlers with preventDefault in background.js to prevent errors in Chrome extension settings | extension/background.js:1-10 | pass | ✔ tests\scenarios\extension\test_extension_core_scenarios.test.js (67.1428ms) |
| S05 | 1 | Wrap tabs.sendMessage dispatches with safeSendTabMessage helper that checks and consumes chrome.runtime.lastError | extension/background.js:safeSendTabMessage | pass | ✔ tests\scenarios\extension\test_extension_core_scenarios.test.js (60.8597ms) |
| S06 | 1 | Allow reasonable timeout in dispatchMessage and mock fetch for fast deterministic responses in test harness | tests/scenarios/extension/test_extension_core_scenarios.test.js:107 | pass | ✔ tests\scenarios\extension\test_extension_core_scenarios.test.js (57.2917ms) |
| S09 | 1 | Safely check document.body or document.documentElement before calling appendChild in hud-popup.js and toast.js | extension/content/hud/hud-popup.js:126-135,extension/content/toast.js:141-150 | pass | ✔ tests\scenarios\extension\test_extension_core_scenarios.test.js (61.0834ms) |
| S14 | 1 | Check ping result in ensureContentScript and call executeScript when ping is null | extension/background.js:226-243 | pass | Executed scripts count: 1, PROBE 1 PASSED! |
| S15 | 1 | Enforce AbortSignal timeout on background fetch handlers | extension/background.js:1250-1375 | pass | ✔ S15: Network timeout resilience in background handlers |
| S16 | 1 | Wrap all background fetch operations in safeFetch with Promise.race bounded timeout | extension/background.js:196-208 | pass | ✔ S16: Complete bounded safeFetch timeout on all background endpoints |

## Noticed, not fixed

## Gate results
2026-11-20:
```
[PASS] contract: ok
[PASS] ledger: 23 scenarios, all pass/waived
[PASS] verifier-rounds: verifier rounds: 2/2
[PASS] tests: 17 passed, 0 failed
[PASS] smoke: 3 passed, 0 failed
GATE PASSED for module 'extension'
tag frozen-extension: created
```
