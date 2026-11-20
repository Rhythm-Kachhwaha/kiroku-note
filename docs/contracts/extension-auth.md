# Contract: extension-auth
Depends-on: cloud-auth

## Purpose
Extension client authentication lifecycle: initiates OAuth login (Google/GitHub) via Chrome identity or browser tab flow, enforces CSRF state parameter validation, exchanges authorization codes for JWT session tokens via Edge Worker `/auth/exchange`, persists session credentials across canonical Chrome local storage keys, validates token freshness/expiry against `/auth/me`, provides service-worker message dispatch for auth status query and logout, and broadcasts `CLOUD_AUTH_CHANGED` to synchronise sidepanel and extension UI states.

## Boundaries
- Input: Runtime messages (`CLOUD_LOGIN_GOOGLE`, `CLOUD_LOGIN_GITHUB`, `CLOUD_LOGOUT`, `GET_CLOUD_AUTH_STATUS`, `VALIDATE_CLOUD_AUTH`), OAuth redirect callback URLs (`auth.html?code=...&state=...`, `auth.html?error=...`).
- Output: Stored session keys in `chrome.storage.local`, runtime broadcast messages (`CLOUD_AUTH_CHANGED`), HTTP requests to Cloud Worker (`/auth/exchange`, `/auth/me`, `/auth/logout`).

## State and storage
- `chrome.storage.local` keys:
  - Canonical primary token: `kiroku_auth_token`
  - Mirrored compatibility keys: `kiroku.cloud.auth_token`, `kiroku_cloud_token`, `kiroku.extension.session_token`, `kiroku.extension.auth_token`
  - Session user profile: `kiroku_auth_session` (`{ sub, email, name, role }`)
  - In-flight CSRF state: `kiroku_oauth_state`

## Dependencies
- Cloud Worker (`https://kiroku-note.rhythmkach.workers.dev`):
  - `POST /auth/exchange`
  - `GET /auth/me`
  - `POST /auth/logout`
- Chrome Extension APIs: `chrome.storage.local`, `chrome.runtime`, `chrome.identity`, `chrome.tabs`.

## Invariants
1. CSRF state integrity: Auth code redemption requires an exact match between callback state and stored `kiroku_oauth_state`; missing or mismatched state aborts exchange.
2. One-time state consumption: `kiroku_oauth_state` is purged immediately upon verification attempt.
3. Single source of session truth: A successful login writes identical token values to all canonical storage keys and saves the verified user object.
4. Fail-closed on expired/invalid credentials: If `/auth/me` returns 401 or token is malformed, extension treats session as unauthenticated and cleans up invalid stored tokens.
5. Clean logout: Logout invalidates the server-side session via `/auth/logout`, clears all token and session keys from `chrome.storage.local`, and broadcasts `CLOUD_AUTH_CHANGED` (`authenticated: false, user: null`).
6. Reliable messaging: Every auth-related runtime message receives an explicit asynchronous response object (`{ ok: boolean, ... }`).
7. Modular sidepanel: Sidepanel modules in `extension/sidepanel/modules/*.js` remain separate and are never merged or bundled into a monolith.

## Failure behavior
- Network error during exchange/validation: Preserves existing state if transient, surfaces explicit error message, never commits unverified credentials.
- Expired token on validation check: Clears local tokens, transitions UI to signed-out, broadcasts `CLOUD_AUTH_CHANGED`.
- OAuth error callback: Extracts error description, updates UI error state, aborts exchange.

## Out of scope
- Cloud Worker JWT signing and hashing (owned by `cloud-auth`).
- Desktop SQLite sync and database operations (owned by `sync` and `db`).
- Grammar / dictionary search logic in extension.
