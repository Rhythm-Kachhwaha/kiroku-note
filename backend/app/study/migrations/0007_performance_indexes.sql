-- -----------------------------------------------------------------------------
-- Migration 0007: Performance & Query Optimization Indexes
-- -----------------------------------------------------------------------------
-- Adds non-redundant, query-justified secondary indexes for frequently executed
-- study subsystem query patterns:
--
-- 1. idx_question_level_format_status:
--    Supports ExamReadinessValidator.get_eligible_questions_for_format and
--    format-level blueprint allocation queries:
--    SELECT id, current_revision_id FROM question WHERE level = ? AND format_code = ? AND status = 'active'...
--
-- 2. idx_source_answer_claim_rev:
--    Supports v_question_eligibility and evaluate_eligibility conflict checks:
--    SELECT 1 FROM source_answer_claim WHERE question_revision_id = ? AND is_conflict = 1.
--
-- 3. idx_attempt_item_question:
--    Supports PracticeAnalyticsService aggregations (get_accuracy_by_level, get_accuracy_by_family,
--    get_trouble_questions) and adaptive history checks:
--    JOIN attempt_item ai ON ai.question_id = q.id.
--
-- 4. idx_exam_item_state_section:
--    Supports ExamService._commit_section_responses:
--    SELECT ... FROM exam_item_state WHERE section_attempt_id = ?.
--
-- 5. idx_test_attempt_status_created:
--    Supports adaptive recent session lookup and session lifecycle filters:
--    SELECT id FROM test_attempt WHERE status IN ('completed', 'in_progress') ORDER BY id DESC LIMIT 1.

CREATE INDEX IF NOT EXISTS idx_question_level_format_status ON question(level, format_code, status);
CREATE INDEX IF NOT EXISTS idx_source_answer_claim_rev ON source_answer_claim(question_revision_id, is_conflict);
CREATE INDEX IF NOT EXISTS idx_attempt_item_question ON attempt_item(question_id);
CREATE INDEX IF NOT EXISTS idx_exam_item_state_section ON exam_item_state(section_attempt_id);
CREATE INDEX IF NOT EXISTS idx_test_attempt_status_created ON test_attempt(status, created_at);

