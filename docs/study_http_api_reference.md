# Kiroku Note Study HTTP API Reference (v1)

**Version:** `1.1.0` (M12 API Security & Media Delivery)  
**Base Path:** `/api/study/v1`  
**Protocol:** HTTP/1.1 / HTTP/2 JSON over UTF-8  
**Subsystem:** Kiroku Study Database & JLPT Examination Engine

---

## 1. Overview & Architectural Principles

The Study HTTP API provides a complete, versioned interface designed for consumption by the Windows desktop companion application and local tools.

Key Guarantees:
- **Local-First & Isolated:** Operates exclusively against `study.db` and the local content-addressed `media/` directory. Zero coupling with cloud synchronization, mobile sync queues, or external cloud databases.
- **Connection Safety:** Each HTTP request acquires and releases its own dedicated SQLite connection in explicit transaction mode.
- **Per-Launch Bearer Authentication:** Ephemeral per-launch token validation (`Authorization: Bearer <token>`) using constant-time comparison across all protected `/api/study/v1` routes.
- **CORS & Host Hardening:** Restricts origins to trusted local sources (Chrome extension, localhost loopback); blocks DNS rebinding via Host header validation.
- **Safe Mutation Retries (Idempotency):** Support for optional `client_request_id` UUIDs ensuring network retry safety without duplicating sessions, items, or grading results.
- **Byte-Range Media Streaming:** RFC 7233 / RFC 9110 HTTP Range streaming for audio assets with 64 KB chunking, preventing memory bloat, with mandatory question/group eligibility verification.
- **Answer Concealment:** Active practice sessions and uncompleted examinations strictly conceal canonical choices, answer keys, and rationales until submission or completion.
- **Read-Only State Polling:** State polling via `GET /exam/sessions/{id}` strictly calls `peek_state()`, guaranteeing that client polling never mutates timers or database states.
- **Strict Format Preservation:** Structured question DSL markup (`[ruby]`, `[blank]`, `[star]`, `[underline]`) is preserved faithfully without lossy plain-text flattening.

---

## 2. Authentication & Authorization Contract

All endpoints under `/api/study/v1` require Bearer token authentication:

```http
Authorization: Bearer <ephemeral_token>
```

### Security Properties
1. **Per-Launch Ephemeral Generation:** The token is generated fresh on each desktop app / backend startup using `secrets.token_urlsafe(32)`.
2. **Runtime Configuration:**
   - Desktop launcher passes the token via `KIROKU_STUDY_API_TOKEN` environment variable to the child backend process.
   - Programmatic injection available via `app.api.study.auth.set_study_api_token(token)`.
3. **Constant-Time Comparison:** Validated via `secrets.compare_digest` to prevent timing attacks.
4. **Token Non-Disclosure:** The token is never stored in SQLite, persistent configuration, application logs, or error responses.
5. **No Silent Bypass in Production:** If the token is unconfigured, requests are strictly rejected with `401 UNAUTHORIZED`.
6. **Explicit Test Configuration:** For automated testing, set `KIROKU_STUDY_API_TOKEN=<token>` or explicitly set `KIROKU_STUDY_AUTH_DISABLED=1`.

---

## 3. Local Binding & Origin Policy (M13 Desktop Context)

### Local Loopback Binding
- By default, the FastAPI server binds to `127.0.0.1:21828` (loopback only), never listening on `0.0.0.0`.
- Host header validation rejects any host that does not match `^(localhost|127\.0\.0\.1|testserver)(:\d+)?$`, preventing DNS rebinding attacks.

### CORS Origin Allowlist
- State-changing HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) require a trusted `Origin` header (or no Origin header from native desktop/Electron fetch).
- Default trusted origin regex: `^(chrome-extension://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$`.
- Additional trusted origins can be passed via comma-separated `KIROKU_ALLOWED_ORIGINS` environment variable.
- Wildcard origins with credentials (`Access-Control-Allow-Origin: *` with credentials) are explicitly forbidden.

---

## 4. Request Idempotency & Safe Mutation Retries

Mutating endpoints under `/api/study/v1` support safe retries via an optional `client_request_id`:

- **Header:** `X-Client-Request-Id: <uuid>`
- **Request Body:** `"client_request_id": "<uuid>"` (optional field in mutation schemas)

