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

