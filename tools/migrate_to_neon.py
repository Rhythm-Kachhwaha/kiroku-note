"""
Migrate reference and study question datasets from local SQLite to Neon PostgreSQL.
"""
import os
import sys
import json
import sqlite3
import psycopg2
from psycopg2.extras import execute_batch, execute_values

NEON_HOST = os.environ.get('NEON_HOST', 'ep-withered-cake-ar7rbuli.c-4.us-west-2.aws.neon.tech')
NEON_HOSTADDR = os.environ.get('NEON_HOSTADDR', '34.211.130.9')
NEON_DB = os.environ.get('NEON_DB', 'neondb')
NEON_USER = os.environ.get('NEON_USER', 'neondb_owner')
NEON_PASSWORD = os.environ.get('NEON_PASSWORD', '')

def get_neon_conn():
    return psycopg2.connect(
        dbname=NEON_DB,
        user=NEON_USER,
        password=NEON_PASSWORD,
        host=NEON_HOST,
        hostaddr=NEON_HOSTADDR,
        port=5432,
        sslmode='require'
    )

SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Grammar Reference
CREATE TABLE IF NOT EXISTS grammar_index (
    id SERIAL PRIMARY KEY,
    concept_id TEXT UNIQUE NOT NULL,
    pattern_display TEXT NOT NULL,
    pattern_key TEXT NOT NULL,
    level TEXT NOT NULL,
    meaning_short TEXT NOT NULL,
    english_breakdown TEXT NOT NULL,
    formation TEXT,
    variants JSONB NOT NULL DEFAULT '[]'::jsonb,
    matcher JSONB NOT NULL DEFAULT '{}'::jsonb,
    guards JSONB DEFAULT NULL,
    examples JSONB NOT NULL DEFAULT '[]'::jsonb,
    group_id TEXT DEFAULT NULL,
    source TEXT NOT NULL,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    review_status TEXT DEFAULT 'verified'
);
CREATE INDEX IF NOT EXISTS idx_grammar_concept ON grammar_index(concept_id);
CREATE INDEX IF NOT EXISTS idx_grammar_level ON grammar_index(level);
CREATE INDEX IF NOT EXISTS idx_grammar_pattern ON grammar_index(pattern_key);

CREATE TABLE IF NOT EXISTS grammar_enrichment (
    concept_id TEXT PRIMARY KEY,
    big_picture_concept TEXT,
    formation_rules JSONB,
    common_pitfalls JSONB,
    nuance_contrasts JSONB,
    visual_anchor_svg TEXT,
    source_url TEXT,
    updated_at TIMESTAMPTZ
);

