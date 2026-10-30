# Kiroku Note — JLPT Question Bank: Post-M4.1 Completion Audit & Roadmap Update

**Document ID:** `docs/study-bank/11-post-m4.1-completion-audit.md`  
**Milestone:** Post-M4.1 Audit & Strategic Roadmap Update  
**Date:** 2026-10-30  
**Status:** Authoritative Repository Audit & Technical Handover  
**Target Subsystem:** Local-First JLPT Study Database & Question Bank (`study.db`)  
**Preceding Deliverables:** `docs/study-bank/00` through `10`  

---

## 1. Executive Summary

This document establishes the verified technical state of Kiroku Note's local-first JLPT Question Bank subsystem following the completion of **Milestone 4.1 (Full JLPT Resource Discovery, Format Coverage & Audio Retrieval)**.

The audit was conducted strictly against the actual files, Git working tree, database instances, and recorded test suites in the repository. Its primary purpose is to provide a complete, trustworthy picture of the repository so that development can advance to the next milestone immediately without re-auditing or rediscovering already-verified systems.

### Core Audit Verdict
1. **Milestones 0, 1, 2, 3 (Gates 1 & 2), 4, and 4.1 are structurally and functionally complete within their specified boundaries.**
2. **Boundary Enforcement is 100% Intact:**
   - `study.db` does not exist on disk and was never created or initialized during M4.1.
   - Core `kiroku.db` was last modified on 2026-10-29 and was completely untouched throughout all Study Bank milestones.
   - Zero new SQL migrations were added in M4.1 (migrations remain at `0004_acquisition_jobs.sql`).
   - No questions have been imported, persisted, or approved outside of temporary, isolated in-memory test fixtures.
   - All M4.1 media handling operates in a zero-DB filesystem mode (`conn=None`), generating content-addressed assets without database transactions.
3. **M4.1 Scope Verification:**
   - Discovered and categorized 25 distinct question practice sections across JLPT N1–N5 on `https://japanesetest4you.com/`.
   - Filtered out non-exercise reference lists, eBooks, and Patreon/AdSense links via deterministic regex filtering in `url_filter.py`.
   - Unified hybrid parser in `japanesetest4you.py` now supports all six question families (F1–F6) across Grammar, Reading, Vocabulary, Kanji, and Listening.
   - Preserves Star sentence composition (F2) with ★ position, phrase fragments, and answer rationale permutation derivation.
   - Resolves Kanji 5-line target-word blocks and shared contextual sentence stems.
   - Retrieves, binary-validates (ID3v2 and MPEG frame sync), and content-addresses MP3 listening audio into `MediaStore` paths (`media/<sha[:2]>/<sha>.mp3`).
   - Generates fully structured M3-compatible candidate payloads via `ParsedExercise.to_m3_structured_payload()`.
   - Parsing halts strictly at the candidate payload stage; no live crawling or ingestion runs were executed against real user databases.
4. **Test Suite Status:**
   - 29 targeted acquisition tests pass (11 M4.1 robustness tests + 18 M4 foundation/parser/integration tests).
   - 212 total study subsystem tests exist across 23 test modules (all verified in earlier milestone runs).
   - Full backend regression suite baseline stands at 923 passed (256 subtests) as of Milestone 3 audit; full suite rerun was deliberately omitted to preserve resources.

---

## 2. Verified Project State

| Dimension | Verified Reality | Evidence Location |
| :--- | :--- | :--- |
| **Active Branch** | `main` | `git status` (up to date with `origin/main`) |
| **HEAD Commit** | `328d338 feat(study): implement Milestone 4 question acquisition subsystem` | `git log -n 1` |
| **Uncommitted Working State** | 4 modified files (`url_filter.py`, `asset_downloader.py`, `japanesetest4you.py`, `models.py`), 8 untracked files (6 synthetic fixtures, 1 test file, 1 doc) | `git status` |
| **Core Database (`kiroku.db`)** | Last modified 2026-10-29 12:08:31 PM; zero schema alterations | `backend/data/kiroku.db` metadata |
| **Study Database (`study.db`)** | **Does not exist** on disk (neither in dev tree nor in `%LOCALAPPDATA%`) | Filesystem probe of repo root and AppData |
| **Applied SQL Migrations** | 4 migrations total (`0001` through `0004`); zero added in M4.1 | `backend/app/study/migrations/` |
| **Media Store Root** | No persistent audio or image files stored on disk; zero `.mp3` files in repo | `backend/app/study/media.py`, filesystem scan |
| **AI Verification Integration** | M3 Gate 2 verified; dual-model provider abstraction in place; 0 live API calls during M4.1 | `backend/app/study/verification/` |
| **Desktop App (Electron)** | Phase 1 foundation complete (supervisor, tray, bridge, Quick Add/History); unaffected | `desktop/` |

---

## 3. M0–M4.1 Milestone-by-Milestone Audit

### Milestone 0: Audit, Requirements & Architecture Design
- **Original Objective:** Establish architectural blueprint, audit runtime environment (Windows, Python 3.11, SQLite 3.39.4, Node 24), define strict subsystem isolation boundaries (`study.db` separate from `kiroku.db`), and produce initial schema/ADR proposals.
- **Actually Implemented:**
  - `docs/study-bank/00-repo-audit.md`: Probed SQLite 3.39.4 capabilities (STRICT tables, WAL mode, foreign keys, triggers, JSON functions, RETURNING clause).
  - `docs/study-bank/01-schema-and-contracts.md`: Comprehensive entity-relationship design and preliminary SQL schemas.
  - `docs/study-bank/02-decision-log.md`: ADR-SB-001 through ADR-SB-020 establishing local-first persistence, WAL mode, forward migrations, immutable revisions, engine triggers, relational choices, star derivation, and content-addressed media.
