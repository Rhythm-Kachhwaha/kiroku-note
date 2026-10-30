# Kiroku Note — JLPT Question Bank: Milestone 2 Implementation Review & Contracts Specification

**Document ID:** `docs/study-bank/04-m2-contracts-review.md`  
**Milestone:** Milestone 2 (Question Family Contracts & Markup Parser)  
**Date:** 2026-10-30  
**Status:** Completed & Verified  

---

## 1. Executive Summary

Milestone 2 delivers the complete question data-contract layer, authoritative format registry, and deterministic Japanese inline markup parser for Kiroku Note's JLPT Question Bank subsystem.

All components adhere strictly to the boundaries established in `AGENTS.md` and the Milestone 1 database foundation:
- Zero new database migrations (the Milestone 1 relational schema cleanly supports all contracts).
- Fully validated against the 20 official JLPT formats across the six structural families (F1–F6).
- Choice mode orthogonality (`text`, `image`, `unprinted`), distinguishing unprinted choices from accidental empty text.
- AST-based parsing with position-aware syntax errors and HTML injection prevention.
- Clean database decomposition: relational columns/tables store relational entities (`question`, `question_revision`, `revision_choice`, `revision_answer`, `question_revision_asset`), while `payload_json` stores family-specific non-relational parameters.

---

## 2. Implemented Subsystems & Module Structure

```text
backend/app/study/
  formats.py                  # Authoritative format registry (all 20 formats, categories, levels, bounds)
  contracts/
    __init__.py               # Re-exports all contract classes, enums, and mapping functions
    enums.py                  # JlptLevel, QuestionCategory, StructuralFamily, ChoiceMode, AnswerOrigin, etc.
    common.py                 # ChoicePayload, AnswerPayload, AssetRefPayload, ContentGroupPayload, etc.
    families.py               # F1QuestionPayload through F6QuestionPayload + AnyQuestionPayload union
    db_mapping.py             # decompose_question_for_db, recompose_question_from_db, fingerprinting
  markup/
    __init__.py               # Re-exports AST nodes, parser, serializer, and validators
    ast.py                    # Pydantic AST: TextNode, RubyNode, UnderlineNode, BlankNode, StarNode, MarkupAST
    errors.py                 # MarkupError, MarkupSyntaxError (line, column, offset, snippet), MarkupValidationError
    parser.py                 # Deterministic recursive-descent parser with HTML injection protection
    serializer.py             # to_markup (canonical roundtrip), to_plain_text, to_reading_text, to_safe_html
    validator.py              # extract_anchors, has_star, has_underline, has_blank, validate_group_anchors
```

---

## 3. Format Registry & Compatibility (`app.study.formats`)

`FORMAT_REGISTRY` centrally maps all 20 official JLPT format codes to their structural family, category, grader type, choice bounds, and allowed JLPT levels, guaranteeing 100% agreement with `0002_seed_formats_and_exams.sql`:

| Format Code | Structural Family | Category | Grader Type | Choices (Min–Max) | Supported Levels |
|---|---|---|---|---|---|
| `kanji_reading` | F1 | vocabulary | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `orthography` | F1 | vocabulary | single_choice | 4–4 | N2, N3, N4, N5 |
| `word_formation` | F1 | vocabulary | single_choice | 4–4 | N2 only |
| `contextual_expressions` | F1 | vocabulary | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `paraphrases` | F1 | vocabulary | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `usage` | F1 | vocabulary | single_choice | 4–4 | N1, N2, N3, N4 |
| `sentential_grammar_1` | F1 | grammar | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `sentence_composition` | F2 | grammar | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `comprehension_short` | F3 | reading | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `comprehension_mid` | F3 | reading | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `comprehension_long` | F3 | reading | single_choice | 4–4 | N1, N3 |
| `integrated_thematic_reading` | F3 | reading | single_choice | 4–4 | N1, N2 |
| `information_retrieval` | F3 | reading | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `text_grammar` | F4 | grammar | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `task_based_listening` | F5 | listening | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `key_points_listening` | F5 | listening | single_choice | 4–4 | N1, N2, N3, N4, N5 |
| `general_outline_listening` | F5 | listening | single_choice | 4–4 | N1, N2, N3 |
| `verbal_expressions` | F5 | listening | single_choice | 3–4 | N3, N4, N5 |
| `quick_response` | F5 | listening | single_choice | 3–3 | N1, N2, N3, N4, N5 |
| `listening_integrated` | F6 | listening | single_choice | 4–4 | N1, N2 |

Compatibility function:
`validate_format_compatibility(format_code, family, level, choice_count)` raises typed errors (`FormatFamilyMismatchError`, `FormatLevelMismatchError`, `InvalidChoiceCountError`, `FormatNotFoundError`).

---

## 4. Question Family Contracts (F1–F6)

All models inherit from `BaseQuestionPayload` and participate in the `AnyQuestionPayload` discriminated union (`Field(discriminator="structural_family")`).

### 4.1 F1 — Inline-target MCQ
- Formats: Kanji Reading, Orthography, Word Formation, Contextual Expressions, Paraphrases, Usage, Sentential Grammar 1.
- Validates prompt stem contains `{u|...}` or `{blank|...}` (except for `usage`, where the target vocabulary word is in the instruction).
- Reconciles `answer` against `choices`. Ensures exactly one choice is marked correct.

### 4.2 F2 — Sentence Composition (Ordering)
- Format: `sentence_composition` (N1–N5).
- Exactly 4 choices representing the four sentence fragments.
- Validates prompt stem contains exactly one `{star}` marker.
- Permutation validation: `fragment_order` must be a strict permutation of `[1, 2, 3, 4]`.
- Star answer derivation: Identifies choice at `star_position` (default 3) and automatically derives `derived_star_choice_key`. Flags an error if an explicit source answer contradicts the derived star answer.
- Supports optional `strict_whole_order_grading: bool`.

