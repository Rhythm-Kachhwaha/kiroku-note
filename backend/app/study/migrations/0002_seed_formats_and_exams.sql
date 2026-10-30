-- =============================================================================
-- Migration 0002: Seed Formats, Supported Levels, and Exam Profiles
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Format Registry Seeds (All 20 formats across F1–F6)
-- -----------------------------------------------------------------------------
INSERT INTO format (code, structural_family, category, grader_type, min_choices, max_choices, label) VALUES
    ('kanji_reading', 'F1', 'vocabulary', 'single_choice', 4, 4, 'Kanji Reading'),
    ('orthography', 'F1', 'vocabulary', 'single_choice', 4, 4, 'Orthography'),
    ('word_formation', 'F1', 'vocabulary', 'single_choice', 4, 4, 'Word Formation'),
    ('contextual_expressions', 'F1', 'vocabulary', 'single_choice', 4, 4, 'Contextually-defined Expressions'),
    ('paraphrases', 'F1', 'vocabulary', 'single_choice', 4, 4, 'Paraphrases'),
    ('usage', 'F1', 'vocabulary', 'single_choice', 4, 4, 'Usage'),
    ('sentential_grammar_1', 'F1', 'grammar', 'single_choice', 4, 4, 'Sentential Grammar 1 (Grammar Form Selection)'),
    ('sentence_composition', 'F2', 'grammar', 'single_choice', 4, 4, 'Sentence Composition (Star)'),
    ('comprehension_short', 'F3', 'reading', 'single_choice', 4, 4, 'Comprehension Short'),
    ('comprehension_mid', 'F3', 'reading', 'single_choice', 4, 4, 'Comprehension Mid'),
    ('comprehension_long', 'F3', 'reading', 'single_choice', 4, 4, 'Comprehension Long'),
    ('integrated_thematic_reading', 'F3', 'reading', 'single_choice', 4, 4, 'Integrated and Thematic Reading'),
    ('information_retrieval', 'F3', 'reading', 'single_choice', 4, 4, 'Information Retrieval'),
    ('text_grammar', 'F4', 'grammar', 'single_choice', 4, 4, 'Text Grammar'),
    ('task_based_listening', 'F5', 'listening', 'single_choice', 4, 4, 'Task-based Listening'),
    ('key_points_listening', 'F5', 'listening', 'single_choice', 4, 4, 'Key Points Listening'),
    ('general_outline_listening', 'F5', 'listening', 'single_choice', 4, 4, 'General Outline Listening'),
    ('verbal_expressions', 'F5', 'listening', 'single_choice', 3, 4, 'Verbal Expressions'),
    ('quick_response', 'F5', 'listening', 'single_choice', 3, 3, 'Quick Response'),
    ('listening_integrated', 'F6', 'listening', 'single_choice', 4, 4, 'Listening Integrated');

-- -----------------------------------------------------------------------------
-- 2. Format Level Bindings
-- -----------------------------------------------------------------------------
-- Kanji reading: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('kanji_reading', 'N1'), ('kanji_reading', 'N2'), ('kanji_reading', 'N3'), ('kanji_reading', 'N4'), ('kanji_reading', 'N5');

-- Orthography: N2–N5
INSERT INTO format_level (format_code, level) VALUES
    ('orthography', 'N2'), ('orthography', 'N3'), ('orthography', 'N4'), ('orthography', 'N5');

-- Word formation: N2 only
INSERT INTO format_level (format_code, level) VALUES
    ('word_formation', 'N2');

-- Contextually-defined expressions: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('contextual_expressions', 'N1'), ('contextual_expressions', 'N2'), ('contextual_expressions', 'N3'), ('contextual_expressions', 'N4'), ('contextual_expressions', 'N5');

-- Paraphrases: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('paraphrases', 'N1'), ('paraphrases', 'N2'), ('paraphrases', 'N3'), ('paraphrases', 'N4'), ('paraphrases', 'N5');