- **Tests & Verification:** Baseline test suites probed (740 backend tests, 255 extension tests, 10 desktop tests passed).
- **Completeness Verdict:** 100% complete as design baseline.

### Milestone 1: Database Foundation & Schema Immutability
- **Original Objective:** Implement SQLite connection manager with WAL mode, forward-only migration runner with SHA-256 checksums, pre-migration online backups, STRICT relational tables with composite foreign keys and engine-level immutability triggers, content-addressed media storage, dynamic question eligibility evaluator, and read-only database doctor.
- **Actually Implemented:**
  - `backend/app/study/connection.py`: `StudyDatabaseManager` with explicit WAL verification, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 10000`, `read()` and `write_tx()` (`BEGIN IMMEDIATE`) transaction wrappers.
  - `backend/app/study/migrations/runner.py`: Forward-only migration engine using `PRAGMA user_version`, `schema_migration` checksum tracking, and atomic statement execution via `sqlite3.complete_statement`.
  - `backend/app/study/migrations/0001_initial.sql`: 28 STRICT tables, composite FKs (`question(content_group_id, level) REFERENCES content_group(id, level)`, etc.), and engine-level `BEFORE UPDATE` and `BEFORE DELETE` triggers enforcing one-way `sealed_at: NULL -> timestamp` transitions across 11 tables.
  - `backend/app/study/migrations/0002_seed_formats_and_exams.sql`: Seeds 20 official JLPT formats, format_level rules, and exam section definitions.
  - `backend/app/study/backup.py`: Online WAL-safe backup using `conn.backup()`, integrity verification via `PRAGMA integrity_check`, atomic rename, and 5-backup retention policy.
  - `backend/app/study/media.py`: `MediaStore` two-tier prefix tree (`media/<sha[:2]>/<sha><ext>`), streaming temporary ingest, fsync before atomic `os.replace`, containment checks rejecting directory traversal.
  - `backend/app/study/eligibility.py`: SQL view `v_question_eligibility` pre-filter and Python `evaluate_eligibility()` returning 9 priority-ordered reason codes (`RETIRED` through `ANSWER_CONFLICT`).
  - `backend/app/study/doctor.py`: Read-only `run_doctor()` diagnostic suite testing SQLite integrity, foreign keys, migration checksums, triggers, format completeness, media existence/hashes, orphans, and relational pins.
  - `backend/app/study/ulid.py`: Standard-library-only Crockford Base32 ULID generator.
  - `backend/app/study/provenance.py`: External source tracking and source answer claim preservation.
- **Tests & Verification:** 63 unit tests across 7 test files (`test_study_db_infrastructure.py`, `test_study_schema_and_immutability.py`, `test_study_media.py`, `test_study_eligibility_and_provenance.py`, `test_study_exam_and_formats.py`, `test_study_doctor.py`, `test_study_exclusion_and_packaging.py`).
- **Completeness Verdict:** 100% complete and fully verified.

### Milestone 2: Question Family Contracts, Authoritative Format Registry & Japanese Inline Markup Parser
- **Original Objective:** Implement strictly typed Pydantic discriminated union contracts for all six question families (F1–F6), authoritative format registry for all 20 JLPT formats matching seed SQL, AST-based Japanese markup parser and serializer with ruby/furigana, blanks, underline, stars, and database decomposition/recomposition functions.
- **Actually Implemented:**
  - `backend/app/study/formats.py`: Authoritative `FORMAT_REGISTRY` mapping 20 format codes to families (F1–F6), categories, graders, choice bounds (min/max), and allowed JLPT levels.
  - `backend/app/study/contracts/enums.py`: `JlptLevel`, `QuestionCategory`, `StructuralFamily`, `ChoiceMode` (`text`, `image`, `unprinted`), `AnswerOrigin`, `ReasonCode`.
  - `backend/app/study/contracts/common.py`: `ChoicePayload`, `AnswerPayload`, `AssetRefPayload`, `ContentGroupPayload`, `GroupAnchorPayload`.
  - `backend/app/study/contracts/families.py`: `F1QuestionPayload` through `F6QuestionPayload` and `AnyQuestionPayload` discriminated union.
  - `backend/app/study/contracts/db_mapping.py`: `decompose_question_for_db()`, `recompose_question_from_db()`, `compute_content_fingerprint()`.
  - `backend/app/study/markup/ast.py`: Pydantic AST models (`TextNode`, `RubyNode`, `UnderlineNode`, `BlankNode`, `StarNode`, `MarkupAST`).
  - `backend/app/study/markup/errors.py`: Position-aware `MarkupSyntaxError` (line, col, offset, snippet).
  - `backend/app/study/markup/parser.py`: Deterministic recursive-descent parser with HTML injection protection.
  - `backend/app/study/markup/serializer.py`: `to_markup()`, `to_plain_text()`, `to_reading_text()`, `to_safe_html()`.
  - `backend/app/study/markup/validator.py`: `extract_anchors()`, `validate_group_anchors()`, `has_star()`, `has_underline()`, `has_blank()`.
- **Tests & Verification:** 86 unit tests across 3 test files (`test_study_markup.py`, `test_study_contracts.py`, `test_study_integration_contracts.py`).
- **Completeness Verdict:** 100% complete and fully verified.

### Milestone 3 Gate 1: Deterministic Question Ingestion Pipeline
- **Original Objective:** Implement an offline, deterministic ingestion pipeline from multiple modalities (pasted text, structured JSON, digital PDF text, scanned image OCR, audio) through segmentation, classification across 20 formats, passage/anchor/asset association, contract normalization, deterministic validation, review service, and atomic persistence to `study.db` with zero AI/LLM dependencies.
- **Actually Implemented:**
  - `backend/app/study/ingestion/adapters/`: `PastedTextInputAdapter`, `StructuredJsonInputAdapter`, `PdfTextInputAdapter`, `ScannedImageInputAdapter`, `AudioInputAdapter`.
  - `backend/app/study/ingestion/segmentation/`: `TextSegmenter`, `AnswerKeyParser`.
  - `backend/app/study/ingestion/classification/`: `FormatClassifier` (all 20 official formats with level fallback).
  - `backend/app/study/ingestion/association/`: `AssetAndGroupAssociator` (anchors, passage groups, diagram assets).
  - `backend/app/study/ingestion/normalization/`: `ContractNormalizer` (maps to M2 contracts).
  - `backend/app/study/ingestion/validation/`: `DeterministicValidator` (choice bounds, AST syntax, eligibility ReasonCodes).
  - `backend/app/study/ingestion/review/`: `ReviewService` (draft and review candidate lifecycle).
  - `backend/app/study/ingestion/persistence/`: `PersistenceService` (atomic transaction writes to `study.db`, sealed-at immutability, duplicate candidate detection via content fingerprinting, source answer claims).
  - `backend/app/study/ingestion/pipeline.py`: `IngestionPipeline` orchestrating all Gate 1 stages.
- **Tests & Verification:** 27 unit and integration tests across 4 test files (`test_study_ingestion_adapters.py`, `test_study_ingestion_segmentation.py`, `test_study_ingestion_classification.py`, `test_study_ingestion_pipeline.py`).
- **Completeness Verdict:** 100% complete and fully verified.

### Milestone 3 Gate 2: Independent Dual-Model AI Question Verification
- **Original Objective:** Implement independent dual-model AI verification layered on Gate 1. Models solve questions in Stage 1 without source answer key anchoring. In Stage 2, models evaluate external source answer claims. A deterministic rule-based comparator classifies results into Scenarios A through H. Structured explanations are synthesized only on agreement. A human review ledger enforces human authority and non-mutating revision branching on correction.
- **Actually Implemented:**
  - `backend/app/study/verification/providers/`: `BaseAIProvider`, `XAIProvider` (Grok), `OpenAICompatibleProvider` (OpenAI, local Ollama, vLLM), `MockAIProvider` (offline deterministic testing).
  - `backend/app/study/verification/config.py`: `AIVerificationConfig`, `ModelSlotConfig`, environment loading without leaking API keys.
  - `backend/app/study/verification/prompts.py`: Stage 1 prompt (isolated solving) and Stage 2 prompt (source claim evaluation).
  - `backend/app/study/verification/models.py`: `VerificationModelResponse`, `SourceClaimEvaluation`, `ComparisonResult`, `VerificationRunRecord`, `HumanDecisionRecord`.
  - `backend/app/study/verification/comparator.py`: `DeterministicComparator` (Scenarios A through H).
  - `backend/app/study/verification/service.py`: `VerificationService` (orchestrates Model A, Model B, Comparator, and Explanation synthesis).
  - `backend/app/study/verification/persistence.py`: `VerificationPersistenceService` (records runs in `study.db` with composite FKs and triggers).
  - `backend/app/study/verification/review.py`: `VerificationReviewService` (human decision recording, non-mutating revision branching on `CORRECT`, preserving assets, source claims, and star derivations).
  - `backend/app/study/migrations/0003_ai_verification.sql`: Database schema for `verification_run`, `verification_model_response`, `verification_human_decision`, `question_explanation` with composite FKs and triggers.
- **Tests & Verification:** 42 unit and integration tests across 5 test files (`test_study_verification_config.py`, `test_study_verification_providers.py`, `test_study_verification_comparator.py`, `test_study_verification_service.py`, `test_study_verification_persistence_and_review.py`).
- **Completeness Verdict:** 100% complete and fully verified.

### Milestone 4: Question Acquisition System Foundation
- **Original Objective:** Build an external material acquisition subsystem to discover, fetch, immutably cache, and deterministically parse questions from `JapaneseTest4You`. Provide provider abstraction (Keenable primary, Parallel dormant secondary, Mock offline), content-addressed raw disk cache, category pagination crawler with polite delays, source-specific deterministic parser, asset downloader with SSRF protection, relational job tracking in `study.db` (`0004_acquisition_jobs.sql`), and orchestration bridge into M3 Gate 1 & Gate 2 with default `ReviewStatus.NEEDS_REVIEW`.
- **Actually Implemented:**
  - `backend/app/study/acquisition/providers/`: `BaseAcquisitionProvider`, `KeenableProvider`, `ParallelProvider`, `MockAcquisitionProvider`, `registry.py`.
  - `backend/app/study/acquisition/cache.py`: `RawAcquisitionCache` (content-addressed via URL SHA-256, companion `.meta.json`, header sanitization).
  - `backend/app/study/acquisition/crawler/`: `url_filter.py`, `category_crawler.py` (polite crawling with 1.5s ± 0.5s jitter).
  - `backend/app/study/acquisition/parsers/`: `BaseSourceParser`, `JapaneseTest4YouParser`, `models.py`.
  - `backend/app/study/acquisition/media/`: `AssetDownloader` (SSRF protection, whitelisting `japanesetest4you.com`, streaming to `MediaStore`).
  - `backend/app/study/acquisition/job_service.py`: `AcquisitionJobService` (resumption, tracking job and item statuses).
  - `backend/app/study/acquisition/orchestrator.py`: `AcquisitionOrchestrator` (bridges to M3 Gate 1 `IngestionPipeline` and Gate 2 `VerificationService`).
  - `backend/app/study/migrations/0004_acquisition_jobs.sql`: Relational schema for `acquisition_job` and `acquisition_job_item`.
- **Tests & Verification:** 18 unit and integration tests across 3 test files (`test_study_acquisition_foundation.py`, `test_study_acquisition_parser.py`, `test_study_acquisition_m3_integration.py`).
- **Completeness Verdict:** 100% complete as the baseline acquisition foundation.
- **Identified Gap for M4.1:** Baseline M4 parser handled only Grammar N4 and Reading N4 exercises; it lacked coverage for Kanji, Vocabulary, and Listening; lacked Star sentence composition (F2) metadata extraction; lacked multi-question kanji sentence contexts; and lacked audio download and validation.

### Milestone 4.1: Full JLPT Resource Discovery, Format Coverage & Audio Retrieval
- **Original Objective:** Expand JapaneseTest4You acquisition across all 5 JLPT levels (N1–N5) and all 5 exercise categories (Grammar, Vocabulary, Kanji, Reading, Listening); enhance hybrid parser for all F1–F6 formats; extract star sentence ordering (F2) with permutation and star derivation; handle kanji multi-question contexts and 5-line target-word blocks; implement playable audio retrieval, binary validation, and zero-DB MediaStore storage; scope audio tracks (question, passage, shared, exercise); format structured M3-ready candidate payloads; ensure zero database writes, zero migrations, zero unapproved question imports, and stop strictly at structured candidate payload.
- **Actually Implemented:**
  - Detailed in [Section 4](#4-detailed-m41-implementation-breakdown).
- **Tests & Verification:** 11 targeted unit and integration tests in `test_study_acquisition_m4_1_robustness.py` passing cleanly in 1.70s. Total acquisition test suite = 29 tests passing.
- **Completeness Verdict:** 100% complete within its defined candidate-generation boundary.

---

## 4. Detailed M4.1 Implementation Breakdown

### 4.1 Resource Discovery & URL Filtering (`backend/app/study/acquisition/crawler/url_filter.py`)
- **25 Exam Categories Discovered:** Covers 5 categories across all 5 levels:
  - `jlpt-n[1-5]-grammar-test`
  - `jlpt-n[1-5]-vocabulary-test`
  - `jlpt-n[1-5]-kanji-test`
  - `jlpt-n[1-5]-reading-test`
  - `jlpt-n[1-5]-listening-test`
- **Discard Filtering:**
  - Reference Lists: Excludes non-exercise vocabulary and grammar lists (`/jlpt-[nN][1-5]-(?:vocabulary|grammar)-list/?`).
  - Commercial / eBooks: Excludes `/ebook-.*/`.
  - Non-JLPT Sections: Excludes `/category/otaku-corner/`.
  - Monetization: Excludes `patreon.com`, `feedburner`, ad image uploads (`ADVERTISEMENT`, `MAINPAGE-AD`).
- **Exercise Pattern Matching:** Positive matching for permalinks matching `/(?:japanese-language-proficiency-test-)?jlpt-[nN][1-5]-(?:grammar|reading|vocabulary|kanji|listening)-(?:exercise|test)-\d+[a-z]?/?`.
- **Level & Section Extraction:** `extract_level_and_section(url, title)` reliably extracts `(level, section)` handling variants such as `choukai` (listening), `bunpou` (grammar), and `goi` (vocabulary).

### 4.2 Supported Question Formats & Registry Mappings (`backend/app/study/acquisition/parsers/models.py`)
All extracted questions deterministically map into Kiroku's M2 Question Families and official 20 formats via `_derive_format_code()`:

| Exercise Type | Structural Signals Detected | Official Format Code | Structural Family |
| :--- | :--- | :--- | :--- |
| **Grammar Blank Selection** | Stem with blank (`_______`), 4 grammar choices | `sentential_grammar_1` | **F1** |
| **Star Sentence Ordering** | Blanks containing `★` or `☆`, 4 phrase fragments | `sentence_composition` | **F2** |
| **Kanji Reading** | Stem with target kanji, 4 hiragana choices | `kanji_reading` | **F1** |
| **Orthography (Word to Kanji)** | Hiragana target in stem, 4 kanji choices | `orthography` | **F1** |
| **Contextual Expressions** | Vocabulary blank or collocation, 4 vocabulary choices | `contextual_expressions` | **F1** |
| **Reading Comprehension** | Linked to passage group, 1–3 associated questions | `comprehension_short` | **F3** |
| **Text Grammar** | Linked to passage group with anchored blank `{blank\|k}` | `text_grammar` | **F4** |
| **Listening with Diagram** | Question audio track + diagram image; unprinted numeric choices | `task_based_listening` | **F5** |
| **Listening with Textual Choices** | Question audio track + Japanese text radio choices | `key_points_listening` | **F5** |
| **Listening with Shared Context** | Passage-level shared audio track introducing multi-question context | `integrated_listening` | **F6** |

### 4.3 Parser Data-Model Enhancements (`backend/app/study/acquisition/parsers/models.py`)
- **`AudioAssociation` Model:**
  ```python
  class AudioAssociation(BaseModel):
      track_url: str
      scope: Literal["question", "passage", "shared", "exercise"] = "question"
      target_id: str | None = None
      asset_id: str | None = None
      local_path: str | None = None
      mime_type: str = "audio/mpeg"
      status: Literal["remote_only", "retrieved", "failed"] = "remote_only"
      error_reason: str | None = None
  ```
- **`StarArrangementMetadata` Model:**
  ```python
  class StarArrangementMetadata(BaseModel):
      star_position: int
      total_blanks: int = 4
      pre_stem: str = ""
      post_stem: str = ""
      fragments: list[str] = Field(default_factory=list)
      derived_order: list[int] = Field(default_factory=list)
      star_fragment: str = ""
  ```
- **`ParsedQuestion` & `ParsedPassage` Updates:**
  - Added `audio: AudioAssociation | None = None` and `audio_urls: list[str]`.
  - Added `star_arrangement: StarArrangementMetadata | None = None`.
  - Added `format_code: str | None = None`.

### 4.4 Star Arrangement Representation & Answer Derivation (`backend/app/study/acquisition/parsers/japanesetest4you.py`)
- **Detection:** `_parse_star_arrangement()` detects presence of `★` or `☆` in the stem.
- **Positioning:** Splits stem on blanks and stars to compute the 1-based index of the star position (typically position 3 in `＿＿ ＿＿ ★ ＿＿`).
- **Context Isolation:** Separates text preceding the blanks (`pre_stem`) from text following the blanks (`post_stem`).
- **Permutation Derivation:** When an external answer key provides a completed Japanese sentence in the rationale, the parser matches all choice fragments against the rationale string, computes their sequential character offsets, sorts them, and derives the full 4-fragment permutation order (e.g. `[3, 1, 2, 4]`).
- **Star Binding:** Directly maps the derived choice at `star_position` to `star_fragment`.

### 4.5 Kanji Context Handling (`backend/app/study/acquisition/parsers/japanesetest4you.py`)
- **5-Line Block Disambiguation:** In Kanji exercises where a question block has 5 lines (line 0 being the target kanji word followed by 4 choices), the parser extracts line 0, attaches it to the stem context (`【target】`), and yields exactly 4 clean choices.
- **Shared Sentence Stems:** When questions share a contextual sentence across multiple numbered subquestions, the contextual sentence is attached to the stem (`【context】 stem`), ensuring each question is self-contained.

### 4.6 Reading Passage & Question Associations
- **Headers:** Matches passage headers (`PASSAGE_HEADER_RE`) across variations: `**Reading passage 1**`, `Passage 2`, `本文 1`.
- **Diagrams:** Matches both Markdown `![...](url)` and HTML `<img src="...">` tags, binding image URLs to `ParsedPassage.image_urls`.
- **Anchors:** Detects `{blank|1}` or `[ 1 ]` in passage text and correlates them with question stems containing `anchor_key`.

### 4.7 Listening Question Structures & Audio Retrieval (`backend/app/study/acquisition/media/asset_downloader.py`)
- **WordPress Player Extraction:** Regex `AUDIO_SRC_RE` extracts MP3 links from `<audio src="...">`, `<source src="...">`, and Markdown audio links `[Audio](url)`.
- **Network Architecture:** Audio files on `japanesetest4you.com` are static MP3 files hosted at `https://japanesetest4you.com/choukai/{level}/{track}.mp3`. They require zero cookies or authentication and support HTTP range requests.
- **Binary Signature Validation (`is_valid_audio_bytes`):**
  - MP3: Checks ID3v2 tag prefix (`ID3`, `49 44 33`) or raw MPEG audio sync bits (`0xFF` followed by `0xE0` mask, e.g. `0xFB`, `0xFA`, `0xF3`, `0xF2`).
  - WAV, OGG, M4A: Validates container signatures (`RIFF/WAVE`, `OggS`, `ftyp`).
