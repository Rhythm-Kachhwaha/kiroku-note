# Hardening: security
State: frozen
Phase: 7
Mode: fix
Updated: 2026-11-20
Test-command: python -m pytest tests/scenarios/security/ -q
Suite-covers: module
Smoke-command: python -m pytest backend/tests/test_secret_store.py backend/tests/test_host_security.py -q
Verifier-rounds: 0/2
Verifier: clean

## Scenarios
| ID  | Scenario | Pass condition | Test | Status | Severity | Root cause | Note |
|-----|----------|----------------|------|--------|----------|------------|------|
| S01 | SecretStore encryption at rest | Secret file contains encrypted ciphertext and never raw secret strings | tests/scenarios/security/test_security_scenarios.py | pass | critical | | Cryptographic storage protection |
| S02 | SecretStore atomic persistence | File writes use temporary file replacement preventing corruption | tests/scenarios/security/test_security_scenarios.py | pass | critical | | Atomic write durability |
| S03 | SecretStore corrupt file recovery | Corrupted secrets file does not crash store; recovers safely with clean fallback | tests/scenarios/security/test_security_scenarios.py | pass | high | | Resilient recovery under corruption |
| S04 | SecretStore input validation and deletion | Invalid key/secret types raise ValueError; delete removes key and returns boolean | tests/scenarios/security/test_security_scenarios.py | pass | high | | Input validation and state consistency |
| S05 | Host header validation and DNS rebinding defense | Untrusted Host header returns 403 Forbidden; loopback/configured hosts succeed | tests/scenarios/security/test_security_scenarios.py | pass | critical | | DNS rebinding protection |
| S06 | State-changing request origin enforcement | State-changing requests with Origin: null or untrusted origin return 403 Forbidden | tests/scenarios/security/test_security_scenarios.py | pass | critical | | Cross-origin request forgery defense |
| S07 | Extension origin allowlist enforcement | Configured extension ID accepted; rogue or unknown extension ID receives 403 | tests/scenarios/security/test_security_scenarios.py | pass | critical | | Untrusted extension origin barrier |
| S08 | Preflight CORS reflection prevention | Disallowed origin preflight does not reflect untrusted origin or wildcard * | tests/scenarios/security/test_security_scenarios.py | pass | high | | Restrictive CORS headers |
| S09 | Study API constant-time bearer authentication | Valid bearer token accepted; missing, invalid, or empty token rejected with 401 | tests/scenarios/security/test_security_scenarios.py | pass | critical | | Study API bearer token validation |
| S10 | Study API token sanitization | Tokens containing newlines, tabs, or spaces are rejected as invalid | tests/scenarios/security/test_security_scenarios.py | pass | high | | Token whitespace sanitization |
| S11 | Study API authentication rate limiting | Repeated invalid auth attempts trigger rate limiting (401 rate limited) | tests/scenarios/security/test_security_scenarios.py | pass | high | | Brute-force guessing mitigation |
| S12 | Path traversal defense on media endpoints | Media requests with ../, ..\, or absolute path traversal return 400 or 404 | tests/scenarios/security/test_security_scenarios.py | pass | critical | | Path traversal prevention |
| S13 | Typed ID validation on bulk endpoints | Non-integer string IDs or injection strings in bulk delete rejected with 422 | tests/scenarios/security/test_security_scenarios.py | pass | critical | | Typed Pydantic payload enforcement |
| S14 | Secret leakage prevention in diagnostics | SecretStore string representations, logs, and health endpoints never leak keys | tests/scenarios/security/test_security_scenarios.py | pass | critical | | Zero plaintext credential leakage |

## Baseline
Phase 3 red run (paste summary here):
```
============================= test session starts =============================
platform win32 -- Python 3.11.1, pytest-9.1.1, pluggy-1.6.0
rootdir: D:\Python\AnkiMiner
collected 14 items

tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s01_secret_store_encryption_at_rest PASSED [  7%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s02_secret_store_atomic_persistence PASSED [ 14%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s03_secret_store_corrupt_file_recovery PASSED [ 21%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s04_secret_store_input_validation_and_deletion PASSED [ 28%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s05_host_header_validation_and_dns_rebinding_defense PASSED [ 35%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s06_state_changing_origin_enforcement PASSED [ 42%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s07_extension_origin_allowlist_enforcement PASSED [ 50%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s08_preflight_cors_reflection_prevention PASSED [ 57%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s09_study_api_bearer_authentication PASSED [ 64%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s10_study_api_token_sanitization PASSED [ 71%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s11_study_api_authentication_rate_limiting PASSED [ 78%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s12_path_traversal_defense_on_media_endpoints PASSED [ 85%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s13_typed_id_validation_on_bulk_endpoints PASSED [ 92%]
tests/scenarios/security/test_security_scenarios.py::SecurityHardeningScenarioTests::test_s14_secret_leakage_prevention_in_diagnostics PASSED [100%]

============================= 14 passed in 10.87s =============================
```

## Attempts
| Scenario | # | Hypothesis | Change | Result | Evidence |
|----------|---|------------|--------|--------|----------|
| S09 | 1 | Mount test on actual study diagnostic route to test bearer dependency | tests/scenarios/security/test_security_scenarios.py:206 | pass | 14 passed in 10.87s |

## Noticed, not fixed

## Gate results
