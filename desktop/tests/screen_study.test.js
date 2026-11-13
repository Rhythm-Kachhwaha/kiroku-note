const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const studyViewPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'study.js');

test('Study View: No hardcoded mock questions or fake pool in production templates', () => {
  const content = fs.readFileSync(studyViewPath, 'utf8');

  // Forbidden placeholder mock text
  const forbidden = [
    'いくら頼まれても、引き受ける＿＿＿にはいかない。',
    '夜遅くまで本を読んでいたので、＿＿＿が痛くなった。',
    '「〜わけにはいかない」は、社会的・道徳的・心理的な理由から',
    'catch (_) {}'
  ];

  for (const str of forbidden) {
    assert.equal(
      content.includes(str),
      false,
      `StudyView must not contain placeholder string: "${str}"`
    );
  }

  // Renders dynamic containers
  assert.ok(
    content.includes('id="study-content-area"'),
    'StudyView must include study-content-area container'
  );
  assert.ok(
    content.includes('study-empty-state'),
    'StudyView must support honest empty state when bank has no questions'
  );
});

test('Study View: Wires practice session lifecycle via studyClient', () => {
  const content = fs.readFileSync(studyViewPath, 'utf8');

  assert.ok(
    content.includes('studyClient.createPracticeSession('),
    'StudyView must call studyClient.createPracticeSession to launch drills'
  );
  assert.ok(
    content.includes('studyClient.submitPracticeAnswer('),
    'StudyView must call studyClient.submitPracticeAnswer for deterministic grading'
  );
  assert.ok(
    content.includes('studyClient.recordPracticeFeedback('),
    'StudyView must call studyClient.recordPracticeFeedback for difficulty ratings'
  );
  assert.ok(
    content.includes('studyClient.completePracticeSession('),
    'StudyView must call studyClient.completePracticeSession upon finishing questions'
  );
});

test('Study View: Choice submission calculates response time and reveals feedback', () => {
  const content = fs.readFileSync(studyViewPath, 'utf8');

  assert.ok(
    content.includes('timeSpentMs'),
    'StudyView must track question response time'
  );
  assert.ok(
    content.includes('grading-banner'),
    'StudyView must reveal grading-banner upon grading'
  );
  assert.ok(
    content.includes('explanation-card'),
    'StudyView must reveal explanation-card with pedagogical breakdown'
  );
});

test('Study View: Honest result wording without fake official exam scores', () => {
  const content = fs.readFileSync(studyViewPath, 'utf8');

  assert.ok(
    content.includes('renderCompleteState('),
    'StudyView must implement complete state rendering'
  );
  assert.ok(
    content.includes('Honest diagnostic practice result'),
    'StudyView must clearly state practice diagnosis without claiming official scores'
  );
});

test('Study View: Error handling is visible with banner (no silent catches)', () => {
  const content = fs.readFileSync(studyViewPath, 'utf8');

  assert.ok(
    content.includes('showError('),
    'StudyView must implement visible showError method'
  );
  assert.ok(
    content.includes('study-error-banner'),
    'StudyView must include visible study-error-banner element'
  );
  assert.ok(
    !content.includes('catch (_) {}'),
    'StudyView must not contain empty silent catch blocks'
  );
});



test('Study View: Slice 22 segments, Bank Import panel, and Mistakes cross-links', () => {
  const content = fs.readFileSync(studyViewPath, 'utf8');

  // Segments
  assert.ok(content.includes("id: 'practice'"), 'Must contain practice segment');
  assert.ok(content.includes("id: 'bank'"), 'Must contain bank segment');
  assert.ok(content.includes("id: 'mistakes'"), 'Must contain mistakes segment');
  assert.ok(content.includes("id: 'progress'"), 'Must contain progress segment');

  // Bank import panel
  assert.ok(content.includes('btn-toggle-bank-import'), 'Must render bank import toggle button');
  assert.ok(content.includes('bank-import-mount'), 'Must render bank import mount container');
  assert.ok(content.includes('renderStudyImport'), 'Must wire renderStudyImport');

  // Mistakes cross-links
  assert.ok(content.includes('crosslink-grammar-btn'), 'Must render grammar crosslink');
  assert.ok(content.includes('crosslink-kanji-btn'), 'Must render kanji crosslink');
});

test('Study Import: PDF drop zone, page list with route labels, and commit flow', () => {
  const importJsPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'views', 'study_import.js');
  const content = fs.readFileSync(importJsPath, 'utf8');

  // Drop zone and file input
  assert.ok(content.includes('pdf-drop-zone'), 'Must render pdf drop zone');
  assert.ok(content.includes('pdf-file-input'), 'Must render pdf file input');

  // OCR unavailable notice
  assert.ok(content.includes('needs OCR - not available'), 'Image-only pages must be marked needs OCR - not available');

  // StudyClient endpoints
  assert.ok(content.includes('studyClient.inspectPdfImport('), 'Must call inspectPdfImport');
  assert.ok(content.includes('studyClient.previewPdfImport('), 'Must call previewPdfImport');
  assert.ok(content.includes('studyClient.commitImport('), 'Must call commitImport');
});

test('Study View: Question readability and Exit button during practice', async () => {
  const content = fs.readFileSync(studyViewPath, 'utf8');
  assert.ok(content.includes('id="btn-exit-drill"'), 'Must render Exit button in drill session header bar');
  assert.ok(content.includes('formatQuestionType'), 'Must use formatQuestionType for human-readable labels');

  const { formatQuestionType } = await import('../src/ui/views/study.js');
  assert.strictEqual(formatQuestionType('contextual_expressions'), 'Contextual Expressions');
  assert.strictEqual(formatQuestionType('short_passage'), 'Short Passage Reading');
  assert.strictEqual(formatQuestionType('sentence_scramble'), 'Sentence Scramble');
});
