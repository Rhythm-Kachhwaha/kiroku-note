# Kiroku Note — JLPT Question Bank: Milestone 4 Question Acquisition Architecture

**Document ID:** `docs/study-bank/08-m4-acquisition-architecture.md`  
**Milestone:** Milestone 4 (Question Acquisition System)  
**Date:** 2026-10-30  
**Status:** Design Proposal  
**Preceding Deliverables:** `M4_ACQUISITION_FEASIBILITY_REPORT.md`, `docs/study-bank/05-m3-ingestion-pipeline.md`, `docs/study-bank/06-m3-ai-verification.md`

---

## 1. Executive Summary & Design Scope

Milestone 4 designs the **Question Acquisition System** for Kiroku Note's local-first JLPT Question Bank subsystem (`study.db`).

The acquisition subsystem is responsible for discovering, fetching, caching, and parsing external question material from public study repositories (beginning with `JapaneseTest4You`), extracting questions, answer choices, reading passages, question diagram assets, and source answer keys, and converting them into structured ingestion payloads that feed directly into Kiroku's existing Milestone 3 deterministic ingestion pipeline (Gate 1) and independent dual-model AI verification service (Gate 2).

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
│    ├── StructuredJsonInputAdapter (Existing)                                    │
│    ├── FormatClassifier (20 Formats F1–F6) (Existing)                           │
│    ├── AssetAndGroupAssociator (Existing)                                       │
│    ├── ContractNormalizer (Existing)                                            │
│    ├── DeterministicValidator (Eligibility ReasonCodes) (Existing)              │
│    └── PersistenceService (study.db Immutability & Sealed Revisions) (Existing) │
│                                        │                                        │
│                                        ▼                                        │
│  [ M3 Gate 2: Independent Dual-Model AI Verification ] (Existing)               │
│    ├── Model A (Independent Solve) + Model B (Independent Solve)                │
│    ├── Deterministic Comparator (Scenarios A–H vs Source Claims)                │
│    └── Pedagogical Explanation Synthesis & Human Review Ledger                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Architectural Principles & Boundaries
1. **Zero Duplication of M3 Ingestion:** M4 performs *acquisition, raw caching, and source-specific tokenization*. It does not classify formats, validate JLPT rules, normalize Pydantic contracts, check near-duplicates, or persist to `study.db`. M3's verified pipeline performs 100% of those operations.
2. **Local-First & IDE-Independent:** All acquisition services run inside Kiroku Note's local Python backend (`run_backend.py` / `kiroku.exe`). The system communicates with external web APIs via standard Python standard-library / `urllib` / `httpx` HTTP clients. It has zero dependency on an IDE, VS Code, or Antigravity runtime session.
3. **Pristine Source Provenance:** Raw web responses are cached immutably to disk before parsing. Parsing rules can be refined or re-run offline at any time without re-querying remote websites or consuming API quotas.
4. **Deterministic Parsing Boundary:** The parser is a deterministic, rule-based state machine. It does not perform AI grammar classification, English translations, or synthetic explanation generation.

---

## 2. Explicit Technology Selection & Provider Evaluation

The feasibility experiment evaluated both **Parallel** and **Keenable** against `JapaneseTest4You`. Based on empirical evidence, we evaluate the candidate architectures and select the production technology stack.

### 2.1 Comparative Evaluation Matrix