-- Usage: N1–N4
INSERT INTO format_level (format_code, level) VALUES
    ('usage', 'N1'), ('usage', 'N2'), ('usage', 'N3'), ('usage', 'N4');

-- Sentential grammar 1: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('sentential_grammar_1', 'N1'), ('sentential_grammar_1', 'N2'), ('sentential_grammar_1', 'N3'), ('sentential_grammar_1', 'N4'), ('sentential_grammar_1', 'N5');

-- Sentence composition (star): N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('sentence_composition', 'N1'), ('sentence_composition', 'N2'), ('sentence_composition', 'N3'), ('sentence_composition', 'N4'), ('sentence_composition', 'N5');

-- Text grammar: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('text_grammar', 'N1'), ('text_grammar', 'N2'), ('text_grammar', 'N3'), ('text_grammar', 'N4'), ('text_grammar', 'N5');

-- Comprehension short: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('comprehension_short', 'N1'), ('comprehension_short', 'N2'), ('comprehension_short', 'N3'), ('comprehension_short', 'N4'), ('comprehension_short', 'N5');

-- Comprehension mid: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('comprehension_mid', 'N1'), ('comprehension_mid', 'N2'), ('comprehension_mid', 'N3'), ('comprehension_mid', 'N4'), ('comprehension_mid', 'N5');

-- Comprehension long: N1 and N3
INSERT INTO format_level (format_code, level) VALUES
    ('comprehension_long', 'N1'), ('comprehension_long', 'N3');

-- Integrated and thematic reading: N1 and N2
INSERT INTO format_level (format_code, level) VALUES
    ('integrated_thematic_reading', 'N1'), ('integrated_thematic_reading', 'N2');

-- Information retrieval: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('information_retrieval', 'N1'), ('information_retrieval', 'N2'), ('information_retrieval', 'N3'), ('information_retrieval', 'N4'), ('information_retrieval', 'N5');

-- Task-based listening: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('task_based_listening', 'N1'), ('task_based_listening', 'N2'), ('task_based_listening', 'N3'), ('task_based_listening', 'N4'), ('task_based_listening', 'N5');

-- Key points listening: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('key_points_listening', 'N1'), ('key_points_listening', 'N2'), ('key_points_listening', 'N3'), ('key_points_listening', 'N4'), ('key_points_listening', 'N5');

-- General outline listening: N1–N3
INSERT INTO format_level (format_code, level) VALUES
    ('general_outline_listening', 'N1'), ('general_outline_listening', 'N2'), ('general_outline_listening', 'N3');

-- Verbal expressions: N3–N5
INSERT INTO format_level (format_code, level) VALUES
    ('verbal_expressions', 'N3'), ('verbal_expressions', 'N4'), ('verbal_expressions', 'N5');

-- Quick response: N1–N5
INSERT INTO format_level (format_code, level) VALUES
    ('quick_response', 'N1'), ('quick_response', 'N2'), ('quick_response', 'N3'), ('quick_response', 'N4'), ('quick_response', 'N5');

-- Listening integrated: N1 and N2
INSERT INTO format_level (format_code, level) VALUES
    ('listening_integrated', 'N1'), ('listening_integrated', 'N2');

-- -----------------------------------------------------------------------------
-- 3. Exam Profiles Seed Data (N1–N5)
-- -----------------------------------------------------------------------------
INSERT INTO exam_profile (id, level, version, name) VALUES
    (1, 'N1', 1, 'JLPT N1 Official Examination Profile'),
    (2, 'N2', 1, 'JLPT N2 Official Examination Profile'),
    (3, 'N3', 1, 'JLPT N3 Official Examination Profile'),
    (4, 'N4', 1, 'JLPT N4 Official Examination Profile'),
    (5, 'N5', 1, 'JLPT N5 Official Examination Profile');

