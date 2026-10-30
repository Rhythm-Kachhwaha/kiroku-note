-- =============================================================================
-- Migration 0001: Initial Relational Schema for Kiroku Study Database
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Format Registry & Supported Levels
-- -----------------------------------------------------------------------------
CREATE TABLE format (
    code TEXT PRIMARY KEY,
    structural_family TEXT NOT NULL CHECK(structural_family IN ('F1', 'F2', 'F3', 'F4', 'F5', 'F6')),
    category TEXT NOT NULL CHECK(category IN ('vocabulary', 'grammar', 'reading', 'listening')),
    grader_type TEXT DEFAULT NULL,
    min_choices INTEGER DEFAULT NULL,
    max_choices INTEGER DEFAULT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE format_level (
    format_code TEXT NOT NULL,
    level TEXT NOT NULL CHECK(level IN ('N1', 'N2', 'N3', 'N4', 'N5')),
    PRIMARY KEY (format_code, level),
    FOREIGN KEY (format_code) REFERENCES format(code) ON DELETE RESTRICT
) STRICT;

-- -----------------------------------------------------------------------------
-- 2. Assets (Content-Addressed Media)
-- -----------------------------------------------------------------------------
CREATE TABLE asset (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sha256 TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK(kind IN ('audio', 'illustration', 'diagram', 'document', 'choice_image')),
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK(byte_size > 0),
    relative_path TEXT NOT NULL,
    duration_ms INTEGER DEFAULT NULL,
    pixel_width INTEGER DEFAULT NULL,
    pixel_height INTEGER DEFAULT NULL,
    original_url TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'present' CHECK(status IN ('present', 'missing')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (length(sha256) = 64),
    CHECK (relative_path NOT LIKE '/%' AND relative_path NOT LIKE '\%' AND relative_path NOT LIKE '%..%')
) STRICT;

CREATE INDEX idx_asset_sha256 ON asset(sha256);
CREATE INDEX idx_asset_status ON asset(status);

-- -----------------------------------------------------------------------------
-- 3. Content Groups & Revisions
-- -----------------------------------------------------------------------------
CREATE TABLE content_group (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('passage', 'integrated_passage', 'audio_context', 'document_set')),
    level TEXT NOT NULL CHECK(level IN ('N1', 'N2', 'N3', 'N4', 'N5')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'retired')),
    current_revision_id INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE (id, level)
) STRICT;

CREATE INDEX idx_content_group_level_status ON content_group(level, status);

CREATE TABLE group_revision (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    revision_number INTEGER NOT NULL,
    content_fingerprint TEXT NOT NULL,
    sealed_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (group_id) REFERENCES content_group(id) ON DELETE RESTRICT,
    UNIQUE (group_id, revision_number),
    UNIQUE (id, group_id)
) STRICT;

CREATE INDEX idx_group_revision_fingerprint ON group_revision(content_fingerprint);

CREATE TABLE group_revision_part (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_revision_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('text', 'heading', 'dialogue_script', 'table', 'image_reference')),
    markup TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (group_revision_id) REFERENCES group_revision(id) ON DELETE RESTRICT,
    UNIQUE (id, group_revision_id),
    UNIQUE (group_revision_id, ordinal)
) STRICT;

CREATE TABLE group_revision_anchor (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_revision_id INTEGER NOT NULL,
    part_id INTEGER NOT NULL,
    anchor_key TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (group_revision_id) REFERENCES group_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY (part_id, group_revision_id) REFERENCES group_revision_part(id, group_revision_id) ON DELETE RESTRICT,
    UNIQUE (group_revision_id, anchor_key),
    UNIQUE (group_revision_id, ordinal)
) STRICT;

CREATE TABLE group_revision_asset (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_revision_id INTEGER NOT NULL,
    asset_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('audio', 'illustration', 'diagram', 'document', 'choice_image')),
    ordinal INTEGER NOT NULL DEFAULT 1,
    is_required INTEGER NOT NULL DEFAULT 1 CHECK(is_required IN (0, 1)),
    part_id INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (group_revision_id) REFERENCES group_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY (asset_id) REFERENCES asset(id) ON DELETE RESTRICT,
    FOREIGN KEY (part_id, group_revision_id) REFERENCES group_revision_part(id, group_revision_id) ON DELETE RESTRICT,
    UNIQUE (group_revision_id, asset_id, role)
) STRICT;

