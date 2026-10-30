# Kiroku Note — JLPT Question Bank: Milestone 3 Gate 1 Deterministic Question Ingestion Pipeline

**Document ID:** `docs/study-bank/05-m3-ingestion-pipeline.md`  
**Milestone:** Milestone 3, Gate 1 (Deterministic Ingestion Pipeline)  
**Date:** 2026-10-30  
**Status:** Completed & Verified  

---

## 1. Executive Summary & Architectural Principle

Milestone 3, Gate 1 establishes the deterministic question ingestion pipeline for Kiroku Note's local-first JLPT Question Bank subsystem (`study.db`).

The ingestion pipeline transforms raw external inputs into fully normalized, validated question candidates conforming to the Milestone 2 Pydantic contracts (families F1–F6) and persists approved candidates into the Milestone 1 relational SQLite database.

### 1.1 Strict Boundary: No AI / LLM Verification in Gate 1
Per architectural requirements:
- **Zero AI / LLM dependencies**: Gate 1 is 100% deterministic, rule-based, and offline.
- No LLM provider integrations, API keys, or placeholder AI services are introduced.
- AI verification, model-based answer cross-checking, and explanation generation are **deliberately deferred** to Gate 2.
- The pipeline architecture maintains clean module boundaries so Gate 2 can inspect validated question candidates without restructuring the deterministic pipeline.

---

## 2. End-to-End Pipeline Stages

The pipeline executes through a sequence of single-responsibility stages:

```text
[Input]
   │
   ▼
[Extraction]       Input Adapters (Pasted Text, JSON, PDF Text, OCR Image, Audio)
   │
   ▼
[Segmentation]     Instruction, Passage, Stem, Choice, and Answer Key Parsing
   │
   ▼
[Classification]   Format Registry (20 formats), Family (F1-F6), Category, Level
   │
   ▼
[Association]      Passage Groups, F4 Blank Anchors, Media/Audio Assets
   │
   ▼
[Normalization]    Conversion to M2 Contracts (AnyQuestionPayload, ContentGroupPayload)
   │
   ▼
[Deterministic     Format compatibility, AST markup syntax, Choice bounds,
 Validation]       Eligibility evaluator (ReasonCode)
   │
   ▼
[Human Review      Status: needs_review vs approved; explicit candidate editing
 & Approval]       and approval
   │
   ▼
[Persistence]      Atomic transaction into study.db: source, import_batch,
                   import_item, question, question_revision, revision_choice,
                   revision_answer, source_answer_claim, sealed revisions
```

---

## 3. Input Adapters (`app.study.ingestion.adapters`)

All input adapters implement `BaseInputAdapter.extract(input_data: IngestInput) -> ExtractedDocument`, producing a uniform intermediate document representation with page tracking and metadata preservation.

| Adapter | Identifier | Input Modalities | Key Behaviors |
|---|---|---|---|
| **Pasted Text** | `pasted_text` | `str`, `bytes` | Strips UTF-8 BOM, normalizes `\r\n` to `\n`, preserves line breaks, supports `=== Page N ===` delimiters, extracts multiple questions. |
| **Structured JSON** | `structured_json` | `str`, `dict`, `list`, `Path` | Validates JSON structure; accepts batch containers (`{"source": ..., "questions": [...], "groups": [...]}`), direct contract arrays, or question objects; rejects malformed syntax. |
| **PDF Text** | `pdf_text` | `bytes`, `Path` | Extracts digital text layer page-by-page via `PyPDF2.PdfReader`; records 1-based page numbers for question traceability; tracks character densities and confidence. |
| **Scanned Image** | `scanned_image` | `bytes`, `Path`, `list[Image]` | Inspects dimensions and formats with Pillow; invokes standalone `OcrService` (manga-ocr); gracefully falls back to metadata capture and review flagging if OCR daemon is offline. |
| **Audio** | `audio` | `bytes`, `Path` (`.mp3`, `.wav`, `.m4a`, etc.) | Detects audio MIME types; registers binary data with content-addressed `MediaStore`; preserves listening transcripts from metadata. |

---

## 4. Segmentation & Pattern Recognition (`app.study.ingestion.segmentation`)

The segmentation stage decomposes document text into `QuestionDraft` and `GroupDraft` candidate objects using deterministic regular expressions and structural heuristics:

1. **Section & Problem Headers**:
   - Detects `問題1`, `問題 2`, `【問題3】`, `第1問`, and associated instruction texts.
2. **Question Delimiters**:
   - Detects `問1`, `1.`, `1 `, `（1）`, `(1)`, `〔1〕`, `Q1`.
3. **Choice Parsing**:
   - Supports four choice layouts:
     - Circled digits: `①`, `②`, `③`, `④`
     - Parenthesized digits: `(1)`..`(4)`, `（１）`..`（４）`
     - Line-by-line numbers: `1.`, `2.`, `3.`, `4.`
     - Inline separated numbers: `1 かわ  2 やま  3 うみ  4 き`
     - Katakana choices: `ア`, `イ`, `ウ`, `エ`