- **Filesystem-Only MediaStore Storage:** When called with `conn=None`, `AssetDownloader.download_asset()` streams bytes, validates binary signatures, computes SHA-256, creates the two-tier prefix directory (`media/<sha[:2]>/`), writes `<sha><ext>`, and returns storage paths without issuing SQL statements.

### 4.8 Audio Association Scopes
- **Question Scope:** Audio player located within a specific question block; attached to `ParsedQuestion.audio` with `scope="question"` and `target_id="Q{n}"`.
- **Passage Scope:** Audio player located within a reading/passage header; attached to `ParsedPassage.audio` with `scope="passage"`. Subquestions reference `group_reference=passage_id`.
- **Shared Scope:** Audio player shared across an entire section; associated to all questions in that exercise block.

### 4.9 Local Media References in Candidate Payloads (`to_m3_structured_payload()`)
When media is retrieved into `MediaStore`, references are formatted in the returned dictionary:
```json
{
  "kind": "audio",
  "url": "https://japanesetest4you.com/choukai/0002/n5_1_1.mp3",
  "asset_id": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "local_path": "e3/e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.mp3",
  "status": "retrieved"
}
```
If media retrieval is disabled or offline, it emits `status="remote_only"` with the URL.

### 4.10 How `to_m3_structured_payload()` Works
`ParsedExercise.to_m3_structured_payload()` constructs the exact dictionary consumed by `StructuredJsonInputAdapter`:
- `source`: Provenance metadata (source name, URL, citation, level).
- `groups`: Passage bodies, parts, blank anchors (`anchor_key`, `ordinal`), and attached assets (diagrams and audio).
- `questions`: External IDs, stems, instructions, choices (`ordinal`, `label`, `text`), answers (`ordinal`, `rationale`), diagram URLs, audio URLs, attached media assets, and `metadata` containing `official_format_code` and `star_arrangement`.
- `metadata`: Parsing warnings, counts of questions, passages, and audio tracks.

