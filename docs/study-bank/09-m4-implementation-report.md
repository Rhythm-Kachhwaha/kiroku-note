# Kiroku Note — JLPT Question Bank: Milestone 4 Implementation Report
## Question Acquisition System

**Document ID:** `docs/study-bank/09-m4-implementation-report.md`  
**Milestone:** Milestone 4 (Question Acquisition System)  
**Date:** 2026-10-30  
**Status:** Complete & Verified  
**Preceding Deliverables:** `docs/study-bank/08-m4-acquisition-architecture.md`, `M4_ACQUISITION_FEASIBILITY_REPORT.md`

---

## 1. Executive Summary & Verification Verdict

Milestone 4 delivers the complete, production-grade **Question Acquisition System** for Kiroku Note's local-first JLPT Question Bank subsystem (`study.db`).

The acquisition subsystem discovers, fetches, immutably caches, and deterministically parses external question material from public study repositories (starting with `JapaneseTest4You`), extracting questions, answer choices, reading passages, question diagram assets, and source answer keys, and converting them into structured ingestion payloads that feed directly into Kiroku's existing Milestone 3 deterministic ingestion pipeline (Gate 1) and independent dual-model AI verification service (Gate 2).

All architectural decisions approved in the implementation directive were rigorously enforced:
- **Decision 1 (Provider):** Architecture B implemented. Keenable is the authoritative primary web extraction provider. Parallel is implemented as an optional, dormant fallback adapter that is strictly disabled by default.
- **Decision 2 (Job Persistence):** Migration `0004_acquisition_jobs.sql` implemented and applied. Tracks acquisition jobs and item-level lifecycle stages (`queued` -> `fetched` -> `parsed` -> `ingested` -> `failed`) with full resumption and retry support.
- **Decision 3 (Crawling Policy):** Single-threaded deterministic WordPress category crawling with configurable 1.5s politeness delay and ±0.5s random jitter. Stops immediately on 403 Forbidden.
- **Decision 4 (Import Approval):** Single-URL and bulk imports default strictly to `ReviewStatus.NEEDS_REVIEW`. No question becomes active without Gate 2 AI verification or explicit human review.

```
                      [ External Web Source: JapaneseTest4You ]
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           M4 Acquisition Subsystem                              │
│                                                                                 │
│  [ Category Crawler ] ───► [ BaseAcquisitionProvider ] ───► [ Raw Disk Cache ]  │
│                                (Keenable / Parallel)               │            │
│                                                                    ▼            │
│  [ Media Asset Fetcher ] ◄─────────────────────────── [ Source-Specific Parser ]│
│    (Downloads diagrams                                 (Deterministic AST       │
│     to MediaStore)                                      Regex State Machine)    │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ Structured IngestInput JSON
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       Existing M3 Ingestion & Verification                      │
│                                                                                 │
│  [ M3 Gate 1: Deterministic Ingestion Pipeline ]                                │
│    ├── StructuredJsonInputAdapter (Ingests source, questions, groups)           │
│    ├── FormatClassifier (20 Formats F1–F6)                                      │
│    ├── AssetAndGroupAssociator (Passage groups and diagram linking)             │
│    ├── ContractNormalizer (AnyQuestionPayload & ContentGroupPayload)            │
│    ├── DeterministicValidator (Bounds & Eligibility ReasonCodes)                │
│    └── PersistenceService (study.db Immutability & Sealed Revisions)            │
│                                        │                                        │
│                                        ▼                                        │
│  [ M3 Gate 2: Independent Dual-Model AI Verification ]                          │
│    ├── Model A (Independent Solve) + Model B (Independent Solve)                │
│    ├── Deterministic Comparator (Scenarios A–H vs Source Claims)                │
│    └── Pedagogical Explanation Synthesis & Human Review Ledger                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Implemented Architecture & Component Map

The M4 subsystem resides under `backend/app/study/acquisition/`:

```text
backend/app/study/acquisition/
├── __init__.py                   # Package exports and public facades
├── enums.py                      # ProviderKind, AcquisitionJobStatus, AcquisitionItemStatus, CrawlStatus
├── models.py                     # FetchOptions, RawFetchResult, DiscoveredExercise, CrawlResult, JobProgress
├── cache.py                      # Content-addressed RawAcquisitionCache (.md + .meta.json)
├── job_service.py                # Relational job persistence and resumption in study.db
├── orchestrator.py               # Central coordinator bridging M4 acquisition to M3 Gate 1 & Gate 2
├── providers/
│   ├── __init__.py
│   ├── base.py                   # BaseAcquisitionProvider (ABC)
│   ├── keenable_provider.py      # Keenable REST API implementation (Primary)
│   ├── parallel_provider.py      # Parallel REST API implementation (Secondary dormant adapter)
│   ├── mock.py                   # MockAcquisitionProvider (Offline canned testing)
│   └── registry.py               # Dynamic provider resolution factory
├── crawler/
│   ├── __init__.py
│   ├── url_filter.py             # URL filtering (ads, Patreon, and navigation rejection)
│   └── category_crawler.py       # Deterministic WordPress pagination crawler (/page/2/, /page/3/)
├── parsers/
│   ├── __init__.py
│   ├── base.py                   # BaseSourceParser (ABC)
│   ├── models.py                 # ParsedExercise, ParsedQuestion, ParsedChoice, ParsedPassage, ParsedAnswerClaim
│   └── japanesetest4you.py       # Deterministic regex state-machine parser
└── media/
    ├── __init__.py
    └── asset_downloader.py       # Diagram asset fetcher with SSRF whitelisting to MediaStore
