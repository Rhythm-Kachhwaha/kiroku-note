# Contract: cloud-auth
Depends-on: db

## Purpose
Cloudflare Worker OAuth 2.0 (Google, GitHub), cryptographic JWT authentication, persistent shortcut tokens (`krk_live_*`), single-use exchange codes, and session cookie lifecycle for Kiroku Note clients (Web, Extension, Desktop).

## Boundaries
- `GET /auth/guest`, `POST /auth/guest`: Issues guest learner session (302 redirect or JSON `{ ok: true, token, user }`).
- `GET /auth/google`: Initiates Google OAuth2 authorization code flow with CSRF state cookie.
- `GET /auth/github`: Initiates GitHub OAuth2 flow with CSRF state cookie (503 if unconfigured).
- `GET /auth/callback/google`: Validates CSRF state, exchanges code for Google tokens/profile, issues JWT session cookie, redirects to client.
- `GET /auth/callback/github`: Validates CSRF state, exchanges code for GitHub tokens/profile, issues JWT session cookie, redirects to client.
- `POST /auth/exchange`: Exchanges single-use auth code for `{ token, user }` (request: `{ code, state? }` -> response: `{ token, user }`).
- `GET /auth/me`: Inspects caller session cookie or Bearer token (response: `{ authenticated: true, user, source }` or 401 `{ authenticated: false, user: null }`).
- `GET /api/user/token`: Returns persistent shortcut token `{ token, user_id, created_at }` for authenticated non-guest users (401 unauthenticated, 403 guest).
- `POST /api/user/token/regenerate`: Revokes existing shortcut token and issues new `{ token, user_id, regenerated: true, created_at }`.
- `POST /auth/logout`: Server-side token revocation and clears session cookie (response: `{ status: 'ok', logged_out: true }`).
- Core exports: `authenticateRequest(c)`, `verifyJwt(token, secret)`, `signJwt(payload, secret)`, `isAllowedOrigin(origin, env)`, `isAllowedRedirect(redirectUri, env)`, `getUserToken(userId, env)`, `verifyUserToken(token, env)`, `revokeToken(token, env)`, `revokeShortcutToken(token, env)`, `isTokenRevoked(token, env)`, `storeAuthCode(code, data, env)`, `consumeAuthCode(code, env)`.

## State and storage
- In-memory state: `userTokens` (userId -> token), `tokenToUser` (token -> {sub, role}), `revokedTokens` (sig -> exp), `authCodes` (code -> data), `rateLimitMap` (IP -> bucket).
- Persistent state (KV / Turso when configured): `USER_TOKENS_KV` (`user:*`, `token:*`, `code:*`, `revoked:*`) or Turso tables (`user_auth_tokens`, `revoked_tokens`, `auth_exchange_codes`, `users`).
- Environment variables: `JWT_SECRET`, `ENVIRONMENT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALLOWED_ORIGINS`, `ALLOWED_EXTENSION_IDS`, `WORKER_HOST`, `CLOUD_QUEUE_API_KEY`, `SUBMIT_TOKEN`, `PHONE_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.

## Dependencies
- Web Crypto API (`crypto.subtle`, `crypto.getRandomValues`, `crypto.randomUUID`).
- External OAuth endpoints (`accounts.google.com`, `oauth2.googleapis.com/token`, `googleapis.com/oauth2/v2/userinfo`, `github.com/login/oauth/access_token`, `api.github.com/user`).
- Turso LibSQL client (`turso.js`) for multi-instance persistence when configured.

## Invariants
- In production mode (`ENVIRONMENT=production`), unconfigured `JWT_SECRET` or secret matching `DEFAULT_JWT_SECRET` MUST fail closed (500/503/401); dev fallback secret is never accepted in production.
- Constant-time verification (`timingSafeEqual`) must be used for static keys and secrets.
- Expired, future-dated (>300s clock skew), wrong-issuer, or tampered JWTs must be strictly rejected.
- Revoked JWTs and revoked shortcut tokens must be rejected on the immediate next request.
- Auth exchange codes (`krk_code_*`) are strictly single-use and expire within 60 seconds; consuming a code twice or consuming an expired code must fail with 400.
- OAuth state parameters MUST be cryptographically validated against `oauth_state` HttpOnly cookie to prevent CSRF attacks.
- Redirect targets after OAuth flow must strictly match `isAllowedRedirect` (loopback ports for desktop, known Chrome extension IDs for extension, or same-origin web); arbitrary open redirect URLs must be rejected.
- CORS with credentials (`credentials: true`) must NEVER reflect arbitrary disallowed origins; only origins validated by `isAllowedOrigin` receive credentialed CORS headers.
- Guest users cannot generate persistent shortcut tokens (`/api/user/token` returns 403 Forbidden).
- Service credentials (`is_service: true`) cannot impersonate end-user identities or mint user tokens.
- Every authenticated route must enforce per-user isolation: user A cannot access or mutate user B's tokens or records.

## Failure behavior
- Missing authorization header or invalid session cookie returns 401 Unauthorized (`{ authenticated: false, user: null }`).
- Guest attempting to generate shortcut token returns 403 Forbidden.
- Unconfigured OAuth client ID in production mode returns 503 Service Unavailable (or redirect with error query parameter).
- OAuth CSRF mismatch or expired code returns 400 Bad Request.
- Downstream identity provider (Google/GitHub) HTTP error returns 500 Internal Server Error without leaking client secrets.
- Untrusted redirect target falls back to default web redirect `/` instead of untrusted destination.

## Out of scope
- Local desktop SQLite auth (handled by local backend `app/api/study/auth.py`).
- Password hashing or local email/password registration (auth is strictly OAuth 2.0, guest, or crypto shortcut tokens).
- Card synchronization logic and conflict resolution (handled by `sync` module).
