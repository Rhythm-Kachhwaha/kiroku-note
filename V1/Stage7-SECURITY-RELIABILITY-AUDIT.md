# Stage 7 — Security & Reliability Audit

**Product:** Kiroku Note (V1.0)
**Date:** 2026-09-16
**Stage:** Stage 7.1 — Audit & Design
**Status:** COMPLETE (Audit Only — Zero source code modifications)
**Baseline:** 231/231 Backend Tests Passing | 29/29 Extension Suites Passing

---

## 1. Executive Summary

Kiroku Note is a local-first Japanese vocabulary mining tool with a well-architected trust model: the FastAPI backend binds exclusively to `127.0.0.1`, CORS is locked to extension and localhost origins, all SQLite queries are fully parameterized, DOM construction in the Side Panel is 100% XSS-safe via `createElement`/`textContent`, and the SQLite-first invariant is correctly enforced throughout.

The findings in this audit are **predominantly low-to-medium severity** with no critical vulnerabilities in the primary user flow. The most significant actionable issues are:

1. **No upper bound on the `limit` query parameter** in `GET /api/cards` — a local denial-of-service vector.
2. **`FETCH_YOUTUBE_TIMEDTEXT` in `background.js` fetches any URL passed by a content script** without domain validation — a same-extension SSRF-lite risk on hostile YouTube pages.
3. **`reload=True` in the development launcher** — exposes automatic code reloading and `/docs`/`/redoc` interactive API endpoints; must be disabled before any non-developer distribution.
4. **No CSP header on `sidepanel.html`** — while currently not exploitable given safe DOM practices, absence of defense-in-depth.
5. **Google Fonts CDN dependency** in `sidepanel.html` — a network request leaking browser activity to an external third party from a privacy-first tool.
6. **`cards.db` stale empty file** in `backend/data/` — a minor data confusion risk.
7. **`image` and `audio` fields in `SaveCardRequest` accept inline base64** up to 5 MB and 10 MB respectively in JSON body — unusually large for typical mining use and could cause memory pressure.
8. **`sync_error` messages from AnkiConnect are passed verbatim to the client** — low risk (local app, no auth), but errors may contain internal service addresses.

All project invariants (SQLite-first, no implicit Anki push on save, no automatic video seeks) are **verified and correctly implemented** in the current codebase.

---

## 2. Architecture & Trust-Boundary Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  BROWSER PROCESS (Chromium/Brave)                                            │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Web Page Context (UNTRUSTED)                                         │   │
│  │  - content.js, capture-utils.js, video-mining-poc.js               │   │
│  │  - youtube-adapter.js, netflix-adapter.js                           │   │
│  │  - subtitle-parser.js, image-cropper.js                             │   │
│  │  RISK: Receives subtitle text, Japanese text selections,            │   │
│  │        YouTube track URLs — all data from hostile web pages         │   │
│  └────────────────────┬─────────────────────────────────────────────────┘   │
│                       │ chrome.runtime.sendMessage (extension-internal only) │
│  ┌────────────────────▼─────────────────────────────────────────────────┐   │
│  │  Extension Service Worker — background.js (SEMI-TRUSTED)             │   │
│  │  - No externally_connectable → only internal extension messages     │   │
│  │  - Proxies FETCH_YOUTUBE_TIMEDTEXT (no URL domain validation)       │   │
│  │  - captureVisibleTab (screenshot)                                    │   │
│  │  - Offscreen audio capture lifecycle                                 │   │
│  └────────────────────┬─────────────────────────────────────────────────┘   │
│                       │ chrome.runtime.sendMessage                           │
│  ┌────────────────────▼─────────────────────────────────────────────────┐   │
│  │  Side Panel — sidepanel.js (TRUSTED, extension context)             │   │
│  │  - All DOM via createElement/textContent (XSS-safe)                │   │
│  │  - Calls local FastAPI REST API over localhost                      │   │
│  │  - No externally reachable extension APIs                           │   │
│  └────────────────────┬─────────────────────────────────────────────────┘   │
└───────────────────────┼─────────────────────────────────────────────────────┘
                        │ HTTP/JSON to 127.0.0.1:8000
            ┌───────────▼────────────────────────┐
            │  FastAPI Backend (TRUSTED)          │
            │  - Binds to 127.0.0.1 only         │
            │  - CORS: extension + localhost      │
            │  - Pydantic input validation        │
            │  - Parameterized SQL                │
            └──────┬────────────────┬────────────┘
                   │                │
         ┌─────────▼──────┐  ┌──────▼───────────┐
         │  SQLite         │  │ AnkiConnect       │
         │  127.0.0.1 DB  │  │ 127.0.0.1:8765   │
         │  (source of    │  │ (optional, local) │
         │   truth)        │  └──────────────────┘
         └─────────────────┘
                   │
         ┌─────────▼──────┐
         │  Yomitan        │
         │  127.0.0.1:19633│
         │  (optional,     │
         │   local)        │
         └─────────────────┘
```

### Trust Boundary Classification

| Boundary | Direction | Trust Level | Notes |
|---|---|---|---|
| Web page → content script | Inbound text/events | Untrusted | Japanese text, subtitle text, page URLs |
| Content script → background | Extension messaging | Internal | No external origin can reach this |
| Background → Side Panel | Extension messaging | Internal | No external origin can reach this |
| Side Panel → FastAPI | HTTP localhost:8000 | Controlled | CORS-gated; browser policy enforced |
| FastAPI → SQLite | File I/O | Trusted | Parameterized queries; file on local disk |
| FastAPI → AnkiConnect | HTTP localhost:8765 | Trusted | Machine owner configures endpoint |
| FastAPI → Yomitan | HTTP localhost:19633 | Trusted | Machine owner configures endpoint |
| Background → YouTube CDN | FETCH_YOUTUBE_TIMEDTEXT | Unvalidated URL | See Finding F-02 |

---

## 3. Threat Model

### 3.1 Realistic Attacker Types

**Attacker A — Malicious Webpage**
A hostile website the user visits while Kiroku Note is active. The content scripts (`content.js`, `video-mining-poc.js`) run on the page. The attacker can:
- Inject subtitle-like DOM nodes that get captured as Japanese text
- Serve a hostile `baseUrl` in YouTube player API responses (youtube-bridge.js injects into MAIN world)
- Craft malformed text to test input handling in Yomitan/backend

**Attacker B — Malicious Browser Extension**
Another installed extension that can call `chrome.runtime.sendMessage` to any extension. However, Kiroku Note has **no `externally_connectable`** manifest key, so only same-extension messages (content scripts, background, side panel) can communicate. This attacker is **blocked at the manifest level**.

**Attacker C — Malicious Local Application**
An application running on the same machine as the user. Can:
- Send HTTP requests to `127.0.0.1:8000` (FastAPI) — **most realistic threat for localhost services**
- Attempt to read SQLite at `backend/data/ankiminer.db`
- Attempt to write files to `backend/data/media/`

The CORS policy does **not** protect against a local application making non-browser HTTP requests (e.g., `curl` or a native app), because CORS is a browser-enforced policy. However, a local malicious app already has full filesystem access anyway — the incremental risk from the API is limited to: deleting cards, triggering Anki sync, or causing disk writes through media upload. There are no secrets, credentials, or privileged operations in this API.

**Attacker D — Malformed Dictionary Provider Response**
Yomitan returns a hostile or malformed AST. The YomitanService normalizer has `MAX_AST_DEPTH = 32` and wraps individual entry parsing in `try/except` blocks, so malformed entries are skipped rather than crashing the backend.

**Attacker E — Malicious Subtitle Content**
A hostile `.srt`/`.vtt` file loaded by the user, or hostile subtitle text from a streaming site. The subtitle text flows into the card editor as plain text fields (no HTML rendering of raw subtitle content). AnkiFormatter escapes all field content with `html.escape()` before inserting into Anki note HTML. XSS risk is **effectively zero** on the extension side (textContent only) and **very low** on the Anki side (escaped).

**Attacker F — Malicious Captured Text from Web**
A web page containing `<script>alert(1)</script>` or similar as visible text. The Side Panel receives this via JAPANESE_TEXT_CAPTURED message and populates card editor fields as `.value = text` (not innerHTML). The AnkiFormatter escapes it via `html.escape()`. Risk is **effectively mitigated**.

### 3.2 What is NOT in Scope

- Remote internet attacker directly accessing localhost (not possible unless user exposes port or has a CSRF-capable site + misconfigured CORS — the CORS regex blocks standard origins)
- Physical machine access
- Anki itself being compromised (Kiroku Note is a client of AnkiConnect)

---

## 4. Local API Security Audit

**File:** `backend/app/main.py`, `backend/app/services/card_service.py`, `backend/app/schemas.py`

### 4.1 Server Binding

```python
# run_backend.py
uvicorn.run("app.main:app", host="127.0.0.1", port=8000, ...)
```

✅ **Good:** Server binds exclusively to loopback `127.0.0.1`. It is not accessible from other machines on the LAN unless the user explicitly changes this.

### 4.2 CORS Policy

```python
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(chrome-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["*"],
    allow_headers=["*"],
)
```

✅ **Good:** Uses a specific regex rather than `allow_origins=["*"]`. Allows Chrome extensions (any ID — this is correct for MV3 local development) and localhost origins.

⚠️ **Informational:** `allow_origin_regex` covers `chrome-extension://.*` (any extension). This is intentional — the extension ID changes between browsers and developer/production installs. The threat of a foreign extension calling the API is mitigated by the fact that the API has no secrets, no auth tokens, and no privileged write surfaces beyond local SQLite card data. If a stricter policy is desired, a `KIROKU_ALLOWED_EXTENSION_ID` env var mechanism could lock to a specific extension ID in production.