-- JLPT Reference
CREATE TABLE IF NOT EXISTS jlpt_vocab (
    id SERIAL PRIMARY KEY,
    word TEXT NOT NULL,
    reading TEXT,
    meanings TEXT NOT NULL,
    level TEXT NOT NULL,
    examples TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_jlpt_vocab_word ON jlpt_vocab(word);
CREATE INDEX IF NOT EXISTS idx_jlpt_vocab_level ON jlpt_vocab(level);

CREATE TABLE IF NOT EXISTS jlpt_kanji (
    id SERIAL PRIMARY KEY,
    character TEXT NOT NULL,
    level TEXT NOT NULL,
    strokes INTEGER,
    grade INTEGER,
    freq INTEGER,
    onyomi TEXT NOT NULL,
    kunyomi TEXT NOT NULL,
    meanings TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jlpt_kanji_char ON jlpt_kanji(character);
CREATE INDEX IF NOT EXISTS idx_jlpt_kanji_level ON jlpt_kanji(level);

CREATE TABLE IF NOT EXISTS jlpt_grammar (
    id SERIAL PRIMARY KEY,
    pattern TEXT NOT NULL,
    level TEXT NOT NULL,
    meaning TEXT NOT NULL,
    formation TEXT,
    examples TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_jlpt_grammar_level ON jlpt_grammar(level);

-- Kanji Strokes
CREATE TABLE IF NOT EXISTS kanji_strokes (
    character TEXT PRIMARY KEY,
    codepoint TEXT NOT NULL,
    svg TEXT NOT NULL
);

-- Study Question Bank
CREATE TABLE IF NOT EXISTS format (
    code TEXT PRIMARY KEY,
    structural_family TEXT NOT NULL,
    category TEXT NOT NULL,
    grader_type TEXT DEFAULT NULL,
    min_choices INTEGER DEFAULT NULL,
    max_choices INTEGER DEFAULT NULL,
    label TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS format_level (
    format_code TEXT NOT NULL REFERENCES format(code),
    level TEXT NOT NULL,
    PRIMARY KEY (format_code, level)
);

CREATE TABLE IF NOT EXISTS exam_profile (
    id SERIAL PRIMARY KEY,
    level TEXT NOT NULL UNIQUE,
    version INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exam_section_config (
    id SERIAL PRIMARY KEY,
    exam_profile_id INTEGER NOT NULL REFERENCES exam_profile(id),
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    time_limit_minutes INTEGER DEFAULT NULL,
    block_order INTEGER NOT NULL,
    audio_policy TEXT DEFAULT 'none',
    lock_on_end INTEGER DEFAULT 1,
    break_duration_minutes INTEGER DEFAULT NULL,
    verify_counts INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (exam_profile_id, block_order),
    UNIQUE (exam_profile_id, code)
);

CREATE TABLE IF NOT EXISTS asset (
    id SERIAL PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    relative_path TEXT NOT NULL,
    duration_ms INTEGER DEFAULT NULL,
    pixel_width INTEGER DEFAULT NULL,
    pixel_height INTEGER DEFAULT NULL,
    original_url TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'present',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_group (
    id SERIAL PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    kind TEXT NOT NULL,
    level TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    current_revision_id INTEGER DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, level)
);

CREATE TABLE IF NOT EXISTS group_revision (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES content_group(id),
    revision_number INTEGER NOT NULL,
    content_fingerprint TEXT NOT NULL,
    sealed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, revision_number),
    UNIQUE (id, group_id)
);

CREATE TABLE IF NOT EXISTS group_revision_part (
    id SERIAL PRIMARY KEY,
    group_revision_id INTEGER NOT NULL REFERENCES group_revision(id),
    ordinal INTEGER NOT NULL,
    role TEXT NOT NULL,
    markup TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, group_revision_id),
    UNIQUE (group_revision_id, ordinal)
);

CREATE TABLE IF NOT EXISTS group_revision_anchor (
    id SERIAL PRIMARY KEY,
    group_revision_id INTEGER NOT NULL REFERENCES group_revision(id),
    part_id INTEGER NOT NULL,
    anchor_key TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    kind TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_revision_id, anchor_key),
    UNIQUE (group_revision_id, ordinal)
);

CREATE TABLE IF NOT EXISTS group_revision_asset (
    id SERIAL PRIMARY KEY,
    group_revision_id INTEGER NOT NULL REFERENCES group_revision(id),
    asset_id INTEGER NOT NULL REFERENCES asset(id),
    role TEXT NOT NULL,
    ordinal INTEGER NOT NULL DEFAULT 1,
    is_required INTEGER NOT NULL DEFAULT 1,
    part_id INTEGER DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_revision_id, asset_id, role)
);

CREATE TABLE IF NOT EXISTS question (
    id SERIAL PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    format_code TEXT NOT NULL,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    content_group_id INTEGER DEFAULT NULL,
    group_ordinal INTEGER DEFAULT NULL,
    anchor_key TEXT DEFAULT NULL,
    current_revision_id INTEGER DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_question_level ON question(level);
CREATE INDEX IF NOT EXISTS idx_question_format ON question(format_code);

CREATE TABLE IF NOT EXISTS question_revision (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES question(id),
    format_code TEXT NOT NULL,
    revision_number INTEGER NOT NULL,
    stem_markup TEXT NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    validation_status TEXT NOT NULL DEFAULT 'valid',
    content_fingerprint TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    sealed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (question_id, revision_number),
    UNIQUE (id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_qrev_qid ON question_revision(question_id);

CREATE TABLE IF NOT EXISTS revision_choice (
    id SERIAL PRIMARY KEY,
    question_revision_id INTEGER NOT NULL REFERENCES question_revision(id),
    choice_key TEXT NOT NULL,
    label TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    text_markup TEXT DEFAULT NULL,
    asset_id INTEGER DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, question_revision_id),
    UNIQUE (question_revision_id, choice_key),
    UNIQUE (question_revision_id, ordinal)
);
CREATE INDEX IF NOT EXISTS idx_revchoice_qrevid ON revision_choice(question_revision_id);

CREATE TABLE IF NOT EXISTS revision_answer (
    id SERIAL PRIMARY KEY,
    question_revision_id INTEGER NOT NULL UNIQUE REFERENCES question_revision(id),
    choice_id INTEGER NOT NULL,
    answer_origin TEXT NOT NULL,
    rationale_markup TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_revans_qrevid ON revision_answer(question_revision_id);

CREATE TABLE IF NOT EXISTS question_revision_asset (
    id SERIAL PRIMARY KEY,
    question_revision_id INTEGER NOT NULL REFERENCES question_revision(id),
    asset_id INTEGER NOT NULL REFERENCES asset(id),
    role TEXT NOT NULL,
    ordinal INTEGER NOT NULL DEFAULT 1,
    is_required INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (question_revision_id, asset_id, role)
);

CREATE TABLE IF NOT EXISTS question_explanation (
    id SERIAL PRIMARY KEY,
    external_id TEXT UNIQUE NOT NULL,
    question_id INTEGER NOT NULL REFERENCES question(id),
    question_revision_id INTEGER NOT NULL,
    run_id INTEGER DEFAULT NULL,
    generated_by_slot TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'unknown',
    model_name TEXT NOT NULL DEFAULT 'unknown',
    target_choice_key TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    correct_choice_analysis TEXT NOT NULL DEFAULT '',
    distractor_analysis_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    grammar_notes TEXT NOT NULL DEFAULT '',
    kanji_vocabulary_notes TEXT NOT NULL DEFAULT '',
    reading_context_notes TEXT NOT NULL DEFAULT '',
    is_human_approved INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qexpl_qid ON question_explanation(question_id);

-- Core Dictionary
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kanji (
    character TEXT PRIMARY KEY,
    onyomi TEXT NOT NULL,
    kunyomi TEXT NOT NULL,
    tags TEXT,
    stats_json TEXT NOT NULL,
    meanings_json TEXT NOT NULL,
    dictionary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    sorting_order REAL NOT NULL DEFAULT 0,
    notes TEXT,
    score REAL NOT NULL DEFAULT 0,
    dictionary TEXT NOT NULL,
    PRIMARY KEY (name, dictionary)
);

CREATE TABLE IF NOT EXISTS terms (
    id SERIAL PRIMARY KEY,
    term TEXT NOT NULL,
    reading TEXT NOT NULL,
    norm_term TEXT NOT NULL,
    norm_reading TEXT NOT NULL,
    rules TEXT NOT NULL DEFAULT '',
    def_tags TEXT,
    score REAL NOT NULL DEFAULT 0,
    sequence INTEGER NOT NULL DEFAULT 0,
    term_tags TEXT,
    dictionary TEXT NOT NULL,
    content_blob BYTEA NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_terms_term ON terms(term);
CREATE INDEX IF NOT EXISTS idx_terms_reading ON terms(reading);
CREATE INDEX IF NOT EXISTS idx_terms_norm_reading ON terms(norm_reading);
CREATE INDEX IF NOT EXISTS idx_terms_norm_term ON terms(norm_term);
CREATE INDEX IF NOT EXISTS idx_terms_trgm ON terms USING gin (term gin_trgm_ops);
"""

def migrate_table(sqlite_conn, pg_conn, sqlite_query, pg_insert_sql, batch_size=2000, transform=None):
    scur = sqlite_conn.cursor()
    pcur = pg_conn.cursor()
    scur.execute(sqlite_query)
    
    total = 0
    while True:
        rows = scur.fetchmany(batch_size)
        if not rows:
            break
        if transform:
            rows = [transform(r) for r in rows]
        execute_values(pcur, pg_insert_sql, rows, page_size=batch_size)
        pg_conn.commit()
        total += len(rows)
        print(f"    Migrated {total} rows...", end='\\r')
    print(f"    Total migrated: {total} rows.")
    scur.close()
    pcur.close()

def main():
    print("Connecting to Neon PostgreSQL...")
    pg_conn = get_neon_conn()
    pcur = pg_conn.cursor()

    print("Creating tables in Neon...")
    pcur.execute("DROP TABLE IF EXISTS exam_section_config CASCADE;")
    pcur.execute(SCHEMA_SQL)
    pg_conn.commit()
    print("Schema created successfully.")

    # 1. Grammar Reference
    print("\n--- Migrating Grammar Reference ---")
    g_conn = sqlite3.connect('backend/app/data/grammar_reference.sqlite')
    pcur.execute("SELECT count(*) FROM grammar_index")
    if pcur.fetchone()[0] == 0:
        migrate_table(
            g_conn, pg_conn,
            "SELECT id, concept_id, pattern_display, pattern_key, level, meaning_short, english_breakdown, formation, variants, matcher, guards, examples, group_id, source, sources, review_status FROM grammar_index",
            "INSERT INTO grammar_index (id, concept_id, pattern_display, pattern_key, level, meaning_short, english_breakdown, formation, variants, matcher, guards, examples, group_id, source, sources, review_status) VALUES %s ON CONFLICT DO NOTHING"
        )
    pcur.execute("SELECT count(*) FROM grammar_enrichment")
    if pcur.fetchone()[0] == 0:
        migrate_table(
            g_conn, pg_conn,
            "SELECT concept_id, big_picture_concept, formation_rules, common_pitfalls, nuance_contrasts, visual_anchor_svg, source_url, updated_at FROM grammar_enrichment",
            "INSERT INTO grammar_enrichment (concept_id, big_picture_concept, formation_rules, common_pitfalls, nuance_contrasts, visual_anchor_svg, source_url, updated_at) VALUES %s ON CONFLICT DO NOTHING"
        )
    g_conn.close()

    # 2. JLPT Reference
    print("\n--- Migrating JLPT Reference ---")
    j_conn = sqlite3.connect('backend/app/data/jlpt_reference.sqlite')
    pcur.execute("SELECT count(*) FROM jlpt_vocab")
    if pcur.fetchone()[0] == 0:
        migrate_table(
            j_conn, pg_conn,
            "SELECT id, word, reading, meanings, level, examples FROM vocab",
            "INSERT INTO jlpt_vocab (id, word, reading, meanings, level, examples) VALUES %s ON CONFLICT DO NOTHING"
        )
    pcur.execute("SELECT count(*) FROM jlpt_kanji")
    if pcur.fetchone()[0] == 0:
        migrate_table(
            j_conn, pg_conn,
            "SELECT id, character, level, strokes, grade, freq, onyomi, kunyomi, meanings FROM kanji",
            "INSERT INTO jlpt_kanji (id, character, level, strokes, grade, freq, onyomi, kunyomi, meanings) VALUES %s ON CONFLICT DO NOTHING"
        )
    pcur.execute("SELECT count(*) FROM jlpt_grammar")
    if pcur.fetchone()[0] == 0:
        migrate_table(
            j_conn, pg_conn,
            "SELECT id, pattern, level, meaning, formation, examples, tags, notes FROM grammar",
            "INSERT INTO jlpt_grammar (id, pattern, level, meaning, formation, examples, tags, notes) VALUES %s ON CONFLICT DO NOTHING"
        )
    j_conn.close()

    # 3. Kanji Strokes
    print("\n--- Migrating Kanji Strokes ---")
    s_conn = sqlite3.connect('backend/app/data/kanji_strokes.sqlite')
    pcur.execute("SELECT count(*) FROM kanji_strokes")
    if pcur.fetchone()[0] == 0:
        migrate_table(
            s_conn, pg_conn,
            "SELECT character, codepoint, svg FROM kanji_strokes",
            "INSERT INTO kanji_strokes (character, codepoint, svg) VALUES %s ON CONFLICT DO NOTHING"
        )
    s_conn.close()

    # 4. Study Question Bank
    print("\n--- Migrating Study Question Bank ---")
    std_conn = sqlite3.connect('backend/study/study.db')
    
    study_tables = [
        ('format', 'SELECT code, structural_family, category, grader_type, min_choices, max_choices, label, created_at FROM format',
         'INSERT INTO format (code, structural_family, category, grader_type, min_choices, max_choices, label, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('format_level', 'SELECT format_code, level FROM format_level',
         'INSERT INTO format_level (format_code, level) VALUES %s ON CONFLICT DO NOTHING'),
        ('exam_profile', 'SELECT id, level, version, name, created_at FROM exam_profile',
         'INSERT INTO exam_profile (id, level, version, name, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('exam_section_config', 'SELECT id, exam_profile_id, code, label, time_limit_minutes, block_order, audio_policy, lock_on_end, break_duration_minutes, verify_counts, created_at FROM exam_section_config',
         'INSERT INTO exam_section_config (id, exam_profile_id, code, label, time_limit_minutes, block_order, audio_policy, lock_on_end, break_duration_minutes, verify_counts, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('asset', 'SELECT id, sha256, kind, mime_type, byte_size, relative_path, duration_ms, pixel_width, pixel_height, original_url, status, created_at FROM asset',
         'INSERT INTO asset (id, sha256, kind, mime_type, byte_size, relative_path, duration_ms, pixel_width, pixel_height, original_url, status, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('content_group', 'SELECT id, external_id, kind, level, status, current_revision_id, created_at, updated_at FROM content_group',
         'INSERT INTO content_group (id, external_id, kind, level, status, current_revision_id, created_at, updated_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('group_revision', 'SELECT id, group_id, revision_number, content_fingerprint, sealed_at, created_at FROM group_revision',
         'INSERT INTO group_revision (id, group_id, revision_number, content_fingerprint, sealed_at, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('group_revision_part', 'SELECT id, group_revision_id, ordinal, role, markup, created_at FROM group_revision_part',
         'INSERT INTO group_revision_part (id, group_revision_id, ordinal, role, markup, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('group_revision_anchor', 'SELECT id, group_revision_id, part_id, anchor_key, ordinal, kind, created_at FROM group_revision_anchor',
         'INSERT INTO group_revision_anchor (id, group_revision_id, part_id, anchor_key, ordinal, kind, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('group_revision_asset', 'SELECT id, group_revision_id, asset_id, role, ordinal, is_required, part_id, created_at FROM group_revision_asset',
         'INSERT INTO group_revision_asset (id, group_revision_id, asset_id, role, ordinal, is_required, part_id, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('question', 'SELECT id, external_id, format_code, level, category, status, content_group_id, group_ordinal, anchor_key, current_revision_id, created_at, updated_at FROM question',
         'INSERT INTO question (id, external_id, format_code, level, category, status, content_group_id, group_ordinal, anchor_key, current_revision_id, created_at, updated_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('question_revision', 'SELECT id, question_id, format_code, revision_number, stem_markup, payload_json, validation_status, content_fingerprint, schema_version, sealed_at, created_at FROM question_revision',
         'INSERT INTO question_revision (id, question_id, format_code, revision_number, stem_markup, payload_json, validation_status, content_fingerprint, schema_version, sealed_at, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('revision_choice', 'SELECT id, question_revision_id, choice_key, label, ordinal, text_markup, asset_id, created_at FROM revision_choice',
         'INSERT INTO revision_choice (id, question_revision_id, choice_key, label, ordinal, text_markup, asset_id, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('revision_answer', 'SELECT id, question_revision_id, choice_id, answer_origin, rationale_markup, created_at FROM revision_answer',
         'INSERT INTO revision_answer (id, question_revision_id, choice_id, answer_origin, rationale_markup, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('question_revision_asset', 'SELECT id, question_revision_asset.question_revision_id, question_revision_asset.asset_id, question_revision_asset.role, question_revision_asset.ordinal, question_revision_asset.is_required, question_revision_asset.created_at FROM question_revision_asset',
         'INSERT INTO question_revision_asset (id, question_revision_id, asset_id, role, ordinal, is_required, created_at) VALUES %s ON CONFLICT DO NOTHING'),
        ('question_explanation', 'SELECT id, external_id, question_id, question_revision_id, run_id, generated_by_slot, provider, model_name, target_choice_key, summary_text, correct_choice_analysis, distractor_analysis_json, grammar_notes, kanji_vocabulary_notes, reading_context_notes, is_human_approved, created_at, updated_at FROM question_explanation',
         'INSERT INTO question_explanation (id, external_id, question_id, question_revision_id, run_id, generated_by_slot, provider, model_name, target_choice_key, summary_text, correct_choice_analysis, distractor_analysis_json, grammar_notes, kanji_vocabulary_notes, reading_context_notes, is_human_approved, created_at, updated_at) VALUES %s ON CONFLICT DO NOTHING'),
    ]

    for tbl, query, ins_sql in study_tables:
        pcur.execute(f"SELECT count(*) FROM {tbl}")
        cnt = pcur.fetchone()[0]
        if cnt == 0:
            print(f"  Migrating {tbl}...")
            migrate_table(std_conn, pg_conn, query, ins_sql)
        else:
            print(f"  {tbl} already has {cnt} rows.")
    std_conn.close()

    # 5. Core Dictionary
    print("\n--- Migrating Core Dictionary ---")
    dict_conn = sqlite3.connect('kiroku_dict.sqlite')
    
    pcur.execute("SELECT count(*) FROM meta")
    if pcur.fetchone()[0] == 0:
        print("  Migrating meta...")
        migrate_table(
            dict_conn, pg_conn,
            "SELECT key, value FROM meta",
            "INSERT INTO meta (key, value) VALUES %s ON CONFLICT DO NOTHING"
        )
    
    pcur.execute("SELECT count(*) FROM tags")
    if pcur.fetchone()[0] == 0:
        print("  Migrating tags...")
        migrate_table(
            dict_conn, pg_conn,
            "SELECT name, category, sorting_order, notes, score, dictionary FROM tags",
            "INSERT INTO tags (name, category, sorting_order, notes, score, dictionary) VALUES %s ON CONFLICT DO NOTHING"
        )

    pcur.execute("SELECT count(*) FROM kanji")
    if pcur.fetchone()[0] == 0:
        print("  Migrating kanji...")
        migrate_table(
            dict_conn, pg_conn,
            "SELECT character, onyomi, kunyomi, tags, stats_json, meanings_json, dictionary FROM kanji",
            "INSERT INTO kanji (character, onyomi, kunyomi, tags, stats_json, meanings_json, dictionary) VALUES %s ON CONFLICT DO NOTHING"
        )

    pcur.execute("SELECT count(*) FROM terms")
    cnt = pcur.fetchone()[0]
    if cnt == 0:
        print("  Migrating terms (436k rows)...")
        def transform_term(row):
            # row: id, term, reading, norm_term, norm_reading, rules, def_tags, score, sequence, term_tags, dictionary, content_blob
            r = list(row)
            r[11] = psycopg2.Binary(r[11])
            return tuple(r)

        migrate_table(
            dict_conn, pg_conn,
            "SELECT id, term, reading, norm_term, norm_reading, rules, def_tags, score, sequence, term_tags, dictionary, content_blob FROM terms",
            "INSERT INTO terms (id, term, reading, norm_term, norm_reading, rules, def_tags, score, sequence, term_tags, dictionary, content_blob) VALUES %s ON CONFLICT DO NOTHING",
            batch_size=5000,
            transform=transform_term
        )
    else:
        print(f"  terms already has {cnt} rows.")

    dict_conn.close()
    pcur.close()
    pg_conn.close()
    print("\n[SUCCESS] Neon Migration Finished Cleanly!")

if __name__ == '__main__':
    main()