-- -----------------------------------------------------------------------------
-- 3.1 N1 Configuration: 110 min (Knowledge + Reading), 55 min (Listening)
-- -----------------------------------------------------------------------------
INSERT INTO exam_section_config (id, exam_profile_id, block_order, code, label, time_limit_minutes, audio_policy, lock_on_end, break_duration_minutes, verify_counts) VALUES
    (101, 1, 1, 'N1_SEC_KNOWLEDGE_READING', 'Language Knowledge (Vocabulary/Grammar) & Reading', 110, 'none', 1, NULL, 0),
    (102, 1, 2, 'N1_SEC_LISTENING', 'Listening', 55, 'once_strictly', 1, NULL, 0);

INSERT INTO exam_block_category (section_config_id, category) VALUES
    (101, 'vocabulary'), (101, 'grammar'), (101, 'reading'),
    (102, 'listening');

INSERT INTO scoring_section_config (id, exam_profile_id, section_order, code, label, max_score) VALUES
    (101, 1, 1, 'N1_SCORE_KNOWLEDGE', 'Language Knowledge (Vocabulary/Grammar)', 60),
    (102, 1, 2, 'N1_SCORE_READING', 'Reading', 60),
    (103, 1, 3, 'N1_SCORE_LISTENING', 'Listening', 60);

INSERT INTO scoring_section_category (scoring_section_id, category) VALUES
    (101, 'vocabulary'), (101, 'grammar'),
    (102, 'reading'),
    (103, 'listening');

-- -----------------------------------------------------------------------------
-- 3.2 N2 Configuration: 105 min (Knowledge + Reading), 50 min (Listening)
-- -----------------------------------------------------------------------------
INSERT INTO exam_section_config (id, exam_profile_id, block_order, code, label, time_limit_minutes, audio_policy, lock_on_end, break_duration_minutes, verify_counts) VALUES
    (201, 2, 1, 'N2_SEC_KNOWLEDGE_READING', 'Language Knowledge (Vocabulary/Grammar) & Reading', 105, 'none', 1, NULL, 0),
    (202, 2, 2, 'N2_SEC_LISTENING', 'Listening', 50, 'once_strictly', 1, NULL, 0);

INSERT INTO exam_block_category (section_config_id, category) VALUES
    (201, 'vocabulary'), (201, 'grammar'), (201, 'reading'),
    (202, 'listening');

INSERT INTO scoring_section_config (id, exam_profile_id, section_order, code, label, max_score) VALUES
    (201, 2, 1, 'N2_SCORE_KNOWLEDGE', 'Language Knowledge (Vocabulary/Grammar)', 60),
    (202, 2, 2, 'N2_SCORE_READING', 'Reading', 60),
    (203, 2, 3, 'N2_SCORE_LISTENING', 'Listening', 60);

INSERT INTO scoring_section_category (scoring_section_id, category) VALUES
    (201, 'vocabulary'), (201, 'grammar'),
    (202, 'reading'),
    (203, 'listening');

-- -----------------------------------------------------------------------------
-- 3.3 N3 Configuration: 30 min (Vocab), 70 min (Grammar + Reading), 40 min (Listening)
-- -----------------------------------------------------------------------------
INSERT INTO exam_section_config (id, exam_profile_id, block_order, code, label, time_limit_minutes, audio_policy, lock_on_end, break_duration_minutes, verify_counts) VALUES
    (301, 3, 1, 'N3_SEC_VOCABULARY', 'Language Knowledge (Vocabulary)', 30, 'none', 1, NULL, 0),
    (302, 3, 2, 'N3_SEC_GRAMMAR_READING', 'Language Knowledge (Grammar) & Reading', 70, 'none', 1, NULL, 0),
    (303, 3, 3, 'N3_SEC_LISTENING', 'Listening', 40, 'once_strictly', 1, NULL, 0);