### 4.3 F3 — Reading Passage Groups
- Formats: Short, Mid, Long, Integrated A/B Comprehension, Information Retrieval.
- Links to a shared `ContentGroupPayload` (`passage` or `document_set`) via `content_group_id` / `group_ordinal` without duplicating passage text in the question revision.

### 4.4 F4 — Text Grammar
- Format: `text_grammar` (N1–N5).
- Requires `anchor_key` (e.g. `blank_35`) referencing an anchor defined in the linked passage revision.
- Cross-validated via `validate_group_anchors` ensuring no duplicate or orphaned blanks exist in the passage.

### 4.5 F5 — Individual Audio Questions
- Formats: Task-based, Key Points, General Outline, Verbal Expressions, Quick Response.
- Requires audio asset reference (`audio_asset`).
- Choice mode support:
  - `text`: Standard printed text choices.
  - `image`: Diagram or illustration choices.
  - `unprinted`: Spoken choices for listening exams (e.g. Quick Response with exactly 3 unprinted choices).
- Optional `transcript_markup` for teacher/review inspection.

### 4.6 F6 — Shared Audio Groups
- Format: `listening_integrated` (N1 and N2 only).
- Multiple questions reference a single `audio_context` group with shared audio.
- Questions do not duplicate the audio asset.

---

## 5. Inline Markup DSL & Deterministic Parser (`app.study.markup`)

### 5.1 Grammar Elements
1. **Ruby / Furigana**: `[漢字|かんじ]` -> `RubyNode(base="漢字", reading="かんじ")`
2. **Underline**: `{u|下線部}` -> `UnderlineNode(children=[...])` (supports nested text and ruby)
3. **Blank Anchor**: `{blank|key}` -> `BlankNode(key="key")`
4. **Star Target**: `{star}` -> `StarNode()`
5. **Plain Japanese Text**: Verbatim text preserving whitespace, punctuation, full-width characters.
6. **Escaping**: Backslash escaping supported for delimiters (`\{`, `\}`, `\[`, `\]`, `\|`, `\\`).

### 5.2 Deterministic Error Handling & Safety
- **Position-Aware Syntax Errors**: `MarkupSyntaxError` reports 1-based line, 1-based column, 0-based offset, and a 30-character contextual snippet.
- **HTML Injection Rejection**: Arbitrary HTML tags (`<script>`, `<div>`, `<ruby>`, etc.) are explicitly rejected at parse time to prevent injection attacks without requiring an HTML rendering engine.
- **Delimiters & Structures**:
  - Unclosed brackets/braces abort with exact positions.
  - Ruby annotations require both non-empty base text and non-empty reading separated by a single pipe.
  - Underline tags cannot be empty or contain nested braces.
  - Blanks require a non-empty anchor key.

### 5.3 Serialization
- `to_markup()`: Canonical DSL serialization guaranteeing `to_markup(parse_markup(s)) == s`.
- `to_plain_text()`: Strips ruby furigana, renders blanks as `（ key ）` and stars as `★`.
- `to_reading_text()`: Replaces ruby base text with reading for phonetic search.
- `to_safe_html()`: Sanitized HTML fragment with `<ruby>`, `<rt>`, and scoped CSS classes.

---

## 6. Database Compatibility Matrix

The contracts decompose directly into the Milestone 1 schema without schema adjustments:

| Contract Entity / Field | SQLite Destination Table & Column | Notes |
|---|---|---|
| `question_id`, `external_id` | `question(id, external_id)` | Integer PK with optional ULID external ID |
| `format_code`, `level`, `category`, `status` | `question(format_code, level, category, status)` | Relational columns with composite FKs |
| `content_group_id`, `group_ordinal`, `anchor_key` | `question(content_group_id, group_ordinal, anchor_key)` | Relational group and anchor links |
| `stem_markup` | `question_revision(stem_markup)` | Stored verbatim |
| `content_fingerprint` | `question_revision(content_fingerprint)` | SHA-256 of normalized stem + choices + payload |
| `validation_status` | `question_revision(validation_status)` | `'valid'`, `'needs_review'`, `'invalid'` |
| `instruction_text`, `explanation_markup`, `metadata` | `question_revision(payload_json)` | Structured family JSON payload |
| F2 `star_position`, `fragment_order`, `derived_star_choice_key` | `question_revision(payload_json)` | Stored in JSON (not separate column) |
| F5/F6 `transcript_markup` | `question_revision(payload_json)` | Stored in JSON |
| `ChoicePayload(choice_key, label, ordinal, text_markup, asset_id)` | `revision_choice(...)` | Dedicated relational table with stable choice keys |
| `AnswerPayload(choice_key, answer_origin, rationale_markup)` | `revision_answer(choice_id, answer_origin, rationale_markup)` | Resolves `choice_key` to `choice_id` FK |
| `AssetRefPayload(role, asset_id, ordinal, is_required)` | `question_revision_asset(...)` | Relational join table |

---

## 7. Milestone 2 Sign-Off

All Milestone 2 requirements have been fully satisfied:
1. Pydantic contracts for all six question families (F1–F6) implemented and verified.
2. Centralized format registry with strict family, category, choice-count, and level compatibility.
3. Choice modes (`text`, `image`, `unprinted`) fully validated.
4. Deterministic markup parser and AST implemented with position-aware syntax errors and HTML rejection.
5. Clean database decomposition and round-trip integration verified with Milestone 1 SQLite tables.
6. Documentation and `AGENTS.md` updated.
7. Implementation stopped strictly at Milestone 2 boundaries.

