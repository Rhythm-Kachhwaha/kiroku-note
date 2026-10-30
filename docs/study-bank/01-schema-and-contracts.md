# Kiroku Note — JLPT Question Bank: Schema, Contracts & Format Registry

**Document ID:** `docs/study-bank/01-schema-and-contracts.md`  
**Milestone:** Milestone 0 (Audit & Design)  
**Date:** 2026-10-30  
**Status:** Design Proposal  

---

## 1. Relational Database Schema (`study.db`)

The database is an independent SQLite database located in Kiroku Note's user data directory (`study.db`). It enforces foreign keys (`PRAGMA foreign_keys = ON;`), WAL mode, and engine-level triggers for immutability.

```
+----------------------------------------------------------------------------------------------------+
|                                    Entity-Relationship Overview                                    |
+----------------------------------------------------------------------------------------------------+
|                                                                                                    |
|  [content_group] 1 --- * [group_revision] 1 --- * [group_part]                                     |
|                                 |                                                                  |
|                                 +--- * [group_revision_anchor]                                     |
|                                 |                                                                  |
|                                 +--- * [group_revision_asset] ---> [asset]                         |
|                                 ^                                     ^                            |
|                                 | pinned (optional)                   |                            |
|                                 |                                     |                            |
|  [question] 1 --- * [question_revision] 1 --- * [revision_choice]     |                            |
|                            |    |                                     |                            |
|                            |    +--- * [question_revision_asset] -----+                            |
|                            |                                                                       |
|                            +--- pinned in [attempt_response]                                       |
|                                                                                                    |
|  [test_recipe] 1 --- * [test_attempt] 1 --- * [attempt_section] 1 --- * [attempt_response]         |
|                             |                                                                      |
|                             +--- pinned (question_revision_id, group_revision_id)                  |
|                                                                                                    |
|  [source] 1 --- * [import_batch] 1 --- * [import_item]                                             |
|                         |                                                                          |
|                         +--- * [question_source] / [group_source]                                  |
|                                                                                                    |
|  [source_answer_claim] ---> [question_revision]                                                    |
|  [duplicate_candidate] ---> [question] / [content_group]                                           |
+----------------------------------------------------------------------------------------------------+
```

### 1.1 Core Entities & Immutable Revisions