| Evaluation Dimension | Parallel Search & Extract API | Keenable Reader API | Empirical Evidence & Architectural Impact |
|---|---|---|---|
| **Extraction Accuracy (Web HTML)** | 100% character preservation | 100% character preservation | **Tie:** Both extract pristine Japanese kanji, hiragana, katakana, and punctuation from web HTML without corruption. |
| **Category Discovery** | Extracts all 20 exercise links, permalinks, and publication dates | Extracts all 20 exercise links, permalinks, and publication dates | **Tie:** Both extract all exercise URLs from archive pages cleanly. |
| **Pagination Handling** | **Preserves pagination elements** (`Page 1 of 2 1 [2]`) and total counts (`(30)`) | **Strips pagination elements** (DOM heuristic removes pagination as navigation boilerplate) | **Parallel Advantage:** Parallel parses footer navigation natively. Keenable requires deterministic URL incrementing (`/page/2/`). |
| **Image & Media Preservation** | **Strips image markdown tags** (`![](...)`) in default markdown conversion | **Preserves image markdown tags** (`![](https://.../jlpt-n4-reading-2-01.gif)`) | **Keenable Decisive Advantage:** Keenable captures question diagram URLs. Parallel loses them, causing visual question failure (`REQUIRED_ASSET_MISSING`). |
| **Markdown Formatting Cleanliness** | Escapes underscores (`\\_\\_\\_`) and list numbers (`1\\.`) | Unescaped underscores (`_______`) and numbers (`1.`) | **Keenable Advantage:** Keenable requires simpler, cleaner regex matching without backslash de-escaping passes. |
| **PDF Extraction** | Succeeded in fetching PDF, but caused **severe Japanese character corruption** (`ZOE`, `HCC`, `D/O`) | Failed on binary PDF (`The page was reached but content could not be extracted`) | **Draw:** PDF extraction is non-viable for both. Web HTML extraction is strictly required. |
| **Latency & Speed** | ~1.5–2.5 seconds per fetch | ~400–800 ms per fetch (sub-second) | **Keenable Advantage:** Keenable is 2x–3x faster for bulk exercise fetching. |
| **Anti-Scraping Bypass** | 100% reliable (bypasses Cloudflare 403) | 100% reliable (bypasses Cloudflare 403) | **Tie:** Both cleanly bypass Cloudflare anti-bot blocks that reject raw Python HTTP clients. |
| **Authentication & Configuration** | Single API Key via Bearer header | Single API Key via Bearer header | **Tie:** Both integrate via standard HTTP authorization headers stored in Kiroku DPAPI `SecretStore`. |
| **Maintenance Complexity** | Moderate (complex excerpt schemas, session management) | Low (simple endpoint: URL in, Markdown out) | **Keenable Advantage:** Minimalist API contract reduces client adapter code footprint. |

---

### 2.2 Candidate Architectures Considered

- **Architecture A: Parallel Only**  
  *Evaluation:* Fails on question diagrams. In our feasibility experiment, Parallel stripped `![](...)` image tags on reading exercises. Because Parallel's API returns markdown rather than raw HTML, question diagrams cannot be recovered, resulting in broken reading/vocabulary questions.
- **Architecture B: Keenable Only (with Deterministic Crawling)**  
  *Evaluation:* 100% character preservation, 100% image tag retention, clean unescaped markdown, and sub-second latency. While Keenable strips visual pagination footers, WordPress categories follow the universal, deterministic URL structure: `/category/{slug}/`, `/category/{slug}/page/2/`, `/category/{slug}/page/3/`. The crawler visits incrementing pages until an empty archive or 404 is encountered.
- **Architecture C: Parallel Primary + Keenable Fallback**  
  *Evaluation:* Unnecessary dual-vendor cost and configuration overhead. If the primary tool strips images, fallback logic would have to be triggered on every image-bearing page anyway, negating the concept of a fallback.
- **Architecture D: Parallel for Discovery + Keenable for Extraction**  
  *Evaluation:* Works technically, but forces the user to subscribe to **two separate AI services**, manage two separate API keys, and maintain two vendor dependencies solely to save 1–2 HTTP calls during category pagination.

---

### 2.3 Definitive Technology Selection

# **RECOMMENDED: ARCHITECTURE B (Keenable Primary with Deterministic URL Crawling)**

*(with a pluggable provider interface retaining Parallel as a secondary dormant adapter)*

#### Answers to Required Selection Questions:

1. **Which provider should be used in production?**  
   **Keenable** will be the authoritative acquisition provider for JapaneseTest4You web extraction. It provides 100% character fidelity, preserves question diagram URLs (`![](...)`), outputs clean unescaped Markdown, and executes with sub-second latency.