-- -----------------------------------------------------------------------------
-- 4. Questions & Revisions
-- -----------------------------------------------------------------------------
CREATE TABLE question (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE NOT NULL,
    format_code TEXT NOT NULL,
    level TEXT NOT NULL CHECK(level IN ('N1', 'N2', 'N3', 'N4', 'N5')),
    category TEXT NOT NULL CHECK(category IN ('vocabulary', 'grammar', 'reading', 'listening')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'in_review', 'active', 'retired')),
    content_group_id INTEGER DEFAULT NULL,
    group_ordinal INTEGER DEFAULT NULL,
    anchor_key TEXT DEFAULT NULL,
    current_revision_id INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (format_code, level) REFERENCES format_level(format_code, level) ON DELETE RESTRICT,
    FOREIGN KEY (content_group_id, level) REFERENCES content_group(id, level) ON DELETE RESTRICT,
    UNIQUE (content_group_id, group_ordinal),
    UNIQUE (id, format_code),
    UNIQUE (id, current_revision_id),
    CHECK (content_group_id IS NOT NULL OR (group_ordinal IS NULL AND anchor_key IS NULL)),
    CHECK (content_group_id IS NULL OR group_ordinal IS NOT NULL)
) STRICT;

CREATE INDEX idx_question_lookup ON question(level, category, format_code, status);

CREATE TABLE question_revision (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    format_code TEXT NOT NULL,
    revision_number INTEGER NOT NULL,
    stem_markup TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    validation_status TEXT NOT NULL DEFAULT 'valid' CHECK(validation_status IN ('valid', 'needs_review', 'invalid')),
    content_fingerprint TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    sealed_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (json_valid(payload_json)),
    FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY (question_id, format_code) REFERENCES question(id, format_code) ON DELETE RESTRICT,
    UNIQUE (question_id, revision_number),
    UNIQUE (id, question_id)
) STRICT;

CREATE INDEX idx_question_revision_fingerprint ON question_revision(content_fingerprint);

-- -----------------------------------------------------------------------------
-- 5. Choices & Canonical Answers
-- -----------------------------------------------------------------------------
CREATE TABLE revision_choice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_revision_id INTEGER NOT NULL,
    choice_key TEXT NOT NULL,
    label TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    text_markup TEXT DEFAULT NULL,
    asset_id INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (text_markup IS NOT NULL OR asset_id IS NOT NULL),
    FOREIGN KEY (question_revision_id) REFERENCES question_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY (asset_id) REFERENCES asset(id) ON DELETE RESTRICT,
    UNIQUE (id, question_revision_id),
    UNIQUE (question_revision_id, choice_key),
    UNIQUE (question_revision_id, ordinal)
) STRICT;