```sql
-- -----------------------------------------------------------------------------
-- 1. Content Groups (Passages, Audio Contexts, Document Sets)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_group (
    id TEXT PRIMARY KEY,                       -- UUID / ULID
    group_type TEXT NOT NULL,                 -- 'passage', 'integrated_passage', 'audio_context', 'document_set'
    jlpt_level TEXT NOT NULL,                 -- 'N1'..'N5'
    title TEXT NOT NULL DEFAULT '',
    current_revision_id TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS group_revision (
    id TEXT PRIMARY KEY,                       -- UUID / ULID
    group_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL,
    layout_type TEXT NOT NULL DEFAULT 'standard', -- 'standard', 'side_by_side_ab', 'advertisement', 'table'
    content_fingerprint TEXT NOT NULL,        -- SHA-256 of normalized parts & anchors
    change_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(group_id) REFERENCES content_group(id) ON DELETE RESTRICT,
    UNIQUE(group_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_group_revision_fingerprint ON group_revision(content_fingerprint);

-- Immutable ordered components of a group revision (e.g. Passage A, Passage B, or image + text)
CREATE TABLE IF NOT EXISTS group_part (
    id TEXT PRIMARY KEY,
    group_revision_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    part_type TEXT NOT NULL,                  -- 'text', 'heading', 'dialogue_script', 'table', 'image_reference'
    title TEXT NOT NULL DEFAULT '',
    body_markup TEXT NOT NULL,               -- AST-compliant inline markup
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(group_revision_id) REFERENCES group_revision(id) ON DELETE RESTRICT,
    UNIQUE(group_revision_id, ordinal)
);

-- Named reference anchors for text grammar (e.g. Blank 35, Blank 36)
CREATE TABLE IF NOT EXISTS group_revision_anchor (
    id TEXT PRIMARY KEY,
    group_revision_id TEXT NOT NULL,
    anchor_key TEXT NOT NULL,                 -- e.g. 'blank_35', 'anchor_1'
    display_label TEXT NOT NULL,              -- e.g. '35'
    part_id TEXT NOT NULL,                    -- reference to group_part(id)
    char_offset INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(group_revision_id) REFERENCES group_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY(part_id) REFERENCES group_part(id) ON DELETE RESTRICT,
    UNIQUE(group_revision_id, anchor_key)
);

-- -----------------------------------------------------------------------------
-- 2. Questions & Immutable Revisions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question (
    id TEXT PRIMARY KEY,                       -- UUID / ULID
    jlpt_level TEXT NOT NULL,                 -- 'N1'..'N5'
    category TEXT NOT NULL,                   -- 'vocabulary', 'grammar', 'reading', 'listening'
    format_code TEXT NOT NULL,                -- e.g. 'N1_KANJI_READING', 'N2_SENTENCE_ORDER'
    structural_family TEXT NOT NULL,          -- 'F1', 'F2', 'F3', 'F4', 'F5', 'F6'
    content_group_id TEXT DEFAULT NULL,       -- NULL for standalone F1/F2/F5; FK for F3/F4/F6
    status TEXT NOT NULL DEFAULT 'draft',     -- 'draft', 'in_review', 'active', 'retired'
    current_revision_id TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(content_group_id) REFERENCES content_group(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_question_lookup ON question(jlpt_level, category, format_code, status);

CREATE TABLE IF NOT EXISTS question_revision (
    id TEXT PRIMARY KEY,                       -- UUID / ULID
    question_id TEXT NOT NULL,
    revision_number INTEGER NOT NULL,
    pinned_group_revision_id TEXT DEFAULT NULL, -- Must match content_group's revision if group exists
    anchor_key TEXT DEFAULT NULL,             -- Required for F4 Text Grammar (must match group_revision_anchor)
    prompt_markup TEXT NOT NULL,              -- Question stem markup
    instruction_text TEXT NOT NULL DEFAULT '', -- Section instructions if overridden
    explanation_markup TEXT NOT NULL DEFAULT '',
    grammar_concept_id TEXT DEFAULT NULL,     -- Optional reference to Kiroku grammar index concept_id
    vocabulary_reference TEXT DEFAULT NULL,   -- Optional reference to Kiroku vocab
    content_fingerprint TEXT NOT NULL,        -- SHA-256 of prompt + normalized choices
    validation_status TEXT NOT NULL DEFAULT 'valid', -- 'valid', 'invalid', 'warning'
    validation_errors TEXT NOT NULL DEFAULT '[]',   -- JSON array of validation issues
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY(pinned_group_revision_id) REFERENCES group_revision(id) ON DELETE RESTRICT,
    UNIQUE(question_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_question_revision_fingerprint ON question_revision(content_fingerprint);

-- Immutable relational choice rows
CREATE TABLE IF NOT EXISTS revision_choice (
    id TEXT PRIMARY KEY,                       -- UUID / ULID
    question_revision_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,                 -- 1, 2, 3, 4
    display_label TEXT NOT NULL,              -- '1', '2', '3', '4' (or 'ア', 'イ', etc.)
    text_markup TEXT NOT NULL,                -- Choice text markup
    is_correct INTEGER NOT NULL DEFAULT 0,    -- 0 or 1
    answer_origin TEXT NOT NULL DEFAULT 'source_explicit', -- 'source_explicit', 'source_derived', 'user_entered', 'generated_unverified'
    fragment_order_position INTEGER DEFAULT NULL,          -- For F2: 1..4 representing position in full sentence
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(question_revision_id) REFERENCES question_revision(id) ON DELETE RESTRICT,
    UNIQUE(question_revision_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_revision_choice_question ON revision_choice(question_revision_id, is_correct);
```

### 1.2 Binary Assets & Content-Addressed Media

```sql
-- -----------------------------------------------------------------------------
-- 3. Content-Addressed Assets (Audio, Images, Diagrams)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS asset (
    id TEXT PRIMARY KEY,                       -- 'sha256_<hex>'
    sha256_hash TEXT NOT NULL UNIQUE,
    media_type TEXT NOT NULL,                 -- 'audio', 'image'
    mime_type TEXT NOT NULL,                  -- 'audio/mpeg', 'audio/webm', 'image/png', 'image/jpeg', etc.
    file_size_bytes INTEGER NOT NULL,
    relative_path TEXT NOT NULL,              -- relative to study_media directory
    duration_ms INTEGER DEFAULT NULL,         -- For audio
    pixel_width INTEGER DEFAULT NULL,         -- For images
    pixel_height INTEGER DEFAULT NULL,
    is_available INTEGER NOT NULL DEFAULT 1,  -- Verified present on disk
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS question_revision_asset (
    question_revision_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    role TEXT NOT NULL,                       -- 'listening_audio', 'prompt_image', 'choice_image', 'diagram'
    ordinal INTEGER NOT NULL DEFAULT 1,
    is_required INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(question_revision_id, asset_id, role),
    FOREIGN KEY(question_revision_id) REFERENCES question_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY(asset_id) REFERENCES asset(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS group_revision_asset (
    group_revision_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    role TEXT NOT NULL,                       -- 'shared_dialogue_audio', 'shared_reading_diagram', 'passage_illustration'
    ordinal INTEGER NOT NULL DEFAULT 1,
    is_required INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY(group_revision_id, asset_id, role),
    FOREIGN KEY(group_revision_id) REFERENCES group_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY(asset_id) REFERENCES asset(id) ON DELETE RESTRICT
);
```

### 1.3 Provenance, Sources & Conflict Tracking