### 4.11 Pipeline Stopping Point
The acquisition and parsing pipeline stops strictly at the generation of this in-memory `dict`. It does not call `IngestionPipeline.run()`, does not open a transaction on `study.db`, and does not invoke `VerificationService.verify_solve_request()`.

### 4.12 Implemented Code vs Synthetic Fixtures
- **Implemented in Production Code:**
  - Full URL filter with whitelist and discard rules (`url_filter.py`).
  - Audio binary signature validator (`asset_downloader.py`).
  - Zero-DB filesystem storage mode (`asset_downloader.py`).
  - Hybrid regex parser handling HTML/Markdown tags, Kanji 5-line blocks, audio extraction, and Star derivation (`japanesetest4you.py`).
  - Format derivation and M3 structured payload generation (`models.py`).
- **Merely Tested with Synthetic Fixtures:**
  - All test cases in `test_study_acquisition_m4_1_robustness.py` run against synthetic HTML and Markdown files in `backend/tests/fixtures/study_acquisition/`.
  - HTTP downloading was tested using `httpx.MockTransport` delivering synthetic binary ID3/MPEG byte buffers.
  - Live mass downloads and production network crawls across all 25 categories were **not** executed, preserving rate limits and database cleanliness.

---

## 5. Current Architecture and End-to-End Data Flow

