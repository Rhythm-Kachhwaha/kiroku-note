# Contract: security
Depends-on: db

## Purpose
Comprehensive security boundary for Kiroku Note across local backend, Electron desktop shell, and extension interfaces. Ensures cryptographic protection of user secrets at rest (LLM API keys, Anki tokens, cloud credentials) via Windows DPAPI / isolated secret store, robust host header and DNS rebinding defense, strict CORS and extension origin allowlisting, ephemeral constant-time bearer token authentication for Study APIs, path traversal and file upload sanitization, typed input validation preventing SQL/command injection, and zero leakage of sensitive credentials in logs, error payloads, or inter-process communications.

## Boundaries
- Secret Storage Boundary (`SecretStore` in `backend/app/services/secret_store.py`):
  - Encrypts and decrypts sensitive values (LLM API keys, cloud tokens, Anki credentials) using OS-level DPAPI (`CryptProtectData`/`CryptUnprotectData` on Windows) or memory-isolated fallback.
  - Public interface: `get_secret(key_id)`, `set_secret(key_id, secret)`, `delete_secret(key_id)`, `has_secret(key_id)`.
  - Atomic persistence via temporary file rename (`.secrets.enc.tmp` -> `.secrets.enc`).
- Host & DNS Rebinding Boundary (`backend/app/main.py`, `backend/app/config.py`):
  - Middleware inspects incoming `Host` headers against `get_allowed_host_regex()`: strictly permits loopback (`localhost`, `127.0.0.1`, `testserver`) and explicitly configured tunnel hosts (`KIROKU_ALLOWED_HOSTS`). Untrusted hosts return 403 Forbidden.
- CORS & Origin Boundary (`backend/app/main.py`):
  - Enforces strict origin filtering on state-changing HTTP methods (`POST`, `PUT`, `DELETE`, `PATCH`).
  - Blocks `Origin: null` and untrusted external origins (`https://evil.com`) with 403 Forbidden.
  - Restricts Chrome extension origins to explicitly allowlisted extension IDs (`get_allowed_extension_ids()`).
  - Preflight `OPTIONS` requests never reflect arbitrary origins or `*` when credentials or state changes are involved.
  - Loopback clients and requests without Origin headers (native Electron main process, curl, local Python scripts) pass without CORS obstruction.
- Study API Authentication Boundary (`backend/app/api/study/auth.py`):
  - Ephemeral bearer token authentication (`_STUDY_API_TOKEN`) passed via `Authorization: Bearer <token>`.
  - Constant-time token verification (`secrets.compare_digest`) to prevent timing side-channel attacks.
  - Safe sanitization rejecting whitespace, tabs, or newline control characters in tokens.
  - In-memory rate limiting against brute-force token enumeration (`MAX_FAILED_ATTEMPTS = 30` per minute).
- Media & File Path Traversal Boundary (`backend/app/main.py`):
  - Validates and resolves media/audio/manga file paths strictly inside designated user data or media directories.
  - Rejects directory traversal tokens (`../`, `..\`, absolute foreign paths) with 400 Bad Request or 404 Not Found.
- Typed Input & Injection Boundary:
  - Bulk operations (`/api/cards/bulk`, `/api/cards/bulk-sync`, `/api/cards/bulk-deck`) enforce strictly typed integer IDs (`list[int]`), rejecting strings and injection strings with 422 Unprocessable Entity.
  - SQL queries use parameterized placeholders across all repositories; zero raw string interpolation.
- Electron & IPC Boundary (`desktop/src/main/main.js`, `desktop/src/preload/preload.js`):
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`.
  - `will-navigate` blocks navigation to external origins; `setWindowOpenHandler` denies unauthorized new windows.
  - IPC channels allowlist restricts renderer capabilities; Study API token injected in main process and never leaked to renderer.

## State and storage
- Encrypted secrets: `%LOCALAPPDATA%\KirokuNote\data\.secrets.enc` (or `KIROKU_SECRETS_PATH`). Encrypted at rest using Windows DPAPI. Never committed to version control.
- In-memory state: ephemeral Study API token, rate limiting failure timestamps (`_FAILED_ATTEMPTS`), CORS allowlist cache.
- Environment variables: `KIROKU_ALLOWED_HOSTS`, `KIROKU_ALLOWED_ORIGINS`, `KIROKU_EXTENSION_IDS`, `KIROKU_STUDY_API_TOKEN`, `KIROKU_STUDY_AUTH_DISABLED`.

## Dependencies
- Standard library: `ctypes`, `secrets`, `hashlib`, `json`, `re`, `pathlib`, `tempfile`.
- FastAPI, Starlette, Pydantic for request validation, typed parsing, and response status codes.
- Windows DPAPI (`crypt32.dll`, `kernel32.dll`) on Windows platforms.

## Invariants
- 1. Plaintext secrets (API keys, auth tokens) are never persisted in unencrypted files, SQLite databases, or logged in application log files.
- 2. Stored secret file writes are strictly atomic via `.tmp` rename; failures do not corrupt existing secret stores.
- 3. Corrupted or unreadable `.secrets.enc` files do not crash the application; the store recovers safely and records an operational failure.
- 4. Host header validation prevents DNS rebinding attacks: any Host header not matching loopback or configured hosts is rejected with 403.
- 5. State-changing requests (`POST`, `PUT`, `DELETE`, `PATCH`) with `Origin: null` or untrusted external origins are strictly forbidden (403).
- 6. Disallowed origins never receive credentialed CORS reflection or wildcard `*`.
- 7. Study API bearer token validation uses constant-time comparison (`secrets.compare_digest`).
- 8. Study tokens containing whitespace or newline characters are rejected as invalid during sanitization.
- 9. Repeated invalid authentication attempts to Study API are throttled by rate limiting.
- 10. File and media access endpoints strictly prevent directory traversal (`../`, `..\`) and reject requests attempting to escape allowed root directories.
- 11. Bulk card endpoints strictly enforce integer IDs and reject non-integer strings with HTTP 422 before database execution.
- 12. Object string representations (`__repr__`, `__str__`) for `SecretStore` and sensitive models never disclose secret values.

## Failure behavior
- Untrusted Host header returns 403 Forbidden with plain text error.
- Untrusted or null Origin on state-changing request returns 403 Forbidden JSON payload.
- Missing or invalid Study API bearer token returns 401 Unauthorized with structured JSON error.
- Exceeded authentication rate limit returns 401 Unauthorized (rate limited) and logs warning.
- Path traversal attempt returns 400 Bad Request or 404 Not Found without leaking filesystem structure.
- Malformed bulk request payload returns 422 Unprocessable Entity with validation details.
- Corrupted `.secrets.enc` file is backed up with timestamp suffix, and store resets cleanly to prevent server crash.

## Out of scope
- Third-party OAuth 2.0 provider implementations (handled by `cloud-auth` and `extension-auth`).
- Local user password hashing or multi-user access control (single-user local-first desktop application).
- Network transport encryption for remote cloud sync (handled by HTTPS/TLS in worker and cloud sync clients).