⚠️ **Note:** CORS does not prevent a **non-browser** HTTP client (curl, Python requests, local malicious app) from calling the API. The only protection there is that `127.0.0.1` is reachable only from the local machine.

### 4.3 Authentication / Authorization

There is **no authentication** on any API endpoint. This is appropriate for a strictly local tool, consistent with how AnkiConnect itself operates. The threat model (same machine, local user) does not require auth.

⚠️ **Risk (Low):** If a malicious local app calls `DELETE /api/cards/{id}`, it can delete locally saved cards. There is no undo. This is inherent to unauthenticated localhost APIs; fixing it would require either local auth tokens or a more complex trust model beyond V1 scope.

### 4.4 Development Mode Exposure

```python
uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
```

⚠️ **Finding F-01 (Medium):** `reload=True` in the launch script enables:
- **`/docs`** (Swagger UI) — interactive API explorer accessible at `127.0.0.1:8000/docs`
- **`/redoc`** — alternative docs UI at `127.0.0.1:8000/redoc`
- **Hot file-system watching** — uvicorn watches the source directory and auto-restarts

For a production/distribution build these should be disabled. The `/docs` endpoint is not a security vulnerability per se, but it advertises all API routes, schemas, and allows any local app to discover and call them easily.

**Remediation:** For Stage 9 release packaging, set `reload=False` and `FastAPI(docs_url=None, redoc_url=None)`.

### 4.5 `/api/cards` — Unbounded `limit` Parameter

```python
# main.py
def list_cards(limit: int = 50, offset: int = 0, ...) -> CardListResponse:
    ...
    return service.list_cards(limit=limit, ...)
```

```python
# card_repository.py
params.extend([max(1, limit), max(0, offset)])
```

⚠️ **Finding F-03 (Low):** There is no maximum cap on the `limit` parameter. A caller can pass `limit=999999`, causing the backend to read the entire cards table into memory in one query and serialize potentially hundreds of MB of JSON (if large media filenames or JSON blobs are stored). The `max(1, limit)` guard only prevents zero/negative values.

In practice, a single local user's Kiroku library is unlikely to exceed a few thousand cards, so this is not a current danger — but it is an easy fix.

**Remediation:** Apply `limit: int = Field(default=50, ge=1, le=500)` in the route signature or clamp in `list_cards`.

### 4.6 Filesystem Access — Media Endpoint

```python
# media_storage.py
def get_media_path(self, filename: str) -> Path | None:
    if not filename:
        return None
    safe_name = os.path.basename(filename)
    if safe_name != filename or ".." in filename:
        return None
    file_path = self.media_dir / safe_name
    if file_path.is_file():
        return file_path
    return None
```

✅ **Good:** `os.path.basename()` is used correctly. On Windows, `os.path.basename("..\\..\\etc\\passwd")` returns `"passwd"`, not the traversal path. The `safe_name != filename` check catches attempts where the input contains path separators. Combined with `".."` check this is a solid traversal guard.

✅ **Good:** Only files that actually exist inside `self.media_dir` are served. The final `is_file()` check prevents directory traversal even if path construction has edge cases.

⚠️ **Informational:** The `safe_name != filename` check compares using Python string equality. On Windows, an attacker could pass `filename` with a backslash (`\`) and `os.path.basename` would strip it correctly, but the string equality check would catch the discrepancy. This is already safe in practice.

### 4.7 Media File Size Limits

```python
# schemas.py
image: str = Field(default="", max_length=5_000_000)
audio: str = Field(default="", max_length=10_000_000)
image_data: Optional[str] = Field(default=None, max_length=10_000_000)
audio_data: Optional[str] = Field(default=None, max_length=20_000_000)
```

⚠️ **Finding F-04 (Low):** Inline base64 in JSON body is expensive. A single `POST /api/cards/save` request with a 20 MB base64 audio blob would transmit ~27 MB of JSON (base64 overhead ~33%). Pydantic parses the entire JSON body into memory. FastAPI/uvicorn have no default body size limit, so a specially crafted request could consume significant memory.

For a local tool where the sender is the extension, this is not a practical attack. But it is worth capping for robustness.

**Remediation:** Add a FastAPI middleware or Pydantic validators limiting total body size, or reduce the `max_length` values to more realistic caps (e.g., image ≤ 2MB base64 ≈ ~1.5MB image, audio ≤ 5MB).

### 4.8 SSRF-Style Risks

The `ANKICONNECT_URL` and `YOMITAN_ENDPOINT` environment variables control where outbound HTTP requests go. These are set at server startup by the machine owner — they are not user-controllable from the API or the extension. No SSRF risk exists here.

No endpoint accepts a URL to fetch on the user's behalf. The only external-URL fetch in the backend pipeline is the internal call to Yomitan/AnkiConnect services, which are fixed at startup.

---

## 5. Input Validation Audit

### 5.1 `POST /api/capture`

```python
class CaptureRequest(BaseModel):
    text: str = Field(max_length=500)
    deck_name: str = Field(default="Default", max_length=100)
    auto_save: bool = False

    @field_validator("text")
    def text_must_not_be_blank(cls, value): ...
```

✅ **Good:** Text is length-limited to 500 characters. This is reasonable for a Japanese term capture (a subtitle line is usually < 200 characters).

✅ **Good:** The `text` goes to `YomitanService.identify()`, which calls Yomitan's `/tokenize` endpoint. No SQL injection possible (text is sent as a JSON payload body, not a SQL string). No shell execution.

⚠️ **Informational:** `deck_name` from this endpoint is used only as a hint for the card draft; it passes through `normalize_deck()` before being stored. No injection risk.

### 5.2 `POST /api/cards/save`

```python
class SaveCardRequest(BaseModel):
    expression: str = Field(max_length=200)
    reading: str = Field(default="", max_length=200)
    meaning: str = Field(default="", max_length=2000)
    deck_name: str = Field(default="Default", max_length=100)
    model_name: str = Field(default="", max_length=100)
    hint: str = Field(default="", max_length=500)
    example_sentence: str = Field(default="", max_length=1000)
    example_translation: str = Field(default="", max_length=1000)
    tags: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=2000)
    source_text: str = Field(default="", max_length=500)
    deinflected_text: str = Field(default="", max_length=500)
    entries: list[dict[str, Any]] = Field(default_factory=list)
```

✅ **Good:** All text fields have explicit `max_length` constraints via Pydantic. Pydantic enforces these before the handler runs.

✅ **Good:** All fields go into SQLite via parameterized queries — no SQL injection possible.

✅ **Good:** `entries` (dictionary data) is serialized to JSON and stored in `meanings_json`. The JSON round-trip sanitizes the structure. It is never eval'd or rendered as HTML in the backend.

⚠️ **Finding F-04** (as above): `image` and `audio_data` size limits are very generous.

⚠️ **Informational:** `entries` is a `list[dict[str, Any]]` — there is no structural validation of the dictionary shape. Malformed entries will be stored as-is in `meanings_json`. On retrieval, they are passed to `AnkiFormatter` and `map_card_to_fields`, which use `.get()` with defaults and are thus tolerant of missing keys. No crash risk identified.

### 5.3 `GET /api/cards` Search Parameter

```python
if search and search.strip():
    term = f"%{search.strip()}%"
    conditions.append(
        "(expression LIKE ? OR reading LIKE ? OR ...)"
    )
    params.extend([term, term, term, term, term, term])