### Supported Endpoints
- `POST /api/study/v1/practice/sessions`
- `POST /api/study/v1/practice/sessions/{id}/answers`
- `POST /api/study/v1/practice/sessions/{id}/feedback`
- `POST /api/study/v1/practice/sessions/{id}/complete`
- `POST /api/study/v1/practice/sessions/{id}/abandon`
- `POST /api/study/v1/exam/sessions`
- `POST /api/study/v1/exam/sessions/{id}/complete`
- `POST /api/study/v1/exam/diagnostic`

### Behavior
1. **Initial Mutation:** The request executes within an atomic transaction. Upon success, the HTTP status code and response body are persisted to `api_mutation_idempotency` with a SHA-256 hash of the canonical request payload.
2. **Identical Retries:** If a network interruption causes the client to re-transmit the same request (identical `client_request_id` and payload), the backend returns the original cached response with identical status code without re-running the mutation.
3. **Key Reuse Conflict:** If a `client_request_id` is reused with a different operation or payload, the server rejects it immediately with `409 IDEMPOTENCY_CONFLICT`.
4. **Concurrent Safety:** Concurrent identical requests are coordinated via SQLite transactions; duplicate resources are never created.
5. **Preserved Domain Protection:** If `client_request_id` is omitted, standard domain checks (e.g. `ALREADY_ANSWERED` on duplicate answer submission) are preserved.
6. **Read-Only Endpoints:** Read-only (`GET`) endpoints do not track idempotency.

---

## 5. Standardized Error Response Contract

All errors originating under `/api/study/v1` strictly adhere to the error schema:

```json
{
  "error": {
    "code": "STRING_ERROR_CODE",
    "message": "Human-readable description of the error.",
    "details": {}
  }
}
```

### HTTP Status Codes & Error Codes

| Status Code | Error Code | Description |
|---|---|---|
| `400 Bad Request` | `INVALID_REQUEST` / `INVALID_LEVEL` / `PATH_TRAVERSAL` | Malformed parameters, invalid JLPT level, or path traversal. |
| `401 Unauthorized` | `UNAUTHORIZED` | Unauthorized request. |
| `404 Not Found` | `SESSION_NOT_FOUND` / `BLUEPRINT_NOT_FOUND` / `ITEM_NOT_FOUND` / `ASSET_NOT_FOUND` / `NOT_FOUND` | Target entity does not exist. |
| `409 Conflict` | `READINESS_FAILED` / `ALREADY_ANSWERED` / `SECTION_CLOSED` / `INVALID_SECTION_SEQUENCE` / `INVALID_STATE_TRANSITION` | Business conflict: unfulfilled blueprint readiness, duplicate answer submission, closed section, or invalid lifecycle transition. |
| `410 Gone` | `MEDIA_MISSING` | Content-addressed media asset is permanently missing from disk. |
| `422 Unprocessable Content` | `VALIDATION_ERROR` | Request payload failed Pydantic contract validation. Details include field-level validation errors. |
| `503 Service Unavailable` | `DATABASE_BUSY` | SQLite database is temporarily busy or locked under concurrent access. |
| `500 Internal Error` | `INTERNAL_SERVER_ERROR` | Unexpected error. Tracebacks, absolute paths, and internal secrets are strictly redacted. |

---

## 3. Question Presentation DTO Contract

All question endpoints across practice and exam return a consistent question contract:

```json
{
  "attempt_item_id": 101,
  "position": 1,
  "question_id": 45,
  "external_id": "01JABCDEF1234567890",
  "level": "N5",
  "category": "vocabulary",
  "format_code": "kanji_reading",
  "structural_family": "F1",
  "instruction_text": "______のことばは どう かきますか。",
  "prompt_markup": "この[underline]花[/underline]はきれいです。",
  "choices": [
    {
      "choice_id": 1001,
      "choice_key": "1",
      "display_position": 1,
      "label": "1",
      "mode": "text",
      "text_markup": "はな",
      "image_url": null,
      "asset_id": null
    },
    {
      "choice_id": 1002,
      "choice_key": "2",
      "display_position": 2,
      "label": "2",
      "mode": "text",
      "text_markup": "ほね",
      "image_url": null,
      "asset_id": null
    }
  ],
  "group_context": {
    "group_id": 12,
    "group_kind": "reading_passage",
    "title": "Passage 1",
    "parts": [
      {
        "ordinal": 1,
        "role": "passage",
        "title": "",
        "markup": "日本語のテキスト..."
      }
    ],
    "audio_url": null
  },
  "audio_url": "/api/study/v1/media/5",
  "presented_at": "2026-10-31T00:00:00Z",
  "is_answered": false,
  "selected_choice_id": null,
  "is_marked_for_review": false,
  "audio_play_count": 0,
  "section_code": "N5_SEC_VOCABULARY",
  "block_order": 1,
  "is_correct": null,
  "canonical_choice_id": null,
  "canonical_choice_key": null,
  "difficulty_rating": null,
  "explanation_markup": null
}
```

*Note:* `is_correct`, `canonical_choice_id`, `canonical_choice_key`, and `explanation_markup` remain `null` while an exam is in progress or before a practice question is submitted.

---

## 4. Endpoints Reference

### 4.1 Study Bank and Readiness

#### `GET /api/study/v1/bank/summary`
- **Query Parameters:**
  - `level` (optional, string): JLPT level filter (`N1`–`N5`).
- **Response:** `200 OK`
  - `total_questions` (int)
  - `active_questions` (int)
  - `eligible_questions` (int)
  - `levels` (dict): Breakdown per level containing `total_count`, `eligible_count`, and `formats`.

#### `GET /api/study/v1/exam/readiness`
- **Query Parameters:**
  - `level` (optional, string): JLPT level (`N1`–`N5`). If omitted, evaluates all levels N1–N5.
  - `version` (optional, string): Blueprint version.
- **Response:** `200 OK`
  - `level` (string)
  - `blueprint_version` (string)
  - `is_ready` (boolean)
  - `status` (string: `READY`, `INCOMPLETE_BANK`, `DEFICIT`)
  - `total_required` (int)
  - `total_available` (int)
  - `sections` (array of section readiness details)
  - `blocked_reasons` (array of strings)

#### `GET /api/study/v1/exam/blueprints/{level}`
- **Path Parameters:**
  - `level` (required, string): JLPT level (`N1`–`N5`).
- **Query Parameters:**
  - `version` (optional, string): Specific version; defaults to official version.
- **Response:** `200 OK`
  - Official blueprint definition including `test_sections`, `scoring_sections`, `time_limit_minutes`, and `item_quotas`.
- **Errors:** `400 Bad Request` on invalid level; `404 Not Found` if blueprint is not found.

---

### 4.2 Practice Drill API

#### `POST /api/study/v1/practice/sessions`
- **Request Body:**
  ```json
  {
    "level": "N5",
    "category": "vocabulary",
    "format_code": "kanji_reading",
    "question_count": 10,
    "session_type": "practice",
    "seed": 123456
  }
  ```
- **Response:** `201 Created`
  - Returns `PracticeSessionResponse` with items prepared and canonical answers masked.

#### `GET /api/study/v1/practice/sessions`
- **Query Parameters:**
  - `level` (optional, string)
  - `status` (optional, string: `created`, `in_progress`, `completed`, `abandoned`)
  - `limit` (default 20, max 100)
  - `offset` (default 0)
- **Response:** `200 OK`
  - Returns `PaginatedResponse` of practice sessions.

#### `GET /api/study/v1/practice/sessions/{id}`
- **Path Parameters:**
  - `id` (required, int or ULID): Session primary ID or external identifier.
- **Response:** `200 OK`
  - Full session state. Items reveal answers only if already answered or if session is completed.

#### `GET /api/study/v1/practice/sessions/{id}/next`
- **Path Parameters:**
  - `id` (required, int or ULID)
- **Response:** `200 OK`
  - Returns the next active `QuestionDTO` at `current_position`. Canonical answer key is strictly omitted.