4. **Sentence Composition (F2)**:
   - Detects blanks containing `★`, `☆`, or `{star}`.
5. **Text Grammar Blank Anchors (F4)**:
   - Extracts passage blanks: `[ 25 ]`, `【35】`, `（28）`, `{blank|key}` into passage anchor lists.
6. **Answer Keys**:
   - `AnswerKeyParser` extracts answers from:
     - Inline question declarations: `正解: 2`, `解答: ③`, `答え: 4`
     - Trailing answer key sections: `【正解一覧】\n問1: 2\n問2: 4` or `1-2 2-4`
     - Explicit externally supplied answer key dictionaries.

---

## 5. Classification & Association (`app.study.ingestion.classification`, `association`)

### 5.1 Format Classification
`FormatClassifier` deterministically classifies questions into the 20 official JLPT formats registered in `FORMAT_REGISTRY` across families F1–F6:
- Matches specific Japanese instruction phrases (e.g. `言葉の読み方` -> `kanji_reading`, `文の組み立て` -> `sentence_composition`, `短文読解` -> `comprehension_short`, `即時応答` -> `quick_response`).
- Evaluates structural characteristics when instructions are generic or absent (e.g. `{star}` marker -> `sentence_composition`; passage with blanks -> `text_grammar`).
- Enforces level constraints from `FormatMetadata.allowed_levels` (e.g. `word_formation` restricted to N2 falls back cleanly to `contextual_expressions` for N5).
- Emits confidence scores: 1.0 (exact instruction match), 0.85–0.95 (structural heuristic), or <0.8 (marking candidate for human review).

### 5.2 Relational Association
`AssetAndGroupAssociator`:
- Groups questions occurring under a passage with their parent `GroupDraft`.
- Assigns sequential `group_ordinal` values.
- Cross-validates F4 text grammar blank numbers against passage anchor keys, flagging orphaned anchors with `ReviewReasonCode.ORPHAN_ANCHOR`.
- Associates audio assets with F5 listening questions and F6 audio context groups.

---

## 6. Normalization into M2 Contracts (`app.study.ingestion.normalization`)

`ContractNormalizer` transforms drafts into authoritative Pydantic contract models:
- Validates Japanese inline markup through `app.study.markup.parse_markup` (furigana `[漢字|かんじ]`, underline `{u|...}`, star `{star}`, blanks `{blank|...}`).
- Constructs `ChoicePayload` instances with choice keys, display labels, ordinals, and choice modes (`text`, `image`, `unprinted`).
- Constructs `AnswerPayload` resolving source answer keys to choice keys; sets `answer_origin = "source_explicit"` (or `"source_derived"` for F2).
- For incomplete questions (e.g. missing answer key), sets `answer = None`, preserving incomplete questions as valid candidates while flagging them for review.

---

## 7. Deterministic Validation & Review (`app.study.ingestion.validation`, `review`)

### 7.1 Validation Rules
`DeterministicValidator`:
- Enforces format compatibility via `validate_format_compatibility(format_code, family, level, choice_count)`.
- Validates AST markup syntax across stem and choices.
- Verifies F2 star marker and `fragment_order` permutation `[1, 2, 3, 4]`.
- Verifies F4 anchor key existence and linkage.
- Evaluates question bank eligibility reason codes (`NO_ANSWER`, `REQUIRED_ASSET_MISSING`, `GROUP_INCONSISTENT`, `VALIDATION_FAILED`).

### 7.2 Human Review Service (`ReviewService`)
Provides the backend operational foundation for candidate lifecycle management:
- Status model: `received` -> `extracted` -> `segmented` -> `classified` -> `normalized` -> `validated` -> `needs_review` / `approved` -> `persisted`.
- `filter_candidates()`: filters by review status and reason codes.
- `update_candidate()`: allows manual correction of stems, choices, answer keys, or classifications.
- `approve_candidate()` / `approve_all_valid()`: explicit approval gate before persistence.
- `reject_candidate()`: rejects invalid or unfixable items.

---

## 8. Persistence & Database Integrity (`app.study.ingestion.persistence`)

Persists approved candidates into `study.db` with complete transactional safety:
- **Provenance Ledger**:
  - `source`: records name, type, license, citation.
  - `import_batch`: records batch ID, adapter kind, status, item count.
  - `import_item`: preserves raw JSON payload, extraction confidence, and review status.
  - `question_source` & `group_source`: links questions and groups to the source.
  - `source_answer_claim`: preserves external answer keys and rationale without silent overwrites.
- **Relational Mapping**:
  - Uses `decompose_question_for_db` and `decompose_group_for_db`.
  - Revisions are sealed immediately upon insertion (`sealed_at`).
  - SQLite triggers permanently enforce immutability on sealed revisions.
- **Content Deduplication**:
  - SHA-256 `content_fingerprint` lookup prevents duplicate question or group rows when the same content is re-imported.
- **Transaction Safety**:
  - Executed within `StudyDatabaseManager.write_tx()`. Any failure automatically rolls back the entire batch.