CREATE TABLE revision_answer (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_revision_id INTEGER NOT NULL UNIQUE,
    choice_id INTEGER NOT NULL,
    answer_origin TEXT NOT NULL CHECK(answer_origin IN ('source_explicit', 'source_derived', 'user_entered', 'generated_unverified')),
    rationale_markup TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (question_revision_id) REFERENCES question_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY (choice_id, question_revision_id) REFERENCES revision_choice(id, question_revision_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE question_revision_asset (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_revision_id INTEGER NOT NULL,
    asset_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('audio', 'illustration', 'diagram', 'document', 'choice_image')),
    ordinal INTEGER NOT NULL DEFAULT 1,
    is_required INTEGER NOT NULL DEFAULT 1 CHECK(is_required IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (question_revision_id) REFERENCES question_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY (asset_id) REFERENCES asset(id) ON DELETE RESTRICT,
    UNIQUE (question_revision_id, asset_id, role)
) STRICT;

-- -----------------------------------------------------------------------------
-- 6. Provenance & Conflict Preservation
-- -----------------------------------------------------------------------------
CREATE TABLE source (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    license_or_permission TEXT NOT NULL DEFAULT '',
    citation TEXT NOT NULL DEFAULT '',
    url TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE import_batch (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    adapter_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    item_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (source_id) REFERENCES source(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE import_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_batch_id INTEGER NOT NULL,
    raw_payload_json TEXT NOT NULL,
    parsed_question_id INTEGER DEFAULT NULL,
    parsed_group_id INTEGER DEFAULT NULL,
    extraction_confidence REAL NOT NULL DEFAULT 1.0,
    review_status TEXT NOT NULL DEFAULT 'approved',
    error_message TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (import_batch_id) REFERENCES import_batch(id) ON DELETE RESTRICT,
    FOREIGN KEY (parsed_question_id) REFERENCES question(id) ON DELETE SET NULL,
    FOREIGN KEY (parsed_group_id) REFERENCES content_group(id) ON DELETE SET NULL
) STRICT;

CREATE TABLE group_source (
    content_group_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL,
    external_group_ref TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (content_group_id, source_id),
    FOREIGN KEY (content_group_id) REFERENCES content_group(id) ON DELETE RESTRICT,
    FOREIGN KEY (source_id) REFERENCES source(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE question_source (
    question_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL,
    external_question_ref TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (question_id, source_id),
    FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY (source_id) REFERENCES source(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE source_answer_claim (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_revision_id INTEGER NOT NULL,
    source_id INTEGER NOT NULL,
    choice_id INTEGER DEFAULT NULL,
    source_label TEXT DEFAULT NULL,
    source_text TEXT DEFAULT NULL,
    answer_origin TEXT NOT NULL DEFAULT 'source_explicit' CHECK(answer_origin IN ('source_explicit', 'source_derived', 'user_entered', 'generated_unverified')),
    rationale TEXT NOT NULL DEFAULT '',
    is_conflict INTEGER NOT NULL DEFAULT 0 CHECK(is_conflict IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (question_revision_id) REFERENCES question_revision(id) ON DELETE RESTRICT,
    FOREIGN KEY (source_id) REFERENCES source(id) ON DELETE RESTRICT,
    FOREIGN KEY (choice_id, question_revision_id) REFERENCES revision_choice(id, question_revision_id) ON DELETE RESTRICT
) STRICT;

-- -----------------------------------------------------------------------------
-- 7. Practice Persistence Foundation
-- -----------------------------------------------------------------------------
CREATE TABLE test_attempt (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress', 'completed', 'abandoned')),
    recipe_snapshot_json TEXT DEFAULT NULL,
    seed INTEGER NOT NULL,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at TEXT DEFAULT NULL,
    total_elapsed_ms INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE attempt_item (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    pinned_question_revision_id INTEGER NOT NULL,
    group_id INTEGER DEFAULT NULL,
    pinned_group_revision_id INTEGER DEFAULT NULL,
    anchor_key TEXT DEFAULT NULL,
    group_position INTEGER DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (attempt_id) REFERENCES test_attempt(id) ON DELETE RESTRICT,
    FOREIGN KEY (question_id) REFERENCES question(id) ON DELETE RESTRICT,
    FOREIGN KEY (group_id) REFERENCES content_group(id) ON DELETE RESTRICT,
    FOREIGN KEY (pinned_question_revision_id, question_id) REFERENCES question_revision(id, question_id) ON DELETE RESTRICT,
    FOREIGN KEY (pinned_group_revision_id, group_id) REFERENCES group_revision(id, group_id) ON DELETE RESTRICT,
    UNIQUE (attempt_id, position),
    UNIQUE (id, pinned_question_revision_id)
) STRICT;

CREATE TABLE attempt_item_choice_order (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_item_id INTEGER NOT NULL,
    choice_id INTEGER NOT NULL,
    display_position INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (attempt_item_id) REFERENCES attempt_item(id) ON DELETE RESTRICT,
    FOREIGN KEY (choice_id) REFERENCES revision_choice(id) ON DELETE RESTRICT,
    UNIQUE (attempt_item_id, display_position),
    UNIQUE (attempt_item_id, choice_id)
) STRICT;

CREATE TABLE response (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_item_id INTEGER NOT NULL,
    selected_choice_id INTEGER DEFAULT NULL,
    pinned_question_revision_id INTEGER NOT NULL,
    time_spent_ms INTEGER NOT NULL DEFAULT 0,
    answered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (attempt_item_id) REFERENCES attempt_item(id) ON DELETE RESTRICT,
    FOREIGN KEY (selected_choice_id, pinned_question_revision_id) REFERENCES revision_choice(id, question_revision_id) ON DELETE RESTRICT
) STRICT;

-- -----------------------------------------------------------------------------
-- 8. Exam Configuration Schema
-- -----------------------------------------------------------------------------
CREATE TABLE exam_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL UNIQUE CHECK(level IN ('N1', 'N2', 'N3', 'N4', 'N5')),
    version INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE exam_section_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_profile_id INTEGER NOT NULL,
    block_order INTEGER NOT NULL,
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    time_limit_minutes INTEGER NOT NULL,
    audio_policy TEXT NOT NULL CHECK(audio_policy IN ('none', 'once_strictly', 'repeatable_in_drill')),
    lock_on_end INTEGER NOT NULL DEFAULT 1 CHECK(lock_on_end IN (0, 1)),
    break_duration_minutes INTEGER DEFAULT NULL,
    verify_counts INTEGER NOT NULL DEFAULT 0 CHECK(verify_counts IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (exam_profile_id) REFERENCES exam_profile(id) ON DELETE RESTRICT,
    UNIQUE (exam_profile_id, block_order),
    UNIQUE (exam_profile_id, code)
) STRICT;

CREATE TABLE exam_block_category (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_config_id INTEGER NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('vocabulary', 'grammar', 'reading', 'listening')),
    FOREIGN KEY (section_config_id) REFERENCES exam_section_config(id) ON DELETE RESTRICT,
    UNIQUE (section_config_id, category)
) STRICT;

CREATE TABLE scoring_section_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exam_profile_id INTEGER NOT NULL,
    section_order INTEGER NOT NULL,
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    max_score INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (exam_profile_id) REFERENCES exam_profile(id) ON DELETE RESTRICT,
    UNIQUE (exam_profile_id, section_order),
    UNIQUE (exam_profile_id, code)
) STRICT;

CREATE TABLE scoring_section_category (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scoring_section_id INTEGER NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('vocabulary', 'grammar', 'reading', 'listening')),
    FOREIGN KEY (scoring_section_id) REFERENCES scoring_section_config(id) ON DELETE RESTRICT,
    UNIQUE (scoring_section_id, category)
) STRICT;

-- -----------------------------------------------------------------------------
-- 9. Engine-Level Immutability & Validation Triggers
-- -----------------------------------------------------------------------------

-- group_revision: No delete, update only sealed_at: NULL -> value
CREATE TRIGGER trg_group_revision_no_delete
BEFORE DELETE ON group_revision
BEGIN
    SELECT RAISE(ABORT, 'group_revision records are immutable and cannot be deleted.');
END;

CREATE TRIGGER trg_group_revision_update
BEFORE UPDATE ON group_revision
BEGIN
    SELECT CASE
        WHEN OLD.sealed_at IS NOT NULL THEN
            RAISE(ABORT, 'Sealed group_revision records are immutable and cannot be updated.')
        WHEN NEW.sealed_at IS NULL THEN
            RAISE(ABORT, 'Only sealed_at transition from NULL is permitted on group_revision.')
        WHEN OLD.id != NEW.id OR OLD.group_id != NEW.group_id OR OLD.revision_number != NEW.revision_number OR OLD.content_fingerprint != NEW.content_fingerprint OR OLD.created_at != NEW.created_at THEN
            RAISE(ABORT, 'Only sealed_at transition from NULL is permitted on group_revision.')
    END;
END;

-- question_revision: No delete, update only sealed_at: NULL -> value
CREATE TRIGGER trg_question_revision_no_delete
BEFORE DELETE ON question_revision
BEGIN
    SELECT RAISE(ABORT, 'question_revision records are immutable and cannot be deleted.');
END;

CREATE TRIGGER trg_question_revision_update
BEFORE UPDATE ON question_revision
BEGIN
    SELECT CASE
        WHEN OLD.sealed_at IS NOT NULL THEN
            RAISE(ABORT, 'Sealed question_revision records are immutable and cannot be updated.')
        WHEN NEW.sealed_at IS NULL THEN
            RAISE(ABORT, 'Only sealed_at transition from NULL is permitted on question_revision.')
        WHEN OLD.id != NEW.id OR OLD.question_id != NEW.question_id OR OLD.format_code != NEW.format_code OR OLD.revision_number != NEW.revision_number OR OLD.stem_markup != NEW.stem_markup OR OLD.payload_json != NEW.payload_json OR OLD.validation_status != NEW.validation_status OR OLD.content_fingerprint != NEW.content_fingerprint OR OLD.schema_version != NEW.schema_version OR OLD.created_at != NEW.created_at THEN
            RAISE(ABORT, 'Only sealed_at transition from NULL is permitted on question_revision.')
    END;
END;

-- revision_choice: Immutable, no insert after parent sealed
CREATE TRIGGER trg_revision_choice_no_update
BEFORE UPDATE ON revision_choice
BEGIN
    SELECT RAISE(ABORT, 'revision_choice records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_revision_choice_no_delete
BEFORE DELETE ON revision_choice
BEGIN
    SELECT RAISE(ABORT, 'revision_choice records are immutable and cannot be deleted.');
END;

CREATE TRIGGER trg_revision_choice_insert_sealed
BEFORE INSERT ON revision_choice
BEGIN
    SELECT CASE
        WHEN (SELECT sealed_at FROM question_revision WHERE id = NEW.question_revision_id) IS NOT NULL THEN
            RAISE(ABORT, 'Cannot insert revision_choice into a sealed question_revision.')
    END;
END;

-- revision_answer: Immutable, no insert after parent sealed
CREATE TRIGGER trg_revision_answer_no_update
BEFORE UPDATE ON revision_answer
BEGIN
    SELECT RAISE(ABORT, 'revision_answer records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_revision_answer_no_delete
BEFORE DELETE ON revision_answer
BEGIN
    SELECT RAISE(ABORT, 'revision_answer records are immutable and cannot be deleted.');
END;

CREATE TRIGGER trg_revision_answer_insert_sealed
BEFORE INSERT ON revision_answer
BEGIN
    SELECT CASE
        WHEN (SELECT sealed_at FROM question_revision WHERE id = NEW.question_revision_id) IS NOT NULL THEN
            RAISE(ABORT, 'Cannot insert revision_answer into a sealed question_revision.')
    END;
END;

-- question_revision_asset: Immutable, no insert after parent sealed
CREATE TRIGGER trg_question_revision_asset_no_update
BEFORE UPDATE ON question_revision_asset
BEGIN
    SELECT RAISE(ABORT, 'question_revision_asset records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_question_revision_asset_no_delete
BEFORE DELETE ON question_revision_asset
BEGIN
    SELECT RAISE(ABORT, 'question_revision_asset records are immutable and cannot be deleted.');
END;

CREATE TRIGGER trg_question_revision_asset_insert_sealed
BEFORE INSERT ON question_revision_asset
BEGIN
    SELECT CASE
        WHEN (SELECT sealed_at FROM question_revision WHERE id = NEW.question_revision_id) IS NOT NULL THEN
            RAISE(ABORT, 'Cannot insert question_revision_asset into a sealed question_revision.')
    END;
END;

-- group_revision_part: Immutable, no insert after parent sealed
CREATE TRIGGER trg_group_revision_part_no_update
BEFORE UPDATE ON group_revision_part
BEGIN
    SELECT RAISE(ABORT, 'group_revision_part records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_group_revision_part_no_delete
BEFORE DELETE ON group_revision_part
BEGIN
    SELECT RAISE(ABORT, 'group_revision_part records are immutable and cannot be deleted.');
END;

CREATE TRIGGER trg_group_revision_part_insert_sealed
BEFORE INSERT ON group_revision_part
BEGIN
    SELECT CASE
        WHEN (SELECT sealed_at FROM group_revision WHERE id = NEW.group_revision_id) IS NOT NULL THEN
            RAISE(ABORT, 'Cannot insert group_revision_part into a sealed group_revision.')
    END;
END;

-- group_revision_anchor: Immutable, no insert after parent sealed
CREATE TRIGGER trg_group_revision_anchor_no_update
BEFORE UPDATE ON group_revision_anchor
BEGIN
    SELECT RAISE(ABORT, 'group_revision_anchor records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_group_revision_anchor_no_delete
BEFORE DELETE ON group_revision_anchor
BEGIN
    SELECT RAISE(ABORT, 'group_revision_anchor records are immutable and cannot be deleted.');
END;

CREATE TRIGGER trg_group_revision_anchor_insert_sealed
BEFORE INSERT ON group_revision_anchor
BEGIN
    SELECT CASE
        WHEN (SELECT sealed_at FROM group_revision WHERE id = NEW.group_revision_id) IS NOT NULL THEN
            RAISE(ABORT, 'Cannot insert group_revision_anchor into a sealed group_revision.')
    END;
END;

-- group_revision_asset: Immutable, no insert after parent sealed
CREATE TRIGGER trg_group_revision_asset_no_update
BEFORE UPDATE ON group_revision_asset
BEGIN
    SELECT RAISE(ABORT, 'group_revision_asset records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_group_revision_asset_no_delete
BEFORE DELETE ON group_revision_asset
BEGIN
    SELECT RAISE(ABORT, 'group_revision_asset records are immutable and cannot be deleted.');
END;

CREATE TRIGGER trg_group_revision_asset_insert_sealed
BEFORE INSERT ON group_revision_asset
BEGIN
    SELECT CASE
        WHEN (SELECT sealed_at FROM group_revision WHERE id = NEW.group_revision_id) IS NOT NULL THEN
            RAISE(ABORT, 'Cannot insert group_revision_asset into a sealed group_revision.')
    END;
END;

-- source_answer_claim: Immutable
CREATE TRIGGER trg_source_answer_claim_no_update
BEFORE UPDATE ON source_answer_claim
BEGIN
    SELECT RAISE(ABORT, 'source_answer_claim records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_source_answer_claim_no_delete
BEFORE DELETE ON source_answer_claim
BEGIN
    SELECT RAISE(ABORT, 'source_answer_claim records are immutable and cannot be deleted.');
END;

-- attempt_item: Immutable
CREATE TRIGGER trg_attempt_item_no_update
BEFORE UPDATE ON attempt_item
BEGIN
    SELECT RAISE(ABORT, 'attempt_item records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_attempt_item_no_delete
BEFORE DELETE ON attempt_item
BEGIN
    SELECT RAISE(ABORT, 'attempt_item records are immutable and cannot be deleted.');
END;

-- attempt_item_choice_order: Immutable
CREATE TRIGGER trg_attempt_item_choice_order_no_update
BEFORE UPDATE ON attempt_item_choice_order
BEGIN
    SELECT RAISE(ABORT, 'attempt_item_choice_order records are immutable and cannot be updated.');
END;

CREATE TRIGGER trg_attempt_item_choice_order_no_delete
BEFORE DELETE ON attempt_item_choice_order
BEGIN
    SELECT RAISE(ABORT, 'attempt_item_choice_order records are immutable and cannot be deleted.');
END;

-- question: Immutable columns check & current_revision_id verification
CREATE TRIGGER trg_question_immutable_columns
BEFORE UPDATE ON question
BEGIN
    SELECT CASE
        WHEN OLD.format_code != NEW.format_code OR OLD.level != NEW.level THEN
            RAISE(ABORT, 'Question format_code and level are immutable after insertion.')
        WHEN (OLD.content_group_id IS NOT NULL AND (NEW.content_group_id IS NULL OR OLD.content_group_id != NEW.content_group_id))
          OR (OLD.content_group_id IS NULL AND NEW.content_group_id IS NOT NULL) THEN
            RAISE(ABORT, 'Question content_group_id is immutable after insertion.')
        WHEN (OLD.group_ordinal IS NOT NULL AND (NEW.group_ordinal IS NULL OR OLD.group_ordinal != NEW.group_ordinal))
          OR (OLD.group_ordinal IS NULL AND NEW.group_ordinal IS NOT NULL) THEN
            RAISE(ABORT, 'Question group_ordinal is immutable after insertion.')
        WHEN (OLD.anchor_key IS NOT NULL AND (NEW.anchor_key IS NULL OR OLD.anchor_key != NEW.anchor_key))
          OR (OLD.anchor_key IS NULL AND NEW.anchor_key IS NOT NULL) THEN
            RAISE(ABORT, 'Question anchor_key is immutable after insertion.')
        WHEN NEW.current_revision_id IS NOT NULL AND (SELECT question_id FROM question_revision WHERE id = NEW.current_revision_id) != NEW.id THEN
            RAISE(ABORT, 'current_revision_id must belong to this question.')
    END;
END;

-- asset: Only status may be updated; no delete
CREATE TRIGGER trg_asset_no_delete
BEFORE DELETE ON asset
BEGIN
    SELECT RAISE(ABORT, 'asset records cannot be deleted.');
END;

CREATE TRIGGER trg_asset_update_status_only
BEFORE UPDATE ON asset
BEGIN
    SELECT CASE
        WHEN OLD.id != NEW.id OR OLD.sha256 != NEW.sha256 OR OLD.kind != NEW.kind OR OLD.mime_type != NEW.mime_type OR OLD.byte_size != NEW.byte_size OR OLD.relative_path != NEW.relative_path OR (OLD.duration_ms IS NOT NULL AND OLD.duration_ms != NEW.duration_ms) OR (OLD.duration_ms IS NULL AND NEW.duration_ms IS NOT NULL) OR (OLD.pixel_width IS NOT NULL AND OLD.pixel_width != NEW.pixel_width) OR (OLD.pixel_height IS NOT NULL AND OLD.pixel_height != NEW.pixel_height) OR (OLD.original_url IS NOT NULL AND OLD.original_url != NEW.original_url) THEN
            RAISE(ABORT, 'Only asset status may be updated after insertion.')
    END;
END;

-- response: Append-only while attempt is in_progress; locked after completion
CREATE TRIGGER trg_response_insert_check
BEFORE INSERT ON response
BEGIN
    SELECT CASE
        WHEN (SELECT status FROM test_attempt ta JOIN attempt_item ai ON ai.attempt_id = ta.id WHERE ai.id = NEW.attempt_item_id) != 'in_progress' THEN
            RAISE(ABORT, 'Cannot add response to an attempt that is not in progress.')
    END;
END;

CREATE TRIGGER trg_response_no_update
BEFORE UPDATE ON response
BEGIN
    SELECT RAISE(ABORT, 'response records are append-only and cannot be updated.');
END;

CREATE TRIGGER trg_response_no_delete
BEFORE DELETE ON response
BEGIN
    SELECT RAISE(ABORT, 'response records cannot be deleted.');
END;

-- attempt_item: Validate question / group / anchor relationship
CREATE TRIGGER trg_attempt_item_validate
BEFORE INSERT ON attempt_item
BEGIN
    SELECT CASE
        -- Standalone question validation: must have NULL group references
        WHEN (SELECT content_group_id FROM question WHERE id = NEW.question_id) IS NULL THEN
            CASE
                WHEN NEW.group_id IS NOT NULL OR NEW.pinned_group_revision_id IS NOT NULL OR NEW.anchor_key IS NOT NULL THEN
                    RAISE(ABORT, 'Standalone questions must have group_id, pinned_group_revision_id, and anchor_key NULL in attempt_item.')
            END
        -- Grouped question validation
        WHEN (SELECT content_group_id FROM question WHERE id = NEW.question_id) IS NOT NULL THEN
            CASE
                WHEN NEW.group_id IS NULL OR NEW.group_id != (SELECT content_group_id FROM question WHERE id = NEW.question_id) THEN
                    RAISE(ABORT, 'attempt_item group_id must match the question content_group_id.')
                WHEN NEW.pinned_group_revision_id IS NULL THEN
                    RAISE(ABORT, 'attempt_item pinned_group_revision_id is required for grouped questions.')
                WHEN NEW.anchor_key IS NOT NULL AND (SELECT COUNT(*) FROM group_revision_anchor WHERE group_revision_id = NEW.pinned_group_revision_id AND anchor_key = NEW.anchor_key) = 0 THEN
                    RAISE(ABORT, 'attempt_item anchor_key does not exist in the pinned group revision.')
            END
    END;
END;

-- attempt_item_choice_order: Validate choice belongs to attempt item's question revision
CREATE TRIGGER trg_attempt_item_choice_order_validate
BEFORE INSERT ON attempt_item_choice_order
BEGIN
    SELECT CASE
        WHEN (SELECT question_revision_id FROM revision_choice WHERE id = NEW.choice_id) != (SELECT pinned_question_revision_id FROM attempt_item WHERE id = NEW.attempt_item_id) THEN
            RAISE(ABORT, 'choice_id must belong to the attempt item pinned question revision.')
    END;
END;

-- scoring_section_category: Ensure category belongs to exactly one scoring section per exam profile
CREATE TRIGGER trg_scoring_category_unique_per_profile
BEFORE INSERT ON scoring_section_category
BEGIN
    SELECT CASE
        WHEN (
            SELECT COUNT(*)
            FROM scoring_section_category ssc
            JOIN scoring_section_config ssc_cfg ON ssc.scoring_section_id = ssc_cfg.id
            WHERE ssc_cfg.exam_profile_id = (SELECT exam_profile_id FROM scoring_section_config WHERE id = NEW.scoring_section_id)
              AND ssc.category = NEW.category
        ) > 0 THEN
            RAISE(ABORT, 'A category belongs to exactly one scoring section per exam profile.')
    END;
END;

-- -----------------------------------------------------------------------------
-- 10. Eligibility Pre-filter View
-- -----------------------------------------------------------------------------
CREATE VIEW v_question_eligibility AS
SELECT
    q.id AS question_id,
    q.external_id AS question_external_id,
    q.format_code,
    q.level,
    q.category,
    q.status AS question_status,
    q.content_group_id,
    q.current_revision_id,
    CASE WHEN q.current_revision_id IS NOT NULL THEN 1 ELSE 0 END AS has_current_revision,
    qr.validation_status,
    CASE WHEN ra.id IS NOT NULL THEN 1 ELSE 0 END AS has_answer,
    ra.choice_id AS canonical_choice_id,
    ra.answer_origin AS canonical_answer_origin,
    -- Missing required assets across question revision, group revision, and choices
    (
        COALESCE((
            SELECT COUNT(*)
            FROM question_revision_asset qra
            JOIN asset a ON qra.asset_id = a.id
            WHERE qra.question_revision_id = qr.id
              AND qra.is_required = 1
              AND a.status = 'missing'
        ), 0)
        +
        COALESCE((
            SELECT COUNT(*)
            FROM group_revision_asset gra
            JOIN asset a ON gra.asset_id = a.id
            JOIN group_revision gr ON gra.group_revision_id = gr.id
            WHERE gr.group_id = q.content_group_id
              AND gr.id = (SELECT current_revision_id FROM content_group WHERE id = q.content_group_id)
              AND gra.is_required = 1
              AND a.status = 'missing'
        ), 0)
        +
        COALESCE((
            SELECT COUNT(*)
            FROM revision_choice rc
            JOIN asset a ON rc.asset_id = a.id
            WHERE rc.question_revision_id = qr.id
              AND a.status = 'missing'
        ), 0)
    ) AS missing_required_assets_count,
    -- Group inconsistency check
    CASE
        WHEN q.content_group_id IS NOT NULL THEN
            CASE
                WHEN (SELECT COUNT(*) FROM content_group WHERE id = q.content_group_id AND status != 'retired') = 0 THEN 1
                WHEN (SELECT current_revision_id FROM content_group WHERE id = q.content_group_id) IS NULL THEN 1
                WHEN q.anchor_key IS NOT NULL AND (
                    SELECT COUNT(*)
                    FROM group_revision_anchor gra
                    WHERE gra.group_revision_id = (SELECT current_revision_id FROM content_group WHERE id = q.content_group_id)
                      AND gra.anchor_key = q.anchor_key
                ) = 0 THEN 1
                ELSE 0
            END
        ELSE 0
    END AS group_inconsistent,
    -- Answer conflict check: unresolved conflict where canonical origin is not user_entered
    CASE
        WHEN ra.id IS NOT NULL AND ra.answer_origin != 'user_entered' THEN
            CASE
                WHEN (
                    SELECT COUNT(*)
                    FROM source_answer_claim sac
                    WHERE sac.question_revision_id = qr.id
                      AND (sac.is_conflict = 1 OR (sac.choice_id IS NOT NULL AND sac.choice_id != ra.choice_id))
                ) > 0 THEN 1
                ELSE 0
            END
        ELSE 0
    END AS has_answer_conflict
FROM question q
LEFT JOIN question_revision qr ON q.current_revision_id = qr.id
LEFT JOIN revision_answer ra ON qr.id = ra.question_revision_id;

