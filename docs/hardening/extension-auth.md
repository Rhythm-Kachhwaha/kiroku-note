# Hardening: extension-auth
State: frozen
Phase: 7
Mode: fix
Updated: 2026-11-20
Test-command: node --test tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js
Suite-covers: module
Smoke-command: node --test extension/tests/extension_cloud_sync.test.js
Verifier-rounds: 2/2
Verifier: clean

## Scenarios
| ID  | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|-----|----------|----------------|------|--------|----------|------------|------|
| S01 | OAuth code exchange session persistence | auth.js exchanges code with /auth/exchange, persists token to all canonical keys and session user, broadcasts CLOUD_AUTH_CHANGED | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | critical | | Full exchange and persistence verified |
| S02 | CSRF state parameter mismatch rejection | Mismatched state between callback URL and stored kiroku_oauth_state throws error and stores zero tokens | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | critical | | CSRF state protection |
| S03 | Missing CSRF state rejection when state expected | Callback URL without state rejects when kiroku_oauth_state is stored | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | critical | In auth.js condition `if (expected && st && st !== expected)` allowed bypass when st is missing | Fixed by requiring st and verifying state match before consumption |
| S04 | One-time CSRF state consumption | kiroku_oauth_state is purged immediately on verification attempt | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | high | | Anti-replay state consumption |
| S05 | OAuth error callback handling | Callback URL with error parameter updates UI error state without altering storage | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | high | | Error callback handling |
| S06 | Token retrieval across multiple canonical storage keys | getStoredCloudToken resolves token stored under any canonical key | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | high | | Multi-key token discovery |
| S07 | Stored session status query | GET_CLOUD_AUTH_STATUS returns session info when authenticated, false when missing | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | high | | Status query messaging |
| S08 | Expired token detection and fail-closed cleanup | Expired token fails validation, clears storage keys and broadcasts unauthenticated | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | critical | background.js lacked VALIDATE_CLOUD_AUTH handler to check /auth/me and purge stale session | Fixed by adding VALIDATE_CLOUD_AUTH with fail-closed purge on 401 |
| S09 | Logout lifecycle | CLOUD_LOGOUT calls server logout, clears all storage keys and broadcasts unauthenticated | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | critical | | Clean logout lifecycle |
| S10 | OAuth initiation generates and persists CSRF state | OAuth start message generates random state and persists in storage | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | high | background.js CLOUD_LOGIN_* handlers launched auth without generating state or saving kiroku_oauth_state | Fixed by generating state, saving to storage, and attaching to URL |
| S11 | Exchange network failure aborts cleanly | Non-2xx response from /auth/exchange aborts without writing partial tokens | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | high | | Network failure containment |
| S12 | Sidepanel module modularity invariant | All modules in extension/sidepanel/modules/*.js remain separate and sidepanel.js is absent | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | critical | | Sidepanel separation rule |
| S13 | Direct token parameter validation fail-closed | Direct token query parameter must validate against /auth/me before persisting session | tests/scenarios/extension-auth/test_extension_auth_scenarios.test.js | pass | high | Direct token parameter accepted without validating against /auth/me | Fixed by requiring successful /auth/me validation for direct token params |

## Baseline
Phase 3 red run (paste summary here):
```
▶ extension-auth hardening scenario suite
  ✔ S01: OAuth code exchange session persistence (66.3781ms)
  ✔ S02: CSRF state parameter mismatch rejection (56.4513ms)
  ✖ S03: Missing CSRF state rejection when state expected (67.631ms)
  ✔ S04: One-time CSRF state consumption (61.4604ms)
  ✔ S05: OAuth error callback handling (56.4419ms)
  ✔ S06: Token retrieval across multiple canonical storage keys (0.4972ms)
  ✔ S07: Stored session status query (60.7392ms)
  ✖ S08: Expired token detection and fail-closed cleanup (63.4601ms)
  ✔ S09: Logout lifecycle (59.7991ms)
  ✖ S10: OAuth initiation generates and persists CSRF state (59.8311ms)
  ✔ S11: Exchange network failure aborts cleanly (55.5249ms)
  ✔ S12: Sidepanel module modularity invariant (0.9541ms)
✖ extension-auth hardening scenario suite (614.6418ms)
ℹ tests 12
ℹ suites 1
ℹ pass 9
ℹ fail 3
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1776.1036
```

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|----------|---|------------|--------|--------|----------|
| S03 | 1 | In auth.js, purge state and throw error if state is expected but missing or mismatched | extension/auth.js:41-45 | pass | ✔ S03: Missing CSRF state rejection when state expected (62.4913ms) |
| S08 | 1 | Implement VALIDATE_CLOUD_AUTH in background.js to test /auth/me and purge expired tokens fail-closed | extension/background.js:1463-1498 | pass | ✔ S08: Expired token detection and fail-closed cleanup (59.9142ms) |
| S10 | 1 | Generate state, save to kiroku_oauth_state, pass state in auth URL, and handle fallback with ok: true | extension/background.js:1365-1378 | pass | ✔ S10: OAuth initiation generates and persists CSRF state (61.8654ms) |
| S13 | 1 | Direct token query parameter must validate against /auth/me before persisting session | extension/auth.js:78-81 | pass | ✔ S13: Direct token parameter validation fail-closed (60.1681ms) |

## Noticed, not fixed

## Gate results
2026-11-20:
```
[PASS] contract: ok
[PASS] ledger: 13 scenarios, all pass/waived
[PASS] verifier-rounds: verifier rounds: 2/2
[PASS] tests: 13 passed, 0 failed
[PASS] smoke: 4 passed, 0 failed
GATE PASSED for module 'extension-auth'
```