INSERT INTO exam_block_category (section_config_id, category) VALUES
    (301, 'vocabulary'),
    (302, 'grammar'), (302, 'reading'),
    (303, 'listening');

INSERT INTO scoring_section_config (id, exam_profile_id, section_order, code, label, max_score) VALUES
    (301, 3, 1, 'N3_SCORE_KNOWLEDGE', 'Language Knowledge (Vocabulary/Grammar)', 60),
    (302, 3, 2, 'N3_SCORE_READING', 'Reading', 60),
    (303, 3, 3, 'N3_SCORE_LISTENING', 'Listening', 60);

INSERT INTO scoring_section_category (scoring_section_id, category) VALUES
    (301, 'vocabulary'), (301, 'grammar'),
    (302, 'reading'),
    (303, 'listening');

-- -----------------------------------------------------------------------------
-- 3.4 N4 Configuration: 25 min (Vocab), 55 min (Grammar + Reading), 35 min (Listening)
-- -----------------------------------------------------------------------------
INSERT INTO exam_section_config (id, exam_profile_id, block_order, code, label, time_limit_minutes, audio_policy, lock_on_end, break_duration_minutes, verify_counts) VALUES
    (401, 4, 1, 'N4_SEC_VOCABULARY', 'Language Knowledge (Vocabulary)', 25, 'none', 1, NULL, 0),
    (402, 4, 2, 'N4_SEC_GRAMMAR_READING', 'Language Knowledge (Grammar) & Reading', 55, 'none', 1, NULL, 0),
    (403, 4, 3, 'N4_SEC_LISTENING', 'Listening', 35, 'once_strictly', 1, NULL, 0);

INSERT INTO exam_block_category (section_config_id, category) VALUES
    (401, 'vocabulary'),
    (402, 'grammar'), (402, 'reading'),
    (403, 'listening');

INSERT INTO scoring_section_config (id, exam_profile_id, section_order, code, label, max_score) VALUES
    (401, 4, 1, 'N4_SCORE_KNOWLEDGE_READING', 'Language Knowledge (Vocabulary/Grammar) & Reading', 120),
    (402, 4, 2, 'N4_SCORE_LISTENING', 'Listening', 60);

INSERT INTO scoring_section_category (scoring_section_id, category) VALUES
    (401, 'vocabulary'), (401, 'grammar'), (401, 'reading'),
    (402, 'listening');

-- -----------------------------------------------------------------------------
-- 3.5 N5 Configuration: 20 min (Vocab), 40 min (Grammar + Reading), 30 min (Listening)
-- -----------------------------------------------------------------------------
INSERT INTO exam_section_config (id, exam_profile_id, block_order, code, label, time_limit_minutes, audio_policy, lock_on_end, break_duration_minutes, verify_counts) VALUES
    (501, 5, 1, 'N5_SEC_VOCABULARY', 'Language Knowledge (Vocabulary)', 20, 'none', 1, NULL, 0),
    (502, 5, 2, 'N5_SEC_GRAMMAR_READING', 'Language Knowledge (Grammar) & Reading', 40, 'none', 1, NULL, 0),
    (503, 5, 3, 'N5_SEC_LISTENING', 'Listening', 30, 'once_strictly', 1, NULL, 0);

INSERT INTO exam_block_category (section_config_id, category) VALUES
    (501, 'vocabulary'),
    (502, 'grammar'), (502, 'reading'),
    (503, 'listening');

INSERT INTO scoring_section_config (id, exam_profile_id, section_order, code, label, max_score) VALUES
    (501, 5, 1, 'N5_SCORE_KNOWLEDGE_READING', 'Language Knowledge (Vocabulary/Grammar) & Reading', 120),
    (502, 5, 2, 'N5_SCORE_LISTENING', 'Listening', 60);

INSERT INTO scoring_section_category (scoring_section_id, category) VALUES
    (501, 'vocabulary'), (501, 'grammar'), (501, 'reading'),
    (502, 'listening');