```

---

## 3. Provider Integration & Security

### 3.1 Keenable Provider (`KeenableProvider`)
- **API Endpoints:**
  - Authenticated: `https://api.keenable.ai/v1/fetch` (via header `X-API-Key: <key>`)
  - Keyless / Public: `https://api.keenable.ai/v1/fetch/public` (via header `X-Keenable-Title: kiroku-note`)
- **Credential Resolution:**
  - Checked in priority: explicit constructor argument -> environment variable `KEENABLE_API_KEY` -> Windows DPAPI encrypted `SecretStore` (`%LOCALAPPDATA%\KirokuNote\secrets.json`).
- **Resilience & Backoff:**
  - Transient errors (HTTP 429 Rate Limit, HTTP 500/502/503/504 Server Errors): exponential backoff with random jitter (1s, 2s, 4s).
  - Permanent failure (HTTP 403 Forbidden): terminates immediately without retrying, raising `PermissionError`.
- **Absolute Credential Redaction:**
  - API keys and tokens are never printed to stdout, logged to backend logs, or stored in database records or metadata files.

### 3.2 Parallel Dormant Adapter (`ParallelProvider`)
- Implements `BaseAcquisitionProvider` behind the common abstraction.
- Dormant and disabled by default: `is_configured()` returns `False` unless explicitly enabled via `KIROKU_ACQUISITION_PROVIDER=parallel` and `PARALLEL_API_KEY`.
- Raises `RuntimeError` if invoked while disabled, preventing accidental network traffic or API quota consumption.

---

## 4. Raw Response Disk Cache (`RawAcquisitionCache`)

Following local-first provenance principles:
- **Location:** `backend/study/raw_acquisition/<source_slug>/` (dev) or `%LOCALAPPDATA%\KirokuNote\study\raw_acquisition\<source_slug>/` (packaged).
- **Files:**
  - `<sha256_of_url>.md`: pristine markdown text exactly as extracted.
  - `<sha256_of_url>.meta.json`: companion metadata including canonical URL, fetch timestamp (ISO 8601 UTC), provider name, HTTP headers (with credentials and cookies automatically sanitized), latency in milliseconds, and SHA-256 content hash.
- **Idempotency:** When `force_live=False` and a URL is cached, `get()` serves from disk instantly (0 network calls, 0 API credits).

---

## 5. Category Crawler (`CategoryCrawler`)