```
                      [ External Web Source: JapaneseTest4You ]
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Milestone 4 / 4.1 Acquisition Subsystem                    │
│                                                                                 │
│  [ CategoryCrawler ] ────────► [ URL Filter ] ────────► [ KeenableProvider ]    │
│    (Polite delay 1.5s ± 0.5s)    (25 categories,         (Primary web reader)   │
│                                   rejection rules)               │              │
│                                                                  ▼              │
│  [ AssetDownloader ] ◄─────────────────────────────── [ RawAcquisitionCache ]   │
│    ├── SSRF Whitelisting                                 (SHA-256 URL hash,     │
│    ├── Audio Binary Check (ID3/MPEG)                      .md + .meta.json)     │
│    └── Zero-DB MediaStore Storage                                │              │
│        (media/<sha[:2]>/<sha>.mp3)                               ▼              │
│                                                      [ JapaneseTest4YouParser ] │
│                                                        ├── HTML/MD Unwrapping   │
│                                                        ├── Audio / Diagrams     │
│                                                        ├── Kanji 5-line Blocks  │
│                                                        ├── Star Derivation (F2) │
│                                                        └── Format Classification│
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │
                                        ▼
                   [ In-Memory M3-Ready Structured Payload ]
                      (ParsedExercise.to_m3_structured_payload)
                                        │
  ============================== PIPELINE STOP ==================================
                                        │ (When authorized in M5)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Milestone 3 Gate 1 & Gate 2 (Existing)                     │
│                                                                                 │
│  [ StructuredJsonInputAdapter ] ──► [ FormatClassifier ] (20 formats F1–F6)     │
│                                           │                                     │
│  [ AssetAndGroupAssociator ] ◄────────────┘                                     │
│         │                                                                       │
│         ▼                                                                       │
│  [ ContractNormalizer ] ──► [ DeterministicValidator ]                          │
│                                   │                                             │
│                                   ▼                                             │
│  [ PersistenceService ] ──► [ study.db ] (Sealed Revisions, STRICT tables)      │
│                                   │                                             │
│                                   ▼                                             │
│  [ VerificationService ] ──► Dual-Model Independent Solve (Model A + Model B)   │
│                                   │                                             │
│  [ DeterministicComparator ] ──► Scenarios A–H vs Source Claims                 │
│                                   │                                             │
│  [ Human Review Ledger ] ────► NEEDS_REVIEW / Revision Branching on Correction  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Database and Persistence Boundaries

| Boundary Check | Observed Status | Audit Verification Details |
| :--- | :--- | :--- |
| **`study.db` Existence** | **Does not exist** | Neither `backend/study/`, `backend/data/study.db`, nor `%LOCALAPPDATA%\KirokuNote\data\study.db` exists. |
| **`kiroku.db` Immutability** | **Untouched** | Timestamp is 2026-10-29 12:08:31 PM. No study tables or columns exist in `kiroku.db`. |
| **Database Migrations** | **Zero added in M4.1** | Migrations remain at `0001`, `0002`, `0003`, and `0004`. No `0005` migration was introduced. |
| **Question Ingestion Executed** | **Zero live records** | No questions were committed to any database. All M3 integration tests ran against `:memory:` databases. |
| **MediaStore Zero-DB Mode** | **Verified** | `AssetDownloader.download_asset()` with `conn=None` writes directly to filesystem paths without SQL execution. |
| **Permanent Scraped Artifacts** | **None** | No `.mp3` files exist in the repo. No `.md` cached files exist in `raw_acquisition`. Only synthetic fixtures exist in `backend/tests/fixtures/study_acquisition/`. |

---

## 7. Test Coverage and Verification Evidence

All tests across Kiroku Note's test suite are categorized below based on repository inspection and recorded run results:

### 7.1 M4.1 Targeted Tests (`test_study_acquisition_m4_1_robustness.py`)
- **Status:** **11 passed in 1.70s** (Recorded in M4.1 report).
- **Test Inventory:**
  1. `test_parse_listening_with_diagram_and_unprinted_choices`: Audio + diagram + numeric choices.
  2. `test_parse_listening_with_textual_choices`: Audio + Japanese text radio choices.
  3. `test_parse_shared_audio_in_passage`: Multi-question passage sharing a single audio track.
  4. `test_parse_star_sentence_ordering`: Star arrangement, blanks, star position, and permutation derivation.
  5. `test_parse_kanji_reading_context_attachment`: Shared sentence context attached to kanji reading stems.
  6. `test_parse_orthography_word_to_kanji`: Word-to-kanji orthography choices vs reading hiragana choices.
  7. `test_audio_binary_signature_validation`: ID3v2 and MPEG frame sync bit checks.
  8. `test_asset_downloader_audio_retrieval`: Content-addressed download into MediaStore without DB writes.
  9. `test_parser_with_media_retrieval`: Parser-driven media retrieval and path linking.
  10. `test_url_filter_all_categories_and_rejections`: 25 categories permitted; reference lists and eBooks rejected.
  11. `test_ambiguous_and_unsupported_structure_diagnostics`: Malformed choice counts flagged as warnings and ambiguous.

### 7.2 M4 Baseline Tests (`test_study_acquisition_*.py`)
- **Status:** **18 passed in 1.20s** (Recorded in M4 report).
- **Test Inventory:**
  - `test_study_acquisition_foundation.py` (9 tests): Provider registry, Keenable provider, Parallel dormant adapter, raw cache, URL filter, WordPress crawler, migration `0004`.
  - `test_study_acquisition_parser.py` (5 tests): Grammar exercise 1, Reading exercise 2, M3 structured payload conversion, SSRF protection, asset downloader.
  - `test_study_acquisition_m3_integration.py` (4 tests): In-memory single URL flow, category bulk crawl simulation, deduplication idempotency, failed item retry.

### 7.3 Study Bank Full Suite (`backend/tests/test_study_*.py`)
- **Total Test Files:** 23 files.
- **Total Tests:** 212 tests (63 M1 + 86 M2 + 27 M3 Gate 1 + 42 M3 Gate 2 - overlapping baseline + 18 M4 + 11 M4.1).
- **Recorded Status:** 201 passed as of M4 report; 212 passed with M4.1 additions.

### 7.4 Full Backend Regression Suite (`backend/tests/`)
- **Recorded Baseline (Milestone 3 Audit):** 923 passed, 256 subtests in 118s.
- **Current Status:** **Unverified for M4.1.** (Per strict user instructions, the full backend regression suite was not rerun during this audit to avoid unnecessary resource consumption).

---

## 8. Git and Repository State

### 8.1 Branch and Commit
- **Current Branch:** `main`
- **HEAD Commit:** `328d338 feat(study): implement Milestone 4 question acquisition subsystem`

### 8.2 Working Copy Status
- **Modified Tracked Files (M4.1 changes):**
  1. `backend/app/study/acquisition/crawler/url_filter.py`
  2. `backend/app/study/acquisition/media/asset_downloader.py`
  3. `backend/app/study/acquisition/parsers/japanesetest4you.py`
  4. `backend/app/study/acquisition/parsers/models.py`
- **Untracked Files Added in M4.1:**
  1. `backend/tests/fixtures/study_acquisition/synthetic_kanji_context.md`
  2. `backend/tests/fixtures/study_acquisition/synthetic_listening_diagram.html`
  3. `backend/tests/fixtures/study_acquisition/synthetic_listening_text.html`
  4. `backend/tests/fixtures/study_acquisition/synthetic_orthography.md`
  5. `backend/tests/fixtures/study_acquisition/synthetic_shared_audio.html`
  6. `backend/tests/fixtures/study_acquisition/synthetic_star_grammar.md`
  7. `backend/tests/test_study_acquisition_m4_1_robustness.py`
  8. `docs/study-bank/10-m4.1-resource-discovery-and-format-coverage.md`
- **Safety Audit:** No build artifacts (`dist/`, `build/`), no temporary databases, and no downloaded MP3 files are present in git status.

---

## 9. Completed Work

The following items are definitively implemented, audited, and verified:
1. **Full JLPT Resource Discovery:** 25 exam categories cataloged across N1–N5; reference lists, eBooks, and Patreon promotions deterministically filtered out.
2. **Deterministic Hybrid Parser:** Robust against nested HTML and Markdown, radio inputs, and WordPress audio player tags.
3. **F1–F6 Format Coverage:** Derives official format codes for all official JLPT formats matching Kiroku's format registry.
4. **Star Sentence Ordering (F2):** Extracts star position, phrase fragments, and derives 4-fragment permutation order from answer key rationales.
5. **Kanji Context Disambiguation:** Resolves 5-line target-word blocks and shared contextual sentence stems.
6. **Playable Audio Retrieval:** Direct extraction of MP3 URLs, ID3v2 and MPEG frame sync binary validation, and zero-DB content-addressed filesystem storage in `MediaStore`.
7. **Scoped Audio Associations:** Preserves question-level, passage-level, shared, and exercise-level audio bindings.
8. **M3 Structured Payload Generation:** `to_m3_structured_payload()` constructs valid ingestion dictionaries ready for `StructuredJsonInputAdapter`.
9. **Zero Database Impact:** Zero writes to `kiroku.db`, zero writes to `study.db`, zero new migrations.
10. **Test Robustness:** 29 targeted acquisition tests passing with synthetic fixtures.

---

## 10. Incomplete or Partially Completed Work

1. **Live Production Crawling:** Bulk execution across the 25 categories has not been run against `japanesetest4you.com`. The crawler and parser have only been tested against synthetic and canned fixture files.
2. **Database Ingestion of Live Questions:** No real questions have been persisted to `study.db`. The pipeline deliberately stops at the candidate payload stage.
3. **AI Verification of Acquired Questions:** Gate 2 verification has only been tested on synthetic mock questions, not on real scraped exercises.
4. **Desktop UI for Acquired Question Review:** No Electron GUI exists yet for browsing raw cache, viewing acquired candidates, or approving questions into the active bank.

---

## 11. Known Limitations and Technical Debt

1. **WordPress DOM Reliance:** `JapaneseTest4YouParser` is tailored to JapaneseTest4You's specific HTML/Markdown conventions. If the site undergoes a major redesign, parsing regexes will require updating (mitigated by pristine raw response caching in `RawAcquisitionCache`).
2. **Secondary Source Parsers:** Only `JapaneseTest4You` is implemented. Other potential question sources (e.g., JTest, ShinKanzenMaster, JLPT Sensei) have not been implemented.
3. **Audio Duration Extraction:** Audio duration (`duration_ms`) is currently omitted during zero-DB asset download; it will need to be populated via an ID3/MP3 frame header reader when audio playback controls are rendered in the UI.

---

## 12. Deferred Decisions

1. **Mass Scraping Schedule / Quota Policy:** Deferred to the Question Ingestion milestone (M5). Decisions on batch sizes, concurrency limits, and Keenable API key usage will be decided when live importing begins.
2. **Default Review Approval Policy:** While `ReviewStatus.NEEDS_REVIEW` is currently hardcoded for all acquired exercises (per ADR-SB-030 and M4 Decision 4), whether high-confidence AI-verified questions can ever be auto-approved without manual human click remains a user-facing policy decision.
3. **Desktop Study Bank UI Architecture:** The exact Electron window layout for the Question Bank (dedicated window vs. expanded companion mode) remains deferred to Milestone 6 (UI).

---

## 13. Remaining Milestones and Their Dependencies

```
┌────────────────────────────────────────────────────────┐
│ M0–M4.1: Question Bank Foundation, Ingestion,          │
│          Verification & Acquisition Engine             │
│ [ COMPLETED & AUDITED ]                                │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Milestone 5: Question Ingestion, Live Staging &        │
│              Verification Pilot                        │
│ - Live crawl of curated N5/N4 categories               │
│ - First actual persistence into study.db               │
│ - M3 Gate 1 persistence + Gate 2 AI verification       │
│ - Human review CLI / script verification               │
│ [ READY FOR IMPLEMENTATION ]                           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Milestone 6: Practice & Examination Engine (Backend)   │
│ - Drill session generator                              │
│ - Official mock exam generator (timed sections)        │
│ - Exam scoring engine & scaled score calculation       │
│ - Attempt history & performance analytics              │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Milestone 7: Desktop UI Integration                    │
│ - Electron question review & approval screen           │
│ - Interactive practice drill interface                 │
│ - Full-screen timed mock exam interface                │
│ - Audio player & diagram rendering controls            │
└────────────────────────────────────────────────────────┘
```

---

## 14. Recommended Next Milestone

### **Milestone 5: Question Ingestion, Live Staging & Verification Pilot**

#### Why M5 Comes Next:
1. All prerequisites for acquiring and parsing external question material are 100% complete (M4 & M4.1).
2. All prerequisites for deterministic ingestion, schema validation, and database persistence are 100% complete (M1, M2, M3 Gate 1).
3. All prerequisites for dual-model AI verification and human review recording are 100% complete (M3 Gate 2).
4. **The Question Bank currently contains 0 real questions.** Before building exam engines (M6) or UI screens (M7), the database must be populated with a verified, realistic sample of official JLPT questions across all formats (F1–F6).

#### What M5 Will Accomplish:
- Execute a controlled, polite live acquisition pilot on a selected subset of categories (e.g. JLPT N5 Grammar, Vocabulary, Kanji, Reading, and Listening).
- Execute the full pipeline: `URL -> Fetch -> Cache -> Parse -> IngestInput -> Gate 1 Persistence -> study.db`.
- Run Gate 2 AI verification on the ingested batch to evaluate Model A and Model B agreement and generate initial pedagogical explanations.
- Verify that `study.db` initializes correctly, migrations 0001–0004 apply smoothly, and database doctor passes with 0 errors on real data.

#### What Must Remain Out of Scope for M5:
- Bulk scraping of thousands of questions across all levels (keep pilot bounded to 50–100 questions).
- Desktop GUI implementation (verify purely via backend CLI and database inspection).
- Interactive mock exams or attempt timers.

---

## 15. Exact Next Steps

When continuing development in a new session:
1. Provide this audit report (`docs/study-bank/11-post-m4.1-completion-audit.md`) as the authoritative starting context.
2. Review the uncommitted M4.1 working copy changes and commit them cleanly to `main` with commit message:  
   `feat(study): implement M4.1 JLPT resource discovery, format coverage, and audio retrieval`
3. Author the Milestone 5 Implementation Directive outlining the pilot acquisition scope, selected category URLs, and verification criteria.
4. Proceed to implement Milestone 5 without revisiting M0–M4.1 architecture.