```

✅ **Good:** The `search` parameter is used as a LIKE pattern with `?` parameterized binding — SQLite injection is not possible. LIKE wildcards (`%`, `_`) in the search string are not escaped, meaning a user searching for `%` will match everything, but this is benign in a personal local tool.

### 5.4 `deck_name` and `model_name` in AnkiConnect Queries

```python
# anki_connect.py — find_existing_note
safe_deck = deck_name.replace('"', '\\"').replace("'", "")
safe_term = expression.strip().replace('"', '\\"').replace("'", "").replace("*", "")
query = f'deck:"{safe_deck}" "{safe_term}"'
```

✅ **Good:** The `deck_name` and `expression` are sanitized before insertion into the AnkiConnect query string. Quote characters and wildcards are stripped/escaped. The empty-term guard prevents unconstrained deck-wide searches.

⚠️ **Informational:** The sanitization replaces single quotes with empty string rather than escaping them. This means a deck named `O'Brian's Deck` would be searched as `O Brian's Deck`. This affects only the AnkiConnect duplicate query, not local SQLite. The impact is a potential missed duplicate match in that unusual case — a safe degradation (creates duplicate rather than skipping a card).

### 5.5 AnkiConnect HTML Field Values

```python
# anki_formatter.py
def escape_html(text: Any) -> str:
    return html.escape(str(text), quote=True)
```

✅ **Good:** `escape_html()` is applied to all plain-text card fields (expression, reading, hint, notes, example_translation) before inclusion in Anki HTML. The `html.escape()` with `quote=True` escapes `&`, `<`, `>`, `"`, and `'`.

✅ **Good:** `format_ruby_html()` explicitly escapes all base and rt tokens within `<ruby>` markup. Dictionary content piped through `format_meaning_html()` and `format_example_html()` also applies escaping.

✅ **Good:** Stage 5 live verification explicitly tested XSS injection scenarios (`<script>alert(1)</script>`, `<iframe>`, `<svg onload=...>`, malicious media filenames) and confirmed proper escaping.

### 5.6 Content Script Input

The content scripts receive text from the web page (user text selection, subtitle text from DOM). These are:
- Passed through `captureUtils.containsJapanese()` (regex filter — not a security check, just a feature filter)
- Sent as a `JAPANESE_TEXT_CAPTURED` message containing the raw text string
- Received by the Side Panel and placed in `fieldExpression.value = response.expression` via direct property assignment

✅ **Good:** All field population uses `.value = text` (form field value, not HTML). This cannot introduce XSS.

✅ **Good:** No subtitle text is ever rendered as HTML in the Side Panel. The `videoCurrentCuePreview.textContent = message.cue?.text` assignment uses `textContent`.

### 5.7 Subtitle Text

Subtitle text flows: `video-mining-poc.js` → SUBTITLE_CUE_CHANGED message → `sidepanel.js` → `videoCurrentCuePreview.textContent`.

✅ **Good:** `textContent` assignment, not `innerHTML`.

✅ **Good:** When a subtitle is captured and sent to backend, it goes through the same `CaptureRequest` validation (max 500 chars).

---

## 6. Extension Permission & Trust Audit

### 6.1 Manifest Permissions

```json
"permissions": [
    "sidePanel", "activeTab", "scripting", "tabs",
    "tabCapture", "offscreen"
],
"host_permissions": [
    "http://127.0.0.1:8000/*",
    "*://*.youtube.com/*",
    "*://*.netflix.com/*",
    "<all_urls>"
]
```

**`sidePanel`** — Required for Side Panel. Appropriate.

**`activeTab`** — Required for tab-level operations. Appropriate.

**`scripting`** — Required for `ensureContentScript()` — injects content scripts into tabs when mining mode is enabled. Appropriate.

**`tabs`** — Required for `chrome.tabs.query`, tab activation listeners, mining mode propagation. Appropriate.

**`tabCapture`** — Required for audio capture via `getMediaStreamId`. Appropriate (V3 audio feature).

**`offscreen`** — Required for audio recording via offscreen document. Appropriate (V3 audio feature).

**`host_permissions: <all_urls>`** — ⚠️ **Finding F-05 (Low/Informational):** `<all_urls>` is the broadest possible host permission. It is necessary because Kiroku Note is designed to work on any website, not just YouTube/Netflix. The explicit `youtube.com` and `netflix.com` entries are redundant given `<all_urls>` but are harmless.

`<all_urls>` means the content scripts run on every page the user visits. This is appropriate for a mining tool but implies the user should understand that Kiroku Note monitors all page text activity when mining mode is on. This is documented behavior, not a security flaw, but worth noting in the README for transparency.

### 6.2 Content Script Injection

```json
"content_scripts": [
  {
    "matches": ["<all_urls>"],
    "js": ["lib/subtitle-parser.js", "lib/image-cropper.js", ...],
    "run_at": "document_idle",
    "all_frames": true,
    "match_about_blank": true
  },
  {
    "matches": ["*://*.youtube.com/*"],
    "js": ["content/adapters/youtube-bridge.js"],
    "world": "MAIN",
    "run_at": "document_start"
  }
]
```