2. **Should the second provider (Parallel) be retained at all?**  
   **Yes, but strictly as a secondary codebase adapter behind the `BaseAcquisitionProvider` interface.** It will not be active or required by default. This preserves architectural flexibility if Keenable experiences an extended outage or if alternative sources require Parallel's deep search index, while requiring the end-user to configure only **one** API key.
3. **Can image preservation be handled independently without a second extraction provider?**  
   **Yes.** We empirically verified that while JapaneseTest4You blocks HTML page scrapers with `HTTP 403 Forbidden`, **static image assets (`https://japanesetest4you.com/image/...gif`) are NOT blocked** (Python `urllib` downloaded the test GIF with `HTTP 200` in 0.1s). Because Keenable retains the image URL in its markdown, Kiroku's local media fetcher downloads the binary directly and commits it to `study.db`'s content-addressed `MediaStore` without consuming any extraction API quota.
4. **What happens when the primary provider fails?**  
   - *Transient Errors (429 Rate Limit, 5xx Server Error, Timeout):* Handled by the provider adapter with exponential backoff and jitter (retries at 1s, 2s, 4s).
   - *Permanent Failure:* The URL is logged in the acquisition error ledger (`acquisition_job_item`), marked `failed`, and displayed in the Kiroku Desktop acquisition review screen for manual retry.
   - *Raw Cache Protection:* All successful fetches are immutably cached to disk. An error on exercise 15 of 30 never requires re-fetching exercises 1 through 14.
5. **What are the expected API costs and operational trade-offs?**  
   - A typical JLPT grammar or reading level contains ~30 exercises across 2 category pages.
   - Total discovery calls: 2 category pages = 2 API calls.
   - Total exercise calls: 30 exercise pages = 30 API calls.
   - Total calls per JLPT section: **32 API calls** (negligible cost, fractions of a cent per section).
   - Single-provider operational simplicity avoids synchronization bugs, dual-key configuration errors, and conflicting vendor rate limits.

---

## 3. End-to-End System Architecture & Component Responsibilities

The M4 subsystem resides under `backend/app/study/acquisition/`:

```text
backend/app/study/acquisition/
├── __init__.py
├── enums.py                      # CrawlStatus, ProviderKind, JobStatus
├── models.py                     # CrawlResult, RawPagePayload, ParsedExercise
├── cache.py                      # Content-addressed raw disk cache
├── providers/
│   ├── __init__.py
│   ├── base.py                   # BaseAcquisitionProvider (ABC)
│   ├── keenable_provider.py      # Keenable REST API implementation (Primary)
│   └── parallel_provider.py      # Parallel REST API implementation (Secondary)
├── crawler/
│   ├── __init__.py
│   ├── category_crawler.py       # Deterministic WordPress pagination crawler
│   └── url_filter.py             # Rejection of ads, Patreon, and navigation
├── parsers/
│   ├── __init__.py
│   ├── base.py                   # BaseSourceParser (ABC)
│   └── japanesetest4you.py       # Deterministic regex/state-machine parser
├── media/
│   ├── __init__.py
│   └── asset_downloader.py       # Direct image fetcher to MediaStore
└── orchestrator.py               # AcquisitionJob orchestrator and M3 bridge
```

### Component Responsibilities

