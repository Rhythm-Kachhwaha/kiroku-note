# Hardening: cloud-auth
State: frozen
Phase: 7
Mode: fix
Updated: 2026-11-20
Test-command: node --test tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js
Suite-covers: module
Smoke-command: node --test worker/tests/audit_remediation.test.js
Verifier-rounds: 2/2
Verifier: clean

## Scenarios
| ID  | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|-----|----------|----------------|------|--------|----------|------------|------|
| S01 | Guest login session issuance | GET /auth/guest issues session cookie with Max-Age and JSON returns token and user | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | | Guest session initialization |
| S02 | Multi-credential authentication | Cookie, Bearer JWT, and Bearer shortcut token accepted; unauthenticated returns 401 | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | signJwt lacks default exp claim causing verifyJwt rejection | Session cookie validation |
| S03 | Expired JWT rejection | JWT past exp timestamp is rejected with 401 on /auth/me | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | | Expiry boundary enforcement |
| S04 | Tampered JWT and dev secret rejection in production | Forged JWT and DEFAULT_JWT_SECRET token rejected when ENVIRONMENT=production | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | Insecure DEFAULT_JWT_SECRET accepted in production mode | Production cryptographic integrity |
| S05 | Production missing secret fails closed | Missing JWT_SECRET in production fails closed (500/401), never uses dev fallback | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | | Safe fail-closed configuration |
| S06 | Server-side token revocation | POST /auth/logout revokes JWT and shortcut token; immediate next request is 401 | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | | Immediate token invalidation |
| S07 | OAuth CSRF state protection | Missing, mismatched, or altered oauth_state cookie rejected with 400 | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | | CSRF state parameter validation |
| S08 | Auth code exchange lifecycle | Auth code is single-use, expires in 60s, and enforces state matching on exchange | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | | Secure auth code exchange flow |
| S09 | Redirect URI allowlist enforcement | Disallowed arbitrary redirects rejected; known extension and localhost allowed | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | high | | Open redirect prevention |
| S10 | CORS origin validation with credentials | Disallowed origin receives no credentialed CORS headers; allowed origin accepted | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | CORS middleware reflects arbitrary untrusted origins with credentials: true | Credentialed CORS reflection defense |
| S11 | Guest forbidden from shortcut token generation | Guest user receives 403 Forbidden on GET and POST /api/user/token | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | high | | Privilege escalation prevention |
| S12 | Shortcut token regeneration invalidation | Regenerating shortcut token immediately invalidates prior token | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | high | Token missing default exp during regeneration request | Re-issuance invalidation lifecycle |
| S13 | Service credential isolation | Static API key authenticates as service role and cannot mint user tokens | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | high | /api/user/token missing check for service role / is_service | Service role separation |
| S14 | Rate limiting on auth endpoints | Exceeding burst capacity on /auth/* returns 429 with Retry-After header | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | high | | Abuse prevention |
| S15 | Future-dated JWT nbf claim rejection | Future-dated nbf claim (>300s clock skew) rejected by verifyJwt and /auth/me (401) | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | verifyJwt missing validation for future nbf claim | Verifier finding: future nbf claim accepted |
| S16 | Production fails closed on DEFAULT_JWT_SECRET guest login | POST /auth/guest with DEFAULT_JWT_SECRET in production fails closed (500) | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | handleGuestLogin accepted DEFAULT_JWT_SECRET when ENVIRONMENT=production | Verifier finding: dev secret mints in prod |
| S17 | Auth exchange code 60-second expiration enforcement | Auth exchange code expires within 60s; redemption at t+65s fails with 400 | tests/scenarios/cloud-auth/test_cloud_auth_scenarios.test.js | pass | critical | storeAuthCode missing default 60s TTL; consumeAuthCode accepts code without expiresAt | Verifier round 2 finding: code without exp never expires |

## Baseline
Phase 3 red run (paste summary here):
```
▶ cloud-auth hardening scenario suite
  ✔ S01: Guest login session issuance (31.0239ms)
  ✖ S02: Multi-credential authentication (3.0285ms)
  ✔ S03: Expired JWT rejection (1.9619ms)
  ✖ S04: Tampered JWT and dev secret rejection in production (2.3388ms)
  ✔ S05: Production missing secret fails closed (1.4856ms)
  ✔ S06: Server-side token revocation (1.5969ms)
  ✔ S07: OAuth CSRF state protection (1.2584ms)
  ✔ S08: Auth code exchange lifecycle (1.7826ms)
  ✔ S09: Redirect URI allowlist enforcement (0.287ms)
  ✖ S10: CORS origin validation with credentials (0.4677ms)
  ✔ S11: Guest forbidden from shortcut token generation (3.3281ms)
  ✖ S12: Shortcut token regeneration invalidation (1.082ms)
  ✖ S13: Service credential isolation (4.5708ms)
  ✔ S14: Rate limiting on auth endpoints (8.1955ms)
✖ cloud-auth hardening scenario suite (64.0699ms)
ℹ tests 14
ℹ suites 1
ℹ pass 9
ℹ fail 5
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 185.9728
```

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|----------|---|------------|--------|--------|----------|
| S02 | 1 | Add default 7-day expiration to signJwt when payload.exp is omitted | worker/auth.js:377 | pass | ✔ S02: Multi-credential authentication (30.8011ms) |
| S04 | 1 | Reject DEFAULT_JWT_SECRET in production mode when verifying requests | worker/auth.js:476-484 | pass | ✔ S04: Tampered JWT and dev secret rejection in production (30.0169ms) |
| S10 | 1 | Use isAllowedOrigin in cors origin callback to deny untrusted origins | worker/index.js:18-32 | pass | ✔ S10: CORS origin validation with credentials (24.9139ms) |
| S13 | 1 | Forbid service roles from generating user shortcut tokens | worker/auth.js:1044-1065 | pass | ✔ S13: Service credential isolation (25.6701ms) |
| S12 | 1 | Default exp claim in signJwt resolved token regeneration auth | worker/auth.js:377 | pass | ✔ S12: Shortcut token regeneration invalidation (1.4549ms) |
| S15 | 1 | Validate nbf claim in verifyJwt and reject future-dated tokens | worker/auth.js:443-446 | pass | ✔ S15: Future-dated JWT nbf claim rejection (32.2277ms) |
| S16 | 1 | Reject DEFAULT_JWT_SECRET in handleGuestLogin when in production mode | worker/auth.js:616-620 | pass | ✔ S16: Production mode fails closed when JWT_SECRET matches DEFAULT_JWT_SECRET (34.2429ms) |
| S17 | 1 | Enforce default 60s expiration in storeAuthCode and reject missing/expired in consumeAuthCode | worker/auth.js:261-285 | pass | ✔ S17: Auth exchange code 60-second expiration enforcement (32.4406ms) |

## Noticed, not fixed
- desktop/tests/shortcut_auth.test.js:103: unauthenticated call to /api/user/token in legacy test expected dev_user fallback, but /api/user/token strictly requires auth token.

## Gate results
2026-11-20:
```
[PASS] contract: ok
[PASS] ledger: 25 scenarios, all pass/waived
[PASS] verifier-rounds: verifier rounds: 2/2
[PASS] tests: 17 passed in 0.21s
[PASS] smoke: 8 passed in 0.16s

GATE PASSED for module 'cloud-auth'
tag frozen-cloud-auth: created
```