⚠️ **Finding F-06 (Low/Informational):** `youtube-bridge.js` runs in `world: "MAIN"` (the page's JavaScript context) at `document_start`. This is intentional — it needs access to the YouTube player's JavaScript API to extract caption track configurations. However, running in `MAIN` world means it shares the same JavaScript scope as the YouTube page and any YouTube-injected scripts. A hostile YouTube page could theoretically overwrite global variables that `youtube-bridge.js` relies on, though the script only reads player state and sends a message.

⚠️ **`all_frames: true` and `match_about_blank: true`** — content scripts run in all frames including iframes and `about:blank` frames. This is needed for HiAnime and other embedded video players. It means a hostile `<iframe>` on any page could trigger `JAPANESE_TEXT_CAPTURED` if mining mode is active and the user selects text inside it.

### 6.3 Extension Messaging — Sender Validation

```javascript
// sidepanel.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ...
  if (message?.type === "JAPANESE_TEXT_CAPTURED") {
    identify(message.text);
  }
```

⚠️ **Finding F-07 (Low/Informational):** There is no `sender.id` check against `chrome.runtime.id` in the message handlers. In Manifest V3, `chrome.runtime.onMessage` in extension pages (Side Panel, background) **only receives messages from the same extension** — messages from external origins or web pages cannot reach it without an `externally_connectable` declaration (which is absent). This means F-07 is **not an exploitable vulnerability** in the current implementation.

The absence of `sender.id` checks is acceptable. Adding them would be unnecessary defensive code for a false threat.

### 6.4 No `externally_connectable`

✅ **Good:** The manifest has no `externally_connectable` entry. No external websites or extensions can send messages to Kiroku Note's extension context.

### 6.5 No `web_accessible_resources`

✅ **Good:** No extension resources are web-accessible. No resource enumeration or extension probing from web pages is possible.

### 6.6 `FETCH_YOUTUBE_TIMEDTEXT` — Unvalidated URL Proxy

```javascript
// background.js
if (message?.type === "FETCH_YOUTUBE_TIMEDTEXT") {
    fetch(message.url)
      .then(res => { ... return res.text(); })
      .then(text => sendResponse({ok: true, text}))
      .catch(err => sendResponse({ok: false, error: err.message}));
    return true;
}
```

⚠️ **Finding F-02 (Medium):** The `background.js` fetches whatever URL is in `message.url` without validating that it is a YouTube CDN domain. This message is sent from `youtube-adapter.js` when a direct fetch fails. The URL is derived from the YouTube player API's `baseUrl`/`srv3Url` fields.

**Attack scenario:** A hostile YouTube-like page that sets up a `youtube.com` subdomain could provide a crafted `baseUrl` pointing to an internal network address (e.g., `http://192.168.1.1/` or `http://internal-service/`). Since the background service worker has `<all_urls>` host permission, `fetch()` would succeed — leaking whether the resource exists and returning its contents.

**Realistic severity:** Low-medium. The URL is always constructed from YouTube player API data (`new URL(baseUrl, window.location.href)`). On a genuine `*.youtube.com` page, `baseUrl` comes from YouTube's own player configuration which is served from Google. A fully hostile scenario requires either: (a) the user is on a spoofed YouTube page (phishing), or (b) YouTube's player API is compromised. Neither is a typical threat for a personal Japanese mining tool.

**Remediation:** In `background.js`, before fetching, validate that `message.url` starts with an expected YouTube/Google CDN hostname:
```javascript
const ALLOWED_TIMEDTEXT_ORIGINS = [
    "googlevideo.com", "youtube.com", "ytimg.com", "googleapis.com"
];
const parsedUrl = new URL(message.url);
const allowed = ALLOWED_TIMEDTEXT_ORIGINS.some(d => parsedUrl.hostname.endsWith(d));
if (!allowed) { sendResponse({ok: false, error: "URL not allowed"}); return true; }
```

### 6.7 No CSP on `sidepanel.html`

```html
<!-- sidepanel.html — no Content-Security-Policy meta tag -->
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  ...
```

⚠️ **Finding F-08 (Low):** `sidepanel.html` has no `Content-Security-Policy` meta tag or manifest CSP declaration. The default MV3 CSP for extension pages is relatively strict (blocks `eval`, inline event handlers), but adding an explicit CSP is defense-in-depth.

**Current risk: Very Low.** All DOM construction is via `createElement`/`textContent` (zero `innerHTML` of user data). The `innerHTML = "&times;"` assignments set the HTML entity literal `×`, not attacker-controlled content. There is no practical XSS attack surface currently.

**Remediation:** Add to `sidepanel.html`:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' http://127.0.0.1:8000 data: blob:; media-src 'self' http://127.0.0.1:8000 data: blob:; connect-src http://127.0.0.1:8000; script-src 'self';">
```

### 6.8 Google Fonts CDN Dependency

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:..." rel="stylesheet">
```

⚠️ **Finding F-09 (Low):** Every time the Side Panel opens, the browser makes an outbound request to `fonts.googleapis.com`. This:
- Leaks that the user has Kiroku Note installed to Google
- Fails in offline environments
- Contradicts the "local-first" product philosophy

This was flagged in Stage 1 and remains unaddressed.

**Remediation:** Bundle `Noto Sans JP` WOFF2 font files locally in `extension/fonts/` with `@font-face` CSS rules.

---

## 7. Error Handling Audit

### 7.1 Backend — Broad Exception Blocks

**`card_service.py` — media save:**
```python
try:
    image_val = storage.save_media(raw_image, media_type="image")
except Exception as err:
    logger.warning("Failed to save image media during card save: %s", err)
```

✅ **Good:** Media save failures are swallowed gracefully with a warning log. The card save continues without the media. SQLite state remains consistent (card saved, image field is empty or the original value).

**`card_service.py` — sync_card:**
```python
except Exception as error:
    error_message = str(error)
    self.repository.mark_failed(card_id, error_message)
    return SyncCardResponse(
        id=card.id,
        sync_status="failed",
        error=error_message,
        ...
    )
```

✅ **Good:** Any failure during sync (AnkiConnect down, timeout, model not found) marks the card as `failed` in SQLite and returns the error message. The card is never lost. This correctly enforces the SQLite-first invariant.

⚠️ **Informational:** The `error_message = str(error)` is returned verbatim to the client in `SyncCardResponse.error`. For a local personal tool this is fine — the user benefits from seeing the actual error. In a networked tool this could leak internal paths or service addresses.

**`card_service.py` — get_anki_decks/models:**
```python
except Exception:
    return AnkiDecksResponse(decks=["Default"], connected=False)
```

✅ **Good:** Any AnkiConnect failure gracefully falls back to defaults without crashing.

**`card_repository.py` — JSON parsing:**
```python
try:
    entries = json.loads(meanings_raw) if meanings_raw else []
except Exception:
    entries = []
```

✅ **Good:** Corrupted JSON in `meanings_json` or `examples_json` falls back to empty list rather than crashing. A corrupted row is readable (just without dictionary data).

**`yomitan.py` — individual entry parsing:**
```python
except Exception:
    continue
```

✅ **Good:** A single malformed Yomitan dictionary entry is skipped; other entries in the same response still process correctly.

### 7.2 Extension — Error Paths

**Stale capture guard:**
```javascript
if (message.captureId && currentCaptureId && message.captureId !== currentCaptureId) {
    sendResponse?.({ok: false, error: "STALE_CAPTURE"});
    return true;
}
```

✅ **Good:** Race conditions between multiple rapid text selections are handled. Stale responses from earlier captures are discarded.

**AnkiConnect not connected:**
✅ **Good:** `updateSyncUI` covers all lifecycle states: ready, syncing, synced, failed. The "Send to Anki" button is disabled when there is no pending card. Retry is surfaced cleanly from the history view.

**Yomitan not connected:**
✅ **Good:** `setIndicatorStatus(indicatorYomitan, "unavailable")` is shown; a user-readable error appears in the status bar. The card editor remains functional — users can still manually type card content.

**Backend not running:**
✅ **Good:** `fetch` failures map to a human-readable message: "Cannot connect to Kiroku Note backend. Make sure the Python server is running on http://127.0.0.1:8000."

### 7.3 SQLite State Consistency

The card lifecycle state machine is implemented atomically:
- `mark_syncing`: sets `sync_status='syncing'`
- `mark_synced`: sets `sync_status='synced'` + `anki_note_id` + `synced_at`
- `mark_failed`: sets `sync_status='failed'` + `sync_error`

Each is a single `UPDATE` SQL statement followed by `conn.commit()`. There is no multi-step transaction that could leave partial state. The connection timeout is 10 seconds (WAL mode allows concurrent reads).

✅ **Good:** SQLite-first invariant correctly maintained.

⚠️ **Informational:** There is no explicit check for the `syncing` state on retry — if the process crashes mid-sync, the card remains in `syncing` state permanently. On next application start the card would show "syncing" in history indefinitely. Practically, this is fine for a local desktop tool (restart clears the issue), but a startup migration that resets `sync_status='syncing'` → `'pending'` would be cleaner.

---

## 8. Persistence & Migration Audit

### 8.1 Database Path Resolution

```python
# connection.py
DEFAULT_DB_REL_PATH = Path("data") / "kiroku.db"
LEGACY_DB_REL_PATH = Path("data") / "ankiminer.db"

def get_db_path() -> Path:
    custom_path = os.getenv("KIROKU_DB_PATH") or os.getenv("ANKIMINER_DB_PATH")
    if custom_path:
        return Path(custom_path)
    # Prefer kiroku.db; fall back to ankiminer.db if it exists
    if kiroku_path.exists(): return kiroku_path
    if legacy_path.exists(): return legacy_path
    return kiroku_path  # new install default
```

✅ **Good:** Backward compatibility with `ankiminer.db` is correctly implemented.

⚠️ **Finding F-10 (Low):** An empty `cards.db` file exists at `backend/data/cards.db` (observed in directory listing: `0 bytes`, created Sep 15). This appears to be a stale artifact from earlier development. The application does not use `cards.db` — the actual database is `ankiminer.db`. However, if someone accidentally sets `KIROKU_DB_PATH=data/cards.db`, they would get an empty database and see all their history disappear.

**Remediation:** Delete `backend/data/cards.db` as part of repository cleanup.

### 8.2 Schema Migration

```python
# connection.py — init_db
new_cols = [
    ("meaning", "TEXT NOT NULL DEFAULT ''"),
    ("hint", "TEXT NOT NULL DEFAULT ''"),
    ...
]
for col_name, col_def in new_cols:
    if col_name not in columns:
        conn.execute(f"ALTER TABLE cards ADD COLUMN {col_name} {col_def}")
```

✅ **Good:** Column migrations use `ALTER TABLE ADD COLUMN IF NOT EXISTS` pattern (checked manually). New columns won't fail if the DB already has them.

⚠️ **Informational:** The `ALTER TABLE` statement uses f-string interpolation for `col_name` and `col_def`. However, these are **hardcoded strings in the source code**, not user-supplied values. There is no injection risk here — the values never come from user input.

⚠️ **Informational:** There is no formal migration versioning (no schema version table). Adding future schema changes requires care to avoid re-running `ALTER TABLE` on columns that already exist from a previous migration cycle. The current `if col_name not in columns` check handles this correctly, but it is a potential fragility as the schema grows.

### 8.3 WAL Mode & Concurrent Access

```python
conn.execute("PRAGMA foreign_keys = ON;")
conn.execute("PRAGMA journal_mode = WAL;")
conn.connect(timeout=10.0)
```

✅ **Good:** WAL mode allows concurrent reads. The 10-second timeout prevents indefinite lock contention. The Side Panel may make multiple simultaneous API calls (e.g., loading history while a capture is in flight); WAL handles this gracefully.

### 8.4 Media Directory

```python
DEFAULT_MEDIA_REL_PATH = Path("data") / "media"
filename = f"ankiminer_{prefix}_{timestamp}_{token}.{ext}"
```

⚠️ **Informational:** Media filenames still use the `ankiminer_` prefix (Stage 2 renamed the product but this specific file naming was preserved for backward compatibility). Existing cards in SQLite reference `ankiminer_img_*` filenames. The `card_service.py` explicitly checks for both `ankiminer_img_` and `kiroku_img_` prefixes. This is correct behavior.

⚠️ **Informational:** There is no media file cleanup mechanism. Old media files from deleted cards accumulate indefinitely. This is not a security issue but is a disk space concern for heavy users.

### 8.5 Duplicate Prevention Invariant

```sql
UNIQUE(normalized_expression, normalized_reading, normalized_deck_name)
```

✅ **Good:** The database-level `UNIQUE` constraint is the final duplicate guard. Even if the application-level check has a race condition, SQLite's constraint will prevent truly duplicate rows and the `IntegrityError` is caught and handled.

---

## 9. Anki Reliability Audit

### 9.1 AnkiConnect Communication

All AnkiConnect calls use `urllib.request` (Python stdlib) with a 5-second timeout. No third-party HTTP libraries.

✅ **Good:** `AnkiConnectionError`, `AnkiTimeoutError`, `AnkiResponseError`, `AnkiActionError` are distinct exception types, all subclassing `AnkiError`.

✅ **Good:** All AnkiConnect failures in `sync_card` fall through to `mark_failed()`. The card is never lost.

### 9.2 Duplicate Detection

```python
# find_existing_note
query = f'deck:"{safe_deck}" "{safe_term}"'
candidate_ids = self._invoke("findNotes", query=query)
note_infos = self._invoke("notesInfo", notes=candidate_ids[:50])
```

✅ **Good:** Duplicate check inspects up to 50 candidate notes. For a personal vocabulary deck, 50 is sufficient; a user with > 50 near-matches for the same expression would be unusual.

✅ **Good:** The composite reading extraction (`expr [reading]` for Basic model) correctly handles the case where AnkiConnect stores reading inside the Front field.

⚠️ **Informational:** The `notesInfo` call for 50 candidates happens synchronously. If AnkiConnect is slow (large collection), this may take longer than the 5-second timeout. The timeout exception is caught and results in `mark_failed` — the card remains safe locally.

### 9.3 Idempotent Sync

```python
if card.sync_status == "synced" and card.anki_note_id:
    return SyncCardResponse(id=card.id, sync_status="synced", ...)
```

✅ **Good:** Re-syncing an already-synced card returns early without calling AnkiConnect again. Safe retry.

### 9.4 Media Sync

```python
self.anki.store_media_file(filename=clean_img, data_bytes=img_bytes)
```

```python
result = self._invoke("storeMediaFile", filename=clean_name, data=b64_payload, deleteExisting=False)
```

✅ **Good:** `deleteExisting=False` prevents overwriting existing Anki media files on re-sync.

✅ **Good:** `os.path.basename(filename)` is applied to the filename before passing to `storeMediaFile`. This prevents path traversal in Anki media filenames.

⚠️ **Informational:** `storeMediaFile` failures are logged as warnings and execution continues. The note is still created in Anki without media. This is correct behavior — a card without an image is better than no card at all.

### 9.5 Model Resolution

The `resolve_note_model()` fallback chain prioritizes Japanese mining models → Basic → any supporting model. If **no** model supports a basic prompt/answer pair, the fallback is the first available model and first two fields. In extreme edge cases (completely custom Anki setup), field mapping may produce an unexpected result. This is informational, not a security issue.

---

## 10. Yomitan Reliability Audit

### 10.1 Network Failure Handling

```python
# yomitan.py
except (URLError, TimeoutError, OSError) as error:
    raise YomitanUnavailableError("Yomitan is unavailable. Start Yomitan and try again.") from error
except (UnicodeDecodeError, json.JSONDecodeError) as error:
    raise YomitanResponseError("Yomitan returned an invalid response.") from error
```

✅ **Good:** Yomitan unavailability is a `YomitanUnavailableError` that propagates to the route handler and returns HTTP 503. The Side Panel shows this as a connection error without crashing.

✅ **Good:** `enrich()` catches `YomitanError` and returns an `EnrichedTerm` with `dictionary_error` set — the card can still be created with empty dictionary data.

### 10.2 Malformed Response Handling

```python
if not isinstance(payload, dict):
    raise YomitanResponseError(...)
raw_entries = payload.get("dictionaryEntries")
if not isinstance(raw_entries, list):
    raise YomitanResponseError(...)
for raw in raw_entries:
    try:
        ...
    except Exception:
        continue
```

✅ **Good:** Each dictionary entry is parsed inside a `try/except` block. A single malformed entry does not break the entire response.

### 10.3 AST Depth Protection

```python
MAX_AST_DEPTH = 32
```

✅ **Good:** The `MAX_AST_DEPTH` constant is defined in `YomitanService`. The recursive AST walker enforces this depth limit, preventing stack overflow from deeply nested dictionary structures (which Yomitan's structured content can produce).

### 10.4 Huge Dictionary Responses

A dictionary entry with 1000 senses would produce a large response. The `normalize_term_entries_response` iterates over all senses without a length cap. For typical Japanese dictionaries (JMdict/Jitendex), 20-30 senses for a polysemous verb is the realistic maximum. A cap of e.g. 50 senses per entry would be a sensible safeguard but is not critical.

### 10.5 Missing Dictionary

✅ **Good:** If Yomitan has no dictionaries installed, `termEntries` returns an empty list, and `EnrichedTerm.dictionary_error` is set to "Dictionary returned no usable definitions." The card editor still opens with the expression/reading filled in and a blank meaning field.

---

## 11. Media / File Security Audit

### 11.1 Path Traversal Prevention

```python
# media_storage.py
safe_name = os.path.basename(filename)
if safe_name != filename or ".." in filename:
    return None
file_path = self.media_dir / safe_name
```

✅ **Good:** Three-layer defense: `os.path.basename()` strips directory components, `safe_name != filename` detects remaining separators, `".." in filename` catches explicit traversal attempts.

✅ **Good:** The final `file_path.is_file()` check ensures only files physically inside `media_dir` are served.

### 11.2 Filename Generation

```python
filename = f"ankiminer_{prefix}_{timestamp}_{token}.{ext}"
```

✅ **Good:** Filenames are generated by the server, not the client. They contain only alphanumeric characters, underscores, hyphens, and a validated extension. No user-supplied filename is used directly.

✅ **Good:** The extension is derived from the MIME type of the data URL, not from user input.

### 11.3 File Extension Allowlist

```python
# anki_formatter.py
SAFE_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
SAFE_AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".m4a", ".aac", ".flac", ".webm", ".opus"}
SAFE_MEDIA_FILENAME_REGEX = re.compile(r'^[a-zA-Z0-9_\-\.]+$')
```

✅ **Good:** `AnkiFormatter` defines allowlists for safe media file extensions. These are used when sanitizing media tags for Anki field values.

### 11.4 Anki Media Filename Safety

```python
# anki_connect.py
clean_name = os.path.basename(filename)
result = self._invoke("storeMediaFile", filename=clean_name, ...)
```

✅ **Good:** `os.path.basename()` applied before passing to `storeMediaFile`. Prevents Anki from storing a file with a path-traversal name in its media collection.

### 11.5 Media File Size (Server-side)

The media storage service writes whatever bytes are decoded from the base64 payload. There is no server-side file size cap beyond what the Pydantic `max_length` on the base64 string allows (see Finding F-04). A 20 MB `audio_data` string decoded would produce a ~15 MB audio file. This is not a security risk for a local app, but is a reliability concern.

---

## 12. DOM / Browser Security Audit

### 12.1 innerHTML Usage

The entire `sidepanel.js` file was audited for `innerHTML` and `insertAdjacentHTML` usage.

**Findings:**
```
Line 2257: delBtn.innerHTML = "&times;";
Line 2383: delBtn.innerHTML = "&times;";
```

✅ **Safe:** Both assignments set the literal HTML entity `&times;` (×), not attacker-controlled content. This is a hardcoded string constant.

No other `innerHTML`, `insertAdjacentHTML`, `document.write`, or `eval` was found in any extension JS file.

### 12.2 Dictionary Content Rendering

All dictionary data (senses, glosses, POS tags, examples, notes) is rendered using `createElement` + `textContent`. Example from `renderStudySenseItem`:

```javascript
glossesSpan.textContent = glossesList.join("; ");
posSpan.textContent = String(pos).trim();
```

✅ **Good:** 100% XSS-safe dictionary rendering. No dictionary data reaches HTML serialization.

### 12.3 Card Preview Rendering

The live Anki card preview in the Side Panel uses the same `createElement`/`textContent`/`replaceChildren` DOM construction pattern. Verified in `card-preview.test.js`: "100% XSS defense via safe DOM construction".

### 12.4 Ruby Text Rendering

```javascript
function renderRubyText(container, text, rubyText) {
    // Uses createElement("ruby"), rt.textContent = match[2]
    // Never innerHTML
}
```

✅ **Good:** Ruby markup (furigana) is constructed via DOM APIs only.

### 12.5 History Card Rendering

```javascript
expr.textContent = card.expression;
read.textContent = card.reading;
mean.textContent = card.meaning;
```

✅ **Good:** All history card fields rendered via `textContent`.

### 12.6 Media URL Construction

```javascript
const imgSrc = body.image.startsWith("data:") || body.image.startsWith("http:")
    ? body.image
    : `http://127.0.0.1:8000/api/media/${body.image}`;
imagePreview.src = imgSrc;
```

⚠️ **Informational:** The media URL is constructed by appending a filename from the SQLite record to `http://127.0.0.1:8000/api/media/`. This is assigned to `img.src` — not rendered as HTML. An adversarial filename like `../../etc/passwd` in the SQLite record would produce a URL `http://127.0.0.1:8000/api/media/../../etc/passwd` — but the backend's `get_media_path` path traversal guard would return 404 for this. No actual file disclosure.

---

## 13. Dependency / Configuration Audit

### 13.1 Python Dependencies

```
# requirements.txt
fastapi>=0.115,<1.0
uvicorn>=0.30,<1.0
```

⚠️ **Finding F-11 (Low):** Only two direct dependencies are declared, and they use open ranges (`>=0.115,<1.0`). This means `pip install` could pull a newer minor version of FastAPI or uvicorn with behavioral changes. For a public release, pinned versions (e.g., `fastapi==0.115.x`) improve reproducibility and prevent supply-chain surprises.

⚠️ **No `pydantic` pinned explicitly** — though FastAPI depends on it. Pydantic v2 is a large breaking change from v1; the codebase uses `model_dump()` (v2 style), so it requires Pydantic v2. This is implicit via FastAPI's dependency tree but not stated.

**Remediation:** Generate a `requirements.txt` with `pip freeze` for Stage 9 release packaging to pin all transitive dependencies.

### 13.2 JavaScript Dependencies

The extension has **no npm/node dependencies** (vanilla JS only). No `node_modules`, no `package.json` in the extension directory. The test runner uses Node.js but only built-in modules (`node:assert`, `node:test`, `node:fs`, `node:vm`).

✅ **Good:** Zero JS supply-chain risk in the distributed extension.

### 13.3 Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `KIROKU_DB_PATH` | SQLite DB path | `backend/data/kiroku.db` |
| `ANKIMINER_DB_PATH` | Legacy DB path fallback | `backend/data/ankiminer.db` |
| `KIROKU_MEDIA_DIR` | Media storage directory | `backend/data/media/` |
| `ANKIMINER_MEDIA_DIR` | Legacy media dir fallback | (same) |
| `ANKICONNECT_URL` | AnkiConnect endpoint | `http://127.0.0.1:8765` |
| `YOMITAN_ENDPOINT` | Yomitan endpoint | `http://127.0.0.1:19633` |
| `ANKI_NOTE_MODEL` | Override note model | (none) |

✅ **Good:** All environment variables are read at startup by the server process. They are not readable or settable by the extension or any web page. Machine owner controls them.

⚠️ **Informational:** `ANKICONNECT_URL` and `YOMITAN_ENDPOINT` allow configuring arbitrary HTTP endpoints. A malicious `.env` file set up by social engineering could redirect these to an attacker-controlled server. This is an operator-level misconfiguration issue, not a product vulnerability.

### 13.4 No Secrets or Credentials

✅ **Good:** No API keys, tokens, passwords, or credentials anywhere in the codebase. AnkiConnect has no authentication by default.

### 13.5 Hardcoded Localhost URLs in Extension

```javascript
const API_CAPTURE_URL = "http://127.0.0.1:8000/api/capture";
```

⚠️ **Informational:** All API URLs are hardcoded in `sidepanel.js`. If a user wants to run the backend on a different port, they must modify the source. This is consistent with the local-first design. No dynamic configuration UI exists. For V1 this is acceptable; a future settings page might allow port configuration.

### 13.6 `reload=True` in Development Launcher

As noted in Finding F-01 — this is the dev launcher and `reload=True` is appropriate for development. It must be `False` in any packaged/distributed version.

---

## 14. Security Findings Summary

| ID | Location | Description | Severity | Exploitable By |
|---|---|---|---|---|
| **F-01** | `run_backend.py` | `reload=True` exposes `/docs`, `/redoc`, hot-reload in packaged build | **Medium** | Local apps, curious users |
| **F-02** | `background.js:199` | `FETCH_YOUTUBE_TIMEDTEXT` fetches arbitrary URL without domain validation | **Medium** | Hostile YouTube-like page |
| **F-03** | `main.py:100` | No upper bound on `GET /api/cards?limit=` parameter | **Low** | Local app / extension bug |
| **F-04** | `schemas.py:132-136` | `audio_data` accepts up to 20MB base64 in single JSON body | **Low** | Memory pressure from large payloads |
| **F-05** | `manifest.json` | `<all_urls>` host permission is maximally broad (necessary but notable) | **Informational** | Expected permission footprint |
| **F-06** | `manifest.json` | `youtube-bridge.js` runs in MAIN world at `document_start` | **Informational** | Hostile YouTube page can overwrite globals |
| **F-07** | `sidepanel.js`, `background.js` | No `sender.id` check in `onMessage` handlers (not exploitable in MV3) | **Informational** | Not applicable — MV3 blocks external messages |
| **F-08** | `sidepanel.html` | No explicit Content-Security-Policy declaration | **Low** | Defense-in-depth gap (not currently exploitable) |
| **F-09** | `sidepanel.html:7-9` | Google Fonts CDN load — external network request on panel open | **Low** | Privacy / offline failure |
| **F-10** | `backend/data/cards.db` | Stale empty `cards.db` file — risk of accidental env var misconfiguration | **Low** | Operator misconfiguration |
| **F-11** | `requirements.txt` | Open-range dependency pinning — no lockfile for distribution | **Low** | Supply chain (theoretical) |

**Severity Summary:**
- Critical: 0
- High: 0
- Medium: 2 (F-01, F-02)
- Low: 6 (F-03, F-04, F-08, F-09, F-10, F-11)
- Informational: 3 (F-05, F-06, F-07)

---

## 15. Reliability Matrix

| Component | Failure Mode | Current Behavior | Data Safety | Recovery | Risk |
|---|---|---|---|---|---|
| **FastAPI** | Process crash / restart | All in-flight requests fail; SQLite state preserved | ✅ Safe — SQLite survives | Restart process | Low |
| **FastAPI** | `reload=True` during development | Auto-restart on file change | ✅ Safe | Automatic | Informational |
| **Side Panel** | Backend unreachable | Shows "Cannot connect" error; local cards unaffected | ✅ Safe | Start backend | Low |
| **Side Panel** | Rapid capture race | `currentCaptureId` guard discards stale responses | ✅ Safe | Automatic | Low |
| **Content Script** | Page navigation | Script re-injected on next page load; mining mode re-synced from background | ✅ Safe | Automatic | Low |
| **Yomitan** | Not running | `YomitanUnavailableError` → HTTP 503 → UI shows connection error | ✅ Safe — card editor still usable | Start Yomitan | Low |
| **Yomitan** | Returns malformed response | Per-entry try/except skips bad entries | ✅ Safe | Automatic skip | Low |
| **Yomitan** | Returns huge response | All entries processed; no depth/count cap on senses | ⚠️ Memory pressure possible | Automatic (slowdown) | Low |
| **SQLite** | Concurrent write contention | WAL mode + 10s timeout handles concurrency | ✅ Safe | Automatic retry | Low |
| **SQLite** | Disk full | Write fails with `OSError` — caught in CardRepository | ⚠️ Card may not save | Free disk space | Medium |
| **SQLite** | Corrupted DB | `sqlite3.DatabaseError` on open — not currently handled | ❌ Cards inaccessible | Manual restore | Low (rare) |
| **SQLite** | Stuck `syncing` state (crash mid-sync) | Card stays in `syncing` indefinitely | ✅ Safe — card exists | Manual: reset via retry | Low |
| **AnkiConnect** | Not running | `AnkiConnectionError` → card marked `failed` | ✅ Safe | Start Anki / retry | Low |
| **AnkiConnect** | Timeout (5s) | `AnkiTimeoutError` → card marked `failed` | ✅ Safe | Retry | Low |
| **AnkiConnect** | Duplicate note | `AnkiActionError` with "duplicate" → card marked `failed` | ✅ Safe | Manual review | Low |
| **AnkiConnect** | Media store fails | Warning logged, note created without media | ✅ Safe | Retry sync | Low |
| **Anki media** | File missing from media dir | `get_media_bytes` returns None; note created, field empty | ✅ Safe | Retry | Low |
| **Frame capture** | DRM protected stream | `captureVisibleTab` fails → `DRM_IMAGE_RESTRICTED` status shown | ✅ Safe | Expected behavior | Low |
| **Frame capture** | Screenshot during animation | Captures whatever frame is visible at time of keypress | ✅ Safe | User retakes | Low |
| **Subtitle mining** | No subtitles found | Shows "No subtitles" state; no crash | ✅ Safe | Load manually | Low |
| **Subtitle mining** | Malformed SRT/VTT file | `subtitle-parser.js` is defensive; malformed cues skipped | ✅ Safe | Load valid file | Low |
| **History** | `GET /api/cards` fails | Shows "Failed to load history" empty state | ✅ Safe | Restart backend | Low |
| **Card saving** | Duplicate on save | Returns existing card with `is_duplicate: true` | ✅ Safe | Expected behavior | Low |
| **Card saving** | Expression empty | Pydantic validation returns 422 before handler runs | ✅ Safe | User corrects form | Low |
| **Card syncing** | Any exception | `mark_failed` preserves card; `SyncCardResponse.error` returned | ✅ Safe | Retry | Low |
| **Audio (V3)** | Offscreen doc fails to create | `ok: false, error: "NO_OFFSCREEN_DOCUMENT"` | ✅ Safe | UI shows unavailable | Low |

---

## 16. Existing Protections — Already Good

The following security/reliability practices are correctly implemented and require no changes:

1. **SQLite-first persistence** — Cards saved before any AnkiConnect operation. AnkiConnect failure never loses cards.
2. **No implicit Anki push on Save** — Explicit user action required for sync. Verified in `card_service.py`.
3. **Parameterized SQL queries** — All 40+ SQL statements in `card_repository.py` use `?` bound parameters. Zero SQL injection surface.
4. **XSS-safe DOM construction** — 100% `createElement`/`textContent` in `sidepanel.js`. Only two `innerHTML = "&times;"` assignments (hardcoded HTML entity, not user data).
5. **Path traversal guard** — `os.path.basename()` + equality check + `".."` check in `MediaStorageService.get_media_path()`.
6. **AnkiConnect media filename safety** — `os.path.basename()` before `storeMediaFile`.
7. **CORS origin regex** — Restricts to extension origins and localhost. Not a wildcard.
8. **Server binds to 127.0.0.1** — Not LAN-accessible by default.
9. **Pydantic validation** — All API inputs have `max_length` constraints and type checking before handlers run.
10. **`html.escape()` for Anki HTML** — All plain text fields escaped before inclusion in Anki note HTML.
11. **No `externally_connectable`** — Extension messaging is internal-only.
12. **No `web_accessible_resources`** — No extension resource leakage.
13. **Stale capture guard** — `currentCaptureId` prevents race conditions from rapid selections.
14. **Yomitan `MAX_AST_DEPTH = 32`** — Prevents recursive dictionary AST overflow.
15. **Per-entry try/except in Yomitan parser** — Malformed entries skipped gracefully.
16. **AnkiConnect exception hierarchy** — Distinct error types for connection, timeout, response, and action errors.
17. **Duplicate detection with UNIQUE constraint** — Database-level enforcement on top of application-level check.
18. **Video playback invariant** — `currentTime` seeks are ONLY triggered by explicit user keystrokes (a/s/d) via `SubtitleHotkeyController`. Auto-pause occurs only on physical mouse hover over subtitle overlay. No automatic seeks during normal mining flow.
19. **DRM fail-soft** — Frame capture and audio capture return informational error status rather than crashing.
20. **AnkiConnect `deleteExisting=False`** — Idempotent media sync without overwriting.

---

## 17. Missing Protections

| Gap | Severity | Description |
|---|---|---|
| No upper bound on `limit` in `GET /api/cards` | Low | Could return entire database in one call |
| No URL domain validation for `FETCH_YOUTUBE_TIMEDTEXT` | Medium | Background proxy fetch without origin check |
| `reload=True` in dev launcher | Medium | Must be `False` in any distributed build |
| No CSP on `sidepanel.html` | Low | Defense-in-depth absent |
| Google Fonts CDN in Side Panel | Low | External network request on every panel open |
| No session-start cleanup of `syncing` state | Low | Crashed mid-sync leaves card stuck |
| No SQLite DB corruption handling | Low | Application fails ungracefully on corrupt DB |
| No pinned dependency lockfile | Low | Supply-chain reproducibility risk |
| `cards.db` stale file | Low | Operator misconfiguration risk |
| No media file size cap on server side (beyond Pydantic) | Low | Large payloads allowed without streaming |

---

## 18. Recommended Stage 7 Implementation Plan

These fixes are ordered by risk/impact. All are small, safe, and individually testable.

> **Do not implement any of the below yet — this is the audit output only.**

---

### Stage 7.2 — Critical Launcher Fix

**Goal:** Disable development APIs in any packaged/distributed run.

**Files:** `run_backend.py`

**Change:** Move `reload=True` behind an environment variable or `DEBUG` flag:
```python
debug = os.getenv("KIROKU_DEBUG", "").lower() in ("1", "true", "yes")
uvicorn.run("app.main:app", host="127.0.0.1", port=8000,
    reload=debug, app_dir=BACKEND_DIR)
app = FastAPI(
    title="Kiroku Note Local API",
    docs_url="/docs" if debug else None,
    redoc_url=None,
)
```

**Tests required:** None — behavioral change only (docs URLs return 404 in production).
**Regression risk:** None for existing functionality.
**Manual verification:** Confirm `/docs` returns 404 when `KIROKU_DEBUG` is unset.

---

### Stage 7.3 — URL Validation for YouTube Timedtext Proxy

**Goal:** Prevent `background.js` from fetching arbitrary URLs.

**File:** `extension/background.js`

**Change:** Add domain allowlist check before fetch in `FETCH_YOUTUBE_TIMEDTEXT` handler:
```javascript
const ALLOWED_TIMEDTEXT_HOSTS = [
    "googlevideo.com", "youtube.com", "ytimg.com", "googleapis.com"
];
const isAllowed = (url) => {
    try {
        const { hostname } = new URL(url);
        return ALLOWED_TIMEDTEXT_HOSTS.some(d => hostname === d || hostname.endsWith("." + d));
    } catch { return false; }
};
if (!isAllowed(message.url)) {
    sendResponse({ok: false, error: "URL not allowed"});
    return true;
}
```

**Tests required:** Extend `extension/tests/youtube-adapter.test.js` with a test that verifies a non-YouTube URL is rejected.
**Regression risk:** Low — only blocks non-YouTube/Google URLs, which are never legitimately needed.
**Manual verification:** Verify YouTube subtitle loading still works on a real YouTube video.

---

### Stage 7.4 — API Limit Cap & Cards.db Cleanup

**Goal:** Add upper bound on `limit` parameter; remove stale `cards.db`.

**Files:** `backend/app/main.py`, `backend/data/cards.db` (delete)

**Change in `main.py`:**
```python
def list_cards(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    ...
```

**Delete:** `backend/data/cards.db` (0-byte stale file)

**Tests required:** Add a test to `test_cards_api.py` verifying `limit > 500` is rejected with 422.
**Regression risk:** None — existing calls use limit ≤ 50.
**Manual verification:** None needed.

---

### Stage 7.5 — CSP & Font Bundling

**Goal:** Add CSP to `sidepanel.html`; bundle Noto Sans JP locally.

**Files:** `extension/sidepanel/sidepanel.html`, `extension/sidepanel/sidepanel.css`, `extension/fonts/` (new directory)

**Changes:**
- Add CSP meta tag to `sidepanel.html` head
- Remove Google Fonts `<link>` tags
- Add `@font-face` rules in `sidepanel.css` pointing to locally bundled WOFF2 files

**Tests required:** Update `sidepanel-a11y-ux.test.js` to verify CSP meta tag presence.
**Regression risk:** Low — visual change (fonts load from local files instead of CDN). May differ slightly on first load if cache was previously used.
**Manual verification:** Open Side Panel offline; verify Japanese text renders correctly.

---

### Stage 7.6 — Reliability Hardening (Minor)

**Goal:** Address small reliability gaps.

**Files:** `backend/app/db/connection.py`, `backend/app/services/card_service.py` (or a startup routine)

**Changes:**
1. On `init_db()`, reset `sync_status = 'pending'` for any rows stuck in `syncing` state — a startup migration that is idempotent and safe.
2. Wrap `sqlite3.connect()` in a try/except that raises a clear `RuntimeError` with instructions if the database is corrupted (`sqlite3.DatabaseError`).

**Tests required:** Add a test simulating a crash mid-sync (mock `mark_syncing` then verify startup resets the status).
**Regression risk:** Very low — only affects cards that were in `syncing` state (which indicates a prior crash).
**Manual verification:** None needed.

---

## 19. Recommended Tests

The following test additions address gaps identified in this audit. No tests should be written until the corresponding implementation is done.

### Backend Tests

| Test | File | Scenario |
|---|---|---|
| `limit > 500` returns 422 | `test_cards_api.py` | `GET /api/cards?limit=9999` |
| `limit=0` returns 422 or default | `test_cards_api.py` | `GET /api/cards?limit=0` |
| Media endpoint path traversal rejected | `test_cards_api.py` | `GET /api/media/../etc/passwd` returns 404 |
| Media endpoint backslash traversal rejected | `test_cards_api.py` | `GET /api/media/..%5Cetc%5Cpasswd` returns 404 |
| Sync stuck-in-syncing reset on startup | `test_card_repository.py` | Insert card with `sync_status='syncing'`, call init_db, verify status reset to `pending` |
| Large base64 image rejected above threshold | `test_cards_api.py` | `POST /api/cards/save` with 21MB audio_data |
| Malformed `entries` JSON stored and retrieved safely | `test_card_entries_persistence.py` | Pass structurally invalid dicts in entries |

### Extension Tests

| Test | File | Scenario |
|---|---|---|
| `FETCH_YOUTUBE_TIMEDTEXT` with non-YouTube URL rejected | `youtube-adapter.test.js` | Message with `url: "http://192.168.1.1/secret"` → `ok: false` |
| `FETCH_YOUTUBE_TIMEDTEXT` with valid YouTube CDN URL accepted | `youtube-adapter.test.js` | Message with valid `googlevideo.com` URL |
| CSP meta tag present in sidepanel.html | `sidepanel-a11y-ux.test.js` | DOM check for `<meta http-equiv="Content-Security-Policy">` |
| `innerHTML` usage limited to `&times;` entity only | Static analysis / test | Scan sidepanel.js for innerHTML assignments |

---

## 20. Regression Risks

| Change | Risk to Existing Behavior | Mitigation |
|---|---|---|
| `reload=False` in production launcher | No functional regression — only disables `/docs` | Verify with `KIROKU_DEBUG=1` for developer mode |
| YouTube URL domain allowlist | Could break non-standard YouTube CDN domains (e.g., regional Google CDN) | Test against live YouTube; allow-list is broad enough for all known Google CDN variants |
| `limit` cap at 500 | History endpoint no longer returns all cards if user has >500; pagination needed | Existing UI shows max 50 cards; cap at 500 is already far above current behavior |
| CSP in sidepanel.html | Could block inline styles or dynamic resource loads | Test carefully; `img-src data: blob:` required for media previews |
| Font bundling | Visual difference if system fonts differ from Noto Sans JP WOFF2 | Test on Windows with fresh profile |
| Stuck-`syncing` startup reset | Cards legitimately in mid-sync during a restart become `pending` again | Acceptable — card is preserved and will re-sync on next user action |

---

## 21. Project Invariant Verification

All project invariants were explicitly checked against the source code:

| Invariant | Status | Evidence |
|---|---|---|
| **SQLite is the source of truth** | ✅ VERIFIED | `card_service.sync_card()` saves to SQLite before any AnkiConnect call; all failures run `mark_failed()` which writes to SQLite |
| **Save Card must NOT implicitly send to Anki** | ✅ VERIFIED | `save_card()` in `card_service.py` calls only `repository.save_or_update()`. No `anki` service calls. `sync_card()` is a separate explicit endpoint. |
| **Normal mining must NOT manipulate video playback** | ✅ VERIFIED | `video.currentTime` seeks only occur via `SubtitleHotkeyController.handleKeyDown()` (explicit user key: a, s, d). `play()`/`pause()` only via Space key (play/pause toggle) and `handleMouseEnter` (user hover). No automatic seeks or pauses during text capture. |
| **Existing capture pipeline must remain stable** | ✅ VERIFIED | Content script → background → Side Panel → `/api/capture` flow is unchanged. `currentCaptureId` race guard intact. |
| **Existing subtitle mining must remain stable** | ✅ VERIFIED | YouTube, Netflix, HiAnime adapters unchanged. Subtitle parser library unchanged. |
| **Existing frame capture must remain stable** | ✅ VERIFIED | `captureVisibleTab` + `image-cropper.js` pipeline unchanged. DRM fail-soft intact. |
| **Existing audio implementation must remain in repository** | ✅ VERIFIED | All audio code (`offscreen.js`, `rolling-pcm-buffer.js`, `wav-encoder.js`, `audio-timeline-sync.js`) present and untouched in this audit. |
| **No keyboard shortcuts introduced** | ✅ VERIFIED | This is an audit-only stage. No new shortcuts or source code changes made. Existing subtitle navigation hotkeys (a/s/d/Space/\[\]/\\) were pre-existing from Stage 5. |
| **Do not invalidate existing cards/media/settings** | ✅ VERIFIED | Audit-only. No data changes. `ankiminer_` filename prefix backward compatibility intact in application code. |
| **Dictionary provider architecture remains provider-neutral** | ✅ VERIFIED | `YomitanService` is the sole dictionary boundary. No Yomitan-specific code outside `yomitan.py`. |
| **Existing Anki custom model compatibility must remain intact** | ✅ VERIFIED | `resolve_note_model()` and `map_card_to_fields()` unchanged. All Stage 5.5 live verification tests passed against user's real Anki models. |

---

## 22. Final Conclusion

Kiroku Note's current codebase reflects a well-structured local-first application with strong foundational security practices. The architecture's locality (everything on 127.0.0.1, no cloud, no remote attack surface) significantly limits the threat surface.

**No critical or high severity vulnerabilities were found.**

The two medium-severity findings (F-01: `reload=True` in the dev launcher, F-02: unvalidated URL in `FETCH_YOUTUBE_TIMEDTEXT`) are straightforward to fix and should be addressed before public release. The remaining findings are low-severity items that represent good hygiene rather than pressing risks.

The reliability posture is similarly strong: the SQLite-first architecture correctly prevents data loss from service failures, the AnkiConnect sync lifecycle is complete and correctly handles all failure modes, and the Yomitan integration has appropriate defensive parsing.

**Recommended Stage 7 order:** 7.2 (launcher) → 7.3 (URL validation) → 7.4 (limit cap + stale file) → 7.5 (CSP + fonts) → 7.6 (reliability hardening).

---

## Appendix A — Files Inspected

**Backend:**
- `backend/app/main.py`
- `backend/app/schemas.py`
- `backend/app/db/connection.py`
- `backend/app/repositories/card_repository.py`
- `backend/app/services/card_service.py`
- `backend/app/services/yomitan.py`
- `backend/app/services/anki_connect.py`
- `backend/app/services/media_storage.py`
- `backend/app/services/anki_formatter.py`
- `backend/app/services/card_normalizer.py`
- `backend/requirements.txt`

**Extension:**
- `extension/manifest.json`
- `extension/background.js`
- `extension/sidepanel/sidepanel.html`
- `extension/sidepanel/sidepanel.js` (110KB — fully audited for innerHTML/eval/DOM APIs)
- `extension/sidepanel/sidepanel.css`
- `extension/content/content.js`
- `extension/content/capture-utils.js`
- `extension/content/video-mining-poc.js` (playback invariant + seek logic)
- `extension/content/adapters/youtube-adapter.js` (FETCH_YOUTUBE_TIMEDTEXT URL source)
- `extension/content/adapters/netflix-adapter.js`
- `extension/offscreen/offscreen.js` (audio pipeline — presence verified)

**Documentation:**
- `AGENTS.md`, `ARCHITECTURE.md`, `PROGRESS.md`, `DECISIONS.md`
- `V1/Stage1.md`, `V1/Stage6-UX-ACCESSIBILITY-AUDIT.md`, `V1/Stage6-UX-ACCESSIBILITY.md`

**Data:**
- `backend/data/` (directory structure, file listing)
- `backend/data/cards.db` (stale 0-byte file identified)

**No source code was modified during this audit.**