- **Discovery:** Crawls paginated WordPress archives (e.g. `https://japanesetest4you.com/category/jlpt-n4/jlpt-n4-grammar-test/`).
- **Pagination Strategy:**
  - Page 1: root category URL with trailing slash.
  - Page 2+: increments `/page/2/`, `/page/3/` until an empty page, duplicate URLs, or HTTP 404 is encountered.
- **Politeness Policy:** Single-threaded execution enforcing a configurable 1.5s delay with ±0.5s random jitter between live requests.
- **URL Filtering:** `url_filter.py` discards promotional Patreon links, ad banners (`ADVERTISEMENT`, `MAINPAGE-AD`), RSS feeds, and category navigation links.
- **Sidebar Count Cross-Check:** Detects reported category counts (e.g. `(30)`) and records a warning if discovered count diverges from reported totals.

---

## 6. Deterministic JapaneseTest4You Parser (`JapaneseTest4YouParser`)

- **Grammar & Vocabulary Exercises:**
  - Isolates question numbering (`1. `, `問1. `, `Q1. `) and stems.
  - Normalizes underscores (`_______`, `＿＿＿＿＿＿＿`, `\\_\\_\\_`) to standard `{blank}` tokens.
  - Collects 4 choice lines following the stem and assigns ordinals 1..4.
  - Pristine Japanese character preservation: furigana parentheses (`川田(かわだ)`), kanji, kana, and punctuation are untouched.
- **Reading Passages & Anchor Association:**
  - Detects headers (`**Reading passage 1**`, `**Reading passage 2**`).
  - Normalizes passage blanks (`[ 1 ]`, `[ 2 ]`, `【1】`) to `{blank|1}`, `{blank|2}` matching Kiroku AST markup.
  - Escapes stray ASCII square brackets to prevent collision with ruby `[base|reading]` markup.
  - Preserves diagram image URLs (`![](https://japanesetest4you.com/image/...)`).
  - Associates subsequent questions to the active passage (`group_reference = "passage_1"`).
  - Associates anchored questions to their corresponding blank (`anchor_key = "1"`).
- **Answer Key Extraction & Cross-Verification:**
  - Parses `**Answer Key:**` section lines (`Question 1: 3 (rationale)`).
  - Replaces full-width digits (`１-４` -> `1-4`).
  - Cross-verifies choice text against rationale (e.g. `=> choice_text`); flags `is_conflicted = True` if discrepancy detected.
- **Discards Stray Content:**
  - Automatically isolates and filters out companion offline PDF download links, Kanji Lessons, New Words vocabulary glossaries, and Patreon banners.

---

## 7. Media Asset Downloader (`AssetDownloader`)

- **SSRF Whitelisting:** Strictly enforces domain whitelist (`japanesetest4you.com`).
- **Private IP Rejection:** Rejects loopback addresses (127.0.0.1, localhost) and RFC 1918 private ranges (10.x, 192.168.x, 172.16.x).
- **Content-Addressed Storage:** Ingests images into `MediaStore` at `media/<sha[:2]>/<sha><ext>` and registers records in the `asset` table in `study.db`.

---

## 8. Database Migration `0004_acquisition_jobs.sql`

Tracks long-running bulk crawls, exercise states, and retry queues relationally in `study.db`:

```sql
CREATE TABLE IF NOT EXISTS acquisition_job (
    id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    target_category_url TEXT NOT NULL,
    jlpt_level TEXT NOT NULL,
    section_category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'crawling', 'completed', 'failed', 'paused')),
    total_discovered INTEGER NOT NULL DEFAULT 0,
    total_acquired INTEGER NOT NULL DEFAULT 0,
    total_failed INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE IF NOT EXISTS acquisition_job_item (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    exercise_url TEXT NOT NULL,
    exercise_title TEXT NOT NULL DEFAULT '',
    ordinal INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'fetched', 'parsed', 'ingested', 'failed')),
    cache_path TEXT DEFAULT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(job_id) REFERENCES acquisition_job(id) ON DELETE CASCADE,
    UNIQUE(job_id, exercise_url)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_acq_job_status ON acquisition_job(status);
CREATE INDEX IF NOT EXISTS idx_acq_item_status ON acquisition_job_item(job_id, status);
```

---