#### `POST /api/study/v1/practice/sessions/{id}/answers`
- **Request Body:**
  ```json
  {
    "attempt_item_id": 101,
    "selected_choice_id": 1002,
    "time_spent_ms": 3200,
    "difficulty_rating": "hard"
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "attempt_item_id": 101,
    "selected_choice_id": 1002,
    "is_correct": false,
    "grading_status": "graded",
    "canonical_choice_id": 1001,
    "explanation_markup": "Choice 1 is correct because...",
    "time_spent_ms": 3200
  }
  ```
- **Errors:** `409 Conflict` (`ALREADY_ANSWERED`) if the attempt item was already answered.

#### `POST /api/study/v1/practice/sessions/{id}/feedback`
- **Request Body:**
  ```json
  {
    "attempt_item_id": 101,
    "difficulty_rating": "normal"
  }
  ```
- **Response:** `200 OK`
  - `{"status": "ok", "message": "Difficulty feedback recorded."}`

#### `POST /api/study/v1/practice/sessions/{id}/complete`
- **Response:** `200 OK`
  - Transitions session status to `completed` and returns full results.

#### `POST /api/study/v1/practice/sessions/{id}/abandon`
- **Response:** `200 OK`
  - Transitions session status to `abandoned`.

#### `GET /api/study/v1/practice/sessions/{id}/results`
- **Response:** `200 OK`
  - Returns full session results with canonical choices and explanations revealed for all items.

#### `GET /api/study/v1/history/questions`
- **Query Parameters:** `level`, `format_code`, `limit`, `offset`
- **Response:** `200 OK`
  - Paginated question history with accuracy, adaptive repetition priority, and consecutive easy streaks.

---

### 4.3 JLPT Examination API

#### `POST /api/study/v1/exam/sessions`
- **Request Body:**
  ```json
  {
    "level": "N5",
    "blueprint_version": null,
    "strict_timing": true,
    "enforce_readiness": true,
    "seed": 42
  }
  ```
- **Response:** `201 Created`
  - Full `ExamSessionResponse` with sections, timings, and draft item positions.
- **Errors:** `409 Conflict` (`READINESS_FAILED`) if question bank cannot fulfill the official blueprint.

#### `GET /api/study/v1/exam/sessions/{id}`
- **Description:** Read-only state polling via `peek_state()`. Never mutates timers or database records.
- **Response:** `200 OK`
  - `session_id`, `status`, `server_time`, `deadline_at`, `remaining_seconds`, `exam_mode`, `sections`, and current section items.

#### `POST /api/study/v1/exam/sessions/{id}/sections/{section}/start`
- **Path Parameters:**
  - `id`: Exam ID.
  - `section`: Section code (e.g. `N5_SEC_VOCABULARY`) or integer `block_order` (e.g. `1`).
- **Response:** `200 OK`
  - Starts section timer and returns updated state.

#### `POST /api/study/v1/exam/sessions/{id}/sections/{section}/pause`
- **Response:** `200 OK`
  - Pauses timer (available in relaxed exam mode).

#### `POST /api/study/v1/exam/sessions/{id}/sections/{section}/resume`
- **Response:** `200 OK`
  - Resumes timer with new wall-clock deadline.

#### `POST /api/study/v1/exam/sessions/{id}/sections/{section}/submit`
- **Response:** `200 OK`
  - Permanently closes the section, locks choices, and advances `active_section_order`.

#### `GET /api/study/v1/exam/sessions/{id}/items/{item}`
- **Path Parameters:**
  - `item`: Attempt item ID, question external ULID, or position within exam.
- **Response:** `200 OK`
  - Returns `QuestionDTO`. Canonical answer is masked during active exams.

#### `PUT /api/study/v1/exam/sessions/{id}/items/{item}/answer`
- **Request Body:** `{"selected_choice_id": 1002}` (or `null` to clear)
- **Response:** `200 OK`
  - Sets draft answer choice.

#### `PUT /api/study/v1/exam/sessions/{id}/items/{item}/flag`
- **Request Body:** `{"is_flagged": true}`
- **Response:** `200 OK`
  - Toggles mark-for-review flag.

#### `POST /api/study/v1/exam/sessions/{id}/complete`
- **Response:** `200 OK`
  - Grades all submitted choices, computes section scores, evaluates pass/fail status, and creates an immutable snapshot.