| Component | Responsibility | Inputs | Outputs |
|---|---|---|---|
| **`BaseAcquisitionProvider`** | Abstract interface for remote web extraction. | Web URL, fetch parameters | Raw Markdown, title, HTTP metadata |
| **`KeenableProvider`** | Concrete HTTP client for Keenable reader API. | URL, API token from `SecretStore` | Clean Markdown with image references |
| **`RawAcquisitionCache`** | Content-addressed local disk storage for auditability and idempotency. | Source name, URL, raw text | Cache file path (`.md` + `.meta.json`) |
| **`CategoryCrawler`** | Discovers exercise URLs across paginated category archives. | Category root URL, level | List of validated exercise URLs |
| **`JapaneseTest4YouParser`** | Deterministic state machine parsing Markdown into questions and passages. | Raw Markdown, exercise URL | `ParsedExercise` (questions, choices, keys, groups) |
| **`AssetDownloader`** | Downloads diagram binaries directly and registers with `MediaStore`. | Image URLs from parser | Content-addressed `asset_id` (SHA-256) |
| **`AcquisitionOrchestrator`** | Coordinates crawl, cache, parse, and dispatches to M3 Ingestion. | Job specification (URL or Category) | `IngestionResult` from existing M3 pipeline |

---

## 4. Provider Interface Design

The provider boundary abstracts network transport and external vendor APIs.

```python
# backend/app/study/acquisition/providers/base.py
from abc import ABC, abstractmethod
from pydantic import BaseModel
from typing import Any

class FetchOptions(BaseModel):
    timeout_seconds: float = 30.0
    max_retries: int = 3
    force_live: bool = False

class RawFetchResult(BaseModel):
    url: str
    title: str
    raw_markdown: str
    status_code: int = 200
    headers: dict[str, str] = {}
    fetch_latency_ms: int = 0
    metadata: dict[str, Any] = {}

class BaseAcquisitionProvider(ABC):
    """Abstract interface for external web content acquisition."""

    @abstractmethod
    def fetch_page(self, url: str, options: FetchOptions | None = None) -> RawFetchResult:
        """Fetch an individual page and return clean markdown content."""
        pass

    @abstractmethod
    def is_configured(self) -> bool:
        """Verify that provider credentials are present and valid."""
        pass
```

### Authentication & Packaging Isolation
- In production, the provider does **NOT** invoke Antigravity MCP servers.
- The provider calls the upstream REST API directly using Python's standard library `urllib.request` or `httpx`.
- Secrets are resolved from the environment (`KEENABLE_API_KEY`) or Kiroku's encrypted DPAPI `SecretStore` (`%LOCALAPPDATA%\KirokuNote\secrets.json`).
- If no API key is configured, `is_configured()` returns `False`, and acquisition requests produce a structured `ReviewReasonCode.PROVIDER_UNCONFIGURED` rather than an unhandled crash.

---

## 5. Raw Response Disk Caching

Following Kiroku's local-first provenance principles (ADR-SB-008, ADR-SB-009):
- Every fetched page is immediately written to disk before parsing.
- Location: `%LOCALAPPDATA%\KirokuNote\study\raw_acquisition\<source_slug>\<sha256_of_url>.md`
- Companion metadata: `<sha256_of_url>.meta.json` containing:
  - Canonical source URL
  - Fetch timestamp (ISO 8601 UTC)
  - Provider identifier (`keenable`)
  - HTTP response headers and latency
  - SHA-256 content hash

### Cache Invalidation & Idempotency
- If a URL is already present in `RawAcquisitionCache` and `force_live = False`, the orchestrator reads directly from disk, saving 100% of network traffic and API costs.
- Re-running parser fixes across hundreds of acquired questions consumes **0 API credits**.

---

## 6. Deterministic JapaneseTest4You Parser Design

The parser decomposes the raw Markdown into questions, choices, passages, and answer keys using a line-oriented **Deterministic Finite State Machine (FSM)**.

```
       ┌──────────────┐
       │   PREAMBLE   │ (Extract title, date, category tag)
       └──────┬───────┘
              │ Header / Passage detected
              ▼
       ┌──────────────┐
  ┌───►│   PASSAGE    │ (Capture reading text, dialog script, diagram image URLs)
  │    └──────┬───────┘
  │           │ Question start detected (^\d+\.)
  │           ▼
  │    ┌──────────────┐
  │    │QUESTION_STEM │ (Capture question stem, blank markers _______)
  │    └──────┬───────┘
  │           │ Subsequent non-empty lines
  │           ▼
  │    ┌──────────────┐
  │    │   CHOICES    │ (Collect exactly 4 lines, assign ordinals 1..4)
  │    └──────┬───────┘
  │           │ Next question OR next passage
  └───────────┼────────────────────────────────────────┐
              │ **Answer Key:** detected               │
              ▼                                        ▼
       ┌──────────────┐                         ┌──────────────┐
       │  ANSWER_KEY  │                         │   METADATA   │ (Glossary, grammar
       └──────────────┘                         └──────────────┘  links, ads filter)
```

