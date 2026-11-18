-- Kiroku Note: Neon PostgreSQL Canonical Compatibility Views
-- Standardized column schemas matching the real Neon PostgreSQL catalog tables.

-- 1. Canonical Vocabulary View (maps from 'terms' table)
CREATE OR REPLACE VIEW canonical_vocab AS
SELECT
    id AS vocab_id,
    term AS expression,
    reading,
    content_blob AS glossary_blob,
    rules AS pos_tags,
    score AS frequency_rank,
    def_tags,
    norm_term
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
    meanings
FROM jlpt_kanji;

-- 3. Canonical Kanji Strokes View (maps from 'kanji_strokes' table)
CREATE OR REPLACE VIEW canonical_kanji_strokes AS
SELECT
    character AS kanji_char,
    codepoint,
    svg AS svg_paths
FROM kanji_strokes;

-- 4. Canonical Grammar Points View (maps from 'grammar_index' and 'grammar_enrichment' tables)
CREATE OR REPLACE VIEW canonical_grammar_points AS
SELECT
    g.id,
    g.concept_id AS point_id,
    g.level,
    g.pattern_key,
    g.pattern_display AS title,
    g.meaning_short AS meaning_summary,
    g.formation,
    COALESCE(e.examples_json, g.examples) AS examples,
    e.nuance AS nuance_notes,
    e.caution
FROM grammar_index g
LEFT JOIN grammar_enrichment e ON g.concept_id = e.concept_id;

-- 5. Canonical Question Bank View (maps from 'question', 'question_revision', 'revision_choice', 'revision_answer', 'question_explanation')
CREATE OR REPLACE VIEW canonical_question_bank AS
SELECT
    q.id AS question_id,
    q.external_id,
    q.level AS jlpt_level,
    q.category,
    q.format_code,
    qr.stem_markup AS prompt,
    (SELECT json_agg(json_build_object('choice_key', rc.choice_key, 'label', rc.label, 'text', rc.text_markup) ORDER BY rc.ordinal)
     FROM revision_choice rc WHERE rc.question_revision_id = qr.id) AS choices,
    (SELECT ra.choice_id FROM revision_answer ra WHERE ra.question_revision_id = qr.id) AS correct_choice_id,
    qe.summary_text AS explanation
FROM question q
JOIN question_revision qr ON q.current_revision_id = qr.id
LEFT JOIN question_explanation qe ON qe.question_id = q.id;