## 9. M3 Ingestion & Verification Integration (`AcquisitionOrchestrator`)

- **Gate 1 Integration:**
  - `ParsedExercise.to_m3_structured_payload()` constructs the exact dictionary format expected by `StructuredJsonInputAdapter`.
  - Dispatches to `IngestionPipeline.run(ingest_input, conn=conn, persist=True)`.
  - Passes through format classification (20 formats F1–F6), passage group association, Pydantic contract normalization, and deterministic validation.
  - Sets `auto_approve = False`, guaranteeing all acquired questions stage with `ReviewStatus.NEEDS_REVIEW`.
  - Persists `source_answer_claim` records linking original external answers.
- **Gate 2 Integration:**
  - Exposes `batch_verify_candidates` integration calling `VerificationService`.
  - Models solve questions independently with zero source answer key anchoring.
  - Compares solutions deterministically (Scenarios A through H) and stores runs in `verification_run`.
- **Deduplication:**
  - Leverages SQLite `content_fingerprint` in `question_revision`. Re-importing previously imported questions reuses existing question entities without creating duplicates.

---

## 10. Comprehensive Test Results

All tests were executed and verified by an isolated subagent in the repository workspace.

### 10.1 Batch 1: Acquisition Foundation (`test_study_acquisition_foundation.py`)
- `test_mock_provider_registration_and_fetch`: **PASSED**
- `test_parallel_dormant_enforcement`: **PASSED**
- `test_keenable_provider_secret_redaction_and_headers`: **PASSED**
- `test_provider_registry_lookup`: **PASSED**
- `test_raw_cache_put_get_and_sanitization`: **PASSED**
- `test_url_filter_rules`: **PASSED**
- `test_extract_level_and_section`: **PASSED**
- `test_category_crawler_with_mock_fixture`: **PASSED**
- `test_migration_0004_and_job_lifecycle`: **PASSED**

### 10.2 Batch 2: Parser & Media Downloader (`test_study_acquisition_parser.py`)
- `test_parse_grammar_exercise_1`: **PASSED** (10 questions, 4 choices each, blanks, answer claims)
- `test_parse_reading_exercise_2`: **PASSED** (2 passages, 7 questions, diagram images, group references)
- `test_m3_structured_payload_conversion`: **PASSED** (converts to valid M3 dictionary)
- `test_asset_url_validation_and_ssrf_protection`: **PASSED** (allows whitelist, rejects private IPs)
- `test_asset_downloader_with_mock_client`: **PASSED** (commits to MediaStore with SHA-256)

### 10.3 Batch 3: M3 Integration (`test_study_acquisition_m3_integration.py`)
- `test_single_url_import_pipeline_flow`: **PASSED** (`URL -> Fetch -> Cache -> Parse -> Gate 1 -> Gate 2 -> NEEDS_REVIEW`)
- `test_category_bulk_acquisition_and_job_tracking`: **PASSED** (crawls category, tracks 20 items in `study.db`)
- `test_duplicate_import_idempotency`: **PASSED** (re-import served from cache, zero duplicate API calls)
- `test_retry_failed_job_items`: **PASSED** (failed items successfully retried and marked completed)

### 10.4 Regression Summary
- **M4 Acquisition Suite:** 18 passed in 1.20s (100% pass rate)
- **Full Study Subsystem Suite:** 201 passed in 5.05s (100% pass rate, 0 regressions)

---

## 11. Known Limitations & Future Extension Points

1. **Additional Source Parsers:** `JapaneseTest4You` is the initial production parser. The `BaseSourceParser` interface is ready for future sources (e.g. `JTest`, `ShinKanzenMaster`, `JLPT Sensei`).
2. **Desktop UI Integration:** Milestone 4 implements backend-first services (`AcquisitionOrchestrator`, `AcquisitionJobService`, `CategoryCrawler`). The future Electron desktop shell will bind these services to GUI progress bars, single-URL fetch modals, and bulk approval screens.
3. **Audio Ingestion:** Listening exercises with companion audio files will plug into `AssetDownloader` and M3's `AudioInputAdapter`.