### Detailed Parser Rules

#### 1. Question Numbering & Stem Isolation
- Regex: `^\s*(?:(\d+)[\.．\\]+|問\s*(\d+)[\.．\s]*|Q(\d+)[\.．\s]*)\s*(.*?)$`
- Captures question index (e.g. `1` from `1. ` or `1\\. `) and stem text.
- Blank normalizer: converts `_______`, `＿＿＿＿＿＿＿`, and `\\_\\_\\_` to standard Kiroku `{blank}` tokens.

#### 2. Choice Ordinal Assignment
- In JapaneseTest4You markdown, choices are 4 sequential lines following the stem without explicit numeric prefixes.
- Parser state machine accumulates lines until:
  - An empty line followed by a new question start (`^\d+\.`)
  - A passage header (`**Reading passage`)
  - The answer key header (`**Answer Key:**`)
- Ordinal assignment:
  - Line 1 -> Ordinal 1, label `"1"`
  - Line 2 -> Ordinal 2, label `"2"`
  - Line 3 -> Ordinal 3, label `"3"`
  - Line 4 -> Ordinal 4, label `"4"`
- Malformed guard: If accumulated choices $\neq 4$, the parser does not discard the question; it records the available choices and flags `ReviewReasonCode.CHOICE_COUNT_INVALID` for review in M3 Gate 1.

#### 3. Reading Passages & Content Group Association
- Header pattern: `^\s*\*\*Reading passage\s*(\d+)\*\*\s*$`
- When detected, the parser initiates a `GroupDraft`:
  - `title`: e.g. `"Reading passage 1"`
  - `raw_body`: passage text paragraphs
  - `attached_assets`: diagram URLs matching `japanesetest4you.com/image/*`
- All questions encountered subsequent to this passage (and prior to the next passage) receive `group_reference = "passage_1"`.
- Passage blanks (`[ 1 ]`, `[ 2 ]`, `【1】`) are automatically mapped to question anchor references.

#### 4. Answer Key Extraction & Redundant Cross-Verification
- Section header: `^\s*\*\*Answer Key:\*\*\s*$`
- Line pattern: `^\s*(?:Question\s*|問\s*)?(\d+)\s*[:：]\s*([1-4１-４])\s*(?:\((.*?)\))?\s*$`
- Captures:
  1. `question_number`: e.g. `1`
  2. `correct_ordinal`: e.g. `3`
  3. `completed_sentence_or_phrase`: e.g. `あの人は病気ではないのにくすりをたくさん飲んでいます。`
- **Cross-Verification:** The parser compares the text of choice `correct_ordinal` (`のに`) against the completed sentence in parentheses. If the blank replacement does not match the chosen text, `is_conflicted` is flagged.

#### 5. Advertisement & Stray Asset Filtering
- Promotional banners and affiliate links are strictly discarded based on domain and path heuristics:
  - Discard: `*/wp-content/uploads/*ADVERTISEMENT*`, `*/MAINPAGE-AD*`, `*patreon.com*`, `*feeds.feedburner.com*`.
  - Retain: `japanesetest4you.com/image/*` (actual test diagrams and kanji illustrations).

---

## 7. Data Flow & Interface to Existing M3 Pipeline

