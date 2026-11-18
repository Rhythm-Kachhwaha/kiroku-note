-- Kiroku Note: Neon PostgreSQL Canonical Compatibility Views
-- Provides standardized column schemas across existing tables without breaking legacy APIs.

-- 1. Canonical Vocabulary View (maps from 'terms' table)
CREATE OR REPLACE VIEW canonical_vocab AS
SELECT
    id AS vocab_id,
    expression,
    reading,
    glossary AS meaning_en,
    pos AS pos_tags,
    jlpt AS jlpt_level,
    pitch_accent AS pitch_accent_pattern,
    frequency AS frequency_rank
FROM terms;

-- 2. Canonical Kanji View (maps from 'jlpt_kanji' table)
CREATE OR REPLACE VIEW canonical_kanji AS
SELECT
    character AS kanji_char,
    strokes AS stroke_count,
    grade,
    level AS jlpt_level,
    freq AS frequency_rank,
    onyomi AS on_readings,
    kunyomi AS kun_readings,
    meanings,
    radical
FROM jlpt_kanji;

-- 3. Canonical Kanji Strokes View (maps from 'kanji_strokes' table)
CREATE OR REPLACE VIEW canonical_kanji_strokes AS
SELECT
    character AS kanji_char,
    codepoint,
    svg AS svg_paths
FROM kanji_strokes;

-- 4. Canonical Grammar Points View (maps from 'grammar_index' table)
CREATE OR REPLACE VIEW canonical_grammar_points AS
SELECT
    pattern_id AS point_id,
    level,
    pattern AS title,
    structure AS formation,
    meaning AS meaning_summary,
    notes AS nuance_notes,
    examples_json AS examples
FROM grammar_index;

-- 5. Canonical Question Bank View (maps from 'question' table)
CREATE OR REPLACE VIEW canonical_question_bank AS
SELECT
    id AS question_id,
    level AS jlpt_level,
    category,
    prompt,
    choices_json AS choices,
    correct_idx AS correct_choice_idx,
    explanation
FROM question;