```sql
-- -----------------------------------------------------------------------------
-- 4. Ingestion Sources & Provenance
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source (
    id TEXT PRIMARY KEY,                       -- UUID / ULID
    name TEXT NOT NULL,                       -- e.g. 'Official Sample 2018', 'User Custom PDF'
    source_type TEXT NOT NULL,                -- 'official_sample', 'licensed_textbook', 'user_capture', 'synthetic_fixture'
    license_or_permission TEXT NOT NULL DEFAULT '',
    citation TEXT NOT NULL DEFAULT '',
    url TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS import_batch (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    adapter_name TEXT NOT NULL,               -- 'json_fixture', 'plain_text', 'pdf_text', 'page_capture', 'ocr'
    status TEXT NOT NULL DEFAULT 'completed', -- 'in_progress', 'completed', 'reverted', 'failed'
    item_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(source_id) REFERENCES source(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS import_item (
    id TEXT PRIMARY KEY,
    import_batch_id TEXT NOT NULL,
    raw_payload_json TEXT NOT NULL,
    parsed_question_id TEXT DEFAULT NULL,
    parsed_group_id TEXT DEFAULT NULL,
    extraction_confidence REAL NOT NULL DEFAULT 1.0,
    review_status TEXT NOT NULL DEFAULT 'approved', -- 'pending_review', 'approved', 'rejected'
    error_message TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(import_batch_id) REFERENCES import_batch(id) ON DELETE RESTRICT,
    FOREIGN KEY(parsed_question_id) REFERENCES question(id) ON DELETE SET NULL,
    FOREIGN KEY(parsed_group_id) REFERENCES content_group(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS question_source (
    question_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    external_item_id TEXT DEFAULT NULL,       -- Question # or ID in original source
    PRIMARY KEY(question_id, source_id),
    FOREIGN KEY(question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY(source_id) REFERENCES source(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS group_source (
    content_group_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    external_group_id TEXT DEFAULT NULL,
    PRIMARY KEY(content_group_id, source_id),
    FOREIGN KEY(content_group_id) REFERENCES content_group(id) ON DELETE RESTRICT,
    FOREIGN KEY(source_id) REFERENCES source(id) ON DELETE RESTRICT
);

-- Tracks conflicting answer claims from different external sources without silent overwrites
CREATE TABLE IF NOT EXISTS source_answer_claim (
    id TEXT PRIMARY KEY,
    question_revision_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    claimed_correct_ordinal INTEGER NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    is_conflicted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(question_revision_id) REFERENCES question_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY(source_id) REFERENCES source(id) ON DELETE RESTRICT
);

-- Near-duplicate detection log for human review (never automatically merged)
CREATE TABLE IF NOT EXISTS duplicate_candidate (
    id TEXT PRIMARY KEY,
    existing_entity_type TEXT NOT NULL,       -- 'question', 'content_group'
    existing_entity_id TEXT NOT NULL,
    candidate_entity_id TEXT NOT NULL,
    similarity_score REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'confirmed_distinct', 'merged_alias'
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

### 1.4 Exam Profiles, Recipes & Historical Attempt Pinning

```sql
-- -----------------------------------------------------------------------------
-- 5. Exam Profiles, Recipes, and Historical Attempts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_profile (
    id TEXT PRIMARY KEY,                       -- e.g. 'N1_OFFICIAL_PROFILE', 'N5_OFFICIAL_PROFILE'
    jlpt_level TEXT NOT NULL,                 -- 'N1'..'N5'
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    is_official INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS exam_section (
    id TEXT PRIMARY KEY,                       -- e.g. 'N1_SEC_KNOWLEDGE_READING'
    exam_profile_id TEXT NOT NULL,
    section_index INTEGER NOT NULL,           -- 1, 2, 3
    section_name TEXT NOT NULL,               -- 'Language Knowledge (Vocabulary/Grammar) & Reading'
    time_limit_minutes INTEGER NOT NULL,      -- Timed blocks: e.g. 110, 55
    scoring_category TEXT NOT NULL,           -- 'language_knowledge_and_reading', 'listening'
    allows_review INTEGER NOT NULL DEFAULT 1, -- 0 for Listening (cannot return to previous)
    audio_play_policy TEXT NOT NULL DEFAULT 'none', -- 'none', 'once_strictly', 'repeatable_in_drill'
    FOREIGN KEY(exam_profile_id) REFERENCES exam_profile(id) ON DELETE RESTRICT,
    UNIQUE(exam_profile_id, section_index)
);

CREATE TABLE IF NOT EXISTS test_recipe (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mode TEXT NOT NULL,                       -- 'drill', 'mock_exam', 'custom_practice'
    exam_profile_id TEXT DEFAULT NULL,        -- FK to exam_profile if based on official exam
    recipe_config_json TEXT NOT NULL,         -- JSON object specifying filters, quotas, distribution
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(exam_profile_id) REFERENCES exam_profile(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS test_attempt (
    id TEXT PRIMARY KEY,                       -- UUID / ULID
    test_recipe_id TEXT NOT NULL,
    mode TEXT NOT NULL,                       -- 'drill', 'mock_exam'
    exam_profile_id TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress', -- 'in_progress', 'paused', 'completed', 'expired', 'abandoned'
    seed INTEGER NOT NULL,                    -- Random seed for reproducible generation
    total_score REAL DEFAULT NULL,
    total_questions INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at TEXT DEFAULT NULL,
    total_elapsed_ms INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(test_recipe_id) REFERENCES test_recipe(id) ON DELETE RESTRICT,
    FOREIGN KEY(exam_profile_id) REFERENCES exam_profile(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS attempt_section (
    id TEXT PRIMARY KEY,
    test_attempt_id TEXT NOT NULL,
    exam_section_id TEXT DEFAULT NULL,
    section_index INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress', -- 'pending', 'in_progress', 'locked', 'completed'
    started_at TEXT DEFAULT NULL,
    completed_at TEXT DEFAULT NULL,
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    time_limit_seconds INTEGER DEFAULT NULL,
    FOREIGN KEY(test_attempt_id) REFERENCES test_attempt(id) ON DELETE RESTRICT,
    FOREIGN KEY(exam_section_id) REFERENCES exam_section(id) ON DELETE RESTRICT,
    UNIQUE(test_attempt_id, section_index)
);

-- Crucial: response pins EXACT question revision and group revision
CREATE TABLE IF NOT EXISTS attempt_response (
    id TEXT PRIMARY KEY,
    attempt_section_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    question_id TEXT NOT NULL,
    pinned_question_revision_id TEXT NOT NULL,
    pinned_group_revision_id TEXT DEFAULT NULL,
    selected_choice_id TEXT DEFAULT NULL,     -- FK to revision_choice(id)
    is_correct INTEGER DEFAULT NULL,          -- 1 = correct, 0 = incorrect, NULL = unanswered
    score REAL NOT NULL DEFAULT 0.0,
    time_spent_ms INTEGER NOT NULL DEFAULT 0,
    answered_at TEXT DEFAULT NULL,
    grader_type TEXT NOT NULL DEFAULT 'single_choice',
    FOREIGN KEY(attempt_section_id) REFERENCES attempt_section(id) ON DELETE RESTRICT,
    FOREIGN KEY(question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY(pinned_question_revision_id) REFERENCES question_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY(pinned_group_revision_id) REFERENCES group_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY(selected_choice_id) REFERENCES revision_choice(id) ON DELETE RESTRICT,
    UNIQUE(attempt_section_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_attempt_response_history 
ON attempt_response(question_id, is_correct, answered_at);
```

### 1.5 Immutability Triggers

To prevent accidental modification or tampering of immutable historical revisions:

```sql
-- Prevent updates or deletes on revision records
CREATE TRIGGER IF NOT EXISTS trg_prevent_group_revision_update
BEFORE UPDATE ON group_revision
BEGIN
    SELECT RAISE(ABORT, 'group_revision records are immutable and cannot be updated.');
END;

CREATE TRIGGER IF NOT EXISTS trg_prevent_group_revision_delete
BEFORE DELETE ON group_revision
BEGIN
    SELECT RAISE(ABORT, 'group_revision records are immutable and cannot be deleted.');
END;

CREATE TRIGGER IF NOT EXISTS trg_prevent_group_part_update
BEFORE UPDATE ON group_part
BEGIN
    SELECT RAISE(ABORT, 'group_part records are immutable and cannot be updated.');
END;

CREATE TRIGGER IF NOT EXISTS trg_prevent_group_part_delete
BEFORE DELETE ON group_part
BEGIN
    SELECT RAISE(ABORT, 'group_part records are immutable and cannot be deleted.');
END;

CREATE TRIGGER IF NOT EXISTS trg_prevent_question_revision_update
BEFORE UPDATE ON question_revision
BEGIN
    SELECT RAISE(ABORT, 'question_revision records are immutable and cannot be updated.');
END;

CREATE TRIGGER IF NOT EXISTS trg_prevent_question_revision_delete
BEFORE DELETE ON question_revision
BEGIN
    SELECT RAISE(ABORT, 'question_revision records are immutable and cannot be deleted.');
END;

CREATE TRIGGER IF NOT EXISTS trg_prevent_revision_choice_update
BEFORE UPDATE ON revision_choice
BEGIN
    SELECT RAISE(ABORT, 'revision_choice records are immutable and cannot be updated.');
END;

CREATE TRIGGER IF NOT EXISTS trg_prevent_revision_choice_delete
BEFORE DELETE ON revision_choice
BEGIN
    SELECT RAISE(ABORT, 'revision_choice records are immutable and cannot be deleted.');
END;
```

---

## 2. Dynamic Eligibility Model

Questions are never tagged with an arbitrary, mutable `gradeable` boolean. Instead, question eligibility is computed dynamically using a two-tier evaluation strategy:
1. **Database SQL View (`v_eligible_question_revisions`)**: Fast candidate pre-filtering.
2. **Python Evaluation Function (`evaluate_question_eligibility()`)**: Deterministic check returning an explicit list of reason codes.

### 2.1 SQL Pre-filter View

```sql
CREATE VIEW IF NOT EXISTS v_eligible_question_revisions AS
SELECT 
    qr.id AS question_revision_id,
    q.id AS question_id,
    q.jlpt_level,
    q.category,
    q.format_code,
    q.structural_family,
    q.status AS question_status,
    qr.validation_status,
    (SELECT COUNT(*) FROM revision_choice rc WHERE rc.question_revision_id = qr.id AND rc.is_correct = 1) AS correct_choice_count,
    (SELECT COUNT(*) FROM revision_choice rc WHERE rc.question_revision_id = qr.id) AS total_choice_count,
    (SELECT COUNT(*) FROM question_revision_asset qra 
     JOIN asset a ON qra.asset_id = a.id 
     WHERE qra.question_revision_id = qr.id AND qra.is_required = 1 AND a.is_available = 0) AS missing_required_q_assets,
    (SELECT COUNT(*) FROM group_revision_asset gra 
     JOIN asset a ON gra.asset_id = a.id 
     WHERE gra.group_revision_id = qr.pinned_group_revision_id AND gra.is_required = 1 AND a.is_available = 0) AS missing_required_g_assets
FROM question_revision qr
JOIN question q ON qr.question_id = q.id;
```

### 2.2 Stable Reason Codes

| Reason Code | Condition |
|---|---|
| `RETIRED` | `question.status == 'retired'` |
| `VALIDATION_FAILED` | `question_revision.validation_status != 'valid'` |
| `NEEDS_REVIEW` | `question.status in ('draft', 'in_review')` or pending conflicting answer claims |
| `NO_ANSWER` | `correct_choice_count == 0` |
| `GRADER_UNIMPLEMENTED` | Grader associated with `format_code` has no verified implementation |
| `REQUIRED_ASSET_MISSING` | Any required audio or image asset has `is_available == 0` or is missing from disk |
| `GROUP_INCONSISTENT` | Referenced group revision does not exist, or required anchor key is absent |

---

## 3. Inline Markup Grammar & AST Specification

To guarantee safety, avoid raw executable HTML injection, and provide precise linguistic rendering, all prompt stems, choices, and passages use a strict markup DSL.

### 3.1 DSL Grammar Rules

1. **Ruby / Furigana**: `[漢字|かんじ]` -> renders `<ruby>漢字<rt>かんじ</rt></ruby>`
2. **Underline**: `{u|下線部テキスト}` -> renders underlined target text
3. **Blank Anchor**: `{blank|35}` or `{blank|anchor_key}` -> renders numbered fill-in-the-blank target
4. **Star Target**: `{star}` -> renders the star `★` position in F2 sentence ordering

### 3.2 AST Node Models (Pydantic)

```python
from pydantic import BaseModel
from typing import Literal, Union, List

class TextNode(BaseModel):
    type: Literal["text"] = "text"
    content: str

class RubyNode(BaseModel):
    type: Literal["ruby"] = "ruby"
    kanji: str
    reading: str

class UnderlineNode(BaseModel):
    type: Literal["underline"] = "underline"
    children: List[Union["TextNode", "RubyNode"]]

class BlankNode(BaseModel):
    type: Literal["blank"] = "blank"
    anchor_key: str

class StarNode(BaseModel):
    type: Literal["star"] = "star"

ASTNode = Union[TextNode, RubyNode, UnderlineNode, BlankNode, StarNode]

class InlineMarkupAST(BaseModel):
    raw_markup: str
    nodes: List[ASTNode]
```

---

## 4. The Six Structural Question Families (F1–F6)

All JLPT formats map cleanly into six structural families:

```
+------------------------------------------------------------------------------------------------------+
| Family | Name                                    | Group Type      | Choices | Special Semantics     |
|--------|-----------------------------------------|-----------------|---------|-----------------------|
| **F1** | Inline-target multiple choice           | None            | 4       | Underline or blank    |
| **F2** | Sentence ordering                       | None            | 4       | Star pos, full order  |
| **F3** | Passage-based questions                 | Passage         | 4       | Shared text context   |
| **F4** | Text grammar                            | Passage         | 4       | Numbered blanks       |
| **F5** | Individual audio questions              | None (or audio) | 3 or 4  | Audio asset, prompt   |
| **F6** | Shared audio groups                     | Audio group     | 3 or 4  | Multi-Q audio context |
+------------------------------------------------------------------------------------------------------+
```

### 4.1 Family Contracts & Validation Rules

#### Family F1: Inline-target Multiple Choice
- **Formats**: Kanji Reading, Orthography, Word Formation, Contextual Vocab, Paraphrases, Usage, Grammar Form Selection.
- **Constraints**:
  - Exactly 4 choices (or configurable range 3–4).
  - Exactly 1 choice marked `is_correct = 1`.
  - Content group must be `None`.
  - Prompt stem must contain either an underline `{u|...}` or a fill-in blank `{blank|...}` (except for vocabulary usage where the word is in the instruction).

#### Family F2: Sentence Ordering
- **Formats**: Sentence Grammar 2 (文の組み立て / Sentence Composition).
- **Constraints**:
  - Prompt stem must contain `{star}` indicating the target position.
  - Exactly 4 choices representing the four sentence fragments.
  - Exactly one correct full ordering permutation (e.g. `[3, 1, 4, 2]`) specified via `fragment_order_position` on choices.
  - The official answer (choice at the `{star}` position) is automatically derived: `derived_star_choice_id`.
  - If a source explicitly claims a different answer than the derived star choice, a validation error / conflict is flagged.

#### Family F3: Passage-based Questions
- **Formats**: Short, Medium, Long Passages, Integrated A/B Comprehension, Thematic Comprehension, Information Retrieval.
- **Constraints**:
  - `content_group_id` and `pinned_group_revision_id` are required.
  - The content group must contain one or more `group_part` records (`text`, `heading`, `table`, etc.).
  - Exactly 1 correct choice per question.

#### Family F4: Text Grammar
- **Formats**: Sentence Grammar 3 / Text Grammar (文章の文法).
- **Constraints**:
  - `content_group_id` and `pinned_group_revision_id` are required.
  - `anchor_key` is required on `question_revision`.
  - `anchor_key` must exist in `group_revision_anchor` for that group revision.
  - Every anchor in the group must have an associated question; no orphaned anchors.

#### Family F5: Individual Audio Questions
- **Formats**: Task-based, Key-point, General Outline, Verbal Expressions, Quick Response.
- **Constraints**:
  - At least 1 required audio asset linked via `question_revision_asset`.
  - Choices count: 3 (common for Verbal Expression / Quick Response) or 4 (Task-based / Key-point).
  - Unprinted choices supported: `text_markup` can be empty if choices are spoken only on audio.
  - Optional visual illustration prompt supported via `prompt_image` asset.

#### Family F6: Shared Audio Groups
- **Formats**: Integrated Comprehension Listening (統合理解).
- **Constraints**:
  - `content_group_id` is required and points to an `audio_context` group with a shared audio asset.
  - Multiple questions link to the same group.
  - Optional printed task materials or reference tables attached to the group revision.

---

## 5. Synthetic Contract Examples (All 6 Families)

### 5.1 Family F1 (Kanji Reading — Valid & Invalid)

#### Valid F1 Example
```json
{
  "question_id": "q_f1_001",
  "jlpt_level": "N5",
  "category": "vocabulary",
  "format_code": "N5_KANJI_READING",
  "structural_family": "F1",
  "prompt_markup": "あの{u|[山|やま]}は　たかいです。",
  "instruction_text": "___のことばは　どう　かきますか。",
  "choices": [
    { "ordinal": 1, "display_label": "1", "text_markup": "かわ", "is_correct": 0 },
    { "ordinal": 2, "display_label": "2", "text_markup": "やま", "is_correct": 1, "answer_origin": "source_explicit" },
    { "ordinal": 3, "display_label": "3", "text_markup": "うみ", "is_correct": 0 },
    { "ordinal": 4, "display_label": "4", "text_markup": "き", "is_correct": 0 }
  ]
}
```

#### Invalid F1 Example (Multiple correct answers + missing underline target)
```json
{
  "question_id": "q_f1_invalid",
  "jlpt_level": "N5",
  "category": "vocabulary",
  "format_code": "N5_KANJI_READING",
  "structural_family": "F1",
  "prompt_markup": "あの山はたかいです。",
  "choices": [
    { "ordinal": 1, "display_label": "1", "text_markup": "かわ", "is_correct": 1 },
    { "ordinal": 2, "display_label": "2", "text_markup": "やま", "is_correct": 1 },
    { "ordinal": 3, "display_label": "3", "text_markup": "うみ", "is_correct": 0 }
  ]
}
```
*Expected Validation Rejections*:
1. `F1_TARGET_MISSING`: Prompt does not contain underline or blank markup.
2. `CHOICE_COUNT_INVALID`: Expected 4 choices, found 3.
3. `MULTIPLE_CORRECT_ANSWERS`: Choices 1 and 2 are both marked correct.

---

### 5.2 Family F2 (Sentence Ordering — Valid & Invalid)

#### Valid F2 Example
```json
{
  "question_id": "q_f2_001",
  "jlpt_level": "N3",
  "category": "grammar",
  "format_code": "N3_SENTENCE_ORDER",
  "structural_family": "F2",
  "prompt_markup": "きのうは　びょういんへ　__　__　{star}　__　いけませんでした。",
  "instruction_text": "★に入るものはどれですか。",
  "choices": [
    { "ordinal": 1, "display_label": "1", "text_markup": "いった", "fragment_order_position": 2, "is_correct": 0 },
    { "ordinal": 2, "display_label": "2", "text_markup": "ものの", "fragment_order_position": 3, "is_correct": 1, "answer_origin": "source_derived" },
    { "ordinal": 3, "display_label": "3", "text_markup": "くすりを", "fragment_order_position": 4, "is_correct": 0 },
    { "ordinal": 4, "display_label": "4", "text_markup": "もらいに", "fragment_order_position": 1, "is_correct": 0 }
  ]
}
```
*Derived Sentence*: `もらいに (4)` + `いった (1)` + `ものの (2)` + `くすりを (3)`.  
*Derived Star Position (3rd)*: Choice 2 (`ものの`) is at position 3, automatically deriving `is_correct = 1`.

#### Invalid F2 Example (Duplicate fragment positions & missing star)
```json
{
  "question_id": "q_f2_invalid",
  "jlpt_level": "N3",
  "category": "grammar",
  "format_code": "N3_SENTENCE_ORDER",
  "structural_family": "F2",
  "prompt_markup": "きのうは びょういんへ ____ いけませんでした。",
  "choices": [
    { "ordinal": 1, "display_label": "1", "text_markup": "いった", "fragment_order_position": 1, "is_correct": 0 },
    { "ordinal": 2, "display_label": "2", "text_markup": "ものの", "fragment_order_position": 1, "is_correct": 0 },
    { "ordinal": 3, "display_label": "3", "text_markup": "くすりを", "fragment_order_position": 2, "is_correct": 0 },
    { "ordinal": 4, "display_label": "4", "text_markup": "もらいに", "fragment_order_position": 4, "is_correct": 0 }
  ]
}
```
*Expected Validation Rejections*:
1. `F2_STAR_MISSING`: Prompt markup lacks `{star}` marker.
2. `INVALID_PERMUTATION`: `fragment_order_position` contains duplicate position `1` and missing position `3`.

---

### 5.3 Family F3 (Passage-based Questions — Valid)

```json
{
  "content_group": {
    "group_id": "grp_f3_001",
    "jlpt_level": "N2",
    "group_type": "passage",
    "title": "環境問題とリサイクルに関する考察",
    "parts": [
      {
        "ordinal": 1,
        "part_type": "text",
        "body_markup": "現代社会において、資源の再利用は不可欠な課題となっている。しかし、リサイクル過程自体が消費するエネルギーの総量を考慮しなければ、真の環境負荷低減とは言えないだろう..."
      }
    ]
  },
  "question": {
    "question_id": "q_f3_001",
    "jlpt_level": "N2",
    "category": "reading",
    "format_code": "N2_READING_SHORT",
    "structural_family": "F3",
    "prompt_markup": "筆者が最も主張したいことは何か。",
    "choices": [
      { "ordinal": 1, "display_label": "1", "text_markup": "リサイクルの費用を削減すべきだ。", "is_correct": 0 },
      { "ordinal": 2, "display_label": "2", "text_markup": "リサイクルに必要な全エネルギーを視野に入れて評価すべきだ。", "is_correct": 1 },
      { "ordinal": 3, "display_label": "3", "text_markup": "リサイクル技術の導入を中止すべきだ。", "is_correct": 0 },
      { "ordinal": 4, "display_label": "4", "text_markup": "消費者の分別努力だけで十分である。", "is_correct": 0 }
    ]
  }
}
```

---

### 5.4 Family F4 (Text Grammar — Valid & Invalid)

#### Valid F4 Example
```json
{
  "content_group": {
    "group_id": "grp_f4_001",
    "jlpt_level": "N1",
    "group_type": "passage",
    "title": "科学と社会の接点",
    "parts": [
      {
        "ordinal": 1,
        "part_type": "text",
        "body_markup": "科学技術の発展は我々の生活を豊かにしてきたが、それと同時に予期せぬリスクももたらした。この課題にどう向き合うべきか、今まさに議論が {blank|blank_35}。"
      }
    ],
    "anchors": [
      { "anchor_key": "blank_35", "display_label": "35", "part_ordinal": 1 }
    ]
  },
  "question": {
    "question_id": "q_f4_001",
    "jlpt_level": "N1",
    "category": "grammar",
    "format_code": "N1_TEXT_GRAMMAR",
    "structural_family": "F4",
    "anchor_key": "blank_35",
    "prompt_markup": "【 35 】に入る最も適当なものはどれか。",
    "choices": [
      { "ordinal": 1, "display_label": "1", "text_markup": "求められつつある", "is_correct": 1 },
      { "ordinal": 2, "display_label": "2", "text_markup": "求められるべきではない", "is_correct": 0 },
      { "ordinal": 3, "display_label": "3", "text_markup": "求めたきりである", "is_correct": 0 },
      { "ordinal": 4, "display_label": "4", "text_markup": "求めるまでもない", "is_correct": 0 }
    ]
  }
}
```

#### Invalid F4 Example (Dangling anchor key)
```json
{
  "question": {
    "question_id": "q_f4_invalid",
    "jlpt_level": "N1",
    "category": "grammar",
    "format_code": "N1_TEXT_GRAMMAR",
    "structural_family": "F4",
    "anchor_key": "blank_99",
    "prompt_markup": "【 99 】に入るものはどれか。",
    "choices": [
      { "ordinal": 1, "display_label": "1", "text_markup": "選択肢A", "is_correct": 1 },
      { "ordinal": 2, "display_label": "2", "text_markup": "選択肢B", "is_correct": 0 },
      { "ordinal": 3, "display_label": "3", "text_markup": "選択肢C", "is_correct": 0 },
      { "ordinal": 4, "display_label": "4", "text_markup": "選択肢D", "is_correct": 0 }
    ]
  }
}
```
*Expected Validation Rejections*:
1. `ANCHOR_NOT_FOUND`: Referenced `anchor_key: 'blank_99'` does not exist in the linked content group.

---

### 5.5 Family F5 (Individual Audio — Valid)

```json
{
  "question_id": "q_f5_001",
  "jlpt_level": "N4",
  "category": "listening",
  "format_code": "N4_LISTENING_TASK",
  "structural_family": "F5",
  "prompt_markup": "女の人はこれから何をしますか。",
  "required_assets": [
    {
      "role": "listening_audio",
      "mime_type": "audio/webm",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "relative_path": "audio/n4_task_001.webm"
    }
  ],
  "choices": [
    { "ordinal": 1, "display_label": "1", "text_markup": "部屋を掃除する", "is_correct": 0 },
    { "ordinal": 2, "display_label": "2", "text_markup": "先生に電話をかける", "is_correct": 1 },
    { "ordinal": 3, "display_label": "3", "text_markup": "買い物に行く", "is_correct": 0 },
    { "ordinal": 4, "display_label": "4", "text_markup": "本を返す", "is_correct": 0 }
  ]
}
```

---

### 5.6 Family F6 (Shared Audio Group — Valid)

```json
{
  "content_group": {
    "group_id": "grp_f6_001",
    "jlpt_level": "N1",
    "group_type": "audio_context",
    "title": "ラジオ番組での商品比較ディスカッション",
    "assets": [
      {
        "role": "shared_dialogue_audio",
        "mime_type": "audio/webm",
        "sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
        "relative_path": "audio/n1_shared_dialogue_001.webm"
      }
    ]
  },
  "questions": [
    {
      "question_id": "q_f6_001",
      "jlpt_level": "N1",
      "category": "listening",
      "format_code": "N1_LISTENING_INTEGRATED_Q1",
      "structural_family": "F6",
      "prompt_markup": "質問1: 男の人はどの製品を選ぶと言っていますか。",
      "choices": [
        { "ordinal": 1, "display_label": "1", "text_markup": "製品A", "is_correct": 0 },
        { "ordinal": 2, "display_label": "2", "text_markup": "製品B", "is_correct": 1 },
        { "ordinal": 3, "display_label": "3", "text_markup": "製品C", "is_correct": 0 },
        { "ordinal": 4, "display_label": "4", "text_markup": "製品D", "is_correct": 0 }
      ]
    },
    {
      "question_id": "q_f6_002",
      "jlpt_level": "N1",
      "category": "listening",
      "format_code": "N1_LISTENING_INTEGRATED_Q2",
      "structural_family": "F6",
      "prompt_markup": "質問2: 女の人はなぜその製品を選びましたか。",
      "choices": [
        { "ordinal": 1, "display_label": "1", "text_markup": "価格が最も安かったから", "is_correct": 0 },
        { "ordinal": 2, "display_label": "2", "text_markup": "デザインと携帯性を重視したから", "is_correct": 1 },
        { "ordinal": 3, "display_label": "3", "text_markup": "店員に強く勧められたから", "is_correct": 0 },
        { "ordinal": 4, "display_label": "4", "text_markup": "以前使っていたから", "is_correct": 0 }
      ]
    }
  ]
}
```

---

## 6. Official JLPT Examination Profiles & Timings

Official JLPT test administration separates **Timed Test Sections** from **Scoring Sections**:

```
+----------------------------------------------------------------------------------------------------------------------+
| Level | Section 1 (Time)                     | Section 2 (Time)                   | Section 3 (Time) | Total Test    |
|-------|--------------------------------------|------------------------------------|------------------|---------------|
| **N1**| Language Knowledge & Reading (110m)  | Listening (55m)                    | —                | 165 minutes   |
| **N2**| Language Knowledge & Reading (105m)  | Listening (50m)                    | —                | 155 minutes   |
| **N3**| Language Knowledge (Vocab) (30m)     | Grammar & Reading (70m)            | Listening (40m)  | 140 minutes   |
| **N4**| Language Knowledge (Vocab) (25m)     | Grammar & Reading (55m)            | Listening (35m)  | 115 minutes   |
| **N5**| Language Knowledge (Vocab) (20m)     | Grammar & Reading (40m)            | Listening (30m)  | 90 minutes    |
+----------------------------------------------------------------------------------------------------------------------+
```
*(Verified against JEES / Japan Foundation official test revisions).*

### 6.1 Section Execution Rules

1. **Strict Timers**: Each section has an independent countdown timer based on an injected clock service (`ClockService.now()`).
2. **Section Locking**: When a section's timer expires, `attempt_section.status` transitions to `locked`. Responses within that section can no longer be updated.
3. **Listening Policy (`audio_play_policy`)**:
   - `mock_exam`: Listening audio plays once strictly. No replay or seeking is permitted. Going back to previous questions is disabled.
   - `drill`: Audio can be paused, replayed, and scrubbed freely.
4. **Historical Pinning**: All attempts snapshot exact question revision IDs and group revision IDs so future question edits never alter historical test results.