M4 constructs a clean `IngestInput` payload and invokes Kiroku's existing M3 pipeline without modifying M3 internals.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        M4 Acquisition Output                           │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ IngestInput (STRUCTURED_JSON)
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Existing M3 Gate 1 Ingestion Pipeline                    │
│                                                                        │
│ 1. StructuredJsonInputAdapter (Unpacks source, questions, groups)      │
│ 2. TextSegmenter (Constructs QuestionDraft & GroupDraft objects)       │
│ 3. FormatClassifier (Identifies JLPT level, category, format F1–F6)    │
│ 4. AssetAndGroupAssociator (Links passage groups and downloaded media) │
│ 5. ContractNormalizer (Builds AnyQuestionPayload & ContentGroupPayload)│
│ 6. DeterministicValidator (Evaluates schema bounds & eligibility)     │
│ 7. PersistenceService (Atomically writes to study.db & seals revision) │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ Persisted Question Revision ID
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│               Existing M3 Gate 2 Dual-Model AI Verification            │
│                                                                        │
│ 1. Model A + Model B Independent Solves (Zero source anchoring)        │
│ 2. Deterministic Comparator (Scenarios A–H vs source_answer_claim)     │
│ 3. Canonical Pedagogical Explanation Generation                        │
│ 4. Human Decision Ledger (Approval / Correction / Rejection)           │
└────────────────────────────────────────────────────────────────────────┘
```

### Exact Data Interface Contract
M4 produces a Python dictionary conforming to `StructuredJsonInputAdapter`:

```json
{
  "source": {
    "name": "JapaneseTest4You",
    "source_type": "web_capture",
    "url": "https://japanesetest4you.com/japanese-language-proficiency-test-jlpt-n4-grammar-exercise-1/",
    "citation": "JapaneseTest4You JLPT N4 Grammar Exercise 01",
    "license_or_permission": "Public educational web exercise",
    "level": "N4"
  },
  "groups": [
    {
      "id": "passage_1",
      "title": "Reading passage 1",
      "group_type": "passage",
      "raw_body": "医者「どうしましたか。川田(かわだ)さん。」...",
      "parts": [
        {"ordinal": 1, "role": "text", "markup": "医者「どうしましたか。川田(かわだ)さん。」..."}
      ],
      "attached_assets": [
        {"kind": "diagram", "url": "https://japanesetest4you.com/image/jlpt-n4-reading-2-01.gif"}
      ]
    }
  ],
  "questions": [
    {
      "external_id": "Exercise 01, Q1",
      "format_code": "N4_GRAMMAR_CHOICE",
      "stem": "あの人は病気ではない _______ くすりをたくさん飲んでいます。",
      "instruction": "",
      "group_reference": null,
      "choices": [
        {"ordinal": 1, "label": "1", "text": "ので"},
        {"ordinal": 2, "label": "2", "text": "ために"},
        {"ordinal": 3, "label": "3", "text": "のに"},
        {"ordinal": 4, "label": "4", "text": "から"}
      ],
      "answer": {
        "ordinal": 3,
        "rationale": "あの人は病気ではないのにくすりをたくさん飲んでいます。"
      }
    }
  ]
}
```

---

## 8. Database Considerations & Schema Audit

We inspected the existing `study.db` schema across `0001_initial_schema.sql`, `0002_seed_formats_and_exams.sql`, and `0003_ai_verification.sql`.

### 8.1 Existing Tables Directly Supporting M4 Acquisition

| Existing Table | Role in M4 Acquisition |
|---|---|
| **`source`** | Represents the external source entity (`name='JapaneseTest4You'`, `url='https://japanesetest4you.com'`). |
| **`import_batch`** | Tracks each crawling or import run (`adapter_name='japanesetest4you_crawler'`, `status='completed'`). |
| **`import_item`** | Stores raw JSON payload, extraction confidence, and link to parsed question. |
| **`question_source`** | Maps `question_id` to `source_id` with `external_item_id` (e.g. `"N4-G-01-Q1"`). |
| **`group_source`** | Maps `content_group_id` to `source_id` with `external_group_id`. |
| **`source_answer_claim`** | Preserves extracted website answer key (`claimed_correct_ordinal=3`) with completed sentence rationale. |
| **`asset`** | Stores downloaded diagram images (`sha256_hash`, file size, MIME type, disk location). |
| **`duplicate_candidate`** | Logs questions with identical or near-identical fingerprints for human review. |

### 8.2 Proposed New Tracking Tables (`0004_acquisition_jobs.sql`)
To support long-running bulk crawls, progress reporting, and retry tracking in Kiroku Desktop without entangling question entities, we propose a lightweight forward-only migration adding two operational tracking tables:

```sql
-- Migration: 0004_acquisition_jobs.sql (Proposed)
CREATE TABLE IF NOT EXISTS acquisition_job (
    id TEXT PRIMARY KEY,                       -- ULID
    source_name TEXT NOT NULL,                 -- 'JapaneseTest4You'
    target_category_url TEXT NOT NULL,         -- Root category URL
    jlpt_level TEXT NOT NULL,                 -- 'N1'..'N5'
    section_category TEXT NOT NULL,           -- 'grammar', 'reading', 'vocabulary'
    status TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'crawling', 'completed', 'failed', 'paused'
    total_discovered INTEGER NOT NULL DEFAULT 0,
    total_acquired INTEGER NOT NULL DEFAULT 0,
    total_failed INTEGER NOT NULL DEFAULT 0,
    error_summary TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE IF NOT EXISTS acquisition_job_item (
    id TEXT PRIMARY KEY,                       -- ULID
    job_id TEXT NOT NULL,
    exercise_url TEXT NOT NULL UNIQUE,
    exercise_title TEXT NOT NULL DEFAULT '',
    ordinal INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',    -- 'queued', 'fetched', 'parsed', 'ingested', 'failed'
    cache_path TEXT DEFAULT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(job_id) REFERENCES acquisition_job(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX IF NOT EXISTS idx_acq_job_status ON acquisition_job(status);
CREATE INDEX IF NOT EXISTS idx_acq_item_status ON acquisition_job_item(job_id, status);
```

> [!NOTE]
> **Strict Isolation from Vocabulary:** `study.db` remains 100% physically isolated from `kiroku.db`. Acquisition operations have zero interaction with user vocabulary mining, Anki sync, or Yomitan cards.

---

## 9. Desktop Integration Architecture

Kiroku Note will host acquisition workflows within its Windows Electron Desktop application (`kiroku.exe`).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Kiroku Desktop UI                               │
│                                                                        │
│  [ Quick Add ]  [ History ]  [ Study Bank: Acquisition & Review ]      │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Mode 1: Single Exercise Import                                        │
│  URL: [ https://japanesetest4you.com/.../grammar-exercise-1/ ] [Fetch] │
│  ──► Status: Acquired (10 Questions) -> Open in Review                 │
│                                                                        │
│  Mode 2: Category Bulk Crawl                                           │
│  Level: [ N4 v ]  Section: [ Grammar v ]                               │
│  Category URL: https://japanesetest4you.com/category/jlpt-n4/...       │
│  Progress: [████████████████░░░░] 18/30 Exercises Acquired             │
│  [ Pause ]  [ Resume ]  [ Cancel ]                                     │
│                                                                        │
│  Mode 3: Acquisition Error & Retry Queue                               │
│  - Exercise 14: HTTP 504 Gateway Timeout               [ Retry Now ]   │
│  - Exercise 22: Image 404 Not Found                    [ Review ]      │
│                                                                        │
│  Mode 4: Acquired Question Review & Verification                       │
│  - 300 Questions Staged for Human Review                               │
│  - Dual-Model AI Verification: 285 Concordant, 15 Flagged for Review   │
│  [ Approve All Concordant ]  [ Review Flagged ]                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Desktop IPC & Subprocess Flow
1. **Desktop Process Manager:** The Electron main process communicates with the local FastAPI backend on port `21828` via authenticated loopback HTTP routes (`POST /api/study/acquisition/jobs`, `GET /api/study/acquisition/jobs/{id}`).
2. **Background Execution:** Crawl jobs run asynchronously in the Python backend process with non-blocking threads or asyncio tasks, streaming progress events via SSE (Server-Sent Events) or polled endpoints.
3. **Graceful Cancellation & Resumption:** Jobs can be paused or canceled. Resuming checks `acquisition_job_item` and skips already cached/ingested URLs.

---

## 10. Security, Rate Limiting & Ethical Crawling

1. **Anti-Scraping & WAF Respect:**
   - Naive crawling bursts risk triggering IP bans. The crawler enforces a **mandatory delay** between page fetches:
     - Default politeness interval: **1.5 seconds** $\pm$ **0.5s jitter**.
     - Max concurrent fetches: **1 request at a time**.
2. **Secret Management:**
   - API tokens (`KEENABLE_API_KEY`) are stored in Windows DPAPI encrypted storage via `backend/app/services/secret_store.py`.
   - Keys are **never** logged to stdout, written to `desktop_backend.log`, stored in `study.db`, or embedded in export JSON.
3. **Static Image Domain Whitelisting:**
   - The media downloader only fetches images from whitelisted source hostnames (`japanesetest4you.com`).
   - Private IP ranges (RFC 1918), localhost loopbacks, and non-HTTP protocols are rejected to prevent SSRF vulnerabilities.

---

## 11. Implementation Milestones

```
M4.1: Provider Core & Disk Cache
├── BaseAcquisitionProvider & KeenableProvider
├── RawAcquisitionCache (.md + .meta.json)
└── Unit tests with mocked HTTP responses
       │
       ▼
M4.2: JapaneseTest4You Parser & Asset Downloader
├── Deterministic FSM parser (grammar, vocab, reading passages, blank anchors)
├── AssetDownloader (diagram downloads to MediaStore)
└── Parsing test suite using feasibility experiment fixtures
       │
       ▼
M4.3: Crawler & M3 Ingestion Bridge
├── CategoryCrawler (deterministic WordPress pagination)
├── Bridge translating ParsedExercise to IngestInput (STRUCTURED_JSON)
└── Integration tests feeding parsed exercises into M3 IngestionPipeline
       │
       ▼
M4.4: Migration 0004 & Orchestration Service
├── Database migration 0004_acquisition_jobs.sql
├── AcquisitionOrchestrator job coordinator
└── FastAPI backend endpoints for Desktop UI integration
```

---

## 12. Unresolved Decisions Requiring Human Approval

The following architectural decisions are presented for review and approval before implementation begins:

1. **Provider Technology Selection:**
   - *Recommendation:* Approve **Architecture B** (Keenable as authoritative primary provider with deterministic URL crawling; Parallel retained as optional dormant adapter).
   - *Alternative:* Require Architecture D (dual-vendor Parallel Discovery + Keenable Extraction, requiring two API keys).
2. **Job Tracking Persistence:**
   - *Recommendation:* Apply proposed migration `0004_acquisition_jobs.sql` to track crawl progress, job states, and retries relationally in `study.db`.
   - *Alternative:* Store crawl jobs as isolated JSON files in `%LOCALAPPDATA%\KirokuNote\study\acquisition_jobs\` without database schema changes.
3. **Politeness Delay Default:**
   - *Recommendation:* Set inter-request crawling delay to **1.5s with $\pm$0.5s jitter** (single-threaded concurrency).
   - *Alternative:* Increase concurrency to 2 parallel requests if permitted by Keenable rate limits.
4. **Single-URL Ingestion Auto-Approval Policy:**
   - *Recommendation:* Single-URL user imports should stage questions with `ReviewStatus.NEEDS_REVIEW` by default, requiring explicit user approval or Gate 2 AI verification before becoming `active`.
   - *Alternative:* Auto-approve questions if external answer key is present and passes deterministic validation.

---

*Document prepared for architectural review. Implementation will commence only upon approval of decisions.*