#### `GET /api/study/v1/exam/sessions/{id}/result`
- **Response:** `200 OK`
  - Returns immutable `ExamResult` snapshot: `estimated_total_score`, `raw_correct`, `raw_accuracy`, `passed_overall`, `passed_sectional`, `scoring_sections`.

#### `GET /api/study/v1/exam/history`
- **Query Parameters:** `level`, `limit`, `offset`
- **Response:** `200 OK`
  - Paginated list of exam attempts with final scores and pass/fail assessments.

#### `POST /api/study/v1/exam/diagnostic`
- **Request Body:** `{"level": "N5", "question_limit_per_format": 1, "seed": 42}`
- **Response:** `200 OK`
  - Diagnostic practice session covering available question formats.

---

### 4.4 Supporting and Diagnostics API

#### `GET /api/study/v1/dashboard/overview` & `GET /api/study/v1/analytics/overview`
- **Response:** `200 OK`
  - High-level learning analytics: `learning_summary`, `accuracy_by_level`, `accuracy_by_family`, `recent_activity`.

#### `GET /api/study/v1/analytics/weak-areas`
- **Response:** `200 OK`
  - List of question formats and levels with accuracy below 75% or high error counts.

#### `GET /api/study/v1/analytics/trouble-questions`
- **Query Parameters:** `limit` (default 10)
- **Response:** `200 OK`
  - List of questions repeatedly answered incorrectly.

#### `GET /api/study/v1/history/incorrect`
- **Query Parameters:** `level`, `limit`, `offset`
- **Response:** `200 OK`
  - Questions answered incorrectly for review drills.

#### `GET /api/study/v1/bookmarks`
- **Response:** `200 OK`
  ```json
  {
    "supported": false,
    "message": "Bookmarks are not currently supported by the local study domain.",
    "items": []
  }
  ```

#### `GET /api/study/v1/settings` & `PATCH /api/study/v1/settings`
- **Response:** `200 OK`
  - Study preferences: `default_exam_mode`, `strict_timing_enabled`, `enforce_readiness`, `adaptive_scheduling_enabled`.

#### `GET /api/study/v1/diagnostics`
- **Response:** `200 OK`
  - Comprehensive, strictly read-only diagnostics report inspecting SQLite integrity, foreign keys, migrations, media storage, and bank readiness.

---

### 7.5 Content-Addressed Media API

#### `GET /api/study/v1/media/{asset_id_or_sha256}`
- **Path Parameters:**
  - `asset_id_or_sha256`: Numeric asset ID or 64-character hex SHA-256 string.
- **Request Headers (Optional):**
  - `Range`: Standard HTTP byte-range request header (`Range: bytes=start-end`, `bytes=start-`, `bytes=-suffix`).
- **Response:**
  - `200 OK` (Full content): Returns full streamed asset with `Content-Length`, `Content-Type`, and `Accept-Ranges: bytes`.
  - `206 Partial Content` (Range request): Returns specified byte chunk with `Content-Range: bytes start-end/total`, `Content-Length`, and `Accept-Ranges: bytes`.
- **Security & Integrity:**
  - **Eligibility Verification:** The requested asset must be actively referenced by an eligible question revision or active group revision context. Unreferenced or retired assets return `403 MEDIA_INELIGIBLE`.
  - **Path Traversal Protection:** Relative traversal sequences (`..`, `/`, `\`) in identifiers are rejected immediately (`400 INVALID_ASSET_IDENTIFIER`).
  - **Low Memory Streaming:** Audio is streamed in 64 KB chunks directly from disk with seeking, preventing memory bloat on large audio files.
- **Errors:**
  - `400 Bad Request`: `INVALID_ASSET_IDENTIFIER` (path traversal or malformed identifier).
  - `401 Unauthorized`: `UNAUTHORIZED` (missing or invalid bearer token).
  - `403 Forbidden`: `MEDIA_INELIGIBLE` (asset not linked to an eligible question or group).
  - `404 Not Found`: `ASSET_NOT_FOUND` (asset not found in database).
  - `410 Gone`: `MEDIA_MISSING` (asset marked missing or removed from disk).
  - `416 Range Not Satisfiable`: `RANGE_NOT_SATISFIABLE` (invalid or unsatisfiable byte range; includes `Content-Range: bytes */total`).

